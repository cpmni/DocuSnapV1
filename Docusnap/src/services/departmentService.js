'use strict';
/**
 * src/services/departmentService.js — Departments (who may see what). QuickFile+Departments plan §4 +
 * eric A.1-A.3 → Oracle D-C1..D-C12. Additive + byte-identical when empty (NULL department = shared).
 *
 * Two enforcement surfaces:
 *   • per-document — accessService.departmentDecision (the read gate; this module never re-implements it);
 *   • lists/counts — visibleDocSql(db, user, alias): ONE SQL fragment appended by every list reader,
 *     returning '' (byte-identical) when no departments exist, the actor is admin, or all_departments.
 *
 * Write side: setDocumentDepartment — role → canAccessDocument → editGuard → the WIDENING rule (to NULL,
 * or to a department the actor is not in, is ADMIN ONLY; narrowing within own departments is edit;
 * readonly never) → write → audit. Deleting a department that still has documents is REFUSED (fail-closed;
 * SET NULL would silently un-restrict them); admins retire (is_active=0, still restricts) or bulk-move.
 *
 * departments_enabled gates the ADMIN UI + the write side; the READ path keys off data (fail-closed).
 */

const accessService = require('./accessService');
const departmentVisibility = require('../../database/modules/departmentVisibility');   // the DB-layer primitive

// FLIP GATE (Oracle 2026-09-17 D4 items 6-8) — now GREEN, flipped 2026-09-18 (owner go). The whole gate is
// met: item 6/8 the intake bypass is CLOSED (D2b — both lanes run `validateCreateDepartment`, the D-C9 create
// rule; `/v1 documents/intake` threads the uploader's departmentId under the server session), item 7 the full
// denial matrix + mutation-armed consistency pin are green (`test_department_denial_matrix.js`), and the per-doc
// tagger (D3) ships. With this true, `department-set-enabled` will turn the feature ON — but `departments_enabled`
// stays seeded OFF (mig 164), so it is an admin OPT-IN per install, never a customer default.
const INTAKE_GUARDED = true;

