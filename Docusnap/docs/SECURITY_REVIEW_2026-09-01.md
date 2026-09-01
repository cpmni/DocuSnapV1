# Security Review — 2026-09-01 NIGHT (pre-full-release audit)

> Owner ask (going to bed, auto mode): audit the licensing system + overall security; assess whether raw
> OCR data is stored safely / should be encrypted; sweep for known Electron / Node.js / JS flaws and
> address anything that risks the customer before full release. Advisors consulted in parallel: **eric**
> (Electron attack surface), a **security researcher** (dependency/CVE sweep), **gary** (raw-OCR-at-rest).
> **Oracle** adjudicates blast radius + BLOCKS-release vs acceptable-with-note. This doc is assembled as
> findings land; each claim is verified at the source (file:line).

Prior audits (still valid, not re-done here): `docs/SECURITY_REVIEW_2026-08-28.md` (the `/v1` API + backend
access-control review — top finding: no document-level access control, SAFE for single-user desktop;
licence forgery impossible; A1 = `/v1` login skips the forced temp-password reset) and
`docs/SECURITY_HARDENING_REPORT_2026-07-28.md`.

---

## A. LICENSING SYSTEM (main-Claude audit — CONFIRMED at source)

**Verdict: the offline licence gate is soundly designed — verify-before-trust, fail-closed, device-bound,
rollback-proof, keys baked into the asar.** No new licence-bypass found in the client crypto core. Two
residual, previously-known weaknesses remain (both accepted-with-note for a desktop product, but one is a
release blocker for trust — see below).

Confirmed properties:
- **Offline token verify** (`src/lib/license/token.js`): `alg` pinned to `EdDSA` (rejects `none` /
  algorithm-confusion, :62); `kid` resolved against the PINNED key map only, unknown kid → reject (:63-64);
  Ed25519 signature verified BEFORE any claim is read (:66-69); then product_id + state + kind + fingerprint
  binding + timestamps (:74-84). Any failure throws `TokenError` → `evaluate()` returns `locked_invalid`
  (fail-closed, :102). Nothing in the claims is trusted pre-signature.
- **Rollback-proof clock** (`token.js:104`): `eff = max(now, highWaterMark)` — winding the system clock
  back cannot extend entitlement or grace. The high-water mark is mirrored OUTSIDE the roaming DB, under
  LOCALAPPDATA (`src/lib/license/timeAnchor.js`, "SEC-05" note handler.js:87-91), so restoring a
  `docusnap.db` snapshot does NOT reset the clock defence; reads fail OPEN (0) so a corrupt anchor never
  locks a paying user out.
- **Keys baked into the asar** (`src/lib/license/pinnedKeys.js`, `Object.freeze`d): verification always uses
  the baked `PINNED_PUBLIC_KEYS`, NOT the loose `config/license.json` (which ships as a user-editable file
  in `resources/`). Editing the loose file has no effect — the classic "swap the public key with a text
  editor → forge a token → free forever" attack is closed (`handler.js:75-83`). The `LICENSE_PINNED_KEYS=0`
  restore switch is DEV-ONLY (ignored once packaged, :75).
- **Enforcement genuinely cannot be disabled**: `enforcementActive()` is a hardcoded `return true`
  (`handler.js:36-38`); the `license-set-enforcement` IPC is a NO-OP that changes no state and only audits
  the attempt (:495-506). No env var, setting, or dev/unpackaged path turns it off.

Residual weaknesses (ranked):
1. **[Release blocker for TRUST — not a code bug] The installer is UNSIGNED.** Per CLAUDE.md the shipped
   installer is unsigned → SmartScreen "Run anyway". Beyond the UX friction, an unsigned binary has no
   supply-chain integrity: a tampered installer is indistinguishable from the real one to the customer.
   **Recommend: Authenticode code-signing before full public release** (owner action — a cert purchase +
   the build ritual; approval-class, logged for morning).
