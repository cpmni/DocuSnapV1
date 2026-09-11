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
  // mig 141 (2026-09-09) — READ-WIDEN: a taught code/ref box clips the leading glyph on any docket WIDER
  // than the teach sample (007 page-width-variance root cause); a shape-invalid tight read is replaced by a
  // shape-valid wider row-bounded re-read. ⚑ FLIP GATE: OFF/ON on arm137 + 605 corpus (M=0, wouldFile(ON)⊇
  // wouldFile(OFF) + new filers' value==GT, fire census on the docket corpus) → Oracle. Advisors 007 + gary.
  'template_code_read_widen',
  // mig 142 (2026-09-09) — OPTIONAL SOFT-FLAG AUTO-FILE: a wordness/format-variance note on an OPTIONAL
  // non-role non-strict field stops BLOCKING auto-file on a GRADUATED scope (value + note stay; only the hold
  // lifts). Role/required/strict fields + a pending corrected_to still block. ⚑ FLIP GATE: OFF/ON on
  // arm137 + 605 — M=0 on ROLE values, wouldFile(ON)⊇wouldFile(OFF), new filers' ROLE fields==GT, census that
  // each new filer's ONLY prior blocker was a soft optional note → Oracle. Advisor: gary.
  'optional_soft_flag_autofile',
  // template_pad_date_adopt (mig 143, 2026-09-09 Q4): the ADOPT twin of template_pad_date_containment_flag —
  // a taught date box clipping the leading digit is read wide; when the pad value is corroborated by a second
  // page family (keyword/crop) + page-present + the tight read is the uncorroborated outlier, SWAP to it
  // (conf>=90, flag cleared, mapping-bucketed) so the corroborated correct date auto-files instead of holding.
  // HARD dependency: template_pad_window_read ON. ⚑ FLIP GATE: unit adopt + pinned trade-offs + realdoc M=0 +
  // fire census (every adopt==GT, no new wrong file) → Oracle. Advisor: gary + reggie (date polarity).
  'template_pad_date_adopt',
  // type_split_teach_scope_suppress (mig 144, 2026-09-09 Q1, herald): the type-split ask is a confirmed-COUNT
  // predicate that treats a wizard-TAUGHT type as unsupported until its 2nd doc, so it re-asks "file as X?" on
  // a type the human already taught. When ON, checkTypeSplit stands down iff a teach-origin template exists for
  // (supplier, type). Still asks for a cold never-taught type. Read-only, NOT in the auto-file path. ⚑ FLIP
  // GATE: taught->silent / cold->asks / mixed-unchanged pins + realdoc wouldAsk(ON)⊆wouldAsk(OFF) → Oracle.
  'type_split_teach_scope_suppress',
  // corrob_autofile_band88 (mig 145, 2026-09-09 Q3, gary): widens the EXISTING corroboration auto-file route
  // down to the 88 critical-field floor so a clean, every-role >=2-family-corroborated doc auto-files in the
  // 88-95 band. Requires corroboration_autofile ON. Inert on a single-family @93 (honest limit). ⚑ FLIP GATE:
  // reach census + realdoc M=0 + wouldFile(ON)⊇wouldFile(OFF) role==GT + both-ON with mig 142 → Oracle.
  'corrob_autofile_band88',
  // NOTE: filing_sanity_confusable_soften (mig 147) GRADUATED to a customer default on 2026-09-09 (census PASS:
  // 1 real case reclassified, 0 wouldFile change, 0 corpus false-positives) — flipped ON by @DEFAULT_FLIP mig
  // 148, so it LEFT this list (the release gate forbids a TEST_SWITCH_KEY becoming a default in place).
  // filing_sanity_confusable_prefix_autofile (mig 149, 2026-09-09 Oracle SIGN-OFF-W/COND): the AUTO-FILE half of
  // the confusable case — when confirmed PREFIX history resolves a one-glyph digit/letter confusable in the ref
  // prefix, Gate-C suppresses the note so the field auto-files. NOT auto-file-neutral. C2 mirror guard
  // (any_confirmed_shares_head, counter==0) + fail-safe. HARD dep: filing_sanity_confusable_soften ON. ⚑ FLIP
  // GATE: 605 + a constructed graduated scope, arc-inert vs arc-live decomposition, adversarial mirror set, M=0.
  'filing_sanity_confusable_prefix_autofile',
  // sweep_inview_recheck (mig 150, 2026-09-09): re-offer the in-view auto-file countdown (sweep_inview_countdown)
  // when the view SETTLES on an eligible held doc — the sweep's mid-load offer is dropped by the presence race
  // (queue auto-advanced before currentDoc settled), leaving a ready doc with no countdown (owner: WS-95132).
  // READ-ONLY recheck (files nothing; the countdown's expiry re-verifies). HARD dep sweep_inview_countdown ON.
  // ⚑ FLIP GATE: it offers on ANY eligible held doc on view — weigh that cadence (Stop + cancel-on-edit guard it).
  'sweep_inview_recheck',
  // template_edge_clip_heal (mig 151, 2026-09-10, 007 + Oracle C1-C7): the taught-box edge-clip class — a
  // skewed sibling's composed axis-aligned box severs ONE edge glyph, committing a HIGH-confidence same-
  // length shape-valid garble (YN-#####↔DN-#####) that edge-cut/widen/pad-code all miss. When ON a committed
  // taught CODE/ref (+ optional non-issuer name) is re-read row-bounded + certified by PLACEMENT
  // (_snap_union_witness un-cut-edge anchor + slot-fill, NOT OCR conf): clean clip-containment ADOPTS @87
  // (<88 floor); garbled-both-sides / healed ISSUER FLAGS (≤70 + note); uncertified byte-identical. Dates
  // excluded (mig-143 owns them). HARD dep template_pad_window_code ON. ⚑ FLIP GATE: 88-floor relax needs
  // _corrobLicensedKeyword scoped to the _edgeclipheal family + realdoc M=0 + fire census + adversarial
  // neighbour set → Oracle. docs/designs/EDGE_CLIP_HEAL_2026-09-10.md.
  'template_edge_clip_heal',
  // role_disagree_refuse_at100 (mig 152, 2026-09-10, DATE_LEFT_CLIP_M2 recommended fix, Oracle C6/C7): the
  // M=2 SILENT wrong-date auto-file (Copperfield sales_order #77/#78) — a leading-digit date clip emits
  // overall==100 despite a 94 role + NO note, riding the gate-free 100% path (the role-disagreement leg only
  // runs sub-100). When ON, isAutoFileEligible runs the trust_role_disagreement_refuse page-family leg at
  // overall==100 too (roleDisagreeOnly), NOT the over-blocking full at100 gate. Fail-toward-review; the
  // correct value is in the corroboration record. HARD dep trust_role_disagreement_refuse ON. ⚑ FLIP GATE:
  // unit + realdoc wouldFile(ON)⊆wouldFile(OFF) + M=0 → Oracle. docs/designs/DATE_LEFT_CLIP_M2_2026-09-09.md.
  'role_disagree_refuse_at100',
  // template_taught_corrob_adopt (mig 153, 2026-09-10, gary+007 → Oracle C1-C4): the two-ended-garble class the
  // edge-clip heal FLAGS but can't adopt — a Stage-0.5 taught winner that raised a _padcodeflag whose pad
  // recovery is corroborated by the INDEPENDENT keyword page-text family (+ a positional guard) ADOPTS the
  // recovered value. NOT a two-crop common-mode adopt (keyword required, Oracle C5-equivalent). PHASE 1 =
  // review-bound (cap 87 + softened note, no auto-file); PHASE 2 (@90 auto-file) is census-gated. HARD dep
  // template_pad_window_code ON. ⚑ FLIP GATE: neighbour-bleed positional guard + adversarial neighbour census
  // (must NOT adopt) + realdoc M=0 → Oracle. docs/designs/TAUGHT_CORROB_ADOPT_2026-09-10.md.
  'template_taught_corrob_adopt',
  // trust_ref_role_shape (mig 154, 2026-09-10, reggie+gary → Oracle SIGN-OFF-W/COND): verify a REFERENCE
  // role (ref_field_key) by the SHAPE of its confirmed samples (classifyRefShape), not 'constant' set-
  // membership — a ref number is high-cardinality by nature, so a ≤2-distinct (duplicate-confirmed) history
  // classified 'constant' else refuses every genuinely-new value (`unverifiable-value:invoice_number`; 20
  // clean Thornbury invoices held live). Ref role ONLY (company key keeps identity membership, date role
  // returns at the 'date' STRICT arm). Mixed ref history → 'freetext' → Review. Byte-identical OFF. ⚑ FLIP
  // GATE: unit pins + realdoc M=0 AND new would-file ref == GT + live-DB re-judge of the 20 held → Oracle.
  'trust_ref_role_shape',
  // anchor_axis_lock (mig 155, 2026-09-10, 007+reggie+gary → Oracle SIGN-OFF-W/COND): the FREE-TEXT twin of
  // template_code_read_widen. A below/above/right taught anchor stores the value box CENTRE, so a wider teach
  // sample (Brightwater Dental Practice, 27ch) pins the read-box right of a narrower value (Halcyon Leisure
  // Group, 21ch). When ON, an ADDITIVE review-bound candidate `anchor_axis_locked` reconstructs the value LEFT
  // edge from the LOCATED label column (width-invariant, reusing the _label_left_limit formula), grows to the
  // column-gap, and competes ONLY where no authoritative read won (precedence via _override_eligible). Kept OUT
  // of the corroboration ledger; always-note + ≤87 cap (review-assist, never a silent auto-file). C1: its note
  // is a NON-SOFT kind excluded from optional_soft_flag_autofile's soft-clear (else mig-142 dissolves the
  // checkpoint). Byte-identical OFF. ⚑ FLIP GATE: pins + fire-census on a real docket corpus (zero fires ⇒ stay
  // DARK) + the both-ON mig-142 pins + realdoc M=0 → Oracle. docs/designs/ANCHOR_AXIS_LOCK_2026-09-10.md.
  'anchor_axis_lock',
  // name_role_nonname_flag (mig 156, 2026-09-10, reggie+gary → Oracle SIGN-OFF-W/COND): a NAME-ROLE field
  // (customer_name/supplier_name) whose WHOLE value is a deterministic non-name shape — a bare UK postcode
  // (CH1 2HU), email, GB VAT or IBAN — is a wrong-type read (a template_mapping zone drifted onto the
  // postcode line of a multi-line customer block). Flag+hold: keep the value, stamp a note + `+nonname_flag`
  // method sentinel, cap ≤69, route to review. The sentinel makes the note NON-SOFT so mig-142 can't dissolve
  // it on the optional customer_name (isNonNameFlagRow, trust.js). Exempts human methods + accepted_names /
  // dominant-confirmed (a supplier's legitimate recurring value never stalls its batch). Deterministic subset
  // ONLY — a word-like wrong line still needs the parked below-relocate placement arc. Byte-identical OFF.
  // ⚑ FLIP GATE: predicate pins (postcode/email/vat/iban flag; real names incl. postcode-containing don't) +
  // the both-ON mig-142 pin + accepted_names batch-stall pin + realdoc M=0 + the live Vellum doc → Oracle.
  'name_role_nonname_flag',
  // template_drift_override_guard (mig 157, 2026-09-10, 007 → Oracle SIGN-OFF-W/COND C1): the Stage-0.5 drift
  // guard DISCARDS a credible absolute read and relocates off the located label — but _locate_anchor's fuzzy
  // fallback can match a cross-word stranger (address line "Chester" scores 0.667 vs "Customer") ~2.5 lines
  // below the taught anchor → a PHANTOM drift onto the postcode line (Vellum & Crane customer_name = CH1 2HU,
  // the correct "Larch & Hollow Cafe Co" @95 thrown away). When ON, a drift-override that discards the absolute
  // read requires the taught label (exact/inline) OR match_score ≥ _DRIFT_OVERRIDE_MATCH_FLOOR (0.8, in the
  // measured 0.667/0.82 gap); a weak match falls through with anchor_stable=False so the registration arbiter
  // still catches a genuine drift (Oracle C1). Byte-identical OFF. ⚑ FLIP GATE: unit pins incl. the seam pin
  // (weak match + real page transform → arbiter still fires) + census the floor + realdoc M=0 + live #243.
  'template_drift_override_guard',
  // note_topic_dedup (mig 158, 2026-09-10 night, gary → Oracle SIGN-OFF-W/COND): a ref field accumulated a WALL
  // of overlapping "check the O/0 confusable ref" notes — the engine self-limits to one note/run, but the JS
  // merge sites (handler.js LANE-HOLD SURVIVAL :1664 + rereadHolds.js S3-C5 :135) blind-append across reprocess
  // runs. When ON, `composeNote` collapses two SAME-ref-recheck-topic notes to the higher-rank one (the lane-hold
  // survives → the hold survives); every other note pair + the ABSENT mark fall through to the current concat.
  // trust.js keys on note PRESENCE + method sentinels (never text) → auto-file byte-identical. Byte-identical OFF.
  // ⚑ FLIP GATE: unit pins (lane-hold survives both ways; absent+advisory both kept; different-topic not merged;
  // OFF concat-identical; mark-sync) + realdoc M=0 + the auto-file set-equality corpus gate (ON==OFF).
  'note_topic_dedup',
  // ref_confusable_flag (mig 159, 2026-09-11, reggie+gary → Oracle; Chris Card 1): a REF-role value with a
  // letter/digit OCR confusable that is a class-outlier in its token (a digit-0 read where a letter-O belongs —
  // "SO"→"S0" on a scan) is a VALID shape with no history, so no format/soften/near-miss arc catches it and it
  // auto-files a wrong FILENAME silently. When ON, a 5th content-nature ref-flag caps ≤69 + sets a validation_note
  // (held via the ref-role note — no trust.js change), FLAG-ONLY (never auto-corrects; SO vs S0 is unknowable
  // without history). No-history FALLBACK (skips when a history arc already spoke); glyph-attestation disarm so a
  // repeat supplier's legitimate glyph never batch-stalls; born-digital skipped (a text-layer 0 is real). Byte-
  // identical OFF. docs/designs/REF_CONFUSABLE_FLAG_2026-09-11.md.
  'ref_confusable_flag',
]);

/** The numbered TEST-BUILD force-ON migrations (historical; each is deleted by the mig-137 slice). */
const TEST_BUILD_MIGS = Object.freeze([106, 108, 110, 112, 114, 116, 118, 123, 124, 126, 128, 134, 136]);

module.exports = { TEST_SWITCH_KEYS, TEST_BUILD_MIGS };
