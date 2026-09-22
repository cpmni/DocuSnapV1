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
 *   - filing_sanity_confusable_soften (147→148), direct_intake_enabled (165→171), name_role_nonname_flag
 *     (156→172), ref_confusable_flag (159→173), template_pad_date_adopt (143→174), watch_separate_enabled
 *     (mig-137 'false' → 175), taught_ref_disagree_suppress (186→191), ref_confusable_history_disarm (201→202),
 *     quick_reprocess_enabled (104→203) — DARK seeds that GRADUATED via a labelled @DEFAULT_FLIP migration and
 *     left this list in that same commit.
 *   - THE 205 BATCH (2026-09-22) — 34 fail-toward-review keys graduated together (see the array note below).
 */
const TEST_SWITCH_KEYS = Object.freeze([
  // ─────────────────────────────────────────────────────────────────────────────────────────────────────
  // BATCH GRADUATION (mig 205, 2026-09-22, owner go: "flip any that are deemed safe or currently inert … the
  // software is only with test clients … they can report any issues"): 34 fail-toward-review DARK switches
  // became customer defaults and LEFT this list in that same commit. Every one RECOVERS-into-review / FLAGS /
  // HOLDS-MORE / softens on EVIDENCE (corroboration or confirmed history) / is presentation-only / refuses /
  // abstains — so NONE can cause a NEW *silent* wrong file (worst case: a doc HELD for review, which a test
  // customer SEES and reports). All 34 were a subset of the 37-key HEAL union censused M=0 on the 605 corpus
  // at RR_APP_ENV=1 (TESTING/_measure/flip_census_20260921/). The flipped keys were:
  //   format_variance_relax, template_fragment_containment_yield, template_locate_role_qualifier,
  //   format_variance_relax_ref, format_variance_relax_ref_inline, filing_sanity_ref_corrob_soften,
  //   resolve_ref_near_miss, resolve_ref_positional, filing_sanity_ref_history_soften, anchor_bare_label_fuzzy,
  //   anchor_labelless_currency_refuse, type_uninstalled_heading_fold, teach_angle_compose_null_abstain,
  //   template_date_left_clip_grow, template_pad_date_containment_flag, template_clip_commit_left_slack,
  //   inline_disagree_corrob_soften, template_name_grow_band_pick, template_name_cut_defer_cap,
  //   keyword_superstring_name_note, template_code_read_widen, type_split_teach_scope_suppress,
  //   sweep_inview_recheck, template_edge_clip_heal, role_disagree_refuse_at100, template_taught_corrob_adopt,
  //   anchor_axis_lock, filing_sanity_ref_reinstate, template_code_left_grow, deskew_retry_field_adopt,
  //   deskew_false_absent_reflag, template_date_invalid_yield_lowconf, date_forms_wide, ref_badge_verify_state.
  // Their per-key build + FLIP-GATE notes live on their seed-migration blocks in database/index.js and in git
  // history; pinned by database/test_default_flip_205_batch.js.
  // ─────────────────────────────────────────────────────────────────────────────────────────────────────
  // WHAT REMAINS DARK — held out of the 205 batch because a mistake here is an INVISIBLE misfile a test
  // customer cannot report, or the arc needs its own gate first.

  // ── AUTO-FILE LOOSENERS — a wrong lift is a silent wrong file, not a visible hold. ──
  // ⚑ deskew_corrob_autofile (mig 106, its only writer): the corroborated straighten auto-file. Census MET
  //   2026-09-01 on the owner's DB but M=7 there was poisoned GT → needs a COLD census. Owner's call.
  'deskew_corrob_autofile',
  // optional_soft_flag_autofile (mig 142): a wordness/format-variance note on an OPTIONAL non-role non-strict
  //   field stops BLOCKING auto-file on a GRADUATED scope (value + note stay; only the hold lifts). Role/
  //   required/strict fields + a pending corrected_to still block. ⚑ NAMED PRECONDITION (Oracle C10 of mig
  //   162): the straighten retry's "Read differently after straightening — confirm once." note on an OPTIONAL
  //   non-strict field is text-blind SOFT → this arc ON would DISSOLVE a straightening-CHANGED value.
  //   `_flaggedSoftAware` must treat any `_isLaneHoldNote` row as never-soft BEFORE this flips. ⚑ FLIP GATE:
  //   OFF/ON on arm137 + 605 — M=0 on ROLE values, wouldFile(ON)⊇wouldFile(OFF), each new filer's only prior
  //   blocker a soft optional note → Oracle.
  'optional_soft_flag_autofile',
  // corrob_autofile_band88 (mig 145): widens the corroboration auto-file route down to the 88 critical-field
  //   floor so a clean, every-role ≥2-family-corroborated doc auto-files in the 88-95 band. Requires
  //   corroboration_autofile ON. ⚑ FLIP GATE: reach census + realdoc M=0 + wouldFile(ON)⊇wouldFile(OFF)
  //   role==GT + both-ON with mig 142 → Oracle.
  'corrob_autofile_band88',
  // filing_sanity_confusable_prefix_autofile (mig 149): the AUTO-FILE half of the confusable case — confirmed
  //   PREFIX history resolves a one-glyph confusable in the ref prefix, so Gate-C suppresses the note and the
  //   field auto-files. NOT auto-file-neutral. HARD dep filing_sanity_confusable_soften ON. ⚑ FLIP GATE: 605 +
  //   a constructed graduated scope, arc-inert vs arc-live decomposition, adversarial mirror set, M=0.
  'filing_sanity_confusable_prefix_autofile',

  // ── VALUE-CHANGERS with no corpus evidence — could change a value wrongly, then file it. ──
  // confusion_precedence (mig 119/124): mines the corrections table into per-scope OCR-confusion facts to
  //   correct a never-seen serial. REVIEW-BOUND on this install (5 correction rows), but HELD 2026-09-19 with
  //   zero corpus evidence. ⚑ FLIP GATE: the census + Oracle H1-H5 before ANY default.
  'confusion_precedence',
  // buyer_issued_convention_one_confirm (mig 126): one human answer writes a buyer_issued_convention record
  //   that licenses the batch — changes the filing scope from a single confirm. ⚑ FLIP GATE: graduation
  //   census + Oracle.
  'buyer_issued_convention_one_confirm',
  // format_class_join (mig 120/124): a MIXED-code scope keeps its whole format entry instead of losing it to
  //   classify_format's 3-newest unanimity rule. WIDER BLAST RADIUS (re-arms confirmed-literal arcs across a
  //   supplier). ⚑ FLIP GATE (Oracle C9): arms × join, M=0, the AUTO-FILE ELIGIBILITY DELTA, census vs the
  //   rendered page.
  'format_class_join',

  // ── FEATURE master switch — turns a customer-visible feature on, not a reading heuristic. ──
  // departments_enabled (mig 164): the admin UI + WRITE side of Departments. The read/exclusion behaviour is
  //   DATA-driven + fail-closed regardless of the switch (a tagged doc is restricted, a direct-intake row is
  //   learning-excluded). Seeded OFF; byte-identical when the join tables are empty. See FEATURE_MASTER_SWITCHES.
  'departments_enabled',

  // ── Needs its own gate before a default. ──
  // segment_pair_hold (mig 180): the S4 silent-truncation belt — a WEAK letterhead-only 1-page cut whose two
  //   halves read as ONE document holds BOTH with a "— confirm once." note; a complete later page releases the
  //   earlier one. Fail-toward-review in DIRECTION, but it is SEGMENTATION (a bug can over-hold or mis-split,
  //   which the 605 corpus can't exercise). ⚑ FLIP GATE (Oracle C9 + C12): real_34 rasterised 0 held, a young-
  //   install stack's inconclusive count, the email-arm-only class arm, every sibling false cut held under
  //   178+179+belt, AND the one-click "Re-import as one document" / Rejoin (mig-185 C12) verified LIVE.
  'segment_pair_hold',
  // issuer_undetected_blank (mig 195): a NON-NAME cold-read Document Issuer is declared UNDETECTED (field +
  //   scope key blank + review note) instead of committing a garbage heading. Fail-toward-review (a wrong blank
  //   is a HELD doc), but it BLANKS a value and the single-token brand hunt is near-vacuous. ⚑ FLIP GATE
  //   (Oracle C4/C5): realdoc M=0 + zero supplier_name accuracy drop + the fire DENOMINATOR + a MULTI-TOKEN
  //   synthetic FP set (all-lowercase real names like "acme joinery" must NOT blank). Not yet run.
  'issuer_undetected_blank',
  // glyph_fallback_enabled (mig 207, 2026-09-22, oscar+Oracle SIGN-OFF-W/COND re-rule on the live Print Tracker
  //   exhibit `1G25802868`): a second, architecturally-independent recognizer (PP-OCR rec via onnxruntime,
  //   ocr/glyph_reader.py) re-reads the ref-role crop; DISAGREEMENT with the committed Tesseract read HOLDS the doc
  //   for review with a neutral note (the p7 `RFH0738865` O→0 conf-76 silent-serial-misfile class no cheaper lever
  //   catches). Fail-toward-review (worst case a HELD doc a test customer SEES) — but it needs a NEW ~55MB
  //   dependency (onnxruntime + the vendored en rec model) AND its own census before a default. ⚑ FLIP GATE
  //   (Oracle 2026-09-22): 605+Demo+PrintTracker ON-vs-OFF, wouldFile(ON)⊆wouldFile(OFF) provable, catch-set>0
  //   incl. p7+p11, false-hold rate published, agree-but-wrong≈0 sampled, the C1 corrob pin (must fail on a naive
  //   design), determinism two-run byte-identical release-gated on vendor/python, trade-lock pins.
  'glyph_fallback_enabled',
  // ref_confusable_confirmed_literal_disarm (mig 204) was FLIPPED ON by default at mig 206 (2026-09-22, owner
  //   "flip mig 204"): census M=0 / inert on the 700 corpus (TESTING/_measure/ref_disarm_census_20260922/), owner
  //   accepted the narrow ≥2-confirm supplier-strict auto-file lift. No longer dark — delisted here.
]);

