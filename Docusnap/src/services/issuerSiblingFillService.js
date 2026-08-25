'use strict';
/**
 * src/services/issuerSiblingFillService.js — the first-batch letterhead sibling-fill.
 * ------------------------------------------------------------------------------------------------
 * gary design → Oracle SIGN-OFF-WITH-CONDITIONS, 2026-08-25 (docs/oracle_log.md). DEFAULT OFF behind
 * `issuer_sibling_fill` / env ISSUER_SIBLING_FILL. OFF is inert by construction (the entry point
 * returns null before reading anything).
 *
 * THE PROBLEM (Chris, every round — the #1 friction). A brand-new supplier's FIRST import of ~12
 * identical-layout invoices are EACH held on FIRST CONTACT asking "confirm the sender" (the letterhead
 * PREFILL hold: engine writes supplier_name = the letterhead read C at conf 69, method
 * 'letterhead_prefill', + a "confirm it's the sender, not the customer" note, and _needs_review). The
 * hold has NO cross-sibling memory: confirming ONE only helps documents imported AFTER it (the supplier
 * then gets a hint/logo/template); the 11 identical siblings already in the queue stay held. So File All
 * Ready offers 0 on a fresh supplier's first batch.
 *
 * WHAT IT DOES. When the operator CONFIRMS a document and left its letterhead prefill UNCHANGED (they
 * accepted "this letterhead IS the sender"), fill the queued, same-layout siblings whose OWN letterhead
 * read the SAME company: raise their issuer field to the review threshold and clear the letterhead note
 * so File All Ready offers them. Told afterwards with an undo (the Gmail pattern), never a dialog.
 *
 * WHY LEGITIMATE (the license) — the human made THIS call on a byte-identical page, and:
 *  C1  Fires ONLY when the human ACCEPTED the letterhead as-is: the source's PRE-persist supplier_name
 *      was a letterhead prefill with a note AND norm(confirmed C) == norm(prefilled read). A CORRECTED
 *      confirm (buyer-issued / customer-at-top: C != the read) does NOT propagate — each sibling keeps
 *      its own sender-vs-customer review.
 *  C2  SAME-LAYOUT GUARD. A sibling adopts only if its `logo_phash` is within a TIGHT Hamming distance
 *      of the confirmed doc's (identical same-batch siblings score ~0-2; a DIFFERENT sender's logo scores
 *      far). A missing phash on either side scores 64 (hammingDistance's null return) -> refused. This
 *      closes the shared-garble collision (two distinct senders in one batch whose letterheads garble to
 *      the same string): different logos -> refused, left held with their own note.
 *  C3  The source row's (method, display, note, phash) is CAPTURED PRE-CLAIM by reviewService and threaded
 *      in — never re-read here (by the time this LAST-effect hook runs the source is already resolved).
 *  C4  NEVER writes `corrected_to` (trust.js/getReviewQueue count it as flagged -> would re-hold forever
 *      or, with vacuous-ignore on, hide it). The METHOD MARKER is the only badge. `overall_confidence` is
 *      NOT touched -> the doc stays below the auto-file floor, so NO machine door (import gate / scope
 *      sweep / corroboration) can file a filled sibling silently: only the human File-All click files it.
 *      We raise the FIELD confidence (clears below_threshold) but never the DOC overall.
 *  C5  No learning-exclusion is needed (contrast classFixService C2): each sibling's OWN letterhead
 *      already reads C, so the fill CONFIRMS the sibling's own evidence rather than overriding it. Do NOT
 *      "harden" this into a classFix-style learning exclusion.
 *
 * NEVER: dates, money, ref, name-like fields — the supplier_name (issuer) ROLE only. Never a filed doc.
 */

const templates = require('../../database/modules/templates');

const MARKER = '+issuer_sibling_fill';
const CAP = 30;                        // a first batch can be large; cap the sweep honestly
const _SAME_LAYOUT_PHASH_DIST = 4;     // C2: tight — genuine same-batch siblings ~0-2; distinct senders far
const _FILL_CONF = 90;                 // clears any reasonable field threshold; overall_confidence untouched

const _batches = new Map();
let _batchSeq = 0;

const _norm = s => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');

