'use strict';
/**
 * test_department_multi_migration.js — Departments D7 (multi-department) the LOAD-BEARING migration pin
 * (Oracle 2026-09-18 gate item 1). A fresh-install test can't exercise the backfill (empty `documents` at
 * migration time), so this SIMULATES an upgrade: seed the OLD single-department scalars, fire the REAL mig 184,
 * and assert the scalar→join backfill is exact + the gate is BYTE-IDENTICAL to the legacy scalar rule + no
 * reader still reads the scalar + the migration is atomic + idempotent.
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/services/test_department_multi_migration.js
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { runMigrations } = require('../../database/index');
const dv = require('../../database/modules/departmentVisibility');
const documents = require('../../database/modules/documents');

let fails = 0;
const check = (l, c) => { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}`); if (!c) fails++; };

// A fully-migrated DB, then rolled BACK to pre-D7 (drop the join, un-stamp 184) so re-running fires the backfill.
function preD7() {
  const db = new Database(':memory:');
  runMigrations(db);                                   // includes mig 184 (join empty, scalars null)
  db.prepare('DELETE FROM migrations WHERE version = 184').run();
  db.exec('DROP TABLE IF EXISTS document_departments');
  db.exec('DROP TABLE IF EXISTS document_type_departments');
  return db;
}
const uid = (db, role, all = 0) => db.prepare('INSERT INTO users (username, display_name, password_hash, role, all_departments) VALUES (?,?,?,?,?)')
  .run('u' + Math.random().toString(36).slice(2, 8), 'u', 'x', role, all).lastInsertRowid;

console.log('§1 upgrade simulator — seed the OLD scalar, fire mig 184, assert backfill + byte-identical gate');
{
  const db = preD7();
  const admin = { role: 'admin', id: uid(db, 'admin') };
  const editFin = { role: 'edit', id: uid(db, 'edit') };
  const editHr = { role: 'edit', id: uid(db, 'edit') };
  const editNone = { role: 'edit', id: uid(db, 'edit') };
  const acct = { role: 'edit', id: uid(db, 'edit', 1) };
  const fin = db.prepare("INSERT INTO departments (name, slug) VALUES ('Finance','finance')").run().lastInsertRowid;
  const hr = db.prepare("INSERT INTO departments (name, slug) VALUES ('HR','hr')").run().lastInsertRowid;
  db.prepare('INSERT INTO user_departments (user_id, department_id) VALUES (?,?)').run(editFin.id, fin);
  db.prepare('INSERT INTO user_departments (user_id, department_id) VALUES (?,?)').run(editHr.id, hr);
  // Docs tagged through the OLD scalar column.
  const mk = (deptId) => db.prepare("INSERT INTO documents (original_filename, folder_path, status, department_id) VALUES ('d.pdf','/in','confirmed',?)").run(deptId).lastInsertRowid;
  const finDoc = mk(fin), hrDoc = mk(hr), sharedDoc = mk(null);
  const tFin = db.prepare("INSERT INTO document_types (name, slug, built_in, default_department_id) VALUES ('T1','t1',0,?)").run(fin).lastInsertRowid;
  const tNone = db.prepare("INSERT INTO document_types (name, slug, built_in) VALUES ('T2','t2',0)").run().lastInsertRowid;

  // Snapshot the scalar truth + the LEGACY oracle BEFORE the migration nulls it.
  const members = (u) => new Set(db.prepare('SELECT department_id d FROM user_departments WHERE user_id=?').all(u.id).map(r => r.d));
  const scalarOf = new Map(db.prepare('SELECT id, department_id FROM documents').all().map(r => [r.id, r.department_id]));
  const users = [admin, editFin, editHr, editNone, acct];
  const legacyDeny = (u, docId) => {
    const dep = scalarOf.get(docId);
    if (dep == null) return false;                        // shared
    if (u.role === 'admin') return false;
    if (u.all_departments || (u === acct)) return false;
    return !members(u).has(dep);
  };
  const legacyList = (u) => new Set([...scalarOf.keys()].filter(id => !legacyDeny(u, id)));

  // FIRE the real migration.
  runMigrations(db);

  // (a) backfill exactness
  const dd = db.prepare('SELECT document_id, department_id FROM document_departments ORDER BY document_id').all();
  check('join has exactly the tagged docs (finDoc→fin, hrDoc→hr), sharedDoc absent',
    dd.length === 2 && dd.some(r => r.document_id === finDoc && r.department_id === fin) && dd.some(r => r.document_id === hrDoc && r.department_id === hr) && !dd.some(r => r.document_id === sharedDoc));
  const tdd = db.prepare('SELECT document_type_id, department_id FROM document_type_departments').all();
  check('type-default join mirrors default_department_id (tFin→fin only)', tdd.length === 1 && tdd[0].document_type_id === tFin && tdd[0].department_id === fin && tNone === tNone);
  // (b) scalars nulled (retired in place)
  check('documents.department_id all NULL after migration', db.prepare('SELECT COUNT(*) n FROM documents WHERE department_id IS NOT NULL').get().n === 0);
  check('document_types.default_department_id all NULL', db.prepare('SELECT COUNT(*) n FROM document_types WHERE default_department_id IS NOT NULL').get().n === 0);
  // (c) BYTE-IDENTICAL gate: new join-based decision === legacy scalar decision, for every (user × doc)
  let decMismatch = 0;
  for (const u of users) for (const id of scalarOf.keys()) {
    const doc = documents.getById(db, id);
    if (dv.decision(db, u, doc).deny !== legacyDeny(u, id)) decMismatch++;
  }
  check('decision(new join) === decision(legacy scalar) for every (user × doc)', decMismatch === 0);
  // (d) BYTE-IDENTICAL list: visibleDocSql result set === legacy list, per user
  let listMismatch = 0;
  for (const u of users) {
    const got = new Set(documents.search(db, { viewer: u }).map(r => r.id));
    const want = legacyList(u);
    if (got.size !== want.size || [...want].some(id => !got.has(id))) listMismatch++;
  }
  check('search(viewer) result set === legacy list, per user', listMismatch === 0);

  // (e) idempotency — re-running changes nothing
  db.prepare('DELETE FROM migrations WHERE version = 184').run();
  runMigrations(db);
  check('idempotent: re-applying 184 leaves the join unchanged', db.prepare('SELECT COUNT(*) n FROM document_departments').get().n === 2);
}

console.log('§2 source-contract — the gate reads the JOIN, not the retired scalar; migration is transactional');
{
  const gate = fs.readFileSync(path.join(__dirname, '../../database/modules/departmentVisibility.js'), 'utf8');
  // The retired scalar's OLD clause forms must be gone (the new gate uses NOT EXISTS over the join).
  check('departmentVisibility no longer uses the old scalar clauses', !/department_id IS NULL|department_id IN \(SELECT/.test(gate));
  check('departmentVisibility queries document_departments', /document_departments/.test(gate));
  const idx = fs.readFileSync(path.join(__dirname, '../../database/index.js'), 'utf8');
  check('mig 184 is wrapped in db.transaction (atomic)', /migration 184[\s\S]{0,2600}db\.transaction\(\(\)\s*=>/.test(idx));
  check('mig 184 NULLs the scalars after backfill', /UPDATE documents SET department_id = NULL/.test(idx) && /UPDATE document_types SET default_department_id = NULL/.test(idx));
}

console.log('§3 empty install — byte-identical inert (no departments)');
{
  const db = new Database(':memory:'); runMigrations(db);
  const editNone = { role: 'edit', id: uid(db, 'edit') };
  db.prepare("INSERT INTO documents (original_filename, folder_path, status) VALUES ('a.pdf','/in','confirmed')").run();
  db.prepare("INSERT INTO documents (original_filename, folder_path, status) VALUES ('b.pdf','/in','needs_review')").run();
  check('no departments → visibleDocSql = ""', dv.visibleDocSql(db, editNone) === '');
  check('no departments → every doc visible', documents.search(db, { viewer: editNone }).length === db.prepare("SELECT COUNT(*) n FROM documents WHERE status='confirmed'").get().n);
}

console.log(fails ? `\nFAILED (${fails})` : '\nALL PASS');
process.exit(fails ? 1 : 0);