2. **[Accepted-with-note] The offline gate is tamper-EVIDENT, not tamper-PROOF against a local admin.** A
   user with admin rights on their own PC could repack the asar to swap the baked keys. The mitigation is
   the Electron **asar-integrity fuse** (`EnableEmbeddedAsarIntegrityValidation` + `onlyLoadAppFromAsar`) —
   eric is auditing whether it is set in the shipped build. If not set, this is worth doing for release.
   Even so, "the machine's own admin can defeat local licensing" is the accepted reality of every offline
   desktop licence; documented, not a blocker.
3. **[Reference only] Backend `/v1` A1** (login skips the forced temp-password reset) is tracked in
   `SECURITY_REVIEW_2026-08-28.md`; the licensing backend is a separate PHP deploy (owner-owned). Not
   re-audited tonight; still open there.

---

## B. RAW OCR DATA AT REST — (gary; CONFIRMED at source)

**Threat model:** single-user Windows desktop holding invoices/statements (names, addresses, VAT, bank
details). **Headline: the DB is PLAINTEXT today and is the crown jewel** — `documents.ocr_text` holds the
full-page OCR text of EVERY document (`database/modules/documents.js:16,38`; never purged — used for
`LIKE` search `:754`), plus `extractions.raw_value`/`display_value` + learned supplier values in
`corrections`/`supplier_hints`/`field_anchors`. The DB-encryption arc exists but is DARK/opt-in (no key set
→ plaintext, byte-identical). WAL/SHM sidecars equally plaintext.

Ranked findings:
- **R1 (release-gate) — plaintext DB aggregates all OCR text + learned values in one file.** Fully answers:
  backup exfiltration (a copied `docusnap.db` opens in any SQLite viewer), a shared-PC second user reading
  `%APPDATA%`, off-box theft without BitLocker. The arc is BUILT DARK + Oracle-signed; remaining work =
  owner-supervised drills + the default-on flip (a product decision, not new code). **Ship encryption
  default-ON, OR ship with a LOUD documented "DB is plaintext — enable DB encryption or BitLocker" posture.
  Do not ship silent.**
- **R2 (acceptable-with-doc) — soft-deleted (binned) docs keep plaintext originals in
  `%APPDATA%\ScanFinder\inbox` indefinitely** — `reconcileHolding` only culls `confirmed` copies
  (`handler.js:5796-5798`); the `ocr_text` row also survives. A user who "deleted" a sensitive doc believes
  it's gone. Fix: make the delete/empty-bin COPY honest ("original kept until you Empty Bin") ± an
  auto-purge age. Preserve Restore; stop implying it's gone.
- **R3 (cheap fix — build tonight) — the in-Review trace console leaves cropped document images in
  `%TEMP%\ds-devslices` until app quit.** `review-trace-set` arms `--slice-dir` but only window-close +
  `before-quit` clear slices (`main.js:1643,1694`) — toggling the console OFF doesn't. SFDEV+admin-gated, so
  low exposure, but system `%TEMP%` is low-trust. Fix: `clearDevSlices()` on `review-trace-set(false)`.
- **R4 (acceptable-with-doc) — filed output PDFs + `.metadata/*.xml` are plaintext by design**
  (`filing/handler.js:297-328`; XML is fields-only, NOT OCR body — lower risk). You can't encrypt the
  deliverable the user opens in Explorer. Document the BitLocker/output-folder posture; warn on a
  network/sync output path.
- **R5 (verify) — WAL/SHM encryption on the multiple-ciphers path** not independently confirmed; check
  before claiming "DB fully at rest" once R1 ships. Until R1, WAL is plaintext like the DB.
- **Already sound, no action:** the always-on `processing.log` is REDACTED by default (shape only,
  `logger.js:31-39` — the 2026-08-09 audit fix); the off-by-default admin-gated `diaglog`; per-call
  temp-file cleanup in region/preview/logo paths.

## C. ELECTRON ATTACK SURFACE — (eric; CONFIRMED at source)

