'use strict';

/**
 * src/services/accessService.js — the SINGLE per-document read-authorization gate.
 *
 * Slice 0 of the Workflow Suite (docs/designs/WORKFLOW_SUITE_2026-07-18.md §3, Oracle-
 * signed). Before this, six by-id read paths authenticated the SESSION but never
 * authorized the DOCUMENT (SEC-03 + desktop twins): any signed-in principal — including a
 * `readonly` seat — could id-walk field values, full page images and thumbnails of
 * needs_review/deferred/soft-deleted docs that search deliberately withholds. Routing on
 * that hole would be a regression, so this authz ships BEFORE any routing reveal.
 *
 * `canAccessDocument` is the ONE predicate both transports share (the /v1 API and the
 * desktop IPCs), pure and injectable, FAIL-CLOSED. Ordered rules:
 *   1. doc missing                      -> deny 'not_found'   (hide existence)
 *   2. admin                            -> allow (incl. deleted)
 *   3. OPEN-route party (from/to user)  -> allow  (the routing visibility grant, Oracle
 *                                          C3: OPEN routes only; a closed-route party gets
 *                                          the immutable snapshot elsewhere, not the live doc)
 *   4. status 'deleted'                 -> deny non-admin
 *   5. writer (admin|edit)              -> allow any non-deleted
 *   6. readonly                         -> allow only status 'confirmed'
 *   7. else / null user / unknown role  -> deny
 *
 * Kill switch env ACCESS_GATE_ENABLED, DEFAULT ON (the deliberate exception to the house
 * "default OFF" — security fails closed). `=0/false/off` reverts to legacy allow-any so a
 * per-slice control test can prove OFF is byte-identical.
 *
 * This is a READ gate only. It must NOT touch the confirm/filing path (the corpus M=0 gate
 * holds) and must NOT replace the workflow edit-LOCK (editGuard/requireUnlocked), which
 * gates WRITES — different seam, composes cleanly.
 */

const documentsDb = require('../../database/modules/documents');
const workflowDb   = require('../../database/modules/workflow');

// isPackaged probe (D-C6): default false when electron/app is unavailable (dev, electron-as-node
// tests) — the same guard shape as _realCanonical (handler.js) and the licence-key pinning.
const _app = (() => { try { return require('electron').app || { isPackaged: false }; }
                      catch { return { isPackaged: false }; } })();

// Env kill switch. Absent/anything-but-a-disable-token => ON.
// D-C6 (2026-09-13, Oracle F1, QuickFile+Departments plan §6): a security boundary must NOT be
// switchable off by an environment variable on a customer machine. On a PACKAGED build the read gate
// is ALWAYS ON; `ACCESS_GATE_ENABLED` (for per-slice control tests) is honoured only when
// !app.isPackaged. `isPackaged` is injectable so the pin can exercise both branches.
function gateEnabled(isPackaged = _app.isPackaged) {
  if (isPackaged) return true;                        // packaged build: env override ignored
  const v = String(process.env.ACCESS_GATE_ENABLED || '').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off' || v === 'no');
}

/**
 * @param {object} db      better-sqlite3 handle
 * @param {object} user    {userId|id, role} — the authenticated actor (either transport's shape)
 * @param {number} docId   the requested document id
 * @param {object} [deps]  {documents, workflow} test injection
 * @returns {{allow:boolean, reason:string}}
 */
