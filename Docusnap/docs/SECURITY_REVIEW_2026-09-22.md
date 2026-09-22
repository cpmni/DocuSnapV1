# Scan Finder / DocuSnap — Security Review (2026-09-22)

Read-only review requested by the owner (app vs backend; does the backend DB need encryption; is
anything exposed; AI-coded-project holes). Method: read the PHP licensing backend, schema, crypto, and
exposure surface at the source; two sub-audits (Electron boundary; /v1 + document access control);
prior reviews (`SECURITY_REVIEW_2026-08-28.md`, `_2026-09-01.md`) re-checked against current code.
Nothing was modified.

**Headline:** the product is well-built and has hardened materially since the last audits — most prior
findings are fixed and pinned. **No new Critical/High CODE vulnerabilities.** The two top items are
owner/config actions (admin-console 2FA, code-signing). Direct answers to the three questions follow.

---

## Q1 — How does security fare between the app and the backend?
**Strong.** Licences cannot be forged; the purchase→licence path is signature-gated; the LAN client
boundary is solid. Three boundaries:
- **Desktop app ↔ PHP licensing server** (HTTPS): client sends product_id, device fingerprint
  (SHA-256), activation key, trial contact details; server returns **Ed25519-signed JWS tokens** the
  app verifies OFFLINE against asar-baked PUBLIC keys (alg pinned, signature-before-claims,
  device-bound, rollback-proof). A malicious client can only guess keys / start trials (rate-limited +
  device-bound). **A MITM can DENY but cannot FORGE a licence.** Residual: licensing HTTP transport not
  cert-pinned (LOW) — a rogue-CA MITM could capture the account_key/PII in transit or deny, not mint a licence.
- **Detached LAN client ↔ core /v1 API** (TLS, client pins the CA `ca.crt`, `rejectUnauthorized:true`):
  authenticated sessions, IDOR closed, forced-temp-password enforced, DTO projection strips internal
  fields, sessions revoked on admin actions.
- **Polar (payments) → backend webhook** — the licence-MINTING boundary: `public/v1/polar_webhook.php:46`
  verifies a Standard-Webhooks HMAC over the RAW body BEFORE any DB write, fail-closed when no secret,
  idempotent by webhook-id. **Correctly gated** — no fake "order.paid" can mint a free licence.

## Q2 — Does the backend (MySQL licensing) DB need encryption at rest?
**Recommended (Medium), mainly for GDPR/PII — but it is NOT where the crown-jewel secret lives, and is
lower-stakes than the desktop DB.** The MySQL DB holds: hashed account keys (SHA-256 of an 80-bit random
key — not reversible), **customer names + emails**, device fingerprints (SHA-256), **IP addresses**
(one row per app launch, a growing log), Polar customer IDs, entitlement notes. It does NOT hold
plaintext keys, the signing private key, payment/card data (Polar is Merchant-of-Record), or any
document content.
- A DB dump = a **privacy/GDPR incident** (names+emails+IPs+fingerprints), NOT licence-forgery or payment.
- No DB-level at-rest encryption is configured today (relies on host disk protection).
- **Recommendation:** enable MySQL at-rest encryption (InnoDB tablespace / host TDE) OR confirm host
  full-disk encryption, for PII hygiene. Schedule `scripts/prune_audit_events.php` (IP-log retention) and
  disclose IP logging in the privacy policy (`PRIVACY_IP_LOGGING_DRAFT.md`).
- **The real backend at-rest priority is NOT the DB — it is the Ed25519 signing seed**
  (`keys/ed25519_*_sodium_seed.b64`): its exposure = forge licences for every customer, undetectably.
  It is outside the docroot, gitignored, `.htaccess`-backstopped. Its filesystem permissions + host
  security matter most; encrypting MySQL does nothing for it.
- **Desktop SQLite DB is the bigger data-at-rest gap:** it holds the full OCR text of EVERY document
  (the actual customer content), plaintext by default; the encryption arc is built but DARK/un-migrated.
  Ship desktop DB encryption default-on, or ship a loud documented "enable DB encryption / BitLocker"
  posture — do not ship silent.

## Q3 — Is anything exposed that shouldn't be?
**No committed secrets; the exposure surface is well-defended.** Verified: no secrets in git (private
keys / admin hash / webhook secrets gitignored, never committed; `config/license.json` = PUBLIC keys
only; the two "PRIVATE KEY" matches are test fixtures). Docroot = `public/` only (`lib/`, `keys/`
outside web root; `.htaccess` deny-backstops; HTTPS forced; `-Indexes`; dotfiles denied; security
headers in `lib/harden.php`; generic 500s). /v1 DTO projection is an allowlist (FORBIDDEN_FIELDS =
`stored_path/folder_path/working_path/ocr_text`). Every admin page calls `require_admin()`; CSRF
centralised + validated redirect. Remaining exposures ranked below.

---

## Findings — triage in this order

