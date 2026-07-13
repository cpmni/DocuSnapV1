# DocuSnap / Scan Finder — Security & Robustness Audit

**Date:** 2026-06-20
**Branch:** `feat/licensing`
**Scope:** Whole repository — Electron desktop app (`src/`, `python_backend/`, `database/`, `config/`), PHP licensing server (`licensing-backend/`), LAN `/v1` API + detached client (`client/`), cert tooling (`cert-tool/`, `scripts/`).
**Method:** Static read-only analysis. No code was modified, no app was run, no live service was contacted. This document is the only artifact written.
**Auditor note:** Findings below separate **fact** (read directly from code, with file:line) from **assumption** (stated explicitly). Severities are the auditor's judgement for a commercial Windows desktop product with an optional LAN add-on.

> **Suggested independent follow-up (optional, non-blocking):** spin up a focused red-team pass on (a) the licensing client patchability design in §5, and (b) the detached-client enroll/MITM path in F-04. An independent reviewer of the PHP backend (§C) would also add assurance. None of this is required for this report to stand on its own.

---

## 0. Assumptions made (conservative defaults, override later if wrong)

1. The production licensing backend at `https://licensing.scanfinder.co.uk/v1` runs the same code as `licensing-backend/`; only env/DB credentials differ. The audit reasons about the code, not the live host's Apache/PHP/MySQL hardening.
2. `config/license.json` ships the **public** verification keys only (confirmed — file holds SPKI public keys); the Ed25519 **private** seeds live only on the host in `licensing-backend/keys/` (confirmed gitignored and **not** tracked).
3. The detached LAN client/API is an **optional, off-by-default** add-on. The core desktop app runs standalone with it disabled.
4. `Samples/`, `website*/`, `Debug/`, `output/`, `dist/`, `templates/` are dev/working artifacts, not shipped product (cross-checked against `package.json > build.files`/`extraResources` and `.gitignore`).
5. "Documents" = user PDFs/images, their OCR text, extracted field values, and `.metadata` XML — the sensitive assets at rest.

---

## 1. Executive summary

**Overall posture: solid engineering with a few real, fixable gaps.** The codebase shows above-average security awareness: parameterised SQL everywhere in PHP, Argon2id password hashing with progressive rate-limiting, an allowlist DTO at the network trust boundary, a strict CSP (`script-src 'self'`) on every window, `contextIsolation:true`, consistent HTML-escaping in renderers, and a **cryptographically sound offline license-token verifier** (EdDSA, algorithm-confusion rejected, pinned `kid`, verify-before-trust, clock-rollback defence). There is no command injection, no SQL injection, no insecure deserialization, and no committed production secret found.

The weaknesses are concentrated in three places: (1) **licensing is trivially bypassable on the client** because it is interpreted JavaScript in an unprotected `app.asar` gated at a single branch; (2) the **LAN `/v1` API has one authenticated arbitrary-file-read**; and (3) the **licensing server lacks anti-automation** (rate limiting / trial-farming defence), and the desktop **`open-file` IPC can launch any path**.

### Top issues (ranked)

| # | Severity | Area | Issue |
|---|----------|------|-------|
| F-01 | **High** | Licensing client | Entire license check funnels through one client-side branch in plaintext asar JS — a one-line patch disables it. No secondary checks, no integrity/obfuscation. |
| F-02 | **High** | LAN API / documents | `GET /v1/documents/:id/pages` trusts client-supplied `folderPath`/`filename` → any authenticated (even read-only) client reads arbitrary files on the host. |
| F-03 | **High** | Licensing server | No rate limiting / anti-automation on `/v1/trial/start`, `/v1/activate`, `/v1/validate`; trial fingerprint is client-asserted → unlimited trial farming + unthrottled account-key guessing. |
| F-04 | Medium | Detached client | Enrollment sends username/password over an **unverified** TLS connection (`rejectUnauthorized:false`) → active LAN MITM can capture credentials and plant a CA. |
| F-05 | Medium | Licensing server admin | Admin login has only a fixed 0.4 s delay — no lockout/IP throttle → offline-grade brute-force of the single admin password. |
| F-06 | Medium | Desktop IPC | `open-file` / `show-in-explorer` call `shell.openPath` on any renderer-supplied path (login-gated only) → can launch arbitrary executables/UNC paths; amplifies any renderer compromise. |
| F-07 | Medium | Repo hygiene | TLS private keys present in the working tree (`Samples/scanfinder-cert/{ca.key,server.key}`), untracked but **not** gitignored → accidental-commit risk (`ca.key` is a trust root). |
| F-08 | Medium | Documents at rest | `sanitiseFolderName` strips path separators but not `..`/dot-only segments → a company value of `..` files documents outside the configured output root. |
| F-09 | Low/Med | Licensing model | Device fingerprint = `SHA-256(product_id|MachineGuid)`; VM clones share MachineGuid, and the server trusts the client-asserted `fp_hash`. |

