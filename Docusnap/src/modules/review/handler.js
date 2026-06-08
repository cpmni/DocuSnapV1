'use strict';

/**
 * modules/review/handler.js
 * Review queue, defer, delete, confirm, document pages.
 */

const os = require('os');

// ── Deferred source-file move (confirm/commit path) ──────────────────────────
// commitDocument copies the original scan to its filed location immediately,
// but the source can still be open in the preview pipeline (img/PDF render)
// at that exact moment — deleting it then is the documented cause of the
// locked-file failures in processing.log. Instead of retrying in a loop while
// the user waits, we defer the delete to the next point we know for certain
// the preview has moved on: the next get-document-pages call for a different
// document. With no further document to load (end of queue), there's no
// "next load" to hook, so we fall back to a short fixed delay instead.
//
// At most one move is ever pending — confirms happen one at a time, and the
// pending move for document A is always resolved (by the next load, or by
// its timer) before document B can be confirmed in the normal flow.
let _pendingSourceMove = null;   // { srcPath, originalFilename, timer }

function _runPendingSourceMove(ctx, trigger) {
  const pending = _pendingSourceMove;
  if (!pending) return;
  _pendingSourceMove = null;
  if (pending.timer) clearTimeout(pending.timer);

  const { fs, logger } = ctx;
  const filing = require('../filing/handler');
  filing.removeSourceFile(fs, pending.srcPath, logger).then(ok => {
    logger?.log(
      `[filing] source move (${trigger}): ${pending.originalFilename}` +
      (ok ? ' — removed' : ' — FAILED (see warnings above)')
    );
  });
}

function _scheduleSourceMove(ctx, db, documents, { srcPath, originalFilename }) {
  // Resolve anything still outstanding first — never silently drop a
  // scheduled removal just because another confirm arrived.
  if (_pendingSourceMove) _runPendingSourceMove(ctx, 'flushed before next confirm');

  if (documents.getReviewCount(db) > 0) {
    _pendingSourceMove = { srcPath, originalFilename, timer: null };
    ctx.logger?.log(`[filing] source move deferred to next document load: ${originalFilename}`);
  } else {
    const timer = setTimeout(() => _runPendingSourceMove(ctx, 'after ~3s, queue empty'), 3000);
    _pendingSourceMove = { srcPath, originalFilename, timer };
    ctx.logger?.log(`[filing] queue empty — source move deferred ~3s: ${originalFilename}`);
  }
}

