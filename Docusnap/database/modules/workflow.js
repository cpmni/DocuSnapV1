'use strict';

/**
 * database/modules/workflow.js
 * Data access for the mailbox / approval workflow (document_routes). Pure SQL — no
 * business rules or authorization (those live in src/services/workflowService.js).
 * State transitions go through updateState(), which is OPTIMISTICALLY CONCURRENT:
 * it only writes when the row's version matches the caller's expected version, so
 * two resolvers can't both win. List views join the document for display fields.
 */

const LIST_SELECT = `
  SELECT r.*, d.supplier_name, d.reference_number, d.doc_date, d.status AS doc_status,
         dt.name AS type_name, dt.slug AS type_slug
  FROM document_routes r
  JOIN documents d ON d.id = r.document_id
  LEFT JOIN document_types dt ON dt.id = d.document_type_id
`;

const OPEN_STATES = ['pending', 'claimed'];
const CLOSED_STATES = ['approved', 'rejected', 'acknowledged', 'recalled'];

function insertRoute(db, r) {
  const info = db.prepare(`
    INSERT INTO document_routes
      (document_id, from_user_id, from_username, to_user_id, to_username, action_required, state, comment)
    VALUES (@document_id, @from_user_id, @from_username, @to_user_id, @to_username, @action_required, 'pending', @comment)
  `).run({
    document_id: r.documentId, from_user_id: r.fromUserId, from_username: r.fromUsername,
    to_user_id: r.toUserId, to_username: r.toUsername, action_required: r.actionRequired,
    comment: r.comment || null,
  });
  return getRoute(db, info.lastInsertRowid);
}

function getRoute(db, id) {
  return db.prepare(`${LIST_SELECT} WHERE r.id = ?`).get(id);
}

function listInbox(db, userId) {
  return db.prepare(`${LIST_SELECT} WHERE r.to_user_id = ? AND r.state IN ('pending','claimed') ORDER BY r.created_at DESC`).all(userId);
}
function listSent(db, userId) {
  return db.prepare(`${LIST_SELECT} WHERE r.from_user_id = ? ORDER BY r.created_at DESC`).all(userId);
}
function listAssigned(db, userId) {
  return db.prepare(`${LIST_SELECT} WHERE r.claimed_by_id = ? AND r.state = 'claimed' ORDER BY r.claimed_at DESC`).all(userId);
}
function listCompleted(db, userId) {
  return db.prepare(
    `${LIST_SELECT} WHERE (r.to_user_id = ? OR r.from_user_id = ?)
       AND r.state IN ('approved','rejected','acknowledged','recalled') ORDER BY r.resolved_at DESC`
  ).all(userId, userId);
}

// ── Cheap per-user box counts (Slice 1 notifications) ──────────────────────────
// ONE source, three consumers: the Home "Waiting on you" card (get-workflow-counts
// IPC), the at-login digest, and GET /v1/workflow/counts (the client's 60s badge
// poll). COUNT-only so a poll never pays the LIST_SELECT join. Each MUST mirror its
// list query's WHERE exactly (pinned in test_workflow.js) or badges drift from tabs.
function countInbox(db, userId) {
  return db.prepare("SELECT COUNT(*) c FROM document_routes WHERE to_user_id = ? AND state IN ('pending','claimed')").get(userId).c;
}
function countSent(db, userId) {
  return db.prepare('SELECT COUNT(*) c FROM document_routes WHERE from_user_id = ?').get(userId).c;
}
function countOpenSent(db, userId) {   // "awaiting others" — my still-open requests
  return db.prepare("SELECT COUNT(*) c FROM document_routes WHERE from_user_id = ? AND state IN ('pending','claimed')").get(userId).c;
}
function countAssigned(db, userId) {
  return db.prepare("SELECT COUNT(*) c FROM document_routes WHERE claimed_by_id = ? AND state = 'claimed'").get(userId).c;
}
function countCompleted(db, userId) {
  return db.prepare(
    "SELECT COUNT(*) c FROM document_routes WHERE (to_user_id = ? OR from_user_id = ?)"
    + " AND state IN ('approved','rejected','acknowledged','recalled')"
  ).get(userId, userId).c;
}

/**
 * Apply a state transition guarded by optimistic version. `fields` may set state,
 * comment/resolution_comment, claim/resolve stamps. Returns the number of rows
 * written (0 = version conflict / not found).
 */