function _slug(name) {
  return String(name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'dept';
}
function _isAdmin(a) { return a && a.role === 'admin'; }
function _uid(a) { return a ? (a.userId != null ? a.userId : a.id) : null; }
function _tablesExist(db) {
  try { return db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name IN ('departments','user_departments')").get().n === 2; }
  catch { return false; }
}
function _anyDepartments(db) {
  try { return _tablesExist(db) && db.prepare('SELECT 1 FROM departments LIMIT 1').get() != null; } catch { return false; }
}
// The master switch as stored (settings row). The READ gate ignores this by design (data-driven); it is
// consulted ONLY by the write-side belt below — because a doc tagged while the switch is OFF cannot be
// un-hidden until it is turned back on, and the taggers are hidden while OFF.
function _enabled(db) {
  try { const r = db.prepare("SELECT value FROM settings WHERE key = 'departments_enabled'").get(); return !!(r && r.value === 'true'); }
  catch { return false; }
}

// ── CRUD ───────────────────────────────────────────────────────────────────
function createDepartment(db, actor, name, deps = {}) {
  if (!_isAdmin(actor)) return { ok: false, error: 'forbidden' };
  const nm = String(name || '').trim();
  if (!nm) return { ok: false, error: 'bad_request' };
  let slug = _slug(nm), n = 1;
  while (db.prepare('SELECT 1 FROM departments WHERE slug = ?').get(slug)) slug = `${_slug(nm)}-${++n}`;
  try {
    const id = db.prepare('INSERT INTO departments (name, slug) VALUES (?, ?)').run(nm, slug).lastInsertRowid;
    if (deps.logAudit) try { deps.logAudit(db, 'department_created', { id, name: nm, slug }); } catch {}
    return { ok: true, id, slug };
  } catch (e) { return { ok: false, error: /UNIQUE/.test(e.message) ? 'duplicate' : 'db_error', detail: e.message }; }
}
function listDepartments(db, { includeRetired = true } = {}) {
  if (!_tablesExist(db)) return [];
  const where = includeRetired ? '' : ' WHERE is_active = 1';
  // D7: doc_count comes from the document_departments JOIN (a doc may be in several departments). COALESCE
  // guards a pre-mig-184 fixture that lacks the join table.
  const hasJoin = _hasDocDeptTable(db);
  const cnt = hasJoin
    ? '(SELECT COUNT(*) FROM document_departments dd WHERE dd.department_id = departments.id)'
    : '0';
  return db.prepare(`SELECT id, name, slug, is_active, created_at, ${cnt} AS doc_count
    FROM departments${where} ORDER BY name COLLATE NOCASE`).all();
}
function _hasDocDeptTable(db) {
  try { return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='document_departments'").get(); }
  catch { return false; }
}
// How many documents carry at least one department (the D-C8 "tagged docs stay hidden" count). D7: the join.
function taggedDocCount(db) {
  if (!_hasDocDeptTable(db)) return 0;
  try { return db.prepare('SELECT COUNT(DISTINCT document_id) n FROM document_departments').get().n; } catch { return 0; }
}
function retireDepartment(db, actor, id, deps = {}) {
  if (!_isAdmin(actor)) return { ok: false, error: 'forbidden' };
  db.prepare('UPDATE departments SET is_active = 0 WHERE id = ?').run(id);   // still restricts (fail-closed)
  if (deps.logAudit) try { deps.logAudit(db, 'department_retired', { id }); } catch {}
  return { ok: true };
}
function renameDepartment(db, actor, id, name, deps = {}) {
  if (!_isAdmin(actor)) return { ok: false, error: 'forbidden' };
  const nm = String(name || '').trim();
  if (!nm) return { ok: false, error: 'bad_request' };
  if (!db.prepare('SELECT 1 FROM departments WHERE id = ?').get(id)) return { ok: false, error: 'not_found' };
  // Slug is STABLE on rename (Oracle D4 C3): it is the backup upsert/remap key, so only the display name
  // changes — a re-slug risks a collision and breaks D-C3 remap-by-slug.
  db.prepare('UPDATE departments SET name = ? WHERE id = ?').run(nm, id);
  if (deps.logAudit) try { deps.logAudit(db, 'department_renamed', { id, name: nm }); } catch {}
  return { ok: true, id, name: nm };
}
function deleteDepartment(db, actor, id, deps = {}) {
  if (!_isAdmin(actor)) return { ok: false, error: 'forbidden' };
  // D7: refuse while ANY document references it (the join; counts retired-dept members too). The DB
  // `document_departments.department_id ON DELETE RESTRICT` is the backstop if this check is bypassed.
  const refs = _hasDocDeptTable(db)
    ? db.prepare('SELECT COUNT(DISTINCT document_id) n FROM document_departments WHERE department_id = ?').get(id).n
    : 0;
  if (refs > 0) return { ok: false, error: 'in_use', detail: refs };   // D-C12: refuse while referenced
  try { db.prepare('DELETE FROM departments WHERE id = ?').run(id); }
  catch (e) { return { ok: false, error: /FOREIGN KEY/.test(e.message) ? 'in_use' : 'db_error', detail: e.message }; }
  if (deps.logAudit) try { deps.logAudit(db, 'department_deleted', { id }); } catch {}
  return { ok: true };
}
// A document's current department SET (the D7 join). [] = shared.
function documentDepartmentIds(db, docId) {
  try { return db.prepare('SELECT department_id FROM document_departments WHERE document_id = ? ORDER BY department_id').all(docId).map(r => r.department_id); }
  catch { return []; }
}
// A document type's default department SET.
function typeDefaultDepartmentIds(db, typeId) {
  try { return db.prepare('SELECT department_id FROM document_type_departments WHERE document_type_id = ? ORDER BY department_id').all(typeId).map(r => r.department_id); }
  catch { return []; }
}
// Admin-only writer for a type's default SET (replaces the single default_department_id on updateType).
function setTypeDefaultDepartments(db, actor, typeId, deptIds, deps = {}) {
  if (!_isAdmin(actor)) return { ok: false, error: 'forbidden' };
  if (!db.prepare('SELECT 1 FROM document_types WHERE id = ?').get(typeId)) return { ok: false, error: 'not_found' };
  const ids = Array.from(new Set((deptIds || []).map(Number).filter(Number.isInteger)));
  for (const d of ids) if (!db.prepare('SELECT 1 FROM departments WHERE id = ? AND is_active = 1').get(d)) return { ok: false, error: 'unknown_department', detail: d };
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM document_type_departments WHERE document_type_id = ?').run(typeId);
    const ins = db.prepare('INSERT OR IGNORE INTO document_type_departments (document_type_id, department_id) VALUES (?, ?)');
    for (const d of ids) ins.run(typeId, d);
  });
  tx();
  if (deps.logAudit) try { deps.logAudit(db, 'type_default_departments_set', { document_type_id: typeId, departments: ids }); } catch {}
  return { ok: true, departments: ids };
}

// ── membership ───────────────────────────────────────────────────────────────
function setMembership(db, actor, userId, deptIds, deps = {}) {
  if (!_isAdmin(actor)) return { ok: false, error: 'forbidden' };
  const ids = Array.from(new Set((deptIds || []).map(Number).filter(Number.isInteger)));
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM user_departments WHERE user_id = ?').run(userId);
    const ins = db.prepare('INSERT OR IGNORE INTO user_departments (user_id, department_id) VALUES (?, ?)');
    for (const d of ids) ins.run(userId, d);
  });
  tx();
  if (deps.logAudit) try { deps.logAudit(db, 'department_membership_set', { user_id: userId, departments: ids }); } catch {}
  return { ok: true, departments: ids };
}
function setAllDepartments(db, actor, userId, on, deps = {}) {
  if (!_isAdmin(actor)) return { ok: false, error: 'forbidden' };
  db.prepare('UPDATE users SET all_departments = ? WHERE id = ?').run(on ? 1 : 0, userId);
  if (deps.logAudit) try { deps.logAudit(db, 'department_all_set', { user_id: userId, all: !!on }); } catch {}
  return { ok: true };
}
function userDepartmentIds(db, userId) {
  if (!_tablesExist(db)) return [];
  return db.prepare('SELECT department_id FROM user_departments WHERE user_id = ?').all(userId).map(r => r.department_id);
}
function _allDepartments(db, userId) {
  try { const r = db.prepare('SELECT all_departments a FROM users WHERE id = ?').get(userId); return !!(r && r.a); }
  catch { return false; }
}

