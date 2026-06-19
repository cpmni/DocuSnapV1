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

// True when a document has an OPEN routing task (pending or claimed). This is the
// workflow_lock signal: while it holds, the Review pipeline must not mutate the
// document (see workflowService.editGuard) so the two systems can't both edit the
// same row.
function hasActiveRoute(db, documentId) {
  return !!db.prepare(
    "SELECT 1 FROM document_routes WHERE document_id = ? AND state IN ('pending','claimed') LIMIT 1"
  ).get(documentId);
}

module.exports = {
  insertRoute, getRoute, listInbox, listSent, listAssigned, listCompleted,
  updateState, setDocWorkflowStatus, hasActiveRoute, OPEN_STATES, CLOSED_STATES,
};
