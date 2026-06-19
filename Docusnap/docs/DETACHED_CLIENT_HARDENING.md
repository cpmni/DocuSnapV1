# Detached Search Client — Hardening Checklist (Stage 6)

Security posture of the detached ScanFinder search client + `/v1` API. Split into
what is **implemented & tested in code** and what is a **deployment/operational
decision** that must be done per-site before any real LAN exposure.

## Implemented & tested (in this repo)

- **Off by default / loopback only.** The API does not start unless
  `SCANFINDER_API=1`, and binds `127.0.0.1` unless TLS is configured; it refuses to
  bind a non-loopback host without TLS, and rejects non-loopback peers defensively.
- **Parallel auth boundary.** Local-account login + **TOTP MFA** (RFC 6238), opaque
  bearer **session tokens** with absolute + idle expiry and revocation. The in-process
  Electron `requireRole` checks are untouched. Token lives in the client's MAIN
  process, never in the renderer.
- **Role-from-token authorization.** admin/edit/readonly enforced server-side on
  every request via the shared services (same rules as internal search/workflow).
- **No internal leakage.** Every response is an allowlist DTO projection — filesystem
  paths (`stored_path`/`folder_path`/`working_path`) and raw OCR never cross the wire.
  Page previews are returned as image bytes; the path is resolved server-side by id.
- **Lockstep version handshake (bidirectional).** Client `connect()` blocks/warns on
  server contract drift; the server returns **426** to a client whose contract major
  is incompatible (`X-ScanFinder-Client-Contract`). `/health` stays open.
- **Workflow integrity.** Approval is a separate state machine that never rewrites
  filing state; the Review pipeline is locked (`workflow_lock`) while an approval
  route is open (admin override is audited).
- **Audit.** login/logout, totp setup/enable, search, document_open, and every
  workflow transition are audited (`source: client_api`); login is rate-limited.
- **Transport headers.** `no-store`, `X-Content-Type-Options: nosniff`, and HSTS when
  served over TLS.

## Deployment / operational decisions (NOT code — do before LAN/production)

- [ ] **TLS certificate.** Provision a server cert from an **internal CA** (preferred)
      or a pinned self-signed cert; point `SCANFINDER_API_TLS_CERT` / `_KEY` at it.
      For dev/testing use `scripts/New-ScanFinderDevCert.ps1` (self-signed — NOT for
      production). Consider mTLS / device certs only if you must restrict which
      machines may connect.
- [ ] **Always-on host.** Run the core app + API on a dedicated always-on machine, not
      a staff workstation (availability).
- [ ] **Signed installer / updates.** The current installer is unsigned (SmartScreen
      warning). For lockstep client+core delivery, sign both and verify update
      integrity (e.g. electron-builder signing + an updater with signature checks).
      Ship the client and core as one versioned release.
- [ ] **Encryption at rest.** `docusnap.db` and the document store are unencrypted.
      If required by compliance, evaluate SQLCipher
      (`better-sqlite3-multiple-ciphers`) for the DB and OS-level / BitLocker volume
      encryption for the document store. (Decision pending — see plan open questions.)
- [ ] **Retention / legal hold.** No retention automation exists. Define schedules /
      hold rules if required; the audit log already supports GDPR-aware export.
- [ ] **SSO (optional later).** The auth boundary is pluggable; OIDC/SAML can replace
      or augment local+TOTP if an identity provider is adopted.
- [ ] **Firewall.** Restrict the API port to the intended LAN segment.

## Quick start (dev, loopback, no TLS)

```sh
# terminal 1 — core app exposing the API on loopback
SCANFINDER_API=1 npm start
# terminal 2 — the detached client
cd client && npx electron .
```

## Quick start (LAN, TLS)

```powershell
# generate a dev cert (self-signed; for testing only)
./scripts/New-ScanFinderDevCert.ps1 -OutDir C:\scanfinder-cert
$env:SCANFINDER_API='1'; $env:SCANFINDER_API_HOST='0.0.0.0'
$env:SCANFINDER_API_TLS_CERT='C:\scanfinder-cert\server.crt'
$env:SCANFINDER_API_TLS_KEY='C:\scanfinder-cert\server.key'
npm start
# on a client PC: trust the cert (or set SCANFINDER_CLIENT_ALLOW_SELF_SIGNED=1 for dev)
$env:SCANFINDER_CLIENT_API_URL='https://server-pc.lan:8765'
cd client; npx electron .
```
