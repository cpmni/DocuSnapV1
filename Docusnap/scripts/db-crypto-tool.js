#!/usr/bin/env node
'use strict';
/**
 * scripts/db-crypto-tool.js — the DB-at-rest maintenance CLI (code-as-passphrase; Oracle C7).
 *
 * The dev/night-run reset + harness rituals must survive the plaintext → encrypted switch. RUN_AS_NODE
 * cannot unwrap DPAPI (safeStorage is unavailable), so a harness that needs a READABLE copy of an
 * encrypted live DB gets one here with the printed RECOVERY CODE — the code IS the passphrase, no DPAPI.
 *
 * Run under electron-as-node (native module):
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron scripts/db-crypto-tool.js <cmd> [opts]
 *
 * Commands:
 *   status       --db <path>
 *   export-plain --db <path> --out <path> --recovery-code <code>
 *
 * export-plain writes a DECRYPTED copy of --db to --out (leaves --db untouched). Use it for the harness
 * and for inspection; never ship or leave the plaintext copy beside an encrypted install.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const migrate = require('../src/lib/dbMigrateEncrypt');
const dbKey = require('../src/lib/dbKey');

function arg(name) { const i = process.argv.indexOf('--' + name); return i > -1 ? process.argv[i + 1] : null; }
function die(msg) { console.error('db-crypto-tool: ' + msg); process.exit(2); }

function resolvePassphrase() {
  const code = arg('recovery-code');
  if (!code) die('provide --recovery-code <code>');
  if (!dbKey.isValidNormalised(dbKey.normaliseCode(code))) die('--recovery-code is not a valid recovery code');
  return code;   // applyKey normalises + validates again at the boundary
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
    keyCache: fs.existsSync(path.join(dir, dbKey.KEY_FILE)),
  }, null, 2));
}

function cmdExportPlain() {
  const dbPath = arg('db') || die('--db required');
  const out = arg('out') || die('--out required');
  if (!fs.existsSync(dbPath)) die('--db does not exist: ' + dbPath);
  if (migrate._hasMagic(dbPath)) die('--db is already PLAINTEXT — just copy it');
  const code = resolvePassphrase();
  // Work on a copy so --db is never modified; decrypt the copy in place via rekey=''.
  for (const s of ['', '-wal', '-shm', '-journal']) { try { if (fs.existsSync(out + s)) fs.unlinkSync(out + s); } catch { /* noop */ } }
  fs.copyFileSync(dbPath, out);
  let db = null;
  try {
    db = new Database(out);
    dbKey.applyKey(db, code);            // cipher + kdf_iter + key='<code>'
    db.pragma('journal_mode = DELETE');  // rekey refused in WAL; also fails fast on a wrong code
    db.prepare('SELECT COUNT(*) FROM sqlite_master').get();
    db.pragma("rekey = ''");             // empty passphrase = decrypt in place
  } catch (e) {
    try { db && db.close(); } catch { /* noop */ }
    try { fs.unlinkSync(out); } catch { /* noop */ }
    die('decrypt failed (wrong code / corrupt): ' + e.message);
  } finally { try { db && db.close(); } catch { /* noop */ } }
  if (!migrate._hasMagic(out)) { try { fs.unlinkSync(out); } catch { /* noop */ } die('output is not plaintext after decrypt — aborted'); }
  console.log('export-plain: wrote decrypted copy to ' + out);
}

const cmd = process.argv[2];
if (cmd === 'status') cmdStatus();
else if (cmd === 'export-plain') cmdExportPlain();
else { console.log('usage: db-crypto-tool <status|export-plain> --db <path> [--out <path>] --recovery-code <code>'); process.exit(cmd ? 2 : 0); }
