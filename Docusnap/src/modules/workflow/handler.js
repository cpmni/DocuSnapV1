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
  // stamped_path is SWAPPED for a has_stamped boolean before crossing to the renderer —
  // the in-app viewer fetches pages by route id, so no renderer ever needs (or gets) the
  // filesystem path (the owner's Edge-address-bar disclosure, closed at the source).
  for (const box of ['inbox', 'sent', 'assigned', 'completed']) {
    ipcMain.handle(`workflow-${box}`, () => {
      requireLogin(); assertEntitled();
      return (workflow[box](getDb(), actor()) || []).map(({ stamped_path, ...r }) =>
        ({ ...r, has_stamped: !!stamped_path }));
    });
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
  // DECISION HISTORY for one document (Chris r4 card 2) — CLOSED routes, projected in the
  // SQL (no stamped_path — has_stamped + route id feed the in-app viewer; no sender comment
  // per OC4; resolution_comment ships BY DESIGN, it is the decision record). Same gate as
  // doc-routes: admin/edit + entitled + accessService (SEC-03). NEW IPC, not a widening —
  // doc-routes' OPEN-only shape is pinned and its consumer branches on it (eric A2).
  ipcMain.handle('workflow-doc-history', (_e, { documentId } = {}) => {
    const sess = requireRole('admin', 'edit'); assertEntitled();
    const db = getDb();
    const acc = require('../../services/accessService').canAccessDocument(db, sess, Number(documentId));
    if (!acc.allow) throw Object.assign(new Error('Document not found.'), { code: 'NOT_FOUND' });
    return require('../../../database/modules/workflow').listClosedRoutesForDocument(db, Number(documentId));
  });
  // STAMPED-COPY PAGES by route id (the secure in-app viewer; owner 2026-08-02 — the shell
  // open leaked the real path into Edge's address bar). Desktop twin of the /v1 stamped read
  // (api/handler.js GET /workflow/routes/:id/stamped): the path resolves SERVER-SIDE from
  // the route row, party-or-admin gated, and only page IMAGES cross to the renderer — never
  // bytes-as-PDF, never a path.
  const _routeParty = (route) => {
    const u = actor();
    if (!(u.userId === route.to_user_id || u.userId === route.from_user_id || u.role === 'admin')) {
      throw Object.assign(new Error('Not permitted.'), { code: 'FORBIDDEN' });
    }
  };
  ipcMain.handle('workflow-stamped-pages', async (_e, { routeId } = {}) => {
    requireLogin(); assertEntitled();
    const db = getDb();
    const route = require('../../../database/modules/workflow').getRoute(db, Number(routeId));
    if (!route) throw Object.assign(new Error('Route not found.'), { code: 'NOT_FOUND' });
    _routeParty(route);
    const fs = require('fs'), path = require('path');
    if (!route.stamped_path || !fs.existsSync(route.stamped_path)) {
      return { ok: false, reason: 'stamped_missing' };
    }
    const previewService = require('../../services/previewService');
    const pages = await previewService.getDocumentPages(db, {
      docId: route.document_id, folderPath: path.dirname(route.stamped_path),
      filename: path.basename(route.stamped_path), exact: true,
    }, {
      fs, path, spawn: require('child_process').spawn,
      pythonExe: ctx.pythonExe, pythonArgs: ctx.pythonArgs,
      renderScript: ctx.resourcePath('python_backend', 'render', 'pages.py'),
    });
    return { ok: true, pages, state: route.state, routeId: route.id };
  });
  // AUDITED "Save a copy" for a stamped decision PDF (the viewer's only file-egress path).
  ipcMain.handle('workflow-export-stamped', async (e, { routeId } = {}) => {
    requireLogin(); assertEntitled();
    const db = getDb();
    const route = require('../../../database/modules/workflow').getRoute(db, Number(routeId));
    if (!route) throw Object.assign(new Error('Route not found.'), { code: 'NOT_FOUND' });
    _routeParty(route);
    const fs = require('fs');
    if (!route.stamped_path || !fs.existsSync(route.stamped_path)) {
      return { ok: false, reason: 'stamped_missing' };
    }
    const { dialog, BrowserWindow } = require('electron');
    const win = BrowserWindow.fromWebContents(e.sender);
    // Human filename (Chris r5 card 5): "Stamped-copy.route-1.pdf" is machine bookkeeping on
    // an artifact whose whole life is being emailed onward. Use the doc's own shelf name +
    // the decision; fall back original_filename → route id (doc purged).
    let base = null;
    try {
      const d = db.prepare('SELECT stored_filename, original_filename FROM documents WHERE id = ?').get(route.document_id);
      base = (d && (d.stored_filename || d.original_filename)) || null;
    } catch { /* fall through */ }
    const decision = route.state === 'approved' ? 'APPROVED' : route.state === 'rejected' ? 'REJECTED' : String(route.state || '').toUpperCase();
    const defName = base
      ? `${base.replace(/\.pdf$/i, '')} — ${decision}.pdf`
      : `Stamped-copy.route-${route.id}.pdf`;
    const r = await dialog.showSaveDialog(win, {
      defaultPath: defName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    const outcome = (r.canceled || !r.filePath) ? 'cancelled' : 'success';
    if (outcome === 'success') fs.copyFileSync(route.stamped_path, r.filePath);
    try {
      logAudit(getDb(), { action: 'document_exported', action_category: 'document',
        target_type: 'document', target_id: route.document_id, document_id: route.document_id,
        outcome, metadata: { route_id: route.id, kind: 'stamped_copy',
                             ...(outcome === 'success' ? { destination: require('path').basename(r.filePath) } : {}) } });
    } catch { /* audit best-effort */ }
    return { ok: outcome === 'success', reason: outcome };
  });

  // ── STAMPING (Workflow+Stamping redesign 2026-08-28) ──────────────────────────
  // Desktop self-stamp is a CORE capability — gated on the stamp PERMISSION + document ACCESS
  // (Oracle gate 5), NOT the workflow add-on, so a standalone owner can stamp. Catalog/grant admin
  // actions are role-gated. Every real gate lives INSIDE the service; the renderer sends coords + a type.
  const stampSvc  = require('../../services/stampService').createStampService();
  const stampPerm = require('../auth/stampPermission');
  const stampsDb  = require('../../../database/modules/stamps');
  const _stampAccessOr404 = (db, docId) => {
    const acc = require('../../services/accessService').canAccessDocument(db, actor(), Number(docId));
    if (!acc.allow) throw Object.assign(new Error('Document not found.'), { code: 'NOT_FOUND' });
  };
  // Does the current user hold the stamp permission? Drives show/hide of the stamp UI (server re-checks).
  ipcMain.handle('stamp-can', () => { requireLogin(); return { canStamp: stampPerm.canStamp(getDb(), getCurrentUser().id) }; });
  // The stamp catalog (any logged-in user may READ it; only stampers ever place one).
  ipcMain.handle('stamp-types', () => { requireLogin(); return stampsDb.listStampTypes(getDb()); });
  // Place a stamp — coords + type only; the service resolves the source, gates permission + access,
  // writes the immutable record atomically.
  ipcMain.handle('stamp-place', async (_e, { documentId, stampTypeId, box, page, note } = {}) => {
    requireLogin();
    const r = await stampSvc.placeStamp(getDb(), actor(), { documentId: Number(documentId), stampTypeId: Number(stampTypeId), box, page, note });
    if (!r.ok) throw Object.assign(new Error(r.error || 'Could not stamp.'), { code: r.code });
    return r;
  });
  // Stamp history for a document (path-stripped).
  ipcMain.handle('stamp-list', (_e, { documentId } = {}) => {
    requireLogin(); const db = getDb(); _stampAccessOr404(db, documentId);
    return stampSvc.stampsForDocument(db, Number(documentId));
  });
  // Render the CURRENT stamped artifact to page images (the Search "Stamped" toggle). Path-free — the
  // artifact is resolved server-side; only images cross to the renderer (the stamped-viewer discipline).
  ipcMain.handle('stamp-current-pages', async (_e, { documentId } = {}) => {
    requireLogin(); const db = getDb(); _stampAccessOr404(db, documentId);
    const cur = stampSvc.currentArtifact(db, Number(documentId));
    if (!cur) return { ok: false, reason: 'no_stamp' };
    const fs = require('fs'), path = require('path');
    const pages = await require('../../services/previewService').getDocumentPages(db, {
      docId: Number(documentId), folderPath: path.dirname(cur.path), filename: path.basename(cur.path), exact: true,
      scale: 3,   // match the Search preview's ~216 DPI so the Stamped/Original toggle looks consistent
    }, { fs, path, spawn: require('child_process').spawn, pythonExe: ctx.pythonExe, pythonArgs: ctx.pythonArgs,
         renderScript: ctx.resourcePath('python_backend', 'render', 'pages.py') });
    return { ok: true, pages, count: cur.count };
  });
  // ── Catalog + permission ADMIN (Settings) ────────────────────────────────────
  ipcMain.handle('stamp-type-create', (_e, { label, color, category } = {}) => {
    requireRole('admin');
    const r = stampsDb.createStampType(getDb(), { label, color, category, createdBy: getCurrentUser().id });
    if (!r.ok) throw Object.assign(new Error(r.error), { code: r.code });
    return r;
  });
  // Users + their current stamping grant (the Settings → Users grant list).
  ipcMain.handle('stamp-grants', () => {
    requireRole('admin'); const db = getDb();
    return (dbAuth.getAllUsers(db) || []).map(u => ({ id: u.id, username: u.username, displayName: u.display_name,
      role: u.role, active: !!u.is_active, canStamp: stampPerm.canStamp(db, u.id) }));
  });
  ipcMain.handle('stamp-grant', (_e, { userId, grant } = {}) => {
    requireRole('admin');
    const r = grant ? stampPerm.grantStamp(getDb(), actor(), Number(userId))
                    : stampPerm.revokeStamp(getDb(), actor(), Number(userId));
    if (!r.ok) throw Object.assign(new Error(r.error), { code: r.code });
    return r;
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
