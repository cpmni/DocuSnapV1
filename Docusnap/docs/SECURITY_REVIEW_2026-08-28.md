# Scan Finder — Security Review (2026-08-28, overnight)

**Scope:** owner-authorized DEFENSIVE audit of the whole product — the Electron core app, the
detached LAN client, the Python OCR backend, and the PHP licensing backend + admin console.
**Method:** five specialist agents (document access-control, licensing+website login, Electron
IPC/preload, Python backend, and a stack-CVE research pass with live sources), then an **Oracle
adversarial vetting pass** that traced every load-bearing claim to source. Report-only — **nothing
was changed.** Oracle verdict: **audit sound (SIGN OFF), with two calibrations folded in below.**

---

## Bottom line up front

**The product is well-built. The one thing to fix before selling the LAN add-on into a multi-user
office is document access control.**

The "killer" payslip question has a **precise, partly-reassuring answer**:

- **On a single-user desktop — you're fine.** The app runs as the *logged-in Windows user* (install is
  elevated, but the running process is the normal user), so it can only reveal documents that user
  could already open in Explorer. No privilege boundary is crossed. (Oracle verified `perMachine`
  elevation is install-time only.)
- **On the LAN/detached-client or multi-user deployment — this is the real gap, and for that config it
  is CRITICAL.** Scan Finder has **no document-level access control tied to identity**: it authorizes by
  app *role* (admin/edit/readonly) + document *status*, never by who owns the document or which user is
  asking — and the database has **no owner/importer column at all**, so it *cannot* express "this doc
  belongs to HR." The cleanest breach is over `/v1`: the core reads a file with its own rights and
  streams the content to a remote client whose user never had any OS access to the core PC — a genuine
  confused-deputy. Any authenticated account (even `readonly`) can read every *confirmed* document;
  there is no way to file payroll into a compartment other staff can't read.

So the honest sales answer today is: **"Single-user: yes, safe. Multi-user / LAN client scanning mixed
HR + general documents: not yet — that needs per-doctype access control, which is scaffolded but not
built."** Everything else in the audit is **hardening** — licensing crypto, website login, the
renderer↔main boundary, SQL, and path handling are all genuinely solid.

---

## Your four questions, answered directly

**1. Can a standard user see/manipulate the app into serving payslips it runs as admin?**
**Deployment-conditional.** *Single-user desktop:* **no** — the process runs as the logged-in user, who
could already read those files at the OS level; the app crosses no boundary. *Multi-user app or the LAN
detached client:* **yes** — there is no identity/owner scoping, so any authenticated account reads every
confirmed document's content (rendered pages + OCR text + fields), most cleanly streamed over `/v1` to a
remote client with no OS access to the core PC. The remedy is scaffolded (`doctype_grants` seam) but not
implemented, and the schema needs an owner/doctype-restriction column to express it. (Finding 1.)

**2. Can the local DB be edited to fake a licence?** **NO — verified end-to-end, no bypass.** The local
`license_tokens` cache is convenience state only. Every access re-verifies the cached JWS against
**asar-baked** Ed25519 keys (`pinnedKeys.js` overrides `config/license.json`, forced-on when packaged);
the token is **device-fingerprint-bound** (a copied token fails `subject_mismatch`), `alg` is pinned to
`EdDSA` (rejects `none`/HS-confusion), `kid` is pinned, expiry/grace + a rollback-proof high-water-mark
are HMAC-bound to the device, and `enforcementActive()` hard-returns `true` with no env/setting/dev
hatch. A hand-inserted token fails `bad_signature`; no cached token → `locked_needs_online`. **Inherent
caveat:** tamper-*evident*, not tamper-*proof* against someone who repacks the ASAR / patches the
verifier — a *revenue* risk, not a customer-data one, and narrowed by Finding 10 (turn on ASAR integrity).

