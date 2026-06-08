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

const path = require('path');
const fs   = require('fs');

// Extensions the existing get-document-pages preview path actually renders
// correctly (PDF via render/pages.py; PNG/JPEG inline as a data URI — see
// review/handler.js). Deliberately narrower than watch/handler.js's
// SUPPORTED_EXTENSIONS (which also lists .tiff/.bmp): offering a type the
// preview can't display would break "appears in the preview immediately".
const SAMPLE_FILE_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg']);

function register(ctx) {
  const { ipcMain, getDb } = ctx;
  const templates = require('../../../database/modules/templates');
  const documents = require('../../../database/modules/documents');
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

  // Admin-facing template management — name is purely cosmetic metadata
  // (matching relies solely on logo_phash / keyword_fingerprint, see
  // template_matcher.py and templates.create's slug derivation), and delete
  // is scoped to this template's own rows only — see templates.remove.
  ipcMain.handle('create-template', (_e, data) => {
    requireRole('admin');
    const id = templates.create(getDb(), {
      name:               ((data && data.name) || '').trim(),
      document_type_slug: (data && data.document_type_slug) || null,
    });
    return templates.getById(getDb(), id);
  });

  ipcMain.handle('rename-template', (_e, templateId, name) => {
    requireRole('admin');
    return templates.rename(getDb(), templateId, (name || '').trim());
  });

  ipcMain.handle('delete-template', (_e, templateId) => {
    requireRole('admin');
    templates.remove(getDb(), templateId);
    return true;
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

  // A brand-new template has no confirmed documents yet — get-template-sample-
  // candidates is necessarily empty (chicken-and-egg: nothing can match an
  // empty template). These two let an admin attach an arbitrary file in place
  // as a working sample, so anchor/target mapping has something to draw on
  // immediately. The file is referenced, not copied (see import handler), and
  // is registered as a minimal `documents` row under a dedicated status —
  // 'template_sample' — that every status-filtered surface (review queue,
  // deferred queue, counts, search — all exact-match equality) ignores, so it
  // can never leak into normal document flows. This reuses the exact same
  // documents.insert / setSampleDocument / getSampleDocument / get-document-pages
  // chain the rest of the Template Viewer already relies on for preview.
  ipcMain.handle('pick-template-sample-file', async (e) => {
    requireRole('admin');
    const { dialog, BrowserWindow } = require('electron');
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      title: 'Select a sample document for this template',
      filters: [{ name: 'Documents & Images', extensions: ['pdf', 'png', 'jpg', 'jpeg'] }],
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('import-template-sample-file', (_e, templateId, filePath) => {
    requireRole('admin');
    if (!filePath || !fs.existsSync(filePath)) return { success: false, error: 'File not found' };
    const ext = path.extname(filePath).toLowerCase();
    if (!SAMPLE_FILE_EXTENSIONS.has(ext)) return { success: false, error: 'Unsupported file type' };
    const info = documents.insert(getDb(), {
      original_filename: path.basename(filePath),
      folder_path:       path.dirname(filePath),
      status:            'template_sample',
      template_id:       templateId,
    });
    templates.setSampleDocument(getDb(), templateId, info.lastInsertRowid);
    return { success: true, template: templates.getById(getDb(), templateId) };
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

  // ── Template groups (v1: organisational metadata only) ────────────────────
  ipcMain.handle('get-template-groups', (_e) => {
    requireRole('admin');
    return templates.getAllGroups(getDb());
  });

  ipcMain.handle('create-template-group', (_e, name) => {
    requireRole('admin');
    templates.createGroup(getDb(), (name || '').trim());
    return templates.getAllGroups(getDb());
  });

  ipcMain.handle('delete-template-group', (_e, id) => {
    requireRole('admin');
    templates.deleteGroup(getDb(), id);
    return templates.getAllGroups(getDb());
  });

  ipcMain.handle('set-template-group', (_e, templateId, groupId) => {
    requireRole('admin');
    return templates.setTemplateGroup(getDb(), templateId, groupId || null);
  });

  ipcMain.handle('get-template-siblings', (_e, templateId) => {
    requireRole('admin');
    const tmpl = templates.getById(getDb(), templateId);
    if (!tmpl || !tmpl.group_id) return [];
    return templates.getSiblings(getDb(), tmpl.group_id, templateId);
  });
}

module.exports = { register };
