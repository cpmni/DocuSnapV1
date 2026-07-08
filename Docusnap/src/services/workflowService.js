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

// Stage 5b: documents that may be routed — confirmed AND uncommitted (review queue
// / deferred). pending/error/deleted are never routable.
const ROUTABLE_STATES = ['confirmed', 'needs_review', 'deferred'];

function fail(code, error) { return { ok: false, code, error }; }

/**
 * WORKFLOW_LOCK reconciliation (Stage 5b). The Review pipeline calls this before
 * mutating a document so the mailbox and the review/learning pipeline can't both
 * edit the same row. While a route is open (pending/claimed) the document is
 * locked; an admin may OVERRIDE (audited by the caller). Standalone (no service
 * instance needed) so review/handler.js can call it directly.
 *
 * @returns { ok:true, locked:false }                      not under workflow
 *        | { ok:true, locked:true, overridden:true }      admin override
 *        | { ok:false, locked:true, code:'WORKFLOW_LOCKED', error }
 */
function editGuard(db, documentId, actorRole, deps = {}) {
  const wf = deps.dbWorkflow || require('../../database/modules/workflow');
  if (!wf.hasActiveRoute(db, documentId)) return { ok: true, locked: false };
  if (actorRole === 'admin') return { ok: true, locked: true, overridden: true };
  return {
    ok: false, locked: true, code: 'WORKFLOW_LOCKED',
    error: 'This document is in an approval workflow — resolve or recall it before editing.',
  };
}

function createWorkflowService(deps = {}) {
  const wf  = deps.dbWorkflow  || require('../../database/modules/workflow');
  const dbAuth = deps.dbAuth   || require('../../database/modules/auth');
  const docs = deps.dbDocuments || require('../../database/modules/documents');
  const now  = deps.now || (() => new Date().toISOString());
  const audit = deps.audit || (() => {});
  // Visual derivative of an approve/reject decision (a stamped PDF copy). Best-effort +
  // non-fatal; tests inject a stub so they don't touch the filesystem.
  const stampDecision = deps.stampDecision || require('./pdfStamp').stampWorkflowDecision;

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
    if (!ROUTABLE_STATES.includes(doc.status)) {
      return fail('NOT_ROUTABLE', 'Only confirmed or in-review documents can be routed.');
    }

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

    // Decision must match what was requested. An "approve" request accepts approve | reject
    // | paid (a deciding action); "acknowledge" accepts only acknowledge.
    const DECIDE = ['approve', 'reject', 'paid'];
    const okForApprove = route.action_required === 'approve' && DECIDE.includes(decision);
    const okForAck     = route.action_required === 'acknowledge' && decision === 'acknowledge';
    if (!okForApprove && !okForAck) {
      return fail('INVALID', `Decision "${decision}" is not valid for an "${route.action_required}" request.`);
    }
    // Least privilege: approve/reject/paid need admin|edit; acknowledge is open to all.
    if (DECIDE.includes(decision) && !ACTOR_CAN_DECIDE.includes(actor.role)) {
      return fail('FORBIDDEN', 'Your role cannot approve, reject or mark paid — only acknowledge.');
    }
    if (decision === 'reject' && !String(comment || '').trim()) {
      return fail('COMMENT_REQUIRED', 'A reason is required to reject.');
    }

    const resolvedAt = now();
    const newState = decision === 'approve' ? 'approved'
      : decision === 'reject' ? 'rejected'
      : decision === 'paid' ? 'paid' : 'acknowledged';
    const changed = wf.updateState(db, routeId, _ver(route, expectedVersion), {
      state: newState, resolution_comment: comment || null, resolved_at: resolvedAt,
    });
    if (!changed) return fail('CONFLICT', 'This item was updated by someone else. Refresh and retry.');
    // NOTE: documents.status (filing state) is intentionally NOT touched here.
    wf.setDocWorkflowStatus(db, route.document_id, newState);
    audit({ user_id: actor.userId, action: `workflow_${newState}`, action_category: 'workflow', outcome: 'success',
            target_type: 'document', target_id: route.document_id, document_id: route.document_id,
            details: decision === 'reject' ? 'rejected with reason' : undefined });
    // Stamp a PDF copy of the decision (approve/reject/paid). Fire-and-forget + non-fatal:
    // the recorded decision above is the source of truth; a stamp failure never rolls it back.
    if (decision === 'approve' || decision === 'reject' || decision === 'paid') {
      Promise.resolve()
        .then(() => stampDecision({ db, route, decision, userName: actor.username, comment, resolvedAt }))
        .then((stampedPath) => { if (stampedPath) { try { wf.setStampedPath(db, route.id, stampedPath); } catch { /* non-fatal */ } } })
        .catch(() => {});
    }
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

module.exports = { createWorkflowService, editGuard, ACTOR_CAN_ASSIGN, ACTOR_CAN_DECIDE, ROUTABLE_STATES };
