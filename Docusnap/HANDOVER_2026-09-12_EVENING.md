# HANDOVER 2026-09-12 EVENING — for a fresh session

Read top-to-bottom. Branch `feat/teach-side-overnight`. **Two commits this session, NOT pushed (owner's call):**
`79cb655` feat(deskew) mig 162 DARK · `7fd1400` docs(plan) Quick File + Departments. Everything built is DARK (seed
OFF, in `TEST_SWITCH_KEYS` → **46**, byte-identical OFF, Oracle-gated, pinned). `npm run test:pins` **342/343** (the 1
red = the pre-existing `test_activity_strip`). Also read `CLAUDE.md`.

---

## 1. What happened to the ACTIVE TASK (the Ridgeway skew fix) — measured, designed, BUILT DARK

The 09-12 morning handover said "route gary → Oracle → build the field-scoped deskew adopt, after a BUILD
PRECONDITION measurement (run inbox/358.pdf through the FULL process_docs path with DESKEW_REVIEW_RETRY=1)". Done:

**The measurement changed the diagnosis** (`scratchpad/measure358.js`: full `process_docs` path on
`%APPDATA%\ScanFinder\inbox\358.pdf`, app spawn env mirrored — 147 vars — DPI 200, live DB read-only):
- `VS-72672` @95 is the **CURRENT read** (retry OFF and ON arms identical), NOT a stale commit → the "Learning Repair
  the stale VS-72672" queue item is **MOOT** (doc 358 is not confirmed; `documents.reference_number` is NULL).
- **The retry NEVER RAN** (new hypothesis H3): its door keys on the engine's `_needs_review`, which is **False** for a
  doc held ONLY by a role-field note (Gate C's absent writer sets no flag; engine.py:12427 can only clear). The JS side
  holds it (a noted ref role refuses auto-file at every floor) — the engine flag is a partial signal.
- **H2 CONFIRMED** (forced-open probe): skew 1.7° → the straightened pass reads `WS-73673` @82 via TAUGHT-CORROB-ADOPT
  (mig 153) with a licensed mapping+keyword record — but straightened overall 79 < raw 83 (the confident garble @95
  inflates raw) → the whole-doc gate refuses. Render-determinism ×3: identical.
- **Arc B (mig 160) abstains by its own bar**, not a bug: `dominant: null` — the scope has 3 HUMAN-confirmed refs
  (< `DOMINANT_MIN_COUNT` 5); the other 17 `WS-` refs are `machine_value_counts`, ignored by `build_prefix_index`.

**Built — mig 162 `deskew_retry_field_adopt`** (env `DESKEW_RETRY_FIELD_ADOPT`, `== "1"`, CHILD of
`deskew_review_retry_enabled` in `_reconcileEnv`): design `docs/designs/DESKEW_RETRY_FIELD_ADOPT_2026-09-12.md`
(gary), Oracle **SIGN OFF WITH CONDITIONS C1-C11** (`docs/oracle_log.md`), all conditions folded:
- **Door (C1):** also opens on a noted, non-authoritative, un-corrected ref/date ROLE field
  (`_deskew_field_adopt_door_keys`) — never a supplier-only note (a full straighten pass for zero upside).
- **Whole-doc adopt unchanged** and gated on the RAW engine flag (`if _raw_flag and _deskew_retry_adopt(...)`) — its
  population is byte-identical ON vs OFF (pinned).
- **Field-scoped adopt (else-branch):** F1-F7 + C3 overall = min(raw, straightened) + C4 lane-hold appended over a
  machine-clearable note (class-F or the JS `CLEARABLE_NOTE_MARKS` twin, pinned equal) + C5 same supplier/template
  or refuse + C6 no put-back over a page-absent raw note (new hoisted `engine._FILING_SANITY_YEAR_ABSENT_MARK`,
  prose unchanged). Never consults `DESKEW_CORROB_AUTOFILE`. C9 log + trace `door` (`flag|note`).
- **HARD dep (C2):** `template_taught_corrob_adopt` (mig 153) + `template_pad_window_code` ON for the exhibit class
  — without TCA the straightened box still reads `MS.72672` + absent → VACUOUS on 358 (pinned). Flip 153 with 162.
- **Pins:** `python_backend/tests/test_deskew_retry_field_adopt.py` (62) · `database/modules/test_migration162_deskew_field_adopt.js`
  (seed + nesting + **C7** the note is the SOLE checkpoint — with mig 142 + corrob autofile + floor relax ON on a
  graduated scope the adopted @82 row is `flagged`, note stripped → eligible + **C8** Quick reprocess KEEPS the adopted
  read (IMAGELESS PRESERVE; contested on a non-taught key), FULL lets the fresh read win). `test_migration137` → 46.
- **Harness:** `stress_test/realdoc_regression.js` gained env-gated `RR_LOG_MATCH` / `RR_LOG_OUT` (Python log lines
  were DISCARDED before — no census road for a log-visible decision). Inert unset.

## 2. THE GATE (Oracle C11) — armed cell DONE = PASS; base cell running at wrap
**Armed cell result (369 Demo docs, RR_APP_ENV=1 = mig 153 ON):** `GATE: PASS` — **M=0**, filer REMOVED 0, new filer
wrong 0, new filer==GT 0, **ALL value deltas OFF→ON = 0** (byte-identical outcome); door census OFF: 15 straighten
passes / 9 whole-doc adopts / 0 note-door → ON: 23 passes / **9 whole-doc adopts (population freeze holds)** / 8
note-door passes / **FIELD ADOPTS = 0** ⇒ per C11 "zero fires ⇒ STAYS DARK" on this corpus. The 8 note-door docs
paid a straighten pass and the field adopt refused (cost-bounded; ids in the ON `.straighten.jsonl`). The 605 corpus
(the Nordwind skew class) is still REQUIRED before any flip decision.
**⚠ The dev app was KILLED by the system for LOW MEMORY at ~15:30 while the gate + pin suite ran** (the 09-12 morning
`TEST_BUILD=1 npm start` background task) — it is DOWN at wrap; relaunch with the arming dance (§3) so the new key
(46) arms.

`TESTING/_measure/deskew_field_adopt_20260912/run_gate.sh all` was launched detached at ~13:30 (log
`<scratchpad>/gate_all.log`; outputs `stress_test/out/deskew_field_adopt_20260912/{armed,base}_{off,on}.{consensus.jsonl,log,straighten.jsonl}`).
Cells: **armed** (RR_APP_ENV=1 = the dev DB's 45 armed switches incl. mig 153 + DESKEW_CORROB_AUTOFILE) and **base**
(RR_APP_ENV=0 + DESKEW_REVIEW_RETRY=1 = the mig-153-OFF cell). Each = OFF + ON over the live DB's **369 confirmed Demo
docs** (~30 min per arm) + `diff_consensus.js` (M, filer-set) + a door/fire census from the straighten log lines.
**Pass =** M=0 AND wouldFile(ON)==wouldFile(OFF) (set-EQUALITY — Phase 1 always held) in every cell; every
FIELD-ADOPTED fire adjudicated AT THE PIXELS; supplier-only straighten passes = 0. **Still owed for the flip:** the
**605 corpus** (needs `RR_DB` pointed at a DB that holds it — none on disk), the live #358 test (§3), zero fires ⇒
stays DARK. If the run died (machine slept), re-run the script; arms are independent.
**Baseline finding (armed cell, OFF arm — mig 162 OFF, so PRE-EXISTING at the armed operating point):** 325/369
would auto-file, **2 would auto-file a WRONG value** — both smell like poisoned GT, adjudicate AT THE PIXELS:
- **#163** `ThornburyFasteners_delivery_docket_10.pdf`: harness reads `DN-64472` @98 (`template_mapping_edgeclipheal`,
  mig 151); the DB confirmed `DN-64470`. The 09-10 TCA design (`docs/designs/TAUGHT_CORROB_ADOPT_2026-09-10.md`) says
  the page PRINTS `DN-64472` and the taught box clipped it to `…64470` → the confirm is a rubber-stamped clip →
  Learning Repair candidate.
- **#273** `MarloweMedicalSupplies_sales_order_01.pdf`: harness supplier `Marlowe Medical Supplies` (template_fixed
  @95); the DB confirmed supplier `Vellum & Crane Stationers` (template 12) while the page's customer reads
  `Ashcombe Care Homes Ltd` — a Marlowe sales order confirmed under the wrong company → Learning Repair candidate.

## 3. Live #358 test (owner, after a relaunch)
mig 162 needs an app RELAUNCH to apply + the ARMING DANCE for the new key (the marker `test_build_armed_rev` is sticky
at `dev`): close the app (kill electron PIDs BY PID), owner runs the `!` command from the morning handover §3 to
`DELETE FROM settings WHERE key='test_build_armed_rev'`, relaunch `$env:TEST_BUILD='1'; npm start` → log prints
`test switches armed (46 …)`. Then FULL Reprocess doc 358 (NOT Quick — the imageless path skips the retry; Quick is
`opts.quick` from the caller). Expect: `Straighten+reread: page skew 1.7 deg` → `whole-doc adopt not applicable
(note-only hold)` → `FIELD-ADOPTED reference_number 'VS-72672' -> 'WS-73673' @82` → the field shows `WS-73673` held
with the TCA note ("Corrected from the taught box's clipped read … Please confirm."), no `Use "VS-72672"` button;
confirm writes no correction row.

## 4. The SECOND task — the Quick File + Departments PLAN (owner asked while away) — DONE, nothing built
`docs/designs/QUICKFILE_AND_DEPARTMENTS_PLAN_2026-09-12.md` (read §1 summary → §5 rulings → §6 security → §7 order →
§8 questions → §9 Oracle). Readable-anywhere page (private artifact, same content, the ten questions with defaults):
https://claude.ai/code/artifact/c93e7a50-036d-40af-bf88-b802fb55c25e Companions: `docs/brainstorms/BARRY_2026-09-12_quickfile_departments.md` (product),
`docs/designs/QUICKFILE_DEPARTMENTS_ERIC_ARCH_2026-09-12.md` (architecture, F1-F19 facts). Oracle: **SIGN OFF WITH
CONDITIONS on both** (Q-C1-12, D-C1-12, `docs/oracle_log.md`). Headlines:
- **Quick File** = an ordinary confirmed `documents` row with typed `extractions` (`intake='direct'`), filed via the
  existing `commitDocument`, never Review, never learning — BUT four write-side doors (`deconfirmDocument` / Learning
  Repair send-back, Edit-in-Review, `reprocess-document`) would drag it back → Q-C2 refusal family; the realdoc
  harness would score it as GT → Q-C4; `'none'` presets must never detect → Q-C8; drag-drop = v1.1 + own Oracle.
- **Departments** = one nullable `documents.department_id` (NULL = shared, byte-identical when empty) + per-type
  default + `department_set_by` (D-C2); two lines in `canAccessDocument` + ONE SQL fragment in EVERY list reader (the
  four missed readers named, D-C4); assign-time route gate on the DEPARTMENT decision ONLY (D-C1 — the full gate would
  regress today's readonly routing); backup remap by slug (D-C3); tell the importer when their batch is hidden (D-C7).
- **Security finding (pre-existing, ship FIRST as its own commit — D-C6):** `accessService.gateEnabled()` honours
  `ACCESS_GATE_ENABLED` with no `isPackaged` guard (`accessService.js:37-41`; pattern `_realCanonical`
  handler.js:2286-2294; pin `test_access_service.js:117-127`). Low severity today, precondition for departments.
- **Order:** D-C6 → Q1 → Q2 → D1+D2 (one slice) → D3/D4 → Q3 → Q4 → Q5 → D5 → Q7. Owner Q&A defaults all accepted
  (Q1 copy + no "remove original" in v1; Q7 admin-only cross-dept routing; Q10 do nothing).

## 5. OWNER QUEUE / NEEDS APPROVAL
1. **Push** (2 commits local).
2. **Read the gate results** (§2); run the 605-corpus cells when a corpus DB exists; live #358 (§3).
3. **Decide on the plan** (§4 + §8 questions in the plan doc); approve D-C6 as the first commit.
4. **Flip census (still owed) for migs 154-162** before ANY customer default — none flipped.
5. From the morning handover, still open: Chris cards 2-6 (`docs/CHRIS_FULL_APP_REVIEW_2026-09-11.md`); the two
   backlog ideas; the below-relocate arc v2 blockers; the `flip_census_20260911` runner.
6. `pendingfeatures.md` top: the pre-existing mig-142 seam (the whole-doc deskew note on an OPTIONAL field is soft)
   = a NAMED flip precondition on `optional_soft_flag_autofile` (Oracle C10).

## 6. GOTCHAS (verified this session)
- The live DB is readable via `ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe <script.js>` +
  `new Database(path,{readonly:true})` even with the app running; WRITES = owner `!` commands.
- The parent pin `test_deskew_review_retry.py` C14 uses `str.find` FIRST occurrence — never write the literals
  `_deskew_retry_apply_holds(raw_extractions, raw2)` / `raw_extractions = raw2` anywhere above the retry block.
- `emit_trace` is a closure inside `main()` (self-guards on `args.trace`).
- Bash heredocs with backticks/quotes broke twice — write a scratch file with the Write tool and `cat >>` it.
- `_appSpawnEnv` (harness) spreads `{...process.env, ...appEnv}` → an explicit env var can only WIN when the DB does
  not hold that key 'true'; for a mig-153-OFF cell use `RR_APP_ENV=0` + the parent env explicitly.
- Scratch (NOT committed): `measure358.js` (the full-path runner, `M358_PY_ROOT`/`M358_ARMS`/`M358_TRACE`),
  `py_probe/` (a process_docs copy with the door forced open + PROBE dumps), `prefix_probe.py`, `door_census.js`,
  `confirmed_count.js`, `oracle_verdict_*.md`.
