#!/usr/bin/env node
'use strict';

/**
 * src/services/test_workflow.js
 * Unit test for workflowService against an in-memory DB. Covers the authorization
 * matrix, valid/invalid transitions, claim-lock, optimistic concurrency,
 * reject-needs-reason, recall rules, and the key invariant: approval NEVER rewrites
 * documents.status (filing state).
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/services/test_workflow.js
 */

const Database = require('better-sqlite3');
const { createWorkflowService, editGuard } = require('./workflowService');

let fail = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fail++; };

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE document_types (id INTEGER PRIMARY KEY, name TEXT, slug TEXT);
    CREATE TABLE documents (
      id INTEGER PRIMARY KEY, status TEXT, document_type_id INTEGER, workflow_status TEXT,
      supplier_name TEXT, reference_number TEXT, doc_date TEXT
    );
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, username TEXT, display_name TEXT, role TEXT, is_active INTEGER DEFAULT 1
    );
    CREATE TABLE document_routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, from_user_id INTEGER, from_username TEXT,
      to_user_id INTEGER, to_username TEXT, action_required TEXT, state TEXT DEFAULT 'pending',
      comment TEXT, resolution_comment TEXT, claimed_by_id INTEGER, claimed_by_username TEXT,
      claimed_at TEXT, resolved_at TEXT, stamped_path TEXT, version INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  db.prepare(`INSERT INTO document_types (id,name,slug) VALUES (1,'Invoice','invoice')`).run();
  db.prepare(`INSERT INTO documents (id,status,document_type_id) VALUES
              (1,'confirmed',1),(2,'needs_review',1),(3,'pending',1)`).run();
  const u = db.prepare(`INSERT INTO users (id,username,display_name,role,is_active) VALUES (?,?,?,?,?)`);
  u.run(1, 'admin', 'Admin', 'admin', 1);
  u.run(2, 'editor', 'Editor', 'edit', 1);
  u.run(3, 'reader', 'Reader', 'readonly', 1);
  u.run(4, 'gone', 'Gone', 'edit', 0); // inactive
  return db;
}

const admin  = { userId: 1, username: 'admin',  role: 'admin' };
const editor = { userId: 2, username: 'editor', role: 'edit' };
const reader = { userId: 3, username: 'reader', role: 'readonly' };