// D2b create-time department gate (Oracle 2026-09-17 item 8 / gary slice 3). The intake lanes create a NEW
// document (no docId yet, so canAccessDocument can't be used) — this applies the SAME D-C9 rule at create:
//   • target department (non-null): only while the switch is ON (belt), the actor must be a MEMBER (or admin
//     / all_departments), and it must be an existing ACTIVE department;
//   • shared (NULL): only restricted when the switch is ON — then shared-at-create is admin / all_departments
//     only (a normal user cannot drop a doc into everyone's view when the org restricts by department). When
//     OFF (or no departments), NULL is shared-visible-to-all anyway, so it is always allowed.
// Returns {ok:true, target} or {ok:false, error}. Guarantees the no-bypass invariant: a non-admin can only
// ever create a doc they can then see (own department, or shared).
// D7 SET form: validate a create-time department SET (the intake lanes). [] = shared (admin/all_departments
// only while ON, else allowed). A non-privileged actor's set must be ⊆ their own active departments. Returns
// {ok, target: number[]}.
function validateCreateDepartments(db, actor, deptIds) {
  const on = _enabled(db);
  const uid = _uid(actor);
  const privileged = _isAdmin(actor) || _allDepartments(db, uid);
  const requested = Array.from(new Set((deptIds || []).map(Number).filter(Number.isInteger)));
  if (requested.length === 0) {
    if (on && !privileged) return { ok: false, error: 'widen_admin_only' };   // shared-at-create restricted while ON
    return { ok: true, target: [] };
  }
  if (!on) return { ok: false, error: 'departments_disabled' };
  const mine = new Set(userDepartmentIds(db, uid));
  if (!privileged && requested.some(d => !mine.has(d))) return { ok: false, error: 'widen_admin_only' };
  for (const d of requested) if (!db.prepare('SELECT 1 FROM departments WHERE id = ? AND is_active = 1').get(d)) return { ok: false, error: 'unknown_department', detail: d };
  return { ok: true, target: requested };
}
// Back-compat single shim (a lone departmentId). Returns { target: number|null }.
function validateCreateDepartment(db, actor, deptId) {
  const r = validateCreateDepartments(db, actor, deptId == null ? [] : [Number(deptId)]);
  if (r.ok) r.target = (r.target && r.target.length) ? r.target[0] : null;
  return r;
}

