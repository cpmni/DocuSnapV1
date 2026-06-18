#!/usr/bin/env node
'use strict';

/**
 * src/modules/api/test_v1_contract.js
 * -----------------------------------
 * End-to-end conformance test for the Stage 2 read-only /v1 API. Boots the REAL
 * api/handler.createServer() on an ephemeral 127.0.0.1 port against an in-memory
 * better-sqlite3 DB seeded with SENTINEL filesystem paths + OCR text, then makes
 * real HTTP requests and asserts:
 *   - /v1/health advertises the contract version,
 *   - search/detail expose the essential detached-client fields,
 *   - NO filesystem path or raw OCR/raw_value EVER appears in a response (the DTO
 *     trust boundary — the headline security guarantee of this stage),
 *   - the no-auth POC runs at least privilege: readonly shaping, so uncommitted
 *     (needs_review/deferred) is NEVER returned even when requested,
 *   - the image-page render path returns image bytes (data-URL), not a path.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/api/test_v1_contract.js
 * (Electron-as-Node: better-sqlite3 is built against Electron's ABI.)
 */

const http = require('http');
const os   = require('os');
const fs   = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const api = require('./handler');
const dto = require('../../services/dto');
const pw  = require('../auth/password');

const READER_PW = 'Sesame-Reader-1234';

function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); return cond; }

// Recursively collect every object key appearing anywhere in a value.
function allKeys(v, acc = new Set()) {
  if (Array.isArray(v)) v.forEach(x => allKeys(x, acc));
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) { acc.add(k); allKeys(v[k], acc); }
  return acc;
}

