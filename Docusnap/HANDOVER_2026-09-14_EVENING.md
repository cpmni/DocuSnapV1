# HANDOVER 2026-09-14 EVENING — cold start for the next session (written for Claude Opus 4.8)

Branch `feat/teach-side-overnight`. **HEAD `2da47b2` (docs) on `18bd9a2` (the DATE FORMS fix); origin CURRENT — everything
pushed; tree clean.** **NOTHING is running** (no repo Electron, no dev-start launcher; the owner installs the test builds).
Written at the owner's request ("write a handover for opus 4.8 and we will continue in new session").

## TL;DR — where things stand
- **The pair of TEST installers to ship the test customer** (built 13:54-13:57 on `18bd9a2`; supersede every earlier pair):
  - core **`dist\ScanFinder Setup 2.0.0-r20260914-1254-18bd9a2-TEST.exe`** — `npm run build:test`: all **51** DARK keys arm at
    first run (Quick File + Departments + mig 166 + mig 167 included); packaged `--smoke-boot` identity
    `{"testBuild":true,"buildRev":"20260914-1254-18bd9a2-TEST"}`, `--smoke-windows` 14/14; the asar/config/pyc verified to
    carry the date fix. A TEST build ships plain JS by design — NOT hardened, not for a paying customer.
  - client **`client\dist\ScanFinder Search Client Setup 1.0.2-r20260914-1256-18bd9a2.exe`** — contract 1.6.0.
  Install the core first, then the client. The customer's copy is a week old and refused his "23rd Aug 2026" — this pair
  carries the fix.
- **Today (2026-09-14) shipped, all Oracle-vetted, all pushed** — detail in `HANDOVER_2026-09-13_LATE.md` ADDENDA 2-7 and
  `docs/oracle_log.md` (four 2026-09-14 entries):
  1. Chris cards 1-8 (`0129053` / `ff49223` / `0f58ecb`).
  2. `/v1` contract 1.3.0 → **1.4.0** — the client pop-out's last workflow bits (routes/history, admin cancel, new stamp
     type, stamped-copy overlay). FINDING: the inline workflow provider in `searchWorkflow.js` has been dead since `9c50b93`;
     the popup (`searchStamp.js`) is the one front door.
  3. **1.5.0** — the Contents (PDF bookmarks) panel in the Search viewer + viewer speed (JPEG for scan pages, thumbnail
     queue). Measurements in `TESTING/_measure/viewer_speed_20260914/`.
  4. **1.6.0** — `--page-info`: one Python process for the first paint + a 3-page read-ahead batch.
  5. `99959c2` — the importer refuses the app's own folders (`.sf_separated_originals` / `.metadata`; the "34 blank pages"
     question closed) + the client pop-out's remembered position is sanitised against the connected displays (an OFF-SCREEN
     restore was a second real "search window doesn't open" cause).
  6. `18bd9a2` — **DATE FORMS** (mig 167 `date_forms_wide`, `TEST_SWITCH_KEYS` 50 → 51): see below.
- `npm run test:pins` **363/363 green** at wrap (the previously flaky `test_ref_class_fix` was green in the run too).

## The date-forms slice (the last thing built — know it before touching any date code)
The test customer taught a doc dated "23rd Aug 2026" and the app said it was not a date. The Python engine already read
it; the refusal was the desktop CONFIRM door (`src/modules/filing/handler.js parseDate` = confirm / filename / `/v1`
confirm / Quick File / `_autoFileDoc`) and the shared `config/keyword_patterns.json validation_patterns.date` (crop
credibility gate, keyword qualification, Review badge). reggie designed, Oracle SIGN-OFF-W/COND (C1-C4 built, C5 = gate).
- **ONE rule on every surface:** widen ONLY the month-name family — day (optional st/nd/rd/th) · month name keyed on its
  first three letters (optional trailing dot; "Sept") · 2- or 4-digit year (3-digit clip refused; 2-digit pivots at 69 =
  strptime `%y`) · between the parts optional whitespace and AT MOST ONE of `, . / \ -`; letters⇄digits may be glued
  ("23Aug2026") but **digits→digits NEVER** ("Aug 2026" must not split into 20 Aug 26); a leading day name dropped; a REAL
  calendar date only (JS `new Date` rolled "31/04/2026" to 1 May — closed with a round-trip; strptime never did). Numeric
  dates NOT widened (the month name is the guard that keeps "3.5.2" / "1,234.56" / "12-34-5678" out). We do NOT "strip all
  special characters" — that would make "1,234.56" a date.
