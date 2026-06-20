#!/usr/bin/env node
'use strict';

/**
 * src/modules/api/test_v1_pages_pathsec.js
 * ----------------------------------------
 * F-02 regression: GET /v1/documents/:id/pages must resolve the on-disk file
 * SERVER-SIDE from the document row only, and must NOT honour client-supplied
 * folderPath/filename — otherwise an authenticated peer can read arbitrary host
 * files through the render/preview path.
 *
 * Boots the REAL /v1 API on an ephemeral loopback port against an in-memory DB
 * with a real Argon2id admin user (mirrors test_v1_auth.js). Uses .png files so
 * the inline read path is exercised with no Python/render dependency.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/api/test_v1_pages_pathsec.js
 */

const http = require('http');
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const api = require('./handler');
const pw  = require('../auth/password');

const PWD = 'Correct-Horse-9';

function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); return cond; }

async function freshDb(allowedPngPath) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE documents (
      id INTEGER PRIMARY KEY, status TEXT, original_filename TEXT, stored_filename TEXT,
      stored_path TEXT, folder_path TEXT, working_path TEXT
    );
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, username TEXT, display_name TEXT, password_hash TEXT,
      role TEXT, is_active INTEGER DEFAULT 1, must_change_password INTEGER DEFAULT 0,
      totp_secret TEXT, totp_enabled INTEGER DEFAULT 0
    );
  `);
  // doc 1: a legitimate filed PNG (the only file the server should ever return for id=1).
  db.prepare(`INSERT INTO documents (id,status,original_filename,stored_path)
              VALUES (1,'confirmed','allowed.png',?)`).run(allowedPngPath);
  // doc 2: no recorded path at all → server must return no pages.
  db.prepare(`INSERT INTO documents (id,status,original_filename) VALUES (2,'confirmed','none.png')`).run();
  const h = await pw.hashPassword(PWD);
  db.prepare(`INSERT INTO users (id,username,display_name,password_hash,role,is_active)
              VALUES (1,'boss','Boss',?,'admin',1)`).run(h);
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

const decodeDataUrl = (u) => Buffer.from(String(u).split(',')[1] || '', 'base64').toString('utf8');

async function main() {
  let fail = 0;

  // Two real on-disk files: one is the document's filed copy; the other is a
  // "host secret" the attacker tries to read by injecting its path.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-pages-sec-'));
  const allowedPng = path.join(tmp, 'allowed.png');
  const secretPng  = path.join(tmp, 'secret.png');
  fs.writeFileSync(allowedPng, 'ALLOWED-DOC-BYTES');
  fs.writeFileSync(secretPng,  'SECRET-HOST-FILE');

  const db = await freshDb(allowedPng);
  const server = api.createServer({
    getDb: () => db,
    learning: { getDigitsOnlyFields: () => [] },
    checkEntitlement: () => ({ entitled: true, feature: 'detached_client' }),
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  // unauthenticated is refused
  let r = await httpReq(port, 'GET', '/v1/documents/1/pages');
  fail += !check('no token -> 401', r.status === 401);

  r = await httpReq(port, 'POST', '/v1/auth/login', { username: 'boss', password: PWD });
  const token = r.json.token;
  fail += !check('admin login -> 200', r.status === 200 && !!token);

  // ── F-02 core: inject a foreign folderPath/filename for doc 1 ─────────────────
  const inj = `/v1/documents/1/pages?folderPath=${encodeURIComponent(tmp)}&filename=${encodeURIComponent('secret.png')}`;
  r = await httpReq(port, 'GET', inj, null, token);
  const pages = (r.json && r.json.pages) || [];
  const body = pages.map(decodeDataUrl).join('');
  fail += !check('injected path did NOT leak the host secret', !body.includes('SECRET-HOST-FILE'));
  fail += !check('server returned the document\'s OWN file instead', body.includes('ALLOWED-DOC-BYTES'));

  // ── no query params: still resolves the document's own file ──────────────────
  r = await httpReq(port, 'GET', '/v1/documents/1/pages', null, token);
  const plain = ((r.json && r.json.pages) || []).map(decodeDataUrl).join('');
  fail += !check('normal request returns the real document page', plain.includes('ALLOWED-DOC-BYTES'));

  // ── doc with no recorded path returns no pages (cannot be coerced) ───────────
  r = await httpReq(port, 'GET', `/v1/documents/2/pages?folderPath=${encodeURIComponent(tmp)}&filename=secret.png`, null, token);
  fail += !check('doc with no recorded path -> empty pages (no file bytes)',
    Array.isArray(r.json.pages) && r.json.pages.length === 0);

  await new Promise(r2 => server.close(r2));
  db.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  console.log(fail ? `\n${fail} check(s) FAILED — /v1 pages path security regressed.` : '\nAll /v1 pages path-security checks passed.');
  return fail ? 1 : 0;
}

main().then(c => process.exit(c)).catch(e => { console.error(e); process.exit(1); });
