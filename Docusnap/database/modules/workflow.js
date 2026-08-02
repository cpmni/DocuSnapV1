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
      (document_id, from_user_id, from_username, to_user_id, to_username, action_required, state, comment, matched_rule_summary)
    VALUES (@document_id, @from_user_id, @from_username, @to_user_id, @to_username, @action_required, 'pending', @comment, @matched_rule_summary)
  `).run({
    document_id: r.documentId, from_user_id: r.fromUserId, from_username: r.fromUsername,
    to_user_id: r.toUserId, to_username: r.toUsername, action_required: r.actionRequired,
    comment: r.comment || null, matched_rule_summary: r.matchedRuleSummary ?? null,
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

// ── Amount-threshold routing rules (Slice 3) ─────────────────────────────────
// insertRouteRule is used by tests / a future rules-management UI (dev-seeded in v1).
// listActiveRouteRules returns the active rules in evaluation order (step_order, id) — the
// amountRouting engine picks the FIRST whose type + band matches. `?? null` keeps better-sqlite3
// from seeing `undefined` on a @named param.
function insertRouteRule(db, r) {
  const info = db.prepare(`
    INSERT INTO workflow_route_rules
      (document_type_id, min_amount_pennies, max_amount_pennies, target_role, target_user_id,
       action_required, step_order, active, created_at)
    VALUES
      (@document_type_id, @min_amount_pennies, @max_amount_pennies, @target_role, @target_user_id,
       @action_required, @step_order, @active, @created_at)
  `).run({
    document_type_id:   r.documentTypeId ?? null,
    min_amount_pennies: r.minAmountPennies,
    max_amount_pennies: r.maxAmountPennies ?? null,
    target_role:        r.targetRole ?? null,
    target_user_id:     r.targetUserId ?? null,
    action_required:    r.actionRequired || 'approve',
    step_order:         r.stepOrder ?? 1,
    active:             r.active == null ? 1 : (r.active ? 1 : 0),
    created_at:         r.createdAt ?? null,
  });
  return info.lastInsertRowid;
}

function listActiveRouteRules(db) {
  return db.prepare('SELECT * FROM workflow_route_rules WHERE active = 1 ORDER BY step_order ASC, id ASC').all();
}
// The settings-area CRUD (admin): the UI shows ALL rules (active + inactive) with a toggle.
function listAllRouteRules(db) {
  return db.prepare('SELECT * FROM workflow_route_rules ORDER BY step_order ASC, id ASC').all();
}
function getRouteRule(db, id) {
  return db.prepare('SELECT * FROM workflow_route_rules WHERE id = ?').get(id);
}
function updateRouteRule(db, id, r) {
  return db.prepare(`UPDATE workflow_route_rules SET
      document_type_id=@document_type_id, min_amount_pennies=@min_amount_pennies, max_amount_pennies=@max_amount_pennies,
      target_role=@target_role, target_user_id=@target_user_id, action_required=@action_required WHERE id=@id`).run({
    id, document_type_id: r.documentTypeId ?? null, min_amount_pennies: r.minAmountPennies,
    max_amount_pennies: r.maxAmountPennies ?? null, target_role: r.targetRole ?? null,
    target_user_id: r.targetUserId ?? null, action_required: r.actionRequired || 'approve',
  }).changes;
}
function setRouteRuleActive(db, id, active) {
  return db.prepare('UPDATE workflow_route_rules SET active = ? WHERE id = ?').run(active ? 1 : 0, id).changes;
}
function deleteRouteRule(db, id) {
  return db.prepare('DELETE FROM workflow_route_rules WHERE id = ?').run(id).changes;
}

// Build the human-readable "why it routed" sentence for a rule AT ROUTE TIME (stored immutably on the
// route so a later rule edit/delete can't rewrite history — Oracle C6). Reads the type + target names.
function summarizeRule(db, rule) {
  if (!rule) return null;
  let typeName = 'a document';
  if (rule.document_type_id != null) {
    const t = db.prepare('SELECT name FROM document_types WHERE id = ?').get(rule.document_type_id);
    if (t && t.name) typeName = `a ${t.name}`;
  }
  const amt = (Number(rule.min_amount_pennies) > 0) ? ` and it's £${(rule.min_amount_pennies / 100).toFixed(2)} or more` : '';
  let target = 'someone';
  if (rule.target_user_id != null) {
    const u = db.prepare('SELECT display_name, username FROM users WHERE id = ?').get(rule.target_user_id);
    if (u) target = u.display_name || u.username;
  } else if (rule.target_role) {
    target = `the ${rule.target_role} team`;
  }
  // Action PHRASE, not a bare verb — "to ${act}" would render "to for information" (grammar
  // pinned in test_workflow.js). Older stored summaries keep the pre-slice "to just see it"
  // sentence — per-route summaries are immutable by design (Oracle C6), never migrated.
  const actPhrase = rule.action_required === 'acknowledge' ? 'for information' : 'to approve';
  return `When ${typeName} is filed${amt}, send it to ${target} ${actPhrase}.`;
}

