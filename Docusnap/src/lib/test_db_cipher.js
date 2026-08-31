#!/usr/bin/env node
'use strict';
/**
 * Runtime CIPHER pin (2026-08-31, DB-at-rest slice 0). Proves the aliased `better-sqlite3` is the
 * multiple-ciphers fork, that a raw ChaCha20 hexkey round-trips, that the fork still opens a PLAINTEXT
 * DB transparently (slice-0 inertness), and the Oracle NEGATIVE CONTROLS: an encrypted DB opened
 * WITHOUT the key FAILS and its header magic is absent.
 *
 * Native module (Electron ABI) — run under electron-as-node:
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/lib/test_db_cipher.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

let pass = 0, fail = 0;
const check = (l, c) => { if (c) { pass++; console.log('  OK  ' + l); } else { fail++; console.error('  FAIL: ' + l); } };

// ── 1. it IS the ciphers fork ────────────────────────────────────────────────
check('the aliased better-sqlite3 is better-sqlite3-multiple-ciphers',
      require('better-sqlite3/package.json').name === 'better-sqlite3-multiple-ciphers');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbcipher-'));

// ── 2. hexkey round-trip on a FILE DB + no-cleartext + header-magic-absent ────
const encPath = path.join(dir, 'enc.db');
const hex = crypto.randomBytes(32).toString('hex');
{
  const db = new Database(encPath);
  db.pragma(`hexkey = '${hex}'`);          // MUST precede every other pragma/read (multiple-ciphers)
  db.pragma('journal_mode = WAL');
  db.exec("CREATE TABLE t(x TEXT); INSERT INTO t VALUES('sentinel-abc123')");
  db.close();
}
const bytes = fs.readFileSync(encPath);
check('encrypted DB header is NOT "SQLite format 3" (magic absent)',
      !bytes.subarray(0, 16).toString('binary').startsWith('SQLite format 3'));
check('the sentinel value is not present in cleartext', !bytes.includes(Buffer.from('sentinel-abc123')));
{
  const db = new Database(encPath);
  db.pragma(`hexkey = '${hex}'`);
  // A keyed connection reports an active cipher — a fork-only pragma (plain better-sqlite3 has none).
  let cipher = null;
  try { cipher = db.pragma('cipher', { simple: true }); } catch { /* plain build */ }
  check('a keyed connection reports an active cipher (multiple-ciphers linked): ' + cipher, !!cipher);
  check('reopen WITH the hexkey reads the sentinel', db.prepare('SELECT x FROM t').get().x === 'sentinel-abc123');
  db.close();
}

// ── 3. NEGATIVE CONTROLS (Oracle ship-blocker 2) ─────────────────────────────
let noKeyFailed = false;
try { const db = new Database(encPath); db.prepare('SELECT x FROM t').get(); db.close(); } catch { noKeyFailed = true; }
check('reopen WITHOUT the key FAILS (negative control)', noKeyFailed);

let wrongKeyFailed = false;
try {
  const db = new Database(encPath);
  db.pragma(`hexkey = '${crypto.randomBytes(32).toString('hex')}'`);
  db.prepare('SELECT x FROM t').get(); db.close();
} catch { wrongKeyFailed = true; }
check('reopen with a WRONG key FAILS', wrongKeyFailed);

// ── 4. slice-0 INERTNESS: the fork opens a PLAINTEXT DB transparently (no key) ─
const plainPath = path.join(dir, 'plain.db');
{
  const db = new Database(plainPath);       // no hexkey → plaintext, exactly today's open path
  db.pragma('journal_mode = WAL');
  db.exec("CREATE TABLE p(y TEXT); INSERT INTO p VALUES('plain-ok')");
  db.close();
}
check('a plaintext DB (no key) has the SQLite header',
      fs.readFileSync(plainPath).subarray(0, 16).toString('binary').startsWith('SQLite format 3'));
{
  const db = new Database(plainPath);
  check('reopen a plaintext DB with NO key still reads (byte-identical open path)',
        db.prepare('SELECT y FROM p').get().y === 'plain-ok');
  db.close();
}

try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
console.log(`\ndb-cipher: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
