# Build hardening — decompile resistance (2026-07-26)

Owner directive: *"important that it cannot be easily decompiled when released; everything must be
commercially free to use; work as safely as possible."* eric-designed (Electron), Oracle-adjacent risk
framing. Reality check: **client-side code on a user's disk can never be made truly un-decompilable —
every rung buys attacker-TIME, not secrecy.** Rank by IP-value-protected ÷ brick-risk.

## Threat surfaces (ranked by IP value × ease of extraction)
| Rank | Surface | IP value | Extraction | State |
|---|---|---|---|---|
| 1 | `config/keyword_patterns.json` | High (whole pattern/validation library) | Trivial (plain file in `resources/config/`) | **Plaintext** |
| 2 | JS in `app.asar` (`src/`, `database/` incl. `trust.js`, licensing gate) | High | Trivial (`npx @electron/asar extract`) | Packed, **not encrypted** |
| 2b | `test_*.js` shipped in the asar | Medium (documents exact thresholds/pins) | Trivial | **FIXED tonight → excluded (Rung C)** |
| 3 | `extraction/*.pyc` (crown jewels) | High | Moderate (CPython 3.12 defeats uncompyle6/decompyle3; `pycdc` gives disassembly + imperfect source) | **Already sourceless `.pyc`** (`scripts/compile-python-bytecode.js`) — the best-protected surface |
| 4 | `vendor/` (Python, Tesseract) | Low (third-party OSS) | Trivial | Plaintext |

