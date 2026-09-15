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
 *  §7 documents.search honours the threaded viewer.
 *  §8 the by-id open path runs the per-doc gate.
 *  §9 the list/count READER sweep (getReviewQueue/Count, getByIds, getDeferred/StuckCount/Queue) honours the viewer + SYSTEM_ACTOR control.
 *  §10 recycle bin scoped by department DECISION (canAccessDocument short-circuits deleted → the bin/restore gate keys on decision).
 *  §11 getReviewSplit(viewer).total === getReviewCount(viewer) (D-C? no badge flicker).
 *  §12 SYSTEM_ACTOR contract + source (unfiltered read is explicit; the sweep IPC handlers pass the operator, never SYSTEM_ACTOR).
 *  §13 per-doc WRITE gates (Oracle cond 2): defer/delete/restore-deferred + restore-document's deleted-path twin.
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

console.log('§9 the list/count reader sweep honours the viewer (+ SYSTEM_ACTOR control)');
{
  const { db, admin, editFin, editNone } = seed();
  const documents = require('../../database/modules/documents');
  const dv = require('../../database/modules/departmentVisibility');
  const mk = (st, d) => db.prepare("INSERT INTO documents (original_filename, folder_path, status, department_id) VALUES ('d.pdf','/in',?,?)").run(st, d).lastInsertRowid;
  const fin = dept.createDepartment(db, admin, 'Finance').id;
  const hr  = dept.createDepartment(db, admin, 'HR').id;
  dept.setMembership(db, admin, editFin.id, [fin]);
  const rvShared = mk('needs_review', null), rvFin = mk('needs_review', fin), rvHr = mk('needs_review', hr);
  const qids = (u) => documents.getReviewQueue(db, u).map(r => r.id).sort();
  check('getReviewQueue: member sees shared+Finance, not HR', qids(editFin).join() === [rvShared, rvFin].sort().join());
  check('getReviewQueue: outsider sees shared only', qids(editNone).join() === String(rvShared));
  check('getReviewQueue: admin sees all', qids(admin).join() === [rvShared, rvFin, rvHr].sort().join());
  check('getReviewCount: member=2, outsider=1, admin=3',
    documents.getReviewCount(db, editFin) === 2 && documents.getReviewCount(db, editNone) === 1 && documents.getReviewCount(db, admin) === 3);
  check('getByIds: outsider passing all three ids gets only the shared row back (drops tagged)',
    documents.getByIds(db, [rvShared, rvFin, rvHr], editNone).map(r => r.id).join() === String(rvShared));
  mk('deferred', fin); mk('deferred', null);
  check('getDeferredCount: outsider = 1 (shared only)', documents.getDeferredCount(db, editNone) === 1);
  mk('error', fin); mk('error', null);
  check('getStuckCount/getStuckQueue: outsider = 1', documents.getStuckCount(db, editNone) === 1 && documents.getStuckQueue(db, editNone).length === 1);
  check('control: SYSTEM_ACTOR read is unfiltered (all 3 review docs)', documents.getReviewCount(db, dv.SYSTEM_ACTOR) === 3);
}

