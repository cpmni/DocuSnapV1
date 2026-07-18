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

// Env kill switch. Absent/anything-but-a-disable-token => ON.
function gateEnabled() {
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

  if (role === 'edit') return { allow: true, reason: 'writer' };
  if (role === 'readonly') {
    return doc.status === 'confirmed'
      ? { allow: true, reason: 'readonly_confirmed' }
      : { allow: false, reason: 'readonly_unconfirmed' };
  }
  return { allow: false, reason: 'denied' };                       // null user / unknown role
}

module.exports = { canAccessDocument, gateEnabled };