**Verdict: the Electron CODE hardening is genuinely strong** — every renderer is
`contextIsolation:true / nodeIntegration:false / sandbox:true`; NO `webSecurity:false`,
`allowRunningInsecureContent`, `enableRemoteModule`, or `@electron/remote` anywhere; the preload exposes
only named typed IPC wrappers (no raw `ipcRenderer`/`fs`/`child_process`/`shell`); path-taking handlers
resolve server-side from the DB row; navigation/new-window/webview/drop are locked down; the fuses ARE
configured (`package.json:19-25`). The real gap is artifact TRUST, not code.
- **C-1 (BLOCKER) — installer UNSIGNED → asar-integrity is unenforceable.** No signing config
  (`package.json:26-52`). `enableEmbeddedAsarIntegrityValidation:true` (:23) only means something once the
  EXE is signed — an attacker who can write the install dir just recomputes the header hash. Worse,
  `asarUnpack:["**/*.node"]` (:100-102) leaves `better-sqlite3`/`argon2` native modules OUTSIDE the asar
  and outside integrity validation → a swapped `.node` = in-process native code execution. `perMachine`
  (Program Files, admin-write) lowers but doesn't remove it. **Fix: OV/EV Authenticode sign the shipped
  binary/installer (or rely on MS-Store signing IF that is the sole channel).** Owner action — approval-class.
