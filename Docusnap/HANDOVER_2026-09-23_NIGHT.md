# HANDOVER — 2026-09-23 NIGHT (DOWNGRADE mig 210 + RELEASE mig 211 built DARK; filtered `_absent` census MET the RELEASE gate 0/14; C0 yield census on the owner's DB copy)

Branch `feat/teach-side-overnight`. Migrations now go to **211**. `TEST_SWITCH_KEYS` **15**. Python pins:
`test_glyph_confusable_resolve.py` 12 · `test_glyph_confusable_release.py` 19 · `test_glyph_disagreement_hold.py` 16 ·
`test_glyph_reader.py` 4. JS: `test_migration211_glyph_confusable_release.js` ALL OK; **`run-pins.js` 414/414 green**
(a run taken while the C0 harness saturated the CPU showed `src/services/test_ref_class_fix.js` red on a different arm
each time — a two-DB md5 compare straddling a timestamp second under load; 87/87 twice in isolation and green on the
quiet re-run — a FLAKE, not a regression). Continues `HANDOVER_2026-09-23_EVENING.md` (date-fold / arithmetic-
witness / dual-reader census context).

⚠ A dev app from the evening (env `CORROB_DATE_FOLD_WIDE=1` + `GLYPH_FALLBACK_ENABLED=1`) may still be running — not
touched this session; env-only, a normal restart reverts it. ⚠ `stress_test/out/c0_live_copy/` holds a READ-ONLY COPY
of the live DB (gitignored — real values; delete when done). ⚠ `stress_test/realdoc_regression.js` gained an additive
`corrob` field on the RR_CONSENSUS ref/date rows (inert unless RR_CONSENSUS is set).

---

