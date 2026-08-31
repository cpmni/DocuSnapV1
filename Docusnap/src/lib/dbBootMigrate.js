'use strict';
/**
 * src/lib/dbBootMigrate.js
 * ------------------------
 * The FAIL-SAFE boot-time encrypt orchestration for the DB-at-rest arc (the opt-in ceremony armed a
 * DISJOINT `.db-migrate-code`; Oracle SIGN-OFF-W/COND 2026-08-31, conditions C3/C5). Called from main's
 * whenReady, STRICTLY before the first getDb(), so the DB is closed and dbMigrateEncrypt's renames are
 * contention-free (a live better-sqlite3 handle would EBUSY the swap). Extracted from main.js so the
 * fail-toward-plaintext logic is PINNABLE in isolation (deps are injectable).
 *
 * GUARANTEE (Oracle C3): on ANY failure the DB is left PLAINTEXT (migrate() keeps the plaintext on any
 * pre-SWAP fault), the arm is cleared, and an error code is returned — NEVER a boot loop, NEVER a
 * tripwire, NEVER an orphan `.db-key` (the real key is written ONLY after a verified encrypt, so
 * `.db-key` never lands beside a plaintext DB and the downgrade tripwire keeps its exact meaning).
 *
 * Returns { encrypted:boolean, error: null | 'key-unavailable' | 'migrate-failed' }.
 */
function run({ dbPath, logger, dbKey, migrate, setEncryptionKey } = {}) {
  dbKey = dbKey || require('./dbKey');
  migrate = migrate || require('./dbMigrateEncrypt').migrate;
  setEncryptionKey = setEncryptionKey || require('../../database/index').setEncryptionKey;
  const warn = (m) => { try { logger && logger.warn && logger.warn(m); } catch { /* noop */ } };
  const err  = (m) => { try { logger && logger.err  && logger.err(m);  } catch { /* noop */ } };
  const log  = (m) => { try { logger && logger.log  && logger.log(m);  } catch { /* noop */ } };

  // 1. Unwrap the armed code (DPAPI). Absent/undecryptable (DPAPI lost between arm and this boot) →
  //    the DB is still PLAINTEXT — clear the arm, keep plaintext, surface. NOT the encrypted-DB Unlock
  //    route (that DB is encrypted; this one isn't) — Oracle's DPAPI-loss anomaly.
  let code;
  try { code = dbKey.loadMigrateCode({ logger }); }
  catch (e) {
    try { dbKey.clearMigrateCode(); } catch { /* noop */ }
    err('db encryption: armed code unreadable — kept plaintext: ' + (e && e.message));
    return { encrypted: false, error: 'key-unavailable' };
  }

  // 2. Encrypt. migrate() is crash-safe: on any pre-SWAP failure it leaves the plaintext DB intact.
  try { migrate({ dbPath, code, logger }); }
  catch (e) {
    try { dbKey.clearMigrateCode(); } catch { /* noop */ }
    err('db encryption: boot migration failed — kept plaintext: ' + (e && e.message));
    return { encrypted: false, error: 'migrate-failed' };
  }

  // 3. Encrypted now — write the real `.db-key` (best-effort: a miss self-heals next boot to prompt-code
  //    → Unlock) + disarm + key THIS boot's open. Order: cacheCode is the point the disjoint model first
  //    writes `.db-key`, and only here, AFTER a verified encrypt.
  try { dbKey.cacheCode(code); }
  catch (e) { warn('db encryption: .db-key cache failed (will prompt next boot): ' + (e && e.message)); }
  try { dbKey.clearMigrateCode(); } catch { /* noop */ }
  try { setEncryptionKey(code); }
  catch (e) { err('db encryption: setEncryptionKey after migrate failed: ' + (e && e.message)); }
  log('db encryption: migration complete on boot');
  return { encrypted: true, error: null };
}

module.exports = { run };