function updateState(db, id, expectedVersion, fields) {
  const allowed = ['state', 'resolution_comment', 'claimed_by_id', 'claimed_by_username', 'claimed_at', 'resolved_at'];
  const sets = Object.keys(fields).filter(k => allowed.includes(k)).map(k => `${k} = @${k}`);
  sets.push('version = version + 1');
  const info = db.prepare(
    `UPDATE document_routes SET ${sets.join(', ')} WHERE id = @id AND version = @version`
  ).run({ ...fields, id, version: expectedVersion });
  return info.changes;
}

function setDocWorkflowStatus(db, documentId, status) {
  db.prepare('UPDATE documents SET workflow_status = ? WHERE id = ?').run(status, documentId);
}

// Record the filed stamped-PDF copy of a resolved decision (server-local path).
function setStampedPath(db, routeId, stampedPath) {
  db.prepare('UPDATE document_routes SET stamped_path = ? WHERE id = ?').run(stampedPath, routeId);
}

// ── Decision snapshot (Slice 2) — APPEND-ONLY ────────────────────────────────
// insertRouteDecision writes one immutable record of an approve/reject/acknowledge
// (the extracted fields AT THE INSTANT OF RESOLVE). There is deliberately NO update/
// delete sibling — append-only is enforced both by that absence AND by the two
// BEFORE UPDATE/DELETE triggers on the table (database/index.js). `?? null` keeps
// better-sqlite3 from seeing `undefined` (which throws on a @named param).
function insertRouteDecision(db, d) {
  const info = db.prepare(`
    INSERT INTO route_decisions
      (route_id, document_id, actor_user_id, actor_username, decision, comment,
       snapshot_json, snapshot_total_amount, chain_position, on_behalf_of_user_id,
       on_behalf_of_username, decided_at)
    VALUES
      (@route_id, @document_id, @actor_user_id, @actor_username, @decision, @comment,
       @snapshot_json, @snapshot_total_amount, @chain_position, @on_behalf_of_user_id,
       @on_behalf_of_username, @decided_at)
  `).run({
    route_id:              d.routeId ?? null,
    document_id:           d.documentId ?? null,
    actor_user_id:         d.actorUserId ?? null,
    actor_username:        d.actorUsername ?? null,
    decision:              d.decision ?? null,
    comment:               d.comment ?? null,
    snapshot_json:         d.snapshotJson ?? null,
    snapshot_total_amount: d.snapshotTotalAmount ?? null,
    chain_position:        d.chainPosition ?? 1,
    on_behalf_of_user_id:  d.onBehalfOfUserId ?? null,
    on_behalf_of_username: d.onBehalfOfUsername ?? null,
    decided_at:            d.decidedAt ?? null,
  });
  return info.lastInsertRowid;
}

// Read the decision history for a document (the export/mailbox reader), oldest first.
function listRouteDecisions(db, documentId) {
  return db.prepare(
    'SELECT * FROM route_decisions WHERE document_id = ? ORDER BY decided_at ASC, id ASC'
  ).all(documentId);
}

// True when a document has an OPEN routing task (pending or claimed). This is the
// workflow_lock signal: while it holds, the Review pipeline must not mutate the
// document (see workflowService.editGuard) so the two systems can't both edit the
// same row.
function hasActiveRoute(db, documentId) {
  return !!db.prepare(
    "SELECT 1 FROM document_routes WHERE document_id = ? AND state IN ('pending','claimed') LIMIT 1"
  ).get(documentId);
}

// True when `userId` is a PARTY (sender or recipient) on an OPEN route for this
// document — the per-document visibility grant used by accessService.canAccessDocument
// (docs/designs/WORKFLOW_SUITE_2026-07-18.md §3, Oracle C3: OPEN routes only, so the
// grant ENDS when the route closes; a closed-route party gets the immutable snapshot,
// not the live doc). OPEN = pending|claimed today; extend to include 'waiting' when the
// multi-step slice adds that state.
function isOpenRouteParty(db, documentId, userId) {
  if (userId == null) return false;
  return !!db.prepare(
    "SELECT 1 FROM document_routes WHERE document_id = ? AND (from_user_id = ? OR to_user_id = ?)"
    + " AND state IN ('pending','claimed') LIMIT 1"
  ).get(documentId, userId, userId);
}

module.exports = {
  insertRoute, getRoute, listInbox, listSent, listAssigned, listCompleted,
  countInbox, countSent, countOpenSent, countAssigned, countCompleted,
  updateState, setDocWorkflowStatus, setStampedPath, hasActiveRoute, isOpenRouteParty,
  insertRouteDecision, listRouteDecisions,
  OPEN_STATES, CLOSED_STATES,
};
