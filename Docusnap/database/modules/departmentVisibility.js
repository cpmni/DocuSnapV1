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

// SYSTEM_ACTOR — the honest, greppable opt-out for a genuine unfiltered read (a maintenance sweep,
// a system op that must see every document regardless of department). Maps to '' / {deny:false}.
// Wire NOTHING to it without a documented reason: a future dev must never reach for `null` (which
// fail-closes to shared-only, line ~67) or fake `{role:'admin'}` to mean "system". Pin
// test_department_sweep.js asserts `grep SYSTEM_ACTOR` returns only intentional bypasses (today: zero).
const SYSTEM_ACTOR = Object.freeze({ __system: true });

const _tablesCache = new WeakMap();
function _hasTables(db) {
  if (!db) return false;
  let v = _tablesCache.get(db);
  if (v === undefined) {
    // ALL THREE tables (incl. document_departments, queried by decision() at :62/:66) — Oracle 2026-09-18 §fail-toward-
    // review: a genuinely-absent join table then short-circuits cleanly to "not configured → shared" (inert), so the
    // deny-on-catch below fires ONLY for a real query error on a configured install, never for a missing table.
    try { v = db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name IN ('departments','user_departments','document_departments')").get().n === 3; }
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
 * Per-document decision (used by accessService.canAccessDocument). Fail-closed but inert. D7 (2026-09-18):
 * a doc is SHARED when it has ZERO `document_departments` rows; otherwise visible to admin / all_departments /
 * a member of ANY of its departments. Takes the doc's `id` (NOT the retired scalar `department_id`). Order per
 * Oracle #4a: system / not-configured / admin / all_departments BEFORE any join query (inert installs never query).
 */
function decision(db, user, doc) {
  if (user === SYSTEM_ACTOR) return { deny: false };     // explicit system read
  const docId = doc && doc.id;
  if (docId == null) return { deny: false };             // no id to check → inert (only synthetic/pin docs)
  if (!configured(db)) return { deny: false };           // nothing configured
  if (user && user.role === 'admin') return { deny: false };
  const uid = _uid(user);
  if (uid != null && _allDepartments(db, uid)) return { deny: false };
  let tagged;
  // FAIL-CLOSED once configured (Oracle 2026-09-18): configured() has already passed (tables present + >=1
  // department), and admin/all_departments are exempt above — so a THROW here is a real query error on a
  // department-enabled install, never a missing table. DENY (a transient error self-corrects on retry; an
  // admin, exempt above, can always recover a genuinely-broken DB). The old fail-OPEN allowed a restricted
  // doc through on any DB error — the exact leak the owner called a disaster.
  try { tagged = db.prepare('SELECT 1 FROM document_departments WHERE document_id = ? LIMIT 1').get(docId); }
  catch { return { deny: true }; }
  if (!tagged) return { deny: false };                   // shared (no departments on this doc)
  if (uid == null) return { deny: true };                // a tagged doc + unknown viewer
  try {
    return { deny: !db.prepare(
      `SELECT 1 FROM document_departments dd JOIN user_departments ud ON ud.department_id = dd.department_id
       WHERE dd.document_id = ? AND ud.user_id = ? LIMIT 1`).get(docId, uid) };
  } catch { return { deny: true }; }                     // membership query error on a KNOWN-tagged doc → deny
}

/**
 * SQL fragment (leading ` AND …`) restricting a list/count query to documents the viewer may see: SHARED (no
 * `document_departments` rows) OR the viewer is a MEMBER of ANY of the doc's departments. '' (byte-identical)
 * when not configured / admin / all_departments. The clause references the documents PK (`<alias>.id`), NOT the
 * retired scalar. uid embedded as a literal (no param plumbing across the ~13 readers). Unknown viewer → SHARED only.
 */
function visibleDocSql(db, user, alias = 'd') {
  if (user === SYSTEM_ACTOR) return '';                  // explicit system read (unfiltered)
  if (!configured(db)) return '';
  if (user && user.role === 'admin') return '';
  const a = alias ? `${alias}.` : '';
  const uid = _uid(user);
  if (uid == null || !Number.isInteger(uid))
    return ` AND NOT EXISTS (SELECT 1 FROM document_departments dd0 WHERE dd0.document_id = ${a}id)`;   // fail-closed: shared only
  if (_allDepartments(db, uid)) return '';
  return ` AND (NOT EXISTS (SELECT 1 FROM document_departments dd0 WHERE dd0.document_id = ${a}id)`
       + ` OR EXISTS (SELECT 1 FROM document_departments dd1 JOIN user_departments ud1 ON ud1.department_id = dd1.department_id`
       + ` WHERE dd1.document_id = ${a}id AND ud1.user_id = ${uid}))`;
}

module.exports = { configured, decision, visibleDocSql, SYSTEM_ACTOR };
