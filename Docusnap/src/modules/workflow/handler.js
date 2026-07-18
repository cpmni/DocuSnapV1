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
  const actor = () => { const u = getCurrentUser(); return { userId: u.id, username: u.username, role: u.role }; };

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
}

module.exports = { register };