/** The numbered TEST-BUILD force-ON migrations (historical; each is deleted by the mig-137 slice). */
const TEST_BUILD_MIGS = Object.freeze([106, 108, 110, 112, 114, 116, 118, 123, 124, 126, 128, 134, 136]);

// ── FEATURE-MASTER switches (2026-09-20, gary → Oracle SIGN-OFF-W/COND) ────────────────────────────
// A key here is in TEST_SWITCH_KEYS (dark, seeded OFF, test-armable, release-disarmed) BUT is a FEATURE
// master switch that a shipping admin road DELIBERATELY writes 'true' at runtime — so, unlike a reading
// heuristic, it legitimately violates belt (vi)'s "never written 'true' by shipping code" contract. The
// release gate (scripts/check-release-migrations.js) waives belt (vi) for exactly one write of such a key,
// and ONLY when that write is in FEATURE_MASTER_SWITCH_WRITERS[key] AND its ±3-line window carries the
// inline sentinel `// @FEATURE_MASTER_WRITE <key>`. Both conditions AND-combined; any drift (sentinel gone
// or >3 lines away, file renamed, key delisted, a SECOND such write in the file) FIRES → the build refuses
// (fail-safe). The waiver is BUILD-TIME only — it never changes runtime; the write's real safety is its own
// admin/flip gate at the writer site (which belt vi cannot re-check — an ordinary code-review invariant).
//   ⚠ RELEASE-DISARM interaction (Oracle C4): departments_enabled stays in TEST_SWITCH_KEYS, so a DB that was
//   armed under a TEST build (arming marker present) and then opened on a hardened RELEASE build is force-
//   disarmed to 'false' on first release launch (all dark keys are). This resets an admin's ON choice OFF on
//   the owner's/test-customer's upgraded TEST DBs — NOT on a clean customer install (no marker → noop). SAFE
//   direction for a not-yet-GA dark feature; documented so it is not later chased as a bug. Escape hatch if it
//   ever bites in the field: delist departments_enabled (Option A).
const FEATURE_MASTER_SWITCHES = Object.freeze(new Set(['departments_enabled']));
const FEATURE_MASTER_SWITCH_WRITERS = Object.freeze({
  departments_enabled: 'src/modules/settings/handler.js',
});

module.exports = { TEST_SWITCH_KEYS, TEST_BUILD_MIGS, FEATURE_MASTER_SWITCHES, FEATURE_MASTER_SWITCH_WRITERS };
