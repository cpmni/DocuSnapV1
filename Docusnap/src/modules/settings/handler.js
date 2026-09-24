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
  const { broadcastReviewCount } = require('../../lib/countBroadcast');   // D2 / D-C11: viewer-scoped
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
  // SECURITY (Stage 2 — M1): refuse ENTITLEMENT / LICENSING / update keys over this generic admin
  // set-setting IPC (self-grant of the paid add-on / update-URL repoint). The predicate is shared with
  // backupService (Oracle C1) via src/lib/protectedSettings so the two write-doors can't drift.
  const { isProtectedSettingKey: _isProtectedSettingKey } = require('../../lib/protectedSettings');
  // Keys the PRE-LOGIN windows legitimately read before a session exists — only 'theme', applied
  // before first paint by shared/theme.js in the login/license/splash windows. Everything else needs
  // a signed-in session (Stage 2 — L1).
  const _PREAUTH_READABLE_SETTINGS = new Set(['theme']);
  // SECURITY (Stage 2 — M7): reject an UNSAFE output_folder at WRITE time. A bare drive root (C:\)
  // would widen _allowedOpenRoots (processing/handler.js) to the WHOLE drive, and a system directory
  // is never a legitimate filing destination (integrity). Normal local folders AND UNC network shares
  // are ALLOWED — network filing is a legitimate business workflow. (Silent repoint to a network share
  // under a compromised renderer is a residual best closed by config-integrity signing in Stage 7; a
  // direct DB edit — threat T2 — is closed by the Stage-6 DB encryption. Both are out of this layer.)
  const _outputFolderSafe = (v) => {
    const s = String(v == null ? '' : v).trim();
    if (!s) return false;
    // Reject the extended-length / device namespaces (`\\?\…`, `\\.\…`) — they survive path.resolve
    // UNCHANGED and would let `\\?\C:\Windows\System32` slip past the system-dir prefix check below
    // (Oracle C3). Legit UNC (`\\server\share`) is NOT this shape (3rd char is the host, not . or ?).
    if (/^[\\/][\\/][.?][\\/]/.test(s)) return false;
    let r; try { r = require('path').resolve(s); } catch { return false; }
    if (/^[\\/][\\/][.?][\\/]/.test(r)) return false;
    if (/(^|[\\/])[A-Za-z0-9]{1,6}~\d/.test(r)) return false;        // 8.3 short-name segment (PROGRA~1)
    if (/^[a-z]:[\\/]?$/i.test(r)) return false;                     // a bare drive root — too broad
    const lower = r.toLowerCase(), sep = require('path').sep;
    const win = (process.env.SystemRoot || 'C:\\Windows').toLowerCase();
    for (const f of [win, 'c:\\program files', 'c:\\program files (x86)']) {
      if (lower === f || lower.startsWith(f + sep)) return false;    // never file INTO a system dir
    }
    return true;
  };

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
    // The transactional create is the shared document_types.createTypeWithFields (also the /v1
    // teach-over-client create route) so both roads build a byte-identical type.
    const r = doctypes.createTypeWithFields(getDb(), data);
    if (r.success) notifyAllWindows('doc-types-changed');   // other open windows reload their doc-type lists
    return r;
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
  // Stage 5a: schema mutations are audited (field add/update/delete change what every future doc extracts).
  // FIELD BROADCAST (2026-09-24, Chris round card 2c, eric D1 -> Oracle C11): a field added / changed / deleted
  // through these doors (the Teach wizard's "Edit this type..." uses add-field via the shared doctype-editor) must
  // reach every OPEN window the same way a type create does - the Review window keeps its field list from the
  // last `doc-types-changed`, so without this a field taught mid-session was never drawn, the Confirm DOM scrape
  // omitted it and the sidecar lost it (the customer's Total). Broadcast on SUCCESS only: a throw propagates
  // before this line, and a no-op mutator result (structural field / empty change set -> undefined) stays silent.
  ipcMain.handle('add-field',    (_e, data)    => { requireRole('admin'); const r = doctypes.addField(getDb(), data); logAudit(getDb(), { action: 'field_added', action_category: 'settings', target_type: 'field', target_id: String((data && data.key) || ''), outcome: 'success', metadata: { document_type_id: data && data.document_type_id } }); if (r) notifyAllWindows('doc-types-changed'); return r; });
  ipcMain.handle('update-field', (_e, id, ch)  => { requireRole('admin'); const r = doctypes.updateField(getDb(), id, ch); logAudit(getDb(), { action: 'field_updated', action_category: 'settings', target_type: 'field', target_id: String(id), outcome: 'success' }); if (r) notifyAllWindows('doc-types-changed'); return r; });
  ipcMain.handle('delete-field', (_e, id)      => { requireRole('admin'); const r = doctypes.deleteField(getDb(), id); logAudit(getDb(), { action: 'field_deleted', action_category: 'settings', target_type: 'field', target_id: String(id), outcome: 'success' }); if (r) notifyAllWindows('doc-types-changed'); return r; });

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
    const r = learning.resetAllLearning(getDb());
    logAudit(getDb(), { action: 'reset_all_learning', action_category: 'settings', target_type: 'learning', outcome: 'success' });   // Stage 5a
    return r;
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
    logAudit(getDb(), { action: 'reset_fresh_install', action_category: 'settings', target_type: 'learning', outcome: 'success' });   // Stage 5a — records the destructive invocation (a backup is taken below)
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
    // M1: after a full wipe, VACUUM to reclaim + zero the freed pages (with secure_delete=ON
    // the content is already zeroed on delete; VACUUM shrinks the file and clears the freelist
    // so a "reset to fresh" DB doesn't still carry deleted content on disk). Best-effort.
    try { db.exec('VACUUM'); } catch (e) { try { ctx.logger?.warn?.(`[reset-fresh-install] VACUUM failed: ${e.message}`); } catch { /* noop */ } }
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

  // "These two look like the same company" — report-only duplicate detection over the known sender
  // scopes, using the SAME name_proximity comparison as the teach-time challenge and the write
  // guard. Preventive fixes leave a customer whose filing tree is ALREADY split with nothing
  // telling them (Oracle O7); this is that surface. It never merges or renames — it hands each pair
  // to the audited rename route below and lets a human choose which name survives.
  ipcMain.handle('find-duplicate-suppliers', () => {
    requireRole('admin');
    try { return learning.findDuplicateSupplierPairs(getDb()); }
    catch (e) { logger?.warn?.(`find-duplicate-suppliers: ${e.message}`); return []; }
  });

  // Rename a supplier IDENTITY across every learning-scope table (documents/hints/anchors/
  // logos/corrections + the stored identity value + a template's FROZEN identity) — the reusable
  // fix for a wrong/merged supplier name that the per-field learning-history tools can't reach
  // (they are scoped BY supplier). Admin-only + audited. Files already on disk are NOT moved: the
  // filed copies keep their old folder, and that is stated in the UI rather than done silently.
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
    if (res.ok) broadcastReviewCount(notifyAllWindows, db);   // D2 / D-C11: viewer-scoped
    if (res.ok) { try { ctx.notifyBinChanged && ctx.notifyBinChanged(); } catch {} }   // set-aside docs land in the bin
    return { ...res, backup };
  });
  // Undo: restore set-aside docs from the recycle bin.
  ipcMain.handle('recovery-restore-docs', (_e, ids) => {
    requireRole('admin');
    const db = getDb();
    const documents = require('../../../database/modules/documents');
    // C6 restore side: re-plant the retracted hints IFF learning_retracted_at proves the delete
    // retracted (a pre-feature / switch-off deletion never did — a blind re-plant would
    // double-count). The service clears the marker either way; same REPAIR_UNPLANT switch.
    const useSvc = process.env.REPAIR_UNPLANT !== '0';
    const repairService = useSvc ? require('../../services/repairService') : null;
    let restored = 0;
    for (const id of (Array.isArray(ids) ? ids : [])) {
      try {
        restored += (useSvc ? repairService.restoreFromRecycleBin(db, Number(id)).changes
                            : documents.restoreDeleted(db, id).changes) || 0;
      } catch {}
    }
    if (restored) { try { ctx.notifyBinChanged && ctx.notifyBinChanged(); } catch {} }   // once for the batch
    return { restored };
  });

  // ── Learning Repair v2 — the SELECTOR + CONSOLE + "start fresh" (barry + gary → Oracle
  //    SIGN-OFF-W/COND C1–C6, 2026-08-26). DARK: `learning_repair_console` (the UI) and
  //    `learning_repair_forget` (the destructive door, enforced in the service). Admin only. ──────
  const learningScopes = require('../../services/learningScopeService');
  const learningRepair = require('../../services/learningRepairService');
  const _snapshotDir = () => {
    try { return require('path').join(require('electron').app.getPath('userData'), 'repair-snapshots'); }
    catch { return require('path').join(require('os').tmpdir(), 'scanfinder-repair-snapshots'); }
  };
  // One row per sender × doc type that holds ANY learning (documents ∪ every learning table).
  ipcMain.handle('learning-scopes', (_e, opts) => {
    requireRole('admin');
    const db = getDb();
    try {
      const scopes = learningScopes.listScopes(db);
      // "Worth a look" badge: the SAME suspect detectors the console's document list uses, run ONCE
      // per document type (never per scope) and attributed to each scope through the doc's sender.
      // The read-only memory-inventory browse passes { suspects:false } to skip this per-type phash
      // cost (it has no "worth a look" filter); the argless Repair-console call is UNCHANGED.
      if (!opts || opts.suspects !== false) try {
        const repairSuspects = require('../../services/repairSuspects');
        const bySlug = new Map();
        for (const s of scopes) if (s.document_type_slug && !bySlug.has(s.document_type_slug)) bySlug.set(s.document_type_slug, null);
        for (const slug of bySlug.keys()) {
          let sus = null;
          try { sus = repairSuspects.computeSuspects(db, { document_type_slug: slug }); } catch { sus = null; }
          const ids = sus && sus.byId ? Object.keys(sus.byId).map(Number).filter(Number.isFinite) : [];
          if (!ids.length) continue;
          const ph = ids.map(() => '?').join(',');
          const rows = db.prepare(`SELECT id, LOWER(TRIM(COALESCE(supplier_name, ''))) AS sup FROM documents WHERE id IN (${ph})`).all(...ids);
          const counts = new Map();
          for (const r of rows) counts.set(r.sup, (counts.get(r.sup) || 0) + 1);
          for (const s of scopes) if (s.document_type_slug === slug) s.suspects = counts.get(String(s.supplier_name || '').trim().toLowerCase()) || 0;
        }
      } catch { /* badge only — never hide a scope */ }
      return { ok: true, scopes };
    } catch (e) { return { ok: false, error: e.message || String(e), scopes: [] }; }
  });
  // Read-only plan + the plain-English consequence sentence for one scope.
  ipcMain.handle('learning-repair-dry-run', (_e, scope) => {
    requireRole('admin');
    try { return learningRepair.dryRun(getDb(), scope || {}); }
    catch (e) { return { ok: false, error: e.message || String(e) }; }
  });
  // The forget itself: snapshot → retract once → scope deletes → owned templates → exclusion stamps.
  // Then the quiet lane re-reads the sender's now template-less held docs under the `repair` hold
  // (falls back honestly when the lane is off — the console says "use Reprocess").
  ipcMain.handle('learning-repair-forget', (_e, scope) => {
    const sess = requireRole('admin');
    const db = getDb();
    const s = scope || {};
    const res = learningRepair.forgetScope(db, { username: sess.username, displayName: sess.displayName }, s,
      { snapshotDir: _snapshotDir(), templatesDir: (() => { try { return ctx.templatesDir ? ctx.templatesDir() : null; } catch { return null; } })() });
    try {
      logAudit(db, { action: 'learning_repair_forget', action_category: 'processing', target_type: 'document_type',
        outcome: res.ok ? 'success' : 'failure',
        metadata: { supplier: s.supplier_name || null, type: s.document_type_slug || null, ...(res.summary || {}), snapshot: res.snapshotPath ? require('path').basename(res.snapshotPath) : null } });
    } catch {}
    let reread = false;
    if (res.ok) {
      try { reread = !!require('../processing/handler').scheduleQuietReread(db, { supplier: s.supplier_name, typeSlug: s.document_type_slug, reason: 'repair' }); } catch { reread = false; }
      broadcastReviewCount(notifyAllWindows, db);   // D2 / D-C11: viewer-scoped (best-effort inside)
    }
    return { ...res, reread };
  });
  ipcMain.handle('learning-repair-undo', (_e, { snapshotPath } = {}) => {
    requireRole('admin');
    const db = getDb();
    // Only a snapshot INSIDE the app's snapshot dir may be restored (never an arbitrary path).
    const dir = _snapshotDir();
    const p = String(snapshotPath || '');
    const inside = (() => { try { const path = require('path'); const r = path.resolve(p); return r.startsWith(path.resolve(dir) + path.sep); } catch { return false; } })();
    if (!inside) return { ok: false, error: 'Unknown snapshot.' };
    const res = learningRepair.undoForget(db, p);
    try { logAudit(db, { action: 'learning_repair_undo', action_category: 'processing', target_type: 'document_type',
      outcome: res.ok ? 'success' : 'failure', metadata: { ...(res.scope || {}), ...(res.summary || {}) } }); } catch {}
    return res;
  });
  ipcMain.handle('learning-repair-snapshots', () => {
    requireRole('admin');
    return { snapshots: learningRepair.listSnapshots(_snapshotDir()) };
  });

  // ── Learning Repair (browse + preview + suspects + send-to-review) ───────────
  const repairSuspects = require('../../services/repairSuspects');
  ipcMain.handle('repair-overview', (_e, scope) => {
    const _sess = requireRole('admin');   // D2: pass the actor to the scoped reader (admin → unfiltered; avoids the shared-only footgun)
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
    if (missing.length) { try { docs.push(...documents.getConfirmedDocsByIds(db, missing, _sess)); } catch {} }
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
  ipcMain.handle('repair-deconfirm', (_e, id, opts) => {
    requireRole('admin');
    const db = getDb();
    const documents = require('../../../database/modules/documents');
    const docId = Number(id);
    // Sending a doc back for correction clears any "looks right" dismissal, so once it's re-confirmed the
    // suspect detectors judge it afresh (mig 200). Best-effort; never blocks the send-back.
    try { db.prepare('UPDATE documents SET repair_dismissed_at = NULL WHERE id = ?').run(docId); } catch {}
    try {
      const guard = require('../../services/workflowService').editGuard(db, docId, 'admin');
      if (guard && guard.ok === false) return { ok: false, error: guard.error || 'This document is locked by an approval route.', code: guard.code };
    } catch { /* workflow off → no lock */ }
    // UN-PLANT (Oracle-signed 2026-07-23; kill REPAIR_UNPLANT=0 ⇒ the legacy status-flip only).
    // One door serves all three send-back surfaces (Repair panel + Search preview/bulk); the
    // service atomically de-confirms + retracts this doc's confirm-planted hints + deletes its
    // corrections rows (the re-confirm echo) + stamps the suspect-field notes. See repairService.
    // Quick File (Q-C2, Oracle 2026-09-15): refuse a typed (intake='direct') doc up front so BOTH the
    // un-plant path and the REPAIR_UNPLANT=0 raw-deconfirm fallback return the same recovery sentence
    // (deconfirmDocument's belt is the structural backstop for the fallback).
    {
      const _qf = require('../../lib/intakeGuard').guard(db, docId, 'send-back');
      if (_qf) return { ok: false, error: _qf.message };
    }
    if (process.env.REPAIR_UNPLANT !== '0') {
      let r;
      try { r = require('../../services/repairService').sendBackToReview(db, docId, opts || {}); }
      catch (e) { return { ok: false, error: 'Send-back failed (nothing was changed): ' + (e.message || e) }; }
      if (r.ok) {
        try {
          logAudit(db, { action: 'repair_send_to_review', action_category: 'document', target_type: 'document',
            target_id: docId, outcome: 'success', details: JSON.stringify(r.unplanted) });
        } catch {}
        broadcastReviewCount(notifyAllWindows, db);   // D2 / D-C11: viewer-scoped
      }
      return { ok: !!r.ok };
    }
    const r = documents.deconfirmDocument(db, docId);
    if (r.changes) {
      try { logAudit(db, { action: 'repair_send_to_review', action_category: 'document', target_type: 'document', target_id: docId, outcome: 'success' }); } catch {}
      broadcastReviewCount(notifyAllWindows, db);   // D2 / D-C11: viewer-scoped
    }
    return { ok: r.changes > 0 };
  });
  // Delete ONE confirmed doc to the recycle bin (recoverable; Undo via recovery-restore-docs).
  ipcMain.handle('repair-delete', (_e, id) => {
    const sess = requireRole('admin');
    const db = getDb();
    const documents = require('../../../database/modules/documents');
    const docId = Number(id);
    // C6 (owner-ruled 2026-07-23; same REPAIR_UNPLANT switch as send-back): deleting a CONFIRMED
    // doc retracts its confirm-planted hints + stamps learning_retracted_at (mig 53), so the
    // panel's heavier remedy un-poisons at least as much as its lighter one; recovery-restore
    // re-plants IFF the marker proves the retract ran (see repairService).
    const r = (process.env.REPAIR_UNPLANT !== '0')
      ? require('../../services/repairService').deleteToRecycleBin(db, docId)
      : documents.softDelete(db, docId);
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
      broadcastReviewCount(notifyAllWindows, db);   // D2 / D-C11: viewer-scoped
      try { ctx.notifyBinChanged && ctx.notifyBinChanged(); } catch {}   // repair-delete lands in the bin
    }
    return { ok: r.changes > 0 };
  });
  // "This looks right" — the admin checked a suspect doc and it's FINE (owner report: the missing third
  // action beside Send-back / Delete). Stamps documents.repair_dismissed_at so computeSuspects stops flagging
  // it. Advisory ONLY: changes no value, status, learning or auto-file. Fully reversible ('un-dismiss' via the
  // same IPC with clear:true). Send-back clears it (below) so a corrected + re-confirmed doc is re-evaluated.
  ipcMain.handle('repair-dismiss', (_e, id, opts) => {
    requireRole('admin');
    const db = getDb();
    const docId = Number(id);
    if (!Number.isFinite(docId)) return { ok: false, error: 'bad_request' };
    const clear = !!(opts && opts.clear);
    try {
      const r = db.prepare('UPDATE documents SET repair_dismissed_at = ? WHERE id = ? AND status = \'confirmed\'')
        .run(clear ? null : new Date().toISOString(), docId);
      if (r.changes) { try { logAudit(db, { action: clear ? 'repair_dismiss_clear' : 'repair_dismiss', action_category: 'document', target_type: 'document', target_id: docId, outcome: 'success' }); } catch {} }
      return { ok: r.changes > 0 };
    } catch (e) { return { ok: false, error: 'Could not update: ' + (e.message || e) }; }
  });

  // ── App settings (key-value) ─────────────────────────────────────────────────
  // get-setting stays open even pre-login: theme.js reads 'theme' from every
  // window — including the login screen, before currentSession exists — to
  // apply the dark/light theme before first paint. It's a low-sensitivity
  // read (theme name, folder paths already visible via Search results) with
  // no per-key write path outside the Admin-gated Settings window, where
  // set-setting below is the actual enforcement boundary for "access all
  // settings".
  ipcMain.handle('get-setting', (_e, key)      => {
    if (!_PREAUTH_READABLE_SETTINGS.has(key)) requireLogin();   // Stage 2 — L1
    return learning.getSetting(getDb(), key);
  });
  ipcMain.handle('set-setting', (_e, key, val) => {
    requireRole('admin');
    const db = getDb();
    if (_isProtectedSettingKey(key)) {   // Stage 2 — M1
      logAudit(db, { action: 'setting_write_refused', action_category: 'settings', target_type: 'setting',
        target_id: key, outcome: 'denied', metadata: { key } });
      throw Object.assign(new Error('This setting is managed by the system and cannot be changed here.'), { code: 'PROTECTED_SETTING' });
    }
    if (key === 'output_folder' && !_outputFolderSafe(val)) {   // Stage 2 — M7
      logAudit(db, { action: 'setting_write_refused', action_category: 'settings', target_type: 'setting',
        target_id: key, outcome: 'denied', metadata: { key, reason: 'unsafe_output_folder' } });
      throw Object.assign(new Error('That output folder is not allowed (system folders and drive roots are blocked).'), { code: 'UNSAFE_OUTPUT_FOLDER' });
    }
    learning.setSetting(db, key, val);
    // An SFDEV hand turning a DARK test switch ON stamps the arming marker (Oracle C3, 2026-09-08): the next
    // launch of a DIFFERENT build disarms every test switch (mig 137 is one-shot and already stamped, so a raw
    // write without the marker would re-open the "reference DB ON forever" seam). Same-build hands stand.
    try {
      const { TEST_SWITCH_KEYS } = require('../../../database/dark_switches');
      if (TEST_SWITCH_KEYS.includes(key) && String(val) === 'true') {
        const arming = require('../../../database/build_arming');
        arming.writeArmMarker(db, `manual@${arming.resolveIdentity().buildRev}`);
      }
    } catch {}
    // Mirror the output/documents folder into the registry the moment it changes so the
    // uninstaller's data-wipe guard always has the current path (see lib/outputPathRegistry).
    if (key === 'output_folder') { try { require('../../lib/outputPathRegistry').recordOutputPath(val); } catch {} }
    // The support log redacts customer data unless Diagnostic Logging is on (see logger.js). Apply
    // it the moment the admin flips the switch, so turning diagnostics on to reproduce a problem
    // does not also require a restart to see the detail.
    if (key === 'diagnostic_logging') {
      try { require('../logger').setDetailed(String(val) === 'true'); } catch {}
    }
    if (key === 'theme') notifyAllWindows('theme-changed', val);
    if (key === 'dashboard_hidden_cards') notifyAllWindows('dashboard-cards-changed');
    if (key === 'telemetry_enabled') { try { ctx.telemetry?.refreshConsent(); } catch {} }
    logAudit(db, { action: 'setting_changed', action_category: 'settings', target_type: 'setting',
      target_id: key, outcome: 'success',
      metadata: { key, value: _SAFE_SETTING_VALUE.has(key) ? String(val).slice(0, 120) : '[set]',
        // Oracle C4 (Q1 residual made detectable): flag a filing repoint to a NETWORK share so an
        // admin / the Stage-7 integrity check can SEE it, without recording the path itself.
        ...(key === 'output_folder' ? { network: /^[\\/]{2}/.test(String(val || '')) } : {}) } });
    return true;
  });

  // ── Departments (D4: Settings IPC + UI wiring) ───────────────────────────────
  // The read gate ships already (D2, departmentVisibility); this wires the ADMIN management surface only.
  // Every write channel is requireRole('admin') and forwards the returned session as the actor (the
  // service re-checks _isAdmin). AUDIT ADAPTER (Oracle D4 C2): departmentService calls
  // deps.logAudit(db, actionString, metaObj) (3-arg) but the app's logAudit is 2-arg with an entry
  // OBJECT — without this adapter the varying dept metas ({id,name,slug} / {user_id,departments} /
  // {document_id,from,to}) would land as near-empty rows. Nest the whole meta under `metadata`
  // (addAuditEntry JSON-stringifies it) and derive target_type/target_id.
  const departments = require('../../services/departmentService');
  const _deptAudit = (db, action, meta) => {
    const m = meta || {};
    logAudit(db, {
      action, action_category: 'settings', outcome: 'success',
      target_type: m.user_id != null ? 'user' : (m.document_id != null ? 'document' : 'department'),
      target_id: String(m.id != null ? m.id : (m.user_id != null ? m.user_id : (m.document_id != null ? m.document_id : ''))),
      metadata: m,
    });
  };
  ipcMain.handle('department-list', () => { requireRole('admin'); return departments.listDepartments(getDb(), { includeRetired: true }); });
  ipcMain.handle('department-users', () => {
    requireRole('admin');
    const db = getDb();
    const rows = db.prepare('SELECT id, all_departments FROM users').all();
    const byUser = {}, allFlags = {};
    for (const u of rows) { byUser[u.id] = departments.userDepartmentIds(db, u.id); allFlags[u.id] = !!u.all_departments; }
    return { byUser, allFlags };
  });
  ipcMain.handle('department-create',        (_e, name)              => { const s = requireRole('admin'); return departments.createDepartment(getDb(), s, name, { logAudit: _deptAudit }); });
  ipcMain.handle('department-rename',        (_e, { id, name })      => { const s = requireRole('admin'); return departments.renameDepartment(getDb(), s, id, name, { logAudit: _deptAudit }); });
  ipcMain.handle('department-retire',        (_e, id)                => { const s = requireRole('admin'); const r = departments.retireDepartment(getDb(), s, id, { logAudit: _deptAudit }); notifyAllWindows('departments-changed'); return r; });
  ipcMain.handle('department-delete',        (_e, id)                => { const s = requireRole('admin'); const r = departments.deleteDepartment(getDb(), s, id, { logAudit: _deptAudit }); if (r && r.ok) notifyAllWindows('departments-changed'); return r; });
  ipcMain.handle('department-set-membership',(_e, { userId, deptIds })=> { const s = requireRole('admin'); return departments.setMembership(getDb(), s, userId, deptIds, { logAudit: _deptAudit }); });
  ipcMain.handle('department-set-all',       (_e, { userId, on })    => { const s = requireRole('admin'); return departments.setAllDepartments(getDb(), s, userId, on, { logAudit: _deptAudit }); });
  // Dedicated master-switch writer (NOT generic set-setting): needs the Q9 side-effect (the enabling
  // admin gets all_departments) + the D-C8 tagged-doc count on disable. FLIP-GATED — refuses to turn ON
  // while the intake lanes are unguarded (Oracle D4 item 8 SEND BACK; departmentService.INTAKE_GUARDED).
  ipcMain.handle('department-set-enabled', (_e, on) => {
    const s = requireRole('admin');
    const db = getDb();
    const want = (on === true || String(on) === 'true');
    if (want && !departments.INTAKE_GUARDED) return { ok: false, error: 'intake_unguarded' };
    // FEATURE-MASTER waiver (Oracle C3, 2026-09-20): the departments-enable write below carries the
    // `// @FEATURE_MASTER_WRITE departments_enabled` sentinel on the line directly above it, which waives the
    // BUILD release-gate (check-release-migrations belt vi) for THIS one write only. It MUST remain inside this
    // requireRole('admin') (:664) + INTAKE_GUARDED (:667) gate — the release gate is build-time static and
    // cannot re-check runtime gating. A second or un-gated enable write is a release blocker (waiver capped at
    // one per file). The sentinel MUST stay within 3 lines of the write or the build refuses (fail-safe).
    if (want) {
      // @FEATURE_MASTER_WRITE departments_enabled
      learning.setSetting(db, 'departments_enabled', 'true');
      departments.setAllDepartments(db, s, s.id, true, { logAudit: _deptAudit });   // Q9: the enabler sees everything
      _deptAudit(db, 'departments_enabled_on', { id: null });
      notifyAllWindows('departments-changed');
      return { ok: true, enabled: true };
    }
    const tagged = departments.taggedDocCount(db);   // D7: docs carrying ≥1 department (the join)
    learning.setSetting(db, 'departments_enabled', 'false');   // OFF does NOT un-hide tagged docs (read gate is data-driven)
    _deptAudit(db, 'departments_enabled_off', { id: null, tagged });
    notifyAllWindows('departments-changed');
    return { ok: true, enabled: false, warn: tagged > 0 ? { tagged } : null };
  });
  ipcMain.handle('department-get-state', () => {
    requireRole('admin');
    const db = getDb();
    return { enabled: departments._enabled(db), intakeGuarded: departments.INTAKE_GUARDED,
             tagged: departments.taggedDocCount(db) };
  });
  // D7: a document type's DEFAULT department SET (the join replaces the single default_department_id).
  ipcMain.handle('department-set-type-default', (_e, { typeId, deptIds }) => {
    const s = requireRole('admin');
    const r = departments.setTypeDefaultDepartments(getDb(), s, typeId, deptIds || [], { logAudit: _deptAudit });
    if (r && r.ok) notifyAllWindows('departments-changed');
    return r;
  });
  ipcMain.handle('department-get-type-defaults', () => {
    requireRole('admin');
    const db = getDb();
    const map = {};
    try { for (const r of db.prepare('SELECT document_type_id, department_id FROM document_type_departments').all()) (map[r.document_type_id] = map[r.document_type_id] || []).push(r.department_id); } catch {}
    return map;
  });

  // Advanced reading switches unlock (owner decision 2026-08-11): the Processing tab grew ~50
  // kill-switch/experimental toggles a customer should never meet — they now hide behind ONE
  // SFDEV unlock (same password + checked-in-MAIN convention as the dev inspector). Option (b):
  // the unlock PERSISTS (`dev_switches_unlocked` setting) so the owner's install shows the
  // section permanently while customer installs never do. Hiding is passwordless (plain
  // set-setting) — only the reveal is gated. No flag VALUES change either way.
  ipcMain.handle('dev-switches-unlock', (_e, pw) => {
    requireRole('admin');
    if (String(pw || '') !== 'SFDEV') return { ok: false };
    const db = getDb();
    learning.setSetting(db, 'dev_switches_unlocked', 'true');
    logAudit(db, { action: 'dev_switches_unlocked', action_category: 'settings', target_type: 'setting',
      target_id: 'dev_switches_unlocked', outcome: 'success' });
    return { ok: true };
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
  // SECURITY (Chris card 7 — security review 2026-09-15): the embedded device_fp is UNTRUSTED.
  // An attacker who can read a backup (holds file + password) can also edit its device_fp, and
  // this machine's fp is a deterministic hash of locally-readable public data — so a same-machine
  // allow keyed on `backupFp === curFp` is forgeable on any un-licensed machine. When the DARK
  // switch `backup_import_seat_only` is ON, that untrusted branch is skipped and ONLY a verified
  // paid SEAT authorises a restore (the anchor a non-origin machine cannot mint). ENFORCED BY DEFAULT
  // since mig 169 (owner flip 2026-09-15 — seeds '1' on every install); set it '0' to restore the
  // historical (byte-identical) behaviour. The seat decision itself is the pure predicate
  // src/lib/deviceImportGate.js (which never receives device_fp, so same-machine equality can't be
  // reintroduced through it).
  function _backupImportSeatOnly() {
    try { return learning.getSetting(getDb(), 'backup_import_seat_only') === '1'; } catch { return false; }
  }
  function _deviceImportAllowed(meta) {
    const curFp = _currentDeviceFp();
    if (!curFp) return { allowed: true };             // no licensing config (dev) — don't block
    const seatOnly = _backupImportSeatOnly();
    const backupFp = meta && meta.device_fp;
    // Same-machine allow via the embedded fp — UNTRUSTED (card 7). Gated OFF by default (legacy
    // behaviour); when seatOnly is ON it is skipped and the seat check below is the only anchor.
    if (!seatOnly && backupFp && backupFp === curFp) return { allowed: true };
    // SECURITY (Sammy M-1): a MISSING/empty device_fp used to auto-allow ("pre-binding backup"),
    // but a crafted archive can simply OMIT the field to defeat the whole gate. Treat absent-fp the
    // same as a cross-machine import — require a signature-verified active PAID seat below. A real
    // legacy backup on a licensed machine still restores (it holds a seat); a fresh trial importing
    // another machine's OR a crafted no-fp archive is blocked (anti-trial-stacking intact).
    try {
      // SECURITY (Stage 4 — M5): the seat must be a SIGNATURE-VERIFIED active paid token, not merely a
      // license_tokens ROW whose convenience columns say kind='seat'/state='active'. Reading those raw
      // columns let a hand-inserted row defeat this anti-trial-stacking gate; route through the
      // JWS-verifying evaluator instead (evaluateCachedAccess → token.evaluate: alg/kid-pinned,
      // fp-bound, verify-before-claims). `decision==='allow'` requires a valid signature for THIS
      // machine's fingerprint; the claims' kind must be 'seat' (a verified TRIAL must not unlock import).
      const ev = require('../licensing/handler').evaluateCachedAccess(getDb());
      if (require('../../lib/deviceImportGate').deviceImportAllowed(ev).allowed) return { allowed: true };
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
