#!/usr/bin/env node
'use strict';

/**
 * src/modules/api/test_v1_auth.js
 * -------------------------------
 * Stage 3 auth-boundary conformance: boots the REAL /v1 API on an ephemeral
 * loopback port against an in-memory DB with real Argon2id-hashed users, and
 * asserts the parallel auth/session boundary end-to-end:
 *   - protected routes reject missing/invalid tokens (401),
 *   - bad credentials are rejected,
 *   - the session ROLE drives authorization (admin sees uncommitted; readonly
 *     never does) — proving role-from-token replaces the Stage 2 forced-readonly,
 *   - TOTP MFA: setup → confirm enables it; thereafter login without a code is
 *     refused (mfaRequired) and login WITH a valid code succeeds,
 *   - logout revokes the token.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/api/test_v1_auth.js
 */

const http = require('http');
const Database = require('better-sqlite3');

const api  = require('./handler');
const pw   = require('../auth/password');
const totp = require('../../lib/totp');

const PWD = 'Correct-Horse-9';

function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); return cond; }

async function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE document_types (id INTEGER PRIMARY KEY, name TEXT, slug TEXT);
    CREATE TABLE documents (
      id INTEGER PRIMARY KEY, supplier_name TEXT, reference_number TEXT, doc_date TEXT,
      document_type_id INTEGER, status TEXT, ocr_text TEXT, overall_confidence INTEGER,
      original_filename TEXT, stored_filename TEXT, stored_path TEXT, folder_path TEXT,
      working_path TEXT, confirmed_at TEXT, processed_at TEXT
    );
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, username TEXT, display_name TEXT, password_hash TEXT,
      role TEXT, is_active INTEGER DEFAULT 1, must_change_password INTEGER DEFAULT 0,
      totp_secret TEXT, totp_enabled INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT
    );
  `);
  db.prepare(`INSERT INTO document_types (id,name,slug) VALUES (1,'Invoice','invoice')`).run();
  db.prepare(`INSERT INTO documents (id,status,document_type_id,confirmed_at,processed_at)
              VALUES (1,'confirmed',1,'2026-03-11','2026-03-11'),
                     (2,'needs_review',1,'2026-03-12','2026-03-12')`).run();
  const h = await pw.hashPassword(PWD);
  const ins = db.prepare(`INSERT INTO users (id,username,display_name,password_hash,role,is_active)
                          VALUES (?,?,?,?,?,1)`);
  ins.run(1, 'reader', 'Reader', h, 'readonly');
  ins.run(2, 'boss',   'Boss',   h, 'admin');
  ins.run(3, 'mfauser','MfaUser',h, 'edit');
  return db;
}

function httpReq(port, method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const data = body != null ? JSON.stringify(body) : null;
    const headers = {};
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers }, (res) => {
      let out = ''; res.on('data', d => { out += d; });
      res.on('end', () => { try { resolve({ status: res.statusCode, json: out ? JSON.parse(out) : null }); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  let fail = 0;
  const db = await freshDb();
  const server = api.createServer({ getDb: () => db, learning: { getDigitsOnlyFields: () => [] } });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const login = (username, password, totpCode) =>
    httpReq(port, 'POST', '/v1/auth/login', { username, password, totp: totpCode });

  // ── unauthenticated + bad creds ──────────────────────────────────────────────
  let r = await httpReq(port, 'GET', '/v1/documents/1');
  fail += !check('no token -> 401', r.status === 401);
  r = await login('reader', 'wrong-password');
  fail += !check('bad password -> 401', r.status === 401);
  r = await httpReq(port, 'POST', '/v1/search', {}, 'garbage-token');
  fail += !check('invalid token -> 401', r.status === 401);

  // ── role-from-token: admin sees uncommitted, readonly does not ───────────────
  r = await login('boss', PWD);
  const adminToken = r.json.token;
  fail += !check('admin login -> 200, role=admin', r.status === 200 && r.json.user.role === 'admin');
  r = await httpReq(port, 'POST', '/v1/search', { includeUncommitted: true }, adminToken);
  fail += !check('admin: uncommitted returned (role drives authz)', r.json.uncommitted.length === 1);

  r = await login('reader', PWD);
  const readerToken = r.json.token;
  r = await httpReq(port, 'POST', '/v1/search', { includeUncommitted: true }, readerToken);
  fail += !check('readonly: uncommitted still excluded', r.json.uncommitted.length === 0);

  // ── logout revokes the token ─────────────────────────────────────────────────
  await httpReq(port, 'POST', '/v1/auth/logout', {}, readerToken);
  r = await httpReq(port, 'POST', '/v1/search', {}, readerToken);
  fail += !check('after logout -> 401', r.status === 401);

  // ── TOTP MFA enrolment + enforcement ─────────────────────────────────────────
  r = await login('mfauser', PWD);
  const mfaToken = r.json.token;
  fail += !check('mfauser login before enrolment -> 200', r.status === 200);
  r = await httpReq(port, 'POST', '/v1/auth/totp/setup', {}, mfaToken);
  const secret = r.json.secret;
  fail += !check('totp setup returns secret + otpauthUri',
    r.status === 200 && !!secret && String(r.json.otpauthUri || '').startsWith('otpauth://totp/'));
  // wrong code does not enable
  r = await httpReq(port, 'POST', '/v1/auth/totp/confirm', { totp: '000000' }, mfaToken);
  fail += !check('totp confirm with wrong code -> 400', r.status === 400);
  // correct code enables
  r = await httpReq(port, 'POST', '/v1/auth/totp/confirm', { totp: totp.generate(secret) }, mfaToken);
  fail += !check('totp confirm with valid code -> 200', r.status === 200);
  // now login without a code is refused
  r = await login('mfauser', PWD);
  fail += !check('enrolled user: login without code -> 401 mfaRequired',
    r.status === 401 && r.json.mfaRequired === true);
  // login with a valid code succeeds
  r = await login('mfauser', PWD, totp.generate(secret));
  fail += !check('enrolled user: login with valid code -> 200', r.status === 200 && !!r.json.token);

  await new Promise(r2 => server.close(r2));
  db.close();
  console.log(fail ? `\n${fail} check(s) FAILED — /v1 auth boundary changed.` : '\nAll /v1 auth checks passed.');
  return fail ? 1 : 0;
}

main().then(c => process.exit(c)).catch(e => { console.error(e); process.exit(1); });
