'use strict';

/**
 * modules/review/handler.js
 * Review queue, defer, delete, confirm, document pages.
 */

const os = require('os');

function register(ctx) {
  const { ipcMain, getDb, pythonExe, pythonArgs, tesseractPath,
          notifyMainWindow, spawn, path, fs, logger } = ctx;

  const documents  = require('../../../database/modules/documents');
  const learning   = require('../../../database/modules/learning');
  const doctypes   = require('../../../database/modules/document_types');

  // ── Queue queries ───────────────────────────────────────────────────────────
  ipcMain.handle('get-review-queue',  () => documents.getReviewQueue(getDb()));
  ipcMain.handle('get-deferred-queue',() => documents.getDeferredQueue(getDb()));
  ipcMain.handle('get-review-count',  () => documents.getReviewCount(getDb()));
  ipcMain.handle('get-deferred-count',() => documents.getDeferredCount(getDb()));

  ipcMain.handle('get-document-with-extractions', (_e, id) =>
    documents.getWithExtractions(getDb(), id));

  // ── Document pages for preview ──────────────────────────────────────────────
  ipcMain.handle('get-document-pages', async (_e, docId, folderPath, filename) => {
    if (!folderPath || !filename) {
      console.log(`[pages] docId=${docId} missing path — folderPath=${folderPath} filename=${filename}`);
      return [];
    }
    const filePath = path.join(folderPath, filename);
    if (!fs.existsSync(filePath)) {
      console.log(`[pages] file not found: ${filePath}`);
      return [];
    }

    const ext = path.extname(filename).toLowerCase();
    if (ext !== '.pdf') {
      const data = fs.readFileSync(filePath);
      const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
      return [`data:${mime};base64,${data.toString('base64')}`];
    }

    const py     = pythonExe();
    const script = ctx.resourcePath('python_backend', 'render', 'pages.py');
    return new Promise((resolve) => {
      const proc = spawn(py, pythonArgs(script, '--file', filePath),
        { windowsHide: true });
      let out = '';
      proc.stdout.on('data', d => { out += d.toString(); });
      proc.on('close', () => {
        try { resolve(JSON.parse(out)); } catch { resolve([]); }
      });
    });
  });

  // ── Defer ───────────────────────────────────────────────────────────────────
  ipcMain.handle('defer-document', (_e, docId) => {
    const db = getDb();
    documents.update(db, docId, { status: 'deferred' });
    notifyMainWindow('review-count-changed',   documents.getReviewCount(db));
    notifyMainWindow('deferred-count-changed', documents.getDeferredCount(db));
    return true;
  });

  ipcMain.handle('restore-deferred', (_e, docId) => {
    const db = getDb();
    documents.update(db, docId, { status: 'needs_review' });
    notifyMainWindow('review-count-changed',   documents.getReviewCount(db));
    notifyMainWindow('deferred-count-changed', documents.getDeferredCount(db));
    return true;
  });

  // ── Delete ──────────────────────────────────────────────────────────────────
  ipcMain.handle('delete-document', async (_e, docId, filePath) => {
    const db = getDb();
    // Delete file from disk
    if (filePath && fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (e) {
        console.warn('Could not delete file:', filePath, e.message);
      }
    }
    // Remove from DB
    documents.deleteDoc(db, docId);
    notifyMainWindow('review-count-changed',   documents.getReviewCount(db));
    notifyMainWindow('deferred-count-changed', documents.getDeferredCount(db));
    return true;
  });

  // ── Confirm review ──────────────────────────────────────────────────────────
  ipcMain.handle('confirm-review', async (_e, payload) => {
    const {
      document_id, folder_path, original_filename,
      corrections, allValues, supplier_name,
      document_type, document_type_slug,
    } = payload;

    const db      = getDb();
    const filing  = require('../filing/handler');

    // Get document type info for filing
    const dtInfo = document_type_slug
      ? doctypes.getWithFields(db, document_type_slug)
      : null;

    // Build the filed path
    const outputRoot = learning.getSetting(db, 'output_folder', null);
    if (!outputRoot) {
      return { success: false, error: 'No output folder set. Please configure it in Settings.' };
    }

    // Release file handle — renderer should have cleared img.src already
    await new Promise(r => setTimeout(r, 150));

    const filingResult = await filing.commitDocument({
      db, fs, path,
      outputRoot,
      folderPath:        folder_path,
      originalFilename:  original_filename,
      allValues,
      documentType:      document_type,
      dtInfo,
    });

    if (!filingResult.success) {
      logger?.err(`Confirm failed: ${original_filename} — ${filingResult.error}`);
      return filingResult;
    }

    // Log confirm
    if (logger) {
      const fieldSummary = Object.entries(allValues || {})
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(' | ');
      logger.log(
        `Confirmed: ${original_filename} → type=${document_type_slug || '?'}` +
        ` supplier=${allValues?.supplier_name || supplier_name || '?'}` +
        ` filed=${filingResult.filename}`
      );
      if (fieldSummary) logger.log(`  Values: ${fieldSummary}`);
    }

    // Save corrections for learning
    learning.saveCorrections(
      db, document_id, corrections || {},
      supplier_name, document_type_slug, allValues
    );

    // Create or update template
    try {
      await _upsertTemplate(ctx, db, document_id, {
        allValues, document_type_slug, supplier_name,
      });
    } catch (e) {
      console.warn('[confirm-review] template upsert failed (non-critical):', e.message);
    }

    // Update document record
    documents.confirm(db, document_id, {
      stored_filename: filingResult.filename,
      stored_path:     filingResult.filePath,
    });

    // Update supplier name, date, reference for search
    const refField  = dtInfo?.ref_field_key  || 'invoice_number';
    const dateField = dtInfo?.date_field_key || 'invoice_date';
    documents.update(db, document_id, {
      supplier_name:    allValues.supplier_name || supplier_name || null,
      doc_date:         allValues[dateField]    || null,
      reference_number: allValues[refField]     || null,
      document_type_id: dtInfo?.id             || null,
    });

    notifyMainWindow('review-count-changed',   documents.getReviewCount(db));
    notifyMainWindow('deferred-count-changed', documents.getDeferredCount(db));

    return { success: true, ...filingResult };
  });

  ipcMain.on('notify-review-complete', () => {
    const db = getDb();
    notifyMainWindow('review-count-changed',   documents.getReviewCount(db));
    notifyMainWindow('deferred-count-changed', documents.getDeferredCount(db));
  });
}

