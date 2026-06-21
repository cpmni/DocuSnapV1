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
  const { requireRole, requireLogin, logAudit } = require('../auth/handler');
  // Setting keys whose VALUE is safe to record verbatim in the audit trail
  // (mode/threads/flags). Anything else (paths, patterns, unknown keys) logs the
  // key NAME + a "[set]" marker only — never the raw value (GDPR-aware).
  const _SAFE_SETTING_VALUE = new Set([
    'processing_mode', 'processing_concurrency', 'registration_enabled', 'born_digital_enabled',
    'diagnostic_logging', 'theme', 'first_run_completed', 'watch_folder_enabled',
    'confidence_threshold', 'license_enforcement_enabled', 'copy_after_processing_enabled',
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
    // Atomic: create the type AND force its structural ID fields (Company + Date) so an
    // empty custom type can never exist. A mid-way throw rolls back the whole thing.
    return db.transaction(() => {
      const res = doctypes.addType(db, data || {});
      doctypes.ensureStructuralRoles(db, res.lastInsertRowid);
      return res;
    })();
  });
  ipcMain.handle('update-document-type', (_e, id, ch)  => { requireRole('admin'); return doctypes.updateType(getDb(), id, ch); });

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
    const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const refKey  = data.ref_field_key  ? slug(data.ref_field_key)  : null;
    const dateKey = data.date_field_key ? slug(data.date_field_key) : null;
    try {
      const tx = db.transaction(() => {
        const res = doctypes.addType(db, { name, ref_field_key: refKey, date_field_key: dateKey });
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
      return { success: true, id, type: created };
    } catch (e) {
      return { success: false, error: e.message };  // UNIQUE name clash etc. — atomic rollback
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
    if (key === 'theme') notifyAllWindows('theme-changed', val);
    logAudit(db, { action: 'setting_changed', action_category: 'settings', target_type: 'setting',
      target_id: key, outcome: 'success',
      metadata: { key, value: _SAFE_SETTING_VALUE.has(key) ? String(val).slice(0, 120) : '[set]' } });
    return true;
  });

  // ── Encrypted settings backup / restore (admin) ─────────────────────────────
  // Config + learning ONLY (no auth/sessions/audit/licensing/documents); crypto +
  // table whitelist live in services/backupService.js. Export writes one encrypted
  // file; restore is a two-step preview(decrypt+counts) -> apply(replace) so the
  // renderer can confirm before overwriting.
  const { dialog, BrowserWindow, app } = require('electron');
  const fs = require('fs');
  const backupService = require('../../services/backupService');

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
      const buf = backupService.createBackup(getDb(), password, { appVersion: app.getVersion() });
      fs.writeFileSync(r.filePath, buf);
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
      return { ok: true, path: r.filePaths[0], meta, summary };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('settings-backup-apply', async (_e, { path: filePath, password } = {}) => {
    requireRole('admin');
    if (!filePath) return { ok: false, error: 'No backup file selected.' };
    if (!password || !String(password).trim()) return { ok: false, error: 'A password is required.' };
    try {
      const { payload } = backupService.readBackup(fs.readFileSync(filePath), password);   // re-validate before write
      const { applied } = backupService.applyBackup(getDb(), payload);
      logAudit(getDb(), { action: 'settings_backup_restore', action_category: 'settings',
        target_type: 'backup', outcome: 'success', metadata: { tables: Object.keys(applied).length } });
      return { ok: true, applied, restart: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });
}

module.exports = { register };
