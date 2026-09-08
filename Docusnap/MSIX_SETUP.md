# Scan Finder — MSIX / Microsoft Store packaging guide

Recipe for shipping a **Store SKU** alongside the existing NSIS installer. **WIRED + SHAKEN OUT
2026-09-07** — the `appx` block + `build:store` script are in `package.json`, the JS+Python hardening
runs on both paths, and a signed test `.appx` was built, registered, and driven through a full
in-container import (watch → packaged Python → OCR → auto-file). The ONLY thing still needed is the
**Partner-Center identity** to replace the placeholders (`SixMileSoftware.ScanFinder` / `CN=Six Mile
Software`). Build machine needs `vendor/` (Python + Tesseract). Since 2026-09-08 the release road is the orchestrator
(`npm run build:release` / `build:release:store` / `build:test` — `scripts/build-release.js`: hardened env + the
migration/licence/npm-audit gates + `verify-release-artifact`); the plain `npm run build` stays until the owner's
click-through of the first verified artifact (AUDIT_FIX_PLAN_2026-09-08 §7b), then it flips to the same road.

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

### 0.1 Partner Center reservation — publisher-identity checklist (DO THIS FIRST)
**Why it matters:** the product's hard rule is *never surface the proprietor's personal name publicly*
(CLAUDE.md → Business / company details). The Store path is the name-privacy-safe signed-distribution
option **because the signature cannot leak the name** — Microsoft re-signs on ingestion with an OPAQUE
account ID (`Publisher = CN=<hex>`), not a person. But the PUBLIC-facing display name depends on the
**account type** you choose, so confirm that **before you pay or build**.

**Know which field is which:**
- `Publisher` (signature DN) = `CN=<Microsoft account ID>` — assigned by MS on the Store re-sign,
  opaque, **NO personal name** (this is the decisive advantage over an IV Authenticode cert, which puts
  the legal name on the UAC prompt + file properties → IV is REJECTED for this product).
- `PublisherDisplayName` = the user-facing publisher (Store listing + app "About"). **Target =
  "Six Mile Software".**
- `identityName` = the package id (e.g. `SixMileSoftware.ScanFinder`) — no personal name.

**Account-type decision (the load-bearing choice):**
- [ ] **Company account** (~$99 one-time) → display name = the VERIFIED company name
  ("Six Mile Software Ltd"), clean. **Requires a registered business + a D-U-N-S number** (free from
  Dun & Bradstreet; allow days–weeks to issue). Same entity gate as an OV cert.
- [ ] **Individual account** (~$19 one-time) → available NOW, no registration. ⚠ **The ONE unresolved
  policy question: confirm at reservation that Microsoft accepts "Six Mile Software" as the public
  `PublisherDisplayName` on an individual account** (vs forcing your legal name). Verify this in Partner
  Center **before paying/building**. If MS forces the legal name → **do NOT proceed on an individual
  account** (it breaks the name-privacy rule); register the Ltd and use a company account instead.

**Reserve-first order of operations:**
1. Create/verify the Partner Center account of the chosen type.
2. Reserve the app name → Partner Center issues `identityName`, `publisher` (`CN=…`), `publisherDisplayName`.
3. **CONFIRM the shown `publisherDisplayName` = "Six Mile Software"** (no personal name). If it isn't,
   STOP and resolve the account type first — do not build against a name-leaking identity.
4. Only then copy those three values into the `appx` block (§1).

**Decision record (2026-07-28):** Store/MSIX selected as the name-privacy-safe signed path because the
signature carries Microsoft's opaque account ID, not the proprietor's name. **IV Authenticode = REJECTED**
(exposes the legal name as the publisher). **OV/EV** remain viable only AFTER Six Mile Software Ltd is
registered (OV also needs D-U-N-S / registry presence). **Interim:** keep shipping unsigned NSIS —
`package.json` is name-clean (`author`/`copyright` = "Six Mile Software"), so nothing leaks; the only cost
is SmartScreen "Run anyway".