function register(ctx) {
  const { ipcMain, getDb, pythonExe, pythonArgs, tesseractPath,
          notifyMainWindow, spawn, path, fs, logger } = ctx;

  const documents  = require('../../../database/modules/documents');
  const learning   = require('../../../database/modules/learning');
  const doctypes   = require('../../../database/modules/document_types');
  const { requireRole, requireLogin, hasRole } = require('../auth/handler');

  // ── Queue queries ───────────────────────────────────────────────────────────
  // The review/deferred queues are the working-document workflow surface —
  // every action on them (edit, confirm, defer, reprocess) is Admin/Edit only,
  // so Read Only has no use for the queue contents either (their "view" role
  // is served by Search, which lists filed documents — see search/handler.js).
  ipcMain.handle('get-review-queue',  () => { requireRole('admin', 'edit'); return documents.getReviewQueue(getDb()); });
  ipcMain.handle('get-deferred-queue',() => { requireRole('admin', 'edit'); return documents.getDeferredQueue(getDb()); });
  ipcMain.handle('get-review-count',  () => { requireRole('admin', 'edit'); return documents.getReviewCount(getDb()); });
  ipcMain.handle('get-deferred-count',() => { requireRole('admin', 'edit'); return documents.getDeferredCount(getDb()); });

  // get-document-with-extractions / get-document-pages are shared with the
  // Search window (Read Only previews filed documents there too) — gate to
  // "any signed-in user", not a specific role.
  ipcMain.handle('get-document-with-extractions', (_e, id) => {
    requireLogin();
    return documents.getWithExtractions(getDb(), id);
  });

  // ── Document pages for preview ──────────────────────────────────────────────
  ipcMain.handle('get-document-pages', async (_e, docId, folderPath, filename) => {
    requireLogin();
    if (!folderPath || !filename) {
      console.log(`[pages] docId=${docId} missing path — folderPath=${folderPath} filename=${filename}`);
      return [];
    }
    const filePath = path.join(folderPath, filename);

    // A new document loading is our signal that the previous one's preview
    // has moved on — fire any deferred source-file move now (unless, oddly,
    // it's pending removal of the very file we're about to load).
    if (_pendingSourceMove && _pendingSourceMove.srcPath !== filePath) {
      _runPendingSourceMove(ctx, 'next document loaded');
    }

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
      let err = '';
      proc.stdout.on('data', d => { out += d.toString(); });
      proc.stderr.on('data', d => { err += d.toString(); });
      proc.on('error', (e) => {
        console.log(`[pages] spawn error for ${filePath}: ${e.message}`);
        resolve([]);
      });
      proc.on('close', (code) => {
        try {
          resolve(JSON.parse(out));
        } catch (e) {
          console.log(`[pages] render failed for ${filePath} — exit=${code} stdout_len=${out.length} parse_error=${e.message}`
            + (err ? ` stderr=${err.trim().slice(0, 500)}` : ''));
          resolve([]);
        }
      });
    });
  });

  // ── Defer ───────────────────────────────────────────────────────────────────
  ipcMain.handle('defer-document', (_e, docId) => {
    requireRole('admin', 'edit');
    const db = getDb();
    documents.update(db, docId, { status: 'deferred' });
    notifyMainWindow('review-count-changed',   documents.getReviewCount(db));
    notifyMainWindow('deferred-count-changed', documents.getDeferredCount(db));
    return true;
  });

  ipcMain.handle('restore-deferred', (_e, docId) => {
    requireRole('admin', 'edit');
    const db = getDb();
    documents.update(db, docId, { status: 'needs_review' });
    notifyMainWindow('review-count-changed',   documents.getReviewCount(db));
    notifyMainWindow('deferred-count-changed', documents.getDeferredCount(db));
    return true;
  });

  // ── Delete ──────────────────────────────────────────────────────────────────
  // Delete is the one queue action the user explicitly kept Admin-exclusive
  // (Edit gets the rest of the daily workflow — review, edit, confirm, defer,
  // reprocess — but not permanent deletion of a scanned document).
  ipcMain.handle('delete-document', async (_e, docId, filePath) => {
    requireRole('admin');
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
    requireRole('admin', 'edit');
    const {
      document_id, folder_path, original_filename,
      corrections, allValues, supplier_name,
      document_type, document_type_slug,
      taught_fields,
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
      documentType:      document_type || dtInfo?.name,
      dtInfo,
      logger,
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
      supplier_name, document_type_slug, allValues,
      taught_fields || []
    );

    // Create or update template
    try {
      await _upsertTemplate(ctx, db, document_id, {
        allValues, document_type_slug, supplier_name, dtInfo,
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

    // Defer removal of the original scan until the preview UI is done with
    // it — see _scheduleSourceMove for why (locked-file failures at confirm
    // time, documented in processing.log). commitDocument has already copied
    // the file to its filed location; only the delete-of-original is deferred.
    if (filingResult.srcPath) {
      _scheduleSourceMove(ctx, db, documents, {
        srcPath:          filingResult.srcPath,
        originalFilename: original_filename,
      });
    }

    notifyMainWindow('review-count-changed',   documents.getReviewCount(db));
    notifyMainWindow('deferred-count-changed', documents.getDeferredCount(db));

    return { success: true, ...filingResult };
  });

  ipcMain.on('notify-review-complete', () => {
    if (!hasRole('admin', 'edit')) return;
    const db = getDb();
    notifyMainWindow('review-count-changed',   documents.getReviewCount(db));
    notifyMainWindow('deferred-count-changed', documents.getDeferredCount(db));
  });
}

module.exports = { register };

// ── Template create / update ──────────────────────────────────────────────────

async function _upsertTemplate(ctx, db, document_id, { allValues, document_type_slug, supplier_name, dtInfo }) {
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
  const fields = _buildTemplateFields(allValues, dtInfo);

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

function _buildTemplateFields(allValues, dtInfo) {
  // Whether a field is "variable" (differs per document — reference number,
  // date) or "constant" for a supplier (company name, address) comes from
  // the document type's own schema (ref_field_key / date_field_key / type),
  // via document_types.js's _annotateFieldVariability — see field.is_variable.
  // This generalises to custom document types/fields automatically, and
  // keeps the answer in one place rather than a hand-maintained map here
  // that previously also stored short anchor-label guesses like 'PO' or '#'
  // which matched as substrings inside unrelated text (e.g. 'PO' inside
  // "Polychemtex Inc.", producing "lychemtex Inc." as the extracted value).
  // Variable fields get no anchor_label here — they are templated by the
  // user-taught ⊕ field-anchor tool (Stage 2, coordinate-based crop+OCR),
  // which is immune to text-substring collisions.
  const fieldMeta = new Map((dtInfo?.fields || []).map(f => [f.key, f]));

  return Object.entries(allValues)
    .filter(([, v]) => v && String(v).trim())
    .map(([key, value]) => {
      const meta = fieldMeta.get(key);
      const isVariable = meta ? !!meta.is_variable : true;
      return {
        field_key:    key,
        anchor_label: null,
        direction:    'right',
        fixed_value:  isVariable ? null : String(value).trim(),
        is_variable:  isVariable,
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