function main() {
  const db = freshDb();
  const audits = [];
  // Stub the stamp so the suite stays hermetic (no filesystem / PDF work on resolve).
  const stamps = [];
  const wf = createWorkflowService({ audit: (e) => audits.push(e), stampDecision: (a) => { stamps.push(a); return Promise.resolve(null); } });

  // ── assign authorization + preconditions ─────────────────────────────────────
  check('readonly cannot assign', wf.assign(db, reader, { documentId: 1, toUserId: 3, actionRequired: 'acknowledge' }).code === 'FORBIDDEN');
  check('cannot route a pending (non-routable) doc', wf.assign(db, admin, { documentId: 3, toUserId: 3, actionRequired: 'approve' }).code === 'NOT_ROUTABLE');
  check('cannot route to inactive recipient', wf.assign(db, admin, { documentId: 1, toUserId: 4, actionRequired: 'approve' }).code === 'INACTIVE_RECIPIENT');
  check('invalid actionRequired rejected', wf.assign(db, admin, { documentId: 1, toUserId: 3, actionRequired: 'frobnicate' }).code === 'INVALID');

  // ── happy assign + denorm + audit ────────────────────────────────────────────
  const a1 = wf.assign(db, admin, { documentId: 1, toUserId: 3, actionRequired: 'acknowledge', comment: 'please read' });
  check('admin assigns -> ok, pending', a1.ok && a1.route.state === 'pending');
  check('doc workflow_status set to pending', db.prepare('SELECT workflow_status FROM documents WHERE id=1').get().workflow_status === 'pending');
  check('assign audited', audits.some(e => e.action === 'workflow_route_created'));
  check('inbox shows it for reader', wf.inbox(db, reader).length === 1);
  check('sent shows it for admin', wf.sent(db, admin).length === 1);

  // ── acknowledge path (readonly allowed) + role/decision guards ───────────────
  // Approving an acknowledge-request is the WRONG decision for that request type.
  check('wrong decision for request type -> INVALID', wf.resolve(db, reader, a1.route.id, { decision: 'approve' }).code === 'INVALID');
  // A readonly recipient on an APPROVE-request is blocked by the role gate.
  const ar = wf.assign(db, admin, { documentId: 1, toUserId: 3, actionRequired: 'approve' });
  check('readonly recipient cannot approve (role gate)', wf.resolve(db, reader, ar.route.id, { decision: 'approve' }).code === 'FORBIDDEN');
  wf.recall(db, admin, ar.route.id); // tidy up the pending route
  const ack = wf.resolve(db, reader, a1.route.id, { decision: 'acknowledge' });
  check('reader acknowledges -> acknowledged', ack.ok && ack.route.state === 'acknowledged');

  // ── approve / reject path (admin|edit only) + filing-state invariant ─────────
  const a2 = wf.assign(db, admin, { documentId: 1, toUserId: 2, actionRequired: 'approve' });
  check('editor claims own route', wf.claim(db, editor, a2.route.id).ok);
  check('non-recipient cannot claim', wf.claim(db, reader, a2.route.id).code === 'FORBIDDEN');
  check('reject without reason -> COMMENT_REQUIRED', wf.resolve(db, editor, a2.route.id, { decision: 'reject' }).code === 'COMMENT_REQUIRED');
  const rej = wf.resolve(db, editor, a2.route.id, { decision: 'reject', comment: 'totals wrong' });
  check('editor rejects with reason -> rejected', rej.ok && rej.route.state === 'rejected' && rej.route.resolution_comment === 'totals wrong');
  check('FILING STATE UNCHANGED after reject (still confirmed)', db.prepare('SELECT status FROM documents WHERE id=1').get().status === 'confirmed');

  const a3 = wf.assign(db, admin, { documentId: 1, toUserId: 2, actionRequired: 'approve' });
  const appr = wf.resolve(db, editor, a3.route.id, { decision: 'approve' });
  check('editor approves -> approved', appr.ok && appr.route.state === 'approved');
  check('doc workflow_status approved; filing still confirmed',
    db.prepare('SELECT status,workflow_status FROM documents WHERE id=1').get().status === 'confirmed'
    && db.prepare('SELECT workflow_status FROM documents WHERE id=1').get().workflow_status === 'approved');

  // ── 'paid' REMOVED for v1 (Oracle ruling, WORKFLOW_SUITE_2026-07-18.md §5) ────
  // Mark Paid was half-wired: a 'paid' route sat in neither OPEN_STATES nor CLOSED_STATES,
  // so it vanished from inbox/assigned/completed. Payment tracking, if ever wanted, returns
  // as a NEW designed state with its own migration — NEVER by re-adding 'paid' to DECIDE.
  // These checks are deliberate tripwires for that (dark-era rows are healed to 'approved'
  // at boot — see database/modules/test_workflow_paid_heal.js).
  const ap = wf.assign(db, admin, { documentId: 1, toUserId: 2, actionRequired: 'approve' });
  const paidTry = wf.resolve(db, editor, ap.route.id, { decision: 'paid', comment: 'paid via BACS' });
  check("'paid' decision -> INVALID (removed from DECIDE)", paidTry.code === 'INVALID');
  check("refused 'paid' leaves the route pending",
    db.prepare('SELECT state FROM document_routes WHERE id=?').get(ap.route.id).state === 'pending');
  check("refused 'paid' leaves workflow_status untouched",
    db.prepare('SELECT workflow_status FROM documents WHERE id=1').get().workflow_status === 'pending');
  // Readonly + 'paid' now dies at the DECISION check (:130, which precedes the role gate at
  // :136) -> INVALID, NOT the old FORBIDDEN. Copying the old expectation would green a wrong pin.
  check("readonly 'paid' -> INVALID (decision check precedes role gate)",
    wf.resolve(db, reader, wf.assign(db, admin, { documentId: 1, toUserId: 3, actionRequired: 'approve' }).route.id, { decision: 'paid' }).code === 'INVALID');
  // Role-gate message no longer mentions paid.
  const roleErr = wf.resolve(db, reader, wf.assign(db, admin, { documentId: 1, toUserId: 3, actionRequired: 'approve' }).route.id, { decision: 'approve' });
  check('role-gate message mentions no "paid"', roleErr.code === 'FORBIDDEN' && !/paid/i.test(roleErr.error));
  // Stamp belt: the PAID preset is gone and the service never attempts a paid stamp.
  check('DECISION_STYLE.paid removed', require('./pdfStamp').DECISION_STYLE.paid === undefined);
  check('no stamp attempted for a refused paid', !stamps.some(s => s.decision === 'paid'));

  // ── B2: resubmission lineage (Slice 1 — advisory, audit-details only) ─────────
  const rs = wf.assign(db, admin, { documentId: 1, toUserId: 2, actionRequired: 'approve', resubmitOf: a2.route.id });
  check('assign with resubmitOf -> ok', rs.ok);
  check('resubmit lineage recorded in the audit details',
    audits.some(e => e.action === 'workflow_route_created' && new RegExp(`resubmit_of=${a2.route.id}\\b`).test(e.details || '')));
  check('assign WITHOUT resubmitOf leaves details clean',
    audits.some(e => e.action === 'workflow_route_created' && !/resubmit_of/.test(e.details || '')));
  // PINNED semantics: NO lookup — garbage lineage is recorded as-is (bounded to 32 chars)
  // and never fails the assign. Advisory audit data only; a first-class column, if ever
  // wanted, belongs to the Slice-2 decision-snapshot grain — not here.
  const rg = wf.assign(db, admin, { documentId: 1, toUserId: 2, actionRequired: 'acknowledge', resubmitOf: 999999 });
  check('garbage resubmitOf still ok (no lookup — advisory only, pinned)', rg.ok);
  check('preconditions still fire with resubmitOf present (role)',
    wf.assign(db, reader, { documentId: 1, toUserId: 2, actionRequired: 'approve', resubmitOf: 1 }).code === 'FORBIDDEN');
  check('preconditions still fire with resubmitOf present (routable)',
    wf.assign(db, admin, { documentId: 3, toUserId: 2, actionRequired: 'approve', resubmitOf: 1 }).code === 'NOT_ROUTABLE');
  wf.recall(db, admin, rs.route.id); wf.recall(db, admin, rg.route.id);   // tidy the pending routes

  // ── optimistic concurrency (stale version loses) ─────────────────────────────
  const a4 = wf.assign(db, admin, { documentId: 1, toUserId: 2, actionRequired: 'approve' });
  const staleV = a4.route.version;        // version before claim
  wf.claim(db, editor, a4.route.id);      // bumps version
  check('resolve with stale version -> CONFLICT',
    wf.resolve(db, editor, a4.route.id, { decision: 'approve', expectedVersion: staleV }).code === 'CONFLICT');
  check('resolve with current version -> ok', wf.resolve(db, editor, a4.route.id, { decision: 'approve' }).ok);

  // ── recall (sender only, pending only) ───────────────────────────────────────
  const a5 = wf.assign(db, admin, { documentId: 1, toUserId: 3, actionRequired: 'acknowledge' });
  check('non-sender cannot recall', wf.recall(db, editor, a5.route.id).code === 'FORBIDDEN');
  check('sender recalls pending -> recalled', wf.recall(db, admin, a5.route.id).ok);
  check('cannot recall an already-resolved route', wf.recall(db, admin, a3.route.id).code === 'INVALID');

  // ── completed view ───────────────────────────────────────────────────────────
  check('completed view lists resolved items for admin', wf.completed(db, admin).length >= 3);

  // ── stamped-copy recording + DTO exposure ────────────────────────────────────
  // (resolve() fires the stamp fire-and-forget; here we cover the deterministic pieces.)
  const dto = require('./dto');
  check('projectRoute has_stamp=false with no stamp', dto.projectRoute({ id: 1, stamped_path: null }).has_stamp === false);
  check('projectRoute has_stamp=true with a stamp',   dto.projectRoute({ id: 1, stamped_path: 'C:/x.pdf' }).has_stamp === true);
  check('projectRoute never leaks the stamped_path',  dto.projectRoute({ id: 1, stamped_path: 'C:/x.pdf' }).stamped_path === undefined);
  const dbwf = require('../../database/modules/workflow');
  dbwf.setStampedPath(db, a3.route.id, 'C:/inbox/Invoice.APPROVED-stamped.pdf');
  check('setStampedPath records the path on the route', dbwf.getRoute(db, a3.route.id).stamped_path === 'C:/inbox/Invoice.APPROVED-stamped.pdf');

  // ── 5b: uncommitted docs are routable + workflow_lock editGuard ───────────────
  const un = wf.assign(db, admin, { documentId: 2, toUserId: 2, actionRequired: 'approve' }); // doc2 = needs_review
  check('uncommitted (needs_review) doc IS routable', un.ok && un.route.state === 'pending');
  check('editGuard: doc with open route is locked for edit', editGuard(db, 2, 'edit').code === 'WORKFLOW_LOCKED');
  check('editGuard: admin can override the lock', editGuard(db, 2, 'admin').ok === true && editGuard(db, 2, 'admin').overridden === true);
  check('editGuard: doc with no open route is unlocked', editGuard(db, 999, 'edit').ok === true);
  // Once resolved, the lock releases.
  wf.resolve(db, editor, un.route.id, { decision: 'approve' });
  check('editGuard: lock releases after the route resolves', editGuard(db, 2, 'edit').ok === true);

  // ── zero-paid sweep: NO path anywhere in this suite can mint a 'paid' row ─────
  check("zero 'paid' routes exist after the full flow",
    db.prepare(`SELECT COUNT(*) c FROM document_routes WHERE state='paid'`).get().c === 0);

  db.close();
  console.log(fail ? `\n${fail} check(s) FAILED` : '\nAll workflow checks passed.');
  return fail ? 1 : 0;
}

process.exit(main());