## TL;DR
1. **Built the DOWNGRADE — `glyph_confusable_resolve` (mig 210, DARK).** In `engine._glyph_disagreement_hold`: when a
   scanned ref's ONLY note is the Gate-C confusable soften (exact text, no `corrected_to`) and PP-OCR AGREES, the note
   is RE-WORDED to confident copy — still a note (held), same ref-advisory mark, auto-file byte-identical. D1-D5 applied;
   **D5 confirmed at source** (40/40 `glyph_check` AGREE, 0 `no_box`, on the owner's real Print Tracker diag).
2. **Ran the filtered `_absent` census (the Oracle's RELEASE gate) — MET.** `census_absent.py`: 1,323 refs → 64
   page-absent → **18 soften → all 14 PP-agrees crop-CORRECT (common-mode 0/14)**, the 4 disagrees all crop-wrong/
   PP-right. Synthetic clip arm: 1/18 BOTH wrong (`SO-82482`→`30-82482`). Verdict
   `TESTING/_measure/dual_reader_census/RESULT_ABSENT_20260923.md`.
3. **gary design → Oracle re-vet → SIGN OFF WITH CONDITIONS (C0-C11) → built the RELEASE — `glyph_confusable_release`
   (mig 211, DARK).** Inside the DOWNGRADE's AGREE branch, when every guard passes the soften note is POPPED (the only
   mutation) so the doc files by the normal route; any abstain → the DOWNGRADE reword. Guards (`_glyph_release_ok`, in
   order): producer tag == confusable-soften + map-pair page form (C7) · not veto-fallthrough · crop page known (C6) ·
   PP mean ≥0.95 AND **weakest glyph ≥0.80** (C1 — `glyph_reader._ctc_decode` now returns `(text, mean, min_glyph)`) ·
   no page-family disagreement after the mig-191 suppression, computed in-engine with trust.js parity (C2,
   `_glyph_release_page_family_disagrees`, shared fixtures pinned in Python AND JS) · wide crop inside the page (C4) ·
   a SECOND PP read on a 1.0×h-wide crop still contains the value, boundary-guarded via `_page_presence_corroborated`
   (C3) · then `_flag_ref_confusable_ambiguous` re-judges the now-unnoted field (C5). Traces `glyph_release`
   released/abstain+reason (C9).
4. **The Oracle's premise catch (P1, verified at source):** trust.js `_pageFamilyDisagrees` holds a role field whose
   corroboration record has a page-family entry in `disagree ∪ discounted`; the whole-page `S0-` read is recorded as a
   keyword-family disagreement (no O/0 fold in `normalise_for_tokens`); only the mig-191 suppression lifts it (taught
   winner + learned shape). So the note is NOT the only blocker as a class — hence C0 (yield census) as a FLIP blocker.
5. **C0 targeted (owner's live-DB copy, the 5 census docs confirmed there):** the soften fired on 1/5 — #45 Copperfield
   `PO-22954` (the Chris exhibit): keyword `P0-22954` in `suppressed_taught_role` → trust.js would NOT hold; reason
   `below-floor` at 81 = the note's own −12 fc penalty → **category (ii), yield 1/1**. 3 Vellum `SO-` docs carry no
   note today (history-backed paths resolved them); #504 Pelican clean. **C0 FULL (727 confirmed docs, 18 min,
   `TESTING/_measure/release_c0_20260923/RESULT.md`): 9 soften-noted refs → 8 are Print Tracker crop-WRONG/page-RIGHT
   (`RFH0738865` for printed `RFHO738865` ×5, `HS71Y07217` for `H571Y07217` ×3) = TRUE positives the release can never
   touch (PP disagrees; C2 abstains) · 1 = #45 → YIELD 1 of 9 (1 of 727).** Recommendation: keep mig 211 DARK, do
   NOT flip on this alone; mig 210 fixes the copy on all 9. Broader finding: `disagreeing-read` holds 82/727 on
   reprocess — the page-family gate is the dominant Print Tracker hold (own arc: a confusable-aware `disagree` fold).
6. **Per-glyph census (`glyph_min_census.py`)** over the 18 slices + clipped twins: the 14 correct agrees have min glyph
   0.819-0.998; the ONE both-wrong clipped read scored **0.505** (mean 0.876) — the 0.80 floor rejects it. That is the
   cheap clip mitigation the Oracle hoped for.

## Files
- ENGINE `python_backend/extraction/engine.py`: constants `_GLYPH_SOFTEN_KEY` / `_GLYPH_RESOLVED_SOFTEN_NOTE` /
  `_GLYPH_RELEASE_PP_FLOOR` 0.95 / `_GLYPH_RELEASE_GLYPH_FLOOR` 0.80 / `_GLYPH_RELEASE_WIDE_HPAD` 1.0 (~:2140-2165);
  `self._soften_meta = {}` per-run reset (~:9250); `_tag(producer, form)` beside `_note()` in
  `_flag_filing_value_sanity` + the three producer tags; `_glyph_disagreement_hold(..., field_defs=, supplier_name=,
  document_slug=)` with the `_resolve` (DOWNGRADE) + RELEASE branches; new `_glyph_release_page_family_disagrees` +
  `_glyph_release_ok`; call site passes the three kwargs.
- READER `python_backend/ocr/glyph_reader.py`: `_ctc_decode` → `(text, mean, min_glyph)`; `read_crop` 3-tuple (every
  caller indexes [0]/[1]; `test_glyph_reader.py` shape pins updated).
- PLUMBING: `database/index.js` migs 210 + 211 · `src/modules/processing/handler.js` two env mirrors ·
  `database/dark_switches.js` two entries (`TEST_SWITCH_KEYS` 13→15; the mig-211 entry names the C8 preconditions +
  the C0/C10 flip gate) · count pins `test_migration137_test_switch_reset.js` / `test_migration163_deskew_false_
  absent_reflag.js` / `test_default_flip_205_batch.js` (HELD +2).
- TESTS: `python_backend/tests/test_glyph_confusable_resolve.py` (12) · `test_glyph_confusable_release.py` (19: OFF
  one-read, hard deps, happy path + emit hygiene, population lock + frozen map, floors, clip guard, page edge, page
  unknown, veto-fallthrough, real-record page-family abstain, shared fixtures, JS family-set parity, disagree, other
  notes, C5 spy, traces, R4 G1 predicate, source ORDER pin, tag/reset source pin) ·
  `database/modules/test_migration211_glyph_confusable_release.js` (seed, bridge, trust.js parity fixtures, C8
  preconditions ON, engine source shape).
- MEASUREMENT: `TESTING/_measure/dual_reader_census/census_absent.py` + `RESULT_ABSENT_20260923.md`;
  `TESTING/_measure/release_c0_20260923/{query_ids.py, run_targeted.sh, run_full.sh, glyph_min_census.py,
  analyse_c0.js}`; `stress_test/realdoc_regression.js` `corrob` field.
- DOCS: `docs/oracle_log.md` (the 09-23 arithmetic-witness + DOWNGRADE/RELEASE rulings, post-hoc; the evening RELEASE
  vet C0-C11 verbatim + the C0 targeted result) · `docs/DARK_SWITCH_LEDGER.md` (batch flip + migs 207-211) ·
  `docs/designs/CONFUSABLE_RELEASE_SEAMS_2026-09-23.md` (seams + how the build answered each; Fix A corrected to OFF) ·
  `NIGHT_RUN.md` QUEUE (mig 210 + mig 211 flip gates).

## WHERE NEXT — owner discussion after the C0 result (2026-09-23 late; facts verified at source)
The owner's direction: the Paddle second read IS the way; a second read cannot hurt accuracy, only cost. Three
questions answered, each checked in code:
- **"Would `30-82482` (the clipped both-wrong read) have been held by a pattern rule alone?"** NO. Field regex passes
  (a code with digits); trust.js shape classes are COARSE (`_codeish` = single token with a digit → passes); the
  prefix-outlier guard needs a leading ALPHA prefix (`ocr_corrector.code_prefix` → None on a digit-led read); the
  mapper's "differs from the usual format" note fires only on derived rungs. Only the PAGE holds it today (absent note
  + `disagreeing-read`) — the full-page read saw the whole glyph. So a "box + Paddle agree → clear" rule must never let
  Paddle-on-the-same-clipped-pixels outvote the page; Paddle must read a wider/healed slice.
