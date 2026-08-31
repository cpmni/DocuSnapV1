# DB-at-rest encryption — the arc (2026-08-31, code-as-passphrase)

Whole-DB transparent page encryption so a copied `docusnap.db(+wal)` is useless on another machine,
every query semantic (LIKE search, equality-key learning lookups, GROUP BY, CAST) preserved. Owner's
ask: "the DB is text-editor readable." Two Oracle rounds: the first signed a random-key + dual-DPAPI/
argon2-wrap model; the owner then required **"a DB backup + the printed code resurrects on ANY PC"**,
which that model couldn't meet (the key lived in a sidecar `backupService` never exports). The revised
**code-as-passphrase** model is Oracle SIGN-OFF-WITH-CONDITIONS (2026-08-31, at the foot of
`docs/oracle_log.md`) and is what is built.

## Design (settled — code-as-passphrase)
- **Library:** `better-sqlite3` aliased to `better-sqlite3-multiple-ciphers@^13` (13.0.3, MIT; Node ≥22 →
  Electron 44). Same-major drop-in; the ~200 `getDb()` callers untouched.
- **The printed RECOVERY CODE *is* the key material.** The DB is encrypted in multiple-ciphers
  **passphrase mode** (`PRAGMA key='<code>'`, `cipher='chacha20'`, pinned `kdf_iter`), so the **KDF salt
  lives in the DB file header**. Result: **a copy of `docusnap.db` + the code opens on ANY PC — no
  sidecar, no DPAPI, no same-account requirement.** That is the owner's hard recovery guarantee, pinned
  twice (`test_db_cipher.js` + `test_db_migrate_encrypt.js` both copy a lone `.db` to a fresh dir and open
  by code).
- **The code** is a generated **125-bit** Crockford-base32 string (`dbKey._makeCode`), shown once. NOT a
  user-chosen password: PBKDF2 over a human password is GPU-brute-forceable — a future "set your own DB
  password" feature must reintroduce a memory-hard KDF or is **forbidden** (guarded in `dbKey.js`).
- **`.db-key` is a no-prompt CONVENIENCE only** — it caches the code, DPAPI-wrapped (`secretStore.
  encryptAtRestStrict`, **fail-closed**), so daily launches open silently. It is **never required for
  recovery**; it carries no salt, no separate key. Lose it (new PC / password reset) → the app asks for
  the code once, then re-caches it. The old `.db-recovery` sidecar is **GONE**.
- **ONE pragma choke point** (`src/lib/dbKey.js`): `applyKey(db, code)` (open) and `applyRekey(db, code)`
  (migration) issue `cipher → kdf_iter → key/rekey` in that order, always on `normaliseCode(code)`, with
  a `^[0-9A-Z]+$` charset check before interpolation. open/migration/tool can never drift (the
  silent-brick class Oracle flagged: display-form vs normalised-form mismatch).
- **`temp_store=MEMORY`** on the encrypted open so SQLite temp spills never hit disk in plaintext.
- **No daily password.** Login lives inside the DB; /v1 + tray run headless. DPAPI (no-prompt) + the
  printed code (break-glass + portability) — that's it.
- **Scope honesty:** filed PDFs, the import inbox, and `.metadata/*.xml` stay plaintext — BitLocker is
  the whole-disk answer. This arc protects the DB (OCR text + learned values + field data) only.

