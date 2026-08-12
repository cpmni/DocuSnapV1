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

module.exports = { MACHINE_VIAS, MACHINE_VIAS_SQL, MACHINE_VIAS_SET };
