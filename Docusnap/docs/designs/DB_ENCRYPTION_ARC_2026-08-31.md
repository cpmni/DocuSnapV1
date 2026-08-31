# DB-at-rest encryption — the arc (2026-08-31)

Whole-DB transparent page encryption so a copied `docusnap.db(+wal)` is useless on another machine,
every query semantic (LIKE search, equality-key learning lookups, GROUP BY, CAST) preserved. Owner's
ask: "the DB is text-editor readable." Consensus eric+gary → **Oracle SIGN-OFF-WITH-CONDITIONS**
(verdict at the foot of `docs/oracle_log.md`, 2026-08-31). Prior art:
`docs/designs/STAGE6A_ENCRYPTION_SPIKE_2026-07-27.md` + `scripts/spike_key_wrap.js`.

## Design (settled)
- **Library:** `better-sqlite3-multiple-ciphers` (MIT) as a **package.json ALIAS**:
  `"better-sqlite3": "npm:better-sqlite3-multiple-ciphers@^12"` — a same-major drop-in, so the ~200
  `getDb()` callers are untouched. Native module → `install-app-deps` rebuilds for the Electron ABI.
  MIT already passes `scripts/check-licenses.js` (the `MIT` election), so no allowlist edit is needed;
  a runtime **name/cipher pin** is owed (assert the loaded module is the ciphers fork).
- **Cipher:** native ChaCha20-Poly1305, **raw 256-bit `PRAGMA hexkey`** (no KDF at the DB boundary),
  issued as the FIRST statement after `new Database` — encrypts the DB and the WAL.
- **Key hierarchy** (`src/lib/dbKey.js`): a per-install 32-byte master key, dual-wrapped in userData,
  OUTSIDE the DB and OUTSIDE every backup:
  - **Wrap A — DPAPI, no-prompt:** `.db-key` = `secretStore.encryptAtRestStrict(base64(masterKey))`.
    **FAIL-CLOSED** — the DB key inverts auditKey's availability-over-secrecy calculus; a plaintext key
    file leaves the DB effectively unencrypted, so we never fall back to plaintext.
  - **Wrap B — one-time printed RECOVERY KEY:** `.db-recovery` = masterKey under argon2id(code) →
    AES-256-GCM, shown ONCE on the final onboarding card. **No daily password** (login lives inside the
    DB; /v1 + tray run headless). Lose DPAPI alone → the code recovers on a new profile/machine; lose
    BOTH → permanent loss (a managed-secret runbook item; recorded honest in pendingfeatures).
- **No auto-migrate on update.** Existing installs migrate ONLY behind the completed recovery ceremony.
- **Scope honesty:** filed PDFs, the import inbox, and `.metadata/*.xml` stay plaintext — BitLocker is
  the whole-disk answer. This arc protects the DB (OCR text + learned values + field data) only.

## Oracle ship-blockers → how each is handled
1. **secretStore fail-open write** would silently mint a plaintext keyfile → **`encryptAtRestStrict`
   (fail-closed)**, used by `dbKey`. Pinned (`test_secretstore.js`, `test_dbkey.js`).
2. **empty/short key passes every gate on a plaintext output** → `dbKey` asserts 32 bytes on write AND
   read; migration verify adds the **negative control** (open WITHOUT the key must FAIL + header magic
   absent). Length pinned; the open-without-key control is a slice-2 gate (needs the ciphers build).
3. **downgrade tripwire** (slice 3): key present + a plaintext sniff of the DB header + no manifest =
   loud fail, never a silent open.
4. **night-run/reset rituals change IN THE SAME COMMIT as slice 2** (RUN_AS_NODE cannot unwrap DPAPI —
   an undocumented ritual change bricks the next autonomous run): reset = delete db + wal + shm +
   `.db-key` + `.db-recovery`; harness copies via a `db-crypto-tool export-plain` step.
5. **merge-backup site** `templates/handler.js:600-607` writes an UNKEYED (plaintext) copy → replace
   with a **keyed** copy, BLOCKING gate (slice 2).
6. **audit archives** (`audit_archive.js`) keyed as the FINAL slice.
7. **third DPAPI secret** → add to the E44 gate-5b continuity checklist; correct the stale
   "only DPAPI blobs" doc lines.

## Slice plan + gates
- **Slice 0 — dep swap.** ✅ DONE IN DEV (2026-08-31, owner-supervised): alias
  `npm:better-sqlite3-multiple-ciphers@^12` → **12.11.1**, whose engines are `node 20.x || 22.x || …`,
  so it spans BOTH Electron 31 (Node 20) AND Electron 44 (Node 22) — an E44 merge needs only an
  `install-app-deps` ABI rebuild + a re-run of the cipher pin, NOT a fork version bump. (The `.db-key`
  is a THIRD DPAPI blob for the E44 gate-5b continuity check, but it bites only once an install is
  encrypted — moot until then.) `npm install` + `install-app-deps` clean, `check-licenses` green
  (MIT auto-passes), the runtime cipher pin green (`src/lib/test_db_cipher.js`: name = the fork, active
  cipher **chacha20**, hexkey round-trip, header-magic-absent, no-cleartext, and the Oracle NEGATIVE
  CONTROLS — open-without-key FAILS, wrong-key FAILS), and a drop-in proof reading the REAL live DB (a
  copy): plaintext header, migrations/documents/extractions/LIKE-search all identical, no key set →
  transparent plaintext open. REMAINING slice-0 gates (heavy, run with the design-1/2 realdoc gates):
  realdoc-605 byte-identical on the fork + a PACKAGED build boot proving the alias survives
  electron-builder's app-deps rebuild in a packaged context.
