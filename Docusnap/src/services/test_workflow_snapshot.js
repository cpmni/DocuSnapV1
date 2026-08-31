#!/usr/bin/env node
'use strict';

/**
 * src/services/test_workflow_snapshot.js
 * --------------------------------------
 * Service-level gate for the Workflow Slice-2 decision snapshot (workflowService.resolve writing an
 * append-only route_decisions row). Kept SEPARATE from test_workflow.js so the large existing battery
 * is untouched (that suite also proves OFF-byte-identical by running with the flag unset).
 *
 * Pins (gary + Oracle C1/C5):
 *   OFF ⇒ zero snapshot rows (byte-identical) + documents.status untouched
 *   ON  ⇒ exactly one row per approve/reject/acknowledge, correct content, documents.status untouched
 *   CAS loser writes NOTHING (proves the write sits AFTER the version guard)
 *   a THROWING recorder never fails the resolve (best-effort, via the deps.dbWorkflow seam)
 *   reprocess-AFTER-decision preserves the £ (append-only); a mid-flight change BEFORE = resolve-instant
 *   C1: a total-less doc (acknowledge / no total field) still snapshots, with a NULL total
 *   the env flag is read at CALL TIME (togglable on one long-lived service instance)
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/services/test_workflow_snapshot.js
 */

const Database = require('better-sqlite3');
const { createWorkflowService } = require('./workflowService');
const wf = require('../../database/modules/workflow');

let fail = 0;
const check = (label, cond, extra) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? `  [${extra}]` : ''}`); if (!cond) fail++; };

const admin  = { userId: 1, username: 'admin',  role: 'admin' };
const editor = { userId: 2, username: 'editor', role: 'edit' };
const reader = { userId: 3, username: 'reader', role: 'readonly' };

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE document_types (id INTEGER PRIMARY KEY, name TEXT, slug TEXT);
    CREATE TABLE documents (
      id INTEGER PRIMARY KEY, status TEXT, document_type_id INTEGER, workflow_status TEXT,
      supplier_name TEXT, reference_number TEXT, doc_date TEXT, overall_confidence INTEGER
    );
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, display_name TEXT, role TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE document_routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, from_user_id INTEGER, from_username TEXT,
      to_user_id INTEGER, to_username TEXT, action_required TEXT, state TEXT DEFAULT 'pending',
      comment TEXT, resolution_comment TEXT, claimed_by_id INTEGER, claimed_by_username TEXT,
      claimed_at TEXT, resolved_at TEXT, stamped_path TEXT, matched_rule_summary TEXT, version INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE extractions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT,
      raw_value TEXT, display_value TEXT, confidence INTEGER, extraction_method TEXT
    );
    CREATE TABLE route_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, route_id INTEGER, document_id INTEGER,
      actor_user_id INTEGER, actor_username TEXT, decision TEXT, comment TEXT,
      snapshot_json TEXT, snapshot_total_amount TEXT, chain_position INTEGER NOT NULL DEFAULT 1,
      on_behalf_of_user_id INTEGER, on_behalf_of_username TEXT, decided_at TEXT
    );
    CREATE TRIGGER route_decisions_noupd BEFORE UPDATE ON route_decisions BEGIN SELECT RAISE(ABORT,'append-only'); END;
    CREATE TRIGGER route_decisions_nodel BEFORE DELETE ON route_decisions BEGIN SELECT RAISE(ABORT,'append-only'); END;
  `);
  db.prepare("INSERT INTO document_types (id,name,slug) VALUES (1,'Invoice','invoice')").run();
  // doc 1 = a normal invoice WITH a total; doc 2 = a total-less doc (C1)
  db.prepare("INSERT INTO documents (id,status,document_type_id,supplier_name,reference_number,doc_date,overall_confidence) VALUES (1,'confirmed',1,'Acme Ltd','INV-77','2026-07-01',96)").run();
  db.prepare("INSERT INTO documents (id,status,document_type_id,supplier_name,overall_confidence) VALUES (2,'confirmed',1,'NoTotal Ltd',88)").run();
  db.prepare("INSERT INTO extractions (document_id,field_key,display_value,confidence,extraction_method) VALUES (1,'total_amount','£1,046.16',95,'keyword')").run();
  const u = db.prepare("INSERT INTO users (id,username,display_name,role,is_active) VALUES (?,?,?,?,1)");
  u.run(1, 'admin', 'Admin', 'admin'); u.run(2, 'editor', 'Editor', 'edit'); u.run(3, 'reader', 'Reader', 'readonly');
  return db;
}
// canStamp stubbed true: this suite pins the decision SNAPSHOT, not the 2026-08-28 stamping gate
// (that lives in test_stamp_workflow_gate.js). Without the stub, assign-for-approval now refuses a
// non-stamper recipient (RECIPIENT_CANNOT_STAMP) and a.route is undefined before any snapshot runs.
const svc = (extra) => createWorkflowService({ audit: () => {}, stampDecision: () => Promise.resolve(null), canStamp: () => true, ...(extra || {}) });
const docStatus = (db, id) => db.prepare('SELECT status FROM documents WHERE id=?').get(id).status;

