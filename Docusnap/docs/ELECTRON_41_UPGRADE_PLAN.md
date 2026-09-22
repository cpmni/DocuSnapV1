# Electron 31.7.7 → 41 upgrade — safe staged plan

**Author:** eric (Electron advisor) + main session, 2026-08-29. **Status:** plan-only — nothing upgraded.
Grounded in this repo's actual config + API usage. **Before executing, take this through the Oracle gate**
(it's a risky infra change), then run it on an isolated worktree.

---

## TL;DR
This is a **dependency + toolchain swap, not a code rewrite.** A whole-repo audit found the app uses only
stable, high-level Electron APIs — **none** of the churny things removed/reworked across 32→41 (no
`protocol.*`, `session.*`, `new-window`, `nativeWindowOpen`, `allowRendererProcessReuse`, `desktopCapturer`,
`<webview>`, `@electron/remote`, `utilityProcess`, or Node `.fork()`). Every window is already
`contextIsolation:true + nodeIntegration:false + sandbox:true`, and navigation uses the modern
`setWindowOpenHandler`/`will-navigate` lockdown. Heavy work is `child_process.spawn` of **external** binaries
(python.exe, taskkill), so the Node-20→22 jump touches only main-process JS + the two native addons.

**The real risk is concentrated in three places:** (1) native-module rebuilds — `argon2` (highest) +
`better-sqlite3`; (2) the **electron-builder 24→26 bump** (24's bundled `node-abi` can't target E41);
(3) three runtime spots that exercise Chromium internals and need a live smoke.

**Target versions (pinned today):** electron **41.10.7** · electron-builder **26.15.3** · @electron/fuses
latest 2.x · better-sqlite3 (see decision) · argon2 **0.45.1**. *(Newest Electron overall is 44.0.0 — 41 is
a deliberate supported target; if you want the longest runway before the next EOL, 43/44 is the identical
plan with a different number. Your call — this doc targets 41 as requested.)*

**Three Electron apps to upgrade, not one:** core (`/`), detached client (`client/`), and
**`cert-tool/`** (`scanfinder-cert-tool`, also pinned E31 — bump if shipped, or retire).

---

## ⚖ Oracle gate — SIGN OFF WITH CONDITIONS (2026-08-29)
Direct-jump-on-a-worktree = **correct**. All four load-bearing premises verified against code (no churny APIs
— eric's grep widened + confirmed; external-Python → M=0 is a byte-integration check; eb 24→26 required;
disabling the RunAsNode fuse is runtime-safe). **Execute only after adding the conditions below.**

**Correction — narrows the DPAPI blast radius:** the cached licence token is **NOT** a DPAPI blob — it's a
JWS in `license_tokens.token_blob` verified against pinned Ed25519 keys, so a safeStorage/DPAPI change
**cannot break the licence gate**. DPAPI at-rest covers only **(a)** the audit-HMAC key (`src/lib/auditKey.js`,
`secretStore.js`) and **(b)** the LAN TLS private keys (`certService.js`, `api/handler.js`). The device
fingerprint is OS-derived (MachineGuid), so an in-place upgrade doesn't change `fp_hash` → no re-activation /
seat re-consumption.

**MANDATORY new gate — 5b · in-place DPAPI continuity (BLOCKING).** The plan's other gates **structurally
cannot catch this**: the unit tests inject a *fake* safeStorage (`secretStore.__setSafeStorage`) → zero DPAPI
signal; a clean-VM smoke writes *new* E41 blobs → false pass. The risk only manifests when an **E41 build reads
an E31-WRITTEN blob**. Do:
- Take a **`db.backup()` copy** (never a file copy) of a real E31-written `%APPDATA%\ScanFinder` — with a live
  `.audit-key`, plus `ca.key`/`server.key` if the LAN add-on is in scope.
- Launch the **E41** build against it via the Chromium switch **`--user-data-dir=<copy>`** — **NOT**
  `SCANFINDER_USERDATA` (only honoured under RUN_AS_NODE; a real Electron run ignores it).
- **Assert:** (a) `verifyAuditChain` → `ok`; (b) `stampPermission.canStamp` still true for a previously-granted
  user; (c) **no `tamper_detected` rows** appear; (d) with `client_api_enabled=true`, the app **boots** and a
  pinned-CA client completes the handshake.
- **Why load-bearing:** a DPAPI decrypt failure → `getAuditKey`→NULL → `verifyAuditChain` fails →
  **`canStamp` fails closed for EVERY user + writes `tamper_detected`** (a scary "security incident" after a
  routine update); and the LAN TLS decrypt throws at boot through a **bare, un-try/caught auto-start**
  (`api/handler.js:1232` via `main.js:1404`) → can disrupt startup for a LAN-enabled install. The outcome is
  *likely* fine (DPAPI is OS-user-bound, not Electron-bound) — but **prove it with this gate, don't assume it.**

**Other conditions (all before/within execution):**
- **Never run gates 4 / 5 / 5b against the LIVE profile.** Both E31 + E41 resolve the same
  `%APPDATA%\ScanFinder` (appId `com.scanfinder.app`) and `dev-start.js` doesn't redirect userData — so a naïve
  worktree `npm start` corrupts the live audit chain/certs (and even success re-wraps live `ca.key` under E41).
  Always a `db.backup()` copy via `--user-data-dir`. **Also stop the live E31 dev app** (or use distinct ports):
  the worktree and the live app both want CDP 9222 / API 8765; a collision would masquerade as an E41
  paint/handshake failure.
- **Gate 3 — diff failure SIGNATURES, not names.** A known-red allowlist keyed on test *name* masks a known-red
  that fails for a *new* E41 reason. Baseline each known-red's assertion/line/message on the E31 worktree; in the
  E41 run, a known-red failing **differently** aborts.
- **Gate 4 — hold the DPI env IDENTICAL across the E31/E41 arms**; test **both** the default-300 path and a
  set-`ocr_dpi` path (different env-plumbing). Don't hard-code "200."
- **§6 fuses — one mechanism, not two.** If you adopt eb-native `electronFuses`, **unwire
  `scripts/afterPack-fuses.js`** (already armed via `afterPack`; it would double-flip the wafer *after* eb embeds
  the ASAR-integrity hash). Keep hardening as separate, independently-revertible commits; never ship armed
  without the packaged clean-VM launch.
- **Degrade legibly:** IF (and only if) 5b reveals real risk, the degrade path must surface *"secure store needs
  re-initialisation after update → admin repair,"* NOT silently disable stamping + fill the audit log with
  `tamper_detected`.

**Version (Oracle recommendation):** the blast radius is identical for any target, and 41 is already 3 majors
behind newest (44.0.0) — ~a year less runway before the next forced EOL bump, the very thing you're fixing.
**Default to the newest stable that `argon2` + `better-sqlite3` confirm they support** (prove at gate 1), not
41. Owner's call — this doc targets 41 as requested; flip the number if you agree.

**Most-likely-to-fail on execution:** the `argon2` source-build against the E41/Node-22 ABI — caught cheaply at
gate 1. The most *damaging* if it slipped was the DPAPI case — now closed by gate 5b.

---

## 1 · Breaking-change audit 32→41, mapped to THIS code
Read the cumulative doc `https://www.electronjs.org/docs/latest/breaking-changes` + each major's blog post
(`electronjs.org/blog/electron-32-0` … `-41-0`). **Honesty flag:** E39/40/41 specifics are past the advisors'
Jan-2026 training horizon — the per-version reads are **mandatory**, not optional.

| Area | Electron change | This code | Verdict |
|---|---|---|---|
| `File.path` on dropped files removed | E32 | drops denied in preload; no file-input `.path` read | **Forward-safe** (grep-confirmed) |
| WebContents nav-history → `navigationHistory` | E32 | not used | **Forward-safe** |
| `new-window` removed; `setWindowOpenHandler` required | done pre-32 | already used (`main.js:993`, `print/handler.js:115`) | **Forward-safe** |
| Sandboxed-preload `require` limits | ongoing | preloads require only `electron` (allowed in sandbox) | **Forward-safe** |
| `nativeImage`/`clipboard`/`systemPreferences` churn | 33-38 | none used | **N/A** |
| utility-process / `child_process` model | 33-41 | external-binary spawn only | **N/A** |
| `desktopCapturer`/`session` handler shapes | 34-37 | not used | **N/A** |
| Chromium PDF-viewer / `plugins` flag | any | print ghost `plugins:true` (`print/handler.js:112`) | **SMOKE REQUIRED** |
| `webContents.print` callback shape | churny historically | `print/handler.js:143` | **SMOKE REQUIRED** |
| Node 20 → 22 (~E35) | E35 | main JS + native addons + `/v1` TLS server | see §3 + §5 |

**Node-22 exposure:** no app Node-API source is affected (pure `child_process`/`https`/`fs`). Only (a) the two
native addons must ABI-rebuild and (b) Node-22 TLS defaults on the `/v1` `https.createServer`
(`src/modules/api/handler.js`) — the client must still complete the pinned-CA handshake (§5 gate 5).

**Three runtime spots that need a live smoke** (Chromium/BrowserWindow internals, not documented-stable JS):
1. **Print ghost** — offscreen `plugins:true` window renders a `file://` PDF via Chromium's PDF viewer +
   `webContents.print({silent:false}, cb)` (`src/modules/print/handler.js:112,143`).
2. **Windows focus-repair** — `win.blurWebView()`/`focusOnWebView()`/`wc.focus()` (`src/lib/focusRepair.js:46-51`).
3. **`app.disableHardwareAcceleration()` + software compositing** (`src/main.js:76`) — the whole UI relies on
   the SW-compositing workaround; re-verify no ghosting on 41's Chromium.

---

## 2 · Dependency matrix

| Package | Current | Target | Why / constraint |
|---|---|---|---|
| `electron` (core+client+cert-tool) | `^31.0.0` (31.7.7) | **`41.10.7`** (pin exact on the branch) | The bump. Widen to `^41` only after the gate passes. |
| `electron-builder` | `^24.13.3` | **`26.15.3`** | 24.13.3's bundled `node-abi` (3.92.0) can't map E41's ABI → `install-app-deps` rebuild fails to target 41. 25+ adds native `build.electronFuses`; 26 is current + matches CLAUDE.md's packaging note (removed `win.sign`/`signingHashAlgorithms` keys — this app uses NEITHER, so the 24→26 major is low-risk here; re-verify NSIS + winCodeSign download at gate 6). |
| `@electron/fuses` | `^2.1.3` | **latest 2.x** | Still V1 fuse schema on E41 (`FuseVersion.V1`). Prefer migrating fuses to electron-builder's `electronFuses` (§6). |
| `better-sqlite3` (native) | `^12.10.0` | **DECISION** — try 12.10.0 against E41 first; if the source build fails on Node-22, bump to **13.0.3** (a MAJOR — read its changelog) | Rebuilt from source against E41 headers by `install-app-deps` (bundles its own SQLite — no external lib). Latest is 13.0.3; 12.10.0 may already build clean on Node-22 — gate 1 decides. |
| `argon2` (native) | `^0.44.0` | **`0.45.1`** (or confirm 0.44.x builds on E41) | node-pre-gyp addon, SOURCE-built against E41 headers for Electron. **Highest single risk** — needs VS Build Tools + a Python for node-gyp if no matching prebuild. |
| `node-forge`, `pdf-lib` | — | unchanged | pure-JS, no ABI exposure |

**Client + cert-tool** carry no native deps → their matrix is just `electron 41.10.7` + `electron-builder 26.15.3`.

---

## 3 · Native-module rebuild
- **Mechanism (already wired):** `postinstall: electron-builder install-app-deps` rebuilds `better-sqlite3` +
  `argon2` against the detected Electron's ABI. `asarUnpack: ["**/*.node"]` keeps the built binaries loadable.
  **No mechanism change — but it only targets E41 once electron-builder is bumped (§2).**
- **Verify the rebuilt ABI (the trap):** the repo runs gate tests as **Electron-as-Node** — a `.node` built for
  E41 will throw `NODE_MODULE_VERSION` mismatch under plain `node`. Verify with:
  `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron -e "require('better-sqlite3'); require('argon2'); console.log(process.versions.modules)"` → loads clean, prints E41's module number.
- **Toolchain risk (the real dependency):** for Electron targets both addons are **source-built** regardless of
  upstream prebuilds → needs VS 2022 Build Tools ("Desktop C++") + a Python for node-gyp on the build machine.
  **SEAM:** relies on the toolchain; a missing toolchain fails at `postinstall` (safe — caught on the branch,
  never ships). **Abort-if:** `install-app-deps` can't compile the addons and no toolchain/version fix lands in
  the stage → stop; do not hand-patch prebuilts.

---

## 4 · Sequencing — DIRECT jump, on a worktree
**One direct 31→41 jump, not stepped.** Electron is a binary/ABI swap with no per-version DATA migration —
nothing to migrate incrementally; a break at E36 is equally visible at E41; stepping = ~9 native rebuilds + 9
gate runs for versions you'll never ship, for zero extra signal. Read all the breaking changes once (§1).
**Stepping is a BISECTION tool only** — if a gate fails and the cause is non-obvious, install **E36** as the probe
(post the Node-22 jump) and bisect from there.

**Isolation (non-negotiable):** a git worktree so `main`/`feat/teach-side-overnight` stays on E31 and buildable,
and the live dev app (CDP 9222) is untouched:
```
git worktree add ../Docusnap-e41 -b chore/electron-41
```
Do all installs, rebuilds, and packaging in the worktree.

---

## 5 · Verification gates (in order) — 1–5 BLOCKING, 6–8 release-blocking
Each stage has an **abort-if**.
1. **Install + native rebuild** (BLOCKING). `npm ci` in the worktree → postinstall rebuild green. *Abort-if:* argon2/better-sqlite3 won't compile (§3).
2. **Module-load smoke** (BLOCKING). `ELECTRON_RUN_AS_NODE=1 electron` requires `better-sqlite3` + `argon2` + opens the DB (`database/index.js`). *Abort-if:* ABI mismatch / DB open throws.
3. **JS + Python unit suites** (BLOCKING, known-red allowlist). Run **as Electron-as-Node** (the ABI trap). **Do NOT chase these PRE-EXISTING reds:** `test_authoritative_anchor`, `test_v1_contract`, `test_doctype_surface_parity`, `test_teach_multipage`; Python `test_identity_fusion` (+ ~6 script-style Python reds). A **new** red is the signal. Watch especially `test_focus_repair`, `test_secretstore`, `test_certservice` (safeStorage/DPAPI), print + workflow suites. *Abort-if:* a green-on-31 test goes red for an Electron-41 reason.
4. **`realdoc_regression` M=0 corpus gate** (BLOCKING, highest value). Extraction is a Python subprocess — **Electron cannot legitimately change extraction output**, so a byte diff = a real integration regression (env/spawn/arg plumbing), NOT an accuracy question. Run OFF-vs-ON byte-identical at the product's real DPI (`OCR_RENDER_DPI` — the harness must mirror 200 DPI). *Abort-if:* any would-file / value diff (fix the plumbing or abort — never turn it into a tuning exercise).
5. **Manual smoke — every window + client E2E** (BLOCKING). `npm start` on the worktree, open: review, settings, search, teach, dev-inspector (Ctrl+Shift+D→M / SFDEV), export, license/activation, onboarding, welcome/tutorial, help (inter-page nav still allowed by navGuard), and the **print ghost** (dialog appears above the app). Re-test **focus-repair** (caret lands after a native confirm) and watch for **compositing ghosting** in windowed mode. Then the **`/v1` client E2E**: `electron client` → connect (pinned CA) → login → search → open doc → pages render → mailbox/stamp round-trip. *Abort-if:* any window won't paint, caret regresses, print dialog lost/occluded, or the TLS handshake fails (Node-22 default check).
6. **Packaged build + install smoke** (release-blocking). `BUILD_REV=… npm run build` → install the NSIS output on a clean VM. Verify: starts, ASAR loads, `.node` unpacked + load, **remote-debug lockout** still fires (`--remote-debugging-port=9222` refused, `main.js:47`), fuses read back correct if armed. Re-verify appx only if you ship MSIX (Developer Mode ON). *Abort-if:* packaged app won't start or the debug lockout regresses.
7. **Fuses/hardening smoke** — §6 (release-blocking IF armed).
8. **Chris round** (ADVISORY). Full customer-lens pass on a fresh sandbox once 1–6 green — catches UX/interaction regressions the gates can't. Findings triage into the normal advisor→Oracle loop; don't block the bump unless a real functional break.

---

## 6 · Fuses + ASAR-integrity tie-in (arm as part of this upgrade)
The security review flagged fuses off-by-default. Since you're re-validating the packaged build (§5 gate 6) and
re-touching electron-builder (§2), the marginal cost of arming hardening is one extra packaged smoke — and E41 +
electron-builder 26 is exactly when the better mechanism is available.
- **Rung A (scaffolded):** RunAsNode / NODE_OPTIONS / NodeCliInspect **OFF**. Confirmed runtime-safe (nothing
  ships spawning the app as Node). Arm via `HARDEN_FUSES=1`, or better, move to electron-builder `electronFuses`.
- **Rung B (deferred in code, now unblockable):** `OnlyLoadAppFromAsar` + `EnableEmbeddedAsarIntegrityValidation`
  — wire via electron-builder `electronFuses` so the ASAR **hash is embedded** (NOT via afterPack). Verify the
  E41 fuse/asar-integrity schema (`…/tutorial/fuses`, `…/tutorial/asar-integrity`).
- **SMOKE (load-bearing):** a bad fuse or mismatched hash is a guaranteed brick. Never ship armed without
  launching the packaged, fused exe on a clean VM. *Abort-if:* armed build won't start → ship UNARMED (default =
  byte-identical no-op) and treat hardening as a follow-up, so it never blocks the Electron bump.