- **Slice 1 — key infra, DARK.** `dbKey.js` (fail-closed, never-regenerate, argon2id recovery) +
  `setEncryptionKey`/`hexkey` seam in `database/index.js` (inert until a key is set) + the Unlock/Recover
  window (license-window pattern, no equal-weight "start fresh"). **BUILT THIS SESSION** except the
  window UI + main.js whenReady unwrap wiring (owed — must stay a no-op until a `.db-key` exists).
- **Slice 2 — opt-in migration** (gary's manifest state machine, crash-safe). ✅ CORE BUILT + PINNED
  (2026-08-31): `src/lib/dbMigrateEncrypt.js` — BACKUP (checkpoint(TRUNCATE) + a plaintext `.pre-encrypt`
  cold copy; `db.backup()` is async AND refuses a keyed source, so a cold `fs.copyFileSync` after a
  TRUNCATE checkpoint is used) → ENCRYPTING (`fs.copyFileSync` live→`.encrypting`, open unkeyed,
  **`PRAGMA hexrekey`** raw-key encrypt-in-place — NOT `rekey`, which KDFs the hex; ATTACH+export DELETED)
  → VERIFY (integrity_check + a row-count fingerprint == live, header-magic-absent, and the NEGATIVE
  CONTROL: open-without-key must FAIL) → SWAP (crash-ordered rename: live→`.plain-old`, `.encrypting`→live,
  then the DONE manifest; a rename retry rides the Windows EBUSY lock). `resolveState()` resolves every
  crash point to a working DB — crash before the swap → rolled-back to the untouched plaintext; crash
  mid-swap (live missing) → restore `.plain-old`; crash after both renames → recognised as done;
  **ambiguity → the surviving plaintext**. `src/lib/test_db_migrate_encrypt.js` (16) covers the crash
  matrix. The merge-backup site (`templates/handler.js`) now takes a KEYED copy via VACUUM INTO when
  `database.isEncryptionActive()` (else the online `db.backup()`). `scripts/db-crypto-tool.js`
  (status / export-plain via `hexrekey=''` decrypt, keyed by `--recovery-code`/`--hexkey` — RUN_AS_NODE
  cannot unwrap DPAPI). REMAINING (owner-machine): the opt-in Settings trigger + Unlock/Recover window +
  `main.js` whenReady `loadKey`→`setEncryptionKey`; then a DPAPI-loss drill, perf <10% on the owner's real
  DB, and a full app session on an encrypted copy incl. `verifyAuditChain`, `canStamp`, the /v1 client.
- **Slice 3 — default-on FRESH installs** + the downgrade tripwire + the ceremony ack/nudge/regenerate.
  Audit archives keyed here (final). `src/database.js` deleted (done this session). GATES: fresh-install
  E2E + ceremony-nudge + downgrade-tripwire pins.

## Built this session (DARK, inert; commit below)
- `src/lib/secretStore.js` — `encryptAtRestStrict` (fail-closed). `src/lib/dbKey.js` — the key module.
- `database/index.js` — `setEncryptionKey` + the gated `hexkey` pragma (never issued on a plaintext
  install → byte-identical).
- Deleted the dead `src/database.js`.
- Pins: `src/lib/test_dbkey.js` (17), `src/lib/test_secretstore.js` (+2 strict).
- **Nothing encrypts yet** — no dep swap, no key is ever set, no DB is rewritten. Everything is scaffolding
  that the owner-supervised slices 0/2/3 light up.

## Reset / harness ritual once the DB is encrypted (Oracle C7 — active only post-migration)
Today the live DB is still PLAINTEXT (no migration has run), so the current rituals are unchanged. The
MOMENT an install is migrated, these apply (they ship now so a future autonomous run is never bricked):
- **Dev reset** = delete `docusnap.db` **and** `docusnap.db-wal` / `-shm` **and** `.db-key` **and**
  `.db-recovery` (a fresh plaintext DB beside a stale key file would fail the downgrade tripwire). Deleting
  the whole `%APPDATA%\ScanFinder` DB set is the clean reset.
- **Harness/inspection copy** of an encrypted live DB: `ELECTRON_RUN_AS_NODE=1 electron
  scripts/db-crypto-tool.js export-plain --db <live> --out <copy> --recovery-code <code>` (RUN_AS_NODE
  cannot unwrap the DPAPI `.db-key`, so the printed recovery code is the key source). Never leave the
  plaintext copy beside an encrypted install.
- `scripts/db-crypto-tool.js status --db <path>` reports plaintext/encrypted + resolveState + key/recovery
  presence.

## Owner-supervised runbook (do NOT run autonomously)
1. Close every Electron (EBUSY on the ABI rebuild). `npm pkg set dependencies.better-sqlite3='npm:better-sqlite3-multiple-ciphers@^12'`, `npm install`, `npx electron-builder install-app-deps`. `npm run check:licenses`. Boot a PACKAGED build.
2. Wire `main.js` whenReady: `const key = dbKey.loadKey(); if (key) database.setEncryptionKey(key);` — inert until a `.db-key` exists (slice 1 wiring; keep it a no-op on today's plaintext install).
3. Build the migration (slice 2) + the Unlock/Recover window; run it opt-in on a `db.backup()` copy first, then the crash matrix.
4. Default-on for fresh installs (slice 3) + the ceremony + the downgrade tripwire.