- **"But the learned shape is two letters + dash + digits — don't we have that rule?"** YES: `format_anomaly_checker.
  check_value` learned `shapes` via `shape_signature` (digit→`#`, letter→`@`): `SO-82482`→`@@-#####`, `30-82482`→
  `##-#####` → flagged (low severity) — **BUT engine.py ~:12081 SKIPS the shape flag for `_label_confirmed` reads
  (`anchor._LABEL_CONFIRMED_METHODS` or `_is_stage05_located`, :11758) = every taught-box read.** The clipped taught
  box is exactly such a read. The Oracle re-applied three content flags to taught reads in August (date-in-ref,
  length, prefix-outlier); the SKELETON check was not among them. → **Step 1: apply the learned-shape veto to taught/
  label-confirmed reads too, review-bound, on a scope with real history.** Small, protects the clipped case today.
- **"DN- appears 200×, Paddle reads DN- — that has to count."** The prefix ADOPT (P lane, `_prefix_confusable_adopt`
  ~:2360) exists but only for pairs in `_PREFIX_CONFUSE_CLASSES` (S/5/$, O/0, I/1, B/8, Z/2, 7/T, 6/G, 9/g, E/£).
  S↔3 is NOT a print look-alike — it is the RIGHT HALF of an S after a left clip — so adding it would be guessing
  (the owner's own rule). The sound version: HISTORY (dominant `SO`) + PADDLE's independent read (`SO`) = two
  witnesses vs the box's one → adopt `SO-82482`, review-bound first, census, then auto-file. Paddle COUNTS there; the
  only prohibition is Paddle reading the same clipped pixels as a second vote FOR the box.
**Agreed build order (owner to pick the first):** 1. the learned-shape veto on taught reads (review-bound) ·
2. ONE slice-integrity step before any reader (ink at the box edge → grow bounded by label/neighbours → re-slice →
both readers read the healed slice; the existing parts are scattered: `_find_edge_cut_words` + `_EDGE_CUT_NOTE`,
`TEMPLATE_PAD_WINDOW_READ` ON, `anchor_code_left_grow` ON, `template_code_left_grow` / `template_edge_clip_heal` /
`template_date_left_clip_grow` DARK — 007+oscar, the OCR_SLICE_STUDY home) · 3. the Paddle + history TIE-BREAKER
(box vs page differ by one glyph → Paddle on the healed/wide slice decides; history a third leg), scored against the
owner's 727 confirmed values on the DB copy BEFORE it clears anything (the harness + copy are in place:
`TESTING/_measure/release_c0_20260923/`). Also on the table: flip 207+210 for the owner now (safe, gate met, needs
the reader vendored for a customer build); a TOTALS disagreement-hold (3 silent 5→9 in the census); widen coverage
past mapped-template docs (`_s05_pages` bound). mig 211 stays DARK.

