'use strict';
// MACHINE_VIAS — the ONE sentinel set of machine `documents.confirmed_via` values (machine-feed
// arc, gary design → Oracle SIGN-OFF-W/COND 2026-08-13). Three modules used to carry their own
// inline copies and ONE HAD ALREADY DRIFTED (templates.js filtered 2 of 5 — Oracle C1), which is
// exactly the failure this module exists to prevent. When a SIXTH machine via is minted, add it
// HERE and every consumer moves together:
//   • trust.js scopeTrust — the human graduation window excludes these (a machine file must
//     never fill a human W-slot);
//   • learning.js getFieldFormats — when `learning_exclude_machine_confirms` is armed, these
//     rows leave value_counts/sample_values (the route must not manufacture the evidence it
//     consumes — the T3 principle; the Quillstone lexicon poison);
//   • templates.js learnTemplateOnCommit — machine confirms never drive template learning.
// The set is FIVE values, not four — 'auto_corroborated' is a machine file too (Oracle 2026-08-11
// C2). test_machine_confirm_learning.js pins that all three consumers reference this module.
const MACHINE_VIAS = Object.freeze([
  'scope_sweep', 'auto_corroborated', 'auto_reprocess', 'auto_graduated', 'auto_threshold',
]);

// The set as a ready-to-embed SQL list: `'scope_sweep', 'auto_corroborated', …` — values are
// code-owned literals (never user input), so direct embedding is safe.
const MACHINE_VIAS_SQL = MACHINE_VIAS.map(v => `'${v}'`).join(', ');

const MACHINE_VIAS_SET = new Set(MACHINE_VIAS);

// ── LEARNING EXCLUSION (Learning Repair "start fresh", gary design → Oracle SIGN-OFF-W/COND
// 2026-08-26). A confirmed document stamped `documents.learning_excluded_at` (mig 90) stays FILED
// and SEARCHABLE but STOPS TEACHING: every learning-feeding reader of `status='confirmed'` rows
// appends this fragment, so a forgotten sender×type is genuinely cold on its next import without
// un-filing anything (the previous "Forget learning" cleared tables while the live-derived model —
// getFieldFormats / scopeTrust / getDominantSupplier — kept counting the same docs: a HALF-forget).
// This is a HARD predicate — distinct in KIND from the machine-via SOFT post-filter above and from
// the `learning_retracted_at` restore MARKER (repairService) — housed here so ONE source-contract
// test (test_learning_excluded_readers.js) enumerates both sentinel families.
//
// `alias` = the documents table alias in the caller's query ('d' almost everywhere). The fragment
// is EMPTY (byte-identical SQL) when the column is absent (pre-mig-90 fixtures) or the switch is
// off. Kill: env LEARNING_EXCLUDE_DOCS=0 (harness arms) or setting learning_exclude_docs='false' —
// which RE-ADMITS stamped docs to learning; it does NOT undo a forget (the learning rows are gone).
// Readers that must NOT carry it (pinned as a NEGATIVE list): search, dashboard/workflow counters,
// the purge/rename WRITERS (they act on everything), the recycle bin.
const _colCache = new WeakMap();
function _hasLearningExcludedColumn(db) {
  if (!db) return false;
  let v = _colCache.get(db);
  if (v === undefined) {
    try { v = db.prepare("SELECT 1 FROM pragma_table_info('documents') WHERE name = 'learning_excluded_at'").get() != null; }
    catch { v = false; }
    _colCache.set(db, v);
  }
  return v;
}
function learningExcludeEnabled(db) {
  const env = process.env.LEARNING_EXCLUDE_DOCS;
  if (env === '0') return false;
  if (env === '1') return true;
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'learning_exclude_docs'").get();
    return !(row && String(row.value) === 'false');
  } catch { return true; }
}
/** SQL fragment (leading ` AND …`) that drops learning-excluded documents from a learning reader. */
function learningExcludedSql(db, alias = 'd') {
  if (!_hasLearningExcludedColumn(db) || !learningExcludeEnabled(db)) return '';
  const a = alias ? `${alias}.` : '';
  return ` AND ${a}learning_excluded_at IS NULL`;
}

module.exports = { MACHINE_VIAS, MACHINE_VIAS_SQL, MACHINE_VIAS_SET,
                   learningExcludedSql, learningExcludeEnabled, _hasLearningExcludedColumn };
