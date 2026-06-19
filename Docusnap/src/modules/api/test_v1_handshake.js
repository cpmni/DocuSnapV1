#!/usr/bin/env node
'use strict';

/**
 * src/modules/api/test_v1_handshake.js
 * Stage 6 lockstep gate: the server refuses an incompatible client (contract MAJOR
 * mismatch) on every route except /health, while a header-less caller is allowed
 * (back-compat). Combined with the client-side connect() verdict, the handshake is
 * now bidirectional.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/api/test_v1_handshake.js
 */

const http = require('http');
const Database = require('better-sqlite3');
const api = require('./handler');
const pw  = require('../auth/password');
const { createClient } = require('../../../client/apiClient');

const PWD = 'Handshake-Test-3';
let fail = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fail++; };

async function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, display_name TEXT, password_hash TEXT,
    role TEXT, is_active INTEGER DEFAULT 1, must_change_password INTEGER DEFAULT 0,
    totp_secret TEXT, totp_enabled INTEGER DEFAULT 0, last_login_at TEXT, created_at TEXT, updated_at TEXT);`);
  db.prepare(`INSERT INTO users (id,username,display_name,password_hash,role,is_active)
              VALUES (1,'admin','Admin',?,'admin',1)`).run(await pw.hashPassword(PWD));
  return db;
}

// Raw POST WITHOUT the client-contract header.
function rawLoginNoHeader(port) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ username: 'admin', password: PWD });
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/v1/auth/login',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => { let o = ''; res.on('data', d => o += d); res.on('end', () => resolve({ status: res.statusCode })); });
    req.on('error', reject); req.write(data); req.end();
  });
}

async function main() {
  const db = await freshDb();
  const server = api.createServer({ getDb: () => db, learning: { getDigitsOnlyFields: () => [] }, checkEntitlement: () => ({ entitled: true, feature: 'detached_client' }) });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  // Compatible client (1.0.0) — normal operation.
  const good = createClient({ baseUrl });
  let h = await good.connect();
  check('compatible client connect -> ok', h.mode === 'ok');
  let li = await good.login('admin', PWD);
  check('compatible client login -> ok', li.ok);

  // Incompatible client (2.0.0) — health open, everything else 426.
  const bad = createClient({ baseUrl, expectedContract: '2.0.0' });
  h = await bad.connect();
  check('incompatible client connect -> block (sees server v1.0.0)', h.mode === 'block' && h.serverVersion === '1.0.0');
  li = await bad.login('admin', PWD);
  check('incompatible client login refused -> 426', li.status === 426);
  const s = await bad.search({});
  check('incompatible client search refused -> 426', s.status === 426);

  // Header-absent caller is allowed (back-compat).
  const noHdr = await rawLoginNoHeader(port);
  check('header-less login is NOT gated -> 200', noHdr.status === 200);

  await new Promise(r2 => server.close(r2));
  db.close();
  console.log(fail ? `\n${fail} check(s) FAILED — handshake gate changed.` : '\nAll handshake gate checks passed.');
  return fail ? 1 : 0;
}

main().then(c => process.exit(c)).catch(e => { console.error(e); process.exit(1); });