- **SEAM:** ASAR-integrity relies on `asarUnpack:["**/*.node"]` staying correct + nothing writing into the asar
  at runtime; any future `extraResources`/`asarUnpack` edit invalidates the embedded hash → re-smoke.
- Keep Rung-A/B as **separate commits** from the Electron bump so either can revert independently.

---

## 7 · Rollback (worktree + lockfile = total)
- **Code/deps:** `git worktree remove ../Docusnap-e41` (or `git checkout -- package.json package-lock.json client/... cert-tool/...`). `main` never left E31.
- **Native modules:** on the 31 checkout, `npm ci` restores lockfile-pinned 31.7.7 + rebuilds the addons against
  the 31 ABI. Lockfiles are committed (core/client/cert-tool) → deterministic revert.
- **Decide to abort within ONE gate run:** if gate 1 (rebuild) / 2 (load) fails without a same-day toolchain fix,
  OR gate 4 (realdoc) shows any untraceable diff → abort the direct jump (bisect via the E36 probe, or shelve).

---

## 8 · Client + cert-tool parity
- **`client/`:** bump to `electron 41.10.7` + `electron-builder 26.15.3`. No native deps → no rebuild. Touches
  none of the version-sensitive APIs (grep clean); its one real E41 exposure is the **Node-22 TLS client** in
  `apiClient.js` (pins the CA) — test against BOTH a 31-core and a 41-core during the transition (they may update
  on different schedules). SEAM: relies on the `/v1` `API_CONTRACT_VERSION` handshake (Electron-independent — must
  not change). No fuses/afterPack in its build (§6 is core-only unless you add it).
