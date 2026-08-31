#!/usr/bin/env node
'use strict';
/**
 * Runtime CIPHER + PORTABILITY pin (code-as-passphrase; Oracle C1/C3). Proves the aliased better-sqlite3
 * is the multiple-ciphers fork, that the chacha20 passphrase scheme round-trips, that the fork still
 * opens a PLAINTEXT DB transparently (slice-0 inertness), the NEGATIVE CONTROLS (no-code / wrong-code
 * fail, header magic absent), and — THE PREMISE — that a copy of ONLY the `.db` opens by the code in a
 * FRESH directory (no sidecar). The pragma sequence comes from dbKey.applyKey (the single choke point).
 *
 * Native module (Electron ABI) — run under electron-as-node:
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/lib/test_db_cipher.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const dbKey = require('./dbKey');

let pass = 0, fail = 0;
const check = (l, c) => { if (c) { pass++; console.log('  OK  ' + l); } else { fail++; console.error('  FAIL: ' + l); } };

const CODE = 'ABCDE-FGHJK-MNPQR-STVWX-YZ234';   // display form; applyKey normalises
const isPlainHeader = (p) => fs.readFileSync(p).subarray(0, 16).toString('binary').startsWith('SQLite format 3');

check('the aliased better-sqlite3 is better-sqlite3-multiple-ciphers',
      require('better-sqlite3/package.json').name === 'better-sqlite3-multiple-ciphers');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbcipher-'));

// ── passphrase round-trip on a FILE DB + explicit chacha20 + no-cleartext ────
const encPath = path.join(dir, 'enc.db');
{
  const db = new Database(encPath);
  dbKey.applyKey(db, CODE);                 // cipher='chacha20' + kdf_iter + key
  const cipher = db.pragma('cipher', { simple: true });
  check('active cipher is explicitly chacha20 (scheme pinned, not the compile default): ' + cipher, cipher === 'chacha20');
  db.pragma('journal_mode = WAL');
  db.exec("CREATE TABLE t(x TEXT); INSERT INTO t VALUES('sentinel-abc123')");
  db.close();
}
const bytes = fs.readFileSync(encPath);
check('encrypted DB header is NOT "SQLite format 3" (magic absent)', !bytes.subarray(0, 16).toString('binary').startsWith('SQLite format 3'));
check('the sentinel value is not present in cleartext', !bytes.includes(Buffer.from('sentinel-abc123')));
{
  const db = new Database(encPath);
  dbKey.applyKey(db, CODE);
  check('reopen WITH the code reads the sentinel', db.prepare('SELECT x FROM t').get().x === 'sentinel-abc123');
  db.close();
}

// ── NEGATIVE CONTROLS ────────────────────────────────────────────────────────
let noKeyFailed = false;
try { const db = new Database(encPath); db.prepare('SELECT x FROM t').get(); db.close(); } catch { noKeyFailed = true; }
check('reopen WITHOUT the code FAILS', noKeyFailed);
let wrongFailed = false;
try { const db = new Database(encPath); dbKey.applyKey(db, 'ZZZZZ-FGHJK-MNPQR-STVWX-YZ234'); db.prepare('SELECT x FROM t').get(); db.close(); } catch { wrongFailed = true; }
check('reopen with a WRONG code FAILS', wrongFailed);

// ── THE PORTABILITY PIN (Oracle C3): copy ONLY the .db to a FRESH dir, open by code ──
const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'dbcipher-moved-'));
const moved = path.join(dir2, 'moved.db');
fs.copyFileSync(encPath, moved);            // ONLY the .db — no .db-key, no sidecar of any kind
{
  const db = new Database(moved);
  dbKey.applyKey(db, CODE);
  check('PORTABILITY: a lone .db copy opens by the code in a FRESH dir (the owner requirement)',
        db.prepare('SELECT x FROM t').get().x === 'sentinel-abc123');
  db.close();
}

// ── slice-0 INERTNESS: the fork opens a PLAINTEXT DB transparently (no code) ──
const plainPath = path.join(dir, 'plain.db');
{ const db = new Database(plainPath); db.pragma('journal_mode = WAL'); db.exec("CREATE TABLE p(y TEXT); INSERT INTO p VALUES('plain-ok')"); db.close(); }
check('a plaintext DB (no code) has the SQLite header', isPlainHeader(plainPath));
{ const db = new Database(plainPath); check('reopen a plaintext DB with NO code still reads (byte-identical open path)', db.prepare('SELECT y FROM p').get().y === 'plain-ok'); db.close(); }

try { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(dir2, { recursive: true, force: true }); } catch { /* noop */ }
console.log(`\ndb-cipher: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
