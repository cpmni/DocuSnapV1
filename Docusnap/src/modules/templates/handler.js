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
  const { spawn } = require('child_process');
  const templates = require('../../../database/modules/templates');
  const documents = require('../../../database/modules/documents');
  const { requireRole } = require('../auth/handler');

  // Resolve a document row to an on-disk file (managed working copy preferred,
  // then the filed/stored location) — mirrors the preview/reprocess resolution.
  function _resolveDocPath(doc) {
    if (!doc) return null;
    const ok = (p) => (p && fs.existsSync(p) ? p : null);
    const dir  = doc.stored_path || doc.folder_path;
    const name = doc.stored_filename || doc.original_filename;
    return ok(doc.working_path)
        || ok(dir && name ? path.join(dir, name) : null)
        || ok(doc.folder_path && doc.original_filename ? path.join(doc.folder_path, doc.original_filename) : null);
  }

  // Generate registration landmarks from a template's pinned sample page and
  // store them (templates.setLandmarks). Best-effort + async: a failure never
  // blocks pinning/mapping — the template simply falls back to the existing
  // anchor/offset path until landmarks exist. Reuses the same Python/Tesseract
  // the rest of processing uses (ocr/landmarks.py). This is the SAME mechanism
  // for new templates (auto on sample pin) and the existing-corpus backfill.
  function generateLandmarks(templateId) {
    return new Promise((resolve) => {
      try {
        const db = getDb();
        const tmpl = templates.getById(db, templateId);
        if (!tmpl || !tmpl.sample_document_id) return resolve({ success: false, reason: 'no sample' });
        const doc  = db.prepare('SELECT * FROM documents WHERE id = ?').get(tmpl.sample_document_id);
        const file = _resolveDocPath(doc);
        if (!file) return resolve({ success: false, reason: 'sample file not found' });
        const script = ctx.resourcePath('python_backend', 'ocr', 'landmarks.py');
        const proc = spawn(ctx.pythonExe(),
          ctx.pythonArgs(script, '--file', file, '--page', '0', '--emit-phash', '--tesseract', ctx.tesseractPath()),
          { windowsHide: true });
        let out = '', err = '';
        proc.stdout.on('data', d => { out += d.toString(); });
        proc.stderr.on('data', d => { err += d.toString(); });
        proc.on('close', () => {
          if (err) console.error('landmarks stderr:', err.trim());
          // --emit-phash returns {landmarks, logo_phash}; tolerate the legacy array.
          let parsed = null;
          try { parsed = JSON.parse(out.trim()); } catch {}
          const list  = Array.isArray(parsed) ? parsed : (parsed && parsed.landmarks) || [];
          const phash = (parsed && !Array.isArray(parsed)) ? parsed.logo_phash : null;
          if (Array.isArray(list) && list.length) {
            try { templates.setLandmarks(db, templateId, list); }
            catch (e) { console.error('setLandmarks:', e.message); }
          }
          // Seed identity from the sample ONLY when the template has none — never
          // overwrite an established phash (consistent with chooseLogoPhash). This
          // is what stops empty-phash orphan templates that can never be matched.
          if (phash && !tmpl.logo_phash) {
            try {
              db.prepare("UPDATE templates SET logo_phash = ?, updated_at = datetime('now') WHERE id = ? AND (logo_phash IS NULL OR logo_phash = '')").run(phash, templateId);
            } catch (e) { console.error('seed logo_phash:', e.message); }
          }
          resolve({ success: list.length > 0, count: list.length, phashSeeded: !!(phash && !tmpl.logo_phash) });
        });
        proc.on('error', (e) => { console.error('landmarks spawn:', e.message); resolve({ success: false, reason: e.message }); });
      } catch (e) {
        console.error('generateLandmarks:', e.message);
        resolve({ success: false, reason: e.message });
      }
    });
  }

  // Lazy one-shot backfill: existing templates that have a pinned sample but no
  // landmarks gain them with NO re-teach. Delayed + sequential so it never
  // competes with startup or active processing; entirely best-effort.
  setTimeout(async () => {
    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT t.id FROM templates t
        WHERE t.sample_document_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM template_landmarks l WHERE l.template_id = t.id)
      `).all();
      for (const r of rows) await generateLandmarks(r.id);
      if (rows.length) console.log(`[landmarks] backfilled ${rows.length} template(s)`);
    } catch (e) { console.error('[landmarks] backfill failed:', e.message); }
  }, 8000);

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

  ipcMain.handle('set-template-sample', async (_e, templateId, documentId) => {
    requireRole('admin');
    templates.setSampleDocument(getDb(), templateId, documentId);
    // Refresh registration landmarks from the newly-pinned sample (best-effort).
    await generateLandmarks(templateId);
    return templates.getById(getDb(), templateId);
  });

  // Recompute registration landmarks from the template's CURRENT pinned sample
  // without changing the pin — the user-facing recovery lever for a template that
  // ended up with no/poor landmarks (e.g. the startup backfill couldn't render the
  // sample, or the sample's files were since removed). Returns {success,count} so
  // the UI can report it; replaces all landmark rows (templates.setLandmarks).
  ipcMain.handle('regenerate-template-landmarks', async (_e, templateId) => {
    requireRole('admin');
    return generateLandmarks(templateId);
  });

  // Reassign a poisoned/duplicate template's documents onto an existing correct
  // template (Learning Recovery → "Reassign"). Reversible link-only move; the
  // caller follows up with the existing delete-template if the source is now an
  // empty duplicate to be removed. Returns a {moved, sampleAdopted} summary.
  ipcMain.handle('reassign-template-documents', (_e, fromTemplateId, toTemplateId) => {
    requireRole('admin');
    return templates.reassignDocuments(getDb(), Number(fromTemplateId), Number(toTemplateId));
  });

  // Consolidate a duplicate/fragment template INTO a canonical one and delete the
  // source (Learning Recovery → "Merge into…"). IRREVERSIBLE — folds the source's
  // doc links + missing mappings/fields/landmarks/sample/identity into the target
  // (target wins) and removes the source. See templates.mergeInto.
  ipcMain.handle('merge-template', (_e, fromTemplateId, toTemplateId) => {
    requireRole('admin');
    return templates.mergeInto(getDb(), Number(fromTemplateId), Number(toTemplateId));
  });

  // OCR auto-processing — enable/disable a learned per-template OCR
  // preprocessing rule (see templates.setOcrAutoParams, created via an
  // OCR-Preview-active reprocess). Toggling never discards the stored
  // params, so re-enabling restores the same baseline.
  ipcMain.handle('set-template-ocr-auto', (_e, templateId, enabled) => {
    requireRole('admin');
    return templates.setOcrAutoEnabled(getDb(), templateId, !!enabled);
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

  ipcMain.handle('import-template-sample-file', async (_e, templateId, filePath) => {
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
    await generateLandmarks(templateId);   // derive registration landmarks (best-effort)
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

  // ── Fixed field values ───────────────────────────────────────────────────────
  // Explicit admin-managed constant value for a single template field. Reuses
  // the existing template_fields.fixed_value / is_variable mechanism that
  // template_matcher.extract_with_template already applies during processing and
  // reprocess — this endpoint only exposes set/clear from the UI. Passing an
  // empty value clears the override and returns the field to normal extraction.
  ipcMain.handle('set-template-field-fixed', (_e, templateId, fieldKey, fixedValue) => {
    requireRole('admin');
    if (!fieldKey) return { success: false, error: 'field_key required' };
    const template = templates.setFieldFixedValue(getDb(), Number(templateId), fieldKey, fixedValue);
    return { success: true, template };
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