function _enabled(db, learning) {
  if (process.env.ISSUER_SIBLING_FILL === '0') return false;
  if (process.env.ISSUER_SIBLING_FILL === '1') return true;
  try { return learning.getSetting(db, 'issuer_sibling_fill', 'false') === 'true'; }
  catch { return false; }
}

/** C1: did the source doc's letterhead prefill get ACCEPTED as-is by the human? `src` is the pre-claim
 *  capture {method, display, note, phash}; `C` is the value the human confirmed. */
function _sourceAcceptedLetterhead(src, C) {
  if (!src || !C) return false;
  if (!String(src.method || '').includes('letterhead')) return false;   // only a letterhead read
  if (!String(src.note || '').trim()) return false;                     // that was held (a note present)
  return _norm(src.display) === _norm(C);                              // and left UNCHANGED (accepted)
}

/**
 * THE ENTRY POINT. Called from reviewService.confirm as the LAST effect (its own guards, never nested).
 * Returns null when nothing was done, else { batchId, field, issuer, docs:[{id, filename, issuer}] }.
 */
function applyForConfirm(db, opts) {
  const { documentId, confirmedIssuer: C, src, typeSlug, actorName, learning, audit, presence, logger } = opts || {};

  if (!_enabled(db, learning)) return null;               // OFF => nothing read, nothing written
  if (!documentId || !C || !src) return null;
  if (!_sourceAcceptedLetterhead(src, C)) return null;   // C1: only a human-accepted letterhead
  if (!src.phash) return null;                           // C2: no source layout signature => can't prove sameness

  // Candidate siblings: QUEUED letterhead holds, not this doc, not workflow-locked / put-back / presence-open.
  let rows;
  try {
    rows = db.prepare(`
      SELECT d.id, d.original_filename, d.logo_phash, d.template_id, d.document_type_id,
             e.display_value, e.confidence, e.validation_note, e.extraction_method, e.corrected_to,
             COALESCE((SELECT f.confidence_threshold FROM fields f
                        WHERE f.document_type_id = d.document_type_id AND f.key = 'supplier_name'), 70) AS thr
        FROM documents d
        JOIN extractions e ON e.document_id = d.id AND e.field_key = 'supplier_name'
       WHERE d.status = 'needs_review'
         AND d.id <> @docId
         AND (@hasPutBack = 0 OR d.put_back_at IS NULL)
         AND COALESCE(d.workflow_status, '') NOT IN ('pending', 'claimed')
         AND e.validation_note IS NOT NULL AND e.validation_note <> ''
         AND e.extraction_method LIKE '%letterhead%'
       ORDER BY d.id`).all({
         docId: documentId,
         hasPutBack: require('../../database/modules/documents')._hasPutBackAt(db) ? 1 : 0,
       });
  } catch (e) { logger?.warn?.('issuer sibling-fill: candidate scan failed: ' + (e && e.message)); return null; }

  if (presence) rows = rows.filter(r => !presence.viewers(r.id).length);

  const take = [];
  for (const r of rows) {
    if (take.length >= CAP) break;
    if (_norm(r.display_value) !== _norm(C)) continue;              // its OWN letterhead must read C
    if (String(r.corrected_to || '').trim()) continue;             // a pending human suggestion — leave it
    if (!r.logo_phash) continue;                                   // C2: no sibling signature => refuse (held)
    if (templates.hammingDistance(src.phash, r.logo_phash) > _SAME_LAYOUT_PHASH_DIST) continue;   // C2: different layout
    // Template guard: NULL (first contact — the common case) is fine; a mature sibling that matched a
    // template must NOT be a buyer-issued or identity-unconfirmed one. Can't verify => refuse (fail-safe).
    if (r.template_id) {
      let t = null;
      try { t = db.prepare('SELECT buyer_issued, identity_unconfirmed FROM templates WHERE id = ?').get(r.template_id); }
      catch { continue; }
      if (!t || t.buyer_issued || t.identity_unconfirmed) continue;
    }
    take.push(r);
  }
  if (!take.length) return null;

  return _commit(db, { documentId, C, take, actorName, audit, logger, scope: { supplier: C, slug: typeSlug || '' } });
}

