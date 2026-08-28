'use strict';
/**
 * src/services/stampService.js
 * ----------------------------
 * Places a stamp on a document — the first-class STAMP action (Workflow+Stamping redesign 2026-08-28,
 * slice 1). Transport-agnostic: the desktop IPC and the /v1 handler both call `placeStamp` with an
 * explicit `actor`, so the SAME gates apply everywhere. The renderer/client only ever send coordinates +
 * a stamp type; the source path is resolved HERE (never trusted from a payload), mirroring reviewService.
 *
 * INVARIANTS enforced here:
 *   - PERMISSION: the actor must hold `can_stamp` (fail-closed, tamper-evident — stampPermission.js).
 *   - ACCESS: the actor must pass `accessService.canAccessDocument` (Oracle C2 — a self-stamp has no
 *     to_user route gate, so a stamper must still be entitled to the document).
 *   - IMMUTABLE + ATTRIBUTABLE: the record is an append-only `stamp_events` row carrying who/what/when +
 *     a hash of the base it stamped (source_sha256) and of the produced copy (artifact_sha256), and it is
 *     ANCHORED into the tamper-evident audit chain (a `stamp_placed` audit row whose metadata carries the
 *     record's content hash; the record stores that audit row's row_hmac as `audit_ref`). Original is
 *     never touched (pdfStamp writes a copy). Cumulative: each stamp is applied to the current stamped
 *     artifact, so stamps accumulate on one document.
 *   - ATOMIC (Oracle gate 6): the artifact is finalised on disk FIRST, then the audit row + the
 *     stamp_events row commit in ONE transaction; a failed transaction deletes the orphan artifact. A
 *     committed row therefore always has its artifact; the only crash residual is a harmless orphan file.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

function sha256File(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }

// Canonical content hash over a FIXED field order (an audit-chain-style anchor for the record's content).
const _CONTENT_FIELDS = ['document_id', 'stamp_type_id', 'type_key_snapshot', 'type_label_snapshot',
  'type_color_snapshot', 'placed_by_user_id', 'placed_by_username_snapshot', 'placed_at', 'placement_json',
  'note', 'source_sha256', 'artifact_sha256', 'route_id'];
function contentHash(rec) {
  const canonical = _CONTENT_FIELDS.map(f => (rec[f] == null ? '' : String(rec[f]))).join('');
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function createStampService(deps = {}) {
  const stampsDb  = deps.stampsDb  || require('../../database/modules/stamps');
  const authDb    = deps.authDb    || require('../../database/modules/auth');
  const docsDb    = deps.docsDb    || require('../../database/modules/documents');
  const pdfStamp  = deps.pdfStamp  || require('./pdfStamp');
  const stampPerm = deps.stampPerm || require('../modules/auth/stampPermission');
  const now  = deps.now  || (() => new Date().toISOString());
  const uuid = deps.uuid || (() => crypto.randomUUID());
  const canAccess = deps.canAccess || ((db, actor, docId) => {
    try { return !!require('./accessService').canAccessDocument(db, { userId: actor.userId, role: actor.role }, docId).allow; }
    catch { return false; }               // fail-closed if the gate can't be evaluated
  });
  const resolveSourcePath = deps.resolveSourcePath || ((db, docId) => {
    const d = docsDb.getById(db, docId); return d ? docsDb.resolveFilePath(d) : null;
  });
  // App-managed, doc-id-keyed artifact directory (Oracle condition 3 — NOT a filing-folder sidecar, so a
  // legitimate re-file can't orphan it). Injected in tests.
  const stampsDir = deps.stampsDir || ((docId) => {
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'stamps', String(docId));
  });

  // Place a stamp. Returns { ok:true, stampEventId, artifactPath } or { ok:false, code, error }.
  async function placeStamp(db, actor, { documentId, stampTypeId, box, page = 0, note = '', routeId = null } = {}) {
    if (!actor || actor.userId == null) return { ok: false, code: 'NO_ACTOR', error: 'No actor.' };
    if (documentId == null || stampTypeId == null) return { ok: false, code: 'INVALID', error: 'documentId and stampTypeId are required.' };

    // Gate 1 — permission (fail-closed, tamper-evident).
    const perm = stampPerm.requireStampPermission(db, actor.userId);
    if (!perm.ok) return perm;
    // Gate 2 — document access (a self-stamp has no route gate; Oracle C2).
    if (!canAccess(db, actor, documentId)) return { ok: false, code: 'FORBIDDEN', error: 'You cannot access this document.' };

    const type = stampsDb.getStampType(db, stampTypeId);
    if (!type || type.active === 0) return { ok: false, code: 'BAD_TYPE', error: 'Unknown stamp type.' };

    // Cumulative base: the current stamped artifact if one exists on disk, else the original source.
    const latest = stampsDb.latestStampEvent(db, documentId);
    let base = (latest && latest.artifact_path && fs.existsSync(latest.artifact_path))
      ? latest.artifact_path : resolveSourcePath(db, documentId);
    if (!base || !fs.existsSync(base)) return { ok: false, code: 'NO_SOURCE', error: 'The document file is missing.' };
    if (path.extname(base).toLowerCase() !== '.pdf') return { ok: false, code: 'NOT_PDF', error: 'Only PDF documents can be stamped.' };

    const placedAt = now();
    const dir = stampsDir(documentId);
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* surfaced below if the write fails */ }
    const finalPath = path.join(dir, `${uuid()}.pdf`);
    const tmpPath = finalPath + '.tmp';

    const source_sha256 = sha256File(base);
    const placement = { x: box && box.x, y: box && box.y, w: box && box.w, page };

    // Render the stamped COPY (pdf-lib; original untouched). pdfStamp does the origin flip + on-page clamp.
    try {
      await pdfStamp.stampPdf(base, tmpPath, {
        label: type.label, color: type.color, box: box || null, page,
        notes: note || '', userName: actor.username || '', date: placedAt,
      });
    } catch (e) {
      try { fs.existsSync(tmpPath) && fs.unlinkSync(tmpPath); } catch {}
      return { ok: false, code: 'RENDER_FAILED', error: `Could not produce the stamped copy: ${e && e.message}` };
    }
    const artifact_sha256 = sha256File(tmpPath);

    const rec = {
      document_id: documentId, stamp_type_id: type.id,
      type_key_snapshot: type.key, type_label_snapshot: type.label, type_color_snapshot: type.color,
      placed_by_user_id: actor.userId, placed_by_username_snapshot: actor.username || null,
      placed_at: placedAt, placement_json: JSON.stringify(placement), note: note || null,
      source_sha256, artifact_sha256, route_id: routeId, artifact_path: finalPath, created_at: placedAt,
    };
    const content_sha256 = contentHash(rec);

    // Finalise the artifact FIRST (a committed row must always have its file); then the atomic DB write.
    try { fs.renameSync(tmpPath, finalPath); }
    catch (e) {
      try { fs.existsSync(tmpPath) && fs.unlinkSync(tmpPath); } catch {}
      return { ok: false, code: 'WRITE_FAILED', error: `Could not save the stamped copy: ${e && e.message}` };
    }

    let stampEventId;
    try {
      const txn = db.transaction(() => {
        // Anchor the record into the signed audit chain — the metadata carries the content hash so a
        // whole-table rebuild of stamp_events cannot pass without also forging a signed audit row.
        authDb.addAuditEntry(db, {
          user_id: actor.userId, action: 'stamp_placed', action_category: 'workflow', outcome: 'success',
          target_type: 'document', target_id: documentId, document_id: documentId,
          actor_username: actor.username || null, actor_role: actor.role || null,
          details: `${type.label} on doc ${documentId}`,
          metadata: { stamp_type_key: type.key, label: type.label, content_sha256, artifact_sha256,
                      source_sha256, placement, route_id: routeId },
        });
        const anchor = db.prepare('SELECT row_hmac FROM audit_log ORDER BY id DESC LIMIT 1').get();
        rec.content_sha256 = content_sha256;
        rec.audit_ref = (anchor && anchor.row_hmac) || null;   // null when unkeyed (dev) — inert, not fatal
        stampEventId = stampsDb.insertStampEvent(db, rec);
      });
      txn();
    } catch (e) {
      try { fs.existsSync(finalPath) && fs.unlinkSync(finalPath); } catch {}   // no dangling artifact
      return { ok: false, code: 'RECORD_FAILED', error: `Could not record the stamp: ${e && e.message}` };
    }

    return { ok: true, stampEventId, artifactPath: finalPath };
  }

  // The current stamped artifact for a document (latest event), or null if unstamped / file missing.
  function currentArtifact(db, documentId) {
    const latest = stampsDb.latestStampEvent(db, documentId);
    if (latest && latest.artifact_path && fs.existsSync(latest.artifact_path)) {
      return { path: latest.artifact_path, stampEventId: latest.id, count: stampsDb.countStampsForDoc(db, documentId) };
    }
    return null;
  }

  // History for a document — path-stripped (Oracle condition 8: never expose artifact_path).
  function stampsForDocument(db, documentId) {
    return stampsDb.listStampEventsForDoc(db, documentId).map(e => ({
      id: e.id, label: e.type_label_snapshot, color: e.type_color_snapshot,
      placedBy: e.placed_by_username_snapshot, placedAt: e.placed_at, note: e.note,
      routeId: e.route_id, hasArtifact: !!(e.artifact_path && fs.existsSync(e.artifact_path)),
    }));
  }

  // Integrity: recompute a record's content hash and confirm the anchoring audit row still carries it and
  // the chain verifies. Used by the Settings "Integrity check" + the re-file re-bind (later slices).
  function verifyStampRecord(db, event) {
    if (!event) return { ok: false, reason: 'missing' };
    const recomputed = contentHash(event);
    if (event.content_sha256 && event.content_sha256 !== recomputed) return { ok: false, reason: 'content_mismatch' };
    const chain = authDb.verifyAuditChain(db);
    if (!chain.ok) return { ok: false, reason: `chain_${chain.reason || 'broken'}` };
    return { ok: true };
  }

  return { placeStamp, currentArtifact, stampsForDocument, verifyStampRecord };
}

module.exports = { createStampService, contentHash, sha256File };
