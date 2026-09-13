'use strict';
/**
 * database/modules/departmentVisibility.js — the DB-LAYER department read primitives (QuickFile+
 * Departments plan §4 / eric A.2). Pure database concerns, NO service deps, so both the database modules
 * (documents.js list readers) and the services (accessService.departmentDecision, departmentService.
 * visibleDocSql) can require it without a layer inversion or a require cycle. Sibling of machine_vias.js.
 *
 * The ONE rule: a NULL documents.department_id = shared = visible to everyone. Everything here is
 * INERT + byte-identical when no departments exist (tables absent, or zero rows), or the viewer is an
 * admin / carries all_departments — the learningExcludedSql `''`-when-inert pattern.
 *
 * Table-existence is cached per db handle (schema is immutable per handle); "any departments exist" and
 * membership are queried LIVE (a department/membership created mid-session takes effect next request).
 */

const _tablesCache = new WeakMap();
function _hasTables(db) {
  if (!db) return false;
  let v = _tablesCache.get(db);
  if (v === undefined) {
    try { v = db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name IN ('departments','user_departments')").get().n === 2; }
    catch { v = false; }
    _tablesCache.set(db, v);
  }
  return v;
}

/** Are departments CONFIGURED (tables present AND at least one department row)? Live on the row check. */
function configured(db) {
  if (!_hasTables(db)) return false;
  try { return db.prepare('SELECT 1 FROM departments LIMIT 1').get() != null; } catch { return false; }
}

function _uid(user) { return user ? (user.userId != null ? user.userId : user.id) : null; }
function _allDepartments(db, userId) {
  try { const u = db.prepare('SELECT all_departments FROM users WHERE id = ?').get(userId); return !!(u && u.all_departments); }
  catch { return false; }
}

/**
 * Per-document decision (used by accessService.canAccessDocument). Fail-closed but inert:
 *   untagged (NULL) / not configured / admin / all_departments / member → { deny:false }; else { deny:true }.
 */
function decision(db, user, doc) {
  const deptId = doc && doc.department_id;
  if (deptId == null) return { deny: false };            // shared
  if (!configured(db)) return { deny: false };           // nothing configured
  if (user && user.role === 'admin') return { deny: false };
  const uid = _uid(user);
  if (uid == null) return { deny: true };
  if (_allDepartments(db, uid)) return { deny: false };
  try { return { deny: !db.prepare('SELECT 1 FROM user_departments WHERE user_id = ? AND department_id = ?').get(uid, deptId) }; }
  catch { return { deny: false }; }                       // never throw the gate closed on a schema gap
}

/**
 * SQL fragment (leading ` AND …`) restricting a list/count query to documents the viewer may see:
 * shared (NULL) OR in one of the viewer's departments. '' (byte-identical) when not configured, the
 * viewer is admin, or carries all_departments. The user_id is an integer from the session → embedded as
 * a literal (no param plumbing across the ~12 list readers). An unknown/blank viewer sees SHARED only.
 */
function visibleDocSql(db, user, alias = 'd') {
  if (!configured(db)) return '';
  if (user && user.role === 'admin') return '';
  const a = alias ? `${alias}.` : '';
  const uid = _uid(user);
  if (uid == null || !Number.isInteger(uid)) return ` AND ${a}department_id IS NULL`;   // fail-closed: shared only
  if (_allDepartments(db, uid)) return '';
  return ` AND (${a}department_id IS NULL OR ${a}department_id IN (SELECT department_id FROM user_departments WHERE user_id = ${uid}))`;
}

module.exports = { configured, decision, visibleDocSql };