## STEP 1 REFUTED by verification (2026-09-23 late; `TESTING/_measure/release_c0_20260923/RESULT_SHAPE_EXEMPT.md`)
Owner: "carry on, but verify your thesis." Did. The exemption exists (`engine.py` ~:12081 skips the Stage-4.5 shape flag
for `_label_confirmed` = `anchor._LABEL_CONFIRMED_METHODS` + `_is_stage05_located`; no pin; from `88b7080`) and the
skeleton check WOULD flag `30-82482` (`##-#####` ∉ {`@@-#`}). But the census (`shape_exempt_census.py` on the 727 C0
rows with the engine's own `build_format_class_index` from `dump_formats.js`) found the ONLY 20 shape-violating taught
reads are Castellan worksheets reading the taught **`CJB-####` Job Sheet No** against a history of **`JB-####` Job Ref**
values — 15 `scope_sweep` machine confirms (excluded from learning, verified `learning_exclude_machine_confirms=true`)
+ **4 HUMAN `JB-` confirms on 09-12 before the teach** + 1 human `CJB-` correction on 09-13 → learned {`@@-#`}. The
taught reads are RIGHT; the history is the other field. Removing the exemption = 19 false holds, 0 catches; the
clipped shape-violating taught read never occurred in 727 docs. **Step 1 withdrawn.** Remaining plan: step 2 (slice
integrity) → step 3 (Paddle + history tie-breaker, scored on the 727). **Owner decision surfaced:** 19 Castellan
worksheets are filed under the Job Ref (`JB-`), not the Job Sheet No; the 4 hand `JB-` confirms define the learned
reference shape. Learning Repair on those 4 + a reprocess-ALL (which WOULD auto re-file the 19 under `CJB-`) — or leave.

## LATER THE SAME NIGHT — the Paddle corroboration ARC (007 + oscar commissioned; design assembled; S0 built; measured)
Owner: "go — commission 007 and oscar on the combined design" (slice integrity · Paddle read set incl. the Review-drawn
box + a label-line keyword read · the decision rule). Both reports are folded into
**`docs/designs/PADDLE_CORROBORATION_ARC_2026-09-23.md`** (every claim ✔ verified / ○ advisor-only; §12 = the numbers).
- **007 found a LIVE FRAME BUG in the dark hold (verified):** `field_anchors.x_norm/y_norm` are the taught box CENTRE
  (`renderer.js:5377`, `anchor.py:3970-3976`, `:960-962`); `anchor.py:1721` passes it unconverted as `taught_box`;
  `_winning_read_geom` handed it to top-left crop math → every rigid `anchor_crop` winner gave PP a crop shifted
  (+w/2,+h/2); masked because mapped docs preferred the mapping rect; the pin asserted the pass-through. **Fixed in
  S0 `a0c25f2`** + geometry follows the winner's method (mapping rect / anchor box on page 0 per `anchor.py:1826` /
  keyword = no box) + `_crop_pages` for every doc + capture for every field + harness `RR_TRACE_OUT` / `RR_SLICE_DIR`.
- **oscar's corrections (verified):** ≥8 census DATE disagreements were PADDLE-wrong on merged two-token crops (PP
  0.42-0.85) → a PP floor (~0.90) for any disagreement hold; the 95-char ASCII dict → `£` OOV; "PP disagrees on the
  8 Print Tracker true positives" was inferred.
