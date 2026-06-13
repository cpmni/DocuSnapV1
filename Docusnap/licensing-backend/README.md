# Licensing backend (skeleton)

Small, purpose-built activation service for the desktop client. **Phase 0
scaffold only — no business logic yet.** Endpoints are placeholders that return
`501 not_implemented`; the real logic arrives in later phases.

This service is intentionally self-contained so it can move from the temporary
**WAMP** dev VM to the future host (e.g. **IONOS**) unchanged. On the client, the
only thing that changes between hosts is `base_url` in `config/license.json` — a
**config-only** change, never a code change.

## Layout
```
licensing-backend/
├── README.md            # this file
├── CONTRACT.md          # frozen /v1 API contract + signed-token claims
├── schema.sql           # MySQL schema (the 7 tables)
├── public/
│   ├── index.php        # health/version
│   └── v1/              # placeholder endpoints (501 until implemented)
│       ├── trial_start.php
│       ├── activate.php
│       ├── validate.php
│       ├── revoke.php
│       └── status.php
├── scripts/
│   └── generate_keys.js # Ed25519 keypair generation (run on the host)
└── keys/                # PRIVATE signing keys — .gitignored, NEVER bundled
```

## Keys
`scripts/generate_keys.js` writes the **private** key to `keys/` (gitignored,
host-only) and prints the **public** key (SPKI DER, base64) to paste into the
client's `config/license.json`. The private key is never committed and never
ships with the desktop client.

## Provisioning for activation (Phase 3)
Accounts and entitlements are provisioned out-of-band (sales/admin); there is no
self-serve account-creation endpoint. To test `/v1/activate` on the VM, seed a
row set manually (the `account_key` is stored only as a SHA-256 hash):
```sql
INSERT INTO products (product_id, name_internal) VALUES ('<product_id>', 'product');
INSERT INTO accounts (account_key_hash, status) VALUES (SHA2('<ACTIVATION-KEY>', 256), 'active');
INSERT INTO entitlements (account_id, product_id, seats_total, status)
  VALUES (LAST_INSERT_ID(), '<product_id>', 2, 'active');
```
Then activate with `account_key = '<ACTIVATION-KEY>'`.

## Host migration (WAMP -> IONOS) — config only
Moving hosts requires **no client or server code change**:
1. Stand the service up on the new host (copy `public/`, `lib/`, `keys/`; import
   `schema.sql`; set `LICENSING_DB_*` env vars; enable `mod_rewrite` + sodium).
2. Point the desktop client at the new host by editing **only**
   `config/license.json` -> `base_url`. The pinned `public_keys` map is unchanged
   (same signing keys), so already-issued tokens keep verifying.
3. If you also rotate keys during the move, add the new `kid` to `public_keys`
   (overlap), flip the backend `ACTIVE_KID` to sign with it, then retire the old
   `kid` from `public_keys` once no old tokens remain (see Key rotation below).

## Key rotation (dual-kid overlap)
`config/license.json` `public_keys` is a `kid -> key` map, so multiple keys are
trusted simultaneously:
1. `node licensing-backend/scripts/generate_keys.js k2` (+ `export_sodium_seed.js k2`).
2. Add `k2`'s public key to `public_keys` and ship that config (client now trusts
   **k1 and k2**).
3. Flip the backend signing `ACTIVE_KID` to `k2`.
4. After all `k1` tokens have aged out (past grace), remove `k1` from
   `public_keys` — `k1` tokens are then rejected (`unknown_kid`).

## Security posture (enforced from later phases)
- Every grant/deny response is a **compact JWS, `alg=EdDSA`** signed with the
  private key; the client verifies it **offline** with the pinned public key.
- HTTPS is required in production but is **not** the trust anchor — the signed
  token is.
- Brand-neutral throughout: identifiers use `product_id`, not any product name.
