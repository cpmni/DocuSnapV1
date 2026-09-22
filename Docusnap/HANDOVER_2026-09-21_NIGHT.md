# HANDOVER — 2026-09-21 NIGHT (read first, then run the night plan)

**THE NIGHT RUN TO EXECUTE: `docs/designs/NIGHT_RUN_2026-09-21.md`.** Two tasks — (A) batch dark-switch census +
flip the clean passers, (B) Chris full Quick File daycare vet → recommendations → Oracle → implement if agreed.
Standing autonomy protocol applies (`memory/feedback_night_run_autonomy_protocol.md`). **Commit locally, DO NOT push
— owner pushes in the morning.**

## Cold-start state
- **Branch** `feat/teach-side-overnight`. **HEAD `d8f1b14`**, origin CURRENT at that commit. **Migration 198.**
- **Uncommitted:** `src/windows/settings/renderer.js` only — the owner-requested graphical folder-TABS for the
  Document-Types Scanned/Quick-File views. TASK 0 commits it alone. (The other dirty paths — `CLAUDE.md`,
  `tools/video_tutorials/*` — are the OWNER's; never commit them.)
- **Pins:** `node scripts/run-pins.js` = **409/409 green**. `run-pins` does NOT scan `src/lib` → run
  `src/lib/test_ooxml_grid.js` directly (green). The `test_ref_class_fix` timing flake is the one known-flaky pin.
- **Installers (built + verified at HEAD's code, rev `9de80c4`):**
  core `dist\ScanFinder Setup 2.0.0-r20260921-1916-9de80c4.exe`, client
  `client\dist\ScanFinder Search Client Setup 1.0.2-r20260921-1919-9de80c4.exe`. (`…-1913-61fce74.REFUSED.exe` is a
  stale refused attempt — ignore.) Build offline: `AUDIT_OFFLINE_OK=1 npm run build:release` + `cd client && npm run dist`.

## What shipped this session — Quick File auto-fill feature (S0→S4), all DARK/opt-in
The whole Records-lists + lane-crossover + multi-doc feature is committed + pushed. Design + BOTH Oracle verdicts:
`docs/designs/QUICKFILE_LOOKUP_LISTS_2026-09-21.md`. Summary: mig 196 `document_types.quick_file` (a type is Scanned /
Quick File / **Both**; `reading_mode` stays the sole detection gate); mig 197 Records lists
(`lookup_lists`/`lookup_records`/`lookup_field_maps` + `lookup_lists_enabled` OFF) — token-prefix typeahead, surrogate-id
records, CSV/XLSX import, all learning-excluded (files as `intake='direct'`); mig 198 `quickfile_multidoc_enabled` OFF
(multi-doc pane: filmstrip + per-doc preview + per-doc form). Settings UI: `src/windows/settings/lookupAdmin.js` +
the lane tabs in `renderer.js`. Also: Review "Visible to" hidden from non-admins.

## ⚠ Live-DB flags are flipped ON right now (for the owner's testing)
I flipped `direct_intake_enabled`, `lookup_lists_enabled`, `quickfile_multidoc_enabled` = `'true'` in the LIVE DB
(`%APPDATA%\ScanFinder\docusnap.db`) so the owner could see the features. **The shipped code defaults are still OFF**
(safe). The dev app may still be RUNNING with these on. This does NOT affect the night run: the census runs on a COPY
of the 700 corpus (not the live DB), and Chris runs in a `/christest` SANDBOX. Helper to flip settings:
`scratchpad/flip_flags.js` (requires `C:/GIT Projects/Docusnap/node_modules/better-sqlite3` by absolute path; run with
`ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron <script>`). To flip a setting in the SANDBOX (Task B) point its
path at the sandbox userData db, not `%APPDATA%\ScanFinder`.

## Key facts / gotchas for the night session
- **The dark-switch ledger is behind.** `docs/DARK_SWITCH_LEDGER.md` doesn't record the 09-19 flips (migs 187-190).
  Read `database/dark_switches.js` for the TRUE current OFF list; census only what's still OFF; refresh the ledger.
- **Census recipe** (Task A): `TESTING/_measure/flip_corpus_20260912/CENSUS.md` + `project_flip_corpus_pipeline_20260912.md`.
  Corpus `Desktop\Flip Corpus 700\warm_700.db` (COPY + migrate first). **Baseline `RR_APP_ENV=1`** (=0 is the vacuous
  trap). **Switch lever = SHELL ENV, not a DB write.** Bash tool has a 10-min bg cap → launch a long arm DETACHED via
  PowerShell `Start-Process bash`. Never run `run-pins` while an arm runs.
- **`/christest`** builds a fresh sandbox each run (fresh DB, isolated userData, copied Demo Docs). Chris FINDS, never
  implements. Flip the 3 feature flags ON in the SANDBOX db before he starts, and seed a daycare "Child Record" type +
  a small imported Records list so he has something to file.
- **Feature flags are opt-in SETTINGS, not dark TEST switches** — `lookup_lists_enabled`/`quickfile_multidoc_enabled`
  are NOT in `TEST_SWITCH_KEYS` (count stays 45). `quick_file` (mig 196) is a schema column.
- **Hardened-build source-protection:** a RENDERER `<script>` must live under `src/windows/**` (ships readable);
  anything under `src/lib|services|modules` or `database` is bytecode-compiled and a readable file there is REFUSED.
  (That's why `quickfileMeta.js` lives in `src/windows/main/`.) Relevant if Task B implements new renderer files.
- **Quick File is JS-only** → no JS↔Python twin needed for anything in this feature.
- Advisors via the Agent tool (barry/eric/gary/reggie/oracle). Oracle log: `docs/oracle_log.md`.

## Standing DEV backlog (owner-gated, NOT for the night run unless it comes up)
`issuer_undetected_blank` flip census · split "recover original"/Rejoin button (C12) · deploy the 3 licensing-server
changes (`BEFORE_RELEASE.md`) · DB-at-rest encryption 2a/2b · VM live-verify the installer pair · PII/encryption for
records-holding customers. These are logged, not tonight's work.