---

## 2. Subsystem map & trust boundaries

```
┌─ Desktop (Electron) ──────────────────────────────────────────────┐
│  renderer (windows/*, CSP, contextIsolation)                       │
│     │  preload.js  (contextBridge: docusnap.* IPC only)            │
│  main.js  ── IPC router ── modules/* handlers (requireLogin/Role)  │
│     │            │                                                 │
│     │         spawn(array args, no shell) ── python_backend/*      │
│     │            │                                                 │
│  better-sqlite3 (docusnap.db)        OCR / extraction / render     │
│     │                                                              │
│  ── optional LAN add-on ──                                         │
│  /v1 API (modules/api) ── TLS (certService) ── detached client/    │
└────────────────────────────────────────────────────────────────────┘
            │  HTTPS (token = trust anchor, not TLS)
┌─ Licensing backend (separate host) ───────────────────────────────┐
│  public/v1/*.php (trial/activate/validate/revoke/status)          │
│  public/admin/*  (session+CSRF+TOTP)                               │
│  lib/{db,jws,admin_auth}  ──  MySQL (PDO)  ──  keys/ (outside docroot)│
└────────────────────────────────────────────────────────────────────┘
```

**Trust boundaries:** (1) renderer↔main (IPC, contextBridge); (2) main↔Python (child process, array args); (3) desktop↔licensing server (HTTPS; **signed token is the trust anchor**, TLS is transport only); (4) detached client↔core `/v1` (TLS + bearer session + entitlement); (5) admin browser↔PHP admin (session + CSRF + optional TOTP); (6) all of the above ↔ local filesystem (documents, temp, logs).

---

## 3. Detailed findings

### F-01 — Licensing enforcement is a single client-side branch in plaintext code  ·  **High (business-critical)**

**Category:** licensing / tamper-resistance
**Where:** `src/main.js:149-159` (`enterMainApp`), `src/modules/licensing/handler.js:363-419` (`decideAccess`), `src/lib/license/token.js:99-112` (`evaluate`). Packaging: `package.json:71-79` (asar default, only `*.node` unpacked).

**Facts.** The crypto is genuinely strong — `token.verify()` rejects non-`EdDSA` algs, requires a pinned `kid`, verifies the Ed25519 signature *before* reading claims, binds the fingerprint, and uses a monotonic high-water mark so clock-rollback cannot extend grace (`token.js:54-112`). An attacker **cannot forge a valid token** without the host-only private seed. **But the gate that consumes the verdict is a single boolean:**

```js
// main.js:153
if (gate.decision === 'allow') { /* open the app */ }
showLicenseWindow(gate);
```

`decideAccess()` returns that object, `enforcementActive()` is hardcoded `true` (handler.js:36), and **no other code path re-checks licensing** — confirmed by grep: the only consumers of `decideAccess`/`evaluate` are this one call site (`checkClientEntitlement` is a *separate* gate for the LAN add-on only, not the core app). The app ships as interpreted JS inside `app.asar`, which is not encrypted, not obfuscated, not integrity-checked, and trivially editable (`npx asar extract` → edit → repack). The installer is unsigned (per CLAUDE.md), so there is no signature to invalidate.

**Impact.** A "disassembler patch" here is actually a *text edit*. Any one of these neutralises all enforcement: change `=== 'allow'` to a tautology; make `decideAccess` `return {decision:'allow'}`; make `token.evaluate` always allow; or make `enforcementActive` short-circuit. Once past startup, **every feature (import, OCR, review/confirm, search, templates, filing) runs with zero further checks.** This is the exact "single obvious point" the task asks to eliminate. See §5 for the multi-point design.

**Assumption.** I did not unpack a built installer; the asar/plaintext claim is inferred from `package.json` build config + the absence of any obfuscation/integrity dependency.

---

### F-02 — Authenticated arbitrary file read via the page-render endpoint  ·  **High**

**Category:** access control / path traversal / document leakage
**Where:** `src/modules/api/handler.js:312-334` (`GET /v1/documents/:id/pages`) → `src/services/previewService.js:74-136` (`getDocumentPages`). Client call: `client/apiClient.js:127-130` (`getPages` forwards `folderPath`/`filename` verbatim).

