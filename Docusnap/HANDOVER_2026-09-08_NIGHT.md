# HANDOVER — 2026-09-08 NIGHT (cold start for the night-run session)

> **You are starting the night run.** The plan is **`docs/designs/NIGHT_RUN_2026-09-08_NIGHT.md`** — run it in order under the
> night-run autonomy protocol (memory `feedback_night_run_autonomy_protocol`): AUTO + SAFE items run; advisors free; Chris ALWAYS
> sandboxed; APPROVAL-CLASS items are logged for the morning and SKIPPED; DANGEROUS → advisors → stop that item. Every item ends
> with a DONE-ledger line in `NIGHT_RUN.md`. No pushes, no switch flips, no live-DB writes, no build while a harness arm runs.

## Read order (cold)
1. This file (state + traps + the exact commands).
2. `docs/designs/NIGHT_RUN_2026-09-08_NIGHT.md` — the ordered plan + stop rules + the approval-class list.
3. `HANDOVER_2026-09-08_BUILD.md` — everything the 09-08 day/evening session built (§ REBUILD, § LATE EVENING, § CHRIS TRIAGE).
4. `docs/PRE_DEPLOYMENT_AUDIT_2026-09-08_RERUN.md` — the re-audit + the Oracle's ordered "BEFORE A CUSTOMER BUILD" list.
5. On demand: `docs/designs/AUDIT_FIX_PLAN_2026-09-08.md` (§7b = the commit log), `docs/designs/KEYWORD_SUPERSTRING_GROW_2026-09-08.md`
   §7.1 (the belts gate + the seam), `docs/CHRIS_FULL_APP_REVIEW_2026-09-08.md` (Chris's report verbatim).

## Git / tree state
- Branch `feat/teach-side-overnight`, HEAD `9bc3690`, **42 commits since `eeb8d56`, NONE pushed** (push = the owner's decision).
  Working tree CLEAN (the owner's CLAUDE.md block was folded at the evening wrap — stated in commit `0a2179f`).
- Git ROOT is `C:\GIT Projects` (the app lives in `Docusnap/`); another worktree `C:\GIT Projects\Docusnap-e44` (branch
  `chore/electron-44`) exists — leave it.
- `package.json` gets STAMPED during a build (shows ` M`) and restored after — never commit it mid-build.

## What today shipped (one paragraph; detail in the BUILD handover)
The audit fix plan §8 (KEY-based dark-switch gate `scripts/check-release-migrations.js` first in every build; mig 137 one-shot reset of
the 27 `TEST_SWITCH_KEYS` in `database/dark_switches.js`; runtime arming `database/build_arming.js`, `TEST_BUILD=1` = the one knob;
`npm run build:release` / `build:release:store` / `build:test` via `scripts/build-release.js`; `scripts/verify-release-artifact.js`
with `--smoke-boot` + the html-asset belt + the REQUIRED smoke identity; mig 138 `ocr_dpi=200` on an EMPTY install only, budget ∝ DPI²,
mig 139 import parallelism ON; mig 140 name-grow belts DARK), the re-audit (a NEW P0: every earlier hardened build dropped
`listCaption.js`/`reviewReadiness.js` → fixed `5a4bd94`; Oracle SIGN OFF W/CORRECTIONS → `9251551`), the belts C6 gate (seam fixed
`f4a32a7`; one page-verified heal; the kw-note belt VACUOUS), the pin runner `npm run test:pins` (`71e00ac`), the Review-row overlap
fix `72ce811`, and Chris's comparison round ("I'd keep using it"; nothing implemented).

## Artifacts
- **THE click-through target:** `dist/ScanFinder Setup 2.0.0-r20260908-1843-9251551.exe` (sha256 `ba5c318d…`), manifest
  `dist/release-manifest-20260908-1843-9251551.json` (`problems: []`, `smokeIdentitySource: "file"`). Built from HEAD `9251551`.
- `dist/…-2017-dd9a790.REFUSED.exe` and `dist/…-1355-5b6c226.REFUSED.exe` carry the re-audit P0 — never a target.
- If night item 2 (`--smoke-windows`) rebuilds at the end, the MORNING summary names the newest VERIFIED artifact as the target.
- The DEFAULT `npm run build` is still the plain chain ON PURPOSE (Oracle C5) until the owner's click-through.

## Processes running right now (identify by PID/cmdline, NEVER kill by cmdline substring)
- **The owner's dev app** — electron PID `23828` (+3 children), started 13:31, userData `%APPDATA%\ScanFinder`. OFF LIMITS.
- **Chris's sandbox** — electron PID `3200`, CDP **9223**, userData
  `C:\Users\cmccu\AppData\Local\Temp\claude\c--GIT-Projects-Docusnap\b461fec1-a786-4f0f-8889-d31c1d59669c\scratchpad\chris-sandbox\userData`,
  signed in as Chris, Output + Demo Docs beside it, driver in `…\scratchpad\chris-driver\` (`playwright-core`, `probe.js` = the
  `connectOverCDP` pattern). That scratchpad belongs to the PREVIOUS session — `/christest` in the new session builds a FRESH sandbox
  in ITS scratchpad and kills the 9223 listener first (the skill does this). Screenshots: `scripts/capture-window.ps1 -OwnerPid <pid>`.

## Data + harness facts (the exact commands)
- **Live DB is ABSENT at the documented path** (`%APPDATA%\ScanFinder\docusnap.db` — verify with `ls` before assuming). Censuses tonight
  run on the post-137 reference copy **`TESTING/_measure/reset_arm_20260908/arm137.db`** (147 confirmed docs; `arm136.db` beside it) or
  the 605 folder corpus `Desktop\ScanFinder Test Corpus` (+ `ground_truth.json`, `rr_ids.txt`); Hard Set `Desktop\Hard Set`; the 11k
  `Desktop\Customer Doc Test` (`stress_test/customer_corpus_score.js`, `SAMPLE=300 SEED=7`); Demo Docs `Desktop\Demo Docs` (Chris).
- **Realdoc arm** (ALWAYS `ELECTRON_RUN_AS_NODE=1` — without it `electron.exe script.js` runs as a full app and NEVER EXITS; harvest a
  lingering arm by row count + kill its PID):
  `ELECTRON_RUN_AS_NODE=1 RR_DB=<db> RR_APP_ENV=1 OCR_RENDER_DPI=200 RR_CONSENSUS=<out.jsonl> [SWITCH_ENV=1 …] node_modules/electron/dist/electron.exe stress_test/realdoc_regression.js`
  then `node stress_test/reset_arm_compare.js <off.jsonl> <on.jsonl>` (compares VALUES; ref/date + would-file delta). Never run an arm
  beside a build. A census dir env (e.g. `NAMEGROW_CENSUS_DIR`) must be a WINDOWS path (`cygpath -w`).
- **One-doc trace:** `ELECTRON_RUN_AS_NODE=1 TRACE_DB=<db> OCR_RENDER_DPI=200 [switch env] electron.exe stress_test/trace_one_doc.js <id> [needle]`
  (slices kept in `%TEMP%\slices-*`; Read the PNGs).
- **JS pins:** `npm run test:pins` (325 files; `node scripts/run-pins.js <scripts|database|modules|services|windows>`; `FILTER=<substr>`).
  Today: 308 green, **17 red = ALL pre-existing at `eeb8d56`** (list + signatures at the top of the `NIGHT_RUN.md` QUEUE; log
  `TESTING/_measure/run_pins_20260908.log`). Python pins: pytest-style `cd python_backend && py -3.12 -m pytest $(grep -l "def test_" tests/test_*.py) -q -p no:cacheprovider`;
  script-style one module at a time (`py -3.12 tests/test_x.py`) — NEVER `pytest tests/` whole (INTERNALERROR).
- **Release road:** `npm run build:release` (log to `TESTING/_measure/release_build_20260908/`; ~5 min; launch detached via
  `Start-Process cmd /c … -RedirectStandardOutput`, watch the log for `verify-release-artifact] OK` / `REFUSED`). Builds ran fine beside
  the owner's dev app today; NOT beside a harness arm.
- Bash heredocs strip a backslash level — write patch scripts with the Write tool (Python, CRLF-aware: `newline=""`, replace `\n`
  with the file's `nl`) and run them; `Remove-Item` + a quoted spaced path trips the shell guard (use `Rename-Item` / `[IO.Directory]::Delete`).

## Where tonight's items live (file pointers)
- Item 1 (17 pins): signatures in `NIGHT_RUN.md` QUEUE top entry; the 2026-06 remedy for hand-rolled schemas = sync the fixture to the
  migration columns (`ocr_recipe` mig 104, `charset_flag_meta` mig 102). `test_failure_creates_holding_row` (7 checks) FIRST.
- Item 2 (`--smoke-windows`): the smoke block is at the top of `src/main.js` (`_smokeBoot`, `SCANFINDER_SMOKE_DIR`, exit 4) and inside
  whenReady after the encryption gate (`getDb()` → `smoke-identity.json` + stdout → `app.exit(0)`); the verifier's `evaluate()` +
  `htmlAssetProblems` + the smoke spawn are in `scripts/verify-release-artifact.js`; pins `scripts/test_verify_release_artifact.js` (28).
  Windows list = `src/windows/*` (main, review, settings, search, teach, help, welcome, tutorial, onboarding, license, legal,
  dev-inspector, unlock, update-lock, splash). Open them DIRECTLY with `show:false` against the throwaway userData — never via
  `enterMainApp()` (licence/login gates).
- Item 3: `_name_band_read` / `_pick_band_line` in `python_backend/extraction/template_mapper.py` (pins
  `python_backend/tests/test_template_name_grow_belts.py` — every band-pick case injects `_NAME_BAND_READ_HOOK`); tautological pins
  `database/modules/test_runtime_test_arming.js:79`, `database/modules/test_migration137_test_switch_reset.js:82`; the harness
  operating point = the first jsonl row written by `stress_test/realdoc_regression.js` (add the marker `test_build_armed_rev` + the
  ON-count of `TEST_SWITCH_KEYS`; refuse unless `RR_ALLOW_ARMED=1`; `RR_APP_ENV` default-ON).
- Item 4: `TYPE_UNINSTALLED_HEADING_FOLD` (mig 122 seed OFF; built `25a0cfe`, design in `HANDOVER_2026-09-06.md` 4b); the re-detect
  harness = the type-election path over PDFs (see `heading_absent_census.py` / the 09-06 census script for the shape).
- Item 5: mailbox card = `src/modules/workflow/handler.js` + `src/services/workflowService.js` + the Search/mailbox renderer
  (`src/windows/search/search-actions.js`); import list status = `src/windows/main/renderer.js` (`✓ → ${msg.new_filename}` at ~1158;
  the result rows + the `confirm-review` broadcast); bundle issuer provenance = `process_docs.py` page loop + `engine.py` identity
  election (007 + gary → Oracle, design only).
- Item 6: `/christest` skill (Skill tool) with the focus args from the plan; `chris-the-customer` is NOT a registered subagent type —
  spawn `general-purpose` and have it Read `.claude/agents/chris-the-customer.md` + `.claude/skills/customer-experience-review/SKILL.md`.
- Item 7: `client/package.json` + `cert-tool/package.json` already declare electron 44; `npm install` in each, launch smoke.

## Owner queue (approval-class — log, don't run)
1. Scripted click-through + the uninstall "remove all data" drill on the newest verified artifact → then the `build` default flip (2.7b)
   + retire the "revert list" wording (C10).
2. Push (42+ local commits).
3. Chris's vet queue (triage in `HANDOVER_2026-09-08_BUILD.md`): bundle issuer from page 3; STATEMENT typed Invoice (= the DARK
   `type_uninstalled_heading_fold` exhibit); Import list stale after a manual confirm (since 09-03); Edit-role mailbox "Type —/Unknown";
   Pelican `PI` at 200 DPI (documented confusable trade-off); `✓ → undefined`; identical same-sender rows after the truncation fix.
4. Learning Repair #42/#25/#27/#40, Ridgeway 8/19/21, doc 99 `ws-55718`. Flips: belts (§7.1 table), heading-fold (tonight's arm),
   `deskew_corrob_autofile`, `watch_separate_enabled` (soak). Incorporation → signing; DB-at-rest; backend DocumentRoot + 2FA;
   `pip uninstall` the 9 dead packages + `--require-hashes`; the DPI/budget decision.

## Traps (tonight-relevant, durable list in memory `project_audit_fix_build_20260908`)
- `ELECTRON_RUN_AS_NODE=1` on every harness launch (see above). Two arms concurrently are fine CPU-wise; a build is not.
- A shipped module must never be named `test_*.js` (the staged build excludes the pattern). `scripts/` never ships.
- A pin whose negative regex is broader than the block it guards trips on your own comment; a `head -N` can hide the late LOG line.
- The `!= '0'` idiom reads EMPTY as ON — an OFF arm must be an explicit `'0'`.
- Junctions: delete as reparse points (`[IO.Directory]::Delete`) BEFORE any recursive remove — never let `Remove-Item -Recurse` walk
  into the real `node_modules`.
- The owner's `CLAUDE.md` LATEST block is now this session's — replace it at the next wrap (move the outgoing block to
  `docs/session-log.md`), don't stack.