**Decision record UPDATE (2026-09-07) — the account-type question, verified against Microsoft's current
onboarding doc (learn.microsoft.com/windows/apps/publish/partner-center/open-a-developer-account,
updated 2025-09):**
- **An INDIVIDUAL Partner Center account publishes under the holder's LEGAL PERSONAL NAME** ("publish apps
  under your own name"). There is NO clean trade-name route on it → publishing here breaks the
  name-privacy rule.
- Worse, Microsoft **scopes the Individual account to NON-COMMERCIAL use** — "not in relation to their
  business, trade, or profession", "hobbyist/amateur/school/personal project". **ScanFinder is a SOLD
  product (Polar), so it belongs on a COMPANY account** — an individual listing is arguably miscategorised
  and a certification risk.
- A **COMPANY account** publishes as the verified legal entity → **"Six Mile Software Ltd"**, legal name
  never public. Requires a **D-U-N-S number OR incorporation/business-registration documents** — a UK sole
  trader with no Companies House registration generally can't clear this, so **incorporating Six Mile
  Software Ltd is the reliable route** (confirm with MS support whether HMRC/tax docs suffice — the long shot).
- **Individual → Company CONVERSION is NOT supported** — you must create a NEW company account from scratch.
  The owner already opened an **individual** account (free, unused) — treat it as a placeholder; the app
  name reserved on it must be **released + re-reserved on the company account** (or a support ticket),
  so it isn't lost in the gap.
- **DECISION: move "incorporate later" → "incorporate Six Mile Software Ltd BEFORE the Store launch."**
  Then: company account → verify → re-reserve the name → build with the company identity → submit private →
  public. **Interim (unchanged): ship the unsigned NSIS direct download** (already name-clean) so there is a
  distributable product now; the Store follows once the Ltd + company account exist.

### 0.2 Tooling (verified 2026-09-07)
- **electron-builder is 26.15.3** (bumped in the Electron 44 upgrade). The `appx` target + `runFullTrust`
  injection work cleanly.
- Build machine needs: **Windows Developer Mode ON** (electron-builder extracts winCodeSign via symlinks;
  off ⇒ `makeappx` never lands) + the **Windows SDK** (`makeappx.exe` / `signtool.exe`; had 10.0.26100).

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
**DONE (2026-09-07):** the `appx` block is in `package.json` (placeholder identity) and `build:store`
routes through `scripts/build-electron.js appx` — the SAME shared path as NSIS, so the JS+Python
hardening applies to both. Current commands are in §8.1 (not the old inline `node -e`).
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
1. `STORE_BUILD=0 npm run build:release:store` (hardened + gated; the old `build:store` is the plain path) → install the MSIX.
2. Confirm: Python/Tesseract spawn works; pick scan + output folders; process a doc; the trial
   validates against the backend.
3. **Uninstall → reinstall** → the trial state persists (same fingerprint): expired stays expired,
   an active trial resumes its remaining days.
4. Confirm the **main-window dev-inspector does NOT open**; the **Review trace console DOES**.
5. Re-run `npm run build` (NSIS) → unchanged.

## 8. Store submission checklist (2026-09-07)

### 8.1 Build the package
```
npm run build:release:store                              # hardened + gated (scripts/build-release.js composes HARDEN_JS=1 HARDEN_JS_STRINGS=1 itself)
# equivalent legacy form: HARDEN_JS=1 HARDEN_JS_STRINGS=1 npm run build:store   (no gates, no verifier)
```
- **Do NOT sign it** for submission (no `CSC_LINK`) — Microsoft signs on ingestion with an opaque
  `CN=<account id>` (the name-privacy win). A local test build can be self-signed to sideload (§8.4).
- **Bump `STORE_BUILD`** once per submission (`STORE_BUILD=1 …`) — the 4-part MSIX version
  (`msixVersion()` = `Major.Minor.Patch.STORE_BUILD`) must strictly INCREASE per submission or the Store
  rejects it. `2.0.0.0` was the first test.
- Output: `dist/ScanFinder-<version>.appx` (~500 MB). Both NSIS and Store carry identical source
  protection now (`build:store` routes through `scripts/build-electron.js appx`).