function _commit(db, { documentId, C, take, actorName, audit, logger, scope }) {
  const batchId = `if${++_batchSeq}`;
  const undo = [], docs = [];
  const upd = db.prepare(`
    UPDATE extractions
       SET confidence = @conf,
           validation_note = NULL,
           extraction_method = @method
     WHERE document_id = @id AND document_id <> @src AND field_key = 'supplier_name'`);
  try {
    db.transaction(() => {
      for (const r of take) {
        const oldMethod = String(r.extraction_method || '');
        const method = oldMethod.endsWith(MARKER) ? oldMethod : (oldMethod + MARKER);
        // Raise the FIELD confidence to clear below_threshold (>= the per-field threshold); overall_confidence
        // is NEVER touched (C4) so the doc stays below the auto-file floor — only File-All (human) files it.
        const conf = Math.max(_FILL_CONF, Number(r.thr) || 70);
        undo.push({ id: r.id, confidence: r.confidence, extraction_method: r.extraction_method,
                    validation_note: r.validation_note });
        upd.run({ id: r.id, src: documentId, conf, method });
        docs.push({ id: r.id, filename: r.original_filename, issuer: C });
      }
    })();
  } catch (e) { logger?.warn?.('issuer sibling-fill: apply failed, nothing written: ' + (e && e.message)); return null; }

  _batches.set(batchId, { sourceId: documentId, rows: undo });

  // The consent trail (mirrors classFix C8): records the applied count + the source decision so a wrong
  // graduation off one letterhead confirm is forensically traceable to the decision that caused it.
  try {
    audit && audit(db, {
      action: 'issuer_sibling_fill_applied', target_type: 'document', target_id: documentId,
      document_id: documentId, outcome: 'success', actor_username: actorName || null,
      metadata: { field: 'supplier_name', issuer: C, scope: `${scope.supplier}|${scope.slug}`,
                  doc_ids: docs.map(d => d.id).join(','), applied: docs.length, batch: batchId },
    });
  } catch { /* the audit must never fail the fill */ }

  logger?.log?.(`  Issuer sibling-fill: '${C}' filled on ${docs.length} queued same-letterhead sibling(s)`);
  return { batchId, field: 'supplier_name', issuer: C, docs };
}

/**
 * UNDO. Restores each row that STILL carries the marker AND is still queued — anything filed or touched
 * since is left alone (a filed doc would desync from its filename/XML on revert).
 */
function undoBatch(db, batchId, opts = {}) {
  const b = _batches.get(batchId);
  if (!b) return { ok: false, reason: 'expired' };
  const { audit, actorName, logger } = opts;

  const cur = db.prepare(`SELECT e.extraction_method, d.status
                            FROM extractions e JOIN documents d ON d.id = e.document_id
                           WHERE e.document_id = ? AND e.field_key = 'supplier_name'`);
  const rest = db.prepare(`UPDATE extractions
                              SET confidence = @confidence,
                                  extraction_method = @extraction_method,
                                  validation_note = @validation_note
                            WHERE document_id = @id AND field_key = 'supplier_name'`);
  let restored = 0, skipped = 0;
  try {
    db.transaction(() => {
      for (const r of b.rows) {
        const c = cur.get(r.id);
        if (!c) { skipped++; continue; }
        if (c.status !== 'needs_review') { skipped++; continue; }                 // filed since — refuse
        if (!String(c.extraction_method || '').endsWith(MARKER)) { skipped++; continue; }  // touched since
        rest.run({ id: r.id, confidence: r.confidence, extraction_method: r.extraction_method,
                   validation_note: r.validation_note });
        restored++;
      }
    })();
  } catch (e) { return { ok: false, reason: 'failed', message: e && e.message }; }

  _batches.delete(batchId);
  try {
    audit && audit(db, {
      action: 'issuer_sibling_fill_undone', target_type: 'document', target_id: b.sourceId,
      document_id: b.sourceId, outcome: 'success', actor_username: actorName || null,
      metadata: { batch: batchId, restored, skipped },
    });
  } catch { /* best effort */ }
  logger?.log?.(`  Issuer sibling-fill: undo ${batchId} — ${restored} restored, ${skipped} left alone`);
  return { ok: true, restored, skipped };
}

/** Test seam only — the module-level maps are process-lifetime by design. */
function _reset() { _batches.clear(); _batchSeq = 0; }

module.exports = { applyForConfirm, undoBatch, MARKER, CAP, _SAME_LAYOUT_PHASH_DIST, _reset };
