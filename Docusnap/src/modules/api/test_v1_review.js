#!/usr/bin/env node
'use strict';

/**
 * src/modules/api/test_v1_review.js
 * Phase 3: the /v1 REVIEW endpoints (queue / deferred / counts / doc-types / confirm / defer /
 * undefer) over the REAL server. Verifies: role gating (readonly forbidden), the feature
 * entitlement gate (402), the path-free queue DTO, the confirm DTO (filename, NEVER filePath),
 * F-02 (a body folder_path is IGNORED — the source is resolved from the doc row), a lost-race
 * 409 ALREADY_FILED, the workflow lock (409), and the defer/undefer CAS.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/api/test_v1_review.js
 */

const http = require('http');
const Database = require('better-sqlite3');
const api = require('./handler');
const pw  = require('../auth/password');
const { runMigrations } = require('../../../database/index');
const documents = require('../../../database/modules/documents');
const learning  = require('../../../database/modules/learning');
const reviewServiceMod = require('../../services/reviewService');
const presenceMod = require('../../services/presenceService');
const licensing = require('../licensing/handler');

const PWD = 'Review-Test-9';
let fail = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fail++; };

// licenseDenied fails CLOSED with no license config (test env) — stub it open for this run.
const _origLicenseDenied = licensing.licenseDenied;
licensing.licenseDenied = () => null;

let entitled = true;   // toggled for the 402 test
let lastCommitArgs = null;

function seedDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  db.prepare("INSERT INTO document_types (id, name, slug, built_in) VALUES (1, 'Invoice', 'invoice', 1)").run();
  learning.setSetting(db, 'output_folder', '/out');
  const mkDoc = (id, status) => db.prepare(
    "INSERT INTO documents (id, original_filename, folder_path, document_type_id, status) VALUES (?, 'scan.pdf', '/in', 1, ?)"
  ).run(id, status);
  mkDoc(1, 'needs_review');   // confirm happy-path + F-02
  mkDoc(2, 'needs_review');   // → set to a mid-claim state for ALREADY_FILED
  mkDoc(3, 'needs_review');   // workflow-locked
  mkDoc(4, 'needs_review');   // defer / undefer
  return db;
}

function request(port, method, path, { token, body } = {}) {
  return new Promise((resolve) => {
    const data = body != null ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port, path, method, headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
    } }, (res) => {
      let buf = ''; res.on('data', c => (buf += c));
      res.on('end', () => { let json = null; try { json = JSON.parse(buf); } catch {} resolve({ status: res.statusCode, json }); });
    });
    r.on('error', () => resolve({ status: 0, json: null }));
    if (data) r.write(data);
    r.end();
  });
}

