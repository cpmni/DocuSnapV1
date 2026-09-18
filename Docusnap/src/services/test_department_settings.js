'use strict';
/**
 * test_department_settings.js — Departments slice D4 (Settings IPC + UI wiring) backend pins.
 * Proves the code added for D4 behind the DARK master switch. Oracle 2026-09-17 pre-merge gate items 2/3/5/8.
 *  §A renameDepartment — display-name only, slug STABLE (the backup remap key); admin-gated; not_found; audits 3-arg.
 *  §B write-side belt — setDocumentDepartment refuses a NON-NULL tag while departments_enabled is OFF (a doc tagged
 *     while OFF can't be un-hidden); un-tag (→NULL) is always allowed; tagging works once ON.
 *  §C document_types.updateType default_department_id — accepts an existing+ACTIVE dept, DROPS a nonexistent or a
 *     RETIRED one (never stores a dangling/retired-default FK), clears to NULL, and does not leak other keys.
 *  §D INTAKE_GUARDED flip gate is CLOSED (false) — the switch cannot be turned ON until D2b lands.
 *  §E source-contract: settings/handler.js `_deptAudit` NESTS the whole meta under `metadata` (guards the
 *     [object Object] audit-row regression Oracle C2) and department-set-enabled consults INTAKE_GUARDED.
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/services/test_department_settings.js
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { runMigrations } = require('../../database/index');
const dept = require('./departmentService');
const doctypes = require('../../database/modules/document_types');

let fails = 0;
const check = (l, c) => { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}`); if (!c) fails++; };

function seed() {
  const db = new Database(':memory:');
  runMigrations(db);
  const uid = (role, all = 0) => db.prepare(
    'INSERT INTO users (username, display_name, password_hash, role, all_departments) VALUES (?, ?, ?, ?, ?)'
  ).run('u' + role + Math.random().toString(36).slice(2, 7), 'u', 'x', role, all).lastInsertRowid;
  const admin = { role: 'admin', id: uid('admin') };
  const editFin = { role: 'edit', id: uid('edit') };
  const ro = { role: 'readonly', id: uid('readonly') };
  const mkDoc = (deptId) => { const id = db.prepare("INSERT INTO documents (original_filename, folder_path, status) VALUES ('d.pdf','/in','confirmed')").run().lastInsertRowid; if (deptId != null) db.prepare('INSERT OR IGNORE INTO document_departments (document_id, department_id) VALUES (?,?)').run(id, deptId); return id; };
  const setEnabled = (on) => db.prepare("UPDATE settings SET value = ? WHERE key = 'departments_enabled'").run(on ? 'true' : 'false');
  return { db, admin, editFin, ro, mkDoc, setEnabled };
}

console.log('§A renameDepartment — display-name only, slug stable, admin-gated');
{
  const { db, admin, editFin, ro } = seed();
  const audits = [];
  const cap = (d, action, meta) => audits.push({ action, meta });
  const fin = dept.createDepartment(db, admin, 'Finance').id;
  const slugBefore = db.prepare('SELECT slug FROM departments WHERE id=?').get(fin).slug;
  const r = dept.renameDepartment(db, admin, fin, 'Finance & Accounts', { logAudit: cap });
  const row = db.prepare('SELECT name, slug FROM departments WHERE id=?').get(fin);
  check('rename ok', r && r.ok === true);
  check('display name changed', row.name === 'Finance & Accounts');
  check('slug UNCHANGED (backup remap key)', row.slug === slugBefore);
  check('rename emits a 3-arg audit (action string + meta object)', audits.some(a => a.action === 'department_renamed' && a.meta && a.meta.id === fin && a.meta.name === 'Finance & Accounts'));
  check('edit user refused', dept.renameDepartment(db, editFin, fin, 'X').error === 'forbidden');
  check('readonly refused', dept.renameDepartment(db, ro, fin, 'X').error === 'forbidden');
  check('empty name rejected', dept.renameDepartment(db, admin, fin, '   ').error === 'bad_request');
  check('unknown id → not_found', dept.renameDepartment(db, admin, 99999, 'X').error === 'not_found');
}

console.log('§B write-side belt — no tag while the switch is OFF; un-tag always allowed (D7 join)');
{
  const { db, admin, mkDoc, setEnabled } = seed();
  const fin = dept.createDepartment(db, admin, 'Finance').id;
  const doc = mkDoc(null);
  const depts = () => dept.documentDepartmentIds(db, doc);
  check('tag refused while OFF (departments_disabled)', dept.setDocumentDepartment(db, admin, doc, fin).error === 'departments_disabled');
  check('doc still shared after refusal', depts().length === 0);
  setEnabled(true);
  check('tag succeeds once ON', dept.setDocumentDepartment(db, admin, doc, fin).ok === true);
  check('doc now tagged Finance (join)', depts().length === 1 && depts()[0] === fin);
  setEnabled(false);
  check('un-tag (→shared, repair) allowed even while OFF', dept.setDocumentDepartment(db, admin, doc, null).ok === true);
  check('doc back to shared', depts().length === 0);
}

console.log('§C setTypeDefaultDepartments — active accepted; retired/unknown rejected; admin-only; updateType no longer carries it');
{
  const { db, admin, editFin } = seed();
  const fin = dept.createDepartment(db, admin, 'Finance').id;
  const hr = dept.createDepartment(db, admin, 'HR').id;
  const old = dept.createDepartment(db, admin, 'Legacy').id; dept.retireDepartment(db, admin, old);
  const typeId = db.prepare("INSERT INTO document_types (name, slug, built_in) VALUES ('Widget','widget',0)").run().lastInsertRowid;
  const defOf = () => dept.typeDefaultDepartmentIds(db, typeId);
  check('set a SET of active departments', dept.setTypeDefaultDepartments(db, admin, typeId, [fin, hr]).ok === true && defOf().length === 2);
  check('a retired department is rejected', dept.setTypeDefaultDepartments(db, admin, typeId, [old]).error === 'unknown_department');
  check('an unknown id is rejected', dept.setTypeDefaultDepartments(db, admin, typeId, [99999]).error === 'unknown_department');
  check('clear to [] allowed', dept.setTypeDefaultDepartments(db, admin, typeId, []).ok === true && defOf().length === 0);
  check('edit user refused (admin-only)', dept.setTypeDefaultDepartments(db, editFin, typeId, [fin]).error === 'forbidden');
  doctypes.updateType(db, typeId, { default_department_id: fin });
  check('updateType no longer writes default_department_id (retired scalar)', (db.prepare('SELECT default_department_id x FROM document_types WHERE id=?').get(typeId).x) == null);
}

console.log('§D INTAKE_GUARDED flip gate — OPEN (flipped 2026-09-18 after D2b + the denial matrix)');
{
  check('departmentService.INTAKE_GUARDED === true (the master toggle is now reachable; departments_enabled still seeded OFF)', dept.INTAKE_GUARDED === true);
}

console.log('§E source-contract — the audit adapter nests metadata; set-enabled consults the flip gate');
{
  const src = fs.readFileSync(path.join(__dirname, '../modules/settings/handler.js'), 'utf8');
  check('_deptAudit adapter defined', /_deptAudit\s*=\s*\(db,\s*action,\s*meta\)\s*=>/.test(src));
  check('adapter NESTS the whole meta under metadata (not spread → no [object Object])', /metadata:\s*m\b/.test(src));
  check("adapter uses action_category 'settings'", /action_category:\s*'settings'/.test(src));
  check('department-set-enabled consults INTAKE_GUARDED', /department-set-enabled[\s\S]{0,600}INTAKE_GUARDED/.test(src));
  check('every write channel goes through requireRole(admin)', /department-create[\s\S]{0,120}requireRole\('admin'\)/.test(src));
}

console.log('§F validateCreateDepartment (D2b) — the create-time D-C9 gate for the intake lanes');
{
  const { db, admin, editFin, ro, setEnabled } = seed();
  const acct = { role: 'edit', id: db.prepare("INSERT INTO users (username, display_name, password_hash, role, all_departments) VALUES ('acct','acct','x','edit',1)").run().lastInsertRowid };
  const fin = dept.createDepartment(db, admin, 'Finance').id;
  const hr = dept.createDepartment(db, admin, 'HR').id;
  const gone = dept.createDepartment(db, admin, 'Legacy').id; dept.retireDepartment(db, admin, gone);
  dept.setMembership(db, admin, editFin.id, [fin]);
  const V = (a, d) => dept.validateCreateDepartment(db, a, d);

  // Switch OFF (default): a non-null tag is refused for EVERYONE (OFF can't un-hide); shared is fine.
  check('OFF: admin tag → departments_disabled (belt)', V(admin, fin).error === 'departments_disabled');
  check('OFF: shared (null) allowed for anyone', V(editFin, null).ok === true && V(ro, null).ok === true);

  setEnabled(true);
  check('ON: member tags own department', V(editFin, fin).ok === true && V(editFin, fin).target === fin);
  check('ON: member tagging a FOREIGN department → widen_admin_only', V(editFin, hr).error === 'widen_admin_only');
  check('ON: non-member tagging → widen_admin_only', V({ role: 'edit', id: 999 }, fin).error === 'widen_admin_only');
  check('ON: non-privileged shared-at-create → widen_admin_only', V(editFin, null).error === 'widen_admin_only');
  check('ON: admin can create shared', V(admin, null).ok === true);
  check('ON: all_departments (accountant) can tag any dept AND create shared', V(acct, fin).ok === true && V(acct, null).ok === true);
  check('ON: a RETIRED department is not a valid target', V(admin, gone).error === 'unknown_department');
  check('ON: an unknown id → unknown_department', V(admin, 88888).error === 'unknown_department');
  // The no-bypass invariant, in gate form: whatever a non-admin is allowed to create resolves to their own
  // department or shared — never a department they are not in.
  const okTargets = [fin, hr, null].filter(d => V(editFin, d).ok).map(d => V(editFin, d).target);
  check('ON: editFin can only ever create in its own dept (no foreign/shared)', okTargets.length === 1 && okTargets[0] === fin);
}

console.log('§G source-contract — the intake lanes run the create-time SET gate (D2b/D7)');
{
  const dsrc = fs.readFileSync(path.join(__dirname, 'directIntakeService.js'), 'utf8');
  check('submit() calls validateCreateDepartments', /validateCreateDepartments/.test(dsrc));
  check('submit() validates BEFORE inserting the row', dsrc.indexOf('validateCreateDepartments') < dsrc.indexOf('INSERT INTO documents'));
  check('submit() writes the validated department SET into the join', /INSERT OR IGNORE INTO document_departments/.test(dsrc));
  const asrc = fs.readFileSync(path.join(__dirname, '../modules/api/handler.js'), 'utf8');
  check('/v1 intake threads departmentIds from the body', /departmentIds:\s*Array\.isArray\(body\.departmentIds\)/.test(asrc));
  check('/v1 intake maps the department refusals (widen_admin_only → 403)', /widen_admin_only:\s*403/.test(asrc));
}

console.log('§H applyTypeDefaultAtConfirm (D3 insert-time precedence, D-C9) — set form (D7)');
{
  const { db, admin, mkDoc, setEnabled } = seed();
  const fin = dept.createDepartment(db, admin, 'Finance').id;
  const hr = dept.createDepartment(db, admin, 'HR').id;
  const tDef = db.prepare("INSERT INTO document_types (name, slug, built_in) VALUES ('WithDefault','withdefault',0)").run().lastInsertRowid;
  const tNone = db.prepare("INSERT INTO document_types (name, slug, built_in) VALUES ('NoDefault','nodefault',0)").run().lastInsertRowid;
  dept.setTypeDefaultDepartments(db, admin, tDef, [fin, hr]);
  const setBy = (id) => db.prepare('SELECT department_set_by s FROM documents WHERE id=?').get(id).s;
  const dep = (id) => dept.documentDepartmentIds(db, id);

  const dOff = mkDoc(null);
  check('OFF: applies nothing (inert)', dept.applyTypeDefaultAtConfirm(db, dOff, tDef) === null && dep(dOff).length === 0);
  setEnabled(true);
  const d1 = mkDoc(null);
  const r1 = dept.applyTypeDefaultAtConfirm(db, d1, tDef);
  check('ON: NULL doc inherits the type default SET as rule', Array.isArray(r1) && r1.length === 2 && dep(d1).length === 2 && setBy(d1) === 'rule');
  const d2 = mkDoc(null);
  check('ON: type with NO default → nothing applied', dept.applyTypeDefaultAtConfirm(db, d2, tNone) === null && dep(d2).length === 0);
  const d4 = mkDoc(null);
  dept.setDocumentDepartment(db, admin, d4, hr);   // a human 'user' set via the join
  check('ON: a human user-set is never overridden by the rule', dept.applyTypeDefaultAtConfirm(db, d4, tDef) === null && dep(d4).length === 1 && dep(d4)[0] === hr && setBy(d4) === 'user');
}

console.log('§J source-contract — D7 wiring (type-default channel + per-doc set channel + preload)');
{
  const sh = fs.readFileSync(path.join(__dirname, '../modules/settings/handler.js'), 'utf8');
  check('settings exposes department-set-type-default', /ipcMain\.handle\('department-set-type-default'/.test(sh));
  check('settings exposes department-get-type-defaults', /ipcMain\.handle\('department-get-type-defaults'/.test(sh));
  check('disable-count uses the join (taggedDocCount), not the retired scalar', /departments\.taggedDocCount\(db\)/.test(sh) && !/documents WHERE department_id IS NOT NULL/.test(sh));
  const rh = fs.readFileSync(path.join(__dirname, '../modules/review/handler.js'), 'utf8');
  check('review exposes set-document-departments + get-document-departments', /ipcMain\.handle\('set-document-departments'/.test(rh) && /ipcMain\.handle\('get-document-departments'/.test(rh));
  const pre = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
  check('preload exposes setDocumentSet + setTypeDefault + getDocument', /setDocumentSet:.*set-document-departments/.test(pre) && /setTypeDefault:.*department-set-type-default/.test(pre) && /getDocument:.*get-document-departments/.test(pre));
  const dt = fs.readFileSync(path.join(__dirname, '../../database/modules/document_types.js'), 'utf8');
  check('updateType no longer lists default_department_id in allowed', !/'default_department_id'/.test(dt.slice(dt.indexOf('const allowed'), dt.indexOf('const allowed') + 200)));
}

console.log(fails ? `\nFAILED (${fails})` : '\nALL PASS');
process.exit(fails ? 1 : 0);