### HIGH (owner/config actions, not code bugs)
- **H1 · Admin console is PASSWORD-ONLY by default** on an internet-facing, licence-key-MINTING console
  (`lib/admin_auth.php:126-130`, `admin_2fa_required()` false unless `LICENSING_ADMIN_REQUIRE_2FA=1`).
  It can mint keys AND set `min_supported_version` (a forced-update lever over the whole install base).
  TOTP+recovery machinery is already built. **Fix (no code): provision TOTP + set the env flag; VERIFY
  it is enabled on the live host.**
- **H2 · Installer is UNSIGNED** (`package.json` has no signing config). The asar-integrity fuses only
  bite once the binary is Authenticode-signed. **Fix (owner): OV/EV code-sign, or rely on MS-Store signing.**

### MEDIUM
- **M1 · Backend MySQL unencrypted at rest + a growing IP/PII log** (see Q2). Enable at-rest encryption
  or confirm host FDE; schedule the audit-prune; disclose IP logging in the privacy policy.
- **M2 · Desktop SQLite plaintext by default** (holds all OCR text); encryption arc DARK/un-migrated.
  Ship default-on or a loud documented posture. **The single largest data exposure.**
- **M3 · No per-identity/doctype ACL (PARTIAL).** Departments (mig 184) closes read+enumerate+write for
  docs TAGGED to a department the viewer isn't in — but only when departments are configured. On a
  default install with no departments, or any untagged doc, every authenticated writer enumerates every
  doc and reads every confirmed doc (`doctype_grants` still an inert stub). **Interim:** don't deploy the
  LAN add-on into a mixed HR/payroll office unless departments are configured for sensitive types;
  longer-term finish the doctype-grant ACL.
- **M4 · /v1 rate limiter FAILS OPEN if the `rate_limits` table is absent** (`lib/ratelimit.php`). An
  un-migrated host silently accepts unlimited activation/key-guess/trial traffic. **Fix:** table-presence
  a deploy gate + startup assertion. (Admin login uses the fail-CLOSED `rate_hit_strict`.)
- **M5 · Exposure protections are Apache-only** (`.htaccess`, HTTPS force, `-Indexes` inert on
  nginx/LiteSpeed; there the outside-docroot layout is the sole wall before the signing seed). **Fix:**
  confirm the live host is Apache AND docroot = `public/`.

### LOW
- **L1 · Account keys unsalted SHA-256** (`activate.php:36`) — acceptable (80-bit random key), only
  relevant under DB exfiltration.
- **L2 · Licensing HTTP transport not cert-pinned** — MITM can capture/deny, not forge. Consider pinning.
- **L3 · `dev-get-slice` uses string `startsWith`, not realpath** (`src/main.js:~1860`) — admin/edit-gated,
  temp-dir-scoped, image bytes only; a symlink inside the temp dir could redirect out. Align with
  `lib/pathContainment`.
- **L4 · `enableCookieEncryption` fuse not declared** — inert today (token in main-process memory);
  enable if cookie-backed state is ever added.
- **L5 · Admin console has no CSP header** — XSS already mitigated by consistent `h()` escaping +
  self-hosted assets; CSP would be defence-in-depth.

### Info / not-a-problem (verified)
- `(int)$entId` interpolated into COUNT(*) — int-cast, DB-sourced, NOT injectable.
- **No SQL injection** — PDO `EMULATE_PREPARES=false`, parameterised throughout; zero string-built SQL.
- **No command injection** — every Python spawn is array-form `spawn(exe, argv, {windowsHide:true})`;
  the only `shell:true` is two build scripts with fixed literal commands.
- **No dangerous PHP sinks** — zero `exec/shell_exec/system/eval/unserialize/extract` outside tests;
  mail paths validate the address + strip CRLF.

## Confirmed FIXED since 08-28 / 09-01 (state to buyers)
Forced temp-password on /v1 (mig 169); IDOR closed (`canAccessDocument` + dept gate on every by-id
read AND write, mutations 404 to hide existence); write-deny follows read-deny; settings-backup
fabricated-fingerprint hole closed (mig 169, signature-verified paid seat required); Electron 31→44
(Node 24); node-forge 1.3.1→1.4.0 (CVE); fuses applied + machine-verified against the packed binary;
`ACCESS_GATE_ENABLED` clamped on in packaged builds; client nav/window/webview lockdown + CA-pinning;
session revocation on password-reset/role-change/deactivate; TOTP enforced when enabled.

## Verified strong (baseline)
contextIsolation + sandbox + nodeIntegration:false on every window; minimal named-channel preload;
zero `webSecurity:false`/`@electron/remote`/`NODE_TLS_REJECT_UNAUTHORIZED`; all file reads resolve
server-side from the DB row; parameterised SQL; Ed25519 offline-verify ordered/device-bound/pinned;
Polar webhook signature-gated; admin bcrypt + CSRF + fail-closed throttle + secure/HttpOnly/SameSite
cookies + TOTP; logger redacts by default; no committed secrets.

**Do-first:** H1 (provision + verify admin 2FA) → H2 (code-sign) → M4/M5 (deploy gates) → M1/M2
(at-rest encryption decisions) → M3 (hold LAN add-on from mixed-sensitivity offices unless departments
configured). All findings report-only; nothing was implemented.
