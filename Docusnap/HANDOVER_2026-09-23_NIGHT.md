# HANDOVER — 2026-09-23 NIGHT (DOWNGRADE mig 210 built DARK + the filtered `_absent` census: RELEASE gate MET, 0 common-mode)

Branch `feat/teach-side-overnight`. **Committed, NOT pushed:** `f3a6ccd` (feat: mig 210) · `8798fed` (test: census_absent.py)
· `3313fc2` (docs) · plus the wrap commit for this file / CLAUDE.md / the census RESULT. Migrations now go to **210**.
`TEST_SWITCH_KEYS` **14**. `node scripts/run-pins.js` **413/413**. New Python pins `test_glyph_confusable_resolve.py`
**12/12**; `test_glyph_disagreement_hold.py` still 16/16. Continues `HANDOVER_2026-09-23_EVENING.md` (read it for the
date-fold / arithmetic-witness / dual-reader-census context).

⚠ The dev app from the evening (env `CORROB_DATE_FOLD_WIDE=1` + `GLYPH_FALLBACK_ENABLED=1`) may still be running — it was
not touched this session. Env-only; a normal restart reverts it.

---

## TL;DR
1. **Built the DOWNGRADE — `glyph_confusable_resolve` (mig 210, DARK).** Inside `engine._glyph_disagreement_hold`: when a
   scanned ref's ONLY note is the Gate-C confusable soften (exact text, no `corrected_to`) and PP-OCR AGREES with the
   committed read, the note is RE-WORDED to "Two independent readers both read this reference as '…' (one character can
   look like another on a scan) — please confirm the reference before filing." Still a note (held), same ref-advisory
   mark (composeNote.js rank 1), no absent mark, no value/conf/method change; disagree/abstain leave the soften
   untouched. Hard dep `GLYPH_FALLBACK_ENABLED`. Oracle D1-D5 all applied.
2. **D5 answered at source:** the newest diag (`Debug/diagnostic_2026-09-23T10-30-18-458Z.jsonl`) has **40/40
   `glyph_check` AGREE, 0 `no_box`**, on 37 real Print Tracker docs → the paddle AGREE branch FIRES on real anchor reads
   (the anchor-box capture from `8480f27` works). The DOWNGRADE is not inert on the owner's docs.
3. **Ran the filtered `_absent` census (the Oracle's one open RELEASE gate) — MET.** `census_absent.py` over the prior
   1,323 ref rows: 64 page-absent → **18 in the soften set** → PP agrees on 14 → **pixel-adjudicated: all 14 crop reads
   CORRECT (common-mode 0/14)**; the 4 PP-disagrees are ALL crop-wrong/PP-right (the mig-207 hold catches them). Perfect
   separation. Verdict `TESTING/_measure/dual_reader_census/RESULT_ABSENT_20260923.md`; data
   `Desktop\TEMPTEST_dual_reader_absent\`.
4. **Honest extra finding — the synthetic clip arm:** shaving ~55% of the first glyph off each soften slice made BOTH
   readers agree on a WRONG read once (`SO-82482` → `30-82482`). Not reachable by today's soften (`S`↔`3` isn't a map pair)
   but it is the "PP shares the clipped-pixel loss" shape → the RELEASE needs a flush-edge/clip guard (Seam 6).
5. **RELEASE NOT built** — approved in principle, gate met, but R1-R6 only exist as a paraphrase (the evening transcript
   is gone). Every downstream arm that would re-judge a released ref is now verified at source in
   `docs/designs/CONFUSABLE_RELEASE_SEAMS_2026-09-23.md` (G1 fall-through re-note, Fix A `anchor_inline` hold — both
   fail the soften set by construction; the boost; the already-passed ambiguous flag; the three soften producers; the
   clip). Next step = re-vet with the Oracle with THAT note + the census in front of it, then build DARK.

## Files (all committed)
- `python_backend/extraction/engine.py` — `_GLYPH_SOFTEN_KEY` + `_GLYPH_RESOLVED_SOFTEN_NOTE` (near :2140); the
  `_resolve` branch in `_glyph_disagreement_hold` (~:6880-6990); `glyph_resolve` trace (agree/disagree).
- `database/index.js` mig 210 seed OFF · `src/modules/processing/handler.js` `GLYPH_CONFUSABLE_RESOLVE` mirror (~:425)
  · `database/dark_switches.js` entry + flip gate (`TEST_SWITCH_KEYS` → 14) · count pins `test_migration137_test_switch_
  reset.js` / `test_migration163_deskew_false_absent_reflag.js` / `test_default_flip_205_batch.js` (13→14).
- `python_backend/tests/test_glyph_confusable_resolve.py` (12) — OFF byte-identical · hard dep · agree rewords + keeps
  mark · alnum-only agree · disagree/abstain untouched · other notes untouched (absent/reinstate/free/composite) ·
  `corrected_to` blocks · value-drift fails closed · manual methods · no-note path unchanged · JS mark-sync.
- `TESTING/_measure/dual_reader_census/census_absent.py` + `RESULT_ABSENT_20260923.md`.
- Docs: `docs/oracle_log.md` (09-23 rulings, post-hoc) · `docs/DARK_SWITCH_LEDGER.md` (batch flip + migs 207-210) ·
  `docs/designs/CONFUSABLE_RELEASE_SEAMS_2026-09-23.md` · `NIGHT_RUN.md` QUEUE (mig-210 realdoc gate).

## OWED / flip gates
- mig 210 flip: realdoc OFF-vs-ON at `RR_APP_ENV=1` + `GLYPH_FALLBACK_ENABLED=1` — every field byte-identical except the
  soften note text on PP-agree rows; the onnxruntime + model vendoring owed by mig 207; owner's go.
- migs 207/208/209 gates unchanged from the EVENING handover (207 vendoring; 208 same-day-pair census; 209 the #464
  `isAutoFileEligible` unit test with the threshold set + false-hold census).
- Separate lead (Oracle R3): extend the DISAGREEMENT-hold to the TOTAL role (3 silent-wrong 5→9 totals in the census).

## Needs the USER
- Which reprocess cleared the Print Tracker date holds (fold vs manual) — the fold has NO trace event, the diag can't
  settle it; single-reprocess one still-held doc under `CORROB_DATE_FOLD_WIDE=1` and watch the note.
- Push (4 commits unpushed) · the mig 207-210 flips · whether to commission the RELEASE re-vet now.

## Key facts / paths
- Live DB `%APPDATA%\ScanFinder\docusnap.db` — BLOCKED to Claude's tools.
- Run JS pins `node scripts/run-pins.js` FROM THE REPO ROOT (a `Set-Location python_backend` in an earlier PowerShell call
  persists into later calls and breaks it — `MODULE_NOT_FOUND`). Python pins: `PYTHONIOENCODING=utf-8 py -3.12
  python_backend/tests/<t>.py`.
- Long census runs: launch DETACHED (`Start-Process py … -RedirectStandardOutput`) — a background tool call is capped at
  10 min; python stdout to a file is block-buffered (progress lines carry `flush=True`).
- Memory: `project_confusable_census_and_reconcile_20260923.md` (updated) + `MEMORY.md`.