// ── list/count fragment (D2) — the ONE helper every list reader appends ──────
// Returns '' (byte-identical) when: no departments exist, actor is admin, or all_departments. Else a
// clause restricting to NULL-tagged (shared) docs OR docs in one of the viewer's departments. The
// user_id is an integer from the session → embedded as a literal (no param plumbing across ~12 readers).
function visibleDocSql(db, user, alias = 'd') {
  return departmentVisibility.visibleDocSql(db, user, alias);   // the ONE source (DB layer)
}

// D3 insert-time precedence (D-C9), applied at CONFIRM once the type is decided (reviewService.confirm). A
// confirmed doc with no department inherits its type's default, stamped department_set_by='rule' — a human
// 'user' tag is NEVER overridden. Only while the feature is ON (an auto-tag while OFF would hide the doc with
// no tagger to fix it) and the default is an existing ACTIVE department. Returns the applied dept id or null.
// Inert + byte-identical when unconfigured (the corpus M=0 gate).
function applyTypeDefaultAtConfirm(db, docId, typeId) {
  try {
    if (!_enabled(db) || docId == null || typeId == null) return null;
    const d = db.prepare('SELECT department_set_by FROM documents WHERE id = ?').get(docId);
    if (!d || !(d.department_set_by == null || d.department_set_by === 'rule')) return null;
    // Only when the doc currently has NO departments (join empty) — never override a human 'user' set.
    if (documentDepartmentIds(db, docId).length > 0) return null;
    // The type's ACTIVE default set.
    const def = db.prepare(`SELECT dtd.department_id FROM document_type_departments dtd
      JOIN departments dp ON dp.id = dtd.department_id
      WHERE dtd.document_type_id = ? AND dp.is_active = 1`).all(typeId).map(r => r.department_id);
    if (!def.length) return null;
    const tx = db.transaction(() => {
      const ins = db.prepare('INSERT OR IGNORE INTO document_departments (document_id, department_id) VALUES (?, ?)');
      for (const dep of def) ins.run(docId, dep);
      db.prepare("UPDATE documents SET department_set_by = 'rule' WHERE id = ?").run(docId);
    });
    tx();
    return def;
  } catch { return null; }
}

