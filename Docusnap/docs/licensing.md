# Licensing, activation & legal — extracted from CLAUDE.md
> Deep reference split out of the always-loaded CLAUDE.md (2026-07-03) to keep the root
> memory lean. Read this when a task touches this area. Nothing here was changed — verbatim move.

## Licensing & activation
Optional license gate: trial + paid-seat, all device-bound. **OFF in dev, ON by default in
packaged builds.** The MAIN process is the sole decider — the renderer can only REQUEST
entry (`license-enter-app`), never self-grant.

**Flow**: login → `enterMainApp()` (main.js) → `licensingModule.decideAccess()` → `allow`
then `needsOnboarding()` → on a clean install the **first-run setup wizard** (see First-run
wizard), otherwise the main shell; a non-`allow` gate routes to the **license window**
(`src/windows/license` — Start/Resume Trial · Enter key + Activate · Release · Check again).

**Enforcement is ALWAYS ON** — `enforcementActive(db)` in `src/modules/licensing/handler.js`
returns `true` unconditionally. The old relaxations are REMOVED: the
`DOCUSNAP_LICENSE_ENFORCEMENT` env override, the `license_enforcement_enabled` setting
branch, and the unpackaged/dev-mode (`app.isPackaged`) bypass are gone, and the runtime
toggle IPC (`license-set-enforcement`) is hard-gated to a no-op. There is NO "start with
licensing off" path in any build (dev runs against a real backend trial/seat). `decideAccess`
always proceeds to the token/backend gate. A valid cached trial/seat token always passes, so
legit users open normally.

**decideAccess specifics**: best-effort online `validate()` (short timeout) refreshes the
cached token; a REACHABLE backend returning no grant **clears** the stale seat token, so a
server-side release/revoke locks on the next online check; OFFLINE falls back to the cached
token within its 7-day grace. Clock-rollback defended by a monotonic high-water mark
(`license_time_hwm` in settings). Tokens verified OFFLINE in `src/lib/license/token.js`
against pinned public keys: alg must be EdDSA, kid pinned, signature, then product/fp/
expiry/grace/state. Fingerprint = SHA-256(product_id | Windows MachineGuid)
(`src/lib/license/fingerprint.js`) — raw value never leaves main, never sent.
⚠ Non-sysprep'd VM **clones share MachineGuid** → same fp_hash.

**config/license.json**: `base_url` (per-environment — change for WAMP→prod, no code
change), `product_id`, `public_keys` (PUBLIC only). Bundled via extraResources → **rebuild
the installer after editing it**.

**Backend** `licensing-backend/` (PHP+MySQL): `/v1/{trial/start,activate,validate,revoke,
status}`. account_key stored only as SHA-256; tokens signed with the Ed25519 seed in `keys/`
(outside docroot). Admin web page `public/admin/` — session + CSRF, single bcrypt password
in `keys/admin_password.hash`, BRIGHT-ONLY theme — manages products/accounts/entitlements/
seats and issues **temporary licenses** (= an entitlement with `expires_at`; one-time key
shown once). Deploy/verify via `scripts/Configure-WampBackend.ps1` / `Verify-WampBackend-Ready.ps1`
(the Configure script now fails loudly on mysql errors).
**OWNER EMAIL ON NEW TRIAL** (`lib/notify.php` + `trial_start.php`): a genuinely-new trial mint
(`!$resumed`) emails the owner via PHP `mail()` (no composer/SMTP lib) — recipient/sender from
env `LICENSING_NOTIFY_TO`/`_FROM` (default `licensing@scanfinder.co.uk`), opt-out
`LICENSING_NOTIFY_ENABLED=false`. **Best-effort only** — a mail failure (incl. mail() unconfigured
on the WAMP dev box) is swallowed to `error_log` and NEVER breaks the trial response. Resumes are
NOT emailed (they fire on every re-check). `notify_owner()` is reusable for future events. Body
carries the business/contact/email + fp_hash (a hash, fine) + IP; never any secret. **Redeploy +
set the mail env on IONOS for it to actually send.**

**Admin 2FA** (`public/admin/{login,2fa}.php`, `lib/admin_auth.php`): optional TOTP
(RFC6238, dependency-free pure PHP — backend has NO composer), two-stage login
(`admin_login`→'ok'|'need_2fa'|'fail'), bcrypt-hashed recovery codes, secret+codes at
rest in `keys/admin_2fa.json` (outside docroot), 5-min inactivity timeout. QR uses a
**self-hosted** vendored `public/admin/qrcode.min.js` (MIT qrcodejs — no CDN); manual
key/URI entry is the fallback when the file is absent. **When editing admin_auth/login/
2fa/qrcode, redeploy to `C:\wamp64\www\licensing\public\admin\`.**

**Tests** (Electron-as-Node): `database/modules/test_license_*.js`. Gate tests **stub
`ctx.licenseTransport`** to stay hermetic (no real backend) — do the same for any new one.

**Secrets**: never log/echo account or activation keys; never re-display a one-time key
after issuance; never expose `account_key_hash` or the raw fingerprint.

---

## Legal / Terms acceptance (2026-07)
A version-stamped Disclaimer & Terms-of-Use acceptance gate. SINGLE SOURCE OF TRUTH:
one bundled **`LEGAL.txt`** (repo root; DRAFT pending solicitor review — see the
`[SOLICITOR:]` markers) shipped via `build.extraResources` AND used as the installer's
NSIS licence page (`build.nsis.license = "LEGAL.txt"` — only renders with `oneClick:false`;
coexists with the custom `installer.nsh`). Surfaced in three places from that one file:
- **Installer** — accept-to-continue licence page (weak evidence; bypassable via silent
  `/S` — the in-app gate is the real record).
- **First-run / version-bump gate** — `src/windows/legal/{index.html,renderer.js}`, shown
  by `enterMainApp()` AFTER the licence gate + BEFORE onboarding/shell whenever stored
  acceptance ≠ `LEGAL_VERSION` (main.js). Enforced in MAIN (never renderer-only). UX:
  "Before you start — please review the Terms" · editable-text (unused) scroll box ·
  checkbox · **Accept & Continue** (disabled until ticked AND the text actually loaded —
  can't accept unread/empty terms) · **Decline & Quit** (two-step confirm + contact line)
  · "Open in a separate window". `legal` is NOT a `PRIMARY_WINDOW` (so an X-close =
  Decline & Quit, never a headless hide-to-tray dead-end); `legal-accept`/`legal-decline`
  are sender-verified (only the legal window may call them). Also: the tray Review/Settings
  openers now require the MAIN shell (`inShell()`), closing a latent pre-shell bypass.
- **Re-read any time** — About box "Terms & Disclaimer" + Settings → Advanced → Legal,
  both `→ open-legal` (shell.openPath of the bundled file).

Acceptance stored LOCALLY only: `settings.terms_accepted = { version, hash(LEGAL.txt),
app_version, accepted_at }` — no personal data, no telemetry, no external calls; the hash
proves WHICH text was accepted (re-prompt still keys on `LEGAL_VERSION`, a MATERIAL bump).
`termsAccepted()` fails OPEN to "not accepted" (a read error never skips the gate). To
re-prompt everyone: bump `LEGAL_VERSION` (main.js) + the file's `Version:` header.
IPC: `get-legal-text`, `open-legal`, `legal-accept`, `legal-decline`. Reviewed by eric
(Electron) + bob (product) + an AI legal-advisor pass; the legal-review action items
(remove the DRAFT banner, contracting-party identity, CRA/UCTA liability wording, a
separate Privacy Notice for the licensing telemetry) are OWNER/solicitor tasks, not code.

---

