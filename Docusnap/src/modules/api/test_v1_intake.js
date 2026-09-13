#!/usr/bin/env node
'use strict';
/**
 * test_v1_intake.js — the /v1 Quick File UPLOAD endpoint (POST /v1/documents/intake) + its doc-types
 * probe (Oracle SIGN-OFF-W/COND 2026-09-13, the first body-bearing WRITE on /v1). Verifies: auth/role/
 * entitlement gating, feature-off 409, the SAFE-subset ext allowlist (415 for .doc/.exe), size caps
 * (413 on Content-Length and on decoded bytes), the happy path files ONE intake='direct' confirmed row
 * with NO learning row, filename sanitised to a basename + the temp minted server-side, and temp cleanup.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/api/test_v1_intake.js
 */
const http = require('http');
const Database = require('better-sqlite3');
const api = require('./handler');
const pw  = require('../auth/password');
const { runMigrations } = require('../../../database/index');
const learning  = require('../../../database/modules/learning');
const licensing = require('../licensing/handler');

const PWD = 'Intake-Test-9';
let fail = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fail++; };
licensing.licenseDenied = () => null;   // test env: no license config → stub open

let entitled = true;
const writes = [];   // temp writeFileSync targets
const unlinks = [];  // temp unlinkSync targets

function seedDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  // A Quick File (reading_mode='none') type.
  db.prepare("INSERT INTO document_types (id, name, slug, built_in, reading_mode) VALUES (1, 'Filed Document', 'filed_document', 0, 'none')").run();
  learning.setSetting(db, 'output_folder', '/out');
  learning.setSetting(db, 'direct_intake_enabled', 'true');
  return db;
}

function request(port, method, path, { token, body, rawBody, headers } = {}) {
  return new Promise((resolve) => {
    const data = rawBody != null ? rawBody : (body != null ? JSON.stringify(body) : null);
    const r = http.request({ host: '127.0.0.1', port, path, method, headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      ...(headers || {}),
    } }, (res) => {
      let buf = ''; res.on('data', c => (buf += c));
      res.on('end', () => { let json = null; try { json = JSON.parse(buf); } catch {} resolve({ status: res.statusCode, json }); });
    });
    r.on('error', () => resolve({ status: 0, json: null }));
    if (data) r.write(data);
    r.end();
  });
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