**3. Website login security?** **Architecturally sound (Oracle-confirmed).** Parameterised PDO
everywhere, a CSRF chokepoint (`admin_actions.php` runs `csrf_check` before any action and fails closed;
login/2FA check separately) using `hash_equals`, bcrypt + `session_regenerate_id(true)`,
`Secure`+`HttpOnly`+`SameSite=Lax` cookies, a **fail-closed** brute-force throttle, 5-min idle timeout,
consistent `h()` escaping (no XSS). **The one real weakness is the 2FA-optional posture you set tonight**
— enable the already-built TOTP before that console faces the internet (Finding 3). (Minor: `validate.php`
and `revoke.php` interpolate an `(int)`-cast, DB-sourced `entId` into a `COUNT(*)` — not injectable, but
bind it for consistency.)

**4. Prompt injection?** **N/A — there is NO LLM anywhere in the shipped product (Oracle-confirmed).** The
only LLM references are a `.gitignore` guard recording that the old Ollama/phi3 path was **deleted**;
zero runtime `require`/`import` of any inference SDK, zero chat/completions endpoint. Extraction is
deterministic Tesseract OCR + regex. User fields reach only prepared statements + escaped HTML — no
injection sink. A non-risk here by construction.

---

## Findings (ranked; Oracle-calibrated)

