'use strict';
/**
 * database/dark_switches.js — the ONE list of DARK switches a TEST build may force ON.
 *
 * Plain Node module (no better-sqlite3) so the prebuild gate (scripts/check-release-migrations.js)
 * and its pin can require it without the Electron ABI, and database/index.js can require it for the
 * customer-build reset (mig 137) + the runtime test-build arming.
 *
 * Contract (docs/designs/AUDIT_FIX_PLAN_2026-09-08.md §2, Oracle C2):
 *   - Every key here is DARK by contract: its seed migration writes 'false' and the engine default is
 *     OFF. A customer install must never see one of these 'true' unless the operator (SFDEV) chose it.
 *   - A key that graduates to a real default LEAVES this list in the same commit as its promotion
 *     migration (the runtime disarm UPSERTs every listed key 'false' on a release build — a promoted
 *     key still listed here would be silently un-promoted on the first release launch).
 *   - NEVER a numbered force-ON migration for these again: a new DARK key is ADDED here and armed by
 *     the runtime test-build road. The gate refuses any UPSERT/UPDATE-to-'true' of a listed key.
 *
 * Excluded on purpose:
 *   - money_sign_capture — a legitimate fresh-install default (ALL_ON_DEFAULTS_93); mig 123 only force-ONed
 *     it because the owner's old DB pre-dated that list.
 *   - ocr_parallel_import_enabled — promoted to a customer default by mig 139 (its sole writer).
 */
const TEST_SWITCH_KEYS = Object.freeze([
  // mig 106 (2026-09-03)
  'format_variance_relax',
  'template_fragment_containment_yield',
  'template_locate_role_qualifier',
  // ⚑ FLIP GATE (no seed migration — mig 106 was its only writer): the corroborated straighten auto-file's census
  //   was MET 2026-09-01 on the owner's DB, but DO NOT FLIP without a COLD census (M=7 there was poisoned GT) — owner's call.
  'deskew_corrob_autofile',
  'quick_reprocess_enabled',
  // ⚑ FLIP GATE (no seed migration — mig 106 was its only writer): the owner-run watch-separation SOAK,
  //   docs/designs/WATCH_SEPARATE_SOAK_GATE_2026-09-02.md + stress_test/watch_separate_soak.js → PASS.
  'watch_separate_enabled',
  // migs 108-118 (2026-09-03/04) — the reference-flag family
  'format_variance_relax_ref',
  'format_variance_relax_ref_inline',
  'filing_sanity_ref_corrob_soften',
  'resolve_ref_near_miss',
  'resolve_ref_positional',
  'filing_sanity_ref_history_soften',
  // mig 123 (2026-09-06 log-review arcs)
  'anchor_bare_label_fuzzy',
  'anchor_labelless_currency_refuse',
  'type_uninstalled_heading_fold',
  // mig 124 (2026-09-04 arcs)
  'confusion_precedence',
  'format_class_join',
  // mig 126
  'buyer_issued_convention_one_confirm',
  // mig 134 (2026-09-07 afternoon)
  'teach_angle_compose_null_abstain',
  'reread_hold_corrob_release',
  'template_date_left_clip_grow',
  'template_pad_date_containment_flag',
  'template_clip_commit_left_slack',
  // mig 136 (2026-09-07 evening, class G)
  'inline_disagree_corrob_soften',
  // mig 140 (2026-09-08) — the NAME-GROW BELTS (docs/designs/KEYWORD_SUPERSTRING_GROW_2026-09-08.md §6): the in-band
  // row pick on the grown re-read, the proven-cut defer-cap for names, the zero-OCR keyword-superstring note.
  // ⚑ FLIP GATE: arms OFF / mapper / mapper+note on the post-137 reference copy (ref/date md5-identical, would-file
  //   delta only REMOVES, census entered>0 with doc 14 as the positive control) + customer_name accuracy via
  //   teach_run_ab / score_teach_run ≥ today; Oracle before any flip.
  'template_name_grow_band_pick',
  'template_name_cut_defer_cap',
  'keyword_superstring_name_note',
]);

/** The numbered TEST-BUILD force-ON migrations (historical; each is deleted by the mig-137 slice). */
const TEST_BUILD_MIGS = Object.freeze([106, 108, 110, 112, 114, 116, 118, 123, 124, 126, 128, 134, 136]);

module.exports = { TEST_SWITCH_KEYS, TEST_BUILD_MIGS };
