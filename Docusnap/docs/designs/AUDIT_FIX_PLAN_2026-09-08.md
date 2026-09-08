# Audit fix plan — 2026-09-08

Source: `docs/PRE_DEPLOYMENT_AUDIT_2026-09-07.md` (4 auditors + Oracle SIGN OFF WITH CORRECTIONS, `docs/oracle_log.md:2715`).
Designs: gary (P0-1), eric (P0-3 / P1 / P0-2 interim), oscar (P2 bundle + the cold gate), consolidated by main Claude.
Status: **Oracle SIGN OFF WITH CONDITIONS C1–C10 (2026-09-08, §9) — conditions are folded into the slices below and marked
`[Cn]`.** No code changed. Branch `feat/teach-side-overnight`, HEAD `eeb8d56` (3 audit-doc commits unpushed).

## 0. Facts verified today that CHANGE the audit (read first)

| # | Finding | Evidence | Consequence |
|---|---|---|---|
| F1 | **13** TEST force-ON blocks, not 12 — **mig 106** (`database/index.js:2493`) force-ONs `format_variance_relax`, `template_fragment_containment_yield`, `template_locate_role_qualifier`, `deskew_corrob_autofile`, `quick_reprocess_enabled`, `watch_separate_enabled` and is missing from every revert list | grep `TEST-BUILD` in `database/index.js`; Oracle re-traced `:2506-2519` | Revert list = **106/108/110/112/114/116/118/123/124/126/128/134/136** → **26 distinct keys** |
| F2 | `money_sign_capture` (forced by mig 123) is ALSO a legit fresh-install default in `ALL_ON_DEFAULTS_93` (`:246`); seeded 'false' by mig 72, mig 93 is INSERT OR IGNORE (`:2286-2288`) — that is WHY 123 had to force it on the owner's old DB | gary + Oracle | The reset must EXCLUDE it. No other of the 26 is in mig 93/98/103 |
| F3 | `deskew_corrob_autofile` / `watch_separate_enabled` have NO seed row anywhere — only mig 106 writes them. **Oracle completion:** nine of the 26 DO have Settings toggles (`settings/renderer.js:743-800`, `:1238-1243`) — all SFDEV-gated (`DEV_SWITCH_IDS :1071-1092`) except possibly `angle-compose-null-abstain-toggle` (verify) | gary + Oracle | 'false' row == absent == OFF. "No non-test road" really means "no CUSTOMER road": a one-shot reset is right; a startup sweep would fight the SFDEV hand |
| F4 | Five existing pins REQUIRE the tainted state: `test_migration{123,124,134}_test_force_on.js`, `test_migration125_126_convention.js:30`, `test_migration127_128_parallel_import.js:30` | gary | They go with the blocks |
| F5 | The documented live DB `%APPDATA%\ScanFinder\docusnap.db` **does not exist** today (owner moved/deleted it). Newest copies: `%APPDATA%\ScanFinder7.9.26` (mig 121, 541/453 docs, **15/26 ON**); `TESTING/_measure/live_backup_20260907_before_repair.db` (mig 126, 147 docs, **19/26 ON**) | read-only sqlite queries | A fresh launch on current code re-runs 106…136 → contaminated again. The reconciliation MUST be a migration, not a one-off script. **Owner: where is the mig-136 DB?** |
| F6 | Both post-reset copies have **NO `ocr_dpi` row** → the owner's live app since the 09-06 reset ran at the **300** code default; the 31-Aug DB had `ocr_dpi=200`. The 09-06 harness arms forced `OCR_RENDER_DPI=200` (`HANDOVER_2026-09-06.md:54`) | queries + handover | The 09-06/09-07 LIVE exhibits (placement root cause, the everything-ON installers) were at 300 = the customer operating point; the harness arms were at 200. Split operating points — P2-1 heals it, with a hold wave (§4 3.1) |
| F7 | The detached client ships **no `.node`** (`client/package.json` has no `dependencies`) | eric | Audit P0-2's "swap a .node in the client" is wrong; its real exposure is a user-writable exe+asar (`perMachine:false`) |
| F8 | ~~`onHeadersReceived` does not fire for `file://`~~ — **HYPOTHESIS, over-claimed** (Oracle: it has fired for `file://` since the network-service era) | eric / Oracle | Drop the header-CSP move on VALUE grounds (meta and header live in the same asar; `main.js:1072-1085` is the real nav defence), not on mechanism |
| F9 | `stress_test/customer_corpus_score.js` runs migrations on its throwaway DB (`:81`) but spawns Python with **no `env`** (`:261`) → shell env inherited; the DB's switch rows never reach Python | gary + Oracle | Its arms run at ENGINE defaults, not the fresh-install `ALL_ON_DEFAULTS_93` bridge (22 vars). Fixed by [C6]: spawn with `buildWorkerCommand(db,…).env` |
| F10 | `cross-env` is not a declared dependency; `package.json` scripts run on cmd.exe | eric | Env composition lives in a Node orchestrator, not in the script string |
| F11 | The fuses ALREADY ride the plain `npm run build` (`package.json:20-26`); the NEW bricking risk of a hardened default is bytecode + string-array, and the hardened path has never been booted on an install (owner smoke for Builds 1-3 still OWED) | Oracle | Smoke BEFORE flipping the default [C5] |