- **UNSWITCHED at the human doors:** the confirm door; Review `_matchStrictDate` (every return through `_realDMY`) +
  `_parseDrawnDate`; the Review badge AND the Quick-check grid through ONE helper `_widenDatePatterns(pats)`; Teach
  `_parsesAsDate`. **DARK on the engine side** (setting `date_forms_wide`, env `DATE_FORMS_WIDE` from
  `processing/handler.js _reconcileEnv`): `validator._wide_month_form` (rebuilds the match as "D Mon YYYY" for the existing
  strptime lists), `anchor._crop_is_credible` + `keyword._validate` + the G4 guard merge config `date_wide`. OFF
  byte-identical (pinned). Why DARK there: a wider SUBSTRING pattern can also admit a wrong crop as "a credible date".
- **Pins:** shared vectors `python_backend/tests/date_forms_vectors.json` read by `python_backend/tests/test_date_forms_wide.py`
  (run under BOTH `py -3.12` and `vendor\python\python.exe`), `src/modules/filing/test_normalise_date_predicate.js` (57),
  `src/windows/review/test_validation_pattern_surfaces.js` (170 — the pure renderer functions are LIFTED out of the
  browser-scoped source with regexes and RUN in `vm`; both regex fragments literal-pinned in the three JS readers).
- **⚑ Flip gate for the engine half (Oracle C5; owner's call after):** realdoc 605 M=0 + `wouldFile` set-equality OFF vs
  ON + the `VAL_CENSUS_DIR` crop/keyword acceptance census OFF vs ON with EVERY new acceptance hand-verified on the page;
  run with mig 166 in its shipping (OFF) state so the two date arcs are measured apart. Parked owner decisions: numeric
  2-digit years at the JS door ("15/12/25" stays refused, pinned); "Augu" keys to Aug (first-three-letters rule).

## The owner's questions answered today (so the next session does not re-answer them)
- **"Can I ship him the build as it is now?"** Yes, but wait for the date fix (now in) — it is a TEST build with all 51
  dark switches on incl. `format_class_join` (HELD for blast radius) and is not hardened. Told plainly.
- **"Two cores on one DB so two offices can teach?"** No: SQLite over a share corrupts; each core's secrets (audit-chain
  signing key, encryption cache) are DPAPI-bound to its PC; both would fight over the inbox/filed folders. Recommend ONE
  core + teaching through the client.
- **"Separate teach tool, or add it to the search client?"** Add it to the search client (login, TLS, page viewer, theme
  already there). Missing either way = the wizard's SAVE steps over `/v1` (create doc type, promote to template, save each
  drawn field mapping, box read-back OCR, confirm) — admin only, entitlement-gated. Medium-large; Oracle-vetted design
  first. **NOT started — awaiting the owner's go.** Design hint: the Teach wizard (`src/windows/teach/`) could follow the
  Search precedent — a shared module + injected transport (`src/windows/shared/search-ui/` pattern, generated client copy,
  drift pins) — ask eric (Electron) for the module/transport split and gary/reggie for the `/v1` route contracts, then the
  Oracle. The `/v1` side needs `API_CONTRACT_VERSION` + `client/apiClient.js CLIENT_CONTRACT` bumped in lockstep (MINOR).

## NEEDS YOUR APPROVAL / the queue (owner decides the order)
1. **Ship the customer the `18bd9a2` pair** (above). Nothing else needed from the code side.
2. **Teach over the client** — say go → design (eric + gary/reggie → Oracle) → slices. See above.
3. **Flip gates owed:** mig 166 `template_date_invalid_yield_lowconf` (heal-vs-mislead census + Oracle) · mig 167
   `date_forms_wide` engine half (C5 above) · the three census-passed switches awaiting the owner's go (migs 159 / 156 /
   143 — `docs/DARK_SWITCH_LEDGER.md`).
4. **Tidy-ups / small:** delete the dead inline workflow provider (`pendingfeatures.md` 2026-09-14 entry; its own commit) ·
   the Oracle's non-blocking notes on 1.4.0 (banner + assign-form stacking; 403 wording) · confidence pips first paint (done
   2026-09-13 night — verify still) · the persistent render worker (LATER slice; small reads only, with timeout/kill/
   restart/fallback/quarantine).
