#!/usr/bin/env node
'use strict';
/**
 * scripts/db-crypto-tool.js — the DB-at-rest maintenance CLI (slice 2, Oracle C7).
 *
 * The dev/night-run reset + harness rituals must survive the plaintext → encrypted switch. RUN_AS_NODE
 * cannot unwrap DPAPI (safeStorage is unavailable), so a harness that needs a READABLE copy of an
 * encrypted live DB gets one here with the printed RECOVERY CODE (or a raw hexkey), never DPAPI.
 *
 * Run under electron-as-node (native module):
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron scripts/db-crypto-tool.js <cmd> [opts]
 *
 * Commands:
 *   status       --db <path>
 *   export-plain --db <path> --out <path> (--recovery-code <code> | --hexkey <hex>)
 *
 * export-plain writes a DECRYPTED copy of --db to --out (leaves --db untouched). Use it for the harness
 * and for inspection; never ship or leave the plaintext copy beside an encrypted install.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const migrate = require('../src/lib/dbMigrateEncrypt');

function arg(name) { const i = process.argv.indexOf('--' + name); return i > -1 ? process.argv[i + 1] : null; }
function die(msg) { console.error('db-crypto-tool: ' + msg); process.exit(2); }

async function resolveKeyHex(dbPath) {
  const hexArg = arg('hexkey');
  if (hexArg) {
    if (!/^[0-9a-fA-F]{64}$/.test(hexArg)) die('--hexkey must be 64 hex chars (32 bytes)');
    return hexArg.toLowerCase();
  }
  const code = arg('recovery-code');
  if (code) {
    const dbKey = require('../src/lib/dbKey');
    dbKey.__setDirForTest(path.dirname(path.resolve(dbPath)));   // .db-recovery lives beside the DB
    const key = await dbKey.recover(code, { rewrapDpapi: false });   // argon2 unwrap — no DPAPI needed
    return key.toString('hex');
  }
  die('provide --recovery-code <code> or --hexkey <64hex>');
}

function cmdStatus() {
  const dbPath = arg('db') || die('--db required');
  const dir = path.dirname(path.resolve(dbPath));
  const plaintext = migrate._hasMagic(dbPath);
  console.log(JSON.stringify({
    db: dbPath,
    exists: fs.existsSync(dbPath),
    header: plaintext ? 'plaintext (SQLite format 3)' : 'encrypted/other',
    resolveState: migrate.resolveState({ dbPath }),
    keyFile: fs.existsSync(path.join(dir, '.db-key')),
    recoveryFile: fs.existsSync(path.join(dir, '.db-recovery')),
  }, null, 2));
}

async function cmdExportPlain() {
  const dbPath = arg('db') || die('--db required');
  const out = arg('out') || die('--out required');
  if (!fs.existsSync(dbPath)) die('--db does not exist: ' + dbPath);
  if (migrate._hasMagic(dbPath)) die('--db is already PLAINTEXT — just copy it');
  const hex = await resolveKeyHex(dbPath);
  // Work on a copy so --db is never modified; decrypt the copy in place via hexrekey=''.
  for (const s of ['', '-wal', '-shm']) { try { if (fs.existsSync(out + s)) fs.unlinkSync(out + s); } catch { /* noop */ } }
  fs.copyFileSync(dbPath, out);
  let db = null;
  try {
    db = new Database(out);
    db.pragma(`hexkey='${hex}'`);
    // Rekey is refused in WAL mode; DELETE mode also forces a header read that fails fast on a wrong key.
    db.pragma('journal_mode = DELETE');
    db.prepare('SELECT COUNT(*) FROM sqlite_master').get();
    db.pragma("hexrekey=''");                 // empty key = decrypt in place
  } catch (e) {
    try { db && db.close(); } catch { /* noop */ }
    try { fs.unlinkSync(out); } catch { /* noop */ }
    die('decrypt failed (wrong key / corrupt): ' + e.message);
  } finally { try { db && db.close(); } catch { /* noop */ } }
  if (!migrate._hasMagic(out)) { try { fs.unlinkSync(out); } catch { /* noop */ } die('output is not plaintext after decrypt — aborted'); }
  console.log('export-plain: wrote decrypted copy to ' + out);
}

(async () => {
  const cmd = process.argv[2];
  if (cmd === 'status') return cmdStatus();
  if (cmd === 'export-plain') return cmdExportPlain();
  console.log('usage: db-crypto-tool <status|export-plain> --db <path> [--out <path>] [--recovery-code <code> | --hexkey <64hex>]');
  process.exit(cmd ? 2 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
