'use strict';
// src/lib/intakeGuard.js — the ONE source for the Quick File write-side refusal (Oracle Q-C2, 2026-09-15).
//
// A Quick-Filed document is an ordinary CONFIRMED `documents` row carrying intake='direct': it was
// TYPED, never scanned or read, so it must never enter Review, the OCR pipeline, or the write-side
// learning path (reviewService.confirm). Each door that would drag a confirmed row back into that
// graph calls guard() and REFUSES with a plain, recovery-naming sentence — fail-toward-refusal, the
// deliberately-inverted safe state for a typed row (a queue entry would be the unsafe one).
//
// This is the user-facing sentence. The STRUCTURAL backstop is the belt clause in
// documents.deconfirmDocument / requeueConfirmedDocsForScope, so even a future caller that forgets
// this guard cannot un-confirm a typed row. Data-driven on the existing `intake` column (mig 165) —
// no migration, byte-identical on any DB with no typed rows.

const { _hasIntakeColumn } = require('../../database/modules/machine_vias');

const MESSAGES = {
  'send-back': "This is a Quick Filed document — it was typed, not scanned, so it can’t be sent to Review. To change its details, delete it and Quick File it again.",
  'reprocess': "Quick Filed documents aren’t scanned, so there’s nothing to re-read. To scan the file instead, delete this entry and import it through Scan Documents.",
  'confirm':   "This is a Quick Filed document — it was typed, not scanned, so it doesn’t go through Review. To change its details, delete it and Quick File it again.",
};

// True only for a row that exists AND carries intake='direct'. Column-tolerant: a pre-mig-165 DB
// (no intake column) returns false, so every real-doc path is unchanged.
function isDirectIntake(db, docId) {
  if (!db || !docId || !_hasIntakeColumn(db)) return false;
  try {
    const row = db.prepare('SELECT intake FROM documents WHERE id = ?').get(docId);
    return !!(row && row.intake === 'direct');
  } catch { return false; }
}

// The refusal object every door returns: { ok:false, error, message }. `verb` picks the sentence.
function refuse(verb) {
  return { ok: false, error: 'quick_file_not_reviewable', message: MESSAGES[verb] || MESSAGES.confirm };
}

// null → the door may proceed; a refusal object → the door MUST stop and surface `.message`.
function guard(db, docId, verb) {
  return isDirectIntake(db, docId) ? refuse(verb) : null;
}

module.exports = { isDirectIntake, refuse, guard, MESSAGES };
