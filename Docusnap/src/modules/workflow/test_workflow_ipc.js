#!/usr/bin/env node
'use strict';

/**
 * src/modules/workflow/test_workflow_ipc.js
 * Verifies the in-core workflow IPC handler: it is gated by the workflow add-on
 * ENTITLEMENT (rejects FEATURE_NOT_LICENSED when off), drives workflowService when
 * on, and honours role rules — with the actor taken from the in-process session.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe src/modules/workflow/test_workflow_ipc.js
 */

const Database = require('better-sqlite3');

let session = { id: 1, username: 'admin', role: 'admin' };
const fakeAuth = {
  requireLogin() { if (!session) throw Object.assign(new Error('login'), { code: 'AUTH_REQUIRED' }); return session; },
  requireRole(...roles) {
    if (!session || !roles.includes(session.role)) throw Object.assign(new Error('forbidden'), { code: 'FORBIDDEN' });
    return session;
  },
  getCurrentUser() { return session; },
  logAudit() {},
};
const authPath = require.resolve('../auth/handler');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: fakeAuth };

// ── entitlement stub (require.cache — the fake-auth pattern above) ─────────────
// WORKFLOW_FEATURE_ENABLED is a hard-coded const (entitlementService.js) with NO injection
// seam on the desktop IPC path, so this suite could never go green while the feature is dark
// (the recorded known-fail). The stub simulates the master flag ON while PRESERVING the real
// seat-count default-deny — so the OFF half still exercises the real "no seats ⇒ deny" logic
// and the ON half exercises the real handler/service flow. The flag-off forcing itself stays
// covered by src/services/test_entitlement.js (workflow.disabled pin). Production untouched.
const realEntPath = require.resolve('../../services/entitlementService');
const realEnt = require(realEntPath);
const entStub = {
  ...realEnt,
  checkClientEntitlement(db, deps) {
    const r = realEnt.checkClientEntitlement(db, deps);
    let wfSeats = 0;
    try {
      const row = db.prepare('SELECT value FROM settings WHERE key=?').get(realEnt.WORKFLOW_SEATS_KEY);
      const n = parseInt(row && row.value, 10);
      wfSeats = Number.isFinite(n) && n > 0 ? n : 0;
    } catch { /* no settings table -> 0 */ }
    // WORKFLOW_BUNDLED_WITH_CLIENT=true semantics with the master flag ON:
    const entitled = r.search.entitled || wfSeats > 0;
    return { ...r, workflow: { entitled, seats: wfSeats > 0 ? wfSeats : r.search.seats, bundled: true } };
  },
};
require.cache[realEntPath] = { id: realEntPath, filename: realEntPath, loaded: true, exports: entStub };

const wfHandler = require('./handler');
const { SEARCH_SEATS_KEY, WORKFLOW_SEATS_KEY } = require('../../services/entitlementService');

