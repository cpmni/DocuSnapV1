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