5. **Older owed items:** the two security items (Settings-backup restore accepted a fabricated device fingerprint on an
   unlicensed machine — Chris card 7 of 2026-09-09; `/v1` login skips the forced temp-password reset) · Quick File /
   Departments D2 list-reader sweep (must be COMPLETE to be safe) + the UIs · the hardened `build` flip after the owner's
   click-through · Learning Repair on the poisoned invoice dates (#42/#25/#27/#40).

## Commands that worked today (copy these)
- Pins: `npm run test:pins` (~140 s; 363 files). One pin: `node <path>`. Python pins under BOTH interpreters:
  `py -3.12 python_backend/tests/test_date_forms_wide.py` and `./vendor/python/python.exe python_backend/tests/test_date_forms_wide.py`
  (pypdfium2 differs: dev 5.9.0 / vendored 5.10.1).
- Shared search screen: edit ONLY `src/windows/shared/search-ui/*` → `node scripts/sync-client-search.js`; harness
  `electron.exe scripts/search-window-harness.js [--client] [--workflow] [--server-contract 1.5.0] [--role edit] [--race]`;
  pins `node src/windows/search/test_search_window_functional.js` + `node scripts/test_client_search_popout.js`.
- Builds (need EVERY repo Electron closed first — check `Get-Process electron,ScanFinder,node | ? Path -like '<repo>*'`;
  kill by PID/Path, NEVER by a cmdline substring): `npm run build:test` (core, ~2 min) then `cd client && npm run dist`
  (~35 s). Smoke the packaged core from `dist\win-unpacked`: `SCANFINDER_SMOKE_DIR=<throwaway dir> ./ScanFinder.exe
  --smoke-boot` (prints `smoke-boot identity {...}`) and `... --smoke-windows` (prints 14 windows ok). **NEVER run
  `scripts/verify-release-artifact.js` on a `build:test` artifact** — it refuses on source-protection and RENAMES the
  installer `*.REFUSED.exe`.
- Relaunch the dev core: `Start-Process cmd -ArgumentList '/c','set TEST_BUILD=1&& npm start'` (+ `-RedirectStandardOutput`);
  the client: `client\node_modules\electron\dist\electron.exe .` from `client\`. Kill dev-start node launchers + every
  electron PID under the repo before a restart, else single-instance bounces to OLD code.
- Commit messages: write them with the Write tool and `git commit -F <file>` (PowerShell `Out-File -Encoding utf8` adds
  a BOM to the subject). End with the attribution lines the session prompt gives.

## Standing constraints (owner rules — keep every one)
- **Plain, non-technical explanations to the owner** (`feedback_simple_explanations`). Short.
- The live DB `%APPDATA%\ScanFinder\docusnap.db` is BLOCKED to Claude's script tools (copy `.db`+`-wal`+`-shm` to scratch
  to inspect; never write). The owner's live app/filesystem is OFF LIMITS; Chris (the customer persona) always runs in a
  sandbox (throwaway userData + own port); his findings never become changes without the owner's go.
- Advisor + Oracle gate before AND after a build; deferred items → `pendingfeatures.md`; DARK pattern for engine changes
  (setting seeded OFF by migration + `TEST_SWITCH_KEYS` + env in `_reconcileEnv` + count pins in
  `test_migration137_test_switch_reset` / `test_migration163_deskew_false_absent_reflag` + a ledger row).
- `/v1`: DTOs path-free; never log/echo credentials or the find query `q`; the pop-out never receives the session token;
  caps flip only on 426/402 (`docRead`: a 404 is a hidden doc, cap kept).
- The shell guard blocks `Remove-Item` with a spaced quoted path (use `[System.IO.File]::Delete`). `core.autocrlf=true`
  → CRLF on disk (tests normalise). Bash heredocs strip a backslash level (use the Write tool).
- Pin exact call COUNTS in harness pins; the harness world has 3 pages for doc 1; pins that literal-check source must be
  updated when a function is renamed (happened four times today).

## Pointers
- `HANDOVER_2026-09-13_LATE.md` (ADDENDA 2-7 = everything today, in order) · `docs/oracle_log.md` 2026-09-14 (four
  verdicts) · `docs/detached-client.md` (1.4.0 / 1.5.0 / 1.6.0) · `docs/DARK_SWITCH_LEDGER.md` (date_forms_wide row) ·
  `pendingfeatures.md` 2026-09-14 entries · `docs/CHRIS_FULL_APP_REVIEW_2026-09-14.md` (outcomes table).
- Memory: `project_date_forms_wide_20260914.md` · `project_client_search_parity_20260913.md` (S0-S4 + 1.4.0/1.5.0/1.6.0
  + the build/verifier lessons) · `project_client_quickfile_and_search_parity_20260913.md` (mig 166).