function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); return cond; }
function threwCode(fn, code) { try { fn(); return false; } catch (e) { return e.code === code; } }

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE document_types (id INTEGER PRIMARY KEY, name TEXT, slug TEXT);
    CREATE TABLE documents (id INTEGER PRIMARY KEY, status TEXT, document_type_id INTEGER, workflow_status TEXT,
      supplier_name TEXT, reference_number TEXT, doc_date TEXT,
      stored_filename TEXT, original_filename TEXT);
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, display_name TEXT, role TEXT,
      is_active INTEGER DEFAULT 1, must_change_password INTEGER DEFAULT 0, last_login_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE document_routes (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, from_user_id INTEGER,
      from_username TEXT, to_user_id INTEGER, to_username TEXT, action_required TEXT, state TEXT DEFAULT 'pending',
      comment TEXT, resolution_comment TEXT, claimed_by_id INTEGER, claimed_by_username TEXT, claimed_at TEXT,
      resolved_at TEXT, matched_rule_summary TEXT, stamped_path TEXT, version INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE workflow_route_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, document_type_id INTEGER,
      min_amount_pennies INTEGER NOT NULL DEFAULT 0, max_amount_pennies INTEGER, target_role TEXT,
      target_user_id INTEGER, action_required TEXT NOT NULL DEFAULT 'approve', step_order INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT,
      CHECK (target_role IS NOT NULL OR target_user_id IS NOT NULL));
  `);
  db.prepare(`INSERT INTO document_types (id,name,slug) VALUES (1,'Invoice','invoice')`).run();
  db.prepare(`INSERT INTO documents (id,status,document_type_id,supplier_name) VALUES (1,'confirmed',1,'Acme')`).run();
  const u = db.prepare(`INSERT INTO users (id,username,display_name,role,is_active) VALUES (?,?,?,?,1)`);
  u.run(1, 'admin', 'Admin', 'admin'); u.run(2, 'editor', 'Editor', 'edit'); u.run(3, 'reader', 'Reader', 'readonly');
  return db;
}

async function main() {
  let fail = 0;
  const db = freshDb();
  const H = {};
  const wfEvents = [];   // Slice 1: the shared main.js sink (ctx.notifyWorkflowEvent) spy
  wfHandler.register({ ipcMain: { handle: (n, fn) => { H[n] = fn; } }, getDb: () => db, notifyWorkflowEvent: (ev) => wfEvents.push(ev) });
  const setLicensed = (on) => {
    const set = (k, v) => db.prepare(`INSERT INTO settings (key,value) VALUES (?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(k, v);
    set(SEARCH_SEATS_KEY, on ? '2' : '0');     // workflow ≤ search, so a workflow licence implies search
    set(WORKFLOW_SEATS_KEY, on ? '1' : '0');
  };

  // ── entitlement OFF → feature gated ──────────────────────────────────────────
  session = { id: 1, username: 'admin', role: 'admin' };
  fail += !check('get-entitlement reflects OFF (default-deny)', H['get-entitlement']({}).entitled === false);
  fail += !check('workflow-inbox blocked when unlicensed', threwCode(() => H['workflow-inbox']({}), 'FEATURE_NOT_LICENSED'));
  fail += !check('workflow-assign blocked when unlicensed',
    threwCode(() => H['workflow-assign']({}, { documentId: 1, toUserId: 3, actionRequired: 'acknowledge' }), 'FEATURE_NOT_LICENSED'));
  // Slice 1: the counts IPC returns a CLEAN {entitled:false} while dark — never throws —
  // so the Home dashboard's "Waiting on you" card can probe it safely on every load.
  fail += !check('get-workflow-counts is clean {entitled:false} when unlicensed',
    H['get-workflow-counts']({}).entitled === false);

  // ── license the add-on ───────────────────────────────────────────────────────
  setLicensed(true);
  fail += !check('get-entitlement reflects ON', H['get-entitlement']({}).entitled === true);

  // admin assigns an acknowledge request to the reader
  const route = H['workflow-assign']({}, { documentId: 1, toUserId: 3, actionRequired: 'acknowledge', comment: 'fyi' });
  fail += !check('admin assign -> route pending', route && route.state === 'pending');
  fail += !check('admin recipients lists the reader',
    H['workflow-recipients']({}).some(u => u.username === 'reader'));
  // Slice 1: the desktop transport reaches the shared main.js notification sink.
  fail += !check('ctx.notifyWorkflowEvent saw the assign', wfEvents.some(e => e.event === 'assigned' && e.route && e.route.id === route.id));
  const wc = H['get-workflow-counts']({});
  fail += !check('counts ON: entitled + admin sent=1 inbox=0',
    wc.entitled === true && wc.sent === 1 && wc.inbox === 0 && typeof wc.openSent === 'number');

  // reader: sees it in inbox, can acknowledge; cannot list recipients
  session = { id: 3, username: 'reader', role: 'readonly' };
  fail += !check('reader inbox shows the route', H['workflow-inbox']({}).length === 1);
  fail += !check('readonly cannot list recipients', threwCode(() => H['workflow-recipients']({}), 'FORBIDDEN'));
  const ack = H['workflow-resolve']({}, { id: route.id, decision: 'acknowledge', version: route.version });
  fail += !check('reader acknowledges -> acknowledged', ack && ack.state === 'acknowledged');
  fail += !check('filing state untouched (still confirmed)',
    db.prepare('SELECT status FROM documents WHERE id=1').get().status === 'confirmed');

  // ── FYI slice: routing rules accept BOTH actions (the old D1 approval-only pin is
  // DELIBERATELY FLIPPED — acknowledge stopped edit-locking, so the deferral reason is gone;
  // docs/designs/WORKFLOW_FYI_NONLOCKING_2026-07-19.md). Server-side allowlist is the trust
  // boundary: missing action defaults to approve (stale renderer), garbage is REFUSED.
  session = { id: 1, username: 'admin', role: 'admin' };
  const rAck = H['workflow-rule-create']({}, { targetUserId: 3, actionRequired: 'acknowledge' });
  fail += !check('rule-create acknowledge -> stored verbatim',
    rAck && rAck.ok && rAck.rule.action_required === 'acknowledge');
  fail += !check('acknowledge rule summary says "for information" (grammar pin)',
    rAck && /for information\.$/.test(rAck.rule.summary || ''));
  const rDef = H['workflow-rule-create']({}, { targetUserId: 3 });
  fail += !check('rule-create with NO action -> defaults to approve (stale-renderer back-compat)',
    rDef && rDef.ok && rDef.rule.action_required === 'approve'
    && /to approve\.$/.test(rDef.rule.summary || ''));
  const rBad = H['workflow-rule-create']({}, { targetUserId: 3, actionRequired: 'delete_everything' });
  fail += !check('rule-create with a garbage action -> REFUSED (allowlist, never coerced)',
    rBad && rBad.error && !rBad.ok);

  // ── E1 admin cancel-route IPCs (docs/designs/WORKFLOW_ADMIN_CANCEL_2026-07-19.md) ──
  session = { id: 1, username: 'admin', role: 'admin' };
  const e1r = H['workflow-assign']({}, { documentId: 1, toUserId: 3, actionRequired: 'approve' });
  session = { id: 2, username: 'editor', role: 'edit' };
  fail += !check('admin-cancel rejects a non-admin session', threwCode(() => H['workflow-admin-cancel']({}, { id: e1r.id, version: e1r.version }), 'FORBIDDEN'));
  session = { id: 3, username: 'reader', role: 'readonly' };
  fail += !check('doc-routes rejects readonly', threwCode(() => H['workflow-doc-routes']({}, { documentId: 1 }), 'FORBIDDEN'));
  session = { id: 2, username: 'editor', role: 'edit' };
  fail += !check('open-routes is admin-only (edit rejected)', threwCode(() => H['workflow-open-routes']({}), 'FORBIDDEN'));
  session = { id: 1, username: 'admin', role: 'admin' };
  const drs = H['workflow-doc-routes']({}, { documentId: 1 });
  fail += !check('doc-routes returns the open route with the PROJECTED shape (version yes; stamped_path/comment NO — Oracle OC4)',
    drs.length === 1 && drs[0].id === e1r.id && typeof drs[0].version === 'number'
    && !('stamped_path' in drs[0]) && !('comment' in drs[0]));
  const openAll = H['workflow-open-routes']({});
  fail += !check('open-routes lists it with filename join + no stamped_path (OC3-iii projection pin)',
    openAll.some(x => x.id === e1r.id) && !openAll.some(x => 'stamped_path' in x));
  // OC3-ii: a route on a soft-DELETED doc stays LISTED (doc_status exposed) — the healing
  // surface for legacy strands; do not filter it out.
  db.prepare(`UPDATE documents SET status='deleted' WHERE id=1`).run();
  const openDel = H['workflow-open-routes']({});
  fail += !check('open-routes INCLUDES a deleted-doc route with doc_status (OC3-ii pin)',
    openDel.some(x => x.id === e1r.id && x.doc_status === 'deleted'));
  db.prepare(`UPDATE documents SET status='confirmed' WHERE id=1`).run();
  const cancelled = H['workflow-admin-cancel']({}, { id: e1r.id, version: e1r.version });
  fail += !check('admin-cancel over IPC -> recalled with the Cancelled-by comment',
    cancelled.state === 'recalled' && /^Cancelled by /.test(cancelled.resolution_comment || ''));

  // ── Decision history + secure-viewer seams (Chris r4 card 2 + the stamped viewer) ────
  // History: CLOSED routes only, projected — no stamped_path, no sender comment (OC4);
  // has_stamped BOOLEAN feeds the in-app viewer (the renderer never sees a path).
  session = { id: 1, username: 'admin', role: 'admin' };
  const hist = H['workflow-doc-history']({}, { documentId: 1 });
  fail += !check('doc-history returns the cancelled route (closed states only)',
    Array.isArray(hist) && hist.some(x => x.id === e1r.id && x.state === 'recalled'));
  fail += !check('doc-history is PROJECTED: no stamped_path, no sender comment, has_stamped boolean',
    hist.every(x => !('stamped_path' in x) && !('comment' in x) && (x.has_stamped === 0 || x.has_stamped === 1)));
  fail += !check('doc-history ships resolution_comment (the decision record — deliberate, owner-noted)',
    hist.some(x => x.id === e1r.id && /^Cancelled by /.test(x.resolution_comment || '')));
  session = { id: 3, username: 'reader', role: 'readonly' };
  fail += !check('doc-history rejects readonly (same gate as doc-routes)',
    threwCode(() => H['workflow-doc-history']({}, { documentId: 1 }), 'FORBIDDEN'));
  // Box lists: stamped_path is SWAPPED for has_stamped before crossing to any renderer.
  session = { id: 1, username: 'admin', role: 'admin' };
  db.prepare(`UPDATE document_routes SET stamped_path='C:/somewhere/stamp.pdf' WHERE id=?`).run(e1r.id);
  const sentRows = H['workflow-sent']({});
  fail += !check('box lists carry has_stamped=true and NEVER the raw stamped_path',
    sentRows.some(x => x.id === e1r.id && x.has_stamped === true)
    && sentRows.every(x => !('stamped_path' in x)));
  // Stamped-pages authorization: a NON-party, non-admin session is FORBIDDEN even when
  // logged in + entitled (the viewer's real gate lives server-side; async handler → the
  // rejection must be awaited, never try/caught synchronously).
  session = { id: 9, username: 'outsider', role: 'edit' };
  const stampedForbidden = await H['workflow-stamped-pages']({}, { routeId: e1r.id })
    .then(() => false).catch((err) => err && err.code === 'FORBIDDEN');
  fail += !check('stamped-pages FORBIDDEN for a non-party non-admin (party-or-admin gate)',
    stampedForbidden === true);

  db.close();
  console.log(fail ? `\n${fail} check(s) FAILED` : '\nAll workflow-IPC checks passed.');
  return fail ? 1 : 0;
}

main().then((code) => process.exit(code));