- **`cert-tool/`** (`scanfinder-cert-tool`): confirmed present, pinned E31 + eb 24.13.3, node-forge only, no
  native. If shipped, mirror the client bump; if it's dead code, remove it from the release ritual and say so —
  don't leave a third app frozen on E31.

---

## Docs to read (mandatory for the 39–41 unknowns)
- `https://www.electronjs.org/docs/latest/breaking-changes` (cumulative) + `electronjs.org/blog/electron-32-0` … `-41-0`
- `https://www.electronjs.org/docs/latest/tutorial/electron-timelines` (Node/Chromium per major)
- `…/tutorial/fuses` · `…/tutorial/asar-integrity` · `https://www.electron.build/` (E41 support + `electronFuses`)

## Explicit assumptions to prove at execution
- E41's exact Node/Chromium + the precise 39/40/41 breaking-change list (read the live docs — §1).
- electron-builder 26.15.3 supports E41 and this NSIS config compiles unchanged (gate 6 proves it).
- argon2 0.45.1 + better-sqlite3 (12.10.0 or 13.0.3) source-build clean on the E41/Node-22 ABI (gate 1 proves it;
  argon2 is the single highest risk).

*Plan-only. Recommended path: Oracle-gate this plan → create the worktree → work gates 1→8 with the abort-ifs →
land as its own branch for your review + push.*
