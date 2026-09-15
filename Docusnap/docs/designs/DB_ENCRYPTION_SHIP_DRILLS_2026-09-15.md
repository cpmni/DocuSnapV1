# DB-at-rest encryption — ship drills (2026-09-15)

Path A (whole-DB encryption), OPT-IN on-ramp. The arc is built (slices 0-3), Oracle SIGN-OFF-WITH-
CONDITIONS on 2026-08-31 and again on ship-readiness 2026-09-15. Code-side verification is done
(below). What is left is a set of DRILLS the owner runs on the **hardened** build. Nothing here
touches a customer until these pass.

## Already verified (off the live DB — no risk taken)
- The 4 crypto pins pass on Electron 44: `test_db_cipher` 10, `test_db_startup` 11, `test_db_boot_migrate`
  18, `test_db_migrate_encrypt` 18.
- **Query semantics survive encryption.** Encrypted a copy of the real DB + a 700-doc warm DB and ran an
  app-shaped read battery (LIKE search, COLLATE NOCASE ordering, CAST, date compare, GROUP BY, aggregates,
  settings) vs the plaintext original — 14/14 identical. Header check + no-key-throws control pass.
  (Oracle note: a page-level cipher is content-blind, so re-running reads proves nothing further; the
  untested part is WRITES/WAL/audit under encryption — that is drill 2.)
- **Obfuscation does not brick the crypto.** Ran `dbKey.js` through the exact `HARDEN_JS` (minify) AND
  `HARDEN_JS_STRINGS` (string-array) configs, then exercised encrypt→reopen portability + wrong-code-fails.
  Both pass. The pragma choke point is preserved.
- **Ceremony hardened (2026-09-15):** the "turn on encryption" dialog now makes the user type the code's
  last block back (proof they actually have the one key), paste blocked. Pin `test_dbcodeconfirm.js`.

## The one real risk to state to any test customer (plain)
If they lose the recovery code AND lose their Windows login (reset with no old password / new machine),
the database cannot be opened again. BUT the filed PDFs, the import inbox and the `.metadata` XML stay
readable — only the **search index / OCR text / learned values / review list** would be lost, **not the
documents themselves.** Tell them: keep the code, and losing it loses the index, not the files.

## The drills — run on the `npm run build:release` HARDENED build
`★` = MUST be on the hardened artifact (only that run exercises the real encrypt/decrypt through the
obfuscated + bytecode bundle). Back up first: copy `%APPDATA%\ScanFinder\docusnap.db` somewhere safe.

1. **★ Turn-on / migration.** Settings → Advanced → Database encryption → "Turn on encryption…" → reveal
   + save/print the code → type its last block → the app encrypts at the next boot and restarts. It
   should come back up **silently** (no prompt). PASS = it reopens and search/Review look normal.
   PROVES: `applyRekey` works through the hardened bundle.
2. **Full session under encryption.** Import a document (writes extractions + learning), confirm it, route
   + **stamp** it, do one search-client (/v1) operation, then **close and reopen** the app. PASS = every
   read comes back, the audit chain still verifies, stamping still works. PROVES: writes / WAL checkpoint
   / audit-chain under encryption (the part the read battery could not cover).
3. **★ Lose-the-key recovery.** Close the app, delete only `%APPDATA%\ScanFinder\.db-key` (NOT the DB),
   reopen → the Unlock screen appears → type the recovery code → it opens and re-saves `.db-key`. PROVES:
   `applyKey` + the Unlock screen's "Recover" button reaching main, in the packaged app.
4. **New-PC / restore.** Copy `docusnap.db` (+ `-wal`/`-shm` if present) alone to a fresh profile or PC,
   start the app pointing there → it asks for the code → type it → opens. PROVES: the portability promise
   on the real app.
5. **Downgrade tripwire.** Put an OLD plaintext `docusnap.db` back while `.db-key` is present → the app
   must LOUDLY refuse (never silently open plaintext).
6. **Performance.** Time an import + a search encrypted vs plaintext — expect under ~10% slower.

**Ship rule (Oracle):** if drills 1, 2 and 3 pass on the hardened build, the residual seam is closed and
it ships. 4-6 are confidence checks.

## Reset / inspect once encrypted (developer)
- **Reset:** delete `docusnap.db` + `-wal`/`-shm`/`-journal` + `.db-key` (a fresh plaintext DB beside a
  stale `.db-key` trips the tripwire). Deleting the whole `%APPDATA%\ScanFinder` DB set is the clean reset.
- **Inspect a plaintext copy:** `ELECTRON_RUN_AS_NODE=1 electron scripts/db-crypto-tool.js export-plain
  --db <live> --out <copy> --recovery-code <code>`.
- **Status:** `db-crypto-tool.js status --db <path>` → plaintext/encrypted + `.db-key` presence.
