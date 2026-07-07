# Scan Finder — MSIX / Microsoft Store packaging guide

Ready-to-apply recipe for shipping a **Store SKU** alongside the existing NSIS installer.
Nothing here is wired into `package.json` yet — it needs the Partner-Center identity and a build
machine with `vendor/` (Python + Tesseract). Apply it as a **separate `build:store` path** so the
current `npm run build` (NSIS) is untouched.

> Strategy: **dual-track.** NSIS stays the primary direct-download installer (preserves the current
> %APPDATA% persistence + Polar/JWS licensing exactly). MSIX is an **additive, free, trial-only**
> Store listing. Don't make one build serve both.

## Licensing model (confirmed by the owner — resolves the old "commerce" blocker)
- The **Store app is FREE** and is **purely a vessel for the 14-day trial**. **No Microsoft commerce.**
- The trial is obtained from + recorded on the **backend, keyed by the device fingerprint**
  (`SHA-256(product_id | MachineGuid)` — registry-derived, **outside** the MSIX package container).
- **All sales go through Polar; licences are issued/managed by the backend.**
- Consequence: an MSIX uninstall **cannot reset the trial** (the fingerprint is stable across
  reinstall), so the **anti-trial-stacking model is intact** with no storage change required.

## 0. Prerequisites
1. Reserve the app in **Partner Center** → note `identityName`, `publisher` (`CN=…`), `publisherDisplayName`.
2. **electron-builder is 24.13.3** (CLAUDE.md's "v26" is inaccurate — fix that note). Consider
   upgrading to a newer major before MSIX work: later versions handle the `appx` target +
   capability injection more cleanly.

## 1. `appx` build config (add to `package.json` `build`, used ONLY by `build:store`)
```json
"appx": {
  "identityName": "<PartnerCenter.identityName>",
  "publisher": "CN=<PartnerCenter.publisher>",
  "publisherDisplayName": "Six Mile Software",
  "applicationId": "ScanFinder",
  "backgroundColor": "#0c0e14",
  "languages": ["en-US"]
}
```
Add a separate script (keeps `npm run build` = NSIS only):
```json
"build:store": "node scripts/check-licenses.js && node -e \"const c=require('child_process');process.env.BUILD_REV=require('./scripts/build-rev').buildRev();c.execSync('electron-builder --win appx --config.extraMetadata.buildRev=' + process.env.BUILD_REV + ' --config.extraMetadata.version=' + require('./scripts/build-rev').msixVersion(),{stdio:'inherit',env:process.env})\""
```
electron-builder auto-injects **`runFullTrust`** for the appx target. `extraResources` + `asarUnpack`
translate cleanly (they're just payload files; `process.resourcesPath` resolves the same in-package).

## 2. Capabilities
- **`runFullTrust`** (auto-injected) — needed for: spawning bundled `vendor/python` + Tesseract,
  reading MachineGuid (HKLM), arbitrary folder I/O, binding the inbound LAN socket. All work under
  full trust exactly as today.
- **AVOID `broadFileSystemAccess`** — use the existing folder pickers (`pick-folder` /
  `pick-output-folder`) for the user's scan + output folders; picker-granted access needs no broad
  capability and avoids a slower manual certification review.
- Inbound LAN API server **survives** under full trust (the loopback/`loopbackExempt` limits are
  UWP-AppContainer-only). Off by default; opt-in; loopback-default; TLS-pinned.

## 3. Version (MSIX needs 4-part numeric, strictly increasing per submission)
Add to `scripts/build-rev.js`:
```js
function msixVersion() {
  const [maj = 0, min = 0, pat = 0] = require('../package.json').version.split('.').map(n => parseInt(n, 10) || 0);
  const counter = Number(process.env.STORE_BUILD || 0);   // bump once per Store submission
  return `${maj}.${min}.${pat}.${counter}`;
}
module.exports = { buildRev, msixVersion };
```
Keep the `<UTC>-<gitsha>` `buildRev` only in the About box — never in the package version.

## 4. The hidden dev tools (already handled in code — disclose the Review one)
- ✅ The **main-window dev-inspector** is now **dev-only** (`src/main.js` `dev-inspector-unlock`
  guarded by `!app.isPackaged`) — it does **not** exist in the Store build.
- The **in-Review trace console** (`review-trace-set`, Ctrl+Shift+D+M inside Review) **stays in the
  Store build** for on-site diagnosis. **Disclose it in the Partner Center submission notes** (a
  hidden, read-only, password-gated support/diagnostic console). Do **NOT** document it in the help files.

## 5. Storage / persistence (no blocker — optional polish only)
The trial is backend+fingerprint enforced, so the container wipe on uninstall does **not** affect
licensing. The **only** residual is that an MSIX uninstall loses **learned data** (templates/anchors)
and the cached token (an offline reinstall then needs one online check). Mitigations:
- **Settings → Backup & Restore** already exports/imports the learned config — recommend it before reinstalling.
- **OPTIONAL** — relocate just the durable SQLite DB outside the package container so learning
  survives an uninstall. If wanted, set `app.setPath('userData', …)` to a fixed user-profile path
  **before the DB opens** (the hook already exists at `src/main.js` ~line 34), guarded so the **NSIS
  build keeps today's `%APPDATA%\ScanFinder` path**. Given the trial is safe and Backup/Restore
  exists, this is polish, not a blocker — defer unless customer feedback asks for it.

## 6. Store submission notes (pre-empt certification questions)
Disclose: `runFullTrust` (offline OCR pipeline + user-chosen folders) · bundled Python/Tesseract
interpreter (bundled, **not** downloaded — policy 10.x is satisfied) · the opt-in inbound LAN API ·
the hidden Review trace console (§4) · external Polar activation (free app connecting to an external
service — no Store commerce).

## 7. Verification (on a build machine with `vendor/`)
1. `STORE_BUILD=0 npm run build:store` → install the MSIX.
2. Confirm: Python/Tesseract spawn works; pick scan + output folders; process a doc; the trial
   validates against the backend.
3. **Uninstall → reinstall** → the trial state persists (same fingerprint): expired stays expired,
   an active trial resumes its remaining days.
4. Confirm the **main-window dev-inspector does NOT open**; the **Review trace console DOES**.
5. Re-run `npm run build` (NSIS) → unchanged.