## 1. Naming — ONE knob

`TEST_BUILD=1` (supersedes the audit's `ALLOW_TEST_MIGS`): passes the migration gate, stamps `BUILD_REV=<rev>-TEST`
(filename + About box), sets `extraMetadata.testBuild=true`, and (slice 1.4) arms the test switches at runtime.
The release orchestrator DELETES it from the env. A customer box can never carry an unlabelled test build.

## 2. Phase 1 — P0-1: gate + reconciliation (the #1 blocker; Oracle: co-equal)

### 1.1 Sentinels + `scripts/check-release-migrations.js` + its pin — S (~1.5 h)
- One machine-readable line above each block: `// @TEST_BUILD_MIG <N> keys=<a,b,c>`. Legit default flips (mig 93's
  UPDATE, 98, 103, 70/80/81/89/91 sites, and the new 139) get `// @DEFAULT_FLIP <N> keys=<…>`.
- **The discriminator is the KEY, not the SQL shape [C4].** The gate loads `TEST_SWITCH_KEYS` (1.2) and refuses:
  (i) any `@TEST_BUILD_MIG`; (ii) belt — prose `/TEST-BUILD|TEST-ONLY \/ REVERSIBLE|revert before (ANY )?customer build/i`;
  (iii) belt — any UPSERT/UPDATE-to-'true' in a block with no `@DEFAULT_FLIP` label; (iv) any
  `database/modules/test_migration*_test_force_on.js` present; **(v) any `@DEFAULT_FLIP keys=` ∩ `TEST_SWITCH_KEYS`**
  (the label is not a bypass); **(vi) a scan of `src/main.js` + `database/**/*.js` (non-test) for
  `setSetting(<key>,'true')` / `UPDATE settings SET value='true'` / `INSERT OR REPLACE` / `excluded.value` /
  parameterised `run(k,'true')` against the list** (`src/main.js:1324` is a live example of the idiom);
  **(vii) the repo `package.json` carries no `testBuild`.**
- Hits + `TEST_BUILD` unset → list each with file:line, exit 1. `TEST_BUILD=1` → pass.
- Placement: FIRST in `build`, `build:store`, `build:test` (cheapest, highest stakes, before any compile).
- Pin `scripts/test_check_release_migrations.js`: exported `scan(files)` on fixtures — one RED fixture per belt (i)–(vii)
  before the belt lands; against the real tree expects 0 hits — **RED today (13)**, green after 1.2; `TEST_BUILD=1` exits 0.
- Seam closed: a dev can no longer ship a force-ON of a listed key by any SQL idiom, in any non-test file, under any label,
  without `TEST_BUILD=1` in the shell.

### 1.2 `TEST_SWITCH_KEYS` + mig 137 one-shot reset + delete the 13 blocks + 5 pins — S–M (~2.5 h) — DONE
Built as designed (1.1 + 1.2 landed 2026-09-08): keys module `database/dark_switches.js` (24), gate green on the real repo,
mig 137 in, the 13 blocks deleted (221 lines), 21 ⚑ FLIP GATE lines carried onto the seed-OFF migs (the two seedless keys carry
theirs in the keys module), pins 123/124/134 deleted, 125/127 trimmed + renamed, `test_migration137_test_switch_reset.js` added.
- Export `TEST_SWITCH_KEYS` (**24** = the 26 minus `money_sign_capture` [F2] minus `ocr_parallel_import_enabled` [C2])
  beside `ALL_ON_DEFAULTS_93`. `ocr_parallel_import_enabled` leaves the list because mig 139 (3.3) becomes its SOLE writer —
  otherwise 1.4's disarm on the first release launch would silently un-promote it (the S2 seam, now a bug avoided).
- Pin: `TEST_SWITCH_KEYS ∩ every UPSERT-'true' promotion (93 / 98 / 103 / 139) = ∅` [C2].
- **Mig 137**: UPSERT each of the 24 to 'false' (the mig-121 shape), stamped, runs ONCE per DB. Delete blocks
  106/108/110/112/114/116/118/123/124/126/128/134/136 (old DBs keep their `migrations` rows — harmless) and the 5 pins (F4).
  Mig 121 (a legit discharge) stays.
- **Before deleting a block, move its per-arc flip conditions into the matching seed-OFF mig comment** (107/109/111/…/135)
  in `database/index.js` [C1] — not `pendingfeatures.md`; the flip gate must live beside the switch it gates.
  Mig-137 pin asserts no `applied.has(1xx)` UPSERT-'true' of a listed key remains.
- Backward-compat: customer DBs never had the rows or had 'false' → no-op; owner DBs (15–19 ON) → OFF once.
  Operator choices made AFTER 137 stand (never a startup sweep — that would undo an SFDEV hand every launch). Invariant preserved:
  DARK == seed-OFF == engine default; the Settings→env road (`handler.js:609` pattern) is untouched.
- **Ordering invariant (binding):** no future NUMBERED force-ON at all — a new DARK key is added to `TEST_SWITCH_KEYS`
  (its seed-OFF mig stays) and armed by 1.4. A numbered force-ON < the newest reset is silently undone; one > it
  re-contaminates. Gate belts (ii)/(iii)/(vi) refuse both.
- Pin `database/modules/test_migration137_test_switch_reset.js` (Electron-as-Node): fresh `:memory:` → all 24 'false',
  `money_sign_capture` 'true', 137 stamped; fixture "DB at 136" (run migrations, delete the 137 row, set 19 keys
  'true', re-run) → all 'false'; `resolve_ref_near_miss` ends 'false' (121→124→137); a manual 'true' written AFTER 137
  survives the next start (the pinned trade-off: one-shot, never a sweep).

### 1.3 Env-road unit + the first NON-vacuous realdoc arm — M (machine time) — DONE, PASS
2026-09-08: `src/modules/processing/test_env_road_post_reset.js` (21 of 24 keys map to a spawn var; none set post-137; all set on
a 136 fixture; 'false' == absent). Realdoc arm on the 09-07 backup (147 confirmed docs, files present), `TESTING/_measure/
reset_arm_20260908/`: arm136 = the backup as-is (18/24 ON, harness mirrored **127** spawn vars), arm137 = the same copy after
mig 137 (0 ON, **111** vars — 16 fewer, the arm was live). `stress_test/reset_arm_compare.js` → **PASS: wouldFile 129/129
identical, 0 extra holds, 0 new filers, 0 value diffs.** Both arms report the SAME 4 SILENT invoice-date rows (#42/#25/#27/#40)
= the known poisoned-GT docs from `HANDOVER_2026-09-07.md`, not a code delta. The owner's mig-136 DB (F5) would be a larger
re-run; the fallback backup was sufficient for the C8 question.
- Unit: `_reconcileEnv(db)` + `_anchorCropEnv(db)` on a post-137 copy yield none of the 22 Python-side env vars.
- Realdoc: `RR_APP_ENV=1 OCR_RENDER_DPI=200 RR_DB=<db.backup() copy after 137>` vs the same copy at 136 (19 keys ON).
  **Metric [C8]: `wouldFile(137) ⊆ wouldFile(136)` AND value-diffs = 0 on the intersection.** Extra holds on the OFF arm are
  EXPECTED (OFF arms hold more by design), not regressions; the regression class is 137 FILING what 136 held, or filing a
  different value. "Zero per-field delta" is the wrong sign for this pair.
- `realdoc_regression.js:105-106` mirrors three env builders, NOT `_ocrDpiEnv` → 1.3 is env-driven for DPI: **pin that
  `RR_APP_ENV` mirrors `_ocrDpiEnv`, or document the explicit `OCR_RENDER_DPI=200` as load-bearing** [C9].
- Owner supplies the mig-136 DB (F5); fallback = the 09-07 backup (mig 126, 147 docs).
- HYPOTHESIS to carry (S5): the reference DB's confirmed values were accumulated everything-ON (rubber-stamp class) — 137
  cannot un-poison GT; a 137-files-what-136-held case needs a page render before it counts as a regression.

### 1.4 Runtime arming (the owner's re-arm road) — M (~2 h) — DONE
Built 2026-09-08 as `database/build_arming.js` (`armTestSwitches(db, identity)` at the end of `runMigrations`, unstamped;
`resolveIdentity()` = packaged `package.json.testBuild`/`buildRev`, dev = `TEST_BUILD=1` + stable rev `dev`), `scripts/build-electron.js`
bakes `extraMetadata.testBuild=true` + a `-TEST` rev under `TEST_BUILD=1`, the SFDEV `set-setting` road and `scripts/arm-test-switches.js`
stamp `manual@<rev>` [C3]. Refinement over the draft: a release build disarms only a marker written by a DIFFERENT build, so a same-build
SFDEV hand is never fought; dev uses rev `dev` so a new commit never disarms the owner's dev DB (`--off` is the explicit dev disarm).
Pin `database/modules/test_runtime_test_arming.js`.
- After the migrations (the unconditional-heal slot, `index.js:~2979`): if `package.json.testBuild`
  (or `!app.isPackaged && TEST_BUILD=1`) and `settings.test_build_armed_rev !== buildRev` → UPSERT `TEST_SWITCH_KEYS`
  'true' + stamp the marker; if NOT a test build and the marker exists → UPSERT 'false' + delete the marker. Customer DBs
  never carry the marker → never touched.
- **Every interim arming road writes the marker too [C3]:** `scripts/arm-test-switches.js <db>` (dev) AND the SFDEV toggles
  (`settings/renderer.js:743-800`) stamp `test_build_armed_rev`, otherwise mig 137 is already stamped on that DB, a later
  release build never disarms, and last night's "reference DB ON forever" seam re-opens through the plan's own back door.
- Pin: arm once per rev; auto-disarm on a release build; customer DB untouched; interim arming leaves the marker.

## 3. Phase 2 — P0-3 release discipline + P1 small fixes (eric)

### 2.1 P1-7 deskew temp name — S
`handler.js:5458` → `` `ds_deskew_${Date.now()}_${process.pid}_${_ocrTmpSeq++}.png` `` (`_ocrTmpSeq` declared `:5364`, same scope as `ocr-page-words :5425`). Zero risk.

### 2.2 P1-6 CSP appends (meta only) — S — DONE (client only)
**Corrected at build time:** all 40 core meta CSPs (`src/windows/**/*.html`) ALREADY carry `form-action 'none'; base-uri 'none'`
(multi-line `<meta>` tags hid them from the audit's line grep). Only `client/renderer/index.html:6` lacked them — appended.
Pin `scripts/test_csp_directives.js` scans every meta CSP under `src/windows` + `client/renderer` for both directives.
The one `<form>` (`main/index.html:852`) submits via JS `preventDefault` (`main/renderer.js:538`) → safe. Header CSP dropped on
VALUE grounds (F8): same asar, same trust boundary; not worth an `app://` scheme on ship eve.

### 2.3 Client `perMachine:true` — S (P0-2 interim) — DONE, with a seam found
`client/package.json:32`. Program Files = admin-write; cost = a UAC prompt at install (matches the core). Boot-time hash-checks
are WRONG LAYER unsigned (the checker lives in the same writable tree). Core `.node` under Program Files = same trust boundary
as the exe → nothing until signing (business-gated, §7).
**Seam found at build time (pre-existing CORE bug, fixed in the same slice):** electron-builder's uninstaller runs a per-machine
uninstall under `SetShellVarContext all` (`multiUser.nsh` `setInstallModePerAllUsers`) and inserts `customUnInstall` (template
`uninstaller.nsh:157`) BEFORE its own `SetShellVarContext current` flip (`:234`), so `$APPDATA`/`$LOCALAPPDATA` in our
`customUnInstall` resolved to `C:\ProgramData` — the core's "Also remove all ScanFinder data" YES path wiped folders that do not
exist. That is the owner report `baa25dd` chased as locked files. Fix = the template's own idiom in BOTH `installer.nsh` files:
`${if} $installMode == "all"` → `SetShellVarContext current` before the first wipe, `all` restored after the last. Pin
`scripts/test_uninstall_shell_context.js` (code lines only; both installers per-machine). **Owner drill owed (§7.9):** uninstall +
YES on the next build → `%APPDATA%\ScanFinder` gone.

### 2.4 node-forge `1.3.1` → fixed `1.4.0` + notices — S
API surface used is stable core (`certService.js:71-176`, `cert-tool/certgen.js:27/68/87`). **ASSUMPTION: a `1.4.0` exists — `npm view node-forge versions` first.**
Bump `package.json:133` exact; cert-tool `^1.3.1` self-resolves (unshipped). Re-run `gen-third-party-notices.js`; the BSD-3 election
(`check-licenses.js:22`) reddens if the licence string changed — correct behaviour. Pins: `test_certservice.js`, `test_cert_wizard.js`.

### 2.5 `scripts/check-npm-audit.js` + `scripts/audit-allowlist.json` — S (release-only)
`npm audit --omit=dev --audit-level=high --json`, root only (client has no prod deps; cert-tool unshipped). Allowlist entries
`{id, reason, expires}` are subtracted, printed loudly, written to the manifest; **expired entry = fail**; registry unreachable → fail
unless `AUDIT_OFFLINE_OK=1`.

### 2.6 `scripts/verify-release-artifact.js` — S/M (release-only, post-build)
`asar list dist/win-unpacked/resources/app.asar` → assert `/src/main.jsc` present, `/src/main.js` is the stub, **zero `.js` under
`/src/modules`, `/src/services`, `/src/lib`, `/database`** (NOT "no `src/**/*.js`" — `preload.js` + `src/windows/**` ship plaintext by
design, `harden-js.js:15-17`). Then `npx electron-fuses read --app dist\win-unpacked\ScanFinder.exe` must print the five fuses as
declared. **Then an automated boot smoke [C5]: launch `dist\win-unpacked\ScanFinder.exe --smoke-boot` (argv handled in `main.js`:
exit 0 after `whenReady` + DB open, else non-zero; 60 s watchdog; packaged-only argv, no UI).** Write `dist/release-manifest-<rev>.json`
(rev, sha, gates passed, allowlist used, smoke result).

### 2.7 `scripts/build-release.js` orchestrator + script flip + docs — M
- **Hardened-by-default** (same principle as `.pyc` default-on + `SHIP_PY_SOURCE=1`): the habitual command becomes fail-closed.
  ```
  "build":       "node scripts/build-release.js nsis"
  "build:store": "node scripts/build-release.js appx"
  "build:test":  "node scripts/build-release.js nsis --test"
  ```
- Release env: SET `HARDEN_JS=1 HARDEN_JS_STRINGS=1 CSC_IDENTITY_AUTO_DISCOVERY=false RELEASE_BUILD=1`; DELETE
  `TEST_BUILD SHIP_PY_SOURCE HARDEN_JS_NOBYTECODE` (a shell's leftover test env must not leak in). `SIGN=1` inverts the
  CSC flag so post-incorporation signing is one switch. **`HARDEN_JS=0` stays an explicit plain-release escape for bisecting [C5].**
- `--test`: today's plain path + `TEST_BUILD=1` + `BUILD_REV=buildRev()+'-TEST'` (`build-rev.js:15` honours the override).
- Order: 1 check-release-migrations → 2 check-vendor-python → 3 check-licenses → 4 check-npm-audit (release) → 5 compile-python-
  bytecode → 6 test_no_shipped_py_source → 7 build-electron → 8 verify-release-artifact incl. boot smoke (release). Separate scripts
  kept (own kill switches, standalone use); the orchestrator only sequences + composes env.
- **The flip of the default is the LAST commit of the phase [C5]:** first build ONE hardened artifact with today's explicit env, run
  2.6 (bytecode + fuses + boot smoke) + the owner's click-through on a clean install; only then land the script flip.
- Pre-flight `git diff --quiet package.json` before AND after (`build-electron.js:53-71` swaps `build.files` and restores in
  `finally`; a Ctrl-C between leaves it swapped — pre-existing).
- Docs: `MSIX_SETUP.md:168`, CLAUDE.md build notes + **retire every "revert list" line (mig 137 supersedes it)** [C10], `HANDOVER`.

## 4. Phase 3 — P2 efficiency bundle (oscar; Oracle re-tiered to pre-release QUALITY)

### 3.1 `_resolveOcrDpi(db)` + mig 138 `ocr_dpi=200` seed + pin — S
- One integer resolver (the `_ocrDpiEnv` parse, `handler.js:88-97`) feeding BOTH the env and the RAM budget — they cannot drift.
- Mig 138: `INSERT OR IGNORE INTO settings VALUES ('ocr_dpi','200')` (mirrors mig 101; Oracle: the right shape). Leave the three
  code-default-300 mirrors (`tesseract.py:45`, `_ocrDpiEnv :94`, `ocrCache.currentOcrRecipe :44`) untouched — the row makes them agree.
- **Cross-DPI witness audit (Oracle, traced — no NEW cross-DPI road):** every extraction spawn carries `_ocrDpiEnv`
  (`handler.js:1072/:3779/:3979/:5003/:5433`); the deskew retry (`process_docs.py:1287`) is same-process → same `_RENDER_DPI`
  (`tesseract.py:51`). Pre-existing env-less roads are all non-extraction: `_runRegion :5385` (draw-tool read-back, human-in-loop),
  `get-page-deskew :5466` (angle only), `landmarks.py:214` 216-DPI (locate only, `*_norm`); `reslice.py:288 dpi=200` is an
  identity-key default callers never pass (`engine.py:5030/5061`) — cosmetic. Harnesses that bypass the DB still need
  `OCR_RENDER_DPI=200` (known trap, unchanged; see [C9]).
- **HOLD WAVE to pre-announce [C10]:** the owner's pending docs carry stored reads at 300; after 138 they re-read at 200 and raise
  "Read differently after learning" holds (`rereadHolds.js:111`) — fail-toward-review, but say so in the handover/CLAUDE.md BEFORE the
  owner sees a wave. Templates taught post-reset at 300 will be crop-read at 200 (`template_mapper.py:2172/2317` `--dpi` hint,
  upscale floors `:3983`); norm geometry is DPI-free, crop OCR is not → the warm arm [C7] measures it.
- ASSUMPTION: no customer install exists — the only rowless DBs are the owner's post-reset ones (F6) and pilots. Say it in the mig comment.
- First-run "high-resolution scans?" nudge: LATER (the onboarding has no DPI step; Settings already sells High/Balanced/Fast).

### 3.2 P2-4 RAM cap ∝ DPI² — S
- `perWorkerBudgetBytes(dpi) = max(1.5 GiB, 1.5 GiB × (dpi/200)²)`; 200 → 1.5 GiB (identity with today's pin), 300 → 3.375 GiB,
  150 → floored. Arithmetic: A4 RGB page 11.6 MB @200 / 26.1 MB @300; 50 pages ≈ 0.58 GB vs 1.31 GB rasters + ~0.25 GB Python +
  ~0.3-0.5 GB tesseract (ASSUMPTION) → ~1.2 GB @200 (inside), ~2.1 GB @300 (over the old cap).
- Thread `dpi` through `ramConcurrencyCap(total, dpi=200)` `:2318`, `_effectiveWorkers(...) :2327`, the freemem tripwire `:2936`,
  call sites `:2844/:2933/:3099/:3274`. Not page-count-aware (C5 framing stands; `runWorker` spawn-failure is the backstop).
- Pin (`test_import_concurrency_cap.js`): existing 200 rows unchanged; add `budget(300)=3.375 GiB`, `budget(150)=1.5 GiB`,
  `ramCap(16 GiB,300)=3` (was 8), `ramCap(8 GiB,300)=1`, `ramCap(32 GiB,300)=7`.
- Seam: changes NO read. OMP derives from the SETTING (`_reprocessThreadCap`), never the capped worker count — the 08-31 decouple holds.

### 3.3 P2-2 single-doc import parallelism ON — S
- **Mig 139 UPSERT** promotion (mig-98 precedent), numbered AFTER 137, labelled `@DEFAULT_FLIP 139 keys=ocr_parallel_import_enabled`,
  and the key's SOLE writer (it is NOT in `TEST_SWITCH_KEYS` [C2]). `INSERT OR IGNORE` would be a no-op (mig 127 seeded 'false'
  everywhere: the dead-guard trap). Block 128 is deleted by 1.2. Pin: drop the 128 half of `test_migration127_128_parallel_import.js`,
  assert fresh → 'true', a later manual OFF survives, still not in `ALL_ON_DEFAULTS_93`.
- **Oracle C7 (09-07) is NOT satisfied by 3.2 alone** (3.2 sizes the cross-doc worker count; the pools arm on `nFiles===1`). The gate
  is three lines: `singleDocParallelEnv` gains `freeBytes`/`budgetBytes` and refuses when `freemem < budget(dpi) + 1 GiB` (the `:2936`
  idiom); optional `DS_OCR_POOL_WORKERS` export (already honoured, `anchor.py:1830`). Pin = a new truth-table row.
- Seam with the OMP guard: keep `ompExported` — pools floor `OMP_THREAD_LIMIT=1` only when absent (serial-uncapped vs pooled-
  capped = the 08-11 boundary-glyph class). On a `processing_concurrency=1` install the flip is inert — correct.

### 3.4 THE GATE — one cold run (three arms) + one warm arm + the realdoc road — ~half a day incl. ~3 h of runs
- **Harness fix first [C6]:** `customer_corpus_score.js:261` spawns with `{ env: buildWorkerCommand(db,…).env + arm overrides }` so the
  cold arms run at the FRESH-INSTALL operating point (the `ALL_ON_DEFAULTS_93` bridge, mig 137/138/139 applied on its throwaway DB),
  and the jsonl header states the operating point. Until then the arms run at engine defaults (F9) and A↔C is at the wrong point.
- Env (BOTH cold arms — identical): `CORPUS_DIR="C:/Users/cmccu/Desktop/ScanFinder Test Corpus" SET=both SAMPLE=100000 SEED=7
  OMP_THREAD_LIMIT=1`; DPI now comes from the throwaway DB's mig-138 row via `buildWorkerCommand`; the 24 switches from mig 137
  (absent env = '0'); never export empties (the `!= '0'` trap). `SAMPLE=100000` is required — `per=floor(SAMPLE/strata)` truncates.
- **Arm A** `TAG=eff_serial200` (baseline) · **Arm B** `TAG=eff_pools200` + `DS_OCR_PARALLEL_FULLPAGE=1 DS_OCR_PARALLEL_FIELDS=1`
  · **Arm C** (informational) `TAG=eff_serial300`, `OCR_RENDER_DPI=300` override.
- The PIN is A vs B: zero delta across `verdicts`, `*_got`, `confs`, `notes`, `methods` in
  `stress_test/out/customer_score_<TAG>.jsonl`. A vs C answers "was 300 better?" — 300 was never the validated point so it cannot
  be the baseline; report per-lane digital/scanned deltas.
- **WARM arm [C7]:** the post-137 `db.backup()` copy at 200 vs 300, switches OFF, pools OFF, via `realdoc_regression.js`
  (`RR_APP_ENV=1`, `OCR_RENDER_DPI` explicit per arm). **Ship 200 only if would-file value diffs = 0, or each diff is a render-verified
  heal.** This is the only place taught-at-300 templates meet a 200 crop read (3.1).
- No tool reads the ccs jsonl (`diff_arms.py` / `arm_method_conf_diff.js` consume `teach_run_ab` JSON) → a ~30-line
  `stress_test/ccs_arm_diff.js` is part of the gate commit.
- Determinism: B repeated 10× on `SET=scanned SAMPLE=40` (jsonl has no timestamps → sha256 10/10 identical; the 09-07 method) + B once on the full 605.
- Duration ASSUMPTION ~20-35 min/arm (147 realdoc docs = 7 min, `pools_gate_20260907_chain.log`). Log to `TESTING/_measure/efficiency_bundle_<date>/`.
- PASS: both cold arms `Processed 605/605`; A↔B 0 diffs; 10/10 hashes; C reported; warm arm would-file diffs 0 (or render-verified);
  3.2 pins green; one owner glance at Settings' "memory limits… N workers" at 200 vs 300.
- Together with 1.3 this discharges the Oracle's "cold-DB corpus run at {DPI 200, parallel ON, switches OFF}": the cold arms pin the
  fresh-install point, 1.3 proves the DB→env road on the owner's data, the warm arm prices the 300→200 move.
- Then `docs/oracle_log.md` entry + `docs/extraction-pipeline.md` perf note ("customer DPI is 200").

## 5. Phase 4 — P1-2 vendored Python pin — M (build machine only)
Commit `python_backend/requirements.lock` (pinned + hashes; **Pillow first**, pypdfium2 second); `check-vendor-python.js` asserts exact
versions (today it checks importability only, `REQUIRED` at `:34`); a quarterly review line in `NIGHT_RUN.md`. Needs `vendor/python` present
(not in this checkout) → owner's build machine.

## 6. Deferred (explicitly OUT of the pre-release set)
- **P2-3** deskew bitmap reuse — `process_docs.py:1287` re-calls `extract_text_and_images`; reuse changes which pixels heal → its own realdoc
  M=0, impossible until 1.2 un-contaminates the DB. Post-1.3.
- **P2-5** persistent Tesseract (`tesserocr` MIT over Apache-2.0; bundled wheels need the vendor licence gate) — read-path engine swap,
  byte-identical realdoc gate, post-deploy.
- **P2-6** lazy preview render — not a read path; user-visible change on ship eve; ride a later build.
- **P0-5** `/v1` temp-password + **P1-8** doc-level access control — gate ONLY the LAN add-on (Oracle correction 4); design arc for P1-8.
- **P3** refactor program (engine decomposition, switch sprawl triage incl. deleting NEVER-flip switches, renderer splits, `_swallow`, `getSetting` cache) — post-launch, each slice M=0-gated.
- Cython `.pyd` tier — own session (`pendingfeatures.md`).

## 7. Owner-only actions (nothing above substitutes for these)
1. **Push** `4c880e6`/`af62611`/`eeb8d56` (audit docs) — branch is 3 behind.
2. **Where is the mig-136 live DB?** (F5) — needed for slice 1.3's honest arm; otherwise the 09-07 backup (mig 126) is the fallback.
3. **Incorporate Six Mile Software Ltd** — gates the name-clean signed path (OV/EV or company Store account); interim = unsigned NSIS.
4. **DB-at-rest decision** (P0-4): encryption default-ON or a LOUD documented plaintext posture in first-run + privacy page. Not silent.
5. **Backend**: confirm production `DocumentRoot = public/` (P1-3); set `LICENSING_ADMIN_REQUIRE_2FA` ON (P1-4).
6. **Hardened smoke BEFORE the build flip** (F11 / C5): install the one explicit-env hardened artifact, run
   `npx electron-fuses read --app "dist\win-unpacked\ScanFinder.exe"` AND on the installed `C:\Program Files\ScanFinder\ScanFinder.exe`
   (both print the five as declared), click through every window on a clean box. Bricked = exits within ~1 s, no splash;
   `--enable-logging` shows an asar-integrity failure.
7. **Expect a hold wave after mig 138** (C10): pending docs re-read at 200 raise "Read differently after learning" holds once. Review-bound, not misfiles.
8. **Store**: replace the Partner Center placeholders; do NOT sign the appx.
9. **Uninstall drill** (2.3 seam): on the next NSIS build, uninstall the core + answer YES to "remove all data" →
   `%APPDATA%\ScanFinder` must be gone (it was not, per `baa25dd`); same for the client's saved-settings prompt.

## 8. Commit order (each its own commit, pinned, revertable) — Oracle-reordered [C5]
1. 2.1 P1-7 seq · 2. 2.2 CSP appends · 3. 2.3 client perMachine · 4. 2.4 forge bump + notices ·
5. **1.1 sentinels + KEY-based gate + pin (RED)** · 6. **1.2 `TEST_SWITCH_KEYS`(24) + flip conditions moved + mig 137 + delete blocks/pins (gate GREEN)** ·
7. 1.4 runtime arming + marker on every interim road (before any test session re-arms the owner's DB) ·
8. 1.3 env-road unit + realdoc arm on the post-137 copy (`wouldFile ⊆`, diffs 0) ·
9. 2.5 npm-audit gate · 10. 2.6 verify-release-artifact incl. `--smoke-boot` · **11. build ONE hardened artifact with explicit env → 2.6 green → owner §7.6** ·
12. 2.7 orchestrator + script flip + docs (retire the revert list) ·
13. 3.1 DPI resolver + mig 138 (+ the hold-wave note) · 14. 3.2 budget(dpi) · 15. 3.3 freemem clause + mig 139 ·
16. [C6] harness env fix + `ccs_arm_diff.js` → THE GATE (cold A/B/C + warm 200-vs-300 + determinism) + oracle_log ·
17. Phase 4 on the build machine. Then `npm run build` (now = release) → first customer-candidate installer.

**Definition of done for a customer build:** gate 1.1 green with `TEST_BUILD` unset · mig 137 on every DB · 1.3 `wouldFile(137) ⊆ wouldFile(136)` + diffs 0 ·
3.4 A↔B 0 diffs + 10/10 + warm arm diffs 0 · `verify-release-artifact` green (bytecode + fuses + boot smoke) · npm audit clean or allowlisted-with-expiry ·
owner §7.6 done · no `testBuild` in the repo `package.json`.

## 9. Oracle vet — 2026-09-08 — SIGN OFF WITH CONDITIONS C1–C10
Per item: 1 SIGN OFF W/COND · 2 SEND BACK (SQL-shape belt → KEY-based belt, C4) · 3 SIGN OFF W/COND (smoke before the flip, C5) ·
4 SIGN OFF W/COND · 5 SEND BACK as written (cold arms ran at engine defaults, C6; warm arm missing, C7) · 6 reorder (§8) · 7 F8 over-claimed.
- **C1** flip conditions of deleted blocks → the matching seed-OFF mig comment (`database/index.js` 107…135); 137 pin asserts no UPSERT-'true' of a listed key remains. → 1.2
- **C2** `TEST_SWITCH_KEYS` = 24: exclude `ocr_parallel_import_enabled` (mig 139 sole writer); pin ∩ promotions (93/98/103/139) = ∅. → 1.2, 3.3
- **C3** interim `arm-test-switches.js` + SFDEV arm write `test_build_armed_rev`. → 1.4
- **C4** gate belts (v)/(vi)/(vii), KEY-based; one RED fixture per belt. → 1.1
- **C5** hardened boot smoke (`--smoke-boot`, 60 s watchdog, in `verify-release-artifact`) + owner click-through BEFORE the `build` flip; `HARDEN_JS=0` escape stays. → 2.6, 2.7, §8
- **C6** `customer_corpus_score.js:261` spawns with `buildWorkerCommand(db,…).env`; operating point in the jsonl header. → 3.4
- **C7** warm arm post-137 copy 200 vs 300, switches OFF, pools OFF; ship 200 only on would-file diffs 0 / render-verified heals. → 3.4
- **C8** 1.3 metric = `wouldFile(137) ⊆ wouldFile(136)` AND value-diffs 0 on the intersection. → 1.3
- **C9** pin `RR_APP_ENV` mirrors `_ocrDpiEnv` (`realdoc_regression.js:105`) or document DPI as env-driven. → 1.3
- **C10** retire the "revert list" text; pre-announce the post-138 hold wave. → 2.7, §7
Resolved seams: S1→C1 · S2→C2 (was a live bug) · S3→traced, no new cross-DPI road, warm arm prices it (C7) · S4→C7/C10 · S5→C8 · S6→C5.
