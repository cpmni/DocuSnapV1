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
  if (!hasActiveWorkflowLock(db, documentId, deps)) return { ok: true, locked: false };
  if (actorRole === 'admin') return { ok: true, locked: true, overridden: true };
  return {
    ok: false, locked: true, code: 'WORKFLOW_LOCKED',
    error: 'This document is in an approval workflow — resolve or recall it before editing.',
  };
}

// ── FYI non-locking (2026-07-19 slice) ───────────────────────────────────────
// LOCK POLICY, single authority for every lock reader (editGuard above + the batch-reprocess
// skip in processing/handler.js): only an open APPROVAL-side route locks; an open
// acknowledge/FYI route never does (visibility + dedupe only). Env WORKFLOW_ACK_LOCKS=1/true/on
// RESTORES the pre-slice any-route locking (read at call time — the decisionSnapshotEnabled
// pattern); default unset = non-locking FYI. Deliberately NO settings-table twin: a lock policy
// needs one authority. Safe default-new: the feature is dark in production
// (WORKFLOW_FEATURE_ENABLED=false ⇒ zero routes ⇒ both polarities byte-identical).
function ackLocksRestored() {
  const v = String(process.env.WORKFLOW_ACK_LOCKS || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on';
}
function hasActiveWorkflowLock(db, documentId, deps = {}) {
  const wf = deps.dbWorkflow || require('../../database/modules/workflow');
  return ackLocksRestored() ? wf.hasActiveRoute(db, documentId)
                            : wf.hasActiveApprovalRoute(db, documentId);
}

/**
 * Close every OPEN route on a document being (soft-)deleted — the honest tombstone
 * (Barry/Oracle, FYI slice): the recipient's inbox item becomes a Completed
 * 'recalled' entry reading "Document deleted by <name>" instead of silently
 * vanishing or sitting stranded-open against a dead doc forever (the pre-existing
 * hole at every unguarded soft-delete door). DB-ONLY and UNGATED (no env switch —
 * it converts silence into visibility, fail-toward-visible); the CALLER audits +
 * notifies AFTER its transaction commits (Oracle C2 — a notify from a rolled-back
 * tx announces a close that never happened; the editGuard caller-audits precedent).
 * Per-row CAS via the row's own version: changes===0 ⇒ a concurrent resolve won ⇒
 * skip (their resolution stands — honest either way). Returns { closed: [rows] }.
 * NOTE restore-from-bin does NOT reopen these routes (the doc resurrects, the route
 * stays closed with its now-historical comment; the sender re-routes — documented
 * residual, Oracle C8).
 */
function closeOpenRoutesForDeletedDoc(db, { documentId, deletedByName }, deps = {}) {
  const wf = deps.dbWorkflow || require('../../database/modules/workflow');
  const open = wf.listOpenRoutesForDocument(db, documentId);
  const closed = [];
  const resolvedAt = new Date().toISOString();
  const comment = `Document deleted by ${deletedByName || 'an administrator'}`;
  for (const r of open) {
    const changes = wf.updateState(db, r.id, r.version, {
      state: 'recalled', resolution_comment: comment, resolved_at: resolvedAt,
    });
    if (changes > 0) closed.push({ ...r, state: 'recalled', resolution_comment: comment, resolved_at: resolvedAt });
  }
  if (closed.length > 0) wf.setDocWorkflowStatus(db, documentId, 'recalled');
  return { closed };
}

// ── Decision snapshot (Slice 2) ──────────────────────────────────────────────
// Kill switch, read at CALL TIME (never cached at module load) so it's togglable in tests and
// flippable in a packaged build. Default OFF ⇒ resolve() writes no snapshot ⇒ byte-identical. Doubly
// dark: master WORKFLOW_FEATURE_ENABLED=false keeps resolve() unreachable in production regardless.
function decisionSnapshotEnabled() {
  const v = String(process.env.WORKFLOW_DECISION_SNAPSHOT || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on';
}

// Pure (DB-free) — assemble the append-only decision record from values already in hand. The snapshot
// captures the EXTRACTED FIELDS AT THE INSTANT OF RESOLVE — NOT "what the approver first saw". Since
// the FYI non-locking slice (2026-07-19) mid-route mutation is ROUTINE, not admin-exceptional: an open
// acknowledge route never locks, so the doc can be edited/reprocessed/re-confirmed at any time between
// send and resolve (an approve route still locks; only an admin override mutates under one). Inbox and
// live views always JOIN the CURRENT document fields, not routed-time values. FORWARD CONTRACT: no
// consumer (Slice-3 amount routing, payment auth, export) may treat snapshot_total_amount as a
// human-verified amount without a mid-flight-change guard. (Oracle C5 slice-2 + C7 FYI slice —
// docs/designs/WORKFLOW_FYI_NONLOCKING_2026-07-19.md.)
function buildDecisionSnapshot({ route, newState, resolvedAt, actor, comment, totalDisplay, overallConfidence }) {
  const snapshot = {
    document_id:        route.document_id,
    supplier_name:      route.supplier_name ?? null,
    reference_number:   route.reference_number ?? null,
    doc_date:           route.doc_date ?? null,
    type_name:          route.type_name ?? null,
    total:              totalDisplay ?? null,
    overall_confidence: overallConfidence ?? null,
    action_required:    route.action_required,
    resulting_state:    newState,        // approved | rejected | acknowledged
  };
  return {
    routeId:             route.id,
    documentId:          route.document_id,
    actorUserId:         actor.userId,
    actorUsername:       actor.username,
    decision:            newState,        // the committed resulting state
    comment:             comment ?? null,
    snapshotJson:        JSON.stringify(snapshot),
    snapshotTotalAmount: totalDisplay ?? null,
    chainPosition:       1,               // Slice-4 multi-step fills; single-hop = 1
    onBehalfOfUserId:    null,            // Slice-5 delegation
    onBehalfOfUsername:  null,
    decidedAt:           resolvedAt,
  };
}

function createWorkflowService(deps = {}) {
  const wf  = deps.dbWorkflow  || require('../../database/modules/workflow');
  const dbAuth = deps.dbAuth   || require('../../database/modules/auth');
  const docs = deps.dbDocuments || require('../../database/modules/documents');
  const now  = deps.now || (() => new Date().toISOString());
  const audit = deps.audit || (() => {});
  // Slice-1 notifications: fired AFTER a successful transition with {event, route, actor}
  // (event = assigned | claimed | approved | rejected | acknowledged | recalled). Default
  // no-op (the audit-hook pattern); wrapped so a THROWING sink can never fail the action
  // (pinned in test_workflow.js). Both transports wire it to main.js notifyWorkflowEvent.
  const notifyWorkflow = deps.notifyWorkflow || (() => {});
  const _notify = (event, route, actor) => { try { notifyWorkflow({ event, route, actor }); } catch { /* never fail the action */ } };
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
  // Shared recipient/routable validation used by BOTH assign (human sender) and assignSystem
  // (auto-file, null sender). Returns { ok:true, recipient } or a fail carrying the SAME codes assign
  // has always returned (NOT_FOUND / NOT_ROUTABLE / INACTIVE_RECIPIENT) — pinned byte-identical (Oracle C4).
  function _validateAssignTarget(db, documentId, toUserId) {
    const doc = docs.getById(db, documentId);
    if (!doc) return fail('NOT_FOUND', 'Document not found.');
    if (!ROUTABLE_STATES.includes(doc.status)) return fail('NOT_ROUTABLE', 'Only confirmed or in-review documents can be routed.');
    const recipient = dbAuth.getUserById(db, toUserId);
    if (!recipient) return fail('NOT_FOUND', 'Recipient not found.');
    if (!recipient.is_active) return fail('INACTIVE_RECIPIENT', 'Recipient account is disabled.');
    return { ok: true, recipient };
  }

  // `resubmitOf` (optional, Slice 1): advisory audit lineage only (no lookup/validation, pinned).
  // `matchedRuleSummary` (optional, routing slice): the immutable "why it routed" sentence snapshot.
  function assign(db, actor, { documentId, toUserId, actionRequired, comment, resubmitOf, matchedRuleSummary }) {
    if (!ACTOR_CAN_ASSIGN.includes(actor.role)) return fail('FORBIDDEN', 'Your role cannot route documents.');
    if (actionRequired !== 'approve' && actionRequired !== 'acknowledge') {
      return fail('INVALID', 'actionRequired must be "approve" or "acknowledge".');
    }
    const v = _validateAssignTarget(db, documentId, toUserId);
    if (!v.ok) return v;
    const recipient = v.recipient;

    const route = wf.insertRoute(db, {
      documentId, fromUserId: actor.userId, fromUsername: actor.username,
      toUserId: recipient.id, toUsername: recipient.username, actionRequired, comment,
      matchedRuleSummary: matchedRuleSummary ?? null,
    });
    wf.setDocWorkflowStatus(db, documentId, 'pending');
    const resubmitTag = resubmitOf != null ? ` resubmit_of=${String(resubmitOf).slice(0, 32)}` : '';
    audit({ user_id: actor.userId, action: 'workflow_route_created', action_category: 'workflow',
            outcome: 'success', target_type: 'document', target_id: documentId, document_id: documentId,
            details: `to=${recipient.username} action=${actionRequired}${resubmitTag}` });
    _notify('assigned', route, actor);
    return { ok: true, route };
  }

  // ── AssignSystem (auto-file routing — NO human sender) ────────────────────────
  // The auto-file path has no confirmer; `assign` refuses a machine actor (its role gate). This is a
  // first-class SYSTEM-sender route: NULL from_user_id + 'Auto-filed' sentinel, sharing assign's
  // recipient/routable validation, skipping ONLY the role gate. Writes only workflow_status (never
  // documents.status — the invariant). Not human-recallable (no from_user_id); closes via the
  // recipient's resolve (or an admin force-close — a documented pre-live item). (routing slice, Oracle.)
  function assignSystem(db, { documentId, toUserId, actionRequired, comment, matchedRuleSummary }) {
    if (actionRequired !== 'approve' && actionRequired !== 'acknowledge') {
      return fail('INVALID', 'actionRequired must be "approve" or "acknowledge".');
    }
    const v = _validateAssignTarget(db, documentId, toUserId);
    if (!v.ok) return v;
    const recipient = v.recipient;

    const route = wf.insertRoute(db, {
      documentId, fromUserId: null, fromUsername: 'Auto-filed',
      toUserId: recipient.id, toUsername: recipient.username, actionRequired,
      comment: comment || null, matchedRuleSummary: matchedRuleSummary ?? null,
    });
    wf.setDocWorkflowStatus(db, documentId, 'pending');
    audit({ user_id: null, action: 'workflow_route_created', action_category: 'workflow', outcome: 'success',
            target_type: 'document', target_id: documentId, document_id: documentId,
            details: `to=${recipient.username} action=${actionRequired} system=1` });
    _notify('assigned', route, { username: 'Auto-filed', role: 'system' });
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
    const fresh = wf.getRoute(db, routeId);
    _notify('claimed', fresh, actor);
    return { ok: true, route: fresh };
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
    // (a deciding action); "acknowledge" accepts only acknowledge.
    // NOTE: 'paid' was REMOVED for v1 (Oracle ruling, WORKFLOW_SUITE_2026-07-18.md §5) — it was
    // half-wired (in neither OPEN_STATES nor CLOSED_STATES, invisible in 3 of 4 boxes). Payment
    // tracking, if ever wanted, returns as a NEW designed state with its own migration — never
    // by re-adding 'paid' here (pinned in test_workflow.js).
    const DECIDE = ['approve', 'reject'];
    const okForApprove = route.action_required === 'approve' && DECIDE.includes(decision);
    const okForAck     = route.action_required === 'acknowledge' && decision === 'acknowledge';
    if (!okForApprove && !okForAck) {
      return fail('INVALID', `Decision "${decision}" is not valid for an "${route.action_required}" request.`);
    }
    // Least privilege: approve/reject need admin|edit; acknowledge is open to all.
    if (DECIDE.includes(decision) && !ACTOR_CAN_DECIDE.includes(actor.role)) {
      return fail('FORBIDDEN', 'Your role cannot approve or reject — only acknowledge.');
    }
    if (decision === 'reject' && !String(comment || '').trim()) {
      return fail('COMMENT_REQUIRED', 'A reason is required to reject.');
    }

    const resolvedAt = now();
    const newState = decision === 'approve' ? 'approved'
      : decision === 'reject' ? 'rejected' : 'acknowledged';
    const changed = wf.updateState(db, routeId, _ver(route, expectedVersion), {
      state: newState, resolution_comment: comment || null, resolved_at: resolvedAt,
    });
    if (!changed) return fail('CONFLICT', 'This item was updated by someone else. Refresh and retry.');
    // NOTE: documents.status (filing state) is intentionally NOT touched here.
    wf.setDocWorkflowStatus(db, route.document_id, newState);
    audit({ user_id: actor.userId, action: `workflow_${newState}`, action_category: 'workflow', outcome: 'success',
            target_type: 'document', target_id: route.document_id, document_id: route.document_id,
            details: decision === 'reject' ? 'rejected with reason' : undefined });
    // Decision snapshot (Slice 2) — an append-only record of the extracted fields at the INSTANT OF
    // RESOLVE, so a later reprocess can't rewrite what was decided. Written AFTER the CAS commit above
    // (a version-race loser returned CONFLICT at :168 and never reaches here ⇒ exactly one snapshot per
    // committed decision). Gated at CALL TIME by WORKFLOW_DECISION_SNAPSHOT (default OFF ⇒ byte-identical).
    // Best-effort: wrapped so a snapshot failure can NEVER roll back the decision (mirrors audit/notify);
    // the doc-side reads (total, overall_confidence) live here — buildDecisionSnapshot stays pure/DB-free.
    if (decisionSnapshotEnabled()) {
      try {
        const totalDisplay = docs.getExtractedTotalDisplay(db, route.document_id);
        const overallConfidence = docs.getById(db, route.document_id)?.overall_confidence ?? null;
        wf.insertRouteDecision(db, buildDecisionSnapshot({
          route, newState, resolvedAt, actor, comment: comment || null, totalDisplay, overallConfidence,
        }));
      } catch { /* never fail the resolve — document_routes + audit remain the source of truth */ }
    }
    // Stamp a PDF copy of the decision (approve/reject). Fire-and-forget + non-fatal:
    // the recorded decision above is the source of truth; a stamp failure never rolls it back.
    if (decision === 'approve' || decision === 'reject') {
      Promise.resolve()
        .then(() => stampDecision({ db, route, decision, userName: actor.username, comment, resolvedAt }))
        .then((stampedPath) => { if (stampedPath) { try { wf.setStampedPath(db, route.id, stampedPath); } catch { /* non-fatal */ } } })
        .catch(() => {});
    }
    const fresh = wf.getRoute(db, routeId);
    _notify(newState, fresh, actor);
    return { ok: true, route: fresh };
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
    const fresh = wf.getRoute(db, routeId);
    _notify('recalled', fresh, actor);
    return { ok: true, route: fresh };
  }

  // ── Admin cancel (E1 — the deliberate escape hatch) ───────────────────────────
  // Closes ANY open route (pending OR claimed) regardless of sender — the cure for the
  // routes `recall` can never reach: a NULL-sender system route (assignSystem — recallable
  // by nobody), a claimed route (unrecallable even by its sender), and a route to a
  // deactivated/deleted recipient (never resolvable; an approve route then locks the doc
  // forever — the editGuard admin override frees individual ACTIONS, never the route).
  // recall STAYS sender-only + pending-only (pinned in test_workflow.js): do not widen it —
  // this function is the escape hatch. DELIBERATELY no ROUTABLE_STATES / doc-status check:
  // a route stranded on an already-deleted document is exactly what this must still heal
  // (Oracle OC3 — never add one). Never stamps, never snapshots (both live only in resolve).
  // The comment is ALWAYS non-null — it is the display discriminator among the three
  // producers of 'recalled' (sender recall = NULL, delete-close = "Document deleted by…",
  // cancel = "Cancelled by…"); machine provenance is the distinct audit action. No code may
  // branch on the comment TEXT; a closed_reason column becomes mandatory at producer #4 or
  // first localisation (Oracle OC2).
  function adminCancelRoute(db, actor, routeId, { reason, expectedVersion } = {}) {
    if (!actor || actor.role !== 'admin') return fail('FORBIDDEN', 'Only an administrator can cancel a route.');
    const route = wf.getRoute(db, routeId);
    if (!route) return fail('NOT_FOUND', 'Route not found.');
    if (!['pending', 'claimed'].includes(route.state)) return fail('INVALID', `This item is already ${route.state}.`);
    const comment = `Cancelled by ${actor.displayName || actor.username} (administrator)`
      + (String(reason || '').trim() ? `: ${String(reason).trim()}` : '');
    const changed = wf.updateState(db, routeId, _ver(route, expectedVersion), {
      state: 'recalled', resolution_comment: comment, resolved_at: now(),
    });
    if (!changed) return fail('CONFLICT', 'This item was updated by someone else. Refresh and retry.');
    // A doc can carry SEVERAL open routes (manual assign has no dedupe): stamp the denorm
    // 'recalled' only when NO open route remains, else the survivors' state stands (gary C1;
    // recall/resolve blind-stamp — pre-existing display-only defect, editGuard never reads it).
    if (!wf.hasActiveRoute(db, route.document_id)) wf.setDocWorkflowStatus(db, route.document_id, 'recalled');
    audit({ user_id: actor.userId, action: 'workflow_route_cancelled', action_category: 'workflow',
            outcome: 'success', target_type: 'document', target_id: route.document_id,
            document_id: route.document_id,
            details: `route=${routeId} to=${route.to_username}${reason ? ' with reason' : ''}` });
    const fresh = wf.getRoute(db, routeId);
    // 'admin_cancelled' is DELIBERATELY unlisted in workflowNotify.eventDirection ⇒ badge-ping
    // only, no toast (gary C2 — reusing 'recalled' would couple admin cancels to any future
    // sender-recall toast decision, with grammar built for the sender).
    _notify('admin_cancelled', fresh, actor);
    return { ok: true, route: fresh };
  }

  return { inbox, sent, assigned, completed, assign, assignSystem, claim, resolve, recall, adminCancelRoute };
}

module.exports = { createWorkflowService, editGuard, hasActiveWorkflowLock, closeOpenRoutesForDeletedDoc,
  buildDecisionSnapshot, decisionSnapshotEnabled, ACTOR_CAN_ASSIGN, ACTOR_CAN_DECIDE, ROUTABLE_STATES };