- **C-2 (verify-gate) — the fuses are DECLARED but not confirmed flipped in the actual `.exe`.**
  `onlyLoadAppFromAsar` + integrity validation are exactly the two that BRICK launch if the toolchain
  didn't inject the header hash. Before release: launch the packaged exe + `npx @electron/fuses read --app
  dist/win-unpacked/ScanFinder.exe`. Owner-machine only. (`ELECTRON_RUN_AS_NODE=1` is DEV-only, correctly
  neutralised by `runAsNode:false` in the shipped build.)
- **C-3 (fix before client ships) — the detached client has NO app-level navigation lockdown.**
  `client/main.js` has no `web-contents-created`/`setWindowOpenHandler`/`will-navigate`/webview guard (the
  core has all of these, `src/main.js:1051-1064`). A compromised client renderer could `window.open('file://…')`
  keeping the privileged preload but losing the per-page CSP. **Fix: mirror the core guard into the client.**
- **C-4 (fix — SAFE, building tonight) — client `ALLOW_SELF_SIGNED` env kill-switch is honoured in PACKAGED
  builds.** `client/main.js:26` isn't gated on `app.isPackaged`; when set it drives `rejectUnauthorized:false`
  (`apiClient.js:79-80`) → CA verification OFF on real customer traffic (MITM of credentials + document
  images). The CORE app gates its security env-switches on `!isPackaged` (`main.js:47`, `handler.js:1926`);
  the client breaks that discipline. **Fix: gate `ALLOW_SELF_SIGNED` on `!app.isPackaged`.**
- **C-5..C-7 (LOW, defence-in-depth):** `style-src 'unsafe-inline'` + some `innerHTML` on document-derived
  strings (NO script exec possible — `script-src` has no `unsafe-inline`; HTML-injection only, prefer
  `textContent`); CSP is meta-only (a session `onHeadersReceived` CSP is strictly stronger); `open-external`
  has no sender guard (scheme-allowlisted http/https only — acceptable).
- **C-8 (INFO) — stale labels:** electron-builder is `26.15.3` not the "^24.13.3" CLAUDE.md claims; the
  `webPreferences` "Electron 31 defaults" comments (`main.js:503,749`) predate the E44 upgrade (values still
  correct). Fixed tonight.

## D. DEPENDENCY / KNOWN-CVE SWEEP — (security researcher; `npm audit` ran clean)

- **D-1 (MUST FIX before release, non-breaking) — `node-forge` 1.3.1 → `^1.4.0`.** The ONLY `npm audit`
  finding (root: 1 HIGH, 7 advisories incl. Ed25519 + RSA signature forgery + basicConstraints chain
  bypass). **NOT reachable today** — licence verify uses Node native `crypto` (`token.js:22,68`, alg pinned)
  and TLS trust/cert-inspection use Node native `crypto.X509Certificate` + `tls`; forge only
  generates/re-parses the app's OWN local `ca.crt`/`ca.key` (no `pki.verify`/`createCaStore` in `src`). So
  urgent-to-CLEAN, not actively exploitable. `fixAvailable: 1.4.0, isSemVerMajor:false`; `cert-tool` already
  resolves 1.4.0 — only the root EXACT pin held it back. **Owner action (dep change + re-lock) — logged.**
- **D-2 (contained, keep patched) — native untrusted-PDF/image decoders** (`pypdfium2`/PDFium, `pillow`,
  `pypdf`): the real memory-safety RCE surface (the app OCRs attacker-controllable PDFs/images). CONTAINED —
  the Python backend runs as an array-form `spawn` subprocess (`windowsHide`, no shell), so a decoder crash
  is isolated from Electron main. Keep `vendor/python` on latest patched releases; run `pip-audit`/
  `osv-scanner` on the build machine (post-cutoff versions couldn't be CVE-confirmed from training).
- **D-3 (process gap) — NO CVE gate in the build.** `npm run build` gates LICENSES only. Add
  `npm audit --omit=dev --audit-level=high` + `pip-audit`/`osv-scanner` as prebuild gates. Owner action.
- **D-4..D-7 (LOW/monitor):** `pdf-lib` 1.17.1 unmaintained (pure-JS, no RCE, non-fatal stamp path);
  settings-backup `gunzipSync` no size cap (post-AES-GCM-auth, admin file — self-DoS only); the
  better-sqlite3-multiple-ciphers fork (no CVE, DB app-created not attacker-supplied); build-only
  `@xmldom/xmldom` (never ships).
- **Untrusted-input map (clean):** `.metadata/*.xml` is WRITE-ONLY with escaping (no XML parser anywhere →
  no XXE); no zip EXTRACTION anywhere (no zip-slip); no `.xlsx` reader; no `eval`/`new Function`/dynamic
  `require`/shell interpolation; `child_process` all array-form `spawn`; regexes from curated config
  (theoretical ReDoS only if a shipped pattern backtracks — keep them clean).

## E. ORACLE ADJUDICATION + RELEASE GATE — (pending Oracle)

### Tonight's SAFE fixes — BUILT + PINNED (pure hardening; dev-only behaviour change; pin
`src/test_security_audit_20260901.js` 17/17 green under E44):
- gary **R3** — `clearDevSlices()` now runs on `review-trace-set(false)` (`src/main.js`), so the in-Review
  trace console's cropped document-image slices are removed the moment it is toggled off, not at quit.
- eric **C-4** — client `ALLOW_SELF_SIGNED` now `!app.isPackaged && …` (`client/main.js`): a packaged
  customer build can no longer have CA verification disabled by an env var (MITM close-out). Dev unaffected.
- eric **C-3** — the detached client gains an app-level navigation lockdown (`client/main.js`,
  `web-contents-created`: deny new windows / route http(s) to the OS browser, block off-tree
  navigation+redirect via a self-contained file://-only `_isClientInApp`, refuse `<webview>`) — a mirror of
  the core guard, which the client previously lacked.
- eric **C-8** — CLAUDE.md electron-builder version corrected (`^24.13.3` → `26.15.3`).
(Pending Oracle sign-off — will fold any seam Oracle names before the local commit.)

### LOGGED for owner approval (approval-class — NOT done autonomously):
- **C-1** code-sign the installer/binary (release blocker for direct NSIS distribution).
- **C-2** verify fuses in the packaged artifact (owner-machine build).
- **D-1** bump `node-forge` → `^1.4.0` + re-lock (dep change).
- **D-3** add the CVE prebuild gate.
- **R1** DB-encryption default-ON decision (or ship a loud documented plaintext posture) — the single
  largest data exposure.
- **R2** make binned-original retention honest in the copy.