console.log('§1 OFF ⇒ no snapshot (byte-identical) + documents.status untouched');
{
  delete process.env.WORKFLOW_DECISION_SNAPSHOT;
  const db = freshDb(); const s = svc();
  const a = s.assign(db, admin, { documentId: 1, toUserId: 2, actionRequired: 'approve' });
  const r = s.resolve(db, editor, a.route.id, { decision: 'approve' });
  check('resolve ok (OFF)', r.ok && r.route.state === 'approved');
  check('OFF ⇒ zero route_decisions rows', wf.listRouteDecisions(db, 1).length === 0);
  check('documents.status untouched (OFF)', docStatus(db, 1) === 'confirmed');
}

console.log('§2 ON ⇒ exactly one snapshot, correct content, filing state untouched');
{
  process.env.WORKFLOW_DECISION_SNAPSHOT = '1';
  const db = freshDb(); const s = svc();
  const a = s.assign(db, admin, { documentId: 1, toUserId: 2, actionRequired: 'approve' });
  const r = s.resolve(db, editor, a.route.id, { decision: 'approve' });
  check('resolve ok (ON)', r.ok);
  const rows = wf.listRouteDecisions(db, 1);
  check('ON ⇒ exactly one snapshot row', rows.length === 1);
  check('decision = approved', rows.length === 1 && rows[0].decision === 'approved');
  check('snapshot_total_amount = the extracted total', rows.length === 1 && rows[0].snapshot_total_amount === '£1,046.16');
  check('actor recorded', rows.length === 1 && rows[0].actor_username === 'editor' && rows[0].actor_user_id === 2);
  check('chain_position=1, on_behalf_of=NULL (Slice-4/5 placeholders)', rows.length === 1 && rows[0].chain_position === 1 && rows[0].on_behalf_of_user_id === null);
  const snap = rows.length === 1 ? JSON.parse(rows[0].snapshot_json) : {};
  check('snapshot_json captured supplier/ref/date/confidence/state',
    snap.supplier_name === 'Acme Ltd' && snap.reference_number === 'INV-77' && snap.doc_date === '2026-07-01'
    && snap.overall_confidence === 96 && snap.resulting_state === 'approved');
  check('documents.status untouched (ON — snapshot does not disturb filing)', docStatus(db, 1) === 'confirmed');
}

console.log('§3 reject + acknowledge each snapshot once (acknowledge = the readonly branch)');
{
  process.env.WORKFLOW_DECISION_SNAPSHOT = '1';
  const db = freshDb(); const s = svc();
  const ar = s.assign(db, admin, { documentId: 1, toUserId: 2, actionRequired: 'approve' });
  s.resolve(db, editor, ar.route.id, { decision: 'reject', comment: 'wrong PO' });
  const rej = wf.listRouteDecisions(db, 1);
  check('reject ⇒ one row, decision=rejected, comment stored', rej.length === 1 && rej[0].decision === 'rejected' && rej[0].comment === 'wrong PO');

  const aa = s.assign(db, admin, { documentId: 2, toUserId: 3, actionRequired: 'acknowledge' });
  const r = s.resolve(db, reader, aa.route.id, { decision: 'acknowledge' });
  const ack = wf.listRouteDecisions(db, 2);
  check('acknowledge (readonly) resolve ok', r.ok);
  check('acknowledge ⇒ one row, decision=acknowledged', ack.length === 1 && ack[0].decision === 'acknowledged');
}

console.log('§4 CAS loser writes NOTHING (proves the write sits after the version guard)');
{
  process.env.WORKFLOW_DECISION_SNAPSHOT = '1';
  const db = freshDb(); const s = svc();
  const a = s.assign(db, admin, { documentId: 1, toUserId: 2, actionRequired: 'approve' });
  // route is pending; a stale/wrong expectedVersion makes updateState's CAS fail → CONFLICT before the snapshot.
  const r = s.resolve(db, editor, a.route.id, { decision: 'approve', expectedVersion: 999 });
  check('stale version ⇒ CONFLICT', r.code === 'CONFLICT');
  check('CAS loser wrote NO snapshot', wf.listRouteDecisions(db, 1).length === 0);
}