## Security posture (answers logged for the owner)
- **A stolen `docusnap.db` copy has NO key in it** — only a public 16-byte header salt + AEAD (ChaCha20-
  Poly1305) ciphertext. Nothing to "strip." The only attack is brute-forcing a **125-bit random code**
  through the cipher KDF — infeasible; no dictionary attack (the code isn't a human word). At-rest
  strength is **equivalent** to a raw-key model.
- **`.db-key` (DPAPI) is user+machine-bound** — useless on another PC/user. On-box same-user malware can
  call `safeStorage.decryptString` (DPAPI can't stop that) → it gets the code; but on-box malware already
  has the running app. Off-box theft fails.
- **Tamper-evidence:** per-page Poly1305 tags mean any byte edit to the ciphertext fails authentication →
  the DB won't open. Integrity against the *authorized* user is the **audit chain** (`verifyAuditChain`),
  a separate layer — encryption is confidentiality, the chain is tamper-evidence.

## The startup decision table (Oracle C4 — the owner's restore-on-new-PC case)
`resolveState()` runs first (interrupted migration), then main decides by `.db-key` presence × DB header:

| `.db-key` | DB header | action |
|---|---|---|
| absent | plaintext / no DB | fresh/plaintext — today's path, byte-identical |
| present | encrypted | daily open by the cached code; throw → Unlock window |
| present | **plaintext** | downgrade tripwire — loud fail (never open) |
| **absent** | **encrypted** | **RESTORED BACKUP → prompt for the code, open, then cache `.db-key`** |

Row 4 is the owner's whole requirement; it must be explicit (a null `loadCode()` means BOTH "fresh
plaintext" and "restored backup" — the DB header disambiguates).

## Windows password change vs reset (DPAPI, eric-confirmed)
- Normal **change** (knows old pw): DPAPI re-wraps → `.db-key` still decrypts → **daily open works.**
- Forced **reset** (no old pw) / new profile / new machine / restored backup: `.db-key` absent or
  undecryptable → **the code once**, then re-cache. (Domain accounts recover via the DC's DPAPI backup
  key; local-account resets lose it — recovery-code territory.)

## Slices
- **Slice 0 — dep swap.** ✅ DONE (fork 13.0.3 on E44; cipher pin chacha20 + negative controls; real-DB
  drop-in read; check-licenses green).
- **Slice 1 — key infra + seam.** ✅ CORE DONE (passphrase model): `dbKey.js` (provision/loadCode/
  cacheCode/applyKey/applyRekey/normaliseCode, fail-closed, never-regenerate, refuse-clobber),
  `secretStore.encryptAtRestStrict`, the gated `database/index.js` seam (`setEncryptionKey(code)` →
  `applyKey` + `temp_store=MEMORY`; inert until a code is set). REMAINING: the whenReady unwrap +
  the Unlock/Recover window.
- **Slice 2 — migration.** ✅ DONE: `dbMigrateEncrypt.js` crash-safe state machine (BACKUP cold-copy →
  ENCRYPTING `journal_mode=DELETE`+`applyRekey` → VERIFY integrity+fingerprint+negative-controls →
  crash-ordered SWAP), `test_db_migrate_encrypt.js` (crash matrix + kill-during-rekey + portability),
  the merge-backup keyed VACUUM INTO, `db-crypto-tool.js` (status / export-plain via `rekey=''`).
  REMAINING (owner-machine): perf <10%, a full app session incl. `verifyAuditChain`/`canStamp`//v1,
  the DPAPI-loss + new-PC drills through the Unlock window.
- **Slice 3 — activation + default-on.** The combined "Keep these safe" dialog + opt-in trigger +
  default-on fresh + the downgrade tripwire. IN PROGRESS.

## Owner decisions (logged)
- **Regenerate the DB code = a full DB re-encrypt** (the code is the key) → **DEFERRED for v1**; the code
  is permanent until a re-migration. No "regenerate" button that silently rewrites the DB.
- **Email-the-code: OUT** — mailing the crown-jewel secret defeats the encryption. Backups = Print +
  Save-to-file + a typed "I've saved these" gate. (SMTP for *workflow notifications* — non-secret — is a
  separate future feature; logged for barry.)
- **Combined "Keep these safe" dialog** (extends the existing login recovery-code screen): shows BOTH the
  admin-recovery code (resets a forgotten login; single-use + rotates) and the DB recovery code (static
  passphrase; permanent), **masked behind Show buttons** ("reveal only when no one can see your screen"),
  **deferrable** ("Set up later" → stays plaintext until done, with a nudge — no un-noted code ever
  exists), and a **hard-reinforced** consequence + a typed confirm. Single-point-of-capture accepted
  (mitigated by Show/defer). The owner's live DB is a testing platform — sacrificeable for the migration
  drill (still backed up first).

## Reset / harness ritual once the DB is encrypted (Oracle C7 — active only post-migration)
- **Dev reset** = delete `docusnap.db` + `-wal`/`-shm`/`-journal` + `.db-key` (a fresh plaintext DB beside
  a stale `.db-key` trips the downgrade tripwire). Deleting the whole `%APPDATA%\ScanFinder` DB set is the
  clean reset.
- **Harness/inspection copy:** `ELECTRON_RUN_AS_NODE=1 electron scripts/db-crypto-tool.js export-plain
  --db <live> --out <copy> --recovery-code <code>` (RUN_AS_NODE can't unwrap DPAPI; the code IS the key).
  Never leave the plaintext copy beside an encrypted install.
- `db-crypto-tool.js status --db <path>` reports plaintext/encrypted + resolveState + `.db-key` presence.

## Gate to merge (owner-machine)
Whole suite + the rewritten pins green (DONE for the crypto core); `check-licenses` (DONE); realdoc-605
OFF byte-identical + ON at product DPI zero accuracy/fill drop; the migration drill on the owner's real
DB (a `db.backup()` first) + a full app session incl. `verifyAuditChain`, `canStamp`, the /v1 client;
the DPAPI-loss drill (reset path) AND the new-PC-restore drill through the Unlock window; perf <10%.
