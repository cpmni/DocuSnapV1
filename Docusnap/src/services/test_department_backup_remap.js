'use strict';
/**
 * test_department_backup_remap.js — Departments D-C3 (Oracle 2026-09-17 pre-merge gate item 4, highest risk).
 * A backup must never carry a RAW department id across machines: document_types.default_department_id has to be
 * REMAPPED to the target's department by SLUG, and a slug absent on the target must NULL out (→ shared), never
 * point at a foreign department. Departments ride as a slug-keyed parent; upsertParent never deletes, so a
 * fresh-install (empty departments) backup can't wipe local departments.
 *  §1 cross-machine id order: default_department_id lands on the target's SAME-SLUG department, not the raw id.
 *  §2 slug absent on target: default_department_id → NULL (never a foreign dept).
 *  §3 mutation control: a raw-id (no-remap) restore WOULD mis-tag — proves the remap is doing work.
 *  §4 empty-departments backup does NOT wipe the target's local departments (M5-safe).
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/services/test_department_backup_remap.js
 */
const Database = require('better-sqlite3');
const { runMigrations } = require('../../database/index');
const dept = require('./departmentService');
const backup = require('./backupService');

let fails = 0;
const check = (l, c) => { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}`); if (!c) fails++; };
const PW = 'pw-test-123';
const admin = { role: 'admin', id: 1 };

function db0() {
  const db = new Database(':memory:');
  runMigrations(db);
  db.prepare("INSERT INTO users (id, username, display_name, password_hash, role) VALUES (1,'a','a','x','admin')").run();
  return db;
}
// A doc type whose DEFAULT department SET is the given departments (D7 join, slug-projected in the backup).
function mkType(db, name, slug, ...deptIds) {
  const id = db.prepare('INSERT INTO document_types (name, slug, built_in) VALUES (?,?,0)').run(name, slug).lastInsertRowid;
  const ids = deptIds.filter(x => x != null);
  if (ids.length) dept.setTypeDefaultDepartments(db, admin, id, ids);
  return id;
}
const typeIdBySlug = (db, slug) => (db.prepare('SELECT id FROM document_types WHERE slug=?').get(slug) || {}).id;
const defSet = (db, slug) => { const t = typeIdBySlug(db, slug); return t ? dept.typeDefaultDepartmentIds(db, t) : []; };
const deptIdByName = (db, name) => (db.prepare('SELECT id FROM departments WHERE name=?').get(name) || {}).id;

console.log('§1 cross-machine remap: the type-default SET follows the department by slug, not the raw id');
{
  const A = db0();
  const finA = dept.createDepartment(A, admin, 'Finance').id;
  const hrA = dept.createDepartment(A, admin, 'HR').id;
  mkType(A, 'Purchase', 'purchase', hrA);
  mkType(A, 'Invoice', 'invoice', finA);
  const buf = backup.createBackup(A, PW, {});

  const B = db0();
  const hrB = dept.createDepartment(B, admin, 'HR').id;
  const finB = dept.createDepartment(B, admin, 'Finance').id;
  check('B ids are REVERSED vs A (a raw-id restore would mis-tag)', hrB !== hrA && finB !== finA);
  backup.applyBackup(B, backup.readBackup(buf, PW).payload);
  check('Purchase default set lands on B.HR by slug', defSet(B, 'purchase').length === 1 && defSet(B, 'purchase')[0] === deptIdByName(B, 'HR'));
  check('Invoice default set lands on B.Finance', defSet(B, 'invoice')[0] === deptIdByName(B, 'Finance'));
  check('remapped to the LOCAL id, not the source id', defSet(B, 'purchase')[0] === hrB && defSet(B, 'purchase')[0] !== hrA);
}

console.log('§2 a DANGLING member (department slug absent on target) is dropped, never a foreign id');
{
  const A = db0();
  const finA = dept.createDepartment(A, admin, 'Finance').id;
  const hrA = dept.createDepartment(A, admin, 'HR').id;
  mkType(A, 'Purchase', 'purchase', hrA);
  mkType(A, 'Invoice', 'invoice', finA);
  const payload = backup.readBackup(backup.createBackup(A, PW, {}), PW).payload;
  payload.tables.departments = payload.tables.departments.filter(d => d.slug !== 'hr');   // HR absent on target
  const D = db0();
  dept.createDepartment(D, admin, 'Finance');
  backup.applyBackup(D, payload);
  check('dangling member (HR absent) dropped → Purchase has no default', defSet(D, 'purchase').length === 0);
  check('the sound member (Finance) is kept', defSet(D, 'invoice')[0] === deptIdByName(D, 'Finance'));
  check('a foreign id was NOT stored', !defSet(D, 'purchase').includes(deptIdByName(D, 'Finance')));
}

console.log('§3 mutation control — the slug remap avoids a raw-id collision');
{
  const A = db0();
  dept.createDepartment(A, admin, 'Finance');
  const hrA = dept.createDepartment(A, admin, 'HR').id;   // HR = id 2 on A
  mkType(A, 'Purchase', 'purchase', hrA);
  const buf = backup.createBackup(A, PW, {});
  const B = db0();
  const hrB = dept.createDepartment(B, admin, 'HR').id;      // HR = id 1 on B
  const finB = dept.createDepartment(B, admin, 'Finance').id; // Finance = id 2 on B
  backup.applyBackup(B, backup.readBackup(buf, PW).payload);
  check('remap avoided the raw-id collision (id 2 is Finance on B; default is NOT Finance)', defSet(B, 'purchase')[0] !== finB);
  check('default correctly on B.HR', defSet(B, 'purchase')[0] === hrB);
}

console.log('§4 empty-departments backup does NOT wipe local departments');
{
  const A = db0();   // A has NO departments
  const buf = backup.createBackup(A, PW, {});
  const B = db0();
  dept.createDepartment(B, admin, 'Finance');
  dept.createDepartment(B, admin, 'HR');
  const before = db_count(B);
  backup.applyBackup(B, backup.readBackup(buf, PW).payload);
  check('local departments survive an empty-departments restore', db_count(B) === before && before === 2);
}
function db_count(db) { return db.prepare('SELECT COUNT(*) n FROM departments').get().n; }

console.log(fails ? `\nFAILED (${fails})` : '\nALL PASS');
process.exit(fails ? 1 : 0);
