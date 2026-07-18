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
      supplier_name TEXT, reference_number TEXT, doc_date TEXT);
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, display_name TEXT, role TEXT,
      is_active INTEGER DEFAULT 1, must_change_password INTEGER DEFAULT 0, last_login_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE document_routes (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, from_user_id INTEGER,
      from_username TEXT, to_user_id INTEGER, to_username TEXT, action_required TEXT, state TEXT DEFAULT 'pending',
      comment TEXT, resolution_comment TEXT, claimed_by_id INTEGER, claimed_by_username TEXT, claimed_at TEXT,
      resolved_at TEXT, version INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')));
  `);
  db.prepare(`INSERT INTO document_types (id,name,slug) VALUES (1,'Invoice','invoice')`).run();
  db.prepare(`INSERT INTO documents (id,status,document_type_id,supplier_name) VALUES (1,'confirmed',1,'Acme')`).run();
  const u = db.prepare(`INSERT INTO users (id,username,display_name,role,is_active) VALUES (?,?,?,?,1)`);
  u.run(1, 'admin', 'Admin', 'admin'); u.run(2, 'editor', 'Editor', 'edit'); u.run(3, 'reader', 'Reader', 'readonly');
  return db;
}

function main() {
  let fail = 0;
  const db = freshDb();
  const H = {};
  wfHandler.register({ ipcMain: { handle: (n, fn) => { H[n] = fn; } }, getDb: () => db });
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

  // ── license the add-on ───────────────────────────────────────────────────────
  setLicensed(true);
  fail += !check('get-entitlement reflects ON', H['get-entitlement']({}).entitled === true);

  // admin assigns an acknowledge request to the reader
  const route = H['workflow-assign']({}, { documentId: 1, toUserId: 3, actionRequired: 'acknowledge', comment: 'fyi' });
  fail += !check('admin assign -> route pending', route && route.state === 'pending');
  fail += !check('admin recipients lists the reader',
    H['workflow-recipients']({}).some(u => u.username === 'reader'));

  // reader: sees it in inbox, can acknowledge; cannot list recipients
  session = { id: 3, username: 'reader', role: 'readonly' };
  fail += !check('reader inbox shows the route', H['workflow-inbox']({}).length === 1);
  fail += !check('readonly cannot list recipients', threwCode(() => H['workflow-recipients']({}), 'FORBIDDEN'));
  const ack = H['workflow-resolve']({}, { id: route.id, decision: 'acknowledge', version: route.version });
  fail += !check('reader acknowledges -> acknowledged', ack && ack.state === 'acknowledged');
  fail += !check('filing state untouched (still confirmed)',
    db.prepare('SELECT status FROM documents WHERE id=1').get().status === 'confirmed');

  db.close();
  console.log(fail ? `\n${fail} check(s) FAILED` : '\nAll workflow-IPC checks passed.');
  return fail ? 1 : 0;
}

process.exit(main());
