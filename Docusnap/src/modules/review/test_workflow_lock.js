#!/usr/bin/env node
'use strict';

/**
 * src/modules/review/test_workflow_lock.js
 * Stage 5b reconciliation: proves the REAL review/handler 'defer-document' refuses
 * to mutate a document that has an OPEN approval route (workflow_lock), for an
 * edit user — while an admin may override. Registers the real handler with a fake
 * auth module (require.cache) and an in-memory DB, mirroring test_search_contract.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/review/test_workflow_lock.js
 */

const Database = require('better-sqlite3');

let role = 'edit';
const fakeAuth = {
  requireLogin() { return { id: 1, username: 'u', role }; },
  requireRole(...roles) {
    if (!roles.includes(role)) throw Object.assign(new Error('forbidden'), { code: 'FORBIDDEN' });
    return { id: 1, username: 'u', role };
  },
  hasRole(...roles) { return roles.includes(role); },
  getCurrentUser() { return { id: 1, username: 'u', role }; },
  logAudit() {},
};
const authPath = require.resolve('../auth/handler');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: fakeAuth };

const reviewHandler = require('./handler');

function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); return cond; }

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE documents (id INTEGER PRIMARY KEY, status TEXT, working_path TEXT,
      folder_path TEXT, original_filename TEXT);
    CREATE TABLE document_routes (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER,
      state TEXT DEFAULT 'pending', action_required TEXT);
  `);
  db.prepare(`INSERT INTO documents (id,status) VALUES (1,'needs_review'),(2,'needs_review')`).run();
  // doc 1 has an OPEN APPROVE route (locked); doc 2 has none. (action_required added for the
  // FYI slice — the lock predicate reads it; an 'acknowledge' route would NOT lock.)
  db.prepare(`INSERT INTO document_routes (document_id,state,action_required) VALUES (1,'pending','approve')`).run();
  return db;
}

function main() {
  let fail = 0;
  const db = freshDb();
  const handlers = {};
  reviewHandler.register({
    ipcMain: { handle: (n, fn) => { handlers[n] = fn; }, on: () => {} },
    getDb: () => db,
    notifyMainWindow: () => {},
    path: require('path'), fs: require('fs'), spawn: () => {},
    pythonExe: () => '', pythonArgs: () => [], tesseractPath: () => '',
    resourcePath: () => '', logger: { log() {}, warn() {} },
  });
  const defer = handlers['defer-document'];

  // edit user, locked doc -> blocked
  role = 'edit';
  let threw = false, code = null;
  try { defer({}, 1); } catch (e) { threw = true; code = e.code; }
  fail += !check('edit user blocked on a locked doc (WORKFLOW_LOCKED)', threw && code === 'WORKFLOW_LOCKED');
  fail += !check('locked doc was NOT mutated', db.prepare('SELECT status FROM documents WHERE id=1').get().status === 'needs_review');

  // edit user, unlocked doc -> allowed
  let ok = false;
  try { defer({}, 2); ok = true; } catch { ok = false; }
  fail += !check('edit user allowed on an unlocked doc', ok && db.prepare('SELECT status FROM documents WHERE id=2').get().status === 'deferred');

  // admin override on the locked doc -> allowed
  role = 'admin';
  let ovr = false;
  try { defer({}, 1); ovr = true; } catch { ovr = false; }
  fail += !check('admin overrides the lock', ovr && db.prepare('SELECT status FROM documents WHERE id=1').get().status === 'deferred');

  db.close();
  console.log(fail ? `\n${fail} check(s) FAILED` : '\nAll workflow-lock reconciliation checks passed.');
  return fail ? 1 : 0;
}

process.exit(main());
