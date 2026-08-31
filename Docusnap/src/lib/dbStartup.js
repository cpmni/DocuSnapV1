'use strict';
/**
 * src/lib/dbStartup.js
 * --------------------
 * The DB-at-rest STARTUP DECISION (Oracle C4). Called from main's whenReady BEFORE the first getDb().
 * Resolves any interrupted migration first, then decides how to open, keyed on the DPAPI code-cache
 * presence × the DB header. Pure (files only, no DB open, no Electron) so the table is fully pinnable.
 *
 * `_hasMagic` TRUE = the file starts with "SQLite format 3" = PLAINTEXT; FALSE = encrypted (or absent).
 *
 *   .db-key | migrate-arm | DB header | action        | meaning
 *   --------+-------------+-----------+---------------+----------------------------------------------------
 *   absent  | absent      | plaintext | 'plaintext'   | fresh / not-yet-encrypted install — open plaintext
 *   absent  | absent      | no DB     | 'plaintext'   | brand new install
 *   absent  | PRESENT     | plaintext | 'migrate'     | ceremony armed the opt-in encrypt — encrypt at boot
 *   present | *           | encrypted | 'open-cached' | normal encrypted install — open by the DPAPI code
 *   present | *           | plaintext | 'tripwire'    | DOWNGRADE — a KEY cache beside a plaintext DB: loud fail
 *   absent  | absent      | encrypted | 'prompt-code' | RESTORED BACKUP on a new PC — ask for the code
 *
 * The `.db-migrate-code` arm is a DISJOINT file from `.db-key` (Oracle 2026-08-31): the ceremony writes
 * ONLY the arm, and the boot handler writes the real `.db-key` ONLY AFTER the encrypt succeeds. So
 * `.db-key` is NEVER present beside a plaintext DB, and the tripwire row keeps its EXACT original meaning
 * (its pin is byte-identical). A stale arm found on an ENCRYPTED DB is SELF-HEALED here (Oracle C1) so it
 * can never survive to disarm a future downgrade. The prompt-code row is the owner's restore-on-new-PC
 * requirement, the one a naive "loadCode()==null → plaintext" would get wrong (null means BOTH "fresh"
 * and "restored backup"; only the header separates them).
 */
const fs = require('fs');

function decide({ dbPath } = {}) {
  const dbKey = require('./dbKey');
  const migrate = require('./dbMigrateEncrypt');

  // 1. Resolve an interrupted migration to a settled file state FIRST.
  const resolved = migrate.resolveState({ dbPath });

  // 2. Read the settled state.
  const hasKey = dbKey.hasKey();
  const hasMig = dbKey.hasMigrateCode();
  const dbExists = fs.existsSync(dbPath);
  const plaintext = migrate._hasMagic(dbPath);   // true = SQLite magic present

  if (!dbExists) {
    if (hasMig) dbKey.clearMigrateCode();   // no DB to migrate — clear a stray arm
    return { action: 'plaintext', reason: 'no-db', resolved };
  }
  if (plaintext) {
    // `.db-key` beside plaintext = DOWNGRADE — an UNCONDITIONAL tripwire, checked before the migrate
    // arm (a real key cache always wins), so this row is byte-identical to before the arm existed.
    if (hasKey) return { action: 'tripwire', reason: 'key-cache-beside-plaintext-db', resolved };
    if (hasMig) return { action: 'migrate', reason: 'arm-encrypt', resolved };   // the opt-in ceremony armed it
    return { action: 'plaintext', reason: 'unencrypted', resolved };
  }
  // encrypted (no SQLite magic):
  if (hasMig) dbKey.clearMigrateCode();   // C1 self-heal — a stale arm must not survive to a future downgrade
  if (hasKey) return { action: 'open-cached', reason: 'encrypted', resolved };
  return { action: 'prompt-code', reason: 'restored-backup', resolved };   // restored backup
}

module.exports = { decide };
