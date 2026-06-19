#!/usr/bin/env node
'use strict';

/**
 * /v1/enroll: credential + entitlement-gated one-step enrollment (CA + token).
 * Security matrix — not-licensed (402, no CA leak), good creds (200 + working token),
 * bad creds (401), pairing gate (403 before auth), MFA-required (401 mfaRequired).
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe src/modules/api/test_v1_enroll.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const Database = require('better-sqlite3');
const api = require('./handler');
const pw = require('../auth/password');
const certService = require('../../services/certService');
const realLearning = require('../../../database/modules/learning');
const { SETTING_KEY } = require('../../services/entitlementService');

const PWD = 'Enroll-Test-7';
let fail = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fail++; };

async function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE document_types (id INTEGER PRIMARY KEY, name TEXT, slug TEXT);
    CREATE TABLE documents (id INTEGER PRIMARY KEY, supplier_name TEXT, status TEXT, document_type_id INTEGER, confirmed_at TEXT, processed_at TEXT);
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, display_name TEXT, password_hash TEXT,
      role TEXT, is_active INTEGER DEFAULT 1, must_change_password INTEGER DEFAULT 0,
      totp_secret TEXT, totp_enabled INTEGER DEFAULT 0, last_login_at TEXT, created_at TEXT, updated_at TEXT);
  `);
  db.prepare('INSERT INTO users (id,username,display_name,password_hash,role,is_active) VALUES (1,?,?,?,?,1)')
    .run('admin', 'Admin', await pw.hashPassword(PWD), 'admin');
  return db;
}
const set = (db, k, v) => db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v);
function post(base, p, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(base + p);
    const data = JSON.stringify(body || {});
    const req = http.request({
      method: 'POST', hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), 'x-scanfinder-client-contract': '1.0.0', ...(headers || {}) },
    }, (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => { let j = null; try { j = JSON.parse(d); } catch { /* */ } resolve({ status: r.statusCode, json: j }); }); });
    req.on('error', reject); req.write(data); req.end();
  });
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-enroll-test-'));
  const db = await freshDb();
  set(db, 'client_api_host', '192.168.5.10'); set(db, 'client_api_port', '8766');
  certService.generateServerCerts({ certsDir: path.join(tmp, 'certs'), sans: ['192.168.5.10'] });

  // real entitlement (reads SETTING_KEY); learning gives getSetting (pairing) + a search stub.
  const learning = { getSetting: realLearning.getSetting, getDigitsOnlyFields: () => [] };
  const server = api.createServer({ getDb: () => db, certsDir: path.join(tmp, 'certs'), learning });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  // Not licensed → 402, and NO caPem leaked.
  let r = await post(base, '/v1/enroll', { username: 'admin', password: PWD });
  check('not licensed → 402 FEATURE_NOT_LICENSED', r.status === 402 && r.json.code === 'FEATURE_NOT_LICENSED');
  check('not licensed → body has NO caPem (no leak)', !(r.json && r.json.caPem));

  // License the add-on.
  set(db, SETTING_KEY, 'true');

  // Licensed + good creds → 200, CA + token + user; token authorizes a feature route.
  r = await post(base, '/v1/enroll', { username: 'admin', password: PWD });
  check('licensed + good creds → 200', r.status === 200);
  check('returns caPem + token + user', !!(r.json && r.json.caPem && r.json.token && r.json.user));
  check('fingerprint matches file CA', r.json.caFingerprintSha256 === certService.readCaFingerprint({ caCrtPath: path.join(tmp, 'certs', 'ca.crt') }));
  const s = await post(base, '/v1/search', {}, { authorization: `Bearer ${r.json.token}` });
  check('enroll token authorizes /v1/search → 200', s.status === 200);

  // Bad password → 401, no caPem.
  r = await post(base, '/v1/enroll', { username: 'admin', password: 'wrong' });
  check('bad password → 401', r.status === 401);
  check('bad password → no caPem', !(r.json && r.json.caPem));

  // Pairing enforced: bad/missing code → 403 even with good creds.
  set(db, 'client_api_pairing_code', 'PAIR99');
  r = await post(base, '/v1/enroll', { username: 'admin', password: PWD });
  check('pairing: missing code → 403 even with good creds', r.status === 403 && r.json.code === 'PAIRING');
  r = await post(base, '/v1/enroll?code=PAIR99', { username: 'admin', password: PWD });
  check('pairing: correct code → 200', r.status === 200);
  set(db, 'client_api_pairing_code', '');

  // MFA-required user → 401 mfaRequired.
  db.prepare("UPDATE users SET totp_secret='JBSWY3DPEHPK3PXP', totp_enabled=1 WHERE id=1").run();
  r = await post(base, '/v1/enroll', { username: 'admin', password: PWD });
  check('MFA user without code → 401 mfaRequired', r.status === 401 && r.json.mfaRequired === true);
  check('MFA case → no caPem', !(r.json && r.json.caPem));

  await new Promise(r2 => server.close(r2));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
  db.close();
  console.log(fail ? `\n${fail} check(s) FAILED.` : '\nAll /v1/enroll checks passed.');
  return fail ? 1 : 0;
}
main().then(c => process.exit(c)).catch(e => { console.error(e); process.exit(1); });
