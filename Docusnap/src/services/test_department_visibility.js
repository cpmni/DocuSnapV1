'use strict';
/**
 * test_department_visibility.js — Departments enforcement core (D2). Pins:
 *  §1 EMPTY = byte-identical: no departments → visibleDocSql '' and departmentDecision inert (every doc allowed).
 *  §2 the per-doc tag decision: shared(NULL)→all; tagged→member+admin+all_departments only; outsider denied.
 *  §3 the visibleDocSql fragment: a list reader shows shared+own to a member, shared-only to an outsider, all to admin.
 *  §4 CONSISTENCY (eric A.2 / D-C5): for every confirmed doc, canAccessDocument(u,id).allow === (id ∈ the list u sees).
 *     A mutation control: deleting the fragment from the "reader" breaks the consistency (the pin isn't vacuous).
 *  §5 setDocumentDepartment WIDENING rule: edit narrows to own dept; edit CANNOT widen to NULL / a foreign dept; admin can.
 *  §6 deleteDepartment refused while referenced (fail-closed); retire still restricts.
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/services/test_department_visibility.js
 */
const Database = require('better-sqlite3');
const { runMigrations } = require('../../database/index');
const access = require('./accessService');
const dept = require('./departmentService');

let fails = 0;
const check = (l, c) => { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}`); if (!c) fails++; };
const allow = (db, u, id) => access.canAccessDocument(db, u, id).allow;

function seed() {
  const db = new Database(':memory:');
  runMigrations(db);
  let _un = 0;
  const uid = (role, all = 0) => { const u = `u${++_un}`;
    return db.prepare('INSERT INTO users (username, display_name, password_hash, role, all_departments) VALUES (?, ?, ?, ?, ?)').run(u, u, 'x', role, all).lastInsertRowid; };
  const admin = { role: 'admin', id: uid('admin') };
  const editFin = { role: 'edit', id: uid('edit') };
  const editNone = { role: 'edit', id: uid('edit') };
  const acct = { role: 'edit', id: uid('edit', 1) };            // all_departments = the accountant
  const ro = { role: 'readonly', id: uid('readonly') };
  const mkDoc = (deptId) => db.prepare("INSERT INTO documents (original_filename, folder_path, status, department_id) VALUES ('d.pdf','/in','confirmed',?)").run(deptId).lastInsertRowid;
  return { db, admin, editFin, editNone, acct, ro, mkDoc };
}

console.log('§1 EMPTY (no departments) — byte-identical: fragment empty, every doc allowed');
{
  const { db, editNone, mkDoc } = seed();
  const shared = mkDoc(null);
  check('visibleDocSql = "" when no departments exist', dept.visibleDocSql(db, editNone) === '');
  check('edit sees the untagged doc (inert)', allow(db, editNone, shared));
}

console.log('§2 tag decision — shared→all; tagged→member/admin/all_departments only');
{
  const { db, admin, editFin, editNone, acct, ro, mkDoc } = seed();
  const fin = dept.createDepartment(db, admin, 'Finance').id;
  const hr = dept.createDepartment(db, admin, 'HR').id;
  dept.setMembership(db, admin, editFin.id, [fin]);
  dept.setMembership(db, admin, ro.id, [fin]);
  const shared = mkDoc(null), finDoc = mkDoc(fin), hrDoc = mkDoc(hr);
  check('shared (NULL) doc visible to everyone', allow(db, editFin, shared) && allow(db, editNone, shared) && allow(db, ro, shared));
  check('Finance doc: the Finance member (edit) sees it', allow(db, editFin, finDoc));
  check('Finance doc: an edit user in NO department is DENIED', !allow(db, editNone, finDoc) && access.canAccessDocument(db, editNone, finDoc).reason === 'department_restricted');
  check('Finance doc: an HR-only... (editFin not in HR) — HR doc DENIED to the Finance member', !allow(db, editFin, hrDoc));
  check('admin sees every tagged doc', allow(db, admin, finDoc) && allow(db, admin, hrDoc));
  check('all_departments (accountant) sees every tagged doc, without being admin', acct.role !== 'admin' && allow(db, acct, finDoc) && allow(db, acct, hrDoc));
  check('readonly Finance member sees the confirmed Finance doc', allow(db, ro, finDoc));
  check('readonly NON-member denied the HR doc', !allow(db, ro, hrDoc));
}

console.log('§3 visibleDocSql fragment — a list reader shows the right set');
{
  const { db, admin, editFin, editNone, acct, mkDoc } = seed();
  const fin = dept.createDepartment(db, admin, 'Finance').id;
  const hr = dept.createDepartment(db, admin, 'HR').id;
  dept.setMembership(db, admin, editFin.id, [fin]);
  const shared = mkDoc(null), finDoc = mkDoc(fin), hrDoc = mkDoc(hr);
  const listFor = (u) => db.prepare(`SELECT id FROM documents d WHERE status='confirmed'${dept.visibleDocSql(db, u)}`).all().map(r => r.id).sort();
  check('member (Finance): shared + Finance, NOT HR', listFor(editFin).join() === [shared, finDoc].sort().join());
  check('outsider (no dept): shared only', listFor(editNone).join() === String(shared));
  check('admin: all three (fragment empty)', listFor(admin).join() === [shared, finDoc, hrDoc].sort().join());
  check('accountant (all_departments): all three', listFor(acct).join() === [shared, finDoc, hrDoc].sort().join());
}

console.log('§4 CONSISTENCY — canAccessDocument.allow === (doc in the list) for every confirmed doc + a mutation control');
{
  const { db, admin, editFin, editNone, acct, mkDoc } = seed();
  const fin = dept.createDepartment(db, admin, 'Finance').id;
  const hr = dept.createDepartment(db, admin, 'HR').id;
  dept.setMembership(db, admin, editFin.id, [fin]);
  const docs = [mkDoc(null), mkDoc(fin), mkDoc(hr)];
  const listSet = (u, frag) => new Set(db.prepare(`SELECT id FROM documents d WHERE status='confirmed'${frag(db, u)}`).all().map(r => r.id));
  let consistent = true;
  for (const u of [admin, editFin, editNone, acct]) {
    const seen = listSet(u, dept.visibleDocSql);
    for (const id of docs) if (allow(db, u, id) !== seen.has(id)) consistent = false;
  }
  check('gate === list for every (user, confirmed doc)', consistent);
  // mutation control: a "reader" that DROPS the fragment leaks the HR/Finance docs to the outsider →
  // consistency must BREAK (proves §4 is not vacuous).
  const noFrag = () => '';
  const outsiderSeesAll = listSet(editNone, noFrag).size === 3;
  const brokenForOutsider = docs.some(id => allow(db, editNone, id) !== listSet(editNone, noFrag).has(id));
  check('control: deleting the fragment makes the reader inconsistent (leaks tagged docs)', outsiderSeesAll && brokenForOutsider);
}

console.log('§5 setDocumentDepartment — the widening rule (edit narrows own; admin widens)');
{
  const { db, admin, editFin, editNone, mkDoc } = seed();
  const fin = dept.createDepartment(db, admin, 'Finance').id;
  const hr = dept.createDepartment(db, admin, 'HR').id;
  dept.setMembership(db, admin, editFin.id, [fin]);
  const d1 = mkDoc(null);
  check('edit member tags a shared doc INTO its own department (narrowing)', dept.setDocumentDepartment(db, editFin, d1, fin).ok === true);
  check('  → department_set_by recorded as user', db.prepare('SELECT department_set_by s FROM documents WHERE id=?').get(d1).s === 'user');
  check('edit CANNOT widen back to NULL (shared) — admin only', dept.setDocumentDepartment(db, editFin, d1, null).error === 'widen_admin_only');
  check('edit CANNOT move to a FOREIGN department (HR)', dept.setDocumentDepartment(db, editFin, d1, hr).error === 'widen_admin_only');
  check('edit in NO department cannot tag at all (widen_admin_only — shared→dept it is not in)', dept.setDocumentDepartment(db, editNone, mkDoc(null), fin).error === 'widen_admin_only');
  check('admin CAN widen to NULL', dept.setDocumentDepartment(db, admin, d1, null).ok === true && db.prepare('SELECT department_id x FROM documents WHERE id=?').get(d1).x === null);
  check('readonly refused outright', dept.setDocumentDepartment(db, { role: 'readonly', id: 999 }, d1, fin).error === 'forbidden');
}

console.log('§6 delete refused while referenced; retire still restricts');
{
  const { db, admin, editNone, mkDoc } = seed();
  const fin = dept.createDepartment(db, admin, 'Finance').id;
  const finDoc = mkDoc(fin);
  check('deleteDepartment refused while a doc references it (fail-closed)', dept.deleteDepartment(db, admin, fin).error === 'in_use');
  check('retireDepartment succeeds and the doc STILL restricts an outsider', dept.retireDepartment(db, admin, fin).ok && !allow(db, editNone, finDoc));
  // clear the tag, then delete succeeds
  dept.setDocumentDepartment(db, admin, finDoc, null);
  check('delete succeeds once nothing references it', dept.deleteDepartment(db, admin, fin).ok === true);
}

console.log('§7 documents.search honours the threaded viewer (the main list surface)');
{
  const { db, admin, editFin, editNone, mkDoc } = seed();
  const documents = require('../../database/modules/documents');
  const fin = dept.createDepartment(db, admin, 'Finance').id;
  const hr = dept.createDepartment(db, admin, 'HR').id;
  dept.setMembership(db, admin, editFin.id, [fin]);
  const shared = mkDoc(null), finDoc = mkDoc(fin), hrDoc = mkDoc(hr);
  const ids = (u) => documents.search(db, { viewer: u }).map(r => r.id).sort();
  check('search: member sees shared+Finance, NOT HR', ids(editFin).join() === [shared, finDoc].sort().join());
  check('search: outsider sees shared only', ids(editNone).join() === String(shared));
  check('search: admin sees all three', ids(admin).join() === [shared, finDoc, hrDoc].sort().join());
  // With departments PRESENT, an un-threaded caller fails CLOSED to shared-only (safe under-show — this is
  // WHY the sweep must thread every list reader; it never LEAKS a tagged doc). Not byte-identical here.
  check('search: departments present + NO viewer → shared-only (fail-closed, never a leak)', documents.search(db, {}).length === 1);
  // The true inert guarantee: with NO departments configured, an un-threaded caller is byte-identical.
  const { db: db2, mkDoc: mk2 } = seed();
  mk2(null); mk2(null); mk2(null);
  check('search: NO departments → un-threaded caller returns all (byte-identical)', documents.search(db2, {}).length === 3);
}

console.log('§8 source contract — the by-id open path runs the per-doc gate (D2 §6, F3)');
{
  const fs = require('fs'); const path = require('path');
  const h = fs.readFileSync(path.join(__dirname, '..', 'modules', 'processing', 'handler.js'), 'utf8');
  const i = h.indexOf('_openResolvedDoc = ');
  const seg = i >= 0 ? h.slice(i, i + 1200) : '';
  check('_openResolvedDoc calls canAccessDocument(getCurrentUser) before opening the file',
    /canAccessDocument\(db,\s*getCurrentUser\(\)/.test(seg));
}

console.log(`\n${fails ? 'FAIL' : 'PASS'} — ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
