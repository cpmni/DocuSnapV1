# Pre-Deployment Audit — RE-RUN (2026-09-08 evening)

Re-run of `docs/PRE_DEPLOYMENT_AUDIT_2026-09-07.md` against today's HEAD after the fix build
(`docs/designs/AUDIT_FIX_PLAN_2026-09-08.md` §7b — ~30 commits: the release gate + mig 137 reset + runtime arming,
the release orchestrator + artifact verifier + `--smoke-boot`, the efficiency bundle with the Oracle's C7a guard,
node-forge 1.4.0 + the vendor lock, the P1 small fixes, the uninstaller shell-context fix, the name-grow belts).
Same four lenses (eric / gary / oscar / backend-packaging-deps) + an Oracle vet. Read-only; each finding tagged
**FIXED-VERIFIED / PARTIAL / OPEN / OWNER / NEW** with the line it was traced to.

## Headline
_(filled after the Oracle vet)_

## oscar — OCR / efficiency lane (P2)
| Item | Status | Where |
|---|---|---|
| P2-1 DPI 200 default (C7a-narrowed: fresh installs only) | FIXED-VERIFIED | `database/index.js` mig 138; one resolver `handler.js:94-104`; both branches pinned `test_migration138_139_efficiency.js` |
| P2-2 one-file import pools ON | FIXED-VERIFIED | mig 139; freemem clause `handler.js:1048-1052`; call site `:3022-3024`. Reach: pools arm only when configured concurrency > 1 (cap > 0), so a 2-3-core box never pools — safe, slowest boxes get none of the win |
| P2-3 deskew retry re-render | OPEN (deferred by design) | `process_docs.py:1287-1292`; plan §6 owns the M=0 gate |
| P2-4 RAM budget ∝ DPI² | FIXED-VERIFIED | `handler.js:2329-2354`, tripwire `:2957-2961`, both separation caps, `get-concurrency-info`; pin rows |
| P2-5 / P2-6 | OPEN by design (post-deploy) | — |

New code (the name-grow belts, DARK): `_name_band_read` is byte-identical OFF (the else-branch is the unchanged `_crop_and_ocr`) and
consumes the SAME page object/frame as the tight read (no half-compose seam); the recipe differs (band = no upscale, PSM 6, no `--dpi`).
**NEW → fixed `08073f6`:** the in-band predicate admitted a PSM-6 line that fused the name and address rows (2× the band, exactly 50 %
overlap) as ONE line — `_pick_band_line` now declines a qualifying line taller than 1.5× the band (pinned). Pin gap noted: the real
crop→PSM-6→pick road on a name row is unpinned (every band-pick test injects the hook) — a Pillow-rendered 3-line crop pin is owed before
the belts flip. The overhang floor is in NORMALISED units on the ~1100 px locate frame (DPI-invariant); a DPI-aware floor would be the
wrong layer — keep the floor, let the census rule. `ocrCache.currentOcrRecipe` carried its own DPI resolver → pinned equal to
`_resolveOcrDpi` (`08073f6`). Settings copy sold 300 as "most accurate" against the A↔C result → relabelled "very small print"
(`08073f6`). Determinism: A↔B at OMP=1 proves merge-order independence; the pools add no new non-determinism class (every tesseract call
runs at the same inherited thread count); a 10/10 rerun at `OMP_THREAD_LIMIT=2` is a pin, not a blocker. Budget at an explicit 300:
3.375 GiB/worker (16 GB → 3 workers, was 8) — safe, over-conservative for 1-2-page docs on the owner's only 300 install (option:
`0.9 + 0.6·(dpi/200)²` GiB after measuring worker peak RSS). `realdoc_regression.js` mirrors DPI only under `RR_APP_ENV=1` (C9,
PARTIAL — documented). **Ranked:** nothing in this lane blocks the build; before the mig-140 belts FLIP: the real-crop pin + a 200-DPI
census; owner's 300 install: decide split-budget vs 3 workers; determinism rerun at cap 2.

