# HANDOVER — 2026-09-08 BUILD (the audit fix plan, built)

> Branch `feat/teach-side-overnight`. ~20 commits today, **NOT pushed** (the 3 audit-doc commits from the morning are
> also unpushed). Plan + ordered commit log: **`docs/designs/AUDIT_FIX_PLAN_2026-09-08.md`** (§7b = what landed, §8 = the
> order, §9 = the Oracle's C1-C10). Memory: `project_audit_fix_plan_20260908.md` + `project_audit_fix_build_20260908.md`.
> The owner's own uncommitted CLAUDE.md "LATEST — 2026-09-08" block (18 lines) is still in the working tree — not mine, not committed.

## TL;DR
The pre-deployment audit's Oracle top-3 are BUILT and pinned: (1) the TEST-force-ON migrations are gone — a KEY-based release
gate (`scripts/check-release-migrations.js`, `TEST_BUILD=1` single knob) runs first in every build, mig 137 reset the 24 DARK
switches on every DB, and a test build now arms them at RUNTIME (`database/build_arming.js`); (2) a release orchestrator
(`npm run build:release`) composes the hardened env, runs every gate and a post-build verifier with a real `--smoke-boot`; (3)
the efficiency bundle (mig 138 `ocr_dpi=200`, RAM budget ∝ DPI², mig 139 one-file import pools behind a memory-pressure clause).
Plus the P1 small fixes, node-forge 1.4.0 + a stale-notice refresh, a per-machine client, an exact-version pin of vendor/python, and
a pre-existing uninstaller bug found on the way (the "remove all data" prompt was a no-op under per-machine — `$APPDATA` resolved
to ProgramData). **One hardened artifact is built and machine-verified; the `build` default flip waits for YOUR click-through.**

## The artifact for you (Oracle C5 — the default flips only after this)
`dist/ScanFinder Setup 2.0.0-r20260908-1355-5b6c226.REFUSED.exe` (sha256 `fb04a396…`, manifest DELETED)
> ⚠ RETIRED 2026-09-08 evening — renamed `.REFUSED.exe`: the re-audit found every HARDEN_JS artifact shipped WITHOUT `listCaption.js`/`reviewReadiness.js` (Review's "File all ready" threw); fixed in `5a4bd94`, superseded by the rebuilt artifact named in `HANDOVER_2026-09-08_BUILD.md`. NOT a click-through target.
= `npm run build:release`: hardened (bytecode + string-array + .pyc), migration gate OK, licences OK, npm audit 0, verifier:
`/src/main.jsc` present, no plaintext module under src/modules|services|lib|database, 9 fuses read / 5 declared all as declared,
`--smoke-boot` exit 0. **Install it on a clean box and click through every window**; then uninstall + YES to "remove all data" →
`%APPDATA%\ScanFinder` must be gone (the `b8ff7d9` fix; it was not, per `baa25dd`). If both pass → flip `build`/`build:store` to
`scripts/build-release.js nsis|appx` (plan 2.7b) and retire the "revert list" wording in CLAUDE.md (C10).

## What changed for the switches (read this before touching a DARK switch)
- **No numbered force-ON migration ever again.** A new DARK key: seed it OFF (its own mig) + ADD it to `TEST_SWITCH_KEYS` in
  `database/dark_switches.js`. A test build (`npm run build:test`, or `TEST_BUILD=1 npm start`) arms every listed key once per rev;
  a release build disarms a DB armed by another build once (marker `test_build_armed_rev`); an SFDEV hand on the same build stands.
  Manual road: `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe scripts/arm-test-switches.js <db> [--off|--status]`.
- Excluded by construction: `money_sign_capture` (a real default) and `ocr_parallel_import_enabled` (mig 139 is its sole writer).
- Each deleted block's flip condition now sits on its seed-OFF migration as a `⚑ FLIP GATE` line (C1).
- The 13 old blocks were 106/108/110/112/114/116/118/123/124/126/128/134/136 — mig 106 was on NO revert list (6 keys incl.
  `deskew_corrob_autofile`, `watch_separate_enabled`, `quick_reprocess_enabled`).

## Gates run today
- **1.3 realdoc 136-vs-137 (the C8 metric): PASS** — the 09-07 backup (147 docs, all files present): arm136 (18/24 ON, 127 spawn
  vars mirrored) vs arm137 (0 ON after mig 137, 111 vars): wouldFile 129/129 identical, 0 extra holds, 0 new filers, 0 value
  diffs. The 4 SILENT invoice-date rows (#42/#25/#27/#40) are identical in both arms = the known poisoned GT. Files:
  `TESTING/_measure/reset_arm_20260908/` + `stress_test/reset_arm_compare.js`.
- **Env-road unit:** 21 of 24 keys map to a spawn var; none leak post-137; 'false' == absent (`test_env_road_post_reset.js`).
- **3.4 efficiency gate:** `TESTING/_measure/efficiency_bundle_20260908/` — warm arm (post-137 copy, 200 vs 300, switches OFF,
  pools OFF) and cold arms A/B/C + 10× determinism on the harness's NATIVE corpus (`Desktop\Customer Doc Test`, SAMPLE=300).
  **WARM ARM DONE (300 → 200 on the post-137 copy, 147 docs):** would-file 137 → 129 = 15 extra holds (the pre-announced hold
  wave), 7 NEW filers that are heals (below-floor/flagged at 300, correct ref+date at 200), 0 new misfiles (the 4 wrong auto-files
  are the poisoned #42/#25/#27/#40 in BOTH arms), and ONE render-verified regression on an OPTIONAL field: #117 `customer_name`
  read the address line under the company name at 200 (relocated crop one line low; the doc still files on the correct ref+date).
  **ORACLE C7 RULING (plan §9b): SIGN OFF W/COND** — the warm arm measured a DPI FLIP under geometry learned at 300 (the 7 "heals" and
  8 of the holds are one clip class re-rolled both ways; 5 Ironbridge type-refuse holds; #117 = the `anchor.py` relocate seat, not
  `value_quality`). With the comparer fixed (it compared arrays): 8 value diffs, all `customer_name`, 6 better at 200, 2 worse, 0 misfiles.
  **Built on the ruling (`bd63e16`): mig 138 seeds 200 ONLY for a DB with no templates and no confirmed docs; a taught DB gets an
  explicit 300 row** (so YOUR post-reset DB stays at 300 unless you pick 200 in Settings — the helper text now warns of the one-time
  review wave). **COLD ARMS DONE:** A (serial 200) ↔ B (pools 200) IDENTICAL on 288/288 docs (`--strict`); determinism 10/10 identical
  hashes (at OMP=1 — the product's ≥2-thread one-file import is a pre-existing LSTM residual, logged); A ↔ C (200 vs 300) a wash
  (+7/−4 for 200 overall; scanned lane +9/−6, the 2 ref losses page-rendered = the known O/0 · I/1 confusable class on serif scans).
  Verdict: the bundle ships as built. Details + per-lane tables: plan §7b.

## Traps found today (durable)
1. A shipped module must not be named `test_*.js` — the staged build excludes that pattern (esbuild "Could not resolve").
2. `spawnSync('npx.cmd', [...], {shell:true})` returned empty stdout — use the `@electron/fuses` API in-process; run `npm audit` as
   one command string.
3. `customer_corpus_score.js` reads `Desktop\Customer Doc Test` (11,000 PDFs; SAMPLE=300 SEED=7 convention), NOT the 605 corpus.
4. Bash heredocs strip a backslash level in this tool even when quoted — write patch scripts with the Write tool.
5. The core uninstaller's data wipe ran in `SetShellVarContext all` (ProgramData) — the template flips to `current` only around its
   OWN wipe; `customUnInstall` is inserted before that.

## Owner list (unchanged from the plan §7 + today)
Push the branch · click-through + uninstall drill (above) · locate the mig-136 live DB · incorporate the Ltd · DB-at-rest decision ·
backend DocumentRoot + admin 2FA · Store placeholders · **C7d: Learning Repair (or `gt_overrides`) for invoice docs #42/#25/#27/#40 so
the realdoc M reads 0 truthfully, and prune the 7 stale "GT override SKIPPED" rows** · the hold wave after mig 138 now applies only if
you CHOOSE 200 in Settings on your taught DB (mig 138 keeps it at 300 — C7a).

## Key files
`scripts/check-release-migrations.js` (+pin) · `database/dark_switches.js` · `database/build_arming.js` (+`test_runtime_test_arming.js`) ·
`database/index.js` migs 137/138/139 · `scripts/build-release.js` (+pin) · `scripts/verify-release-artifact.js` (+pin) ·
`scripts/check-npm-audit.js` + `scripts/audit-allowlist.json` · `scripts/check-vendor-python.js` + `python_backend/requirements.lock` ·
`src/main.js --smoke-boot` · `src/modules/processing/handler.js` (`_resolveOcrDpi`, `perWorkerBudgetBytes`, freemem clause) ·
`installer.nsh` / `client/installer.nsh` shell-context fix · `scripts/test_csp_directives.js` · `scripts/test_uninstall_shell_context.js`.

## REBUILD after the re-audit (2026-09-08 19:45) — THE click-through target
**`dist/ScanFinder Setup 2.0.0-r20260908-1843-9251551.exe`** (sha256 `ba5c318d1c2f2545d07f25782dbe7adf7a748bb8dd7e83b02e5e8eac8f4881f2`),
built by `npm run build:release` at HEAD `9251551` (the belts-seam fix `f4a32a7` + the smoke-identity correction `9251551` included).
Manifest `dist/release-manifest-20260908-1843-9251551.json`: `problems: []`, bytecode present, no plaintext modules, 5/5 declared fuses
as declared (9 read), boot smoke exit 0, **`smokeIdentity {testBuild:false, buildRev:20260908-1843-9251551}` via the FILE channel**
(`smokeIdentitySource: "file"` — the first artifact on which the bundle-sees-package.json assert actually ran), the html-asset belt green
(every shipped `.html`'s scripts resolve in the asar — `listCaption.js`/`reviewReadiness.js` present; the re-audit P0 is closed on a real
binary). Log `TESTING/_measure/release_build_20260908/build_release_2000.log`. The two earlier hardened installers are `.REFUSED.exe`.
**Owner: the scripted click-through (re-audit Oracle item 3) runs on THIS file** — Review → "File all ready" dialog opens and files one;
Teach → draw a box → OCR read-back; Settings → every tab; Search → preview → stamp; Help; About shows `Version 2.0.0 (20260908-1843-9251551)`;
no console error in the SFDEV trace. That pass gates the `build`/`build:store` default flip (plan 2.7b, Oracle C5).
