#!/usr/bin/env node
'use strict';

/**
 * src/modules/api/test_v1_workflow.js
 * Stage 5a workflow over the REAL /v1 API, driven through the REAL client
 * transport (client/apiClient.js). Verifies the full mailbox vertical end-to-end
 * with auth + roles: assign, inbox, acknowledge, claim+approve, reject, and the
 * role denials (readonly can't assign / can't approve / can't list recipients).
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/api/test_v1_workflow.js
 */

const Database = require('better-sqlite3');
const api = require('./handler');
const pw  = require('../auth/password');
const { createClient } = require('../../../client/apiClient');

const PWD = 'Workflow-Test-9';
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
      working_path TEXT, workflow_status TEXT, confirmed_at TEXT, processed_at TEXT
    );
    CREATE TABLE extractions (id INTEGER PRIMARY KEY, document_id INTEGER, field_key TEXT, raw_value TEXT,
      display_value TEXT, confidence INTEGER, was_corrected INTEGER, corrected_to TEXT, validation_note TEXT, extraction_method TEXT);
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, display_name TEXT, password_hash TEXT,
      role TEXT, is_active INTEGER DEFAULT 1, must_change_password INTEGER DEFAULT 0,
      totp_secret TEXT, totp_enabled INTEGER DEFAULT 0, last_login_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE document_routes (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, from_user_id INTEGER,
      from_username TEXT, to_user_id INTEGER, to_username TEXT, action_required TEXT, state TEXT DEFAULT 'pending',
      comment TEXT, resolution_comment TEXT, claimed_by_id INTEGER, claimed_by_username TEXT, claimed_at TEXT,
      resolved_at TEXT, version INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')));
  `);
  db.prepare(`INSERT INTO document_types (id,name,slug) VALUES (1,'Invoice','invoice')`).run();
  db.prepare(`INSERT INTO documents (id,supplier_name,document_type_id,status,confirmed_at,processed_at)
              VALUES (1,'Acme',1,'confirmed','2026-03-11','2026-03-11'),
                     (2,'ReviewCo',1,'needs_review','2026-03-12','2026-03-12')`).run();
  const h = await pw.hashPassword(PWD);
  const ins = db.prepare(`INSERT INTO users (id,username,display_name,password_hash,role,is_active) VALUES (?,?,?,?,?,1)`);
  ins.run(1, 'admin', 'Admin', h, 'admin');
  ins.run(2, 'editor', 'Editor', h, 'edit');
  ins.run(3, 'reader', 'Reader', h, 'readonly');
  return db;
}

async function mkClient(baseUrl, username) {
  const c = createClient({ baseUrl });
  await c.connect();
  const li = await c.login(username, PWD);
  if (!li.ok) throw new Error(`login failed for ${username}`);
  return c;
}

async function main() {
  const db = await freshDb();
  const server = api.createServer({ getDb: () => db, learning: { getDigitsOnlyFields: () => [] }, checkEntitlement: () => ({ entitled: true, feature: 'detached_client' }) });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const adminC  = await mkClient(baseUrl, 'admin');
  const editorC = await mkClient(baseUrl, 'editor');
  const readerC = await mkClient(baseUrl, 'reader');

  // ── recipients (admin/edit only) ─────────────────────────────────────────────
  let r = await adminC.workflow.recipients();
  check('admin lists recipients -> 200', r.status === 200 && Array.isArray(r.json.recipients));
  const readerId = (r.json.recipients.find(u => u.username === 'reader') || {}).id;
  const editorId = (r.json.recipients.find(u => u.username === 'editor') || {}).id;
  check('found recipient ids', !!readerId && !!editorId);
  r = await readerC.workflow.recipients();
  check('readonly cannot list recipients -> 403', r.status === 403);

  // ── readonly cannot assign ───────────────────────────────────────────────────
  r = await readerC.workflow.assign(1, editorId, 'approve');
  check('readonly assign -> 403', r.status === 403);

  // ── acknowledge flow ─────────────────────────────────────────────────────────
  r = await adminC.workflow.assign(1, readerId, 'acknowledge', 'please read');
  check('admin assigns acknowledge -> 200 pending', r.status === 200 && r.json.route.state === 'pending');
  r = await readerC.workflow.list('inbox');
  check('reader inbox shows the route', r.status === 200 && r.json.routes.length === 1);
  const ackRoute = r.json.routes[0];
  r = await readerC.workflow.resolve(ackRoute.id, 'acknowledge', null, ackRoute.version);
  check('reader acknowledges -> 200 acknowledged', r.status === 200 && r.json.route.state === 'acknowledged');

  // ── approve flow (claim then approve) ────────────────────────────────────────
  r = await adminC.workflow.assign(1, editorId, 'approve');
  const apRoute = r.json.route;
  r = await editorC.workflow.claim(apRoute.id, apRoute.version);
  check('editor claims -> 200 claimed', r.status === 200 && r.json.route.state === 'claimed');
  const claimedV = r.json.route.version;
  r = await editorC.workflow.resolve(apRoute.id, 'approve', null, claimedV);
  check('editor approves -> 200 approved', r.status === 200 && r.json.route.state === 'approved');

  // ── reject requires a reason ─────────────────────────────────────────────────
  r = await adminC.workflow.assign(1, editorId, 'approve');
  const rjRoute = r.json.route;
  r = await editorC.workflow.resolve(rjRoute.id, 'reject', null, rjRoute.version);
  check('reject without reason -> 400', r.status === 400);
  r = await editorC.workflow.resolve(rjRoute.id, 'reject', 'totals wrong', rjRoute.version);
  check('reject with reason -> 200 rejected', r.status === 200 && r.json.route.state === 'rejected');

  // ── readonly recipient cannot approve ────────────────────────────────────────
  r = await adminC.workflow.assign(1, readerId, 'approve');
  const roRoute = r.json.route;
  r = await readerC.workflow.resolve(roRoute.id, 'approve', null, roRoute.version);
  check('readonly recipient approve -> 403', r.status === 403);
  r = await adminC.workflow.recall(roRoute.id, roRoute.version);
  check('sender recalls pending -> 200 recalled', r.status === 200 && r.json.route.state === 'recalled');

  // ── 5b: uncommitted (needs_review) documents are routable ────────────────────
  r = await adminC.workflow.assign(2, editorId, 'approve', 'check this review item');
  check('admin can route an uncommitted (needs_review) doc -> 200', r.status === 200 && r.json.route.state === 'pending');

  // ── filing state never rewritten by workflow ─────────────────────────────────
  r = await adminC.getDocument(1);
  check('document filing status still "confirmed" after approve/reject', r.json.status === 'confirmed');

  await new Promise(r2 => server.close(r2));
  db.close();
  console.log(fail ? `\n${fail} check(s) FAILED — /v1 workflow changed.` : '\nAll /v1 workflow checks passed.');
  return fail ? 1 : 0;
}

main().then(c => process.exit(c)).catch(e => { console.error(e); process.exit(1); });