console.log('§10 recycle bin scoped by department DECISION (canAccessDocument short-circuits deleted)');
{
  const { db, admin, editFin, editNone } = seed();
  const documents = require('../../database/modules/documents');
  const dv = require('../../database/modules/departmentVisibility');
  const mk = (d) => db.prepare("INSERT INTO documents (original_filename, folder_path, status, department_id) VALUES ('d.pdf','/in','deleted',?)").run(d).lastInsertRowid;
  const fin = dept.createDepartment(db, admin, 'Finance').id;
  const hr  = dept.createDepartment(db, admin, 'HR').id;
  dept.setMembership(db, admin, editFin.id, [fin]);
  const delShared = mk(null), delFin = mk(fin), delHr = mk(hr);
  const binIds = (u) => documents.getDeletedQueue(db, u).map(r => r.id).sort();
  check('bin: member sees shared+Finance deleted, not HR', binIds(editFin).join() === [delShared, delFin].sort().join());
  check('bin: outsider sees shared-deleted only', binIds(editNone).join() === String(delShared));
  check('canAccessDocument denies ALL deleted to non-admin regardless of dept (why the bin gate uses decision)',
    !access.canAccessDocument(db, editFin, delFin).allow && access.canAccessDocument(db, editFin, delFin).reason === 'deleted');
  const doc = (id) => documents.getById(db, id);
  check('restore gate (decision): member may restore its Finance deleted doc', dv.decision(db, editFin, doc(delFin)).deny === false);
  check('restore gate (decision): member may restore a SHARED deleted doc', dv.decision(db, editFin, doc(delShared)).deny === false);
  check('restore gate (decision): outsider DENIED restoring a Finance deleted doc', dv.decision(db, editNone, doc(delFin)).deny === true);
  check('restore gate (decision): admin may restore any', dv.decision(db, admin, doc(delHr)).deny === false);
}

console.log('§11 getReviewSplit(viewer).total === getReviewCount(viewer) — same fragment, no badge flicker');
{
  const { db, admin, editFin, editNone } = seed();
  const documents = require('../../database/modules/documents');
  const mk = (d) => db.prepare("INSERT INTO documents (original_filename, folder_path, status, department_id) VALUES ('d.pdf','/in','needs_review',?)").run(d).lastInsertRowid;
  const fin = dept.createDepartment(db, admin, 'Finance').id;
  dept.setMembership(db, admin, editFin.id, [fin]);
  mk(null); mk(fin); mk(dept.createDepartment(db, admin, 'HR').id);
  for (const u of [admin, editFin, editNone])
    check(`split.total === count for ${u.role} ${u.id}`, documents.getReviewSplit(db, u).total === documents.getReviewCount(db, u));
}

