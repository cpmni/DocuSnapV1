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
  `npm:better-sqlite3-multiple-ciphers@^12` → **12.11.1** (the same-major line matching Electron 31's
  Node-20 ABI; the fork's 13.x needs Node ≥22, so it is correct ONLY after an E44 merge — this coupling
  belongs on the E44 gate-5b checklist), `npm install` + `install-app-deps` clean, `check-licenses` green
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
- **Slice 2 — opt-in migration** (gary's manifest state machine, crash-safe): checkpoint(TRUNCATE) →
  `db.backup` `.pre-encrypt` → **hexrekey on the copy** (ATTACH+export DELETED) → verify (integrity +
  sentinel counts + the negative control) → crash-ordered rename swap; every crash state resolves to a
  working DB, ambiguity → the surviving plaintext. GATES: the full crash-injection matrix (incl.
  kill-during-rekey + EBUSY storm) + the backup-cipher pin + a DPAPI-loss drill through Unlock/Recover +
  perf <10% on the owner's real DB + a full app session on an encrypted copy incl. `verifyAuditChain`,
  `canStamp`, and the /v1 client. Ritual change ships in THIS commit (C7).
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

## Owner-supervised runbook (do NOT run autonomously)
1. Close every Electron (EBUSY on the ABI rebuild). `npm pkg set dependencies.better-sqlite3='npm:better-sqlite3-multiple-ciphers@^12'`, `npm install`, `npx electron-builder install-app-deps`. `npm run check:licenses`. Boot a PACKAGED build.
2. Wire `main.js` whenReady: `const key = dbKey.loadKey(); if (key) database.setEncryptionKey(key);` — inert until a `.db-key` exists (slice 1 wiring; keep it a no-op on today's plaintext install).
3. Build the migration (slice 2) + the Unlock/Recover window; run it opt-in on a `db.backup()` copy first, then the crash matrix.
4. Default-on for fresh installs (slice 3) + the ceremony + the downgrade tripwire.