**Weakest links = #1 (config) and #2 (JS)** — the two most valuable artifacts ship effectively in the
clear. The Python engine (#3) is already the best-hardened surface, so more Python work is low marginal
value. But #1/#2 are exactly the higher-risk rungs (need a live smoke).

## Shipped tonight (safe, kill-switched, git-revertible, NO live-launch verification needed)
- **Rung C — exclude `test_*.js` / `__tests__` from the asar** (`package.json` `files` negations).
  Zero brick risk (grep-verified: no production HTML/JS references a `test_*.js`). Default-ON. Stops the
  test corpus (which documents thresholds/pins) leaking. Verify: `npx @electron/asar list dist/win-unpacked/resources/app.asar`.
- **Rung A scaffold — Electron fuses hook, DEFAULT-OFF** (`scripts/afterPack-fuses.js`, wired via
  `build.afterPack`). Kill switch `HARDEN_FUSES` (unset ⇒ **no-op ⇒ default build byte-identical**; the
  `@electron/fuses` require lives *inside* the armed branch so a missing dep can't break the default build).
  When ARMED (`HARDEN_FUSES=1`) it flips the SAFE subset on `ScanFinder.exe`: **RunAsNode OFF**
  (no `ELECTRON_RUN_AS_NODE=1 ScanFinder.exe script.js`), **NODE_OPTIONS OFF**, **--inspect OFF**.
  Verified safe for this app: no `ELECTRON_RUN_AS_NODE` in-tree (prod spawns `vendor/python/python.exe`,
  not electron-as-node); the dev test harness uses the node_modules electron, untouched by a packaged-exe flip.
- Dep added: `@electron/fuses` (**MIT**), devDependency, `--ignore-scripts` (pure JS, no native rebuild).

**Arming Rung A ON is the owner's call and needs a LIVE SMOKE** — a bad fuse flip = app won't start.
Verify the flip WITHOUT launching (proves the mechanism): `set HARDEN_FUSES=1 && npx electron-builder
--dir --win --x64`, then read the fuses back off `dist/win-unpacked/ScanFinder.exe` with `@electron/fuses`.
But still launch it before shipping armed.

## Deferred ladder (needs the owner's live smoke — do NOT ship armed unattended)
Ranked by value-per-brick-risk. All tools commercially-free; licence stated.
1. **Rung B — asar integrity + OnlyLoadAppFromAsar** — stops patching `trust.js`/licensing inside the
   asar and repacking (defends *licensing*, not IP-reading). Use electron-builder's **native
   `build.electronFuses`** (MIT), which embeds the asar hash — raw `@electron/fuses` with
   `EnableEmbeddedAsarIntegrityValidation` and no embedded hash = guaranteed brick. **Medium–High risk.**
   Assumption to verify: electron-builder 24.13.3 exposes `electronFuses` and Windows embedded-asar
   integrity works on Electron 31.
2. **Rung D — JS bytecode / obfuscation** — `bytenode` (V8 bytecode, **MIT**) on **main-process modules
   only** (captures `trust.js`, licensing gate, services; most crown-jewel JS is main-side). Do NOT
   bytenode renderer `<script>` (Chromium can't load `.jsc` without a loader) — use `terser` (**BSD-2**)
   or `javascript-obfuscator` (**BSD-2**) minify for renderers. **High risk** + bytecode is locked to the
   exact Electron V8 (couples to the "don't bump electron casually" rule). Heavy smoke (every window).
3. **Rung F — encrypt `config/keyword_patterns.json`** — closes the #1 plaintext leak, but the key ships
   in the binary (recoverable) so it's obfuscation not secrecy; needs a decryptor in BOTH `keyword.py`
   and the JS `get-validation-patterns`. Node `crypto` / Python `cryptography` (BSD/Apache-2.0). Medium–High
   risk (dual decoders); modest true value.
4. **Rung E — `.pyc` → native** — **Nuitka** (**Apache-2.0**; the paid "Nuitka Commercial" add-on is NOT
   needed) or **Cython** (**Apache-2.0**) for `extraction/`. Strongest Python protection but the 14
   JS-spawned entry scripts must stay `.py` shims importing the compiled core; needs MSVC on the build
   machine. High risk, lowest priority (`.pyc` is already the best-protected surface).

**Avoid: PyArmor** — free tier is limited; RFT/super-mode/no-expiry are behind a paid proprietary licence.
Not OSS-permissive → fails "commercially free." Prefer Nuitka/Cython + bytenode/terser.

## Recovery
Every rung is `git revert`-able. Rung A is additionally kill-switched (`HARDEN_FUSES` default off).
`SHIP_PY_SOURCE=1` restores verbatim Python source (the existing `.pyc` kill switch).

---

## Stage 3 arming procedure (security remediation, 2026-07-27)

**Stage 3a — DONE (code, no smoke risk):** `build.nsis.perMachine: true` (package.json). The next
installer installs to `Program Files` (not user-writable) and requires elevation once at install —
closing H4/M11 (a user-writable install tree). `%APPDATA%\ScanFinder` (DB, inbox, certs) stays per-user
and is unchanged; `npm start` (dev) is unaffected (perMachine is installer-only). check-licenses green.
⚠ Rollout note (deployment, owner): existing per-user installs do NOT auto-migrate to Program Files;
plan the transition (uninstall-then-reinstall, or ship both a period). The `installer.nsh` `HKCU
Software\ScanFinder OutputPath` key is per-user (best-effort SafeWipe guard) — under a per-machine
install by a different admin than the end user, the uninstall SafeWipe may not see the recorded output
path; the default uninstall keeps data (opt-in wipe only), and filed docs live outside %APPDATA%, so the
risk is contained. Not a blocker.

**Stage 3b — OWNER SMOKE REQUIRED (a bad flip = the app won't start):**
1. **Fuses (Rung A, already scaffolded):** `set HARDEN_FUSES=1 && npm run build`, install, and **launch
   EVERY window** — main / review / search / settings / teach / license / update-lock / onboarding /
   welcome / tutorial — and **reprocess one document** (proves the Python spawn still works under the
   flipped fuses). If all start clean, keep `HARDEN_FUSES=1` in the release build command. Disarms
   `ELECTRON_RUN_AS_NODE` / `NODE_OPTIONS` / `--inspect` (closes M3).
   *Mechanism-only proof without launch:* `set HARDEN_FUSES=1 && npx electron-builder --dir --win --x64`,
   then read the fuses back off `dist\win-unpacked\ScanFinder.exe` (`@electron/fuses` CLI). This proves
   the flip PACKS + reads back; it does NOT replace the launch smoke (a fuse can pack fine and still
   prevent launch).
2. **asar integrity (Rung B):** add to `package.json` `build` (electron-builder embeds the asar hash):
   ```json
   "electronFuses": {
     "runAsNode": false,
     "enableNodeOptionsEnvironmentVariable": false,
     "enableNodeCliInspectArguments": false,
     "onlyLoadAppFromAsar": true,
     "enableEmbeddedAsarIntegrityValidation": true
   }
   ```
   (This supersedes the afterPack Rung A once added — remove the `afterPack` fuse hook to avoid a
   double-flip.) Then the SAME full-window launch smoke + reprocess. A wrong asar-integrity flip is a
   guaranteed brick, so smoke before shipping. Verify a MODIFIED `app.asar` fails to load post-integrity.
3. Confirm the installed tree under `Program Files\ScanFinder` is NOT writable by a standard user.

**Stage 3c — BLOCKED on the OV code-signing cert (owner purchase):** Authenticode-sign the installer +
`ScanFinder.exe` (electron-builder `win.certificateFile`/`certificateSubjectName` or a signtool step),
move the pinned Ed25519 trust anchor into the signed bundle (M4), and confirm SmartScreen accepts the
signed installer. Signing is what gives fuses + asar integrity real teeth (a tamperer can't re-sign).
