#!/usr/bin/env node
'use strict';
// /v1 API SECURITY & ROBUSTNESS suite (hermetic, real server). Probes:
//   • auth: missing / garbage / tampered token, deactivated-user token
//   • per-endpoint role gating (readonly can read/search, cannot write)
//   • F-02 path traversal on confirm (body paths ignored; source resolved server-side)
//   • SQL-injection probes on search (parameterised → no error, table intact)
//   • malformed / wrong-type bodies → 400; unknown route / wrong method → 404
//   • entitlement gate (402); non-numeric / non-existent id; presence gating
// Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/api/test_v1_security.js

const http = require('http');
const Database = require('better-sqlite3');
const api = require('./handler');
const pw  = require('../auth/password');
const { runMigrations } = require('../../../database/index');
const documents = require('../../../database/modules/documents');
const learning  = require('../../../database/modules/learning');
const reviewServiceMod = require('../../services/reviewService');
const presenceMod = require('../../services/presenceService');
const sessionService = require('../../services/sessionService');
const licensing = require('../licensing/handler');

const PWD = 'Sec-Test-9';
let fail = 0;
const check = (l, c, extra) => { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}${extra ? '  ' + extra : ''}`); if (!c) fail++; };

const _origDenied = licensing.licenseDenied; licensing.licenseDenied = () => null;
let entitled = true, lastCommitArgs = null;

function seedDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  db.prepare("INSERT INTO document_types (id, name, slug, built_in) VALUES (1,'Invoice','invoice',1)").run();
  learning.setSetting(db, 'output_folder', '/out');
  db.prepare("INSERT INTO documents (id, original_filename, folder_path, document_type_id, status, supplier_name) VALUES (1,'scan.pdf','/in',1,'needs_review','Acme')").run();
  // a couple of confirmed docs so search has something to match / injection can target
  db.prepare("INSERT INTO documents (id, original_filename, folder_path, document_type_id, status, supplier_name, reference_number) VALUES (2,'a.pdf','/in',1,'confirmed','Acme Ltd','INV-1')").run();
  db.prepare("INSERT INTO documents (id, original_filename, folder_path, document_type_id, status, supplier_name, reference_number) VALUES (3,'b.pdf','/in',1,'confirmed','Beta Co','INV-2')").run();
  return db;
}
function request(port, method, path, { token, body, raw } = {}) {
  return new Promise((resolve) => {
    const data = raw != null ? raw : (body != null ? JSON.stringify(body) : null);
    const r = http.request({ host: '127.0.0.1', port, path, method, headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
    } }, (res) => { let b = ''; res.on('data', c => (b += c)); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode, json: j }); }); });
    r.on('error', () => resolve({ status: 0, json: null }));
    if (data) r.write(data); r.end();
  });
}

async function main() {
  const db = seedDb();
  const reviewService = reviewServiceMod.createReviewService({
    documents, learning, doctypes: require('../../../database/modules/document_types'),
    filing: { commitDocument: async (args) => { lastCommitArgs = args; return { success: true, filename: 'F.pdf', filePath: '/out/F.pdf', srcPath: '/in/scan.pdf' }; }, removeSourceFile: async () => {} },
    fs: { existsSync: () => false, unlinkSync: () => {} }, path: require('path'),
    audit: () => {}, notifyCounts: () => {}, releaseDelayMs: 0,
  });
  const sessionStore = sessionService.createSessionStore();   // explicit, isolated store for this test
  const server = api.createServer({
    getDb: () => db, learning: { getDigitsOnlyFields: () => [] }, reviewService, sessionStore,
    presence: presenceMod.createPresenceService(),
    checkEntitlement: () => entitled
      ? ({ entitled: true, feature: 'detached_client', search: { entitled: true, seats: 99 }, workflow: { entitled: true, seats: 99 } })
      : ({ entitled: false, feature: 'detached_client', search: { entitled: false }, workflow: { entitled: false } }),
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const h = await pw.hashPassword(PWD);
  const insU = db.prepare("INSERT INTO users (id, username, display_name, password_hash, role, is_active) VALUES (?,?,?,?,?,?)");
  insU.run(1, 'admin', 'Admin', h, 'admin', 1);
  insU.run(2, 'editor', 'Editor', h, 'edit', 1);
  insU.run(3, 'reader', 'Reader', h, 'readonly', 1);
  insU.run(4, 'ghost', 'Ghost', h, 'edit', 1);
  const login = async (u) => (await request(port, 'POST', '/v1/auth/login', { body: { username: u, password: PWD } })).json?.token;
  const adminT = await login('admin'), editT = await login('editor'), readT = await login('reader'), ghostT = await login('ghost');

  // ── AUTH ──────────────────────────────────────────────────────────────────
  check('no token → 401', (await request(port, 'GET', '/v1/review/queue')).status === 401);
  check('garbage token → 401', (await request(port, 'GET', '/v1/review/queue', { token: 'not.a.real.token' })).status === 401);
  const tampered = editT.slice(0, -3) + (editT.slice(-3) === 'aaa' ? 'bbb' : 'aaa');
  check('tampered token → 401', (await request(port, 'GET', '/v1/review/queue', { token: tampered })).status === 401);
  check('valid editor token → 200', (await request(port, 'GET', '/v1/review/queue', { token: editT })).status === 200);
  // Deactivating a user must cut their live /v1 access at once. In production the admin
  // auth-set-user-active handler calls sessions.revokeUser(userId) (FIXED 2026-07-02); here we
  // simulate exactly that against the same store the server verifies against, then assert the
  // stale token is rejected — and that OTHER users' sessions are untouched (revoke is scoped).
  check('ghost\'s token works before deactivation', (await request(port, 'GET', '/v1/review/queue', { token: ghostT })).status === 200);
  db.prepare("UPDATE users SET is_active = 0 WHERE username = 'ghost'").run();
  sessionStore.revokeUser(4);   // what auth-set-user-active now does
  const ghostAfter = await request(port, 'GET', '/v1/review/queue', { token: ghostT });
  check('deactivated user\'s live /v1 token is now rejected (401)', ghostAfter.status === 401, `(got ${ghostAfter.status})`);
  check('other users\' sessions survive the scoped revoke', (await request(port, 'GET', '/v1/review/queue', { token: editT })).status === 200);

  // ── ROLE GATING ─────────────────────────────────────────────────────────────
  check('readonly GET /review/queue → 403', (await request(port, 'GET', '/v1/review/queue', { token: readT })).status === 403);
  check('readonly POST /confirm → 403', (await request(port, 'POST', '/v1/documents/1/confirm', { token: readT, body: { allValues: {}, corrections: {} } })).status === 403);
  check('readonly POST /defer → 403', (await request(port, 'POST', '/v1/documents/1/defer', { token: readT })).status === 403);
  check('readonly CAN POST /search (view role) → 200', (await request(port, 'POST', '/v1/search', { token: readT, body: {} })).status === 200);
  check('editor CAN confirm → 200', (await request(port, 'POST', '/v1/documents/1/confirm', { token: editT, body: { document_type_slug: 'invoice', allValues: { supplier_name: 'Acme' }, corrections: {} } })).status === 200);

  // ── F-02 path traversal on confirm ───────────────────────────────────────────
  db.prepare("UPDATE documents SET status='needs_review', confirmed_by_username=NULL WHERE id=1").run();
  lastCommitArgs = null;
  const f02 = await request(port, 'POST', '/v1/documents/1/confirm', { token: editT, body: {
    folder_path: '/evil/../../etc/passwd', original_filename: '../../secret.pdf',
    document_type_slug: 'invoice', allValues: { supplier_name: 'Acme' }, corrections: {} } });
  check('F-02: confirm ignores body paths; source resolved from the doc row (/in)', f02.status === 200 && lastCommitArgs && lastCommitArgs.folderPath === '/in');
  check('F-02: confirm DTO carries no server paths', f02.json && !('filePath' in f02.json) && !('srcPath' in f02.json));

  // ── SQL INJECTION on search ───────────────────────────────────────────────────
  const before = db.prepare('SELECT COUNT(*) c FROM documents').get().c;
  for (const payload of ["'; DROP TABLE documents; --", "' OR '1'='1", "1); DELETE FROM documents; --", "\" OR \"\"=\""]) {
    const r = await request(port, 'POST', '/v1/search', { token: editT, body: { company: payload, reference: payload, fullText: payload } });
    check(`injection ${JSON.stringify(payload).slice(0, 28)}… → 200, no crash`, r.status === 200 && r.json && Array.isArray(r.json.confirmed));
  }
  const tableThere = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='documents'").get();
  const after = db.prepare('SELECT COUNT(*) c FROM documents').get().c;
  check('documents table intact after injection probes', tableThere);
  check('no rows deleted/altered by injection', after === before, `(${before}→${after})`);

  // ── MALFORMED / WRONG-TYPE BODIES ─────────────────────────────────────────────
  check('confirm with non-object allValues → 400', (await request(port, 'POST', '/v1/documents/1/confirm', { token: editT, body: { allValues: 'nope', corrections: {} } })).status === 400);
  check('confirm with non-object corrections → 400', (await request(port, 'POST', '/v1/documents/1/confirm', { token: editT, body: { allValues: {}, corrections: 'nope' } })).status === 400);
  check('search with non-JSON body → 400', (await request(port, 'POST', '/v1/search', { token: editT, raw: '{bad json' })).status === 400);

  // ── ROUTE / METHOD / ID VALIDATION ────────────────────────────────────────────
  check('unknown route → 404', (await request(port, 'GET', '/v1/does-not-exist', { token: editT })).status === 404);
  check('wrong method (GET on confirm) → 404', (await request(port, 'GET', '/v1/documents/1/confirm', { token: editT })).status === 404);
  check('non-numeric id (/documents/abc/confirm) → 404', (await request(port, 'POST', '/v1/documents/abc/confirm', { token: editT, body: { allValues: {}, corrections: {} } })).status === 404);
  check('confirm on a non-existent id → 404', (await request(port, 'POST', '/v1/documents/999999/confirm', { token: editT, body: { document_type_slug: 'invoice', allValues: {}, corrections: {} } })).status === 404);

  // ── ENTITLEMENT GATE ──────────────────────────────────────────────────────────
  entitled = false;
  check('unentitled feature route → 402', (await request(port, 'GET', '/v1/review/queue', { token: editT })).status === 402);
  check('unentitled search → 402', (await request(port, 'POST', '/v1/search', { token: editT, body: {} })).status === 402);
  entitled = true;

  // ── PRESENCE gating ─────────────────────────────────────────────────────────
  check('readonly viewing (presence) → 403', (await request(port, 'POST', '/v1/review/1/viewing', { token: readT })).status === 403);

  // ── HEALTH is public ─────────────────────────────────────────────────────────
  const health = await request(port, 'GET', '/v1/health');
  check('GET /health is reachable without a token', health.status === 200);

  await new Promise(r => server.close(r));
  licensing.licenseDenied = _origDenied;
  console.log(`\n${fail === 0 ? 'ALL PASS — /v1 security probes held.' : fail + ' FAILED'}`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); licensing.licenseDenied = _origDenied; process.exit(1); });