console.log('§5 a THROWING recorder never fails the resolve (best-effort via deps.dbWorkflow)');
{
  process.env.WORKFLOW_DECISION_SNAPSHOT = '1';
  const db = freshDb();
  const s = createWorkflowService({
    audit: () => {}, stampDecision: () => Promise.resolve(null), canStamp: () => true,
    dbWorkflow: { ...wf, insertRouteDecision() { throw new Error('boom'); } },
  });
  const a = s.assign(db, admin, { documentId: 1, toUserId: 2, actionRequired: 'approve' });
  const r = s.resolve(db, editor, a.route.id, { decision: 'approve' });
  check('throwing recorder ⇒ resolve STILL ok', r.ok && r.route.state === 'approved');
  check('no snapshot row written (throw swallowed)', wf.listRouteDecisions(db, 1).length === 0);
  check('documents.status still untouched', docStatus(db, 1) === 'confirmed');
}

console.log('§6 reprocess AFTER decision preserves the £ (append-only invariant)');
{
  process.env.WORKFLOW_DECISION_SNAPSHOT = '1';
  const db = freshDb(); const s = svc();
  const a = s.assign(db, admin, { documentId: 1, toUserId: 2, actionRequired: 'approve' });
  s.resolve(db, editor, a.route.id, { decision: 'approve' });   // snapshot captures £1,046.16
  db.prepare("UPDATE extractions SET display_value='£10,460.00' WHERE document_id=1 AND field_key='total_amount'").run(); // reprocess
  check('snapshot STILL shows the decision-time total (reprocess did not rewrite it)',
    wf.listRouteDecisions(db, 1)[0].snapshot_total_amount === '£1,046.16');
}

console.log('§7 C5 — a mid-flight change BEFORE resolve is captured as the RESOLVE-INSTANT value');
{
  process.env.WORKFLOW_DECISION_SNAPSHOT = '1';
  const db = freshDb(); const s = svc();
  const a = s.assign(db, admin, { documentId: 1, toUserId: 2, actionRequired: 'approve' });
  db.prepare("UPDATE extractions SET display_value='£9,999.99' WHERE document_id=1 AND field_key='total_amount'").run(); // admin-override reprocess before decision
  s.resolve(db, editor, a.route.id, { decision: 'approve' });
  check('snapshot captures the resolve-instant total, not the pre-change value',
    wf.listRouteDecisions(db, 1)[0].snapshot_total_amount === '£9,999.99');
}

console.log('§8 C1 — a total-less doc still snapshots, with a NULL total');
{
  process.env.WORKFLOW_DECISION_SNAPSHOT = '1';
  const db = freshDb(); const s = svc();
  const a = s.assign(db, admin, { documentId: 2, toUserId: 3, actionRequired: 'acknowledge' }); // doc 2 has no total extraction
  const r = s.resolve(db, reader, a.route.id, { decision: 'acknowledge' });
  const rows = wf.listRouteDecisions(db, 2);
  check('total-less doc resolve ok', r.ok);
  check('still exactly one snapshot row', rows.length === 1);
  check('snapshot_total_amount is NULL (not a throw-swallowed miss)', rows.length === 1 && rows[0].snapshot_total_amount === null);
  check('snapshot_json.total is null', rows.length === 1 && JSON.parse(rows[0].snapshot_json).total === null);
}

console.log('§9 env flag read at CALL TIME (togglable on one long-lived instance)');
{
  const db = freshDb(); const s = svc();   // ONE service instance
  delete process.env.WORKFLOW_DECISION_SNAPSHOT;
  const a1 = s.assign(db, admin, { documentId: 1, toUserId: 2, actionRequired: 'approve' });
  s.resolve(db, editor, a1.route.id, { decision: 'approve' });
  check('OFF resolve (this instance) wrote no snapshot', wf.listRouteDecisions(db, 1).length === 0);
  process.env.WORKFLOW_DECISION_SNAPSHOT = '1';
  const a2 = s.assign(db, admin, { documentId: 2, toUserId: 3, actionRequired: 'acknowledge' });
  s.resolve(db, reader, a2.route.id, { decision: 'acknowledge' });
  check('ON resolve (SAME instance) wrote a snapshot ⇒ flag not cached at construction', wf.listRouteDecisions(db, 2).length === 1);
}

delete process.env.WORKFLOW_DECISION_SNAPSHOT;
console.log(`\n${fail ? 'FAIL' : 'PASS'} — ${fail} failure(s)`);
process.exit(fail ? 1 : 0);
