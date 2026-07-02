'use strict';

/**
 * services/reviewService.js
 * -------------------------
 * Transport-agnostic document-review orchestration (confirm / defer / restore + queue reads),
 * shared by the desktop IPC handler and (Phase 3) the detached-client `/v1` API. Takes an
 * explicit `actor { username, role }` so the SAME rules apply on every transport.
 *
 * Design (locked in the plan):
 *  - AUTH + the workflow lock are enforced by the CALLER at its edge (desktop: requireUnlocked
 *    throws; API: editGuard → 403) — the service trusts the actor it's handed.
 *  - CONFIRM CLAIMS the document atomically (documents.confirmIfReviewable) BEFORE filing, so
 *    two confirms of one doc (two clients, a client vs the desktop, auto-file vs manual) can't
 *    both file it — the loser gets ALREADY_FILED with the winner's name. A re-file (an already-
 *    confirmed doc, "Edit in Review") skips the claim (it can't lose a needs_review race, and a
 *    claim-then-rollback would strand its filed state) — but ONLY when the caller passes an
 *    explicit `allowRefile` intent, so a queue confirm that raced into an already-filed doc still
 *    loses cleanly (ALREADY_FILED) instead of silently overwriting the first reviewer.
 *  - The Electron-only steps (source-move, landmark capture, taught-confirm template promote,
 *    count broadcast) are INJECTED hooks so the desktop path is byte-identical and the API path
 *    simply omits them.
 */

function fail(code, error, extra) { return { ok: false, success: false, code, error, ...(extra || {}) }; }