async function freshDb(pngPath) {
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
      totp_secret TEXT, totp_enabled INTEGER DEFAULT 0,
      created_at TEXT, updated_at TEXT
    );
  `);
  db.prepare(`INSERT INTO users (id,username,display_name,password_hash,role,is_active)
              VALUES (1,'reader','Reader',@h,'readonly',1)`).run({ h: await pw.hashPassword(READER_PW) });
  db.prepare(`INSERT INTO document_types (id,name,slug) VALUES (1,'Invoice','invoice'),(2,'Purchase Order','purchase_order')`).run();
  // Confirmed doc with SENTINEL path + ocr values that must never leak.
  db.prepare(`INSERT INTO documents
    (id,supplier_name,reference_number,doc_date,document_type_id,status,ocr_text,overall_confidence,
     original_filename,stored_filename,stored_path,folder_path,working_path,confirmed_at,processed_at)
    VALUES (1,'Acme','INV-1','16-03-2026',1,'confirmed','SECRET_OCR',90,
     'orig1.pdf','Invoice.1.pdf','C:/secret/filed.pdf','C:/secret/src', @wp,'2026-03-11','2026-03-11')`).run({ wp: pngPath });
  // Uncommitted doc — must NEVER be returned to the readonly POC.
  db.prepare(`INSERT INTO documents (id,supplier_name,status,document_type_id,confirmed_at,processed_at)
              VALUES (2,'ReviewCo','needs_review',1,'2026-03-12','2026-03-12')`).run();
  db.prepare(`INSERT INTO extractions
    (document_id,field_key,raw_value,display_value,confidence,was_corrected,corrected_to,validation_note,extraction_method)
    VALUES (1,'invoice_number','INV-1_RAW','INV-1',90,0,NULL,NULL,'keyword')`).run();
  return db;
}

function httpReq(port, method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const data = body != null ? JSON.stringify(body) : null;
    const headers = {};
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = http.request(
      { host: '127.0.0.1', port, method, path: urlPath, headers },
      (res) => {
        let out = '';
        res.on('data', d => { out += d; });
        res.on('end', () => { try { resolve({ status: res.statusCode, json: out ? JSON.parse(out) : null }); } catch (e) { reject(e); } });
      });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  let fail = 0;

  // A tiny on-disk "image" so the image-page render path resolves a working copy.
  const pngPath = path.join(os.tmpdir(), `ds_v1_${Date.now()}.png`);
  fs.writeFileSync(pngPath, Buffer.from('not-a-real-png-but-bytes'));

  const db = await freshDb(pngPath);
  const server = api.createServer({
    getDb: () => db,
    learning: { getDigitsOnlyFields: () => [] }, // stub — keeps detail hermetic
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const leaks = (payload) => dto.FORBIDDEN_FIELDS.filter(f => allKeys(payload).has(f));

  // ── health (public) ──────────────────────────────────────────────────────────
  let r = await httpReq(port, 'GET', '/v1/health');
  fail += !check('GET /v1/health -> 200', r.status === 200);
  fail += !check('health advertises contractVersion', r.json && r.json.contractVersion === api.API_CONTRACT_VERSION);

  // ── protected routes need a token ────────────────────────────────────────────
  r = await httpReq(port, 'POST', '/v1/search', {});
  fail += !check('search without token -> 401', r.status === 401);

  // ── log in (readonly) ────────────────────────────────────────────────────────
  r = await httpReq(port, 'POST', '/v1/auth/login', { username: 'reader', password: READER_PW });
  fail += !check('login -> 200 with token + role', r.status === 200 && !!r.json.token && r.json.user.role === 'readonly');
  const token = r.json.token;

  // ── search: shape + projection + no leak ─────────────────────────────────────
  r = await httpReq(port, 'POST', '/v1/search', {}, token);
  fail += !check('POST /v1/search -> 200', r.status === 200);
  fail += !check('search top-level shape { confirmed, uncommitted }',
    r.json && Array.isArray(r.json.confirmed) && Array.isArray(r.json.uncommitted));
  fail += !check('search returns the confirmed doc', r.json.confirmed.length === 1);
  const row = r.json.confirmed[0] || {};
  fail += !check(`search row exposes all essential fields [${dto.SEARCH_ROW_FIELDS.join(', ')}]`,
    dto.SEARCH_ROW_FIELDS.every(k => k in row));
  fail += !check('search row carries type_slug=invoice', row.type_slug === 'invoice');
  fail += !check('search response leaks NO path/ocr fields', leaks(r.json).length === 0);

  // ── readonly shaping: uncommitted never returned, even when requested ─────────
  r = await httpReq(port, 'POST', '/v1/search', { includeUncommitted: true }, token);
  fail += !check('readonly: uncommitted excluded even when requested', r.json.uncommitted.length === 0);
  fail += !check('readonly: confirmed still returned', r.json.confirmed.length === 1);

  // ── detail: projection + extraction projection + no leak ─────────────────────
  r = await httpReq(port, 'GET', '/v1/documents/1', null, token);
  fail += !check('GET /v1/documents/1 -> 200', r.status === 200);
  fail += !check('detail carries supplier_name + resolved type_slug',
    r.json.supplier_name === 'Acme' && r.json.type_slug === 'invoice');
  fail += !check('detail has projected extractions (display_value present)',
    Array.isArray(r.json.extractions) && r.json.extractions.length === 1 && r.json.extractions[0].display_value === 'INV-1');
  fail += !check('detail extraction does NOT leak raw_value',
    !('raw_value' in (r.json.extractions[0] || {})));
  fail += !check('detail response leaks NO path/ocr fields', leaks(r.json).length === 0);

  r = await httpReq(port, 'GET', '/v1/documents/999', null, token);
  fail += !check('GET /v1/documents/999 -> 404', r.status === 404);

  // ── pages: image render returns bytes, not a path ────────────────────────────
  r = await httpReq(port, 'GET', `/v1/documents/1/pages?folderPath=${encodeURIComponent(path.dirname(pngPath))}&filename=${encodeURIComponent(path.basename(pngPath))}`, null, token);
  fail += !check('GET /v1/documents/1/pages -> 200', r.status === 200);
  fail += !check('pages returns one image data-URL (bytes, not a path)',
    Array.isArray(r.json.pages) && r.json.pages.length === 1 && r.json.pages[0].startsWith('data:image/png;base64,'));
  fail += !check('pages response leaks NO path/ocr fields', leaks(r.json).length === 0);

  // id-only pages: a detached client passes NO path; the server resolves it from
  // the document row (working_path). Must render the same image.
  r = await httpReq(port, 'GET', '/v1/documents/1/pages', null, token);
  fail += !check('pages by id alone (server-side path resolution) renders image',
    r.status === 200 && Array.isArray(r.json.pages) && r.json.pages.length === 1
    && r.json.pages[0].startsWith('data:image/png;base64,'));

  // ── unknown route ────────────────────────────────────────────────────────────
  r = await httpReq(port, 'GET', '/v1/nope');
  fail += !check('unknown route -> 404', r.status === 404);

  await new Promise(r2 => server.close(r2));
  db.close();
  try { fs.unlinkSync(pngPath); } catch {}

  console.log(fail ? `\n${fail} check(s) FAILED — /v1 contract changed.` : '\nAll /v1 contract checks passed.');
  return fail ? 1 : 0;
}

main().then(code => process.exit(code)).catch(e => { console.error(e); process.exit(1); });