**Facts.** The endpoint reads `folderPath` and `filename` straight from the query string and passes them through. The handler only resolves a server-side path *when the client omits them* (`if (!folderPath || !filename)`, line 321). When the client **supplies** them, `getDocumentPages` builds `sourcePath = path.join(folderPath, filename)` (previewService.js:82). It prefers the document's `working_path` **only if that file still exists** (line 87-89); if `working_path` is null or missing (true for older rows, deleted working copies, or never-imported-via-inbox docs), `filePath = sourcePath` — fully client-controlled. Then:
- non-PDF: `fs.readFileSync(filePath)` and returns the raw bytes base64 (lines 132-135) — **reads any non-`.pdf` file the service account can open**;
- PDF: spawns the render script on the attacker's path and returns page images.

The DTO allowlist (`dto.js`) deliberately hides filesystem paths from clients precisely so they "can't reason about / reach the server's filesystem" — this endpoint defeats that intent by *accepting* a path back.

**Impact.** Any authenticated detached-client user — **including a `readonly` role** — can request `/v1/documents/<any-valid-id>/pages?folderPath=C:\Users\victim\Documents&filename=secret.png` (or any path/extension) and exfiltrate arbitrary host files, crossing both the document-scope boundary and the filesystem boundary. Post-auth, but the LAN add-on is explicitly multi-user with low-privilege roles, so this is a privilege/scope break, not just "you already had access."

**Fix.** The API must **ignore** client-supplied `folderPath`/`filename` entirely and always resolve the path server-side from the `docId` row (the handler already has that code at lines 321-330 — make it unconditional). Optionally constrain the resolved path to the known inbox/output/source roots. (The in-process IPC caller can keep passing paths; the network boundary must not.)

---

### F-03 — Licensing server has no rate limiting / anti-automation; trial fingerprint is client-asserted  ·  **High**

**Category:** licensing robustness / abuse
**Where:** `licensing-backend/public/v1/{trial_start,activate,validate,revoke,status}.php` (no throttle anywhere); fingerprint is whatever the client sends (`trial_start.php:19,27`).

**Facts.**
- **Trial farming.** `/v1/trial/start` mints a signed 14-day trial token for any `(product_id, fp_hash)` where `fp_hash` is any 64-hex string the caller chooses. There is no rate limit, CAPTCHA, proof-of-work, or IP throttle. An attacker scripts unlimited fresh trials by varying `fp_hash`. The "device binding" is only as strong as a self-reported value (the real device check happens client-side in `fingerprint.js`, which an attacker bypasses by calling the HTTP API directly).
- **Account-key guessing.** `/v1/activate` and `/v1/revoke` accept `account_key`, SHA-256 it, and look it up with no attempt throttling. Brute-force resistance rests entirely on key entropy. The only key generator in code is the admin "temp license": `'TEMP-' . strtoupper(bin2hex(random_bytes(8)))` (`index.php:134`) = 64 bits — adequate to make online guessing infeasible *today*, but there is no defence-in-depth and the entropy of **paid** account keys is not visible in code (assumption: created out-of-band).
- **Resource/DoS.** Unauthenticated, unthrottled endpoints that do DB writes + Ed25519 signing per request are a cheap amplification target.

**Impact.** Unlimited trial generation undermines the trial model; combined with F-01 it means the paid gate has neither a strong client side nor a throttled server side. DB/signing load is attacker-controllable.

**Fix.** Add per-IP and per-fingerprint rate limiting + a global trial-creation cap (e.g. token bucket in MySQL or a fronting WAF/Cloudflare rule); consider an enrollment proof-of-work or email/CAPTCHA gate for trial start; add exponential backoff/lockout on repeated `unknown_account` from one IP; document and enforce ≥128-bit entropy for all account keys.

---

### F-04 — Detached-client enrollment transmits credentials over an unverified TLS channel  ·  **Medium**

**Category:** transport / credential exposure
**Where:** `client/apiClient.js:159-167` (`enroll`, uses `insecure:true`) and `:54-68,142-155` (`request`/`fetchCa` set `rejectUnauthorized=false` for the bootstrap).

**Facts.** `enroll()` POSTs `{username, password, totp}` with `insecure:true`, which sets `rejectUnauthorized=false` (line 67) — the client accepts **any** server certificate for that request. The design intent (CLAUDE.md, `DETACHED_CLIENT_HARDENING.md`) is TOFU: fetch the CA over an untrusted channel, confirm its fingerprint out-of-band, then pin. But `enroll` sends the **credentials in the same unverified request** that bootstraps trust, before any fingerprint confirmation.

