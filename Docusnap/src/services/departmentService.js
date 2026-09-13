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
  return db.prepare(`SELECT id, name, slug, is_active, created_at,
    (SELECT COUNT(*) FROM documents d WHERE d.department_id = departments.id) AS doc_count
    FROM departments${where} ORDER BY name COLLATE NOCASE`).all();
}
function retireDepartment(db, actor, id, deps = {}) {
  if (!_isAdmin(actor)) return { ok: false, error: 'forbidden' };
  db.prepare('UPDATE departments SET is_active = 0 WHERE id = ?').run(id);   // still restricts (fail-closed)
  if (deps.logAudit) try { deps.logAudit(db, 'department_retired', { id }); } catch {}
  return { ok: true };
}
function deleteDepartment(db, actor, id, deps = {}) {
  if (!_isAdmin(actor)) return { ok: false, error: 'forbidden' };
  const refs = db.prepare('SELECT COUNT(*) n FROM documents WHERE department_id = ?').get(id).n;
  if (refs > 0) return { ok: false, error: 'in_use', detail: refs };   // D-C12: refuse while referenced
  db.prepare('DELETE FROM departments WHERE id = ?').run(id);
  if (deps.logAudit) try { deps.logAudit(db, 'department_deleted', { id }); } catch {}
  return { ok: true };
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

// ── list/count fragment (D2) — the ONE helper every list reader appends ──────
// Returns '' (byte-identical) when: no departments exist, actor is admin, or all_departments. Else a
// clause restricting to NULL-tagged (shared) docs OR docs in one of the viewer's departments. The
// user_id is an integer from the session → embedded as a literal (no param plumbing across ~12 readers).
function visibleDocSql(db, user, alias = 'd') {
  return departmentVisibility.visibleDocSql(db, user, alias);   // the ONE source (DB layer)
}

// ── write side ───────────────────────────────────────────────────────────────
function setDocumentDepartment(db, actor, docId, deptId, deps = {}) {
  const role = actor && actor.role;
  if (!(role === 'admin' || role === 'edit')) return { ok: false, error: 'forbidden' };
  const gate = (deps.canAccessDocument || accessService.canAccessDocument)(db, actor, docId);
  if (!gate.allow) return { ok: false, error: 'no_access', detail: gate.reason };
  if (deps.editGuard) { const g = deps.editGuard(db, docId, actor); if (g && g.locked) return { ok: false, error: 'locked', detail: g }; }
  const doc = db.prepare('SELECT department_id FROM documents WHERE id = ?').get(docId);
  if (!doc) return { ok: false, error: 'not_found' };
  // WIDENING rule (D-C9): to NULL (shared), or to a department the actor is not a member of, is ADMIN
  // ONLY. Narrowing/moving within the actor's own departments is edit. readonly never (blocked above).
  const target = deptId == null ? null : Number(deptId);
  if (!_isAdmin(actor)) {
    const mine = new Set(userDepartmentIds(db, _uid(actor)));
    if (target == null || !mine.has(target)) return { ok: false, error: 'widen_admin_only' };
  }
  db.prepare('UPDATE documents SET department_id = ?, department_set_by = ? WHERE id = ?').run(target, 'user', docId);
  if (deps.logAudit) try { deps.logAudit(db, 'document_department_set', { document_id: docId, from: doc.department_id || null, to: target }); } catch {}
  return { ok: true, department_id: target };
}

module.exports = {
  createDepartment, listDepartments, retireDepartment, deleteDepartment,
  setMembership, setAllDepartments, userDepartmentIds, visibleDocSql, setDocumentDepartment,
  _slug, _anyDepartments,
};
