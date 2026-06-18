'use strict';

/**
 * services/workflowService.js
 * ---------------------------
 * Mailbox / approval workflow business logic — transport-agnostic, shared by the
 * detached client API and (later) the desktop IPC handler. Takes an explicit
 * `actor` { userId, username, role } so the SAME rules apply on every transport.
 *
 * Design decisions (locked in the plan):
 *  - SEPARATE state machine: approval NEVER rewrites documents.status (filing
 *    state). Only documents.workflow_status (denormalised) + document_routes move.
 *  - Stage 5a: routing is CONFIRMED-documents only.
 *  - Least privilege by role:
 *      assign (route to someone): admin | edit only,
 *      approve / reject:          admin | edit only (the recipient),
 *      acknowledge:               any role incl. readonly (recipient),
 *      recall:                    the sender, while still pending.
 *  - Claim-lock + optimistic version guard prevent double/stale resolution.
 *  - reject REQUIRES a reason (resolution comment).
 * Every transition is audited via the injected `audit` hook.
 */

const ACTOR_CAN_ASSIGN = ['admin', 'edit'];
const ACTOR_CAN_DECIDE  = ['admin', 'edit']; // approve/reject; acknowledge is open to all

function fail(code, error) { return { ok: false, code, error }; }

function createWorkflowService(deps = {}) {
  const wf  = deps.dbWorkflow  || require('../../database/modules/workflow');
  const dbAuth = deps.dbAuth   || require('../../database/modules/auth');
  const docs = deps.dbDocuments || require('../../database/modules/documents');
  const now  = deps.now || (() => new Date().toISOString());
  const audit = deps.audit || (() => {});

  function _ver(route, expectedVersion) {
    return expectedVersion == null ? route.version : expectedVersion;
  }

  // ── List views (you only ever see your own) ──────────────────────────────────
  const inbox     = (db, actor) => wf.listInbox(db, actor.userId);
  const sent      = (db, actor) => wf.listSent(db, actor.userId);
  const assigned  = (db, actor) => wf.listAssigned(db, actor.userId);
  const completed = (db, actor) => wf.listCompleted(db, actor.userId);

  // ── Assign (route a document to a user) ──────────────────────────────────────
  function assign(db, actor, { documentId, toUserId, actionRequired, comment }) {
    if (!ACTOR_CAN_ASSIGN.includes(actor.role)) return fail('FORBIDDEN', 'Your role cannot route documents.');
    if (actionRequired !== 'approve' && actionRequired !== 'acknowledge') {
      return fail('INVALID', 'actionRequired must be "approve" or "acknowledge".');
    }
    const doc = docs.getById(db, documentId);
    if (!doc) return fail('NOT_FOUND', 'Document not found.');
    if (doc.status !== 'confirmed') return fail('NOT_CONFIRMED', 'Only confirmed documents can be routed.');

    const recipient = dbAuth.getUserById(db, toUserId);
    if (!recipient) return fail('NOT_FOUND', 'Recipient not found.');
    if (!recipient.is_active) return fail('INACTIVE_RECIPIENT', 'Recipient account is disabled.');

    const route = wf.insertRoute(db, {
      documentId, fromUserId: actor.userId, fromUsername: actor.username,
      toUserId: recipient.id, toUsername: recipient.username, actionRequired, comment,
    });
    wf.setDocWorkflowStatus(db, documentId, 'pending');
    audit({ user_id: actor.userId, action: 'workflow_route_created', action_category: 'workflow',
            outcome: 'success', target_type: 'document', target_id: documentId, document_id: documentId,
            details: `to=${recipient.username} action=${actionRequired}` });
    return { ok: true, route };
  }

  // ── Claim (recipient takes ownership before resolving) ───────────────────────
  function claim(db, actor, routeId, expectedVersion) {
    const route = wf.getRoute(db, routeId);
    if (!route) return fail('NOT_FOUND', 'Route not found.');
    if (route.to_user_id !== actor.userId) return fail('FORBIDDEN', 'Only the recipient can claim this.');
    if (route.state !== 'pending') return fail('INVALID', `Cannot claim a ${route.state} route.`);
    const changed = wf.updateState(db, routeId, _ver(route, expectedVersion), {
      state: 'claimed', claimed_by_id: actor.userId, claimed_by_username: actor.username, claimed_at: now(),
    });
    if (!changed) return fail('CONFLICT', 'This item was updated by someone else. Refresh and retry.');
    wf.setDocWorkflowStatus(db, route.document_id, 'claimed');
    audit({ user_id: actor.userId, action: 'workflow_claimed', action_category: 'workflow', outcome: 'success',
            target_type: 'document', target_id: route.document_id, document_id: route.document_id });
    return { ok: true, route: wf.getRoute(db, routeId) };
  }

  // ── Resolve (approve | reject | acknowledge) ─────────────────────────────────
  function resolve(db, actor, routeId, { decision, comment, expectedVersion } = {}) {
    const route = wf.getRoute(db, routeId);
    if (!route) return fail('NOT_FOUND', 'Route not found.');
    if (route.to_user_id !== actor.userId) return fail('FORBIDDEN', 'Only the recipient can resolve this.');
    if (!['pending', 'claimed'].includes(route.state)) return fail('INVALID', `This item is already ${route.state}.`);
    if (route.claimed_by_id && route.claimed_by_id !== actor.userId) {
      return fail('FORBIDDEN', 'This item is claimed by someone else.');
    }

    // Decision must match what was requested.
    const okForApprove = route.action_required === 'approve' && (decision === 'approve' || decision === 'reject');
    const okForAck     = route.action_required === 'acknowledge' && decision === 'acknowledge';
    if (!okForApprove && !okForAck) {
      return fail('INVALID', `Decision "${decision}" is not valid for an "${route.action_required}" request.`);
    }
    // Least privilege: approve/reject need admin|edit; acknowledge is open to all.
    if ((decision === 'approve' || decision === 'reject') && !ACTOR_CAN_DECIDE.includes(actor.role)) {
      return fail('FORBIDDEN', 'Your role cannot approve or reject — only acknowledge.');
    }
    if (decision === 'reject' && !String(comment || '').trim()) {
      return fail('COMMENT_REQUIRED', 'A reason is required to reject.');
    }

    const newState = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'acknowledged';
    const changed = wf.updateState(db, routeId, _ver(route, expectedVersion), {
      state: newState, resolution_comment: comment || null, resolved_at: now(),
    });
    if (!changed) return fail('CONFLICT', 'This item was updated by someone else. Refresh and retry.');
    // NOTE: documents.status (filing state) is intentionally NOT touched here.
    wf.setDocWorkflowStatus(db, route.document_id, newState);
    audit({ user_id: actor.userId, action: `workflow_${newState}`, action_category: 'workflow', outcome: 'success',
            target_type: 'document', target_id: route.document_id, document_id: route.document_id,
            details: decision === 'reject' ? 'rejected with reason' : undefined });
    return { ok: true, route: wf.getRoute(db, routeId) };
  }

  // ── Recall (sender withdraws while still pending) ────────────────────────────
  function recall(db, actor, routeId, expectedVersion) {
    const route = wf.getRoute(db, routeId);
    if (!route) return fail('NOT_FOUND', 'Route not found.');
    if (route.from_user_id !== actor.userId) return fail('FORBIDDEN', 'Only the sender can recall this.');
    if (route.state !== 'pending') return fail('INVALID', `Cannot recall a ${route.state} route.`);
    const changed = wf.updateState(db, routeId, _ver(route, expectedVersion), { state: 'recalled', resolved_at: now() });
    if (!changed) return fail('CONFLICT', 'This item was updated by someone else. Refresh and retry.');
    wf.setDocWorkflowStatus(db, route.document_id, 'recalled');
    audit({ user_id: actor.userId, action: 'workflow_recalled', action_category: 'workflow', outcome: 'success',
            target_type: 'document', target_id: route.document_id, document_id: route.document_id });
    return { ok: true, route: wf.getRoute(db, routeId) };
  }

  return { inbox, sent, assigned, completed, assign, claim, resolve, recall };
}

module.exports = { createWorkflowService, ACTOR_CAN_ASSIGN, ACTOR_CAN_DECIDE };
