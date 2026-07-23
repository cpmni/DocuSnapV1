'use strict';

/**
 * src/services/repairService.js — the Learning-Repair "send back to Review" UN-PLANT.
 * gary design → Oracle SIGN OFF WITH CONDITIONS (C1-C7), 2026-07-23. Kill switch
 * REPAIR_UNPLANT=0 ⇒ the IPC falls back to today's plain status flip (byte-identical).
 *
 * WHY: deconfirmDocument reverses only the LIVE-derived half of confirm learning (formats,
 * template dominance, trust windows — all confirmed-gated). The STORED-INCREMENT half had no
 * inverse: supplier_hints planted at the poisoned confirm kept filling fields (the primary
 * leak), and the doc's corrections rows — inert while needs_review — ECHO back on re-confirm
 * through getFieldFormats' un-filtered LEFT JOIN (row-multiplying the old poison beside the
 * new fix). And the doc returned to Review looking clean: nothing stopped re-confirming the
 * same mistake (the rubber-stamp gap).
 *
 * ONE atomic transaction (Oracle (d): pure local SQL — a throw rolls EVERYTHING back, the doc
 * stays confirmed, the operator retries; fails toward the status quo, never a half-retracted
 * state — unlike confirm, whose filesystem I/O forces best-effort ordering):
 *   1. deconfirmDocument FIRST — its status guard IS the idempotence lever (a second send sees
 *      0 changes and nothing below runs: a double-send can never double-decrement).
 *   2. learning.retractConfirmHints — the plant's inverse (C1-C3, co-located with the plant).
 *   3. Latest-row-wins display sync (C4 — a naive `display <> corrected` sweep would write an
 *      OLD cycle's poison back into display_value; latest-per-field mirrors documents.js's
 *      getConfirmedFieldValues convention), THEN delete this doc's corrections rows — their
 *      only extraction-feeding life was the re-confirm echo; the confirmed audit survives in
 *      the audit log and the value in the synced display_value.
 *   4. Suspect-field notes (C5): EVERY send-back stamps at least one note, so the doc returns
 *      VISIBLY suspect — counted by review_flag_count, excluded from File-All-Ready, cleared
 *      by confirm's own note-wipe on re-file. Values are KEPT (owner-ruled: blanking good
 *      fields is the wrong lever); the flag is the review-forcing element.
 *
 * Known residuals (documented, out of slice): repair-delete leaves plants standing (C6 —
 * soft-delete is recoverable and restore would need re-plant symmetry; owner ruling pending);
 * docs sent back BEFORE this shipped stay un-retracted (go-forward-only); reprocess-of-
 * confirmed is a sibling leak with different semantics; P2-class foreign-key hints planted
 * from allValues before the foreign drop may leave residue the retract cannot see (C7 —
 * plant-side filter filed as its own follow-up).
 */

const documents = require('../../database/modules/documents');
const learning = require('../../database/modules/learning');

const NOTE_PREFIX = 'Sent back from Learning Repair';
const GENERIC_NOTE = NOTE_PREFIX + ' — please re-check this document before filing.';

function sendBackToReview(db, docId, { suspects } = {}) {
  const run = db.transaction(() => {
    const r = documents.deconfirmDocument(db, docId);
    if (!r.changes) return { ok: false, error: 'not-confirmed' };

    const un = learning.retractConfirmHints(db, docId);

    // C4: latest-row-wins per field — value-preserving for legacy rows pre-dating the
    // confirm-time display sync, and NEVER re-poisoning from an older cycle's row.
    const latestRows = db.prepare(`
      SELECT c1.field_key AS field_key, c1.corrected_value AS corrected_value
      FROM corrections c1
      WHERE c1.document_id = @id
        AND c1.rowid = (SELECT MAX(c2.rowid) FROM corrections c2
                        WHERE c2.document_id = @id AND c2.field_key = c1.field_key)
    `).all({ id: docId });
    const sync = db.prepare(`
      UPDATE extractions SET display_value = @v, was_corrected = 1
      WHERE document_id = @id AND field_key = @f AND display_value <> @v`);
    for (const row of latestRows) {
      const v = row.corrected_value == null ? '' : String(row.corrected_value);
      if (v.trim()) sync.run({ id: docId, f: row.field_key, v });
    }
    const corrections_deleted =
      db.prepare('DELETE FROM corrections WHERE document_id = ?').run(docId).changes;

    // C5: every send-back is visibly suspect — at least one note, on a real row.
    const stamp = db.prepare(
      'UPDATE extractions SET validation_note = @n WHERE document_id = @id AND field_key = @f');
    const insertNoteRow = db.prepare(`
      INSERT INTO extractions
        (document_id, field_key, raw_value, display_value, confidence,
         extraction_method, was_corrected, validation_note, corrected_to, anchor_label)
      VALUES (@id, @f, NULL, '', 0, 'manual', 0, @n, NULL, NULL)`);
    let list = (Array.isArray(suspects) ? suspects : [])
      .map(s => ({
        field: s && s.field ? String(s.field) : null,
        note: String((s && s.note) || '').slice(0, 200).trim(),
      }));
    if (!list.length) list = [{ field: null, note: '' }];
    const flagged_fields = [];
    for (const s of list) {
      const field = s.field || 'supplier_name';   // doc-level suspects land on the identity row
      const note = s.field && s.note ? `${NOTE_PREFIX}: ${s.note}` : GENERIC_NOTE;
      if (!stamp.run({ n: note, id: docId, f: field }).changes) {
        insertNoteRow.run({ n: note, id: docId, f: field });   // C5: no row → create it so the flag COUNTS
      }
      flagged_fields.push(field);
    }

    return { ok: true, unplanted: { ...un, corrections_deleted, flagged_fields } };
  });
  return run();
}

module.exports = { sendBackToReview };