// True when a document has an OPEN routing task (pending or claimed), ANY action.
// Since the FYI non-locking slice (2026-07-19) this is NOT the lock signal — it
// feeds the one-route-max routing dedupe (amountRouting.startDefaultRoute) and
// stays the broadest "something is in flight" read. The LOCK is
// hasActiveApprovalRoute below (see workflowService.editGuard).
function hasActiveRoute(db, documentId) {
  return !!db.prepare(
    "SELECT 1 FROM document_routes WHERE document_id = ? AND state IN ('pending','claimed') LIMIT 1"
  ).get(documentId);
}

// The workflow_lock signal: an OPEN route whose action is anything OTHER than
// 'acknowledge'. Polarity is deliberately NOT-acknowledge, not IS-approve
// (fail-toward-lock): a future action value ('countersign', multi-step 'waiting')
// stays LOCKED until deliberately exempted — pinned in test_workflow.js. An open
// acknowledge/FYI route never locks: an FYI is a postcard, not a gate (spec
// docs/designs/WORKFLOW_FYI_NONLOCKING_2026-07-19.md). Pure SQL — the
// WORKFLOW_ACK_LOCKS policy switch lives in workflowService (business rule).
function hasActiveApprovalRoute(db, documentId) {
  // The IS NULL arm is load-bearing: bare `<> 'acknowledge'` evaluates NULL for a NULL
  // action (legacy/raw row) and would silently UNLOCK it — fail-toward-lock covers NULL
  // exactly like an unknown value (pinned in test_workflow.js).
  return !!db.prepare(
    "SELECT 1 FROM document_routes WHERE document_id = ? AND state IN ('pending','claimed')"
    + " AND (action_required IS NULL OR action_required <> 'acknowledge') LIMIT 1"
  ).get(documentId);
}

// All OPEN routes for a document (raw rows incl. version — no display join): the
// delete-time close helper iterates these with per-row CAS.
function listOpenRoutesForDocument(db, documentId) {
  return db.prepare(
    "SELECT * FROM document_routes WHERE document_id = ? AND state IN ('pending','claimed') ORDER BY id"
  ).all(documentId);
}

// EVERY open route in the system, joined for the admin "Open routes" list — E1's discovery
// surface: a NULL-sender system route appears in NOBODY's Sent box, so without this list a
// stuck route is only found by per-doc luck. DELIBERATELY includes routes whose document is
// soft-deleted (doc_status exposed, rendered "(document deleted)"): with delete-close live those
// rows shouldn't exist, so any that DO are legacy strands or missed doors — exactly what an
// admin must see, and this list is their only healing surface (Oracle OC3 — do not filter).
// PROJECTED shape by design: no stamped_path, no comment, no SELECT * (same guard as the
// per-doc read; pinned in test_workflow_ipc.js).
function listAllOpenRoutes(db) {
  return db.prepare(`
    SELECT r.id, r.document_id, r.to_username, r.from_username, r.action_required, r.state,
           r.created_at, r.version,
           d.status AS doc_status, d.stored_filename, d.original_filename, d.supplier_name
    FROM document_routes r JOIN documents d ON d.id = r.document_id
    WHERE r.state IN ('pending','claimed')
    ORDER BY r.created_at ASC`).all();
}

// DECISION HISTORY for a document (Chris r4 card 2 — "who approved this and when?"):
// CLOSED routes only, newest decision first. PROJECTED IN THE SQL like listAllOpenRoutes
// (pinned in test_workflow_ipc.js): no stamped_path (has_stamped BOOLEAN instead — the
// viewer fetches by route id, the renderer never sees a path) and no sender `comment`
// (OC4: the private request note). resolution_comment IS shipped — it is the decision
// record (a rejection reason exists to be read); this is a DELIBERATE widening to any
// admin/edit doc viewer, noted to the owner. Resolver identity: to_username is sound for
// approved/rejected/acknowledged (only the recipient can resolve); 'recalled' rows render
// state + comment verbatim, never a guessed actor (OC2 — three producers share the state).
function listClosedRoutesForDocument(db, documentId) {
  return db.prepare(`
    SELECT r.id, r.state, r.action_required, r.to_username, r.from_username,
           r.resolution_comment, r.resolved_at, r.created_at,
           CASE WHEN r.stamped_path IS NOT NULL AND r.stamped_path <> '' THEN 1 ELSE 0 END AS has_stamped
    FROM document_routes r
    WHERE r.document_id = ? AND r.state IN ('approved','rejected','acknowledged','recalled')
    ORDER BY COALESCE(r.resolved_at, r.created_at) DESC`).all(documentId);
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
  updateState, setDocWorkflowStatus, setStampedPath, hasActiveRoute, hasActiveApprovalRoute,
  listOpenRoutesForDocument, listAllOpenRoutes, listClosedRoutesForDocument, isOpenRouteParty,
  insertRouteDecision, listRouteDecisions,
  insertRouteRule, listActiveRouteRules, listAllRouteRules, getRouteRule, updateRouteRule,
  setRouteRuleActive, deleteRouteRule, summarizeRule,
  OPEN_STATES, CLOSED_STATES,
};
