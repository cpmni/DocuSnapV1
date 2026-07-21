'use strict';

/**
 * modules/settings/handler.js
 * Document types, fields, app settings (output folder etc).
 */

function register(ctx) {
  const { ipcMain, getDb, notifyAllWindows } = ctx;
  const doctypes  = require('../../../database/modules/document_types');
  const learning  = require('../../../database/modules/learning');
  const templates = require('../../../database/modules/templates');
  const { safeSlug } = require('../../../database/modules/slug');
  const { requireRole, requireLogin, logAudit } = require('../auth/handler');
  // Setting keys whose VALUE is safe to record verbatim in the audit trail
  // (mode/threads/flags). Anything else (paths, patterns, unknown keys) logs the
  // key NAME + a "[set]" marker only — never the raw value (GDPR-aware).
  const _SAFE_SETTING_VALUE = new Set([
    'processing_mode', 'processing_concurrency', 'registration_enabled', 'born_digital_enabled',
    'diagnostic_logging', 'theme', 'first_run_completed', 'watch_folder_enabled',
    'confidence_threshold', 'license_enforcement_enabled', 'copy_after_processing_enabled',
    'name_wordness_flag', 'auto_separate_enabled', 'multiline_enabled',
    'auto_rotate_enabled', 'dashboard_hidden_cards', 'telemetry_enabled',
  ]);

  // ── Document types ──────────────────────────────────────────────────────────
  // get-all-doc-types is shared with Review (Admin/Edit) and Search (every
  // role, including Read Only — it populates the type filter); gate to "any
  // signed-in user". The "…All" variant (incl. disabled types, used to build
  // the Document Types tab) and every mutation below live only in the
  // Admin-exclusive Settings window — "access all settings".
  ipcMain.handle('get-document-types',        () => { requireLogin(); return doctypes.getAll(getDb()); });
  ipcMain.handle('get-all-doc-types',         () => { requireLogin(); return doctypes.getAllWithFields(getDb()); });
  ipcMain.handle('get-all-doc-types-all',     () => { requireRole('admin'); return doctypes.getAllWithFieldsAll(getDb()); });
  ipcMain.handle('add-document-type',    (_e, data)    => {
    requireRole('admin');
    const db = getDb();
    data = data || {};
    // Title-alias validation up front so a name-collision returns a clean error (not an
    // unhandled throw) and soft-drop notices reach the UI; addType re-validates + persists.
    let notices = [];
    if (data.title_aliases != null) {
      const na = doctypes.normaliseTitleAliases(db, data.title_aliases, data.name);
      if (na.error) return { error: na.error };
      notices = na.notices;
    }
    // Atomic: create the type AND force its structural ID fields (Company + Date) so an
    // empty custom type can never exist. A mid-way throw rolls back the whole thing.
    let out;
    try {
      out = db.transaction(() => {
        const res = doctypes.addType(db, data);
        doctypes.ensureStructuralRoles(db, res.lastInsertRowid);
        return res;
      })();
    } catch (e) { return { error: e.message }; }
    notifyAllWindows('doc-types-changed');
    return { lastInsertRowid: out.lastInsertRowid, changes: out.changes, notices };
  });
  ipcMain.handle('update-document-type', (_e, id, ch)  => {
    requireRole('admin');
    const db = getDb();
    ch = ch || {};
    let notices = [];
    if ('title_aliases' in ch) {
      const row = db.prepare('SELECT name FROM document_types WHERE id = ?').get(id) || {};
      const na = doctypes.normaliseTitleAliases(db, ch.title_aliases, ('name' in ch && ch.name) ? ch.name : row.name);
      if (na.error) return { error: na.error };
      notices = na.notices;
    }
    try { doctypes.updateType(db, id, ch); } catch (e) { return { error: e.message }; }
    if ('title_aliases' in ch) notifyAllWindows('doc-types-changed');   // detection args rebuild per run
    return { ok: true, notices };
  });

  // Create a doc type + its fields + key-field assignments in ONE transaction.
  // The teaching wizard drives non-technical users through this; doing it as
  // chained renderer calls risks a partial type (created, fields half-added,
  // ref/date unset) — the field-less-template footgun the promote path guards
  // against. Returns the created type id (or {error}). Admin-gated like the
  // single-step handlers. Field keys are slugified the SAME way addField does,
  // and ref/date keys are matched to those slugs so the assignment is valid.
  ipcMain.handle('create-doc-type-with-fields', (_e, data) => {
    requireRole('admin');
    const db = getDb();
    const name = ((data && data.name) || '').trim();
    if (!name) return { success: false, error: 'A document type name is required.' };
    const fields = Array.isArray(data && data.fields) ? data.fields : [];
    if (!fields.length) return { success: false, error: 'Add at least one field.' };
    // Match addField's key derivation EXACTLY so ref/date roles bind to the keys
    // the fields are actually created with (shared canonical safeSlug).
    const slug = (s) => safeSlug(s, { fallback: 'field' });
    const refKey  = data.ref_field_key  ? slug(data.ref_field_key)  : null;
    const dateKey = data.date_field_key ? slug(data.date_field_key) : null;
    // Validate aliases up front so a name-collision returns a clean {error} (addType would
    // throw inside the transaction → caught below either way) and notices reach the UI.
    let aliasNotices = [];
    if (data.title_aliases != null) {
      const na = doctypes.normaliseTitleAliases(db, data.title_aliases, name);
      if (na.error) return { success: false, error: na.error };
      aliasNotices = na.notices;
    }
    try {
      const tx = db.transaction(() => {
        const res = doctypes.addType(db, { name, ref_field_key: refKey, date_field_key: dateKey, title_aliases: data.title_aliases });
        const typeId = res.lastInsertRowid;
        let order = 10;
        for (const f of fields) {
          if (!f || !(f.key || f.label)) continue;
          doctypes.addField(db, {
            document_type_id: typeId,
            key:        f.key || f.label,
            label:      f.label || f.key,
            type:       f.type || 'text',
            required:   f.required ? 1 : 0,
            sort_order: order,
          });
          order += 10;
        }
        // Force the structural ID fields (Company + Date) AFTER the user fields, so a
        // wizard-designated date is respected and nothing is left missing.
        doctypes.ensureStructuralRoles(db, typeId);
        return typeId;
      });
      const id = tx();
      const created = doctypes.getAllWithFieldsAll(db).find(t => t.id === id) || null;
      notifyAllWindows('doc-types-changed');   // other open windows reload their doc-type lists
      return { success: true, id, type: created, notices: aliasNotices };
    } catch (e) {
      return { success: false, error: e.message };  // UNIQUE name clash etc. — atomic rollback
    }
  });

  // Preset document-type catalog (Settings → Document Types → "Add from catalog…").
  // get-doctype-catalog lists the ready-made presets + whether each is already in
  // this install; add-doctype-presets atomically creates each ticked type (+ fields
  // + structural roles) AND seeds its likely label aliases into field_label_overrides
  // (per-install, doc-type-scoped — see document_types.addPresetTypes). Admin-gated.
  ipcMain.handle('get-doctype-catalog', () => { requireRole('admin'); return doctypes.getPresetCatalog(getDb()); });
  ipcMain.handle('add-doctype-presets', (_e, slugs) => {
    requireRole('admin');
    const list = Array.isArray(slugs) ? slugs : (slugs ? [slugs] : []);
    if (!list.length) return { success: false, error: 'Select at least one document type to add.' };
    try {
      const results = doctypes.addPresetTypes(getDb(), list);
      notifyAllWindows('doc-types-changed');
      return { success: true, results };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ── Fields ──────────────────────────────────────────────────────────────────
  ipcMain.handle('add-field',    (_e, data)    => { requireRole('admin'); return doctypes.addField(getDb(), data); });
  ipcMain.handle('update-field', (_e, id, ch)  => { requireRole('admin'); return doctypes.updateField(getDb(), id, ch); });
  ipcMain.handle('delete-field', (_e, id)      => { requireRole('admin'); return doctypes.deleteField(getDb(), id); });

  // ── Learning Recovery ────────────────────────────────────────────────────────
  // Small inspection/cleanup surface for the automatic-learning corpora
  // (field anchors, supplier hints, corrections, logo fingerprints), scoped to
  // a supplier name and optional document type. Managed templates are queried
  // separately (by name) and shown alongside for context, but the clear*
  // actions below never touch the templates table.
  ipcMain.handle('get-learning-recovery', (_e, params) => {
    requireRole('admin');
    const db = getDb();
    const { supplier_name, document_type } = params || {};
    if (!supplier_name || !supplier_name.trim()) return null;
    const scope = { supplier_name: supplier_name.trim(), document_type: document_type || null };
    return {
      summary:   learning.getRecoverySummary(db, scope),
      detail:    learning.getRecoveryDetail(db, scope),
      templates: templates.searchByName(db, scope.supplier_name, scope.document_type),
    };
  });

  // Read-only grouped inventory of all learned memory (no scope, no mutation) —
  // powers the Learning Recovery memory table.
  ipcMain.handle('get-memory-inventory', () => {
    requireRole('admin');
    return learning.getMemoryInventory(getDb());
  });

  // Developer reset — wipe ALL learning state in one transaction (corpora +
  // learned templates). Admin-gated; the strong typed confirmation lives in the
  // renderer. Returns per-table deleted counts.
  ipcMain.handle('reset-all-learning', () => {
    requireRole('admin');
    return learning.resetAllLearning(getDb());
  });

  // Developer "fresh install (keep document corpus)" reset — superset of the
  // above that also erases the custom schema and strips learned identity back
  // off the kept documents (see learning.resetToFreshInstall). Admin-gated; the
  // typed confirmation lives in the caller (Dev Inspector / Settings). Takes a
  // one-shot timestamped backup of the SQLite file first (irreversible op), then
  // returns { backup, counts }. backup is null if the copy failed — the reset
  // still proceeds (best-effort safety net, not a hard dependency).
  ipcMain.handle('reset-fresh-install', () => {
    requireRole('admin');
    const fs = ctx.fs || require('fs');
    const db = getDb();
    let backup = null;
    try {
      if (db.name && fs.existsSync(db.name)) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        backup = `${db.name}.bak-${stamp}`;
        fs.copyFileSync(db.name, backup);
      }
    } catch (e) {
      backup = null;
      try { ctx.logger?.warn?.(`[reset-fresh-install] DB backup failed: ${e.message}`); } catch {}
    }
    const counts = learning.resetToFreshInstall(db);
    return { backup, counts };
  });

  // ── Advanced: keyword label overrides (admin) ────────────────────────────────
  // Per-installation extra label words for a (doc-type, field), merged onto the
  // shipped keyword patterns at processing time so the field is caught at Stage 1.
  // Customer-specific: lives in the userData DB, never packaged.
  const labelOverrides = require('../../../database/modules/label_overrides');
  ipcMain.handle('get-label-overrides', () => {
    requireRole('admin');
    return labelOverrides.listLabelOverrides(getDb());
  });
  ipcMain.handle('add-label-override', (_e, data) => {
    requireRole('admin');
    return labelOverrides.addLabelOverride(getDb(), data || {});
  });
  // Bulk add (comma/newline-separated labels in one transaction; reports
  // inserted / alreadyExisted / rejected / collision warnings).
  ipcMain.handle('add-label-overrides', (_e, data) => {
    requireRole('admin');
    return labelOverrides.addLabelOverrides(getDb(), data || {});
  });
  ipcMain.handle('delete-label-override', (_e, id) => {
    requireRole('admin');
    return labelOverrides.deleteLabelOverride(getDb(), id);
  });

  ipcMain.handle('clear-learning-anchors', (_e, params) => {
    requireRole('admin');
    const { supplier_name, document_type } = params || {};
    if (!supplier_name || !supplier_name.trim()) return { changes: 0 };
    const result = learning.clearFieldAnchorsForScope(getDb(), {
      supplier_name: supplier_name.trim(), document_type: document_type || null,
    });
    return { changes: result.changes };
  });

  ipcMain.handle('clear-learning-hints', (_e, params) => {
    requireRole('admin');
    const { supplier_name, document_type } = params || {};
    if (!supplier_name || !supplier_name.trim()) return { changes: 0 };
    const result = learning.clearSupplierHintsForScope(getDb(), {
      supplier_name: supplier_name.trim(), document_type: document_type || null,
    });
    return { changes: result.changes };
  });

  // Blast-radius preview for renaming a supplier IDENTITY: per-table row counts under a name.
  ipcMain.handle('get-supplier-scope-counts', (_e, name) => {
    requireRole('admin');
    return learning.getSupplierScopeCounts(getDb(), (name || '').trim());
  });

  // Rename a supplier IDENTITY across every learning-scope table (documents/hints/anchors/
  // logos/corrections + the stored identity value) — the reusable fix for a wrong/merged
  // supplier name that the per-field learning-history tools can't reach (they are scoped BY
  // supplier). Admin-only + audited. Files are not moved (see learning.renameSupplier).
  ipcMain.handle('rename-supplier', (_e, payload) => {
    requireRole('admin');
    const { oldName, newName } = payload || {};
    const from = (oldName || '').trim(), to = (newName || '').trim();
    if (!from || !to || from === to) return { renamed: 0 };
    const db = getDb();
    const result = learning.renameSupplier(db, { oldName: from, newName: to });
    logAudit(db, { action: 'rename_supplier', target_type: 'supplier', outcome: 'success',
      metadata: { from, to, before: result.before, after: result.after } });
    return result;
  });

  // Extreme-use recovery — see clearCorrectionsForScope in learning.js for
  // why this is kept separate from the anchors/hints clears above.
  ipcMain.handle('clear-learning-corrections', (_e, params) => {
    requireRole('admin');
    const { supplier_name, document_type } = params || {};
    if (!supplier_name || !supplier_name.trim()) return { changes: 0 };
    const result = learning.clearCorrectionsForScope(getDb(), {
      supplier_name: supplier_name.trim(), document_type: document_type || null,
    });
    return { changes: result.changes };
  });

  ipcMain.handle('clear-learning-field-rules', (_e, params) => {
    requireRole('admin');
    const { supplier_name, document_type } = params || {};
    if (!supplier_name || !supplier_name.trim()) return { changes: 0 };
    const result = learning.clearFieldRulesForScope(getDb(), {
      supplier_name: supplier_name.trim(), document_type: document_type || null,
    });
    return { changes: result.changes };
  });

  // ── "Fix a document type" recovery ───────────────────────────────────────────
  // A single, safe recovery for a (document type, optional supplier) scope: set aside the
  // offending confirmed docs (recycle bin — reversible) + optionally forget the scope's
  // learning. Composes the scope clears + softDelete via recoveryService; never touches
  // logo_fingerprints/templates. See src/services/recoveryService.js.
  const recoverySvc = require('../../services/recoveryService').createRecoveryService({ learning });
  ipcMain.handle('recovery-overview', (_e, scope) => {
    requireRole('admin');
    return recoverySvc.overview(getDb(), scope || {});
  });
  ipcMain.handle('recovery-apply', (_e, payload) => {
    const sess = requireRole('admin');
    const db = getDb();
    const p = payload || {};
    // .bak safety net for the NON-reversible learning clears (set-aside alone is reversible
    // via the recycle bin). Best-effort — recovery still proceeds if the copy fails.
    let backup = null;
    if (p.forgetLearning || p.requeue) {
      try {
        const fs = ctx.fs || require('fs');
        if (db.name && fs.existsSync(db.name)) {
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          backup = `${db.name}.bak-recovery-${stamp}`;
          fs.copyFileSync(db.name, backup);
        }
      } catch (e) { backup = null; try { ctx.logger?.warn?.(`[recovery] DB backup failed: ${e.message}`); } catch {} }
    }
    const res = recoverySvc.apply(db, { username: sess.username, displayName: sess.displayName }, p);
    try {
      logAudit(db, { action: 'recovery_apply', action_category: 'processing', target_type: 'document_type',
        outcome: res.ok ? 'success' : 'failure',
        metadata: { type: p.document_type_slug || null, supplier: p.supplier_name || null, ...(res.summary || {}) } });
    } catch {}
    // Route-close audit + ONE badge-ping AFTER the transaction committed (Oracle C2 — never
    // announce a close a rollback could undo; 'auto_closed' is toast-free by design).
    if (res.ok && Array.isArray(res.closedRoutes) && res.closedRoutes.length) {
      try { logAudit(db, { action: 'workflow_route_closed_on_delete', action_category: 'workflow', target_type: 'document_type',
        outcome: 'success', metadata: { routes: res.closedRoutes.map(r => r.id), via: 'recovery' } }); } catch {}
      try { ctx.notifyWorkflowEvent && ctx.notifyWorkflowEvent({ event: 'auto_closed' }); } catch {}
    }
    if (res.ok) notifyAllWindows('review-count-changed', require('../../../database/modules/documents').getReviewCount(db));
    return { ...res, backup };
  });
  // Undo: restore set-aside docs from the recycle bin.
  ipcMain.handle('recovery-restore-docs', (_e, ids) => {
    requireRole('admin');
    const db = getDb();
    const documents = require('../../../database/modules/documents');
    let restored = 0;
    for (const id of (Array.isArray(ids) ? ids : [])) { try { restored += documents.restoreDeleted(db, id).changes || 0; } catch {} }
    return { restored };
  });

  // ── Learning Repair (browse + preview + suspects + send-to-review) ───────────
  const repairSuspects = require('../../services/repairSuspects');
  ipcMain.handle('repair-overview', (_e, scope) => {
    requireRole('admin');
    const db = getDb();
    const documents = require('../../../database/modules/documents');
    const s = scope || {};
    if (!s.document_type_slug) return { error: 'A document type is required.' };
    const sc = { supplier_name: s.supplier_name || null, document_type_slug: s.document_type_slug };
    const docs = documents.getConfirmedDocsForScope(db, sc);
    const confirmedCount = docs.length;   // "Learned from N" = the browsed (supplier-filtered) pool
    let suspects = { byId: {}, count: 0 };
    try { suspects = repairSuspects.computeSuspects(db, { document_type_slug: s.document_type_slug, supplier_name: s.supplier_name || null }); }
    catch (e) { try { ctx.logger?.warn?.(`[repair] suspects failed: ${e.message}`); } catch {} }
    // "Might not belong" outliers are detected across the WHOLE type, so a flagged doc may be a
    // DIFFERENT supplier than the browse filter — union those in so they still render (strip +
    // list + preview), otherwise a supplier search would hide the very outliers it should surface.
    const have = new Set(docs.map(d => d.id));
    const missing = Object.keys(suspects.byId).map(Number).filter(id => !have.has(id));
    if (missing.length) { try { docs.push(...documents.getConfirmedDocsByIds(db, missing)); } catch {} }
    return { scope: sc, confirmedCount, documents: docs, suspects };
  });
  // Each field's CONFIRMED value (correction wins over the raw OCR read) for the Learning
  // Repair fields panel — so it agrees with the suspect reason, not a superseded misread.
  ipcMain.handle('repair-doc-fields', (_e, id) => {
    requireRole('admin');
    const db = getDb();
    const documents = require('../../../database/modules/documents');
    try { return { fields: documents.getConfirmedFieldValues(db, Number(id)) }; }
    catch (e) { return { fields: [], error: e.message || String(e) }; }
  });
  // Send ONE confirmed doc back to the review queue (respects the workflow lock).
  ipcMain.handle('repair-deconfirm', (_e, id) => {
    requireRole('admin');
    const db = getDb();
    const documents = require('../../../database/modules/documents');
    const docId = Number(id);
    try {
      const guard = require('../../services/workflowService').editGuard(db, docId, 'admin');
      if (guard && guard.ok === false) return { ok: false, error: guard.error || 'This document is locked by an approval route.', code: guard.code };
    } catch { /* workflow off → no lock */ }
    const r = documents.deconfirmDocument(db, docId);
    if (r.changes) {
      try { logAudit(db, { action: 'repair_send_to_review', action_category: 'document', target_type: 'document', target_id: docId, outcome: 'success' }); } catch {}
      notifyAllWindows('review-count-changed', documents.getReviewCount(db));
    }
    return { ok: r.changes > 0 };
  });
  // Delete ONE confirmed doc to the recycle bin (recoverable; Undo via recovery-restore-docs).
  ipcMain.handle('repair-delete', (_e, id) => {
    const sess = requireRole('admin');
    const db = getDb();
    const documents = require('../../../database/modules/documents');
    const docId = Number(id);
    const r = documents.softDelete(db, docId);
    if (r.changes) {
      // Previously-unguarded soft-delete door: close any open routes with the honest
      // "Document deleted by <name>" tombstone (FYI slice, Oracle C1/C2 — was a
      // stranded-open-route hole). Badge-ping only ('auto_closed' is deliberately
      // unknown to workflowNotify ⇒ no toast).
      try {
        const closed = require('../../services/workflowService')
          .closeOpenRoutesForDeletedDoc(db, { documentId: docId, deletedByName: (sess && (sess.displayName || sess.username)) || 'an administrator' }).closed;
        if (closed.length) {
          try { logAudit(db, { action: 'workflow_route_closed_on_delete', action_category: 'workflow', target_type: 'document', target_id: docId, document_id: docId, outcome: 'success', metadata: { routes: closed.map(x => x.id) } }); } catch {}
          try { ctx.notifyWorkflowEvent && ctx.notifyWorkflowEvent({ event: 'auto_closed' }); } catch {}
        }
      } catch { /* best-effort — never blocks the delete */ }
      try { logAudit(db, { action: 'repair_delete', action_category: 'document', target_type: 'document', target_id: docId, outcome: 'success' }); } catch {}
      notifyAllWindows('review-count-changed', documents.getReviewCount(db));
    }
    return { ok: r.changes > 0 };
  });

  // ── App settings (key-value) ─────────────────────────────────────────────────
  // get-setting stays open even pre-login: theme.js reads 'theme' from every
  // window — including the login screen, before currentSession exists — to
  // apply the dark/light theme before first paint. It's a low-sensitivity
  // read (theme name, folder paths already visible via Search results) with
  // no per-key write path outside the Admin-gated Settings window, where
  // set-setting below is the actual enforcement boundary for "access all
  // settings".
  ipcMain.handle('get-setting', (_e, key)      => learning.getSetting(getDb(), key));
  ipcMain.handle('set-setting', (_e, key, val) => {
    requireRole('admin');
    const db = getDb();
    learning.setSetting(db, key, val);
    // Mirror the output/documents folder into the registry the moment it changes so the
    // uninstaller's data-wipe guard always has the current path (see lib/outputPathRegistry).
    if (key === 'output_folder') { try { require('../../lib/outputPathRegistry').recordOutputPath(val); } catch {} }
    if (key === 'theme') notifyAllWindows('theme-changed', val);
    if (key === 'dashboard_hidden_cards') notifyAllWindows('dashboard-cards-changed');
    if (key === 'telemetry_enabled') { try { ctx.telemetry?.refreshConsent(); } catch {} }
    logAudit(db, { action: 'setting_changed', action_category: 'settings', target_type: 'setting',
      target_id: key, outcome: 'success',
      metadata: { key, value: _SAFE_SETTING_VALUE.has(key) ? String(val).slice(0, 120) : '[set]' } });
    return true;
  });

  // Opt-in diagnostics — read-only info for the Settings "see exactly what's sent"
  // view: the master on/off, the full event allowlist (what CAN be sent), and the
  // events currently buffered on THIS machine (verbatim). Admin only.
  ipcMain.handle('get-telemetry-info', () => {
    requireRole('admin');
    const t = ctx.telemetry;
    if (!t) return { enabled: false, events: {}, queued: [] };
    return { enabled: !!t.enabled(), events: t.EVENTS, queued: t.queued() };
  });

  // ── Encrypted settings backup / restore (admin) ─────────────────────────────
  // Config + learning ONLY (no auth/sessions/audit/licensing/documents); crypto +
  // table whitelist live in services/backupService.js. Export writes one encrypted
  // file; restore is a two-step preview(decrypt+counts) -> apply(replace) so the
  // renderer can confirm before overwriting.
  const { dialog, BrowserWindow, app } = require('electron');
  const fs = require('fs');
  const backupService = require('../../services/backupService');

  // The licensing device fingerprint of THIS machine (SHA-256, never the raw id).
  // Best-effort: returns null on a dev box with no license config — which then never
  // blocks an import.
  function _currentDeviceFp() {
    try {
      const cfg = JSON.parse(fs.readFileSync(ctx.resourcePath('config', 'license.json'), 'utf8'));
      return require('../../lib/license/fingerprint').computeFpHash(cfg.product_id);
    } catch { return null; }
  }
  // Device-import gate: a backup is bound to the machine that made it. Another machine
  // may restore it ONLY if it holds an ACTIVE PAID seat — so a paying customer can
  // migrate to a new PC, but a fresh trial can't import another machine's learned data
  // to dodge the trial. Legacy backups (no device_fp) and dev boxes are not blocked.
  function _deviceImportAllowed(meta) {
    const backupFp = meta && meta.device_fp;
    if (!backupFp) return { allowed: true };          // pre-binding backup — can't enforce
    const curFp = _currentDeviceFp();
    if (!curFp) return { allowed: true };             // no licensing config (dev) — don't block
    if (backupFp === curFp) return { allowed: true }; // same machine
    try {
      const tok = require('../../../database/modules/licensing').getActiveToken(getDb(), curFp);
      if (tok && tok.kind === 'seat' && tok.state !== 'revoked') return { allowed: true };  // paid migration
    } catch { /* fall through to deny */ }
    return { allowed: false, error: 'This backup was made on a different computer. Restoring it here needs an activated licence on this computer — a free trial can only restore a backup created on the same machine.' };
  }

  ipcMain.handle('settings-backup-export', async (_e, { password } = {}) => {
    requireRole('admin');
    if (!password || !String(password).trim()) return { ok: false, error: 'A password is required.' };
    try {
      const def = `scanfinder-backup-${new Date().toISOString().slice(0, 10)}.sfbak`;
      const r = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow(), {
        title: 'Save Settings Backup', defaultPath: def,
        filters: [{ name: 'Scan Finder backup', extensions: ['sfbak'] }],
      });
      if (r.canceled || !r.filePath) return { ok: false, canceled: true };
      const buf = backupService.createBackup(getDb(), password, { appVersion: app.getVersion(), deviceFp: _currentDeviceFp() || '' });
      fs.writeFileSync(r.filePath, buf);
      try { learning.setSetting(getDb(), 'last_backup_at', new Date().toISOString()); } catch { /* dashboard hint only */ }
      logAudit(getDb(), { action: 'settings_backup_export', action_category: 'settings',
        target_type: 'backup', outcome: 'success', metadata: { bytes: buf.length } });
      return { ok: true, path: r.filePath };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('settings-backup-preview', async (_e, { password } = {}) => {
    requireRole('admin');
    if (!password || !String(password).trim()) return { ok: false, error: 'A password is required.' };
    try {
      const r = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), {
        title: 'Choose Settings Backup', properties: ['openFile'],
        filters: [{ name: 'Scan Finder backup', extensions: ['sfbak'] }],
      });
      if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false, canceled: true };
      const { meta, summary } = backupService.readBackup(fs.readFileSync(r.filePaths[0]), password);
      const gate = _deviceImportAllowed(meta);
      if (!gate.allowed) return { ok: false, error: gate.error };
      return { ok: true, path: r.filePaths[0], meta, summary };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('settings-backup-apply', async (_e, { path: filePath, password } = {}) => {
    requireRole('admin');
    if (!filePath) return { ok: false, error: 'No backup file selected.' };
    if (!password || !String(password).trim()) return { ok: false, error: 'A password is required.' };
    try {
      const { meta, payload } = backupService.readBackup(fs.readFileSync(filePath), password);   // re-validate before write
      const gate = _deviceImportAllowed(meta);   // device-bound: block cross-machine trial imports
      if (!gate.allowed) {
        logAudit(getDb(), { action: 'settings_backup_restore', action_category: 'settings',
          target_type: 'backup', outcome: 'failure', metadata: { reason: 'device_mismatch' } });
        return { ok: false, error: gate.error };
      }
      // M5: snapshot the DB before this destructive restore so a mistaken import (e.g. a
      // fresh-install backup that would replace learned tables) is recoverable. Best-effort
      // (matches the reset/recovery snapshot pattern); a snapshot failure must not block a
      // legitimate restore — the empty-table guards in applyBackup are the primary defence.
      let snapshot = null;
      try {
        const db0 = getDb();
        try { db0.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* WAL flush best-effort */ }
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        snapshot = `${db0.name}.pre-restore-${stamp}`;
        fs.copyFileSync(db0.name, snapshot);
      } catch (e) { snapshot = null; try { ctx.logger?.warn?.(`[backup-restore] pre-restore snapshot failed: ${e.message}`); } catch { /* noop */ } }
      const { applied } = backupService.applyBackup(getDb(), payload);
      logAudit(getDb(), { action: 'settings_backup_restore', action_category: 'settings',
        target_type: 'backup', outcome: 'success', metadata: { tables: Object.keys(applied).length, snapshot: snapshot ? snapshot.split(/[\\/]/).pop() : null } });
      return { ok: true, applied, restart: true, snapshot };
    } catch (e) { return { ok: false, error: e.message }; }
  });
}

module.exports = { register };
