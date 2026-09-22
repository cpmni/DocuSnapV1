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
 *     (mig-137 'false' → 175), taught_ref_disagree_suppress (186→191) — DARK seeds that GRADUATED via a labelled
 *     @DEFAULT_FLIP migration and left this list in that same commit.
 */
const TEST_SWITCH_KEYS = Object.freeze([
  // mig 106 (2026-09-03)
  'format_variance_relax',
  'template_fragment_containment_yield',
  'template_locate_role_qualifier',
  // ⚑ FLIP GATE (no seed migration — mig 106 was its only writer): the corroborated straighten auto-file's census
  //   was MET 2026-09-01 on the owner's DB, but DO NOT FLIP without a COLD census (M=7 there was poisoned GT) — owner's call.
  'deskew_corrob_autofile',
  // quick_reprocess_enabled (mig 104) — GRADUATED to a customer default by mig 203 (2026-09-22, owner go): the
  //   Reprocess-All dialog OFFERS the imageless Quick option (opt-in per batch). Vet: both unit pins green
  //   (cache invalidators + the C1 contested-keep — Quick can never file what Full would hold, fail-safe).
  //   DELISTED here in the same commit. Pinned by database/test_default_flip_203.js.
  // watch_separate_enabled — GRADUATED to a customer default by mig 175 (2026-09-16: the soak gate of
  //   docs/designs/WATCH_SEPARATE_SOAK_GATE_2026-09-02.md was RUN in a sandbox — analyzer PASS, real bundle 34/34,
  //   0 over-split, every segment held; TESTING/_measure/watch_separate_soak_20260916/) and DELISTED here the
  //   same commit.
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
  // reread_hold_corrob_release (mig 130) — GRADUATED to a customer default by mig 190 (2026-09-19, flip census
  // batch 2: byte-identical/M=0 on the corpus; low-risk — a re-read that corroborates releases its own hold) and
  // DELISTED here.
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
  // ⚑ NAMED FLIP PRECONDITION (2026-09-12, Oracle C10 of mig 162): the whole-doc straighten retry's
  //   "Read differently after straightening — … — confirm once." note on an OPTIONAL non-strict field is
  //   text-blind SOFT to trust.isSoftAdvisory → this arc ON would dissolve a straightening-CHANGED value (a
  //   design violation: a soft note never reflects a changed value). `_flaggedSoftAware` must treat any
  //   `_isLaneHoldNote` row as never-soft BEFORE this key flips. pendingfeatures.md 2026-09-12 entry.
  'optional_soft_flag_autofile',
  // template_pad_date_adopt (mig 143) — GRADUATED to a customer default by mig 174 (2026-09-16, 700-corpus census
  // M=0 + the one adopt == GT, twice) and DELISTED here the same commit. Its build notes live on the mig-143 block
  // in database/index.js.
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
  // trust_ref_role_shape (mig 154) — GRADUATED to a customer default by mig 187 (2026-09-19, flip census @ HEAD
  // mig 186: M=0, byte-identical on the 400-doc corpus; live value = the 20 held Thornbury invoices) and DELISTED
  // here the same commit. Build notes live on the mig-154 block in database/index.js.
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
  // name_role_nonname_flag (mig 156) — GRADUATED to a customer default by mig 172 (2026-09-16, 700-corpus census
  // M=0 + 5 fires + 1 file→hold, twice) and DELISTED here the same commit. Its build notes live on the mig-156
  // block in database/index.js.
  // template_drift_override_guard (mig 157) — GRADUATED to a customer default by mig 188 (2026-09-19, flip census
  // @ HEAD mig 186: M=0; sends 2/400 credit-notes to review with a "verify the total balances" note — ref+date
  // still correct, fail-toward-review; live value = the CH1 2HU customer_name postcode-drift root fix, #243) and
  // DELISTED here the same commit. Build notes live on the mig-157 block in database/index.js.
  // note_topic_dedup (mig 158, 2026-09-10 night, gary → Oracle SIGN-OFF-W/COND): a ref field accumulated a WALL
  // of overlapping "check the O/0 confusable ref" notes — the engine self-limits to one note/run, but the JS
  // merge sites (handler.js LANE-HOLD SURVIVAL :1664 + rereadHolds.js S3-C5 :135) blind-append across reprocess
  // runs. When ON, `composeNote` collapses two SAME-ref-recheck-topic notes to the higher-rank one (the lane-hold
  // survives → the hold survives); every other note pair + the ABSENT mark fall through to the current concat.
  // trust.js keys on note PRESENCE + method sentinels (never text) → auto-file byte-identical. Byte-identical OFF.
  // note_topic_dedup (mig 158) — GRADUATED to a customer default by mig 189 (2026-09-19, flip census batch 2:
  // byte-identical/M=0 on the corpus; low-risk — collapses stacked same-topic ref notes into one) and DELISTED here.
  // ref_confusable_flag (mig 159) — GRADUATED to a customer default by mig 173 (2026-09-16, 700-corpus census
  // M=0 + 6 fires + 2 file→hold, twice) and DELISTED here the same commit. Its build notes live on the mig-159
  // block in database/index.js + docs/designs/REF_CONFUSABLE_FLAG_2026-09-11.md.
  // filing_sanity_ref_reinstate (mig 160, 2026-09-11, 007+reggie+gary → Oracle SIGN-OFF-W/COND B1-B5;
  // Ridgeway VS-72672 vs page WS-73673): the ref arbiter protects a Stage-0.5 located winner by AUTHORITY,
  // so a wrong OFF-PAGE value (a clipped taught crop) commits and Gate C only FLAGS it while the correct
  // on-page keyword read sits discarded in the ledger. When ON, reinstate that candidate REVIEW-BOUND
  // (cap ≤69 + truthful note, no corrections row) — keyed on Gate C's ABSENT mark, guarded by dominant
  // confirmed prefix + exact learned shape + whole-token on-page + exactly-one + not-another-field's-value.
  // HARD dep filing_value_sanity_flags ON. Byte-identical OFF. docs/designs/REF_ARBITER_REINSTATE_2026-09-11.md.
  'filing_sanity_ref_reinstate',
  // template_code_left_grow (mig 161, 2026-09-11, 007+gary → Oracle SIGN-OFF-W/COND B1-C7; Ridgeway
  // WS-73673 crop clip). ARC A — the UPSTREAM crop fix: a shape-VALID taught code read that is PAGE-ABSENT
  // is a bounds-clip (the frozen box left edge severed the leading glyph on a wider page → VS-72672). A
  // row-bounded wider re-read certified by PLACEMENT (_snap_union_witness fed INDEPENDENT full-page words,
  // NOT the pad self-box) + Gate-C raw-surface page tests recovers the on-page value. Phase 1 REVIEW-BOUND
  // (adopt value + cap ≤87 + note; never auto-files — Phase 2 auto-file is a separate census-gated arc that
  // requires an independent family, per Oracle C5). Composes with Arc B (mig 160): A upstream → value
  // on-page → Gate C passes → B never fires. Byte-identical OFF. docs/designs/CODE_LEFT_GROW_2026-09-11.md.
  'template_code_left_grow',
  // anchor_code_left_grow (mig 192) — GRADUATED to a customer default by mig 193 (2026-09-21, owner go): the
  // Stage-2 taught-crop crosscheck re-reads a clipped ref box with the mig-161 left-slack recovery and, on
  // INDEPENDENT convergence with the full-page read, commits the correct value CLEAN (kills the needless "please
  // verify" click + lets it auto-file at its own conf; non-convergence still flips+flags = fail-toward-review).
  // DELISTED from here so build_arming never disarms it in a release build (it's now ON by default). Gate met:
  // safety census M=0 + no accuracy drop (RR_APP_ENV=1, mig-186/191 on both arms) AND the efficacy injection FIRES
  // on a real clipped raster + the adversarial minority-form doc ABSTAINS (test_anchor_code_left_grow_efficacy.py).
  // deskew_retry_field_adopt (mig 162, 2026-09-12, gary → Oracle SIGN-OFF-W/COND C1-C11; Ridgeway #358 1.7° skew):
  // the review-bound straighten retry's DOOR keys on the engine `_needs_review` (FALSE for a role-note-only hold)
  // and its WHOLE-DOC adopt refuses when a confident garble @95 inflates raw overall over the correct review-bound
  // rescue. When ON: the door also opens on a noted, non-authoritative ref/date ROLE field (never supplier-only),
  // and a FIELD-SCOPED keyword-corroborated, same-identity, shape-consistent adopt runs when the whole-doc gate
  // refuses — always held (role note; lane-hold appended over a machine-clearable note; no put-back of a page-
  // absent raw value; overall = min(raw, straightened)). Whole-doc population byte-identical ON vs OFF. CHILD of
  // deskew_review_retry_enabled. HARD dep (exhibit class): template_taught_corrob_adopt (mig 153) +
  // template_pad_window_code ON — flip 153 before/with 162. Byte-identical OFF.
  // ⚑ FLIP GATE (C11): 605 corpus REQUIRED + Demo 369; cells {162 OFF/ON} × {153 OFF/ON} + DESKEW_CORROB_AUTOFILE
  //   cell; M=0 AND wouldFile(ON)==wouldFile(OFF) set-equality in EVERY cell; fires partitioned by door (note|flag),
  //   adjudicated AT THE PIXELS; door census (supplier-only passes = 0); live #358 → WS-73673 @82 held; zero fires
  //   ⇒ STAYS DARK. Runner: TESTING/_measure/deskew_field_adopt_20260912/run_gate.sh.
  'deskew_retry_field_adopt',
  // deskew_false_absent_reflag (mig 163, 2026-09-12, gary → Oracle: SEND BACK the note-DROP/auto-file "release"
  // leg, SIGN OFF WITH CONDITIONS on this HOLD leg; the 6 Saltmarsh delivery-note class, mirror of the #358 skew).
  // Phase 1: when the straighten retry reads the SAME value for a role field Gate C falsely marked page-ABSENT
  // (the whole-page text pass garbled the token on the skewed raster; the crop read it right and the page PRINTS
  // it) and the straightened frame keyword-corroborates it, REPLACE the false absent note with a truthful
  // review-bound "— confirm once." hold. Removes NO checkpoint (still held; a role note is never soft → mig 142
  // cannot dissolve it → it closes the mig-162 S2 side-door for free). CHILD of deskew_review_retry_enabled.
  // Byte-identical OFF. Census (3/6 reflag correct; #145 refused by F2; 0 wrong): TESTING/_measure/deskew_hold_release_20260912/CENSUS.md.
  // ⚑ The RELEASE (note-DROP → auto-file) leg is SEND BACK — before it may be built even DARK: H1 (this hold leg
  //   shipped + measured), C-Q2 required-field cross-raster value-parity (else a confident wrong DATE rides st's
  //   clean overall → silent misfile), C-Q6 skip-if-mig-162-adopted (overall-stomp), C-Q3 length-distribution
  //   census + a length-blind adversarial that refuses, H3-H5 S_AUTO≥10 across ≥2 SUPPLIERS + 0-misfile GT census.
  //   Full conditions: docs/oracle_log.md + pendingfeatures.md + docs/designs/DESKEW_FALSE_ABSENT_REFLAG_2026-09-12.md.
  // ⚑ FLIP GATE (this hold leg): wouldFile(ON)==wouldFile(OFF) set-equality (removes NO filer — any delta is a bug);
  //   the truthful note out of every CLEARABLE_NOTE_MARKS / class-F set (bilingual pin); the doc still flagged/held.
  'deskew_false_absent_reflag',
  // ── QuickFile + Departments (2026-09-13, plan docs/designs/QUICKFILE_AND_DEPARTMENTS_PLAN_2026-09-12.md;
  //    Oracle SIGN-OFF-W/COND Q-C1..12 + D-C1..12). FEATURE MASTER switches (not reading toggles): they gate
  //    the admin UI + the WRITE side only. The read/exclusion behaviour is DATA-driven and fail-closed (a
  //    department-tagged doc is restricted, a documents.intake='direct' row is learning-excluded, regardless
  //    of the switch). Seeded OFF by migs 164/165; byte-identical when the tables/columns are empty.
  //    NOTE: direct_intake_enabled GRADUATED to default-ON (mig 171 @DEFAULT_FLIP, 2026-09-15, Chris-vetted) —
  //    DELISTED from here so build_arming never disarms it in a release build. departments_enabled stays DARK.
  'departments_enabled',
  // template_date_invalid_yield_lowconf (mig 166, 2026-09-13, gary → Oracle pass): an IMPOSSIBLE taught
  // date (parse+salvage both None) yields to a valid label-matched keyword date even below the 90 floor
  // (seeded custom date fields structurally read 85). impossible arm only; kw leg only; auto-file-neutral
  // (always held+noted). ⚑ FLIP GATE: realdoc M=0 + set-equal wouldFile + zero date-accuracy drop + Oracle.
  'template_date_invalid_yield_lowconf',
  // date_forms_wide (mig 167, 2026-09-14; reggie design → Oracle): the MONTH-NAME date family accepts any single
  // separator (, . / \ - or none — OCR-glued), an ordinal on the day, a trailing dot on the month, "Sept", and a
  // 2-digit year, in the engine (validator.parse_date) and in the crop credibility gate (config `date_wide`).
  // Numeric dates NOT widened (the month name is the guard against "3.5.2" / "1,234.56"). The desktop CONFIRM
  // door (filing/handler.js normaliseDate) + the teach/review readers take the same forms UNSWITCHED (a human's
  // typed/taught value — no auto-file decision there). Byte-identical OFF. ⚑ FLIP GATE: realdoc M=0 +
  // wouldFile set-equality + the VAL_CENSUS_DIR crop/keyword census OFF vs ON (every new acceptance a real date).
  'date_forms_wide',
  // segment_continuation_veto (mig 177, 2026-09-16, Oracle (B) slice 1) GRADUATED 2026-09-17 via mig 181 @DEFAULT_FLIP
  // (owner go; gate C8 green: 0/14 repeat-letterhead controls cut, stacks/real_34 lost 0, e2e truncation 0) — DELISTED;
  // pinned by database/test_default_flip_177.js. The setting stays the kill (`--continuation-veto` rides argv).
  // segment_title_slug (mig 178, 2026-09-16, gary → Oracle (A) C1-C7) GRADUATED 2026-09-17 via mig 182 @DEFAULT_FLIP (owner
  // go; gate green: stacks 72 → 79/95 lost 0, extended controls over-splits ≤ base, real_34 34/34, e2e truncation 0, the
  // logo-only/name-line p2 delta 0) — DELISTED; pinned by database/test_default_flip_178_179.js. Argv-only switch (`--title-slug`).
  // segment_known_supplier_change (mig 179, 2026-09-17, gary → Oracle C1-C9) GRADUATED 2026-09-17 via mig 183 @DEFAULT_FLIP
  // (owner go; gate green: stacks 79 → 91/95 lost 0 over-splits 0, controls1-5 0 new over-splits, real_34 39/39, the owner's
  // PDFs 0 unexplained deltas, e2e +0 truncations) — DELISTED; pinned by database/test_default_flip_178_179.js. Argv-only
  // switch (`--known-suppliers-file X --known-supplier-change`).
  // mig 180 (2026-09-17; gary → Oracle SIGN-OFF-W/COND C1-C12): the S4 silent-truncation belt — a WEAK (letterhead-only)
  // 1-page cut whose two halves read as ONE document (same supplier, no date on the later page, the same/no number)
  // holds BOTH halves with a durable "— confirm once." note; a complete later page releases the earlier one. The pre-pass
  // `weak_pages` class is unconditional metadata; this key gates the JS consumer only. ⚑ FLIP GATE (Oracle C9 + C12):
  // real_34 rasterised 0 held · a young-install stack's inconclusive count · the email-arm-only class arm · every sibling
  // false cut held under 178+179+belt · AND a one-click recovery action ("Re-import as one document" / Rejoin) shipped.
  'segment_pair_hold',
  // ref_badge_verify_state (mig 185, 2026-09-18, gary → Oracle SIGN-OFF-W/COND C1-C6; Chris 2026-09-18 #1):
  // the Review confidence badge is a pure function of the READ confidence — a confident single-glyph misread
  // of a REFERENCE (PO-69837→PO-69637 @93) wears a reassuring green "High" while the field the FILENAME is
  // built from was never cross-checked. When ON, the ref role's badge shows a calm neutral "Read · N%"
  // (never green, never the amber "Check") whenever the value read confidently (conf≥70) but was NOT
  // corroborated (≥2 independent page families), NOT authoritative (manual/template_fixed/keyword_override),
  // and its supplier+type scope has NO well-supported confirmed history (≥3 confirmed docs). PRESENTATION
  // ONLY — no value, note, gate or auto-file change (byte-identical OFF; the doc still HELD on the same
  // fields as today). The `verified` boolean is computed in MAIN via trust.refBadgeVerified (ONE predicate,
  // shares _corrobLicensed with the corroborated-auto-file licence — pinned) and passed to the renderer; the
  // renderer does NO shape logic (Oracle C1/C3). history = a SCOPE property (confirmed_count≥3), never the
  // value's shape (C2/C3) — so a matured scope stays green even on a self-consistent misread (the honest
  // boundary, C5: this stops OVER-claiming, it does not reduce misreads — that residual is the D2 witness
  // layer). ref role ONLY; DATE is the known untested sibling, deferred to its own census (C4).
  // ⚑ FLIP GATE (Oracle C-gate; M=0 trivial — presentation-only; the REAL gate is a BADGE census over the
  //   605 corpus + Demo Docs): (1) PIN the exhibit renders "Read" not green; (2) INVERSE PIN a corroborated
  //   ref stays green; (3) SCOPE PIN a non-ref field @93 unverified STILL "High"; (4) ZERO green→"Read" flips
  //   on ANY history-supported/graduated scope (incl. label-above layouts) = the alarm-fatigue proof; (5)
  //   every cold-slice flip genuinely single-witness/no-history; (6) PARITY the ONE trust.js predicate (C1).
  //   docs/designs/REF_BADGE_VERIFY_2026-09-18.md.
  'ref_badge_verify_state',
  // issuer_undetected_blank (mig 195, 2026-09-21, reggie+gary → Oracle SIGN-OFF-W/COND): when the resolved
  // Document Issuer is a NON-NAME value read COLD off the page (a bare keyword read, no template/logo/hint/teach,
  // not operator-accepted) it is declared UNDETECTED — the field + the filing/scope key blank + a review note —
  // instead of committing a garbage heading (e.g. a warranty sentence caption-matched to "Supplier:"). Fixes the
  // spurious-heading class at SOURCE. Predicate = keyword.issuer_read_looks_implausible, a pinned TWIN of the JS
  // issuerReadLooksImplausible (single-token BP/IBM/3M immunity + a non-Latin carve-out on BOTH sides). Method
  // allow-list is fail-safe (unknown method never blanks). Byte-identical OFF; env ISSUER_UNDETECTED_BLANK.
  // ⚑ FLIP GATE (Oracle C4/C5): realdoc M=0 + zero supplier_name accuracy drop AND report the fire DENOMINATOR;
  //   a MULTI-TOKEN synthetic FP set (all-lowercase real names like "acme joinery" must NOT blank — the single-
  //   token brand hunt is near-vacuous); efficacy proven by the synthetic disclaimer unit test (the corpus can't
  //   reach a disclaimer-manual layout). docs/designs — pendingfeatures.md 2026-09-20 "Undetected issuer".
  'issuer_undetected_blank',
  // ref_confusable_history_disarm (mig 201) — GRADUATED to a customer default by mig 202 (2026-09-22, owner go):
  //   the S/5-type ref nag disarms on the sender's confirmed HEAD convention (length-agnostic), with the
  //   required rival-head poison guard; 700-corpus safety census byte-identical (M=0), 7 targeted pins incl. the
  //   poison guard. DELISTED here in the same commit (the release gate forbids a TEST_SWITCH_KEY becoming a
  //   default in place). Pinned by database/test_default_flip_202.js. HARD dep ref_confusable_flag ON.

  // taught_ref_disagree_suppress — GRADUATED to a customer default by mig 191 (2026-09-20: live-proven on the
  //   owner's VM — the Castellan "Service Worksheet" batch, 4/4 filed on confirm instead of holding forever; corpus
  //   census M=0, TESTING/_measure/flip_census_20260919/RESULT.md) and DELISTED here in that same commit. See
  //   docs/designs/TAUGHT_REF_DISAGREE_SUPPRESS_2026-09-19.md.
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