## eric — Electron / build / packaging lane
**NEW P0 (found + FIXED `5a4bd94`):** the hardened build deleted two renderer-served scripts. `harden-js.js` removed every esbuild-inlined
input, and `src/windows/shared/listCaption.js` + `reviewReadiness.js` are both `require()`d by main code (inlined) and loaded by `<script
src>` from Review/Teach — every `HARDEN_JS=1` artifact, including the click-through candidate `…-1355-5b6c226.exe`, shipped a Review whose
"File all ready" threw (`window.ReviewReadiness` undefined) and empty list-caption previews. Proven at the asar (16 of 18 shared scripts
present, those two absent). Nothing caught it: the smoke exits before any window; the verifier never looked at `src/windows`. Fix: the
renderer tree is never deleted by harden-js; the verifier resolves every `<script src>`/`<link href>`/`<img src>` in every shipped `.html`
against the asar (the STATIC-tag class only — CSS `url()`, `fetch`/`import()`, `<iframe|source>` are unchecked; acceptable because the tree is no longer deleted, so the belt is a regression tripwire, not the safety); the smoke prints `build_arming.resolveIdentity()` and the verifier asserts its `buildRev` equals the
packaged manifest's (closes the "does the bundled arming see package.json" assumption); a refused release renames its installer
`*.REFUSED.*`; the six dead legacy root files (`src/index.html`, `review.html`, `settings.html`, `renderer.js`, `review_renderer.js`,
`settings_renderer.js`) no longer ship. **The click-through artifact must be rebuilt.**

| Item | Status | Evidence |
|---|---|---|
| P0-2 unsigned / unpacked `.node` | PARTIAL → OWNER | client `perMachine:true`; fuses declared + read in-process (manifest 5/5); still unsigned (incorporation) |
| P0-3 default build plaintext | PARTIAL by Oracle C5 | `build:release` proven; `build`/`build:store` still plain until the click-through; **Store SKU had NO verifier → fixed `af8644f`** (verifier runs for appx too) |
| P1-1 node-forge | FIXED-VERIFIED | 1.4.0 in manifest/lock/tree; audit gate release-only |
| P1-5 fuses / bricking | FIXED at build, OPEN for the owner | smoke = boot-to-DB only (hence the P0 above); the owner click-through stands |
| P1-6 client CSP | FIXED-VERIFIED | `client/renderer/index.html:6`; pin covers multi-line metas; header half dropped (nav lockdown mitigates) |
| P1-7 deskew temp | FIXED-VERIFIED | `handler.js` `_ocrTmpSeq` |
| P2-4 budget ∝ DPI² | FIXED-VERIFIED | fail-safe direction |
| Uninstaller context | FIXED-VERIFIED | `installer.nsh` / `client/installer.nsh` = electron-builder's own idiom. Failing case (accepted, documented): a STANDARD user answering the credential prompt with another admin account → `$APPDATA` resolves to the wrong profile; electron-builder's own wipe shares it |

`--smoke-boot` is not a bypass (userData re-pointed before the lock; exits inside whenReady before login/licence; only splash+logger+IPC
registration precede it). Residuals: a splash may flash and an empty temp DB is left if a customer ever runs the flag (P3); `testBuild`
only bakes from `TEST_BUILD=1` (belt vii guards package.json); a stale `-TEST` rev under plain `build` mis-NAMES an artifact (closes when
`build` flips). **NEW → fixed `af8644f`:** `composeEnv` scrubbed only 3 keys — a leftover `SKIP_SMOKE=1` / `AUDIT_OFFLINE_OK=1` silently
weakened two gates → scrubbed, `--skip-smoke` / `--audit-offline-ok` are the only loud re-enables; the "SIGN=1 one switch" comment
over-claimed (Windows signing = `WIN_CSC_LINK`) → corrected. Open P2: the new pins are hand-run (no runner discovers them).