function createReviewService(deps = {}) {
  const documents = deps.documents || require('../../database/modules/documents');
  const learning  = deps.learning  || require('../../database/modules/learning');
  const doctypes  = deps.doctypes  || require('../../database/modules/document_types');
  const filing    = deps.filing    || require('../modules/filing/handler');
  const fs   = deps.fs   || require('fs');
  const path = deps.path || require('path');
  const logger = deps.logger || null;
  const audit  = deps.audit || (() => {});
  // Optional Electron-only hooks — no-ops for the API path.
  const onScheduleSourceMove = deps.onScheduleSourceMove || (() => {});
  const onTaughtConfirm      = deps.onTaughtConfirm      || (async () => {});
  const captureSample        = deps.captureSample        || (async () => {});
  const notifyCounts         = deps.notifyCounts         || (() => {});
  const releaseDelayMs       = deps.releaseDelayMs != null ? deps.releaseDelayMs : 0;

  // ── Queue reads (Admin/Edit; the caller gates) ────────────────────────────────
  const queue    = (db) => documents.getReviewQueue(db);
  const deferred = (db) => documents.getDeferredQueue(db);
  const counts   = (db) => ({ review: documents.getReviewCount(db), deferred: documents.getDeferredCount(db) });

  // ── Confirm / file ────────────────────────────────────────────────────────────
  async function confirm(db, actor, payload) {
    const {
      document_id, folder_path, original_filename,
      corrections, allValues, supplier_name,
      document_type, document_type_slug, taught_fields, bulk,
    } = payload || {};
    const actorName = (actor && actor.username) || null;

    const docRow = documents.getById(db, document_id);
    const workingPath = docRow?.working_path || null;
    // PREVIOUSLY-FILED copy: the doc's current filed copy, captured REGARDLESS of status and
    // BEFORE the claim below (which nulls the row's stored_path). Two cases carry one:
    //   • an already-confirmed doc ("Edit in Review" / re-surfaced auto-filed doc), and
    //   • a doc that was filed, then sent back to the review queue by Learning Repair
    //     (deconfirmDocument KEEPS stored_path). In BOTH, passing it as existingFiledPath makes
    //     the re-confirm REPLACE the original copy IN PLACE instead of minting a -DUPLICATE.
    const oldStoredPath = (docRow && docRow.stored_path) ? docRow.stored_path : null;
    // isRefile = SKIP the atomic claim. Only an ALREADY-CONFIRMED doc with explicit caller intent
    // does so ("Edit in Review"; renderer: allowRefile = status==='confirmed'). A confirm from the
    // review QUEUE (needs_review — incl. a Learning-Repair send-back) must still CLAIM (so a lost
    // race gets ALREADY_FILED, not a last-writer overwrite), yet it still replaces its own old copy
    // in place via oldStoredPath above. The /v1 client never sets allowRefile (server-decided).
    const isRefile = !!oldStoredPath && docRow.status === 'confirmed' && !!(payload && payload.allowRefile === true);

    const dtInfo = document_type_slug ? doctypes.getWithFields(db, document_type_slug) : null;

    // CENTRAL DATE NORMALISATION — the ONE point where a submitted date becomes the core's
    // canonical DD-MM-YYYY. Whatever a client (desktop or /v1) sends (a user might type
    // "Aug 03 2012", "2012-08-03", "3/8/2012"), normalise it HERE, before BOTH filing and the
    // learned corrections, so the stored value, the filename and the learning corpus all agree
    // and no client re-implements date parsing. Unparseable values are left as typed (never
    // dropped). Reuses filing.normaliseDate (same logic the filename builder uses).
    if (dtInfo && allValues && typeof filing.normaliseDate === 'function') {
      const dateKeys = new Set();
      if (Array.isArray(dtInfo.fields)) for (const f of dtInfo.fields) if (f && f.type === 'date') dateKeys.add(f.key);
      if (dtInfo.date_field_key) dateKeys.add(dtInfo.date_field_key);
      for (const k of dateKeys) {
        const norm = filing.normaliseDate(allValues[k]);
        if (norm && norm !== allValues[k]) {
          allValues[k] = norm;
          if (corrections && corrections[k] && corrections[k].corrected_value != null) {
            corrections[k].corrected_value = norm;
          }
        }
      }
    }

    const outputRoot = learning.getSetting(db, 'output_folder', null);
    if (!outputRoot) return fail('NO_OUTPUT', 'No output folder set. Please configure it in Settings.');

    // CLAIM before filing (first-confirm only) so a lost race can't double-file. The loser
    // reads the winner's name off confirmed_by_username and reports it.
    if (!isRefile) {
      const claim = documents.confirmIfReviewable(db, document_id, { confirmed_by_username: actorName });
      if (!claim || claim.changes === 0) {
        const winner = documents.getById(db, document_id)?.confirmed_by_username || 'another user';
        return fail('ALREADY_FILED', `This document was already filed by ${winner}.`, { confirmedBy: winner });
      }
    }

    // Release the preview file handle (desktop only; bulk skips it — no preview was loaded).
    if (releaseDelayMs && !bulk) await new Promise(r => setTimeout(r, releaseDelayMs));

    let filingResult;
    try {
      filingResult = await filing.commitDocument({
        db, fs, path, outputRoot,
        folderPath:        folder_path,
        originalFilename:  original_filename,
        workingPath,
        existingFiledPath: oldStoredPath,
        allValues,
        documentType:      document_type || dtInfo?.name,
        dtInfo, logger,
      });
    } catch (e) { filingResult = { success: false, error: e && e.message }; }

    if (!filingResult || !filingResult.success) {
      // Filing failed AFTER the claim — roll the doc back to the queue so it isn't stranded as
      // "confirmed" with no stored file. (A re-file was never re-claimed, so leave it as-is.)
      // The claim nulled stored_*; if this doc was PREVIOUSLY filed (oldStoredPath), restore that
      // pointer so a Learning-Repair send-back doesn't lose track of its still-on-disk copy.
      if (!isRefile) {
        const restore = { status: 'needs_review', confirmed_at: null, confirmed_by_username: null };
        if (oldStoredPath) { restore.stored_path = oldStoredPath; restore.stored_filename = docRow.stored_filename || null; }
        try { documents.update(db, document_id, restore); } catch {}
      }
      logger?.err?.(`Confirm failed: ${original_filename} — ${filingResult && filingResult.error}`);
      return { ok: false, ...filingResult };
    }

    if (logger) {
      const fieldSummary = Object.entries(allValues || {}).filter(([, v]) => v)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' | ');
      logger.log(`Confirmed: ${original_filename} → type=${document_type_slug || '?'}` +
        ` supplier=${allValues?.supplier_name || supplier_name || '?'} filed=${filingResult.filename}`);
      if (fieldSummary) logger.log(`  Values: ${fieldSummary}`);
    }

    learning.saveCorrections(db, document_id, corrections || {}, supplier_name, document_type_slug, allValues, taught_fields || []);

    // Record the stored location. First-confirm already flipped status/confirmed_at/confirmed_by
    // in the claim; a re-file confirms now (and records who re-filed).
    if (isRefile) {
      documents.confirm(db, document_id, { stored_filename: filingResult.filename, stored_path: filingResult.filePath, confirmed_by_username: actorName });
    } else {
      documents.update(db, document_id, { stored_filename: filingResult.filename, stored_path: filingResult.filePath });
    }

    audit(db, { action: 'review_confirmed', target_type: 'document', target_id: document_id,
      document_id, outcome: 'success', actor_username: actorName,
      metadata: { type: document_type_slug || null, filed: filingResult.filename,
                  fields_changed: Object.keys(corrections || {}).join(',') || null } });

    // Clear pre-confirmation review aids (display-only; not read by learning).
    db.prepare('UPDATE extractions SET validation_note = NULL, corrected_to = NULL WHERE document_id = ?').run(document_id);

    // The working copy has served its purpose — remove it + clear the pointer.
    if (workingPath) {
      try { if (fs.existsSync(workingPath)) fs.unlinkSync(workingPath); } catch {}
      documents.update(db, document_id, { working_path: null });
    }

    // RE-FILE cleanup: remove the OLD filed copy + its metadata, only after the new copy + the
    // new stored_path are recorded (no data-loss window). Same-location overwrite → nothing to do.
    if (oldStoredPath && filingResult.filePath && path.resolve(oldStoredPath) !== path.resolve(filingResult.filePath)) {
      try { if (fs.existsSync(oldStoredPath)) fs.unlinkSync(oldStoredPath); } catch {}
      try {
        const oldExt = path.extname(oldStoredPath);
        const oldXml = path.join(path.dirname(oldStoredPath), '.metadata', path.basename(oldStoredPath, oldExt) + '.xml');
        if (fs.existsSync(oldXml)) fs.unlinkSync(oldXml);
      } catch {}
    }

    // Denormalised search fields.
    const refField  = dtInfo?.ref_field_key  || 'invoice_number';
    const dateField = dtInfo?.date_field_key || 'invoice_date';
    documents.update(db, document_id, {
      supplier_name:    (allValues && allValues.supplier_name) || supplier_name || null,
      doc_date:         (allValues && allValues[dateField]) || null,
      reference_number: (allValues && allValues[refField]) || null,
      document_type_id: dtInfo?.id || null,
    });

    if (filingResult.srcPath) onScheduleSourceMove({ srcPath: filingResult.srcPath, originalFilename: original_filename });
    notifyCounts(db);

    // Cross-sample landmark learning (best-effort). SKIPPED in bulk "File All Ready":
    // the hook spawns a Python landmark regen per doc against the SAME template, which
    // made bulk filing crawl one-at-a-time. Single confirms + the startup backfill
    // still cover it (the template's landmarks already exist from promote-time).
    if (!bulk) {
      try {
        const tId = documents.getById(db, document_id)?.template_id || null;
        if (tId) await captureSample(tId, document_id);
      } catch { /* best-effort */ }
    }

    // Auto-promote on a TAUGHT confirm (desktop only — the client never teaches).
    if (!bulk && Array.isArray(taught_fields) && taught_fields.length && (document_type_slug || dtInfo)) {
      try { await onTaughtConfirm(db, document_id, { allValues, document_type_slug, supplier_name, dtInfo }); }
      catch (e) { console.warn('Auto-promote on taught confirm failed:', e.message); }
    }

    return { ok: true, success: true, ...filingResult };
  }

  // ── Defer / restore (status-guarded) ──────────────────────────────────────────
  function defer(db, actor, docId) {
    const r = documents.deferIfReviewable(db, docId);
    if (!r || r.changes === 0) return fail('NOT_REVIEWABLE', 'This document is no longer in the review queue.');
    audit(db, { action: 'review_deferred', target_type: 'document', target_id: docId, document_id: docId,
      outcome: 'success', actor_username: (actor && actor.username) || null });
    notifyCounts(db);
    return { ok: true, success: true };
  }

  function restore(db, actor, docId) {
    const r = documents.restoreIfDeferred(db, docId);
    if (!r || r.changes === 0) return fail('NOT_DEFERRED', 'This document is no longer deferred.');
    audit(db, { action: 'review_restored', target_type: 'document', target_id: docId, document_id: docId,
      outcome: 'success', actor_username: (actor && actor.username) || null });
    notifyCounts(db);
    return { ok: true, success: true };
  }

  return { queue, deferred, counts, confirm, defer, restore };
}

module.exports = { createReviewService, fail };