// ── write side (D7 SET form) ───────────────────────────────────────────────────
// Set a document's department SET. The D-C9 widening rule for a set = OWN-SLICE / IMMUTABLE-FOREIGN
// (Oracle 2026-09-18 D7 #3): an edit user may change only their OWN departments; foreign tags (departments
// they're not in) are preserved untouched; ownSelection must be ⊆ mine AND non-empty (⟺ the actor keeps
// access — never a self/team lockout, never a widen-to-shared). admin / all_departments may write any set,
// including [] (= shared). Effective write = ownSelection ∪ (old \ mine).
function setDocumentDepartments(db, actor, docId, deptIds, deps = {}) {
  const role = actor && actor.role;
  if (!(role === 'admin' || role === 'edit')) return { ok: false, error: 'forbidden' };
  const gate = (deps.canAccessDocument || accessService.canAccessDocument)(db, actor, docId);
  if (!gate.allow) return { ok: false, error: 'no_access', detail: gate.reason };
  if (deps.editGuard) { const g = deps.editGuard(db, docId, actor); if (g && g.locked) return { ok: false, error: 'locked', detail: g }; }
  if (!db.prepare('SELECT 1 FROM documents WHERE id = ?').get(docId)) return { ok: false, error: 'not_found' };

  const uid = _uid(actor);
  const privileged = _isAdmin(actor) || _allDepartments(db, uid);
  const requested = Array.from(new Set((deptIds || []).map(Number).filter(Number.isInteger)));
  const old = new Set(documentDepartmentIds(db, docId));
  const mine = new Set(privileged ? [] : userDepartmentIds(db, uid));

  let effective;
  if (privileged) {
    effective = requested;                                   // any set, incl [] (shared)
  } else {
    const ownSelection = requested.filter(d => mine.has(d));
    if (ownSelection.length !== requested.length) return { ok: false, error: 'widen_admin_only' };   // tried to add a foreign dept
    if (ownSelection.length === 0) return { ok: false, error: 'widen_admin_only' };                   // empty = widen-to-shared / self-lock = admin-only
    const foreign = [...old].filter(d => !mine.has(d));      // preserved untouched
    effective = Array.from(new Set([...ownSelection, ...foreign]));
  }
  // Write-side belt: a non-empty target set is refused while the switch is OFF (OFF can't un-hide);
  // clearing to [] (admin repair) is always allowed.
  if (effective.length > 0 && !_enabled(db)) return { ok: false, error: 'departments_disabled' };
  // Only NEWLY-ADDED departments must be active (a preserved retired tag stays; retired still restricts).
  for (const d of effective) if (!old.has(d) && !db.prepare('SELECT 1 FROM departments WHERE id = ? AND is_active = 1').get(d)) return { ok: false, error: 'unknown_department', detail: d };

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM document_departments WHERE document_id = ?').run(docId);
    const ins = db.prepare('INSERT OR IGNORE INTO document_departments (document_id, department_id) VALUES (?, ?)');
    for (const d of effective) ins.run(docId, d);
    db.prepare("UPDATE documents SET department_set_by = 'user' WHERE id = ?").run(docId);
  });
  tx();
  if (deps.logAudit) try { deps.logAudit(db, 'document_department_set', { document_id: docId, from: [...old], to: effective }); } catch {}
  return { ok: true, departments: effective };
}
// Back-compat single shim (a lone departmentId / null). Adds `department_id` for old callers.
function setDocumentDepartment(db, actor, docId, deptId, deps = {}) {
  const r = setDocumentDepartments(db, actor, docId, deptId == null ? [] : [Number(deptId)], deps);
  if (r.ok) r.department_id = (r.departments && r.departments.length) ? r.departments[0] : null;
  return r;
}

module.exports = {
  createDepartment, listDepartments, renameDepartment, retireDepartment, deleteDepartment,
  setMembership, setAllDepartments, userDepartmentIds, visibleDocSql,
  setDocumentDepartments, setDocumentDepartment, documentDepartmentIds,
  typeDefaultDepartmentIds, setTypeDefaultDepartments,
  validateCreateDepartments, validateCreateDepartment, applyTypeDefaultAtConfirm,
  taggedDocCount, _slug, _anyDepartments, _enabled, _allDepartments, _hasDocDeptTable, INTAKE_GUARDED,
};
