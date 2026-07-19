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
      claimed_at TEXT, resolved_at TEXT, stamped_path TEXT, matched_rule_summary TEXT, version INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now'))
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

  // ── C1: notifyWorkflow hook (Slice 1 notifications) ───────────────────────────
  const events = [];
  const wfN = createWorkflowService({ audit: () => {}, stampDecision: () => Promise.resolve(null), notifyWorkflow: (e) => events.push(e) });
  const na = wfN.assign(db, admin, { documentId: 1, toUserId: 2, actionRequired: 'approve' });
  check('notify hook fires on assign with {event,route,actor}',
    events.some(e => e.event === 'assigned' && e.route && e.route.id === na.route.id && e.actor === admin));
  wfN.claim(db, editor, na.route.id);
  check('notify hook fires on claim', events.some(e => e.event === 'claimed'));
  wfN.resolve(db, editor, na.route.id, { decision: 'approve' });
  check('notify hook carries the TERMINAL state on resolve', events.some(e => e.event === 'approved'));
  const nr5 = wfN.assign(db, admin, { documentId: 1, toUserId: 3, actionRequired: 'acknowledge' });
  wfN.recall(db, admin, nr5.route.id);
  check('notify hook fires on recall', events.some(e => e.event === 'recalled'));
  // A THROWING sink must NEVER fail the action (the detached-hook rule; the service wraps
  // the call — main.js's real sink is additionally try/catch'd itself, belt and braces).
  const wfT = createWorkflowService({ audit: () => {}, stampDecision: () => Promise.resolve(null), notifyWorkflow: () => { throw new Error('boom'); } });
  const nt = wfT.assign(db, admin, { documentId: 1, toUserId: 2, actionRequired: 'acknowledge' });
  check('throwing notify hook never breaks assign', nt.ok === true);
  check('throwing notify hook never breaks resolve', wfT.resolve(db, editor, nt.route.id, { decision: 'acknowledge' }).ok === true);

  // ── C2: box COUNTs mirror their list queries EXACTLY (one source for the Home card,
  // the /v1 counts endpoint and the client badge poll — drift = badges lie vs tabs) ──
  check('countInbox mirrors listInbox',         dbwf.countInbox(db, 2)     === dbwf.listInbox(db, 2).length);
  check('countSent mirrors listSent',           dbwf.countSent(db, 1)      === dbwf.listSent(db, 1).length);
  check('countAssigned mirrors listAssigned',   dbwf.countAssigned(db, 2)  === dbwf.listAssigned(db, 2).length);
  check('countCompleted mirrors listCompleted', dbwf.countCompleted(db, 1) === dbwf.listCompleted(db, 1).length);
  check('countOpenSent counts only OPEN sent routes',
    dbwf.countOpenSent(db, 1) === dbwf.listSent(db, 1).filter(r => r.state === 'pending' || r.state === 'claimed').length);

  // ── assignSystem: auto-file (system-sender) routes + matched_rule_summary (routing slice, Oracle C4) ──
  {
    const why = 'When an Invoice is filed, send it to Reader to just see it.';
    const sys = wf.assignSystem(db, { documentId: 1, toUserId: 3, actionRequired: 'acknowledge', matchedRuleSummary: why });
    check('assignSystem -> ok', sys.ok);
    check('system route: from_user_id NULL + from_username Auto-filed', sys.ok && sys.route.from_user_id === null && sys.route.from_username === 'Auto-filed');
    check('system route: matched_rule_summary persisted (immutable why-routed)', sys.ok && sys.route.matched_rule_summary === why);
    check('system route shows in recipient inbox', dbwf.listInbox(db, 3).some(r => r.id === sys.route.id));
    check('acknowledge system route resolvable by the readonly recipient', wf.resolve(db, reader, sys.route.id, { decision: 'acknowledge' }).ok);
    // shared _validateAssignTarget returns the SAME codes as assign (C4 — byte-identical validation)
    check('assignSystem inactive recipient -> INACTIVE_RECIPIENT', wf.assignSystem(db, { documentId: 1, toUserId: 4, actionRequired: 'approve' }).code === 'INACTIVE_RECIPIENT');
    check('assignSystem non-routable doc -> NOT_ROUTABLE', wf.assignSystem(db, { documentId: 3, toUserId: 3, actionRequired: 'approve' }).code === 'NOT_ROUTABLE');
    check('assignSystem missing doc -> NOT_FOUND', wf.assignSystem(db, { documentId: 999, toUserId: 3, actionRequired: 'approve' }).code === 'NOT_FOUND');
    check('assignSystem bad action -> INVALID', wf.assignSystem(db, { documentId: 1, toUserId: 3, actionRequired: 'frobnicate' }).code === 'INVALID');
  }

  // ── FYI NON-LOCKING slice (2026-07-19) — the lock split ───────────────────────
  // THE PIN: an open acknowledge/FYI route NEVER edit-locks — an FYI is a postcard, not a
  // gate (docs/designs/WORKFLOW_FYI_NONLOCKING_2026-07-19.md). Do NOT re-lock it. The
  // Oracle-C5 role pair lives earlier in this suite: readonly CAN acknowledge (the
  // "reader acknowledges" check) and readonly CANNOT approve (the role-gate check) —
  // an FYI is for everyone; never least-privilege the acknowledge away.
  {
    const { hasActiveWorkflowLock, closeOpenRoutesForDeletedDoc } = require('./workflowService');
    const fy = wf.assign(db, admin, { documentId: 2, toUserId: 3, actionRequired: 'acknowledge' });
    check('FYI: open acknowledge route does NOT edit-lock', editGuard(db, 2, 'edit').ok === true);
    check('FYI: hasActiveWorkflowLock false on ack-only', hasActiveWorkflowLock(db, 2) === false);
    check('FYI: hasActiveRoute STILL sees the ack route (dedupe/visibility unchanged — pinned)',
      dbwf.hasActiveRoute(db, 2) === true);
    check('FYI: hasActiveApprovalRoute does not', dbwf.hasActiveApprovalRoute(db, 2) === false);
    const apLock = wf.assign(db, admin, { documentId: 2, toUserId: 2, actionRequired: 'approve' });
    check('FYI: ack+approve both open => LOCKED (approve dominates)', editGuard(db, 2, 'edit').code === 'WORKFLOW_LOCKED');
    wf.recall(db, admin, apLock.route.id);
    check('FYI: approve recalled => unlocked again (ack still open)', editGuard(db, 2, 'edit').ok === true);
    // Polarity pin: WORKFLOW_ACK_LOCKS=1 restores the pre-slice any-route locking.
    process.env.WORKFLOW_ACK_LOCKS = '1';
    check('WORKFLOW_ACK_LOCKS=1 restores any-route locking', editGuard(db, 2, 'edit').code === 'WORKFLOW_LOCKED');
    delete process.env.WORKFLOW_ACK_LOCKS;
    check('env unset => non-locking again', editGuard(db, 2, 'edit').ok === true);
    // Fail-toward-lock: an UNKNOWN action value still locks (the predicate is
    // action <> 'acknowledge', NOT action = 'approve' — a future 'countersign'/multi-step
    // 'waiting' stays locked until deliberately exempted).
    db.prepare(`INSERT INTO document_routes (document_id, from_user_id, from_username, to_user_id, to_username, action_required, state)
                VALUES (2, 1, 'admin', 2, 'editor', 'countersign', 'pending')`).run();
    check("unknown action 'countersign' STILL LOCKS (fail-toward-lock polarity pin)",
      editGuard(db, 2, 'edit').code === 'WORKFLOW_LOCKED');
    db.prepare(`DELETE FROM document_routes WHERE action_required = 'countersign'`).run();
    // NULL action (legacy/raw row) must ALSO lock — bare `<> 'acknowledge'` would evaluate
    // NULL and silently unlock it (the IS NULL arm in hasActiveApprovalRoute is load-bearing).
    db.prepare(`INSERT INTO document_routes (document_id, from_user_id, from_username, to_user_id, to_username, action_required, state)
                VALUES (2, 1, 'admin', 2, 'editor', NULL, 'pending')`).run();
    check('NULL action STILL LOCKS (the IS NULL arm pin)', editGuard(db, 2, 'edit').code === 'WORKFLOW_LOCKED');
    db.prepare(`DELETE FROM document_routes WHERE action_required IS NULL`).run();
    wf.resolve(db, reader, fy.route.id, { decision: 'acknowledge' });   // tidy

    // ── delete-close (closeOpenRoutesForDeletedDoc) — the honest tombstone ──────
    const r1 = wf.assign(db, admin, { documentId: 2, toUserId: 3, actionRequired: 'acknowledge' });
    const r2 = wf.assign(db, admin, { documentId: 2, toUserId: 2, actionRequired: 'approve' });
    wf.claim(db, editor, r2.route.id);
    const inboxBefore = dbwf.countInbox(db, 3);
    const res = closeOpenRoutesForDeletedDoc(db, { documentId: 2, deletedByName: 'Admin' });
    check('delete-close closes BOTH pending and claimed routes', res.closed.length === 2);
    const row1 = dbwf.getRoute(db, r1.route.id);
    check("closed route: state 'recalled' + honest comment + resolved_at",
      row1.state === 'recalled' && /Document deleted by Admin/.test(row1.resolution_comment || '') && !!row1.resolved_at);
    check('recipient inbox count drops on close', dbwf.countInbox(db, 3) === inboxBefore - 1);
    check('closed route appears in Completed (the tombstone is findable)',
      dbwf.listCompleted(db, 3).some(r => r.id === r1.route.id));
    check("doc workflow_status becomes 'recalled'",
      db.prepare('SELECT workflow_status FROM documents WHERE id=2').get().workflow_status === 'recalled');
    check('no open routes => closed:[] (caller then SKIPS audit+notify — pinned)',
      closeOpenRoutesForDeletedDoc(db, { documentId: 2, deletedByName: 'X' }).closed.length === 0);
    // CAS: a concurrent resolve wins — the helper's stale-version update writes nothing.
    const wfmod = require('../../database/modules/workflow');
    const r4 = wf.assign(db, admin, { documentId: 2, toUserId: 3, actionRequired: 'acknowledge' });
    const staleRow = { ...db.prepare('SELECT * FROM document_routes WHERE id=?').get(r4.route.id) };
    db.prepare('UPDATE document_routes SET version = version + 1 WHERE id = ?').run(r4.route.id);
    const resCas = closeOpenRoutesForDeletedDoc(db, { documentId: 2, deletedByName: 'X' },
      { dbWorkflow: { ...wfmod, listOpenRoutesForDocument: () => [staleRow] } });
    check('CAS race: stale version => skip, route untouched',
      resCas.closed.length === 0 && dbwf.getRoute(db, r4.route.id).state === 'pending');
    db.prepare('UPDATE document_routes SET version = version - 1 WHERE id = ?').run(r4.route.id);
    wf.recall(db, admin, r4.route.id);   // tidy

    // ── Oracle C4: 'auto_closed' is toast-free BY OMISSION — do not "complete" the list ──
    const wnotify = require('../lib/workflowNotify');
    check("eventDirection('auto_closed') is null (deliberately unlisted)", wnotify.eventDirection('auto_closed') === null);
    check("aggregate ignores 'auto_closed' (returns its input => no toast timer reset)",
      wnotify.aggregate(null, { event: 'auto_closed', route: { id: 1, to_user_id: 2, from_user_id: 1 } }) === null);
    // main.js pin: the badge broadcast ('workflow-counts-changed') fires BEFORE the aggregate
    // early-return, so an unlisted event still refreshes counts — asserted structurally here:
    const mainSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'main.js'), 'utf8');
    const fnBody = mainSrc.split('function notifyWorkflowEvent')[1] || '';
    check("main.js: badge broadcast precedes the aggregate early-return (ordering pin)",
      fnBody.indexOf("notifyAllWindows('workflow-counts-changed')") > -1
      && fnBody.indexOf("notifyAllWindows('workflow-counts-changed')") < fnBody.indexOf('workflowNotify.aggregate'));
  }

  // ── E1 ADMIN CANCEL-ROUTE (docs/designs/WORKFLOW_ADMIN_CANCEL_2026-07-19.md) ──
  {
    const cancelEvents = [];
    const wfC = createWorkflowService({ audit: (e) => audits.push(e),
      stampDecision: (a) => { stamps.push(a); return Promise.resolve(null); },
      notifyWorkflow: (e) => cancelEvents.push(e) });

    // Setup: the 'paid' blocks above DELIBERATELY leave open approve routes on doc 1
    // (refused decisions keep the route pending) — settle them so this battery's
    // lock-release / last-route assertions see only their own routes.
    db.prepare(`UPDATE document_routes SET state='approved', resolved_at=datetime('now')
                WHERE document_id=1 AND state IN ('pending','claimed')`).run();

    // THE HEADLINE HOLE, pinned first: a NULL-sender system route is recallable by NOBODY.
    const sysR = wfC.assignSystem(db, { documentId: 1, toUserId: 3, actionRequired: 'approve' });
    check('(the hole) recall of a system route FORBIDDEN even for admin', wfC.recall(db, admin, sysR.route.id).code === 'FORBIDDEN');
    check('non-admin cannot cancel (edit)', wfC.adminCancelRoute(db, editor, sysR.route.id, {}).code === 'FORBIDDEN');
    check('non-admin cannot cancel (readonly)', wfC.adminCancelRoute(db, reader, sysR.route.id, {}).code === 'FORBIDDEN');
    check('(setup) the open approve system route locks the doc', editGuard(db, 1, 'edit').code === 'WORKFLOW_LOCKED');
    const inboxBeforeCancel = dbwf.countInbox(db, 3);
    const c1 = wfC.adminCancelRoute(db, admin, sysR.route.id, {});
    check('admin cancels the system route -> recalled', c1.ok && c1.route.state === 'recalled');
    check('comment ALWAYS non-null "Cancelled by …(administrator)" + resolved_at',
      /^Cancelled by .+\(administrator\)$/.test(c1.route.resolution_comment || '') && !!c1.route.resolved_at);
    check('cancel releases the edit lock', editGuard(db, 1, 'edit').ok === true);
    check('recipient inbox count drops', dbwf.countInbox(db, 3) === inboxBeforeCancel - 1);
    check("notify fired 'admin_cancelled' exactly once", cancelEvents.filter(e => e.event === 'admin_cancelled').length === 1);
    check("aggregate ignores 'admin_cancelled' (badge-only pin — do not add it to eventDirection)",
      require('../lib/workflowNotify').aggregate(null, { event: 'admin_cancelled', route: c1.route }) === null);
    check('audited workflow_route_cancelled', audits.some(a => a.action === 'workflow_route_cancelled'));

    // Claimed route cancels (the second stuck case); never stamps/snapshots even with the env on.
    process.env.WORKFLOW_DECISION_SNAPSHOT = '1';
    const cl = wfC.assign(db, admin, { documentId: 1, toUserId: 2, actionRequired: 'approve' });
    wfC.claim(db, editor, cl.route.id);
    const stampsBefore = stamps.length;
    const c2 = wfC.adminCancelRoute(db, admin, cl.route.id, { reason: 'recipient left the company' });
    delete process.env.WORKFLOW_DECISION_SNAPSHOT;
    check('CLAIMED route cancels', c2.ok && c2.route.state === 'recalled');
    check('optional reason appended after a colon', /: recipient left the company$/.test(c2.route.resolution_comment || ''));
    check('cancel NEVER stamps (spy untouched, snapshot env armed)', stamps.length === stampsBefore);

    check('already-closed -> INVALID', wfC.adminCancelRoute(db, admin, c2.route.id, {}).code === 'INVALID');
    check('missing route -> NOT_FOUND', wfC.adminCancelRoute(db, admin, 999999, {}).code === 'NOT_FOUND');
    const cs = wfC.assign(db, admin, { documentId: 1, toUserId: 2, actionRequired: 'approve' });
    const staleV2 = cs.route.version;
    wfC.claim(db, editor, cs.route.id);   // bumps version
    check('stale expectedVersion -> CONFLICT, row untouched',
      wfC.adminCancelRoute(db, admin, cs.route.id, { expectedVersion: staleV2 }).code === 'CONFLICT'
      && db.prepare('SELECT state FROM document_routes WHERE id=?').get(cs.route.id).state === 'claimed');

    // gary C1: a doc can carry SEVERAL open routes — the 'recalled' denorm stamps only when
    // NO open route remains (never blind-stamp over a survivor).
    const t1 = wfC.assign(db, admin, { documentId: 1, toUserId: 3, actionRequired: 'acknowledge' });
    wfC.adminCancelRoute(db, admin, t1.route.id, {});
    check('C1: one of two open routes cancelled -> workflow_status NOT recalled',
      db.prepare('SELECT workflow_status FROM documents WHERE id=1').get().workflow_status !== 'recalled');
    wfC.adminCancelRoute(db, admin, cs.route.id, {});
    check('C1: LAST open route cancelled -> workflow_status recalled',
      db.prepare('SELECT workflow_status FROM documents WHERE id=1').get().workflow_status === 'recalled');
    check('cancel frees the doc for routing (hasActiveRoute false, fresh assign ok)',
      dbwf.hasActiveRoute(db, 1) === false
      && wfC.assign(db, admin, { documentId: 1, toUserId: 2, actionRequired: 'acknowledge' }).ok === true);

    // A deactivated OR hard-DELETED recipient can never block the escape hatch.
    const dr = wfC.assign(db, admin, { documentId: 1, toUserId: 3, actionRequired: 'approve' });
    db.prepare('DELETE FROM users WHERE id = 3').run();
    check('cancel succeeds when the recipient user row was DELETED', wfC.adminCancelRoute(db, admin, dr.route.id, {}).ok === true);

    // Oracle OC3: a route stranded on a soft-DELETED doc still cancels — the cancel path
    // deliberately has NO ROUTABLE_STATES / doc-status check; never add one (this is the
    // healing surface for legacy strands).
    const delDoc = wfC.assign(db, admin, { documentId: 2, toUserId: 2, actionRequired: 'approve' });
    db.prepare(`UPDATE documents SET status='deleted' WHERE id=2`).run();
    check('OC3: cancel succeeds on a soft-deleted doc route', wfC.adminCancelRoute(db, admin, delDoc.route.id, {}).ok === true);
    db.prepare(`UPDATE documents SET status='needs_review' WHERE id=2`).run();

    // Oracle OC2: the THREE producers of 'recalled' stay comment-distinct — sender recall
    // NULL / delete-close "Document deleted by…" / cancel "Cancelled by…". NO code may ever
    // branch on the comment TEXT (audit actions are the machine provenance); a closed_reason
    // column becomes mandatory at producer #4 or first localisation.
    const triple = db.prepare(`SELECT
        SUM(CASE WHEN resolution_comment IS NULL THEN 1 ELSE 0 END) nul,
        SUM(CASE WHEN resolution_comment LIKE 'Document deleted by%' THEN 1 ELSE 0 END) del,
        SUM(CASE WHEN resolution_comment LIKE 'Cancelled by%' THEN 1 ELSE 0 END) can
      FROM document_routes WHERE state='recalled'`).get();
    check('OC2: recalled-producer triple stays comment-distinct', triple.nul >= 1 && triple.del >= 1 && triple.can >= 1);

    // TRADE-OFF PIN: recall STAYS sender-only + pending-only — admin cancel is the
    // deliberate escape hatch; do NOT widen recall to "fix" these.
    const tp = wfC.assign(db, admin, { documentId: 1, toUserId: 2, actionRequired: 'approve' });
    wfC.claim(db, editor, tp.route.id);
    check('TRADE-OFF PIN: sender recall of a CLAIMED route stays INVALID', wfC.recall(db, admin, tp.route.id).code === 'INVALID');
    wfC.adminCancelRoute(db, admin, tp.route.id, {});   // tidy
  }

  // ── zero-paid sweep: NO path anywhere in this suite can mint a 'paid' row ─────
  check("zero 'paid' routes exist after the full flow",
    db.prepare(`SELECT COUNT(*) c FROM document_routes WHERE state='paid'`).get().c === 0);

  db.close();
  console.log(fail ? `\n${fail} check(s) FAILED` : '\nAll workflow checks passed.');
  return fail ? 1 : 0;
}

process.exit(main());