async function main() {
  const db = seedDb();

  // The real reviewService with a STUBBED filing (no disk) — the endpoint still does its own
  // F-02 path resolution, slug validation, editGuard and license check against the real db.
  const reviewService = reviewServiceMod.createReviewService({
    documents, learning,
    doctypes: require('../../../database/modules/document_types'),
    filing: { commitDocument: async (args) => { lastCommitArgs = args; return { success: true, filename: 'F.pdf', filePath: '/out/F.pdf', metadataPath: '/out/.metadata/F.xml', srcPath: '/in/scan.pdf' }; },
              removeSourceFile: async () => {} },
    fs: { existsSync: () => false, unlinkSync: () => {} },
    path: require('path'), logger: null,
    audit: () => {}, notifyCounts: () => {}, releaseDelayMs: 0,
  });

  const server = api.createServer({
    getDb: () => db,
    learning: { getDigitsOnlyFields: () => [] },
    reviewService,
    presence: presenceMod.createPresenceService(),   // fresh, isolated from the shared singleton
    checkEntitlement: () => entitled
      ? ({ entitled: true, feature: 'detached_client', search: { entitled: true, seats: 99 }, workflow: { entitled: true, seats: 99 } })
      : ({ entitled: false, feature: 'detached_client', search: { entitled: false }, workflow: { entitled: false } }),
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const h = await pw.hashPassword(PWD);
  const ins = db.prepare("INSERT INTO users (id, username, display_name, password_hash, role, is_active) VALUES (?,?,?,?,?,1)");
  ins.run(1, 'admin', 'Admin', h, 'admin');
  ins.run(2, 'editor', 'Editor', h, 'edit');
  ins.run(3, 'reader', 'Reader', h, 'readonly');
  const login = async (u) => (await request(port, 'POST', '/v1/auth/login', { body: { username: u, password: PWD } })).json?.token;
  const adminT = await login('admin'); const editT = await login('editor'); const readT = await login('reader');

  // ── Queue: role-gated + path-free ─────────────────────────────────────────────
  const q = await request(port, 'GET', '/v1/review/queue', { token: editT });
  check('editor GET /review/queue → 200', q.status === 200);
  check('  → returns the needs_review docs', Array.isArray(q.json.queue) && q.json.queue.length === 4);
  check('  → DTO is path-free (no folder_path/stored_path)', q.json.queue.every(r => !('folder_path' in r) && !('stored_path' in r) && !('working_path' in r)));

  check('readonly GET /review/queue → 403', (await request(port, 'GET', '/v1/review/queue', { token: readT })).status === 403);
  check('no token → 401', (await request(port, 'GET', '/v1/review/queue', {})).status === 401);

  // ── Entitlement gate (402) ────────────────────────────────────────────────────
  entitled = false;
  check('unentitled → 402', (await request(port, 'GET', '/v1/review/queue', { token: editT })).status === 402);
  entitled = true;

  // ── doc-types ─────────────────────────────────────────────────────────────────
  const dt = await request(port, 'GET', '/v1/doc-types', { token: editT });
  check('GET /doc-types → 200 with the invoice type', dt.status === 200 && dt.json.types.some(t => t.slug === 'invoice'));

  // ── Confirm: F-02 + DTO ───────────────────────────────────────────────────────
  const c1 = await request(port, 'POST', '/v1/documents/1/confirm', { token: editT, body: {
    folder_path: '/evil/etc/passwd',   // F-02: MUST be ignored
    document_type_slug: 'invoice', supplier_name: 'Acme',
    allValues: { supplier_name: 'Acme', invoice_number: 'INV-1' },
    corrections: {},
  } });
  check('confirm → 200', c1.status === 200 && c1.json.success === true);
  check('  → DTO has filename', c1.json.filename === 'F.pdf');
  check('  → DTO has NO server paths', !('filePath' in c1.json) && !('srcPath' in c1.json) && !('metadataPath' in c1.json));
  check('  → F-02: filing used the DOC ROW folder (/in), NOT the body path', lastCommitArgs && lastCommitArgs.folderPath === '/in');
  check('  → doc 1 now confirmed by the editor', db.prepare('SELECT status, confirmed_by_username FROM documents WHERE id=1').get().confirmed_by_username === 'editor');

  // ── readonly cannot confirm ───────────────────────────────────────────────────
  check('readonly confirm → 403', (await request(port, 'POST', '/v1/documents/4/confirm', { token: readT, body: { document_type_slug: 'invoice', allValues: {}, corrections: {} } })).status === 403);

  // ── ALREADY_FILED (lost race): doc claimed (confirmed, no stored) by admin ─────
  db.prepare("UPDATE documents SET status='confirmed', confirmed_by_username='admin' WHERE id=2").run();
  const c2 = await request(port, 'POST', '/v1/documents/2/confirm', { token: editT, body: { document_type_slug: 'invoice', allValues: {}, corrections: {} } });
  check('lost race → 409', c2.status === 409 && c2.json.code === 'ALREADY_FILED');
  check('  → names the winner (admin)', c2.json.confirmedBy === 'admin');

  // ── Workflow lock: a pending route blocks a non-admin confirm ─────────────────
  db.prepare(`INSERT INTO document_routes (document_id, from_user_id, from_username, to_user_id, to_username, action_required, state)
              VALUES (3, 1, 'admin', 2, 'editor', 'approve', 'pending')`).run();
  const c3 = await request(port, 'POST', '/v1/documents/3/confirm', { token: editT, body: { document_type_slug: 'invoice', allValues: {}, corrections: {} } });
  check('workflow-locked confirm → 409 WORKFLOW_LOCKED', c3.status === 409 && c3.json.code === 'WORKFLOW_LOCKED');

  // ── Defer / undefer CAS ───────────────────────────────────────────────────────
  check('defer doc 4 → 200', (await request(port, 'POST', '/v1/documents/4/defer', { token: editT })).status === 200);
  check('  → status deferred', db.prepare('SELECT status FROM documents WHERE id=4').get().status === 'deferred');
  check('defer again → 409 (no longer reviewable)', (await request(port, 'POST', '/v1/documents/4/defer', { token: editT })).status === 409);
  check('undefer doc 4 → 200', (await request(port, 'POST', '/v1/documents/4/undefer', { token: editT })).status === 200);
  check('  → back to needs_review', db.prepare('SELECT status FROM documents WHERE id=4').get().status === 'needs_review');

  // ── Invalid body shape rejected ───────────────────────────────────────────────
  check('non-object allValues → 400', (await request(port, 'POST', '/v1/documents/4/confirm', { token: editT, body: { allValues: 'nope', corrections: {} } })).status === 400);

  // ── Presence ("being reviewed by") — doc 4 is needs_review ────────────────────
  const vE = await request(port, 'POST', '/v1/review/4/viewing', { token: editT });
  check('editor viewing doc 4 → 200, no other viewers yet', vE.status === 200 && vE.json.viewers.length === 0);
  const vA = await request(port, 'POST', '/v1/review/4/viewing', { token: adminT });
  check('admin viewing doc 4 → sees the editor', vA.json.viewers.length === 1 && vA.json.viewers[0].username === 'editor');
  const ql = await request(port, 'GET', '/v1/review/queue', { token: editT });
  const doc4 = ql.json.queue.find(r => r.id === 4);
  check('queue embeds viewers (editor sees admin on doc 4)', !!doc4 && Array.isArray(doc4.viewers) && doc4.viewers.some(v => v.username === 'admin'));
  check('  → caller excluded from its own doc-4 viewers', doc4.viewers.every(v => v.username !== 'editor'));
  await request(port, 'POST', '/v1/review/4/release', { token: editT });
  const vA2 = await request(port, 'POST', '/v1/review/4/viewing', { token: adminT });
  check('after editor releases, admin sees no other viewers', vA2.json.viewers.length === 0);
  check('readonly viewing → 403', (await request(port, 'POST', '/v1/review/4/viewing', { token: readT })).status === 403);

  await new Promise(r => server.close(r));
  licensing.licenseDenied = _origLicenseDenied;   // restore (test isolation)
  console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); licensing.licenseDenied = _origLicenseDenied; process.exit(1); });