**Impact.** An active on-path attacker (ARP spoofing / rogue AP on the LAN) terminates the TLS with their own cert, captures the username/password (and TOTP, replayable within its window), and can hand back their own CA. The optional pairing code raises the bar (an attacker without it gets 403 from the *real* server, but a MITM impersonating the server doesn't care) but does not protect request confidentiality. Passive eavesdroppers are not a threat (still encrypted); active MITM during the enrollment window is.

**Fix.** Split enrollment: (1) fetch CA over the insecure bootstrap, (2) require explicit OOB fingerprint confirmation, (3) send credentials only over the now-pinned/verified channel. Or derive a channel-binding from the pairing code (e.g. HMAC the request with the pairing secret) so a MITM without the code cannot complete enroll.

---

### F-05 — Admin web login lacks lockout / throttling  ·  **Medium**

**Category:** authn / brute-force
**Where:** `licensing-backend/public/admin/login.php:47-56` (stage-1 password), `lib/admin_auth.php:99-116` (`admin_login`).

**Facts.** On a wrong password the only friction is `usleep(400000)` (0.4 s) — no per-IP counter, no account lockout, no CAPTCHA. The single admin password is verified against one bcrypt hash. The 2FA stage *is* throttled (`ADMIN_2FA_MAX_TRIES=5`, `login.php:38-44`), but an attacker who lacks the password never reaches it. CSRF, session regeneration, idle timeout, and constant-ish 2FA delay are all present and correct.

**Impact.** ~2.5 guesses/sec/connection, parallelisable, against the one credential that controls license issuance/revocation. A weak admin password is brute-forceable; a strong one is the only thing standing in the way.

**Fix.** Add IP-based exponential backoff + temporary lockout on repeated `admin.login_failed`; consider fail2ban on the audit log, and **require** TOTP for admin (currently optional).

---

### F-06 — `open-file` / `show-in-explorer` launch arbitrary renderer-supplied paths  ·  **Medium**

**Category:** local code execution surface / IPC validation
**Where:** `src/modules/processing/handler.js:253-254`.

```js
ipcMain.on('show-in-explorer', (_e, p) => { if (getCurrentUser()) shell.showItemInFolder(p); });
ipcMain.on('open-file',        (_e, p) => { if (getCurrentUser()) shell.openPath(p); });
```

**Facts.** Both are gated only by "someone is logged in" and pass the path straight to `shell.openPath` / `showItemInFolder`. `shell.openPath` opens a path with its default OS handler — for an `.exe`/`.bat`/`.lnk`/`.hta` or a UNC `\\attacker\share\x.exe`, that means **execution**. The renderer is *supposed* to pass only legitimate document paths, but nothing validates that.

**Impact.** On its own it requires a logged-in user (who could run things anyway). Its real weight is as an **amplifier**: any renderer compromise (a missed `escHtml`, a future dependency XSS, a malicious page) escalates from "DOM access" to "launch arbitrary local/UNC executable" via the contextBridge. CSP + escaping make renderer compromise unlikely, but this removes the safety margin.

**Fix.** Validate the path before opening: resolve to an absolute path and confirm it is inside a known root (output folder, inbox, recorded `stored_path`/`working_path`), reject UNC and executable extensions, and prefer `showItemInFolder` over `openPath` for anything but known document types.

---

### F-07 — TLS private keys sit in the working tree and are not gitignored  ·  **Medium**

**Category:** secret hygiene
**Where:** `Samples/scanfinder-cert/ca.key`, `Samples/scanfinder-cert/server.key` (both `-----BEGIN PRIVATE KEY-----`). `Samples/` is untracked (git status `?? Samples/`) and has **no** `.gitignore` entry.

**Facts.** These are private keys — `ca.key` is the CA trust root the whole LAN-client pinning model depends on never leaking. They are currently *untracked*, so not yet committed, but a routine `git add .` would commit them. `.gitignore` already protects `licensing-backend/keys/` but not `Samples/`.

**Impact.** Accidental commit publishes a CA private key (and server key). If these are throwaway demo certs the impact is containment-only; if they were ever distributed to a real customer, exposure compromises that LAN's TLS.

**Fix.** Add `Samples/` (or `**/ *.key`, `**/ca.key`, `**/server.key`) to `.gitignore`; confirm these are disposable demo keys and rotate/destroy them if not; never ship private keys in `Samples/`.

---

### F-08 — Filing path sanitiser allows `..` / dot-only segments  ·  **Low–Medium**

**Category:** path traversal (write side) / documents at rest
**Where:** `src/modules/filing/handler.js:229-234` (`sanitiseFolderName`), used at `:113` (`path.join(outputRoot, companyFolder, year, month)`).

**Facts.** `sanitiseFolderName` removes `\ / : * ? " < > |`, trims, and caps length, but does **not** strip `.`. A company value of `..` survives as `..`, so `path.join(outputRoot, '..', year, month)` resolves **above** the output root. Company name derives from extraction or a user correction in Review, so it is influenceable. (`.` alone resolves back to the root — harmless; multi-`..` with separators get the separators stripped and become harmless dot-runs, so the precise risk is a segment that is exactly `..`.)

**Impact.** A document (plus its `.metadata` XML) can be filed one directory outside the configured output root; with the `-DUPLICATE` naming this could collide with files there. Low likelihood, but filing performs filesystem writes, so it deserves neutralising.

**Fix.** After sanitising, reject/replace segments matching `^\.+$`, and strip leading dots; assert the final `path.resolve(targetDir)` starts with `path.resolve(outputRoot)`.

---

### F-09 — Fingerprint binding is weak by design  ·  **Low–Medium**

**Category:** licensing model
**Where:** `src/lib/license/fingerprint.js:30-56`.

**Facts.** `fp_hash = SHA-256(product_id | "mg:"+MachineGuid)`, falling back to `"host:"+hostname` when the registry is unreadable. Non-sysprepped VM clones share MachineGuid (acknowledged in CLAUDE.md) → identical `fp_hash`. The server treats `fp_hash` as authoritative even though it is computed and asserted by the client (relevant to F-03).

**Impact.** Cloned VMs share a seat/trial identity; an attacker calling the API directly chooses any fingerprint. This is an inherent device-binding limitation, not a code defect, but it bounds how much the license model can rely on the fingerprint alone.

**Fix.** Acceptable to keep, but: blend a second stable factor (e.g. a per-install random secret stored in userData, combined with MachineGuid) so clones diverge after first run; treat server-side seat binding as the real enforcement and watch for many activations sharing one `fp_hash`.

---

### Lower-severity / hardening items

- **L-01 — No `sandbox:true` on BrowserWindows** (`main.js:300-303`). `contextIsolation:true` and `nodeIntegration` default-false are correct, but enabling the Chromium sandbox adds defence-in-depth against a renderer RCE. Low effort.
- **L-02 — Broad `innerHTML` use (129 occurrences)** relies on developers calling `escHtml` at every interpolation. Sampled hot paths (search results/preview, review fields) *do* escape correctly, and the strict CSP (`script-src 'self'`, all 18 windows) is a strong backstop. Residual risk is low; consider a lint rule forbidding raw `innerHTML` with interpolation, or Trusted Types.
- **L-03 — Diagnostic logs contain document data.** `Debug/*.jsonl` and `processing.log` hold extracted field values/OCR (gitignored, local-only — confirmed in `.gitignore`). No rotation, retention cap, or at-rest protection. Add size/retention limits and a "clear diagnostics" action; document that these contain document content.
- **L-04 — Temp file lifecycle.** `pdf_splitter.py` uses `tempfile.mkdtemp('ds_split_')`; dev OCR slices live under `<temp>/ds-devslices` (cleaned on inspector close + before-quit). Split temp dirs and render temp images may persist in the OS temp dir holding document bytes. Ensure deterministic cleanup (try/finally) and bounded lifetime.
- **L-05 — TOTP codes are not single-use within their window** (`admin_auth.php:322-339`, `src/lib/totp.js`). A captured 6-digit code is replayable for ≤90 s (±1 step). Minor; track last-used counter to prevent reuse.
- **L-06 — Backend secret-at-rest depends on docroot being `public/`.** `keys/` is a sibling of `public/` and the `.htaccess` lives only in `public/`. A misconfigured docroot (pointing at `licensing-backend/`) would expose `keys/` over HTTP. Add a deny-all `.htaccess` in `keys/` and document the docroot requirement in the deploy script.
- **L-07 — `pairingOk` compares the pairing code non-constant-time** (`api/handler.js:579`). Low-value, short-lived secret; use `crypto.timingSafeEqual` for tidiness.
- **L-08 — No mutual TLS / client cert on the LAN API.** By design (password + optional MFA). Acceptable; note it for high-security deployments that may want client certs.
- **L-09 — `base_url`/keys in user-writable `config`.** Repointing `base_url` alone cannot forge a grant (token signature is the anchor — good), but note that config integrity matters once F-01 is addressed (config tampering is part of the same client-trust surface).

### Positives worth preserving (do not regress)

- Offline token verifier is exemplary (`token.js`): EdDSA-only, pinned `kid`, verify-before-trust claim reading, fingerprint binding, rollback-proof clock.
- Auth: Argon2id (`argon2` dep), progressive per-username rate-limit, generic error + constant-shape dummy hash (no user enumeration), last-active-admin protection, full audit trail. Audit metadata redaction is **tested** (`database/modules/test_audit_log.js:60` deliberately feeds `password`/`account_key` to assert they're stripped).
- DTO allowlist (`dto.js`) with a `FORBIDDEN_FIELDS` conformance assertion keeps paths/`ocr_text` off the wire.
- Search role-shaping is enforced server-side (`searchService.js:31-65`): `readonly` never receives uncommitted docs.
- PHP backend: PDO prepared statements throughout (int-cast interpolations only), CSRF synchroniser tokens with `hash_equals`, `session_regenerate_id` on login, `htmlspecialchars(ENT_QUOTES)` output encoding, secrets hashed at rest, generic client errors with server-side `error_log`.
- Python backend: no `shell=True`, `os.system`, `eval`, `exec`, `pickle`, or `yaml.load`; all `spawn`/`subprocess` use array args (no shell) → no command injection.
- Strict CSP on every window; `contextIsolation:true`; private signing keys gitignored and excluded from the installer (`package.json` ships only `config/`, `python_backend/`, `vendor/`, `src/`, `database/`, `assets/`).

---

## 4. Subsystem threat-model summaries

**A. Desktop (Electron/IPC/DB/FS).** Assets: documents, OCR text, extractions, user accounts, audit log, cached license token. Top threats: renderer compromise → IPC abuse (mitigated by CSP + escaping + contextIsolation; residual via F-06 `open-file`), path traversal on filing writes (F-08), local DB readable by the OS user (SQLite is unencrypted — inherent to a local app). IPC handlers consistently apply `requireLogin`/`requireRole` (254 guard references across 15 modules); user-management/audit/template/settings handlers are admin-gated server-side, not just UI-hidden.

**B. Python backend.** Assets: document bytes in transit through OCR, temp files. Top threats: command injection (not present — array-arg spawn), temp-file leakage (L-04). Clean of injection/deserialization.

**C. Licensing server (PHP).** Assets: account hashes, entitlements, seats, signing seeds, admin session. Top threats: anti-automation absence (F-03), admin brute-force (F-05), docroot misconfig exposing `keys/` (L-06). Injection and CSRF are well-handled.

**D. Detached client / LAN API.** Assets: documents (page images), session tokens, credentials. Top threats: authenticated arbitrary file read (F-02), enroll MITM (F-04). Loopback-only default + TLS-required-for-LAN + bearer auth + entitlement gate + DTO projection are all correct.

**E. Licensing as a whole.** Strong server-issued/offline-verified token; weak client enforcement surface (F-01) and weak fingerprint (F-09). The cryptography is not the weak link — the *client decision funnel* is.

---

## 5. Licensing: hackability & multi-point enforcement design

### 5.1 Server "how hackable is it?"

- **Token forgery:** infeasible. EdDSA signatures, private seed host-only and gitignored. The client verifier is hardened (§F-01 facts). ✔
- **Replay / stale-token reuse:** bounded. 7-day offline grace + monotonic high-water mark defeats clock-rollback; a reachable backend that returns "no grant" clears the cached seat token (`handler.js:398-400`). ✔
- **Payload tampering:** rejected (signature covers all claims; fingerprint + product + state validated). ✔
- **Trial farming / key guessing:** **weak** — no rate limiting, client-asserted fingerprint (F-03).
- **Admin takeover:** password is the single barrier with no lockout (F-05); TOTP optional.

**Net:** the *protocol* is sound; the *operational* defences (rate limiting, lockout, mandatory admin MFA) are missing.

### 5.2 Client patchability and the multi-point design

**Today (F-01):** one branch, plaintext asar, no integrity, no secondary checks. Bypass effort ≈ minutes.

**Goal:** raise the bar from "edit one line" to "understand and defeat many independent, workflow-entangled checks" — using *architecture*, not fragile obfuscation. Recommended layering, cheapest-first:

1. **Spread the verdict across critical workflows, don't gate once at startup.** Re-evaluate the cached token (a cheap, pure function — `token.evaluate`) at the entry of each high-value operation: `process-folder`, `confirm-review`, `search-documents`, template save. Each handler independently denies on a non-`allow` verdict. Now a patcher must find and neutralise N call sites, not one.
2. **Entangle enforcement with data the app must produce correctly.** Make a license-derived value a real input to a critical computation rather than a branch — e.g. derive a per-install key from the verified token and use it when writing/reading the filed `.metadata` (or when stamping confirmed documents) so that disabling the check corrupts output rather than cleanly unlocking. The check then can't be "removed" without breaking the feature it guards.
3. **Verify in the process that's hardest to patch.** The renderer is the softest target. Keep the *authoritative* checks in `main` (already true) and, longer term, move the verifier (or a second corroborating check) into the native layer (a small N-API addon, or reuse the existing `better-sqlite3`/`argon2` native boundary) so a pure-JS edit can't satisfy it.
4. **Make the gate stateful and corroborated, not a single boolean.** Have `decideAccess` and the per-workflow checks consult independent evidence: the signed token, the persisted high-water mark, the device fingerprint recomputed fresh, and a backend echo when online. Disagreement → degrade. A patch that fakes one must fake all.
5. **Detect tampering, fail safe.** Ship an asar integrity check (electron's `integrity`/fuses, or hash the asar at runtime against a value embedded in the native addon) and disable the `runAsNode`/`nodeCliInspect` fuses so the binary can't be relaunched as a plain Node to dump state. Sign the installer so the asar swap is at least visible.
6. **Only then, light obfuscation** of the few entangled checks — as a speed bump, never the primary control.

**Explicitly avoid:** more `if (licensed)` booleans, time-bomb checks that all read one flag, or obfuscation as the main defence. The durable wins are #1 (many call sites) and #2 (entanglement); #3/#5 (native + integrity) defeat the casual asar editor.

**Honest expectation:** a fully offline desktop app can never be 100% uncrackable by a determined reverse engineer. The realistic goal is to move bypass from "one-line edit any user can copy from a forum" to "bespoke patch requiring real effort" — which protects revenue against casual piracy, which is the actual threat.

---

## 6. Document security deep-dive

- **At rest.** Documents, page images, and `.metadata` XML live under the user-chosen output root + `userData/inbox/<docId>`; `docusnap.db` holds extractions/OCR. **All unencrypted** (inherent to a local offline app; the OS user can read them). Folder names derive from company/date/ref — sanitised for separators but see **F-08** (`..`). XML is `&<>`-escaped for text nodes (`filing/handler.js:207`); tag names come from app-controlled field keys.
- **In transit.** Only the optional LAN add-on moves document content (page images), behind TLS + bearer auth + entitlement, with a path-stripping DTO. Two gaps: **F-02** (arbitrary file read defeats the DTO intent) and **F-04** (enroll credential exposure). The licensing server never receives document content — only `product_id` + `fp_hash` + (for trials) plain contact details.
- **In logs / temp.** Diagnostic logs contain extracted document data (L-03, gitignored/local). Temp files hold document bytes during split/render (L-04). Audit log redacts secrets (tested) and never logs search query terms (`api/handler.js:294`).
- **Access control.** Role-shaped search (readonly = confirmed-only), admin-gated settings/templates/users/audit, workflow `editGuard` lock on confirm/defer/delete. Solid.

---

## 7. Robustness review

- **Timeouts/retries.** Licensing HTTP client sets timeouts (gate uses a 2.5 s `validate`, default 4 s; `client.js:48`, `handler.js:387`) and fails *open to cached token within grace* on network error — correct for UX without weakening the gate (rollback-proof). The detached `apiClient` has no explicit socket timeout on `request()` — add one so a hung server can't wedge the client.
- **Error handling.** PHP endpoints catch `Throwable`, log server-side, return generic errors (no stack/secret leak). Licensing gate fails **closed** on an internal gate error (`main.js:152`) but `needsOnboarding`/setting reads fail **open** by design (must never block entry) — consistent and intentional. Audit writes are best-effort and never block the triggering action.
- **Resource management.** better-sqlite3 is synchronous (no leaked async handles); Python child processes are tracked (`_currentBatchProcs`, `isBatchRunning`) and killed on stop; spawn paths attach `error`/`close` handlers. Watch a couple of `spawn` paths for `stdout`/`stderr` backpressure on very large outputs, and ensure the detached `apiClient` request timeout above.

---

## 8. Prioritised remediation plan

### Tier 1 — fix before commercial release (blocking)

| ID | Fix | Where | Type | Effort | Verify |
|----|-----|-------|------|--------|--------|
| F-02 | Ignore client `folderPath`/`filename`; resolve path server-side from `docId` only | `api/handler.js:312-334`, `previewService.js:74-90` | code | S | Add a test: authed client requests `?folderPath=…&filename=…` for a foreign path → 404/empty, never file bytes |
| F-03 | Per-IP + per-fp rate limiting + global trial cap on `/v1/*`; backoff on repeated `unknown_account` | `licensing-backend/public/v1/*`, new `lib/ratelimit.php` (or WAF) | code+infra | M | Script 100 trial/start with varied fp → throttled; repeated bad keys → 429 |
| F-01 | Multi-point enforcement (§5.2 steps 1–2 minimum) + installer signing + asar integrity/fuses | `main.js`, handlers, build config | architecture | L | Manual: patch the old single branch → app still locks at a workflow check |
| F-07 | Gitignore `Samples/`+`*.key`; confirm/rotate the sample keys | `.gitignore`, `Samples/` | config | XS | `git status` shows keys ignored; `git ls-files` clean |

### Tier 2 — should fix soon

| ID | Fix | Where | Type | Effort |
|----|-----|-------|------|--------|
| F-04 | Pin CA before sending credentials, or HMAC enroll with the pairing secret | `client/apiClient.js:159-167`, `api/handler.js` enroll | code | M |
| F-05 | IP backoff + lockout on admin login; make TOTP mandatory for admin | `admin/login.php`, `lib/admin_auth.php` | code | S–M |
| F-06 | Validate/whitelist paths in `open-file`/`show-in-explorer`; block exe/UNC | `processing/handler.js:253-254` | code | S |
| F-08 | Neutralise `..`/dot-only segments + assert `targetDir` within output root | `filing/handler.js:229-234` | code | XS |
| L-06 | Deny-all `.htaccess` in `keys/`; document docroot=`public/` in deploy script | `licensing-backend/keys/`, `scripts/Configure-WampBackend.ps1` | config | XS |

### Tier 3 — defence in depth / polish

`F-09` (blend a per-install secret into fp), `L-01` (`sandbox:true`), `L-02` (lint against raw `innerHTML` / Trusted Types), `L-03` (log retention + clear action), `L-04` (deterministic temp cleanup), `L-05` (single-use TOTP), `L-07` (constant-time pairing compare), `L-08` (optional client certs), robustness (detached `apiClient` request timeout).

---

## 9. Copy-paste follow-up prompts for future sessions

> **Fix F-02 (arbitrary file read):** In `src/modules/api/handler.js`, make the `GET /v1/documents/:id/pages` handler ignore any client-supplied `folderPath`/`filename` and always resolve the on-disk path server-side from the document row (working_path → stored_path → folder_path+original_filename), as it already does when they're absent. Add a hermetic test under `src/modules/api/` proving a foreign `?folderPath/&filename` returns no file bytes. Do not change the in-process IPC caller. Read-then-edit; keep the DTO boundary intact.

> **Fix F-03 (server rate limiting):** Add a minimal MySQL-backed token-bucket rate limiter (`licensing-backend/lib/ratelimit.php`) keyed on (IP, fp_hash) and a global daily trial cap, then apply it at the top of `trial_start.php`, `activate.php`, `validate.php`, `revoke.php`. Return 429 with a `retry_after`. Keep prepared statements; add a test under `scripts/` that simulates abuse. Don't weaken any existing validation.

> **Design F-01 (multi-point licensing):** Implement §5.2 steps 1–2: factor the cached-token evaluation into a shared `requireLicense()` guard and call it at the entry of `process-folder`, `confirm-review`, `search-documents`, and template-save handlers (deny on non-`allow`). Then entangle a token-derived value into the `.metadata`/confirm write path so removing the check corrupts output. Add `electron` integrity/fuse config and installer signing notes. Produce a plan first (read-only) before editing.

> **Fix F-06 (open-file hardening):** In `src/modules/processing/handler.js`, validate paths passed to `shell.openPath`/`showItemInFolder`: resolve to absolute, require containment within the output root / inbox / recorded doc paths, reject UNC and executable extensions. Add a unit test for the validator.

> **Re-audit prompt:** Re-run the security audit focused on the licensing client enforcement surface and the `/v1` API after the Tier-1 fixes land; confirm F-01/F-02/F-03/F-07 are closed and check for regressions in the token verifier and DTO projection.

---

*End of report. No source code was modified in producing this audit.*
