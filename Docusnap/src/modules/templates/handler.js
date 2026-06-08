'use strict';

/**
 * modules/templates/handler.js
 * Admin Template Viewer / Anchor Mapping — browse stored templates, pin a
 * representative sample document, and define per-field anchor → target zone
 * mappings used by template_mapper.py during extraction.
 *
 * This whole surface lives inside the Settings window, which is already
 * gated to hasRole('admin') at open-settings-window (see main.js) — the
 * requireRole('admin') calls below are defence-in-depth, matching the
 * convention used throughout settings/handler.js.
 */

function register(ctx) {
  const { ipcMain, getDb } = ctx;
  const templates = require('../../../database/modules/templates');
  const { requireRole } = require('../auth/handler');

  // ── Browse ──────────────────────────────────────────────────────────────────
  ipcMain.handle('get-templates', () => {
    requireRole('admin');
    return templates.getAll(getDb());
  });

  ipcMain.handle('get-template-detail', (_e, templateId) => {
    requireRole('admin');
    return templates.getById(getDb(), templateId);
  });

  // Confirmed documents this template was learned from / matched against —
  // the candidate pool for "pin a representative sample". Reuses the same
  // template_id link that _upsertTemplate (review/handler.js) already writes
  // on every confirm, so no new linkage needs to be recorded.
  ipcMain.handle('get-template-sample-candidates', (_e, templateId) => {
    requireRole('admin');
    return getDb().prepare(`
      SELECT id, original_filename, stored_filename, stored_path, folder_path,
             supplier_name, doc_date, reference_number, confirmed_at, status
      FROM documents
      WHERE template_id = ? AND status = 'confirmed'
      ORDER BY confirmed_at DESC
      LIMIT 30
    `).all(templateId);
  });

  ipcMain.handle('set-template-sample', (_e, templateId, documentId) => {
    requireRole('admin');
    templates.setSampleDocument(getDb(), templateId, documentId);
    return templates.getById(getDb(), templateId);
  });

  // ── Field anchor → target mappings ──────────────────────────────────────────
  ipcMain.handle('save-template-mapping', (_e, templateId, mapping) => {
    requireRole('admin');
    if (!mapping || !mapping.field_key) return { success: false, error: 'field_key required' };
    const required = ['anchor_x_norm', 'anchor_y_norm', 'anchor_w_norm', 'anchor_h_norm',
                      'target_x_norm', 'target_y_norm', 'target_w_norm', 'target_h_norm'];
    if (required.some(k => mapping[k] == null)) {
      return { success: false, error: 'anchor and target boxes are both required' };
    }
    const saved = templates.saveMapping(getDb(), templateId, mapping);
    return { success: true, mapping: saved };
  });

  ipcMain.handle('set-template-mapping-enabled', (_e, templateId, fieldKey, enabled) => {
    requireRole('admin');
    templates.setMappingEnabled(getDb(), templateId, fieldKey, !!enabled);
    return true;
  });

  ipcMain.handle('delete-template-mapping', (_e, templateId, fieldKey) => {
    requireRole('admin');
    templates.deleteMapping(getDb(), templateId, fieldKey);
    return true;
  });

  // The renderer drives the actual test crop+OCR via the existing ocr-region
  // primitive (same approach as the review window's ⊕ teaching tool — see
  // captureAnchorContext in review/renderer.js); this endpoint just persists
  // the resulting value/confidence/status so "last test result" survives a
  // reload, per the field-panel spec.
  ipcMain.handle('record-template-mapping-test', (_e, templateId, fieldKey, result) => {
    requireRole('admin');
    templates.recordMappingTest(getDb(), templateId, fieldKey, result || {});
    return true;
  });
}

module.exports = { register };
