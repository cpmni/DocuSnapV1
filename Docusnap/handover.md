# Handover — mig 162 skew arc + Quick File/Departments plan
Branch: feat/teach-side-overnight · Updated: 2026-09-12

## Goal
Ridgeway #358 skew exhibit (ref `VS-72672` vs page `WS-73673`): measure, fix DARK, gate. Then the owner's plan for a
non-OCR "Quick File" lane + department-scoped document visibility. Both done; gate half-run. Full detail:
`HANDOVER_2026-09-12_EVENING.md` (read first), `CLAUDE.md` LATEST block.

## Done (committed, NONE pushed — owner's call)
- `79cb655` feat mig 162 `deskew_retry_field_adopt` DARK (`process_docs.py` helpers + call site, `engine.py` hoisted `_FILING_SANITY_YEAR_ABSENT_MARK`, mig 162, `dark_switches.js` → 46, `_reconcileEnv` nesting, harness `RR_LOG_MATCH`/`RR_LOG_OUT`, pins 62 py + `test_migration162_deskew_field_adopt.js`, runner `TESTING/_measure/deskew_field_adopt_20260912/run_gate.sh`)
- `7fd1400` docs plan `docs/designs/QUICKFILE_AND_DEPARTMENTS_PLAN_2026-09-12.md` (+ eric arch doc, barry brainstorm); Oracle blocks in `docs/oracle_log.md`
- `a1529a1` `93cf1ec` `cd39307` `6588b0d` handover/docs (gate result, census, dev-app kill note)
- Published plan page: https://claude.ai/code/artifact/c93e7a50-036d-40af-bf88-b802fb55c25e

## In progress — UNCOMMITTED
- Nothing tracked. Untracked `HANDOVER_2026-09-12.md` (the morning handover, previous session) — leave or add like the others.
- Gate BASE cell (RR_APP_ENV=0 + parent, = mig 153 OFF) still running detached at wrap: OFF arm done, ON arm in flight;
  outputs `stress_test/out/deskew_field_adopt_20260912/base_{off,on}.*`, diff prints to `<scratchpad>/gate_all.log`
  (session scratch — if lost, re-run `bash TESTING/_measure/deskew_field_adopt_20260912/run_gate.sh base`).

## Next steps
1. Push (owner). Relaunch the dev app — the system KILLED it for low memory during the gate; arming dance for key 46
   (`HANDOVER_2026-09-12_EVENING.md` §3), then FULL reprocess #358 → expect `WS-73673` @82 held, no `Use` button.
2. Read the base-cell diff; pass = M=0 + wouldFile set-EQUALITY. Armed cell already PASS (M=0, 0 deltas, 0 fires).
3. Flip decision for 162 needs the 605 corpus (`RR_DB` → a DB holding it; none on disk) + Oracle; zero fires ⇒ DARK.
4. Plan: answer the 10 questions (§8 of the plan doc); approve D-C6 = `accessService.gateEnabled()` ignores
   `ACCESS_GATE_ENABLED` when `app.isPackaged` (one line, pattern `processing/handler.js:2286-2294`, pin
   `src/services/test_access_service.js:117-127`) as its own commit BEFORE anything else.
5. Learning Repair candidates from the baseline: #163 (`DN-64470` confirmed, page prints `DN-64472`), #273 (Marlowe SO
   confirmed under Vellum & Crane). Adjudicate at the pixels.
6. New backlog item (top of `pendingfeatures.md`): the hold-RELEASE class — 6 delivery notes whose raw "doesn't appear
   on this page" was a skew garble of the full-page pass; straightening corroborates the SAME value @100. Own Oracle arc.

## Decisions & rationale (non-obvious)
- Retry door = ref/date ROLE note only (never supplier-only): a role note is never soft-clearable → review-bound by
  construction; a supplier-only note would pay a full straighten pass for zero upside (Oracle C1).
- Whole-doc adopt stays gated on the RAW engine flag: opening it to note-only docs would also widen the dev-armed
  `DESKEW_CORROB_AUTOFILE` population, the one road that skips a hold (Oracle S1).
- Field adopt requires `_corrob_licensed_keyword` (no disagree + keyword witness), not bare `independent_agree`.
- Overall becomes min(raw, straightened): the 88 floor is NOT a second checkpoint (floor relax for licensed records) —
  the role NOTE is the sole checkpoint (pinned C7).
- Plan rulings: dept delete = RESTRICT + retire (SET NULL is fail-open); typed docs marked `intake='direct'` with a
  NON-switchable learning clause (not `confirmed_via`); drag-drop v1.1 (changes the audit's M4/M9 boundary).

## Gotchas
- Parent pin `test_deskew_review_retry.py` C14 uses `str.find` first occurrence — never write the literals
  `_deskew_retry_apply_holds(raw_extractions, raw2)` / `raw_extractions = raw2` above the retry block.
- `_appSpawnEnv` spreads `{...process.env, ...appEnv}`: an explicit env var only wins when the DB lacks the key 'true';
  a mig-153-OFF cell needs `RR_APP_ENV=0` + `DESKEW_REVIEW_RETRY=1` explicitly.
- Bash heredocs with backticks/quotes broke twice — write a scratch file, `cat >>` it.
- Live DB read-only via `ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe <script>`; writes = owner `!`.
- Arc B (mig 160) abstains on #358 by its own bar (3 human confirms < 5) — not a bug; don't "fix" it.

## Verify
- `PYTHONIOENCODING=utf-8 py -3.12 python_backend/tests/test_deskew_retry_field_adopt.py` (62) · `…/test_deskew_review_retry.py` (36)
- `ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe database/modules/test_migration162_deskew_field_adopt.js` · `…test_migration137_test_switch_reset.js` (46)
- `npm run test:pins` → 342/343 (red = pre-existing `test_activity_strip`)
- `bash TESTING/_measure/deskew_field_adopt_20260912/run_gate.sh armed|base|all`
