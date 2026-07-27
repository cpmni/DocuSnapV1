# Stage 6a — whole-DB encryption: dependency spike + startup/key design (2026-07-27)

*De-risking investigation for the plan's Stage 6a. Establishes the dependency, the startup-sequencing
seam, and the dual-wrap key hierarchy WITHOUT touching production code, the live DB, or node_modules —
so the risky steps (native install + one-time migration) are done later, supervised. Source of truth:
the approved remediation plan §6 + decision 10.1 (admin recovery passphrase) / 10.2 (user-scope DPAPI).*

## Objective
Encrypt the whole SQLite DB (and its WAL) at rest so a copied `docusnap.db(+wal)` is useless on another
machine, while every query semantic (LIKE full-text search, equality-key learning lookups, GROUP BY,
CAST) is preserved unchanged. Transparent page encryption is the only shape that preserves those
semantics (field-level would break search + the learning layer — established in the plan). The DB key is
a per-install random master key, dual-wrapped by DPAPI (no-prompt open) and an admin recovery passphrase
(recoverable on a new profile/machine).

## 1. Dependency — VETTED (safe, no install done)
- **`better-sqlite3-multiple-ciphers` v12.11.1, license MIT** (confirmed via `npm view`). A drop-in fork
  of `better-sqlite3` (current dep `^12.10.0` — same 12.x line, same API) that statically links
  **SQLite3MultipleCiphers (MIT)** over **public-domain SQLite**. No SQLCipher Commercial Edition, no
  GPL/AGPL, no proprietary-only crypto → satisfies the commercial-safe constraint.
- Cipher scheme: the library's **native ChaCha20-Poly1305** (or AES-256) — NOT the SQLCipher-format
  compatibility scheme (no interop need on a greenfield DB). Encrypts the DB **and the WAL** transparently.
- Native module → `electron-builder install-app-deps` (the existing `postinstall`) rebuilds it for the
  Electron ABI exactly like `better-sqlite3`/`argon2` today. **Must be added to
  `scripts/check-licenses.js`'s allowlist** (MIT election) or the prebuild gate fails it UNKNOWN.

## 2. Startup sequencing — ANALYZED, favourable (the plan's load-bearing risk)
The plan flagged: *"key unwrap must happen after app ready and before DB open."* Verified in the code:
- `getDb()` (`src/main.js:88`) is **LAZY**: `if (!_db) _db = require('../database/index').open();` — the
  DB opens on the FIRST `getDb()` call, not at module load.
- The first `getDb()` is reached INSIDE `app.whenReady().then(() => { … })` (`src/main.js:841`) — the
  settings reads during `decideAccess`/the auth flow. Nothing before `whenReady` accesses the DB.
- **safeStorage (DPAPI) is available after `app.whenReady()`** — which is exactly where we need it.

**Design seam (small, fail-safe):**
- `database/index.js`: add `setEncryptionKey(keyBuf)` that stashes the key; `open()` issues
  `PRAGMA key = "x'<hex>'"` (raw-key form, no KDF) immediately after `new Database(path)` and before any
  other pragma/migration. In encrypted mode, `open()` **throws if the key was not set** — so a
  mis-ordered `getDb()` fails LOUD in dev, never silently opens plaintext.
- `src/main.js`: as the **FIRST statement inside the `whenReady` handler** (before
  `launchStartupWindow()`), unwrap the master key (§3) and call `setEncryptionKey(key)`. Because `open()`
  is lazy and every `getDb()` caller runs during/after this point, the key is always set in time.
- No other file changes for the open path — the ~200 `getDb()` callers are untouched (transparent).