async function main() {
  const db = seedDb();
  const realFs = require('fs');
  const server = api.createServer({
    getDb: () => db,
    learning,
    checkEntitlement: () => entitled
      ? ({ entitled: true, feature: 'detached_client', search: { entitled: true, seats: 99 }, workflow: { entitled: true, seats: 99 } })
      : ({ entitled: false, feature: 'detached_client', search: { entitled: false }, workflow: { entitled: false } }),
    app: { getPath: () => '/tmp' },
    // Stub the disk-touching collaborators so the test is hermetic; the endpoint + submit run for real.
    fs: { writeFileSync: (p) => { writes.push(p); }, unlinkSync: (p) => { unlinks.push(p); }, existsSync: () => true },
    commitDocument: async () => ({ success: true, filename: 'F.pdf', filePath: '/out/F.pdf', metadataPath: '/out/.metadata/F.xml' }),
    ensureWorkingCopy: () => '/tmp/work.pdf',
    normaliseDate: (s) => s,
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const h = await pw.hashPassword(PWD);
  const ins = db.prepare("INSERT INTO users (id, username, display_name, password_hash, role, is_active) VALUES (?,?,?,?,?,1)");
  ins.run(1, 'admin', 'Admin', h, 'admin');
  ins.run(2, 'reader', 'Reader', h, 'readonly');
  const login = async (u) => (await request(port, 'POST', '/v1/auth/login', { body: { username: u, password: PWD } })).json?.token;
  const adminT = await login('admin'); const readT = await login('reader');

  const ok = { documentTypeId: 1, filename: 'report.pdf', contentBase64: b64('hello pdf'), party: 'Acme', title: 'Report' };

  // ── doc-types probe ─────────────────────────────────────────────────────────────
  const dt = await request(port, 'GET', '/v1/documents/intake/doc-types', { token: adminT });
  check('doc-types → 200, enabled, lists the none-type', dt.status === 200 && dt.json.enabled === true && dt.json.installed.some(t => t.slug === 'filed_document'));

  // ── auth / role / entitlement ────────────────────────────────────────────────────
  check('no token → 401', (await request(port, 'POST', '/v1/documents/intake', { body: ok })).status === 401);
  check('readonly → 403', (await request(port, 'POST', '/v1/documents/intake', { token: readT, body: ok })).status === 403);
  entitled = false;
  check('unentitled → 402', (await request(port, 'POST', '/v1/documents/intake', { token: adminT, body: ok })).status === 402);
  entitled = true;

  // ── SAFE-subset ext allowlist ─────────────────────────────────────────────────────
  check('.exe → 415', (await request(port, 'POST', '/v1/documents/intake', { token: adminT, body: { ...ok, filename: 'x.exe' } })).status === 415);
  check('.doc (macro binary dropped from the upload lane) → 415',
        (await request(port, 'POST', '/v1/documents/intake', { token: adminT, body: { ...ok, filename: 'x.doc' } })).status === 415);
  check('.eml (dropped from the upload lane) → 415',
        (await request(port, 'POST', '/v1/documents/intake', { token: adminT, body: { ...ok, filename: 'x.eml' } })).status === 415);

  // ── size caps ──────────────────────────────────────────────────────────────────────
  learning.setSetting(db, 'direct_intake_max_mb', '1');
  const bigB64 = 'A'.repeat(2 * 1024 * 1024 * 4 / 3 | 0);   // ~2MB decoded, over the 1MB cap
  check('oversize decoded → 413', (await request(port, 'POST', '/v1/documents/intake', { token: adminT, body: { ...ok, contentBase64: bigB64 } })).status === 413);
  // A lying-small Content-Length that streams past the cap → destroyed 413 (belt-b). Send a raw body > cap
  // with a truthful large Content-Length so the pre-check fires.
  const over = JSON.stringify({ ...ok, contentBase64: bigB64 });
  check('oversize Content-Length → 413 (pre-buffer reject)',
        (await request(port, 'POST', '/v1/documents/intake', { token: adminT, rawBody: over })).status === 413);
  learning.setSetting(db, 'direct_intake_max_mb', '50');

  // ── feature-off ────────────────────────────────────────────────────────────────────
  learning.setSetting(db, 'direct_intake_enabled', 'false');
  const off = await request(port, 'POST', '/v1/documents/intake', { token: adminT, body: ok });
  check('feature off → 409 FEATURE_DISABLED', off.status === 409 && off.json.code === 'FEATURE_DISABLED');
  check('doc-types reports enabled:false when off', (await request(port, 'GET', '/v1/documents/intake/doc-types', { token: adminT })).json.enabled === false);
  learning.setSetting(db, 'direct_intake_enabled', 'true');

  // ── happy path — files ONE intake='direct' confirmed row, NO learning row ────────────
  writes.length = 0; unlinks.length = 0;
  const before = db.prepare("SELECT COUNT(*) n FROM documents").get().n;
  const good = await request(port, 'POST', '/v1/documents/intake', { token: adminT, body: { ...ok, filename: '../../evil.pdf' } });
  check('happy path → 200 ok + docId', good.status === 200 && good.json.ok === true && good.json.docId);
  const row = db.prepare("SELECT * FROM documents ORDER BY id DESC LIMIT 1").get();
  check('  → one new document row', db.prepare("SELECT COUNT(*) n FROM documents").get().n === before + 1);
  check('  → status confirmed + intake=direct', row.status === 'confirmed' && row.intake === 'direct');
  check('  → NO learning rows written (Q-C1: intake=direct never learns)',
        db.prepare("SELECT COUNT(*) n FROM corrections").get().n === 0
        && db.prepare("SELECT COUNT(*) n FROM supplier_hints").get().n === 0
        && db.prepare("SELECT COUNT(*) n FROM field_anchors").get().n === 0);
  check('  → temp minted server-side under tmp (client path traversal ignored)',
        writes.length === 1 && /ds_v1intake_/.test(String(writes[0])) && !String(writes[0]).includes('evil'));
  check('  → temp cleaned up (unlinkSync called)', unlinks.length >= 1);

  server.close();
  console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
