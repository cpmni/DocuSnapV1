'use strict';
/**
 * test_workflow_department_gate.js — the ASSIGN-time department gate (D-C1, QuickFile+Departments).
 * A department-restricted document cannot be ROUTED to a recipient outside its department — enforced in
 * the shared _validateAssignTarget, so it covers BOTH assign() (human sender) and assignSystem() (auto).
 * It is the DEPARTMENT decision ONLY (never the full read gate), so it must NOT regress today's routing:
 * a readonly recipient and a needs_review document still route when no department restricts.
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/services/test_workflow_department_gate.js
 */
const Database = require('better-sqlite3');
const { runMigrations } = require('../../database/index');
const { createWorkflowService } = require('./workflowService');

let fails = 0;
const check = (l, c) => { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}`); if (!c) fails++; };

function seed() {
  const db = new Database(':memory:');
  runMigrations(db);
  const mkUser = (role, name) => db.prepare("INSERT INTO users (username, display_name, password_hash, role, is_active) VALUES (?,?,?,?,1)").run(name, name, 'x', role).lastInsertRowid;
  const sender = { id: mkUser('edit', 'sender'), role: 'edit', username: 'sender' };
  const member = mkUser('edit', 'member');
  const outsider = mkUser('edit', 'outsider');
  const roUser = mkUser('readonly', 'ro');
  const mkDoc = (status) => db.prepare("INSERT INTO documents (original_filename, folder_path, status) VALUES ('d.pdf','/in',?)").run(status).lastInsertRowid;
  return { db, sender, member, outsider, roUser, mkDoc };
}

console.log('§1 gate fires — a restricted doc is refused to an outsider (human + system), allowed to a member');
{
  const { db, sender, member, outsider, mkDoc } = seed();
  // Stub the department decision: deny ONLY the outsider; the doc is treated as tagged for everyone else's check.
  const wfsvc = createWorkflowService({
    audit: () => {}, notifyWorkflow: () => {}, canStamp: () => true,
    departmentDecision: (_db, user) => ({ deny: user.id === outsider }),
  });
  const doc = mkDoc('confirmed');
  const toOut = wfsvc.assign(db, sender, { documentId: doc, toUserId: outsider, actionRequired: 'acknowledge' });
  check('assign to an OUTSIDER → RECIPIENT_NO_ACCESS', toOut.ok !== true && toOut.code === 'RECIPIENT_NO_ACCESS');
  const toMem = wfsvc.assign(db, sender, { documentId: mkDoc('confirmed'), toUserId: member, actionRequired: 'acknowledge' });
  check('assign to a MEMBER → succeeds', toMem.ok === true);
  const sysOut = wfsvc.assignSystem(db, { documentId: mkDoc('confirmed'), toUserId: outsider, actionRequired: 'acknowledge' });
  check('assignSystem to an OUTSIDER → RECIPIENT_NO_ACCESS (system routes gated too)', sysOut.ok !== true && sysOut.code === 'RECIPIENT_NO_ACCESS');
}

console.log("§2 D-C1 don't-regress — with NO department restriction, today's routing is byte-identical");
{
  const { db, sender, outsider, roUser, mkDoc } = seed();
  // Default departmentDecision (no departments exist) → {deny:false} → gate inert.
  const wfsvc = createWorkflowService({ audit: () => {}, notifyWorkflow: () => {}, canStamp: () => true });
  check('a readonly recipient still routes (acknowledge)', wfsvc.assign(db, sender, { documentId: mkDoc('confirmed'), toUserId: roUser, actionRequired: 'acknowledge' }).ok === true);
  check('a needs_review doc is still routable', wfsvc.assign(db, sender, { documentId: mkDoc('needs_review'), toUserId: outsider, actionRequired: 'acknowledge' }).ok === true);
  check('the pre-existing NOT_ROUTABLE code is unchanged (a deleted doc)', wfsvc.assign(db, sender, { documentId: mkDoc('deleted'), toUserId: outsider, actionRequired: 'acknowledge' }).code === 'NOT_ROUTABLE');
}

console.log(`\n${fails ? 'FAIL' : 'PASS'} — ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