## 3. Key hierarchy — recovery arm PROVEN (`scripts/spike_key_wrap.js`, 6 checks green)
- **Per-install master key**: 32 random bytes, generated once, **dual-wrapped** and stored in userData
  (e.g. `%APPDATA%\ScanFinder\.dbkey`, itself outside the encrypted DB):
  - **Wrap A — DPAPI (no-prompt open):** `safeStorage.encryptString(masterKeyB64)` — the SAME mechanism
    `src/lib/secretStore.js` already ships for the CA key (user-scope, decision 10.2). Normal launches
    unwrap silently.
  - **Wrap B — admin recovery passphrase (escape hatch):** an Argon2id/scrypt KEK → AES-256-GCM wrap of
    the master key (format `MAGIC|ver|salt|iv|tag|wrapped`, mirroring the proven backupService container).
    The spike script proves: correct passphrase recovers the exact key; a wrong passphrase / tampered
    blob fail closed (GCM tag). Recovers the DB on a new Windows profile/machine where DPAPI is gone.
- **Rotation (from the plan):** rotating a WRAP (passphrase or DPAPI blob) re-encrypts only the small
  wrapped-key file — cheap, no DB rewrite. Rotating the MASTER key is `PRAGMA rekey` (heavy; reserve for
  compromise). Versioned key header (`ENC{n}`) lets old/new wraps coexist.
- **Recovery/data-loss:** the dual-wrap means losing DPAPI alone is NOT data loss (passphrase recovers).
  Losing BOTH = unrecoverable except from a backup — the runbook must state set/store/rotate for the
  passphrase (it becomes a managed secret).

## 4. One-time migration — SEPARATE, OWNER-SUPERVISED sub-step (NOT done here)
Do NOT run until §1–§3 are live and smoke-tested. Steps:
1. **Back up first:** copy the live plaintext `docusnap.db` (+ `-wal`, `-shm`) to
   `docusnap.pre-encrypt-backup.db`. Do not delete until the encrypted DB is confirmed good.
2. Open the plaintext DB, `ATTACH DATABASE 'docusnap.enc.db' AS enc KEY "x'<hex>'"`, run the
   multiple-ciphers export (`SELECT sqlcipher_export('enc')` equivalent), `DETACH`, then atomically
   swap `docusnap.enc.db` → `docusnap.db`.
3. **Rollback:** on any failure or a failed post-swap round-trip, restore the backup verbatim. Pin an
   interrupted-migration test (partial swap leaves a recoverable state).
4. Encrypt/clean the stale `docusnap.backup-*.db` snapshots beside the live DB (or delete them).

## 5. Gate for the live implementation (when supervised)
- `check-licenses` green with the new dep BEFORE merge; ABI rebuild + `npm start` launches clean.
- Cold-boot test: key unwrap precedes open; a mis-ordered `getDb()` throws (not silent-plaintext).
- **Semantic parity:** search + a hint/dominant-value/established-identity lookup return IDENTICAL
  results on an encrypted vs plaintext fixture DB.
- `strings docusnap.db(+wal)` shows NO plaintext OCR text or field values.
- A copy of the encrypted DB opened WITHOUT the DPAPI-wrapped key fails; the recovery passphrase opens it.
- Migration reversible from the backup; corpus realdoc byte-identical (extraction is DB-blind, but the
  DB it reads is now encrypted — prove the reprocess path still reads it).

## What this spike PROVED (safe, committed)
- Dependency is MIT/commercial-safe and a same-major drop-in.
- The startup path supports "unwrap after ready, before open" with a small fail-safe seam (no risky
  resequencing of the app).
- The recovery-passphrase wrap round-trips and fails closed (`scripts/spike_key_wrap.js`).

## What REMAINS (owner-supervised — NOT done autonomously, to protect a working dev env)
- `npm install better-sqlite3-multiple-ciphers` + native ABI rebuild + check-licenses allowlist.
- The `database/index.js` `setEncryptionKey`/`PRAGMA key` seam + the `main.js` whenReady unwrap call +
  the encrypted-DB round-trip + semantic-parity tests.
- The one-time migration (§4), backup-first + rollback.
These were held back because a native-module install/rebuild can destabilise the running dev
environment, and the migration rewrites the live DB — both want a person present.