| # | Sev | Area | Finding |
|---|-----|------|---------|
| 1 | **HIGH** *(CRITICAL for multi-user/LAN)* | Access control | No identity/doctype document authorization — every authenticated account reads every confirmed doc; one defect spanning read + **enumerate** (search/queue) + **write**, both transports |
| 2 | HIGH | Licensing admin | Password-only admin console by default on an internet-facing, key-minting endpoint |
| 3 | HIGH | Stack | Electron 31 is end-of-life — unpatched Chromium/V8/Node (well-mitigated by sandbox+CSP+nav-lockdown, all verified on every window) |
| 4 | MED | Access control | Access gate disableable via `ACCESS_GATE_ENABLED` env with **no `app.isPackaged` guard** (load-bearing for the Finding-1 fix) |
| 5 | MED | Access control | `open-file`/`show-in-explorer` launch docs as the running process (relevant only once #1 is fixed / on elevated multi-user) |
| 6 | MED | Licensing /v1 | Rate limiter FAILS OPEN if the `rate_limits` table is absent (trial-farming, key-guess brake) |
| 7 | MED | Stack | node-forge 1.3.1 — CVE-2025-12816 ASN.1 desync (low real exposure: self-cert parsing only; fix = bump ≥1.3.2) |
| 8 | MED | Python / Stack | Native pdfium/Tesseract parse untrusted docs in an UNSANDBOXED process; vendored versions unpinned |
| 9 | MED | Packaging | Electron fuses unhardened in default build (RunAsNode etc.); client has no fuse step; ASAR integrity off |
| 10 | MED | Detached client | Client missing the nav / window-open / drop lockdown the core has (client is the more exposed app) |
| 11 | MED | Python | Latent path traversal in the reusable `previewService` seam (callers compensate today) |
| 12 | MED | Python | Raster-image import path lacks the DoS caps the PDF path enforces (`Image.MAX_IMAGE_PIXELS` unset) |
| 13 | LOW | Access control | OutputRoot/inbox get no app-managed ACLs (deployment-dependent) |
| 14 | LOW | Licensing admin | Global admin-login throttle enables a lockout DoS of the sole admin |
| 15 | LOW | Licensing client | No TLS pinning in the licensing client transport (MITM can only deny, not forge) |
| 16 | LOW | Licensing | Account keys unsalted SHA-256; temp keys 64-bit (only relevant under DB exfiltration) |
| 17 | LOW | Enrollment | First-enroll CA bootstrap is TOFU — credentials sent pre-pinning |
| 18 | LOW | Detached client | Client CSP lacks `base-uri`/`form-action` |
| 19 | LOW | Packaging | Installers unsigned; client installs per-user (user-writable app dir) |
| 20 | LOW | Python | Preview/thumbnail render path lacks page/size caps (bounded by the 300-page import cap) |
| 21 | LOW | Python | Predictable temp-file names in shared temp dir |
| 22 | INFO | Python | `--files-file` shard names not confined under `--folder` (app-generated today) |
| 23 | INFO | Licensing /v1 | `activate.php`/`validate.php`/`revoke.php` interpolate an internal int into SQL (int-cast, DB-sourced — not exploitable) |

---

## Finding 1 in full — the one that matters (HIGH; CRITICAL for the multi-user/LAN deployment)

**What's true (Oracle-verified):** `src/services/accessService.js canAccessDocument` decides on `role` +
`doc.status` + open-route party only. Rule at `:83` grants any `edit` every non-deleted doc; `:84-88`
grants any `readonly` every confirmed doc; the per-doctype seam `doctypeGrantDecision` (`:98-100`,
migration-56 `doctype_grants`) is an **inert stub returning `{deny:false}`**. The `documents` schema has
**no `owner_user_id`/`imported_by`/`created_by` column** — identity scoping isn't merely unwired, it's
inexpressible today. Reads resolve the file server-side and the **process** opens it, so content flows to
the caller regardless of the caller's OS rights. Over `/v1` that caller is a remote LAN peer.

**Why the severity is deployment-conditional:** on the single-user desktop the process = the logged-in
user, who already had OS read access — no boundary crossed. The genuine confused-deputy is the `/v1`
detached client (paid, opt-in add-on) and any multi-user desktop, where accounts share one process that
reads everything.

**This is ONE defect seen from three endpoints — it must be fixed as one change, or it half-enforces:**
- **Read (by-id):** already gated — detail/pages/thumbnail/stamps run `canAccessDocument`.
- **Enumerate:** **NOT gated.** `/v1/search`, `/v1/review/queue|deferred|counts`, **and the desktop
  twins** (`search/handler.js`, the desktop review queue) call `searchService`/`documents` directly,
  never `canAccessDocument`. A "restricted" payslip would 403 on open but still leak its supplier/ref/
  date/type **and its existence** in search + the queue. A restriction that leaks the row it hides is not
  a restriction.
- **Write:** **NOT gated.** `/v1 .../confirm|defer|delete|purge|restore` gate on `isWriter` only. A user
  denied *read* on a doctype could still confirm/delete/purge it.

**Two policy seams the owner must decide BEFORE a dev implements (or they'll get baked in wrong):**
- **Routing is a built-in bypass.** `accessService.js:66-68` returns `route_party` **above** the doctype
  check, and `test_access_service.js:157` **pins** that a routed recipient sees a doctype-denied doc. So
  any `edit` user could be *sent* a restricted payslip via an acknowledge/FYI route and read it lawfully.
  For payroll/HR that's the wrong default — decide per-doctype whether a route overrides the restriction,
  and change that pinned test deliberately (don't let a green test read as ground truth).
- **Read-deny ≠ write-deny.** Apply the doctype check at **every** doc-scoped endpoint, not just reads.

**Fix direction (the right layer, larger blast radius than a stub-fill):** add an owner/doctype-restriction
column + populate `doctypeGrantDecision`, fail-closed, and route **all** doc-scoped surfaces (read +
search/queue enumeration + write) through it, on **both** transports. Ship as one coherent change with a
gate: (a) an enumeration regression proving a restricted doctype is absent from search/queue for a
non-granted role on both transports, and (b) a per-field corpus diff showing **zero change when the grants
table is empty** (default-allow-preserving). Advisor + Oracle gate before build — this is a design arc.

**Interim guidance:** until this ships, **do not deploy the LAN add-on (or a multi-user desktop) into an
office that scans mixed HR/payroll + general documents.** Single-user desktop installs are unaffected.

---

## Findings 2–12 (condensed; full mechanisms verified by the agents + Oracle)
- **2 · HIGH — Password-only admin.** `admin_2fa_required()` defaults false; the console mints keys +
  sets `min_supported_version` (a forced-update lever over the whole install base). You set this tonight
  for access — fine short-term; provision the built-in TOTP (`2fa.php`, config-only) before it faces the
  internet. **Fix regardless:** the on-screen break-glass message points at `LICENSING_ADMIN_ALLOW_NO_2FA`,
  which **no code reads any more** → following it self-locks; update the copy to `LICENSING_ADMIN_REQUIRE_2FA`.
- **3 · HIGH — Electron 31 EOL.** Unpatched Chromium/PDFium/V8/Node; untrusted doc content reaches the
  renderer as PNG previews + OCR text. Mitigations verified present on **every** window
  (`contextIsolation`+`sandbox`+`nodeIntegration:false`, `default-src 'self'` CSP, global
  `web-contents-created` nav/window/webview lockdown, packaged remote-debug lockout). Upgrade to ≥41 +
  rebuild native modules; biggest single risk cut.
- **4 · MED — `ACCESS_GATE_ENABLED` has no packaged guard.** In a packaged build `=0` disables the whole
  per-doc gate (re-opens the SEC-03 id-walk). Contradicts the codebase's own "no env kill-switch on a
  security boundary in packaged builds" precedent (pinned keys, nav guard). Two-line `!app.isPackaged`
  clamp — **load-bearing for Finding 1** (no point adding authz behind a customer-flippable off-switch).
- **5 · MED — Elevated file hand-out** (`open-file`/`show-in-explorer`) — path-allowlisted (traversal
  closed), but launches in the process context; matters on elevated multi-user / once #1 lands. Keep the
  `file_opened_externally` audit.
- **6 · MED — /v1 limiter fails open** if `rate_limits` is missing (trial-farming, key-guess brake).
  Bounded by 80-bit keys + device-bound trials. Make table-presence a deploy gate + startup assertion.
  (Admin login uses the fail-CLOSED limiter — unaffected.)
- **7 · MED — node-forge 1.3.1 (CVE-2025-12816)** — low exposure (self-cert parsing only; external verify
  uses Node TLS + `crypto.X509Certificate`). Bump pin to `^1.3.2`.
- **8 · MED — Native parsers unsandboxed.** pdfium/Pillow/Tesseract parse attacker files in the Python
  process. Mitigated (separate process, watchdog, PDF DoS caps). Add the vendored libs to the version/
  patch gate; optionally run the OCR child under a restricted job object.
- **9 · MED — Fuses off + no ASAR integrity.** Default releases ship `RunAsNode`/`NODE_OPTIONS`/`--inspect`
  enabled (`afterPack-fuses.js` no-ops unless `HARDEN_FUSES=1`, never set); client has no fuse step.
  Build with `HARDEN_FUSES=1` + electron-builder `build.electronFuses` incl. ASAR integrity, core AND
  client. Also lifts the licence-repack bar from Q2.
- **10 · MED — Client missing nav lockdown.** `client/main.js` has no `web-contents-created`/
  `setWindowOpenHandler`/`will-navigate`; the client renders server-supplied content so it's the more
  exposed app. Port `main.js:989-1001` verbatim + add the drop-swallow.
- **11 · MED — Latent traversal in `previewService._resolveDocFile`** — trusts `folderPath`/`filename`;
  every current caller passes DB-derived paths so it's not reachable, but the containment lives in the
  callers not the seam. Move containment into the service when next touched.
- **12 · MED — Image import DoS.** No `Image.MAX_IMAGE_PIXELS`; an 89.5–178.9M-px image only *warns* and
  decodes (~0.5 GB × N workers). Set the cap + gate on size/dimensions; env-overridable; prove
  `realdoc_regression` stays byte-identical.

**13–23 (LOW/INFO):** OutputRoot/inbox no app-set ACLs · global-throttle single-admin lockout · licensing
client transport unpinned (MITM can only deny) · account keys unsalted SHA-256 / temp keys 64-bit ·
TOFU enrollment sends creds pre-pinning · client CSP missing `base-uri`/`form-action` · installers
unsigned + client per-user dir · preview render lacks page caps (bounded) · predictable temp names ·
`--files-file` shard names not confined · int interpolation in activate/validate/revoke (not exploitable).

---

## Verified strong (state these to buyers)
Renderer↔main boundary **intact** (contextIsolation+sandbox+nodeIntegration:false + minimal preload
allowlist + sender-validated transitions; repo-wide zero `webSecurity:false`/`nodeIntegration:true`/
`@electron/remote`/`NODE_TLS_REJECT_UNAUTHORIZED`) · path handling **closed** (all reads resolve the path
server-side from the DB row, ignoring client `folderPath`/`filename`) · **parameterised SQL** throughout ·
crypto correct (Argon2id, DPAPI-at-rest for CA+server keys, tamper-evident audit HMAC chain,
constant-time compares) · licensing offline-verify ordered + device-bound + pinned + non-disablable ·
detached-client TLS pins the CA with `rejectUnauthorized:true` (self-signed is a dev-only env escape, never
a UI bypass) · **no command injection, no unsafe deserialization** in the Python backend.

---

## Recommended order (Oracle's do-first list)
1. **Document access control as ONE change (Finding 1).** Owner column + `doctypeGrantDecision`, wired
   through read + **search/queue enumeration** + **write**, both transports; decide the routing-override
   and read-vs-write policy up front; gate with the enumeration + empty-grants-byte-identical regression.
   Advisor + Oracle before build. **Until then, hold the LAN add-on back from mixed-sensitivity multi-user
   offices.**
2. **Clamp `ACCESS_GATE_ENABLED` off in packaged builds (Finding 4)** — trivial, and load-bearing for #1.
3. **Port the nav/window lockdown to the client (Finding 10)** — copy `main.js:989-1001`; cheap.
4. **Provision admin 2FA (Finding 2)** — no code; highest-value config action on a key-minting console.
5. **Turn on the build hardening that exists (Finding 9)** — `HARDEN_FUSES=1` + ASAR integrity; shrinks
   the acknowledged licence-repack residual. Revenue-side, below the data items.
6. Then: Electron upgrade (Finding 3), node-forge bump (7), `rate_limits` deploy gate (6),
   `previewService` containment (11), image caps (12), vendored-lib version pinning (8).
7. The LOW/INFO items as defense-in-depth.

---

## Addendum — verified from the Chris product-vet run (2026-08-29)

**A1 · LOW–MEDIUM — the `/v1` client login does NOT enforce the forced temp-password reset.**
Chris (running the detached client live) signed in as a colleague "Sam" with her admin-issued **one-time
temp password** and went straight to a working session — no "set a new password" step, though her account
row reads *"MUST SET NEW PASSWORD."* **Confirmed in code:** the core login window blocks until the reset is
done (`auth/handler.js:241` returns `mustChangePassword`, enforced in `login/renderer.js:202`), but the
`/v1` session route issues a full session **without checking `must_change_password`** (no reference to that
flag anywhere in `api/handler.js`/`sessionService.js`); the client offers only an **optional** self-service
change (`/v1/auth/change-password`, `api/handler.js:416`). Net: an admin-issued "one-time" temp credential
keeps working on the client indefinitely and the colleague is never forced to set their own — breaking the
create-screen promise ("shown only once… asked to set their own on first sign-in").
- **Risk:** credential hygiene, not a direct breach — the temp password is admin-issued to a known user. But
  a "one-time" code that persists on the /v1 surface is a real weakness (it lingers, un-rotated, wherever the
  admin recorded it).
- **Fix direction:** have the `/v1` login/session issuance check `must_change_password` and either refuse
  normal operations until `/v1/auth/change-password` succeeds, or issue a restricted change-password-only
  token — mirroring the desktop's forced flow. (The /v1 auth is otherwise well-built — it already revokes
  sessions on password change and re-auths TOTP re-enrolment.)
- **Confidence:** CONFIRMED from code + reproduced live in the client.

*Prepared by the overnight security pass (5 agents + Oracle vetting) + the Chris product-vet corroboration.
Report-only; nothing was implemented. The remediation of Finding 1 is a design arc — take it through the
advisor + Oracle gate before building.*
