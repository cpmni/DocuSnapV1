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

## LATE EVENING (2026-09-08, ~19:00-20:30) — re-audit vetted, belts gated, artifact rebuilt, pin runner, Chris round
**Read order for a cold start:** this section → `docs/PRE_DEPLOYMENT_AUDIT_2026-09-08_RERUN.md` (the Oracle's ordered
"BEFORE A CUSTOMER BUILD" list is the authoritative queue) → `docs/designs/KEYWORD_SUPERSTRING_GROW_2026-09-08.md` §7.1 →
`docs/CHRIS_FULL_APP_REVIEW_2026-09-08.md`. HEAD = `71e00ac`+ (see `git log`), **~45 commits since `eeb8d56`, NONE pushed** — the
push is the owner's decision.

**What happened, in order:**
1. **Re-audit written + Oracle re-vet = SIGN OFF WITH CORRECTIONS** (`ccbc557`). Every FIXED-VERIFIED traced at the source and held. His
   two real corrections were built the same evening: the boot-smoke identity was silently OPTIONAL (absent stdout line ⇒ the
   bundle-sees-package.json assert skipped; a temp-dir failure fell through to the REAL userData) → `9251551` makes it REQUIRED on a
   0-exit smoke, emitted to `smoke-identity.json` in a verifier-owned `SCANFINDER_SMOKE_DIR` (primary) + stdout (fallback), exit 4 on a
   userData failure; RED-first pins (6 new checks). His `BUILD_REV` claim was FALSIFIED at the source (already stripped, pinned).
2. **Both earlier hardened installers RETIRED** (`…-2017-dd9a790` and `…-1355-5b6c226` → `.REFUSED.exe`, the 1355 manifest deleted):
   every HARDEN_JS artifact before `5a4bd94` shipped a Review whose "File all ready" threw. Pointers corrected in the plan §7b,
   `HANDOVER_2026-09-08_BUILD.md`, `pendingfeatures.md`, and annotated in `HANDOVER_2026-09-08.md`.
