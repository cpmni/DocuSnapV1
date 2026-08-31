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
 *   .db-key | DB header  | action           | meaning
 *   --------+------------+------------------+---------------------------------------------------------
 *   absent  | plaintext  | 'plaintext'      | fresh / not-yet-encrypted install — open plaintext (today)
 *   absent  | no DB      | 'plaintext'      | brand new install
 *   present | encrypted  | 'open-cached'    | normal encrypted install — open by the DPAPI-cached code
 *   present | plaintext  | 'tripwire'       | DOWNGRADE — a key cache beside a plaintext DB: loud fail
 *   absent  | encrypted  | 'prompt-code'    | RESTORED BACKUP on a new PC — ask for the code, then cache
 *
 * The last row is the owner's whole requirement and the one a naive "loadCode()==null → open plaintext"
 * would get wrong (null means BOTH "fresh" and "restored backup"; only the header separates them).
 */
const fs = require('fs');

function decide({ dbPath } = {}) {
  const dbKey = require('./dbKey');
  const migrate = require('./dbMigrateEncrypt');

  // 1. Resolve an interrupted migration to a settled file state FIRST.
  const resolved = migrate.resolveState({ dbPath });

  // 2. Read the settled state.
  const hasKey = dbKey.hasKey();
  const dbExists = fs.existsSync(dbPath);
  const plaintext = migrate._hasMagic(dbPath);   // true = SQLite magic present

  if (!dbExists) return { action: 'plaintext', reason: 'no-db', resolved };
  if (plaintext && !hasKey) return { action: 'plaintext', reason: 'unencrypted', resolved };
  if (plaintext && hasKey) return { action: 'tripwire', reason: 'key-cache-beside-plaintext-db', resolved };
  if (!plaintext && hasKey) return { action: 'open-cached', reason: 'encrypted', resolved };
  return { action: 'prompt-code', reason: 'restored-backup', resolved };   // !plaintext && !hasKey
}

module.exports = { decide };