function canAccessDocument(db, user, docId, deps = {}) {
  const documents = deps.documents || documentsDb;
  const workflow  = deps.workflow  || workflowDb;

  if (!db || docId == null) return { allow: false, reason: 'bad_request' };
  const role = user && user.role;
  const userId = user ? (user.userId != null ? user.userId : user.id) : null;

  const doc = documents.getById(db, docId);
  if (!doc) return { allow: false, reason: 'not_found' };          // hide existence

  if (role === 'admin') return { allow: true, reason: 'admin' };

  // Routing visibility grant (Oracle C3): a sender/recipient on an OPEN route sees the
  // live doc even if their role/status otherwise couldn't — sits ABOVE the status test so
  // a routed needs_review doc is visible to its parties. Ends when the route closes.
  if (userId != null && workflow.isOpenRouteParty(db, docId, userId)) {
    return { allow: true, reason: 'route_party' };
  }

  if (doc.status === 'deleted') return { allow: false, reason: 'deleted' };   // non-admin never sees a soft-deleted doc

  // ── DEPARTMENT tag decision (D2, QuickFile+Departments plan §4 / eric A.2) — after admin + open-route
  // party + deleted, BEFORE the role grants. A document tagged to a department the actor is not in is
  // denied ('department_restricted'). INERT + byte-identical when no departments exist (the tables are
  // empty / absent) or the doc is untagged (department_id NULL = shared). The read gate keys off DATA, not
  // the departments_enabled switch, so a tagged doc is restricted fail-closed regardless of the switch.
  const dd = (deps.departmentDecision || departmentDecision)(db, user, doc, deps);
  if (dd && dd.deny) return { allow: false, reason: 'department_restricted' };

  // ── Stage 8 extension seam (INERT groundwork) — per-doc-type / per-document authorization ─────
  // When the doctype_grants scaffold (migration 56) is populated and activated, a role's or user's
  // access to a specific document TYPE is restricted HERE — applied to the role-based grants below,
  // but deliberately NOT to admin (returned above) nor to an explicit OPEN-route party (a routed doc
  // stays visible to its parties by design). Today doctypeGrantDecision ALWAYS returns {deny:false}
  // (no consumer reads the table) ⇒ byte-identical. Kept as a NAMED seam so the future feature is a
  // body change here, not a re-architecture of this fail-closed predicate. See
  // docs/designs/STAGE8_DOCTYPE_AUTHZ_2026-07-27.md.
  const dt = (deps.doctypeGrantDecision || doctypeGrantDecision)(db, user, doc, deps);
  if (dt && dt.deny) return { allow: false, reason: 'doctype_restricted' };

  if (role === 'edit') return { allow: true, reason: 'writer' };
  if (role === 'readonly') {
    return doc.status === 'confirmed'
      ? { allow: true, reason: 'readonly_confirmed' }
      : { allow: false, reason: 'readonly_unconfirmed' };
  }
  return { allow: false, reason: 'denied' };                       // null user / unknown role
}

// Stage 8 (GROUNDWORK — INERT). The extension point for per-doc-type / per-document authorization.
// It will read the doctype_grants scaffold (migration 56); that table is UNUSED until Stage 8 ships,
// so this ALWAYS returns {deny:false} today (no rows ⇒ no restriction ⇒ byte-identical behaviour).
// Design + activation semantics: docs/designs/STAGE8_DOCTYPE_AUTHZ_2026-07-27.md. When implemented,
// the model is DEFAULT-ALLOW-PRESERVING: an empty table changes nothing; a role/doc-type restriction
// activates only where explicitly configured, and evaluates fail-closed like the rest of this gate.
function doctypeGrantDecision(_db, _user, _doc, _deps) {
  return { deny: false };
}

// ── Department per-doc decision (D2). Fail-closed but INERT when nothing is configured:
//   • doc untagged (department_id NULL = shared)     -> allow
//   • no departments table / no rows (pre-mig-164)   -> allow (byte-identical)
//   • admin / all_departments flag                   -> allow (sees everything)
//   • member of the doc's department                 -> allow
//   • else                                           -> DENY
// Table-guarded (a fixture without the tables never throws); memoisation is per-request via `deps`
// (membership must be live — never cache across requests). Injectable for the pins.
// Cache ONLY the table-existence (schema — immutable per handle). The "any departments exist" check is
// queried LIVE every call so a department created mid-session takes effect on the next request, never a
// restart (eric A.2: membership/config must be live, never memoised per process).
const _deptTablesCache = new WeakMap();
function _departmentsConfigured(db) {
  let hasTables = _deptTablesCache.get(db);
  if (hasTables === undefined) {
    try { hasTables = db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name IN ('departments','user_departments')").get().n === 2; }
    catch { hasTables = false; }
    _deptTablesCache.set(db, hasTables);
  }
  if (!hasTables) return false;
  try { return db.prepare('SELECT 1 FROM departments LIMIT 1').get() != null; } catch { return false; }
}
function departmentDecision(db, user, doc, deps = {}) {
  const deptId = doc && doc.department_id;
  if (deptId == null) return { deny: false };                 // shared
  if (!_departmentsConfigured(db)) return { deny: false };    // nothing configured -> inert
  const role = user && user.role;
  if (role === 'admin') return { deny: false };               // (admin returns above too; belt)
  const uid = user ? (user.userId != null ? user.userId : user.id) : null;
  if (uid == null) return { deny: true };
  try {
    const u = db.prepare('SELECT all_departments FROM users WHERE id = ?').get(uid);
    if (u && u.all_departments) return { deny: false };       // the "accountant" flag
    const member = db.prepare('SELECT 1 FROM user_departments WHERE user_id = ? AND department_id = ?').get(uid, deptId);
    return { deny: !member };
  } catch { return { deny: false }; }                          // never throw the gate closed on a schema gap
}

module.exports = { canAccessDocument, gateEnabled, doctypeGrantDecision, departmentDecision };