module.exports = { register };

// ── Template create / update ──────────────────────────────────────────────────

async function _upsertTemplate(ctx, db, document_id, { allValues, document_type_slug, supplier_name }) {
  const { path, fs, templatesDir } = ctx;
  const templates = require('../../../database/modules/templates');

  // Read document record for stored logo_phash and keyword_fingerprint
  const doc = db.prepare(
    'SELECT template_id, logo_phash, keyword_fingerprint FROM documents WHERE id = ?'
  ).get(document_id);
  if (!doc) return;

  const logo_phash           = doc.logo_phash || null;
  const keyword_fingerprint  = _parseJson(doc.keyword_fingerprint, []);

  // Build template field rules from confirmed values
  const fields = _buildTemplateFields(allValues, document_type_slug);

  if (doc.template_id) {
    // Update existing template
    templates.update(db, doc.template_id, { logo_phash, keyword_fingerprint, fields });
    _writeTemplateFile(db, doc.template_id, path, fs, templatesDir());
  } else {
    // Create new template — name from supplier + doc type
    const typeName  = document_type_slug
      ? document_type_slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      : 'Document';
    const name      = supplier_name
      ? `${supplier_name} ${typeName}`
      : `${typeName} Template`;

    const templateId = templates.create(db, {
      name,
      document_type_slug: document_type_slug || null,
      logo_phash,
      keyword_fingerprint,
      fields,
    });

    // Link document to its new template
    db.prepare('UPDATE documents SET template_id = ? WHERE id = ?').run(templateId, document_id);
    _writeTemplateFile(db, templateId, path, fs, templatesDir());
  }
}

function _buildTemplateFields(allValues, document_type_slug) {
  const FIELD_ANCHORS = {
    supplier_name:      { anchor: null,    direction: null,    variable: false },
    customer_name:      { anchor: null,    direction: null,    variable: false },
    invoice_number:     { anchor: '#',     direction: 'right', variable: true  },
    invoice_date:       { anchor: 'Date:', direction: 'right', variable: true  },
    sales_order_number: { anchor: 'Order', direction: 'right', variable: true  },
    order_date:         { anchor: 'Date:', direction: 'right', variable: true  },
    po_number:          { anchor: 'PO',    direction: 'right', variable: true  },
    po_date:            { anchor: 'Date:', direction: 'right', variable: true  },
  };

  return Object.entries(allValues)
    .filter(([, v]) => v && String(v).trim())
    .map(([key, value]) => {
      const rule = FIELD_ANCHORS[key] || { anchor: null, direction: null, variable: true };
      return {
        field_key:   key,
        anchor_label: rule.anchor || null,
        direction:   rule.direction || 'right',
        fixed_value: rule.variable ? null : String(value).trim(),
        is_variable: rule.variable,
      };
    });
}

function _writeTemplateFile(db, templateId, path, fs, dir) {
  const templates = require('../../../database/modules/templates');
  const all       = templates.getAll(db);
  const tmpl      = all.find(t => t.id === templateId);
  if (!tmpl) return;
  const slug = tmpl.slug || String(templateId);
  const file = path.join(dir, `${slug}.json`);
  fs.writeFileSync(file, JSON.stringify(tmpl, null, 2), 'utf8');
}

function _parseJson(str, fallback) {
  try { return JSON.parse(str || 'null') || fallback; } catch { return fallback; }
}