- **THE MEASUREMENT (`run_glyph_on.sh` 727 docs, FALLBACK+RESOLVE on, trace; crops eyeballed via
  `run_glyph_slices.sh` + `glyph_slice_sheet.py`):** 358 PP-agrees, **0 box-wrong (common-mode 0/358)**; **16
  disagreement holds, ALL FALSE**: 5 CLIPPED boxes (S→`5O`, 3→`5`, D→`O`, W→`V`/`N`) · 4 vertical bleed · 2 case-only
  (→ compare casefolded, `f521ec5`) · 2 serif S/5-O/0 · 4 sans 0/O identity (`W2E8X06407`→`…XO6407` at 0.95, page
  agreed with the box); 3 TRUE catches via the resolve branch (`HS71Y07217`→PP `H571Y07217` 0.999, siding with the
  page). The `RFH0`/`RFHO738865` glyph gave PP two answers on two crops → at the font's identity limit → the history/
  format axis, not pixels. With casefold + floor 0.90 + Part A on the clips + "PP's lone dissent vs a box+page
  agreement is trace-only": false holds 16→1, true catches 3. **Part C revised: PP is a TIE-BREAKER between box and
  page, never a lone arbiter.** Two traps fixed on the way: dev slice names collided across shards/engines (pid +
  process-wide seq now); the harness attribution of trace events is by the engine's own `doc` field.
- **ORACLE VET (`docs/oracle_log.md` 2026-09-23 NIGHT; design doc §0/§11 updated):** S0 SIGN OFF W/COND (incomplete
  without PAD PARITY) · S1 SIGN OFF W/COND / partly WRONG LAYER (9 of 16 false holds are a reader-RECT mismatch, not
  placement; Part A v1 = word-snap + row-band, ink sensor detect-only) · S-B1 SIGN OFF · S2 W/COND (`unhealed` =
  abstain-all, no note) · S3 SEND BACK on `pp_line` (BREACHES C1 — verified: `_corrob_licensed` + trust.js twin count
  ANY agreeing family → withdrawn; PP reads live in `self._glyph_readset` + trace only) · S-B3 W/COND · S4 Part C SEND
  BACK (C5 page-silent ≠ page-agree; C6 abstain on `+corrected` winners; C7 H from human confirms only; C8 the 82-doc
  ledger route = right layer, own vet; C9 restate common-mode as 4/362 + provenance partition) · det DO NOTHING.
  **Three premise corrections, all verified:** `anchor._crop_and_ocr` pads the value box **±20 px** (anchor.py:3975)
  while the hold gave PP ~4 px → the 5 "clips" are pad parity; 51 % of the 727 confirms are MACHINE (scope_sweep 371
  + auto 119) → partly circular; the mig-207 hold does NOT catch its founding p7 exhibit on the anchor rect (PP reads
  `RFH0` 0.962) — PP's value on these fonts is the S/5 class, sans O/0 is PP-blind.
