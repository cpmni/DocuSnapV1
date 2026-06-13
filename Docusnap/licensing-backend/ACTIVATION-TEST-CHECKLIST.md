# Local Activation-Test Checklist — WAMP Licensing Backend

## Task summary
Confirm the local WAMP licensing backend is ready for a single, local activation
test and that the **client config matches the already-seeded database row set**.
Uses the existing seeded test credentials only — no schema, backend, or deploy
changes; no real secrets or production data.

**Seeded test credentials (local only):**

| Field | Value |
|---|---|
| `product_id` | `1d2e9b68-6316-45b4-bd24-7854d4102b1e` |
| `activation_key` | `TEST-A645979E838243A5` |
| Entitlement state | **2 seats, status `active`** (account `active`) |

> The `activation_key` is the plaintext to type into the client. The database
> stores only `SHA2(activation_key, 256)` (see "Caution" below).

## Checklist — client config must match the DB seed
- [ ] **product_id** in client config == `1d2e9b68-6316-45b4-bd24-7854d4102b1e`
      (must equal the seeded `products.product_id` / `entitlements.product_id`).
- [ ] **activation key** entered in client == `TEST-A645979E838243A5`
      (its SHA-256 must match the seeded `accounts.account_key_hash`).
- [ ] **backend URL** points at local WAMP, e.g.
      `http://localhost/licensing/public` (default WAMP layout), or the host root
      if an Apache vhost maps the docroot to `...\www\licensing\public`.
- [ ] Expect activation to bind **1 of 2** seats and report the entitlement
      `active` — a second device can bind the remaining seat; a third should be
      refused (seats exhausted).

## Verification steps (backend is serving the licensing endpoints)
Run before the client test. Use PowerShell `curl.exe` (not the PS alias).

1. **Health endpoint** — confirms PHP + docroot are served:
   ```powershell
   curl.exe -s http://localhost/licensing/public/
   ```
   Expect JSON: `{"service":"licensing","api":"v1","status":"ok",...}`.

2. **Rewrite + routing** — confirms `.htaccess` / mod_rewrite map `/v1/*`:
   ```powershell
   curl.exe -s "http://localhost/licensing/public/v1/status?product_id=1d2e9b68-6316-45b4-bd24-7854d4102b1e&fp_hash=test"
   ```
   Expect a structured JSON response (not an Apache 404/500 HTML page). A JSON
   body — even a validation/“not found” result — proves the endpoint is wired and
   reaching the DB.

3. **Readiness re-check** (optional, read-only):
   ```powershell
   .\scripts\Verify-WampBackend-Ready.ps1
   ```
   Expect all required checks PASS, including `6. Activation-test seed data`
   reporting **1 account / 1 entitlement**.

> If step 1/2 return Apache HTML errors: confirm MySQL + Apache are running, the
> vhost/DocumentRoot points at `...\www\licensing\public`, and `mod_rewrite` is
> enabled. (These are the MANUAL-CHECK items from the verify script.)

## Caution
Keep these test credentials **local only** — the plaintext `activation_key` is
not stored anywhere in the DB (only its SHA-256 hash) and **cannot be recovered**
from the database if lost; never commit it or reuse it outside this local box.