## gary — Python / DB lane
| Item | Status | Evidence |
|---|---|---|
| P0-1 gate | FIXED-VERIFIED | 7 belts, first in `build`/`build:store`, RED-per-belt pins |
| P0-1 reconciliation | FIXED-VERIFIED for customers · PARTIAL for the owner's dev DB | mig 137 one-shot (stamp inside the try, no partial-stamp road); dev rev `'dev'` never disarms after `TEST_BUILD=1 npm start` (pinned trade-off); no harness reads the marker |
| P1-2 vendor pin | FIXED-VERIFIED (+ widened `af8644f`) | exact match on the build machine only |
| P2-1/P2-4 DPI | FIXED-VERIFIED | `templates` is the right (broader) table; ASSUMPTION closed by reading: `runMigrations` runs inside `open()` before any onboarding write |
| P2-2 mig 139 | FIXED-VERIFIED | labelled, sole writer, excluded from the list, freemem clause |

**OPEN → FIXED `af8644f`:** `backupService.js` restore is a variable-key UPSERT excluding only licence/protected keys — a backup exported from a
TEST-armed (or pre-137) DB restored every DARK switch `'true'` on a customer DB with no marker to disarm it (the P0-1 class through
Settings→Advanced→Restore, invisible to the gate's literal-key belt). Now `TEST_SWITCH_KEYS` + `test_build_armed_rev` are excluded on export
AND restore (pinned). `corrected_to` road (the keyword-superstring note): review-bound end to end — Stage 4.5 skips noted fields, the unclip
refuses, class-F refuses `ct != val`, `trust.js` holds at every floor; seam (known class, logged for the mig-140 flip gate): the reprocess
merge reads ANY `corrected_to` as an operator act, so a machine K makes the clipped row sticky (not silent-wrong). `_name_band_read`: no
circular import, `.pyc` road fine, PIL page type matches; **dead-guard-shaped**: its real body runs under no pin (every band-pick pin injects
the hook) — a real-page pin (small PIL image + monkeypatched `_read_lines_full`) is owed before the belts flip. Vacuous-pin sweep: the
band-pick block (hook), `test_migration137:82` (held RED by the gate pin), `test_runtime_test_arming:79` tautological; real: the
keyword-note pin, the C7a fixtures. Ranked residuals: harness prints the marker + count of ON listed keys in `_operating_point` and refuses
an armed DB unless `RR_ALLOW_ARMED=1`; hoist the census `makedirs` to once-per-process.

## backend crypto / packaged exposure / dependencies lane
Headline: closed or deliberately staged; nothing weakened the plaintext-DB posture, the SOLID list, or the licensing backend (untouched).
| Item | Status | Evidence |
|---|---|---|
| P0-2 signing | OWNER | `CSC_IDENTITY_AUTO_DISCOVERY=false` baked; Windows signing = `WIN_CSC_LINK` (comment fixed) |
| P0-3 release road | PARTIAL (C5) | `build:release` proven; `npm run build` today = fuses + .pyc but readable JS, no audit, no verify. **Allowlist had no horizon → `af8644f`: `reviewed_by` + ≤90 days** |
| P0-4 plaintext DB | OWNER, not weakened | `--smoke-boot` creates an empty temp DB and exits before any licence/backend code; `arm-test-switches.js` writes only settings rows on an argv DB |
| P1-1 node-forge | FIXED-VERIFIED | exact in manifest/lock/tree; **cert-tool `^1.3.1` → exact `af8644f`** |
| P1-2 Python pin | PARTIAL → widened `af8644f` | was 7 of 23 compared → every lock line present in vendor; still hash-less (`--require-hashes` at the next re-provision); the 9 dead RapidOCR-era packages now warn (owner: `pip uninstall` + relock) |
| P1-3 / P1-4 backend | OWNER | 2FA opt-in unchanged; `keys/.htaccess` intact; not in today's diff |

New surface: the manifest carries no absolute path/username/secret (basenames + sha256 only); `arm-test-switches.js` is NOT shipped
(`scripts/` outside `build.files` and the hardened swap); `check-npm-audit` = one literal command string (no injection; inherits `.npmrc`
— trusted-machine assumption); notice gaps (bytenode, the sqlite fork, "Electron 31", the removed opencv line) → **fixed `af8644f`**.
SOLID-list regression sweep of every touched file: **stands** (preload, DTO, pinned TLS, Polar webhook, `license.json`, no
`shell=/eval/exec` in the Python diff).

## Fixed during the re-audit (2026-09-08 evening)
`5a4bd94` the hardened-build P0 + verifier asset belt + identity assert + REFUSED rename + dead root files · `af8644f` env scrub + flags,
Store verifier, allowlist horizon/reviewer, full-lock compare + dead-package warnings, cert-tool pin, notice attribution, backup
exclusion · `08073f6` (oscar) merged-line guard, recipe/resolver pin, Settings copy.

## Oracle vet — re-vet (2026-09-08 evening) — SIGN OFF WITH CORRECTIONS

**VERDICT: SIGN OFF WITH CORRECTIONS.** The re-audit's load-bearing FIXED-VERIFIED claims hold at the source; the P0 catch is real and
its fix is in the right layer. Three corrections, one of them a gate that can pass without proving anything, and a residual list re-ranked.
C5 ruling stands: `build`/`build:store` stay plain until the owner clicks through a **rebuilt** artifact — and no such artifact exists yet.

### Premise check (traced)
- `harden-js.js:99-105` keeps `build_js/src/windows/**`; `:70 external:['../package.json']` makes the manifest a RUNTIME require from both
  `src/main.js` and `database/build_arming.js:90` (same literal, same asar target). **Holds.** Seam (a): `SOURCE_PROTECTION_PLAN §BUILD 2
  :68` always kept `src/windows/**` + `preload.js` external and `:98` says renderers cannot be bytenoded — the renderer tree was plaintext
  by design; keeping two inlined inputs there is the correct scope, not a regression. `reviewReadiness.js` is the queue-readiness
  classifier, not the trust predicate — pre-existing exposure, unchanged.
- `verify-release-artifact.js:54-73` `htmlAssetProblems` + pin `:63` (a genuine RED on the P0 shape); `:85` identity assert; `:156`
  REFUSED rename; `build-release.js:54-67` runs it for nsis AND appx in release mode. **Holds — with the correction below.** "The whole
  class" is OVER-CLAIMED: it is the static `<script|link|img>` class; CSS `url()`/`@font-face`, `fetch`/`import()`, `<iframe|source>` are
  unchecked. Acceptable only because harden-js no longer deletes the tree — say so.
- `build-release.js:44` scrubs 6 keys, `:46` HARDEN_JS=0 escape after the scrub, `:70-75` applyFlags loud. **Holds.** *(The Oracle also
  claimed `BUILD_REV` is not scrubbed so a leftover `-TEST` rev names a release `-TEST`: **FALSIFIED at the source** — `composeEnv('release')`
  strips a trailing `-TEST` (`build-release.js:49`, pinned "a leftover -TEST rev is stripped"). A leftover NON-test `BUILD_REV` is the
  documented release input (`BUILD_REV=<version> npm run build`), not a hole — P3 traceability only.)*
- `backupService.js:51-59` `_settingExcluded` on export `:100` AND restore `:203`. **Holds.**
- `database/index.js:53` `open()` → `runMigrations` → mig 137 `:2824` (stamp inside the try), 138 `:2849` (INSERT OR IGNORE + C7a
  branch), 139 `:2869` (UPSERT, sole writer, not listed), 140 `:2890` (seed OFF, listed) → arming `:113-117` after them. Onboarding never
  writes `ocr_dpi`. **Seam (c) CONFIRMED at the source.**
- Belt (vi)'s `'true'` literal is complete for the READ side: every listed key is consumed `=== 'true'` (`processing/handler.js:574/:171/
  :5121`, `watch/handler.js:350`).
- Seam (b): `settings/handler.js:633-639` stamps `manual@<rev>` on a listed-key `'true'`; `arm-test-switches.js:38-39` stamps
  `manual@<ts>`; `api/handler.js` writes only `client_api_*`; workflow/licensing have no listed-key writes (belt vi scans them). **No
  uncovered re-arm road found.** The one honest hole is the documented dev trade-off: after `TEST_BUILD=1 npm start` the dev DB (rev
  `'dev'`) never disarms — the census-contamination seam re-opens for the DEV DB only; `RR_ALLOW_ARMED` is its lever (below).
- OMP "pre-existing": `handler.js:1087/:2766` export `OMP_THREAD_LIMIT=threadCap` (≥2 on 16+-core boxes) before mig 139 too. **FACT-by-code.**

### THE SEAM the re-audit missed — a smoke that passes without proving anything
`verify-release-artifact.js:141-143`: if the `smoke-boot identity` line is absent from stdout, `smokeIdentity=null` and `evaluate:85`
**skips** the identity assert. `main.js:1055` `app.quit()` on a lost lock and `:50` (temp-dir mkdir failure → falls through to the REAL
userData) both exit 0 with no line. So the assert that "closes the does-the-bundle-see-package.json assumption" is vacuous exactly when the
answer is no — and it has **never run on a real artifact** (`dist/` newest = `1355-5b6c226`, built before the assert; the only manifest is
that one). HYPOTHESIS (unmeasured): a GUI-subsystem Electron exe's `console.log` may not reach `spawnSync` stdout on Windows — if so, the
verifier is green today by construction. Fix: `!smokeSkipped && smokeExit===0 && !smokeIdentity` → REFUSE; `main.js` smoke → `app.exit(4)`
when the temp dir cannot be made (never touch the real userData; a release identity would DISARM the build machine's live DB). Pin both.
**→ BUILT the same evening (see "Fixed after the Oracle re-vet" below): identity REQUIRED on a 0-exit smoke, emitted to
`smoke-identity.json` in a verifier-owned userData (primary) + stdout (fallback), exit 4 on a userData failure; pins RED-first.**

### Seam (d) — the stale "verified / current" pointers
Both hardened artifacts in `dist/` carry the P0 and sit un-renamed beside a green manifest: `…-r20260907-2017-dd9a790.exe` ("hardened
NSIS, current" in `CLAUDE.md`, `HANDOVER_2026-09-08.md`) and `…-r20260908-1355-5b6c226.exe` ("verified" in plan §7b,
`HANDOVER_2026-09-08_BUILD.md`, `pendingfeatures.md`, `dist/release-manifest-20260908-1355-5b6c226.json`). An owner following any of
those clicks through a broken Review. Rename both `.REFUSED`, delete/annotate the manifest, correct the five pointers. **→ DONE the same
evening (renamed `.REFUSED`, manifest deleted, pointers corrected; the `CLAUDE.md` line is the owner's uncommitted block — corrected at wrap).**

### Residual ranking (premise vetted)
- `RR_ALLOW_ARMED` + marker/ON-count in `_operating_point`: **before the NEXT flip census**, not the customer build — today's arms recorded
  their operating point (cold: throwaway DB at mig 139; warm: post-137 copy, switches OFF). Fold C9 in the same commit: `RR_APP_ENV`
  default-ON or refuse without an explicit `RR_APP_ENV=0` (a harness at 300/env-only is the 08-09 "wrong pipeline" trap).
- `_name_band_read` real-page pin + the two tautological pins (`test_runtime_test_arming:79`, `test_migration137:82`): before the mig-140
  flip. DARK + seed OFF → not a build blocker.
- Hand-run pins with no runner: register them (S) before the build — a pin nobody runs rots.
- Hash-less Python lock + 9 dead packages: OWNER, one re-provision (`pip uninstall` → relock `--require-hashes`) — backlog unless
  installer size matters.

### Headline (for a cold reader)
The 09-08 fix build closes the audit's P0-1 (KEY-based gate + mig 137 + runtime arming, every re-arm road stamps a marker, backups no
longer carry switches), P0-3's release road, and the P2 bundle under the C7a guard; the re-audit then caught a genuine NEW P0 (every
HARDEN_JS artifact shipped a Review whose "File all ready" threw) and fixed it in the right layer. Nothing today weakened a shipped safety.
What remains before a customer build is small and mechanical: make the boot-smoke's identity line REQUIRED (it is silently optional today
and has never fired on a real binary), rebuild ONE hardened artifact through `build:release`, retire the two broken hardened installers and
their "verified/current" pointers, then the owner's scripted click-through gates the `build` flip. Signing, DB-at-rest, backend
DocumentRoot + 2FA remain owner-only.

### BEFORE A CUSTOMER BUILD — ordered
1. **Claude** verifier: identity line REQUIRED when the smoke ran; smoke exits non-zero on temp-dir failure. Gate: new RED pins in
   `test_verify_release_artifact.js`; a smoke run whose output lacks the identity must REFUSE. *(The `BUILD_REV` half is falsified — already
   stripped.)* **→ BUILT.**
2. **Claude** `npm run build:release` → manifest `problems: []` with `smokeIdentity.buildRev == pkg.buildRev`; rename `2017-dd9a790` +
   `1355-5b6c226` `.REFUSED`; delete the 1355 manifest; fix the five pointers. **→ renames/pointers DONE; rebuild pending the belts arms.**
3. **Owner** click-through on THAT artifact, scripted (the P0 class is call-time, the smoke cannot see it): Review → File all ready dialog
   opens and files one; Teach → draw a box → OCR read-back; Settings → every tab; Search → preview → stamp; Help; About shows
   `Version 2.0.0 (<rev>)`. Gate: all pass, no console error in the SFDEV trace.
4. **Claude** flip `build`/`build:store` → the release road (C5), keep `build:plain` for bisecting; gate = `gateSequence` pin + one plain
   `npm run build` REFUSED on a `-TEST` rev.
5. **Claude** register the hand-run pins in the runner (S).
6. **Owner** (parallel, not gating a direct-download build): incorporate → `WIN_CSC_LINK` signing (P0-2); DB-at-rest decision (P0-4);
   backend `DocumentRoot=public` + 2FA ON (P1-3/4); Learning Repair #42/#25/#27/#40 (C7d); the 300-install budget choice.
7. **Backlog**: `--smoke-windows` (open every window hidden, await `did-finish-load`, probe `window.ReviewReadiness`) — the automated layer
   for the class the owner is hand-testing; dynamic-asset belt; `RR_ALLOW_ARMED`+C9 before the next flip census; OMP cap-2 rerun;
   P2-3/5/6; #117 arc; Python re-provision with hashes.

## Consolidated "before a customer build" list
The Oracle's ordered list above ("BEFORE A CUSTOMER BUILD") is the consolidated list. Status at the evening's close:
items 1 (identity REQUIRED + exit 4) and the renames/pointers of item 2 are BUILT; the rebuild of item 2 runs once the
name-grow belts arms release the CPU; items 3 (owner click-through) and 6 (owner) are handed over; items 4-5 follow the
click-through; item 7 is backlog (`pendingfeatures.md`).

## Fixed after the Oracle re-vet (2026-09-08 late evening)
- Boot-smoke identity REQUIRED: `verify-release-artifact.js` refuses a 0-exit smoke that emitted no identity; the verifier owns the
  throwaway userData (`SCANFINDER_SMOKE_DIR`, mkdtemp) and reads `smoke-identity.json` back FIRST (stdout line = fallback, so a
  GUI-subsystem exe whose stdout never reaches the pipe can no longer pass by construction); `main.js` writes the identity to that
  file AND stdout, and a failed throwaway-userData setup exits 4 instead of falling through to the real userData (a release
  identity's disarm on the build machine's live DB). Pins: RED-first in `scripts/test_verify_release_artifact.js`.
- `dist/…-2017-dd9a790.exe` and `dist/…-1355-5b6c226.exe` renamed `.REFUSED.exe`; the 1355 manifest deleted; pointers corrected in
  the plan §7b, `HANDOVER_2026-09-08_BUILD.md`, `pendingfeatures.md` (the `CLAUDE.md`/`HANDOVER_2026-09-08.md` lines belong to the
  owner's uncommitted block and the prior session's record — corrected at this session's wrap / annotated, not rewritten).
- "The whole class" wording in the eric lane corrected to the static-tag class (the tree is no longer deleted, so the belt is a
  regression tripwire, not the safety).
- Oracle's `BUILD_REV` claim FALSIFIED at the source (`composeEnv('release')` strips `-TEST`; pinned).