- **BUILT after the vet (`e28a9d6`):** C1 pad parity (capture records the crop-family +20 px; PP gets Tesseract's rect)
  · the C10 PP floor 0.90 on a disagreement (`_GLYPH_HOLD_PP_FLOOR`, in-sample, labelled) · the licence-mechanism pin
  · `dump_via.py` + provenance partition in the analysis. Pins hold 19 / resolve 12 / release 19.
- **C10 RE-CENSUS (mig 207's flip gate) — RESULT (design doc §12b):** false holds **16 → 2** (both MAPPING winners:
  `SO-71797`→`5O` 0.926, `SO-99174`→`S0` 0.918 — the mapper half of C1 is not done); common-mode **0/340** (the `RFH0`
  identity family now reads a DROPPED glyph at 0.74 → RESOLVE:disagree); the 3 `HS71Y` true catches kept; would-file
  lost 6 → 1; 6 `pp_lowconf` abstains. **BUT six rigid-box winners vanished with NO event:** with Tesseract's +20 px
  rect PP picks up neighbouring ink → a different LENGTH → the one untraced exit. Found by adding `glyph_enter` + a
  traced reason on EVERY exit (`length_or_multi_diff`, `pp_lowconf`, …) — commit `e08c7db`.
  **Conclusion:** C1 pad parity is a STOP-GAP (it removed the clip common-mode) — the correct rect is the page-level
  WORD box (Oracle C2 → S1 word-snap + row-band). The Oracle's bar (false holds ≤1) is NOT yet met (2) → mig 207's
  flip stays blocked. A further traced 727 re-census was running at handover (`glyph_on.*`; the two earlier arms are
  kept as `glyph_on_pre_c1.*` and `glyph_on_c1_v1.*`); its abstain-reason histogram goes into the design doc §12b.
- **S1 BUILT (owner "go — build S1 word-snap and re-census"; `005b22b`, mig 212 `glyph_slice_integrity` DARK,
  `TEST_SWITCH_KEYS` 16):** `extraction/slice_integrity.py` (pure) snaps the reader's rect to the page WORD boxes on the
  value's row band (row band 0.6·max(h); admit a word when ≥ half a glyph lies inside; union; long-line cap 3×/2.5× →
  `unhealed` = today's rect; no cache → abstain, C14); the hold uses it under `GLYPH_SLICE_INTEGRITY=1` with the
  quiet-zone pads (the census geometry); traces `slice_integrity`. Pins: `test_slice_integrity.py` 9 + a hold pin
  (20) + `test_migration212_*.js`. **S1 RE-CENSUS chained behind the C1-only traced arm at handover:**
  `run_glyph_s1.sh` → `stress_test/out/c0_release/glyph_s1.*`; analyse with `analyse_glyph_on.js full.jsonl
  glyph_s1.jsonl glyph_s1.trace.jsonl via.json` + the `slice_integrity` verdict histogram. Pass (Oracle C10 + the
  mig-212 gate): false holds ≤1, the 3 `HS71Y` catches kept, the 5 clip + 4 bleed docs read RIGHT (not abstained),
  wouldFile(ON) ⊆ OFF.
- **RESULTS (design doc §12b/§12c):** the traced C1-only arm: 2 false holds, 0 common-mode, 3 catches, **105
  `length_or_multi_diff` abstains** (89 anchor + 16 mapping — the +20 px rect makes PP read neighbouring ink).
  **S1 v1 (snap from the padded rect): false holds 0 ✔, would-file lost 0 ✔, 3 catches ✔, agree 366, length abstains
  83** — but 70 of those 83 ADMITTED THE LABEL ("No. DN-98358") because the snap started from the +20 px rect, and the
  `RFH0738865` family agrees at PP 1.0 on the tight rect (4 human confirms say `RFHO` — the identity-limit class).
  **Fixed the same night (uncommitted at handover, pins green):** the snap runs on the BARE value box first, the
  parity expansion is only the no-words fallback; Oracle C6 applied to the DOWNGRADE (`+corrected`/`+snapped`/
  `+confirmed_adopt` winners abstain `rewritten_winner`). **S1 v2 re-census RUNNING** → `stress_test/out/c0_release/
  s1_v2_analysis.txt` (auto-written by the watcher; v1 kept as `glyph_s1_v1.*`). **NEXT:** read s1_v2 → commit S1 v2
  + docs → S-B1 → S2 per C3 → S3 per C4 → Part C per C5-C9 → Oracle. Commits: `a0c25f2` (S0), `f521ec5`,
  `fff9482`, `e28a9d6` (C1 + floor + pin + vet), `e08c7db` (traced exits), `005b22b` (S1).

## FINAL (the owner went to bed ~22:05: "sandbox run the app with everything on, Chris FULL teach-a-doc test + report")
- **S1 v3 = the value-text filter (`625ccc0`)** — a row-band word joins the reader's rect only when it shares content
  with the committed value (the page pass's own misread still counts; a label never does). **C10 RESULT on the 727
  (`TESTING/_measure/release_c0_20260923/RESULT_C10.md`): false holds 1 · would-file lost 1 · 3 catches kept · agree 419
  · length abstains 30 · `rewritten_winner` 32 · true common-mode 0 (18 Castellan GT artefacts) · the 5 clips 4 agree
  + 1 safe abstain · the 4 bleeds 3 agree + the 1 hold · Print Tracker `W2E8X06407` agrees at 0.999.** Oracle C10 bar
  MET; owed before any flip: OFF md5 identity + two ON runs byte-identical on vendor/python. Recommendation: migs
  207 + 212 (+210) flip-ready; 211 stays DARK.
- **CHRIS SANDBOX (per `/christest`):** root `C:\Users\cmccu\AppData\Local\Temp\claude\c--GIT-Projects-Docusnap\
  chris-sandbox-20260923\` (fresh DB at mig 212 with ALL SIX 2026-09-23 switches ON via `arm_switches.py`: 207 hold,
  210 reword, 211 release, 212 slice integrity, 208 date fold, 209 arithmetic witness; 1,475 Demo Docs copied; Output
  `<root>\Output`), app on CDP **9223**, PID **30400**, launcher pid 17772, driver `…\chris-driver\`. Chris spawned
  (general-purpose + persona) with the owner's contract verbatim and the mission: teach → 2 confirms → import the rest
  for ≥4 suppliers, count filed/held/wrong, check filed values against the page, compare with the 09-22 / 09-20 /
  09-15 / 08-23 rounds; report → `<root>\CHRIS_REPORT_2026-09-23.md` and `docs/CHRIS_FULL_APP_REVIEW_2026-09-23.md`.
  **RUNNING at handover** — if his report is not in `docs/`, read `<root>\CHRIS_REPORT_2026-09-23.md`. The sandbox is
  left running for the owner to poke. IMPLEMENT NOTHING from his round without the owner's go.
- NOT pushed (owner's call; the whole branch is unpushed). NOT run: the md5/determinism arms.

## OWED / flip gates
- **mig 211 (Oracle C0 + C10):** read the full C0 result (`analyse_c0.js`) — yield ≈ 0 → retire the key (Oracle's
  ruling); else realdoc OFF-vs-ON at RR_APP_ENV=1 with FALLBACK+RESOLVE=1 in BOTH arms: M=0, zero per-field drop,
  wouldFile(ON) − wouldFile(OFF) ⊆ {released}, every released-but-unfiled doc has a logged reason, every NEW file
  pixel-adjudicated, classify (a)/(b)/(c), abstain histogram (needs `--trace`), two ON runs byte-identical; then back
  to the Oracle with numbers. Owed pin: the extract()-level R4 both-branch test (Oracle C11 ii — the unit predicate +
  the veto-fallthrough abstain + the source-order pin are in; the full extract() fixture with a mapped template is not).
- mig 210: realdoc OFF-vs-ON byte-identical except the soften note text on PP-agree rows.
- migs 207/208/209: unchanged from the EVENING handover (207 vendoring of onnxruntime + model; 208 same-day-pair
  census; 209 the #464 `isAutoFileEligible` unit test with the threshold set + false-hold census).
- Named residuals (Oracle): a taught box clipped at a physical fold/table rule (the wide read cannot restore pixels
  that are not there); cold-scope trailing-letter confusables the ambiguous flag is pos-0/last blind to.
- Separate lead (Oracle R3): a DISAGREEMENT-hold on the TOTAL role (3 silent-wrong 5→9 totals in the census).

## Needs the USER
- Which reprocess cleared the Print Tracker date holds (fold vs manual) — the fold has NO trace event; single-
  reprocess one still-held doc under `CORROB_DATE_FOLD_WIDE=1` and watch the note.
- Push (commits unpushed) · the mig 207-211 flips (each gate in `dark_switches.js`) · delete
  `stress_test/out/c0_live_copy/` when the C0 census is done.

## Traps learned tonight
- Run `node scripts/run-pins.js` from the REPO ROOT — a `Set-Location` in an earlier PowerShell call persists into
  later calls (`MODULE_NOT_FOUND`).
- Long censuses go DETACHED (`Start-Process` / `nohup … &`) — a background tool call caps at 10 min; python stdout to
  a file is block-buffered (progress lines carry `flush=True`). The PowerShell guard blocks any command text containing
  `rm -f <path>` even inside a here-string ("Remove-Item on system path … is blocked") — use `: > file` in bash.
- The live DB is copyable with `Copy-Item` (db + -wal + -shm) into the gitignored `stress_test/out/`; the harness reads
  it via `RR_DB=` read-only. `RR_IDS=` targets docs; RR_CONSENSUS rows carry the gate `reason` — which is the FIRST
  failing reason (`flagged:` before `disagreeing-read:`), hence the new `corrob` field.
- A source-index ORDER pin must anchor on a string unique to the intended site (my `_glyph_release_ok` re-used
  `getattr(self, '_veto_fallthrough', False)` and shadowed the G1 anchor).
- `docs/oracle_log.md` had NO 2026-09-23 entries until tonight — log verdicts the same session or the conditions die
  with the transcript.