3. **Name-grow belts C6 gate ran** (arms off / mapper / note on the post-137 reference copy). The FIRST mapper run caught a SEAM —
   doc 67 `customer_name` flipped from the correct keyword read to a WRONG `Kingfisher Print Stv` @94 at would-file: belt 2b's name
   defer-cap reached `_edge_cut_relocate`, whose code-contract shape consent clean-committed a re-seated garble. **Fixed `f4a32a7`**
   (a name defer-cap takes the cap directly, never the relocate; RED-first pin). Fixed-code gate: 129/129 would-file, 0 new filers,
   ref/date identical, ONE page-verified HEAL (#70 `Halcyon Leisure Gr` @94 silent-wrong → `Group`), 7 capped review-bound with no
   consensus change. **The keyword-superstring NOTE belt is VACUOUS on the corpus (fired 0/63)** — its flip gate is a corpus where it
   fires or an in-app census. All three belts stay DARK (mig 140).
4. **REBUILT the hardened artifact through `npm run build:release`** → **`dist/ScanFinder Setup 2.0.0-r20260908-1843-9251551.exe`**
   (sha256 `ba5c318d…`), manifest `problems: []`, identity via FILE (the first artifact on which the assert actually ran), html-asset belt
   green. **This is the owner's click-through target** (scripted list in the REBUILD section above).
5. **Pin runner** `npm run test:pins` (`scripts/run-pins.js`, `71e00ac`) — Oracle item 5: there was no runner and the new
   `scripts/test_*.js` location was never on the hand-run glob list. First sweep 325 files: 308 green, **17 red — ALL 17 reproduce
   identically at the pre-session baseline `eeb8d56`** (scratch worktree) — none is today's; queued in `NIGHT_RUN.md` with
   signatures (5 = the hand-rolled-schema class; `test_failure_creates_holding_row` says "the failure-row producer regressed" — VET FIRST).
6. **Chris round** (fresh sandbox, CDP 9223, PID 3200, same conditions as 09-03, full battery vs the 09-03 review) — report in
   `docs/CHRIS_FULL_APP_REVIEW_2026-09-08.md`; triage below when he returns. The sandbox stays running for the owner to poke.

**Traps added tonight:** a harness launched as `electron.exe script.js` WITHOUT `ELECTRON_RUN_AS_NODE=1` runs as a full app and NEVER
exits after the script ends (idle gpu/network children) — a chained arm script then hangs forever; harvest by row count + kill the PID.
`package.json` is STAMPED during a build (` M`) and restored after — never commit it mid-build. A pin whose negative regex is broader
than the block it guards trips on your own comment. The git root is `C:\GIT Projects` (the worktree checkout lands under `…\Docusnap\`).
Junctions: delete as reparse points (`[IO.Directory]::Delete`) BEFORE any recursive remove.

**NEEDS YOUR APPROVAL / OWNER QUEUE (in the Oracle's order):**
1. The scripted click-through on **`…-r20260908-1843-9251551.exe`** (Review → File all ready files one; Teach → box → read-back;
   every Settings tab; Search → preview → stamp; Help; About shows the rev; no SFDEV console error) + the uninstall "remove all data" drill.
2. Then say the word and I flip `build`/`build:store` to the release road (plan 2.7b, Oracle C5) + retire the "revert list" wording (C10).
3. Push decision (~45 local commits).
4. Learning Repair: invoice docs #42/#25/#27/#40 (poisoned dates) and the Ridgeway docs 8/19/21 (clipped customer names); doc 99 `ws-55718`.
5. Incorporate Six Mile Software Ltd → `WIN_CSC_LINK` signing; the DB-at-rest decision; backend `DocumentRoot=public` + admin 2FA ON.
6. `pip uninstall` the 9 dead Python packages on the build machine + relock with `--require-hashes`.
7. Belts flip (mapper pair) = your call with the §7.1 table, after the `_name_band_read` real-page pin; the note belt needs a corpus where it fires.

## CHRIS ROUND — TRIAGE (2026-09-08 evening; report verbatim in `docs/CHRIS_FULL_APP_REVIEW_2026-09-08.md`; NOTHING implemented)
**Verdict: "Yes — I'd keep using it."** Import distinctly quicker (10 scans ~16 s, 20 invoices ~37 s, "Using 7 workers"), every scary
button + Empty bin + the whole approval workflow with a second user told the truth, the Review-row overlap fix confirmed FIXED.
Sandbox left running (CDP 9223, PID 3200, signed in as Chris) for you to poke.
**Item-by-item vs 09-03:** #1 Import list "Confirm to file →" after a manual confirm = **SAME, NOT FIXED** (already on your vet list
since 09-03) · #2 watch bundle imported whole = SAME (the `watch_separate_enabled` soak gate is yours to run) but **WORSE on the name**
(NEW #1) · #3/#4/#5 SAME (cold install) · #6 percentages BETTER-BUT (NEW #4) · the row fix FIXED (side effect NEW #8) · Pelican now reads
`PI/25/3699` where 09-03 read `P1/25/3699` — Chris calls it "better by my eye" but **the page prints P1**: this is the documented 200-DPI
confusable trade-off from the cold gate (the 2 ref losses = O/0 · I/1 on serif scans; mig 138 seeds 200 on an empty install) and the
`ref_prefix_confusable_adopt` arc (mig 74) only heals it once history exists — flag for your DPI/budget decision, not a new bug.
**NEW cards (his rank) → my read for your vet:**
1. Bundle issuer read from page 3 while page 1 is shown (`Halcyon Leisure Group` on an Ironbridge page) — held at 40 % (fail-toward-review
   worked, nothing filed itself), but the honest cross-page provenance note + a Split nudge is a real design item → advisors + Oracle gate.
2. STATEMENT typed Invoice, blocked for an Invoice Number — **the exact exhibit of the DARK `type_uninstalled_heading_fold` arc** (mig 122
   seed OFF, in `TEST_SWITCH_KEYS`; census 20/20 Ironclad → Statement, 521 unchanged) — correctly OFF on a customer install after mig 137;
   its flip is your call (a "add Statement as a type?" nudge on the picker is the UX half).
3. "4 more to file by itself" beside "17 more ready" + "needs a layout" after 18 confirms — copy/counter semantics; queue.
4. Green "63 %" = ready vs "Check" = not; a confirmed doc still shows "63 % confidence" in Search — copy; queue.
5. The approver (Edit role, Sam) sees "Type —" / "Unknown" / "Document —" on the same filed invoice — POSSIBLE BUG in the mailbox's
   document card projection for a non-admin role; worth a read-only look before the vet (the sender sees the type + status).
6. Batch counters tell three stories (strip "1 of 20" with 7 workers; card counts the session; the watch strip repeats the manual batch)
   — copy; queue (the parallel default made "1 of 20" visibly wrong).
7. `✓ → undefined` in the import log = `src/windows/main/renderer.js:1158` prints `msg.new_filename` unconditionally (a needs-review
   doc has none) — cosmetic, pre-existing; the "Document Issuer box is still empty" note surviving a ⊕ fill — cosmetic.
8. The row fix's truncation makes 20 same-sender rows identical ("Northgate… / No… / Check") — side effect of `72ce811`; his
   suggestion (show the reference/date when grouped by sender) is sensible; queue.
**Not exercised:** Split on a multi-page doc, the Teach wizard, Defer/Print/Export/separator/Learning Repair/Straighten, a second watch drop.