### 8.2 Identity (replace the placeholders FIRST — see §0.1)
- [ ] Partner Center account (Individual ~$19 / Company ~$99). **Confirm `PublisherDisplayName` shows
      "Six Mile Software", not your legal name**, before paying (individual-account open question, §0.1).
- [ ] Reserve the app name → copy `identityName`, `publisher` (`CN=…`), `publisherDisplayName` into the
      `appx` block in `package.json` (currently placeholders `SixMileSoftware.ScanFinder` / `CN=Six Mile
      Software`).

### 8.3 Listing + policy (free trial vessel, Polar sales — no Store commerce)
- [ ] App is **FREE**; the 14-day trial + activation is entirely the app's own (backend + fingerprint);
      purchase is external via **Polar**. Non-game third-party commerce is allowed (Store Policy 10.8.1),
      Microsoft takes 0%.
- [ ] **Privacy policy URL** (required).
- [ ] **Age rating** (IARC questionnaire).
- [ ] Screenshots + description + support contact.
- [ ] **Certification disclosures** (pre-empt review — §6): `runFullTrust` (offline OCR + user-chosen
      folders) · bundled Python/Tesseract (bundled, NOT downloaded) · opt-in inbound LAN `/v1` API · the
      hidden Review trace console (password-gated diagnostic) · external Polar activation.

### 8.4 Upload WITHOUT going public (test first)
Set the submission's **Visibility → "Private audience"** (Pricing and availability). Microsoft still
CERTIFIES + SIGNS it, but it is **not searchable/discoverable** — only the MSA emails in your tester
group can install it via a direct link. (Alternative: **package flights** = beta channels.) Flip
Visibility → **Public** when ready. Certification still runs on a private submission (not instant).

Local sideload of the self-signed TEST build (skip for the real submission — that one is Microsoft-signed):
```
# elevated PowerShell — trust the throwaway cert baked into the test .appx, then install
$appx = "…\dist\ScanFinder-2.0.0.0.appx"
$c = (Get-AuthenticodeSignature $appx).SignerCertificate
$s = Get-Item Cert:\LocalMachine\TrustedPeople; $s.Open('ReadWrite'); $s.Add($c); $s.Close()
Add-AppxPackage $appx
# uninstall:  Get-AppxPackage SixMileSoftware.ScanFinder | Remove-AppxPackage
# untrust:    Get-ChildItem Cert:\LocalMachine\TrustedPeople | ? { $_.Subject -eq 'CN=Six Mile Software' } | Remove-Item
```
No-admin dev alternative: `makeappx unpack` the `.appx`, then `Add-AppxPackage -Register <dir>\AppxManifest.xml`
(Developer Mode, per-user, no cert/trust). A double-clicked self-signed `.appx` on an untrusting machine
fails with **0x800B010A** (chain-to-trusted-root) — expected; the real Store build never hits it.

### 8.5 Shaken-out facts (2026-09-07 — what a test package actually did)
- Builds clean; manifest is minimal + name-clean: identity `SixMileSoftware.ScanFinder`,
  `PublisherDisplayName=Six Mile Software`, **only `runFullTrust`**, `Windows.FullTrustApplication`.
- Boots `packaged=true`, DB opens + migrations run, GUI renders. Source protection intact IN-PACKAGE
  (`process_docs.py` absent, `.pyc` present; the packaged interpreter runs `process_docs.pyc`; `trust.js`
  + licensing are bytecode in `app.asar`).
- **Full import proven in-container**: watch folder → packaged Python spawn → OCR → auto-file with the
  correct folder tree + XML metadata (`[watch] finished batch of 1 (exit=0)`).
- Data lands in the **REAL `%APPDATA%\ScanFinder`**, NOT a virtualized container → NSIS↔MSIX share data
  (migration is a non-issue); flip side: an MSIX uninstall won't auto-wipe it either.
- Full-trust = normal Win32 filesystem access (scan/output folders) with NO `broadFileSystemAccess`.
