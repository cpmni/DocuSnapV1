'use strict';

/**
 * modules/workflow/handler.js
 * ---------------------------
 * In-process (IPC) mailbox/approval workflow for the CORE app's enhanced Search —
 * the desktop counterpart to the detached client's /v1 workflow routes. It reuses
 * services/workflowService (NO duplicated logic): the actor comes from the
 * in-process auth session, every transition is audited via logAudit, and access is
 * gated by BOTH role (inside workflowService) and the workflow add-on ENTITLEMENT.
 *
 * When the add-on isn't licensed, every workflow IPC rejects with
 * FEATURE_NOT_LICENSED — so the unlicensed core app simply has no workflow (its
 * Search reverts to the basic experience). get-entitlement stays open to any
 * logged-in user so the renderer can decide which experience to show.
 */

const workflowService = require('../../services/workflowService');
const entitlementService = require('../../services/entitlementService');

function register(ctx) {
  const { ipcMain, getDb } = ctx;
  const dbAuth = require('../../../database/modules/auth');
  const { requireLogin, requireRole, getCurrentUser, logAudit } = require('../auth/handler');

  const workflow = workflowService.createWorkflowService({
    audit: (entry) => logAudit(getDb(), entry),
    // Slice 1: the shared main.js notification sink (badge fan-out + debounced toast).
    // Best-effort — the service already shields the action from a throwing hook.
    notifyWorkflow: (ev) => { try { ctx.notifyWorkflowEvent && ctx.notifyWorkflowEvent(ev); } catch { /* best-effort */ } },
  });
  const actor = () => { const u = getCurrentUser(); return { userId: u.id, username: u.username, displayName: u.displayName, role: u.role }; };

  function assertEntitled() {
    // Workflow is now its OWN licensed feature (split from the base detached-client /
    // search add-on), so gate on the workflow entitlement specifically.
    const e = entitlementService.checkClientEntitlement(getDb());
    if (!e.workflow || !e.workflow.entitled) throw Object.assign(new Error('The workflow add-on is not licensed for this install.'), { code: 'FEATURE_NOT_LICENSED' });
  }
  const unwrap = (r) => {
    if (r.ok) return r.route;
    throw Object.assign(new Error(r.error || 'Workflow action failed.'), { code: r.code });
  };

  // Entitlement probe — any logged-in user (drives basic-vs-enhanced Search).
  ipcMain.handle('get-entitlement', () => { requireLogin(); return entitlementService.checkClientEntitlement(getDb()); });

  // Per-user box counts (Slice 1) for the Home "Waiting on you" card + repaints. Cheap
  // COUNTs only — deliberately NOT the heavy get-dashboard-extra pipeline (eric: statfsSync
  // per event under bulk assigns). Returns a clean {entitled:false} instead of throwing
  // while the feature is dark, so the Home dashboard never logs errors (Oracle F8b).
  ipcMain.handle('get-workflow-counts', () => {
    requireLogin();
    const db = getDb();
    const e = entitlementService.checkClientEntitlement(db);
    if (!e.workflow || !e.workflow.entitled) return { entitled: false };
    const dbwf = require('../../../database/modules/workflow');
    const u = actor();
    return {
      entitled: true,
      inbox:     dbwf.countInbox(db, u.userId),
      openSent:  dbwf.countOpenSent(db, u.userId),
      sent:      dbwf.countSent(db, u.userId),
      assigned:  dbwf.countAssigned(db, u.userId),
      completed: dbwf.countCompleted(db, u.userId),
    };
  });

  // List views (logged-in + entitled; each list is already scoped to the actor).
  for (const box of ['inbox', 'sent', 'assigned', 'completed']) {
    ipcMain.handle(`workflow-${box}`, () => { requireLogin(); assertEntitled(); return workflow[box](getDb(), actor()); });
  }

  // Assignable recipients — only roles that can route may list them.
  ipcMain.handle('workflow-recipients', () => {
    requireRole('admin', 'edit'); assertEntitled();
    return (dbAuth.getAllUsers(getDb()) || []).filter(u => u.is_active)
      .map(u => ({ id: u.id, username: u.username, displayName: u.display_name, role: u.role }));
  });

  // Transitions (role rules enforced inside workflowService).
  ipcMain.handle('workflow-assign',  (_e, p = {})                       => { requireLogin(); assertEntitled(); return unwrap(workflow.assign(getDb(), actor(), p)); });
  ipcMain.handle('workflow-claim',   (_e, { id, version } = {})         => { requireLogin(); assertEntitled(); return unwrap(workflow.claim(getDb(), actor(), id, version)); });
  ipcMain.handle('workflow-resolve', (_e, { id, decision, comment, version } = {}) => { requireLogin(); assertEntitled(); return unwrap(workflow.resolve(getDb(), actor(), id, { decision, comment, expectedVersion: version })); });
  ipcMain.handle('workflow-recall',  (_e, { id, version } = {})         => { requireLogin(); assertEntitled(); return unwrap(workflow.recall(getDb(), actor(), id, version)); });

  // ── E1 admin cancel (docs/designs/WORKFLOW_ADMIN_CANCEL_2026-07-19.md) ─────────
  // The escape hatch for routes recall can't reach (NULL-sender system routes, claimed
  // routes, deactivated recipients). Admin-gated at the IPC AND inside the service.
  ipcMain.handle('workflow-admin-cancel', (_e, { id, version, reason } = {}) => {
    requireRole('admin'); assertEntitled();
    return unwrap(workflow.adminCancelRoute(getDb(), actor(), id, { reason, expectedVersion: version }));
  });
  // OPEN routes for ONE document — feeds the Search-preview "Routed to <name>" banner.
  // A NEW by-id read seam ⇒ accessService gate (skipping it would reopen SEC-03 as a 7th
  // hole — eric). admin/edit read (an edit user gets the informational banner; cancel stays
  // admin-only). PROJECTED shape: no stamped_path, and no comment — the banner never renders
  // it, so the sender's private note must not ship to every edit renderer (Oracle OC4).
  ipcMain.handle('workflow-doc-routes', (_e, { documentId } = {}) => {
    const sess = requireRole('admin', 'edit'); assertEntitled();
    const db = getDb();
    const acc = require('../../services/accessService').canAccessDocument(db, sess, Number(documentId));
    if (!acc.allow) throw Object.assign(new Error('Document not found.'), { code: 'NOT_FOUND' });
    return require('../../../database/modules/workflow').listOpenRoutesForDocument(db, Number(documentId))
      .map(r => ({ id: r.id, to_username: r.to_username, from_username: r.from_username,
                   action_required: r.action_required, state: r.state, created_at: r.created_at, version: r.version }));
  });
  // EVERY open route (admin) — the Settings "Open routes" list, E1's discovery surface
  // (a system route appears in nobody's Sent box). Projection lives in the SQL
  // (workflow.listAllOpenRoutes); includes soft-deleted-doc rows by design (Oracle OC3).
  ipcMain.handle('workflow-open-routes', () => {
    requireRole('admin'); assertEntitled();
    return require('../../../database/modules/workflow').listAllOpenRoutes(getDb());
  });

  // ── Routing rules — the Workflow settings area (admin + entitled; every mutation audited) ─────
  // Rules are approval OR "for information" (acknowledge) since the FYI non-locking slice
  // (2026-07-19 — the old D1 approval-only pin was DELIBERATELY lifted once acknowledge stopped
  // edit-locking; docs/designs/WORKFLOW_FYI_NONLOCKING_2026-07-19.md). NAMED-PERSON only
  // (target_role is a later slice). The amount is optional; when set it means "£X or more"
  // (inclusive-min). The action allowlist below is the TRUST BOUNDARY — never the renderer.
  const dbwf = () => require('../../../database/modules/workflow');
  const documents = require('../../../database/modules/documents');
  const amountRouting = require('../../services/amountRouting');
  const _ruleFromPayload = (p) => ({
    documentTypeId:   (p.documentTypeId != null && p.documentTypeId !== '') ? Number(p.documentTypeId) : null,
    minAmountPennies: (p.amountText != null && String(p.amountText).trim() !== '') ? amountRouting.totalToPennies(String(p.amountText)) : 0,
    maxAmountPennies: null,       // v1 = min-only
    targetRole:       null,       // v1 = named person only
    targetUserId:     (p.targetUserId != null) ? Number(p.targetUserId) : null,
    // Missing/empty ⇒ 'approve' (stale-renderer back-compat); anything else passes through for
    // _validateRule's allowlist to judge (never silently coerce an unknown action to approve).
    actionRequired:   (p.actionRequired == null || p.actionRequired === '') ? 'approve' : String(p.actionRequired),
  });
  const _validateRule = (r) => {
    if (r.minAmountPennies == null || r.minAmountPennies < 0) return "That amount doesn't look right.";
    if (r.targetUserId == null || !Number.isFinite(r.targetUserId)) return 'Choose who to send it to.';
    if (r.actionRequired !== 'approve' && r.actionRequired !== 'acknowledge') return 'Choose approval or for-information.';
    return null;
  };
  const _withSummary = (db, row) => (row ? { ...row, summary: dbwf().summarizeRule(db, row) } : null);

  ipcMain.handle('workflow-rules-list', () => {
    requireRole('admin'); assertEntitled();
    const db = getDb();
    return dbwf().listAllRouteRules(db).map(r => _withSummary(db, r));
  });
  ipcMain.handle('workflow-rule-create', (_e, p = {}) => {
    requireRole('admin'); assertEntitled();
    const db = getDb(); const r = _ruleFromPayload(p); const err = _validateRule(r);
    if (err) return { error: err };
    const id = dbwf().insertRouteRule(db, r);
    logAudit(db, { user_id: actor().userId, action: 'workflow_rule_created', action_category: 'workflow', outcome: 'success', target_type: 'workflow_rule', target_id: Number(id), details: `type=${r.documentTypeId} min=${r.minAmountPennies} to=${r.targetUserId}` });
    return { ok: true, rule: _withSummary(db, dbwf().getRouteRule(db, id)) };
  });
  ipcMain.handle('workflow-rule-update', (_e, p = {}) => {
    requireRole('admin'); assertEntitled();
    const db = getDb(); const id = Number(p.id); const r = _ruleFromPayload(p); const err = _validateRule(r);
    if (!id || err) return { error: err || 'Bad request.' };
    dbwf().updateRouteRule(db, id, r);
    logAudit(db, { user_id: actor().userId, action: 'workflow_rule_updated', action_category: 'workflow', outcome: 'success', target_type: 'workflow_rule', target_id: id });
    return { ok: true, rule: _withSummary(db, dbwf().getRouteRule(db, id)) };
  });
  ipcMain.handle('workflow-rule-toggle', (_e, { id, active } = {}) => {
    requireRole('admin'); assertEntitled();
    const db = getDb(); dbwf().setRouteRuleActive(db, Number(id), !!active);
    logAudit(db, { user_id: actor().userId, action: 'workflow_rule_toggled', action_category: 'workflow', outcome: 'success', target_type: 'workflow_rule', target_id: Number(id), details: active ? 'on' : 'off' });
    return { ok: true };
  });
  ipcMain.handle('workflow-rule-delete', (_e, { id } = {}) => {
    requireRole('admin'); assertEntitled();
    const db = getDb(); dbwf().deleteRouteRule(db, Number(id));
    logAudit(db, { user_id: actor().userId, action: 'workflow_rule_deleted', action_category: 'workflow', outcome: 'success', target_type: 'workflow_rule', target_id: Number(id) });
    return { ok: true };
  });
  // Read-only DRY-RUN — calls the PURE matcher, NEVER startDefaultRoute/assign, so it can't create a
  // route (Oracle's UI contract). Reports which of the last 30 filed docs the draft would route.
  ipcMain.handle('workflow-rule-dry-run', (_e, p = {}) => {
    requireRole('admin'); assertEntitled();
    const db = getDb(); const r = _ruleFromPayload(p); const err = _validateRule(r);
    if (err) return { error: err };
    const draft = { id: 0, document_type_id: r.documentTypeId, min_amount_pennies: r.minAmountPennies,
                    max_amount_pennies: r.maxAmountPennies, target_user_id: r.targetUserId, action_required: r.actionRequired };
    const recent = db.prepare("SELECT id, document_type_id, supplier_name, original_filename FROM documents WHERE status='confirmed' ORDER BY confirmed_at DESC LIMIT 30").all();
    const recentDocs = recent.map(d => ({ id: d.id, document_type_id: d.document_type_id, totalDisplay: documents.getExtractedTotalDisplay(db, d.id) }));
    const g = amountRouting.dryRunRules([draft], recentDocs)[0];
    const matchedIds = g ? new Set(g.sample) : new Set();
    const matched = recent.filter(d => matchedIds.has(d.id)).map(d => ({
      supplier: d.supplier_name || '(no supplier)', filename: d.original_filename, total: documents.getExtractedTotalDisplay(db, d.id) || '',
    }));
    return { count: g ? g.count : 0, sampled: recent.length, matched };
  });
}

module.exports = { register };
