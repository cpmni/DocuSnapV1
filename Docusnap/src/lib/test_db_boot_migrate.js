#!/usr/bin/env node
'use strict';
/**
 * Pin for the DISJOINT migrate arm + the FAIL-SAFE boot-migrate orchestration (code-as-passphrase;
 * Oracle 2026-08-31 conditions C2/C3/C6). Proves: the arm is disjoint from `.db-key` (so `.db-key`
 * never lands beside a plaintext DB); `.db-key` is written ONLY AFTER a verified encrypt; and EVERY
 * failure path fails toward an intact PLAINTEXT DB with the arm cleared (no orphan key, no loop, no
 * tripwire). Runs under Electron-as-Node (needs the native better-sqlite3-multiple-ciphers); safeStorage
 * is FAKED so no real DPAPI is required.
 *   Run: ELECTRON_RUN_AS_NODE=1 node_modules\.bin\electron.cmd src/lib/test_db_boot_migrate.js
 */
const fs = require('fs'); const os = require('os'); const path = require('path');
const Database = require('better-sqlite3');
const S = require('./secretStore');
const K = require('./dbKey');
const boot = require('./dbBootMigrate');
const mig = require('./dbMigrateEncrypt');

let pass = 0, fail = 0;
const check = (l, c) => { if (c) { pass++; console.log('  OK  ' + l); } else { fail++; console.error('  FAIL: ' + l); } };
const fakeSS = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from('D:' + s), decryptString: (b) => Buffer.from(b).toString('utf8').replace(/^D:/, '') };
S.__setSafeStorage(fakeSS);

function freshDir() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dbboot-')); K.__setDirForTest(d); return d; }
function plaintextDb(dbPath) { const db = new Database(dbPath); db.pragma('journal_mode = WAL'); db.exec("CREATE TABLE t(x TEXT); INSERT INTO t VALUES('hello')"); db.close(); }

// ── mintCode does NOT persist (the whole point vs provision) ──────────────────
{
  freshDir();
  const code = K.mintCode();
  check('mintCode returns a grouped 125-bit display code', /^[0-9A-Z]{5}(-[0-9A-Z]{5}){4}$/.test(code));
  check('mintCode persists NOTHING (no arm, no .db-key) — a cancelled ceremony leaves the DB untouched', !K.hasMigrateCode() && !K.hasKey());
}

// ── armMigration is DISJOINT from .db-key, round-trips, and refuses to clobber ─
{
  freshDir();
  const code = K.mintCode();
  K.armMigration(code);
  check('armMigration writes .db-migrate-code but NOT .db-key (disjoint — no key beside plaintext)', K.hasMigrateCode() && !K.hasKey());
  check('loadMigrateCode round-trips the normalised code', K.loadMigrateCode() === K.normaliseCode(code));
  let clobber = false; try { K.armMigration(K.mintCode()); } catch { clobber = true; }
  check('armMigration REFUSES to clobber an existing arm', clobber);
  K.clearMigrateCode();
  check('clearMigrateCode disarms', !K.hasMigrateCode());
}

// ── boot-migrate SUCCESS: plaintext + arm -> encrypted, keyed, arm gone ───────
{
  const d = freshDir();
  const dbPath = path.join(d, 'docusnap.db');
  plaintextDb(dbPath);
  const code = K.mintCode();
  K.armMigration(code);
  let keyed = null;
  const res = boot.run({ dbPath, setEncryptionKey: (c) => { keyed = c; } });
  check('run() returns { encrypted:true, error:null }', res.encrypted === true && res.error === null);
  check('the DB no longer has the SQLite magic (it is encrypted)', !mig._hasMagic(dbPath));
  check('.db-key is written (no-prompt daily open re-established) — AFTER the encrypt', K.hasKey());
  check('the arm is cleared after success', !K.hasMigrateCode());
  check('setEncryptionKey was called with the normalised code (this boot opens keyed)', keyed === K.normaliseCode(code));
  const db = new Database(dbPath); K.applyKey(db, code);
  check('the encrypted DB opens by the code and the data is preserved', db.prepare('SELECT x FROM t').get().x === 'hello');
  db.close();
}

// ── FAIL-SAFE: migrate throws -> plaintext intact, arm cleared, NO orphan key ─
{
  const d = freshDir();
  const dbPath = path.join(d, 'docusnap.db');
  plaintextDb(dbPath);
  K.armMigration(K.mintCode());
  const res = boot.run({ dbPath, migrate: () => { throw new Error('injected migrate failure'); }, setEncryptionKey: () => {} });
  check('run() returns { encrypted:false, error:migrate-failed }', res.encrypted === false && res.error === 'migrate-failed');
  check('the DB is STILL plaintext (fail toward plaintext)', mig._hasMagic(dbPath));
  check('.db-key is NEVER written when migrate fails (no orphan key -> no future tripwire brick)', !K.hasKey());
  check('the arm is cleared (no boot loop)', !K.hasMigrateCode());
}

// ── key-unavailable: no arm -> plaintext, error surfaced, no brick ────────────
{
  const d = freshDir();
  const dbPath = path.join(d, 'docusnap.db');
  plaintextDb(dbPath);
  const res = boot.run({ dbPath, setEncryptionKey: () => {} });   // no arm present
  check('run() with no readable arm returns { encrypted:false, error:key-unavailable }', res.encrypted === false && res.error === 'key-unavailable');
  check('the DB is still plaintext and there is no .db-key', mig._hasMagic(dbPath) && !K.hasKey());
}

S.__setSafeStorage(undefined);
console.log(`\ndb-boot-migrate: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
