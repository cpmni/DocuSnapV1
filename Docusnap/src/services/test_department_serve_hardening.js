'use strict';
/**
 * test_department_serve_hardening.js — the 2026-09-18 WATERTIGHT hardening proof (gary + eric → Oracle
 * SIGN-OFF-W/COND). Proves the by-id SERVE/MUTATE + routing paths that were found ungated now DENY the
 * adversary (an edit user in no department), still ALLOW a member/admin, and are byte-identical when no
 * departments exist. Complements test_department_denial_matrix.js (list readers) — this pin is the
 * SERVE/MUTATE surface: reprocess-document, split-pdf (+ child-tag inheritance), the /v1 mutation cluster,
 * restore-of-a-deleted-doc, the workflow-assign SENDER self-grant, and the fail-closed gate.
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/services/test_department_serve_hardening.js
 */
const Database = require('better-sqlite3');
const { runMigrations } = require('../../database/index');
const access = require('./accessService');
const dept   = require('./departmentService');
const dv     = require('../../database/modules/departmentVisibility');
const wfSvc  = require('./workflowService').createWorkflowService({});

let fails = 0;
const check = (l, c) => { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}`); if (!c) fails++; };

let _n = 0;
function mkUser(db, role, all = 0) {
  const id = db.prepare('INSERT INTO users (username, display_name, password_hash, role, all_departments, is_active) VALUES (?,?,?,?,?,1)')
    .run('u' + (++_n) + Math.random().toString(36).slice(2, 6), 'u', 'x', role, all).lastInsertRowid;
  return { role, id, userId: id, username: 'u' + id };
}
function seed() {
  const db = new Database(':memory:');
  runMigrations(db);
  const admin    = mkUser(db, 'admin');
  const editFin  = mkUser(db, 'edit');
  const editNone = mkUser(db, 'edit');            // THE ADVERSARY — writer, no department
  const fin = dept.createDepartment(db, admin, 'Finance').id;
  dept.setMembership(db, admin, editFin.id, [fin]);
  const mk = (status, ...deptIds) => {
    const id = db.prepare("INSERT INTO documents (original_filename, folder_path, status) VALUES ('d.pdf','/in',?)").run(status).lastInsertRowid;
    for (const d of deptIds) db.prepare('INSERT OR IGNORE INTO document_departments (document_id, department_id) VALUES (?,?)').run(id, d);
    return id;
  };
  return { db, admin, editFin, editNone, fin, mk };
}
const allow = (db, u, id) => access.canAccessDocument(db, u, id).allow;

console.log('§1 the shared per-doc gate — reprocess-document / split-pdf / /v1 confirm|defer|undefer|delete|viewing all funnel through canAccessDocument');
{
  const { db, admin, editFin, editNone, fin, mk } = seed();
  const restricted = mk('needs_review', fin);
  const shared     = mk('needs_review');
  const r = access.canAccessDocument(db, editNone, restricted);
  check('adversary DENIED a restricted doc (department_restricted)', r.allow === false && r.reason === 'department_restricted');
  check('a MEMBER is allowed the restricted doc', allow(db, editFin, restricted));
  check('admin is allowed the restricted doc', allow(db, admin, restricted));
  check('adversary CAN act on a shared (untagged) doc — byte-identical', allow(db, editNone, shared));
}

console.log('§2 restore-of-a-DELETED doc gates on the department decision directly (the _assertDeletedDocAccess twin)');
{
  const { db, admin, editFin, editNone, fin, mk } = seed();
  const delRestricted = mk('deleted', fin);
  check('adversary DENIED restoring a deleted restricted doc', dv.decision(db, editNone, { id: delRestricted }).deny === true);
  check('a MEMBER may restore it (decision allows — canAccessDocument would wrongly block a deleted doc)',
    dv.decision(db, editFin, { id: delRestricted }).deny === false && access.canAccessDocument(db, editFin, delRestricted).allow === false);
  check('admin may restore it', dv.decision(db, admin, { id: delRestricted }).deny === false);
  check('a deleted SHARED doc is restorable by anyone (byte-identical)', dv.decision(db, editNone, { id: mk('deleted') }).deny === false);
}

console.log('§3 split-pdf CHILD inheritance — a child of a restricted parent inherits its tags (no laundering to shared)');
{
  const { db, editFin, editNone, fin, mk } = seed();
  // Replicate the handler's inheritance: read the parent's tags, copy them to each child row.
  const inheritToChild = (parentId, status) => {
    const parentDepts = db.prepare('SELECT department_id FROM document_departments WHERE document_id = ?').all(parentId).map(r => r.department_id);
    const childId = db.prepare("INSERT INTO documents (original_filename, folder_path, status) VALUES ('c.pdf','/in',?)").run(status).lastInsertRowid;
    const ins = db.prepare('INSERT OR IGNORE INTO document_departments (document_id, department_id) VALUES (?, ?)');
    for (const d of parentDepts) ins.run(childId, d);
    return childId;
  };
  const child = inheritToChild(mk('confirmed', fin), 'needs_review');
  check('a child of a RESTRICTED parent is DENIED to the adversary (not laundered to shared)', !allow(db, editNone, child));
  check('...and is allowed to a member', allow(db, editFin, child));
  const sharedChild = inheritToChild(mk('confirmed'), 'needs_review');
  check('a child of a SHARED parent stays shared — byte-identical', allow(db, editNone, sharedChild));
}

console.log('§4 fail-CLOSED: a membership-query error on a KNOWN-tagged doc DENIES (was fail-open)');
{
  const db = new Database(':memory:');
  runMigrations(db);
  const admin = mkUser(db, 'admin');
  const editNone = mkUser(db, 'edit');
  const fin = dept.createDepartment(db, admin, 'Finance').id;   // configured() → true
  const doc = db.prepare("INSERT INTO documents (original_filename, folder_path, status) VALUES ('d.pdf','/in','needs_review')").run().lastInsertRowid;
  db.prepare('INSERT INTO document_departments (document_id, department_id) VALUES (?,?)').run(doc, fin);   // tagged
  // Break user_departments so the membership JOIN throws (table still EXISTS → _hasTables passes → configured):
  db.exec('DROP TABLE user_departments');
  db.exec('CREATE TABLE user_departments (department_id INTEGER, broken INTEGER)');   // no user_id column
  check('membership JOIN error on a tagged doc → DENY (fail-closed, not the old fail-open allow)',
    dv.decision(db, editNone, { id: doc }).deny === true);
  check('admin still recovers (admin is exempt BEFORE the query)', dv.decision(db, admin, { id: doc }).deny === false);
}

console.log('§5 _hasTables now requires document_departments — an install missing it is INERT (clean short-circuit), not erroring');
{
  const db = new Database(':memory:');
  runMigrations(db);
  const editNone = mkUser(db, 'edit');
  db.exec('DROP TABLE document_departments');   // simulate a pre-mig-184 / missing-join-table install
  check('configured() is false when document_departments is absent', dv.configured(db) === false);
  check('decision() is inert (deny:false) — never throws on the missing join table', dv.decision(db, editNone, { id: 1 }).deny === false);
}

console.log('§6 workflow-assign SENDER gate — an outsider cannot route a restricted doc to self-grant route_party access');
{
  const { db, admin, editFin, editNone, fin, mk } = seed();
  const restricted = mk('needs_review', fin);
  const asNone = wfSvc.assign(db, editNone, { documentId: restricted, toUserId: editFin.id, actionRequired: 'acknowledge' });
  check('adversary (non-member SENDER) is refused NOT_FOUND — never becomes a route party', asNone.ok === false && asNone.code === 'NOT_FOUND');
  const asFin = wfSvc.assign(db, editFin, { documentId: restricted, toUserId: editFin.id, actionRequired: 'acknowledge' });
  check('a MEMBER may route it (sender gate passes)', asFin.ok === true);
  const asAdmin = wfSvc.assign(db, admin, { documentId: mk('needs_review', fin), toUserId: editFin.id, actionRequired: 'acknowledge' });
  check('admin may route it (sender gate passes)', asAdmin.ok === true);
  const asShared = wfSvc.assign(db, editNone, { documentId: mk('needs_review'), toUserId: editFin.id, actionRequired: 'acknowledge' });
  check('an outsider CAN route a SHARED doc (byte-identical: no NOT_FOUND from the sender gate)', asShared.code !== 'NOT_FOUND');
}

console.log('§7 byte-identical when NO departments exist (the inert-install proof)');
{
  const db = new Database(':memory:');
  runMigrations(db);
  const editFin  = mkUser(db, 'edit');
  const editNone = mkUser(db, 'edit');
  const doc = db.prepare("INSERT INTO documents (original_filename, folder_path, status) VALUES ('d.pdf','/in','needs_review')").run().lastInsertRowid;
  check('no departments → canAccessDocument allows an edit writer (writer)', allow(db, editNone, doc));
  check('no departments → decision inert (deny:false)', dv.decision(db, editNone, { id: doc }).deny === false);
  const as = wfSvc.assign(db, editNone, { documentId: doc, toUserId: editFin.id, actionRequired: 'acknowledge' });
  check('no departments → assign sender gate never blocks (no NOT_FOUND)', as.code !== 'NOT_FOUND');
}

console.log(fails ? `\nFAILED (${fails})` : '\nALL PASS');
process.exit(fails ? 1 : 0);
