#!/usr/bin/env node
'use strict';

/**
 * client/test_apiclient.js
 * ------------------------
 * Drives the REAL client transport (apiClient.js) against the REAL /v1 server
 * (src/modules/api/handler.createServer) on an ephemeral loopback port. Proves the
 * client end-to-end: version handshake (ok/warn/block), login + token handling,
 * role-aware search via the client, projected detail, and logout.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron client/test_apiclient.js
 */

const Database = require('better-sqlite3');
const api = require('../src/modules/api/handler');
const pw  = require('../src/modules/auth/password');
const { createClient, compareContract } = require('./apiClient');

const PWD = 'Client-Test-Pw-7';
let fail = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fail++; };

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
    CREATE TABLE extractions (
      id INTEGER PRIMARY KEY, document_id INTEGER, field_key TEXT, raw_value TEXT,
      display_value TEXT, confidence INTEGER, was_corrected INTEGER, corrected_to TEXT,
      validation_note TEXT, extraction_method TEXT
    );
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, username TEXT, display_name TEXT, password_hash TEXT,
      role TEXT, is_active INTEGER DEFAULT 1, must_change_password INTEGER DEFAULT 0,
      totp_secret TEXT, totp_enabled INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT
    );
  `);
  db.prepare(`INSERT INTO document_types (id,name,slug) VALUES (1,'Invoice','invoice')`).run();
  // Paths left NULL so the stale-file filter keeps these rows (no on-disk file in
  // this hermetic test). DTO path-stripping is proven with real sentinels in
  // src/modules/api/test_v1_contract.js; here we only need the rows to survive.
  db.prepare(`INSERT INTO documents (id,supplier_name,reference_number,doc_date,document_type_id,status,confirmed_at,processed_at)
              VALUES (1,'Acme','INV-1','16-03-2026',1,'confirmed','2026-03-11','2026-03-11'),
                     (2,'ReviewCo',NULL,NULL,1,'needs_review','2026-03-12','2026-03-12')`).run();
  const h = await pw.hashPassword(PWD);
  const ins = db.prepare(`INSERT INTO users (id,username,display_name,password_hash,role,is_active) VALUES (?,?,?,?,?,1)`);
  ins.run(1, 'reader', 'Reader', h, 'readonly');
  ins.run(2, 'boss', 'Boss', h, 'admin');
  return db;
}

async function main() {
  // ── pure compareContract unit ────────────────────────────────────────────────
  check('compareContract same -> ok',   compareContract('1.0.0', '1.0.0').mode === 'ok');
  check('compareContract major -> block', compareContract('2.0.0', '1.0.0').mode === 'block');
  check('compareContract minor -> warn',  compareContract('1.4.0', '1.0.0').mode === 'warn');
  check('compareContract missing -> block', compareContract(null, '1.0.0').mode === 'block');

  const db = await freshDb();
  const server = api.createServer({ getDb: () => db, learning: { getDigitsOnlyFields: () => [] }, checkEntitlement: () => ({ entitled: true, feature: 'detached_client' }) });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  // ── handshake ─────────────────────────────────────────────────────────────────
  let c = createClient({ baseUrl });
  let h = await c.connect();
  check('connect -> ok, server v1.1.0', h.ok && h.mode === 'ok' && h.serverVersion === '1.1.0');
  check('connect blocks on major mismatch',
    (await createClient({ baseUrl, expectedContract: '2.0.0' }).connect()).mode === 'block');
  check('connect warns on minor drift',
    (await createClient({ baseUrl, expectedContract: '1.9.0' }).connect()).mode === 'warn');

  // ── login + token ─────────────────────────────────────────────────────────────
  check('bad login -> ok:false', !(await c.login('reader', 'nope')).ok);
  const li = await c.login('reader', PWD);
  check('good login -> ok, role readonly', li.ok && li.user.role === 'readonly');
  check('client is authenticated after login', c.isAuthenticated());

  // ── search (readonly) ──────────────────────────────────────────────────────────
  let r = await c.search({});
  check('search -> 200, one confirmed', r.status === 200 && r.json.confirmed.length === 1);
  check('search row has no path leak', !('stored_path' in (r.json.confirmed[0] || {})));
  r = await c.search({ includeUncommitted: true });
  check('readonly client: no uncommitted', r.json.uncommitted.length === 0);

  // ── detail ──────────────────────────────────────────────────────────────────────
  r = await c.getDocument(1);
  check('getDocument -> 200, type_slug=invoice + no leak',
    r.status === 200 && r.json.type_slug === 'invoice' && !('stored_path' in r.json));

  // ── admin client sees uncommitted (role from token) ─────────────────────────────
  const admin = createClient({ baseUrl });
  await admin.connect();
  await admin.login('boss', PWD);
  r = await admin.search({ includeUncommitted: true });
  check('admin client: uncommitted returned', r.json.uncommitted.length === 1);

  // ── logout ──────────────────────────────────────────────────────────────────────
  await c.logout();
  check('not authenticated after logout', !c.isAuthenticated());
  r = await c.search({});
  check('search after logout -> 401', r.status === 401);

  await new Promise(r2 => server.close(r2));
  db.close();
  console.log(fail ? `\n${fail} check(s) FAILED — client transport changed.` : '\nAll client transport checks passed.');
  return fail ? 1 : 0;
}

main().then(c => process.exit(c)).catch(e => { console.error(e); process.exit(1); });