console.log('§12 SYSTEM_ACTOR contract + source — an unfiltered read is EXPLICIT, never the reader default');
{
  const { db, admin } = seed();
  const dv = require('../../database/modules/departmentVisibility');
  dept.createDepartment(db, admin, 'Finance');   // configured
  check('visibleDocSql(SYSTEM_ACTOR) === "" even when configured', dv.visibleDocSql(db, dv.SYSTEM_ACTOR) === '');
  check('decision(SYSTEM_ACTOR) never denies', dv.decision(db, dv.SYSTEM_ACTOR, { department_id: 999 }).deny === false);
  const fs = require('fs'); const path = require('path');
  const rh = fs.readFileSync(path.join(__dirname, '..', 'modules', 'review', 'handler.js'), 'utf8');
  check('get-review-queue passes getCurrentUser(), not SYSTEM_ACTOR',
    /get-review-queue'[\s\S]*?getReviewQueue\(getDb\(\), getCurrentUser\(\)\)/.test(rh));
  check('SYSTEM_ACTOR referenced exactly once in review/handler.js (the documented filing-housekeeping site)',
    (rh.match(/SYSTEM_ACTOR/g) || []).length === 1);
}

console.log('§13 per-doc write gates (Oracle cond 2) — defer/delete/restore-deferred + the deleted-path twin');
{
  const fs = require('fs'); const path = require('path');
  const rh = fs.readFileSync(path.join(__dirname, '..', 'modules', 'review', 'handler.js'), 'utf8');
  const seg = (name) => { const i = rh.indexOf(`ipcMain.handle('${name}'`); return i >= 0 ? rh.slice(i, i + 500) : ''; };
  check('defer-document asserts per-doc access',       /_assertDocAccess\(db, sess, docId\)/.test(seg('defer-document')));
  check('restore-deferred asserts per-doc access',     /_assertDocAccess\(db, sess, docId\)/.test(seg('restore-deferred')));
  check('delete-document asserts per-doc access',      /_assertDocAccess\(db, sess, docId\)/.test(seg('delete-document')));
  check('restore-document uses the DELETED-path gate (decision-direct, not canAccessDocument)',
    /_assertDeletedDocAccess\(db, sess, docId\)/.test(seg('restore-document')));
}

console.log('§14 scope-wide learning is DELIBERATELY department-blind (Oracle cond 5)');
{
  const { db, admin } = seed();
  const documents = require('../../database/modules/documents');
  const invId = db.prepare("INSERT INTO document_types (name, slug, built_in) VALUES ('Invoice','invoice',1)").run().lastInsertRowid;
  const fin = dept.createDepartment(db, admin, 'Finance').id;
  const hr  = dept.createDepartment(db, admin, 'HR').id;
  const mk = (d) => db.prepare("INSERT INTO documents (original_filename, folder_path, status, supplier_name, document_type_id, department_id) VALUES ('d.pdf','/in','confirmed','Acme',?,?)").run(invId, d).lastInsertRowid;
  const a = mk(fin), b = mk(hr), c = mk(null);
  const res = documents.requeueConfirmedDocsForScope(db, { supplier_name: 'Acme', document_type_slug: 'invoice' });
  const st = (id) => db.prepare('SELECT status s FROM documents WHERE id=?').get(id).s;
  check('requeue moves ALL scope docs across departments (Finance+HR+shared) → un-learn is scope-wide, not viewer-scoped',
    st(a) === 'needs_review' && st(b) === 'needs_review' && st(c) === 'needs_review' && res.changes === 3);
}

console.log('§15 D-C11 — count broadcasts are viewer-scoped + no raw global broadcaster remains');
{
  const { db, admin, editFin, editNone } = seed();
  const cb = require('../lib/countBroadcast');
  const mk = (d) => db.prepare("INSERT INTO documents (original_filename, folder_path, status, department_id) VALUES ('d.pdf','/in','needs_review',?)").run(d).lastInsertRowid;
  const fin = dept.createDepartment(db, admin, 'Finance').id;
  dept.setMembership(db, admin, editFin.id, [fin]);
  mk(null); mk(fin); mk(dept.createDepartment(db, admin, 'HR').id);
  const cap = () => { const out = {}; return { notify: (ch, n) => { out[ch] = n; }, out }; };
  let c = cap(); cb.broadcastCounts(c.notify, db, editFin);
  check('broadcastCounts(member): review = shared+Finance = 2', c.out['review-count-changed'] === 2);
  c = cap(); cb.broadcastCounts(c.notify, db, editNone);
  check('broadcastCounts(outsider): review = shared only = 1', c.out['review-count-changed'] === 1);
  c = cap(); cb.broadcastCounts(c.notify, db, admin);
  check('broadcastCounts(admin): review = all = 3', c.out['review-count-changed'] === 3);
  c = cap(); cb.broadcastCounts(c.notify, db, require('../../database/modules/departmentVisibility').SYSTEM_ACTOR);
  check('broadcastCounts(SYSTEM_ACTOR): review = all = 3 (system, unfiltered)', c.out['review-count-changed'] === 3);
  // Source contract: no raw global count broadcaster remains — every desktop count broadcast routes
  // through countBroadcast, so a future edit can't reintroduce a leak-prone global count.
  const fs = require('fs'); const path = require('path');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return (e.isFile() && e.name.endsWith('.js') && !e.name.startsWith('test_')) ? [p] : [];
  });
  const raw = /notify(?:MainWindow|AllWindows)\??\.?\(\s*['"](?:review|deferred|stuck)-count-changed['"]/;
  const offenders = walk(path.join(__dirname, '..', 'modules')).filter(f => raw.test(fs.readFileSync(f, 'utf8')));
  check('no raw notify*(\'*-count-changed\', …) broadcaster left in src/modules (all via countBroadcast)',
    offenders.length === 0 || (console.log('    offenders: ' + offenders.join(', ')), false));
}

console.log(`\n${fails ? 'FAIL' : 'PASS'} — ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
