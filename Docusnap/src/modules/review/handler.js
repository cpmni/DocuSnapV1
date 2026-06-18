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
  const templates  = require('../../../database/modules/templates');
  const { requireRole, requireLogin, hasRole, logAudit } = require('../auth/handler');

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
    const db  = getDb();
    const doc = documents.getWithExtractions(db, id);
    if (doc) {
      // Attach the fields whose learned format is digits-only, so Review can
      // warn before confirming a non-digit value on one (Part 2). Resolve the
      // type slug from document_type_id (getById is SELECT * and has no slug).
      let typeSlug = doc.type_slug || null;
      if (!typeSlug && doc.document_type_id) {
        const t = db.prepare('SELECT slug FROM document_types WHERE id = ?').get(doc.document_type_id);
        typeSlug = t ? t.slug : null;
      }
      // getWithExtractions → getById is SELECT * (no JOIN) so it lacks type_slug.
      // Surface the resolved slug so Review can sync its doc-type dropdown to the
      // record after a reprocess re-identifies the type.
      doc.type_slug = typeSlug;
      doc.digit_only_fields = learning.getDigitsOnlyFields(db, doc.supplier_name, typeSlug);
      logAudit(db, { action: 'document_open', target_type: 'document', target_id: id,
        document_id: id, outcome: 'success', metadata: { type: typeSlug || null, status: doc.status || null } });
    }
    return doc;
  });

  // Document close — the Review window fires this when it navigates away from a
  // document or the window is closed. Completes the open/close audit pair.
  ipcMain.on('notify-doc-closed', (_e, docId) => {
    if (docId == null) return;
    try { logAudit(getDb(), { action: 'document_close', target_type: 'document', target_id: docId,
      document_id: docId, outcome: 'success' }); } catch {}
  });

  // ── Document pages for preview ──────────────────────────────────────────────
  ipcMain.handle('get-document-pages', async (_e, docId, folderPath, filename) => {
    requireLogin();
    if (!folderPath || !filename) {
      console.log(`[pages] docId=${docId} missing path — folderPath=${folderPath} filename=${filename}`);
      return [];
    }
    const sourcePath = path.join(folderPath, filename);

    // A new document loading is our signal that the previous one's preview
    // has moved on — fire any deferred source-file move now (unless, oddly,
    // it's pending removal of the very file we're about to load).
    if (_pendingSourceMove && _pendingSourceMove.srcPath !== sourcePath) {
      _runPendingSourceMove(ctx, 'next document loaded');
    }

    // Prefer the app-managed working copy — the reliable, app-owned location
    // that doesn't depend on the user's source folder. Fall back to the source.
    const wpRow = getDb().prepare('SELECT working_path FROM documents WHERE id = ?').get(docId);
    let filePath = (wpRow && wpRow.working_path && fs.existsSync(wpRow.working_path))
      ? wpRow.working_path
      : sourcePath;

    if (!fs.existsSync(filePath)) {
      // The recorded source can be gone if the file was moved/renamed since
      // processing — by the "Processed folder" setting, by confirming a duplicate
      // (filed to the output folder, sometimes under a "-N" disambiguated name),
      // or by deleting the source folder. Recover any surviving copy of the SAME
      // document. File-not-found ONLY, so normal previews are untouched.
      const db = getDb();
      // First existing on-disk location for a document row (filed copy or its
      // recorded folder), or null.
      const existing = (r) => {
        if (r.stored_path && fs.existsSync(r.stored_path)) return r.stored_path;
        if (r.folder_path && r.original_filename) {
          const p = path.join(r.folder_path, r.original_filename);
          if (fs.existsSync(p)) return p;
        }
        return null;
      };
      // Base name with the import's "-N" duplicate suffix normalised away, so a
      // row and its renamed copy match.
      const baseOf = (fn) => {
        const e = path.extname(fn || '');
        return path.basename(fn || '', e).replace(/-\d+$/, '');
      };
      // 1) this document's own filed copy
      const self = db.prepare('SELECT stored_path FROM documents WHERE id = ?').get(docId);
      let alt = (self && self.stored_path && fs.existsSync(self.stored_path)) ? self.stored_path : null;
      // 2) any other row holding the same source file (same normalised base name)
      if (!alt) {
        const base = baseOf(filename);
        const sibs = db.prepare(
          'SELECT folder_path, original_filename, stored_path FROM documents WHERE id <> ? AND original_filename LIKE ?'
        ).all(docId, base + '%');
        for (const r of sibs) {
          if (baseOf(r.original_filename) !== base) continue;
          const f = existing(r);
          if (f) { alt = f; break; }
        }
      }
      if (!alt) {
        console.log(`[pages] file not found (no recoverable copy): ${filePath}`);
        return [];
      }
      console.log(`[pages] source missing for docId=${docId}; previewing recovered copy: ${alt}`);
      filePath = alt;
    }

    const ext = path.extname(filePath).toLowerCase();
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

  // ── OCR preprocessing preview ────────────────────────────────────────────────
  ipcMain.handle('get-enhanced-preview', async (_e, { folderPath, filename, page, enhanceParams }) => {
    requireLogin();
    if (!folderPath || !filename || !enhanceParams) return null;

    const filePath = path.join(folderPath, filename);
    if (!fs.existsSync(filePath)) return null;

    const enhanceFile = path.join(os.tmpdir(), `ds_enh_preview_${Date.now()}.json`);
    fs.writeFileSync(enhanceFile, JSON.stringify(enhanceParams));

    const script = ctx.resourcePath('python_backend', 'render', 'preview_enhance.py');
    return new Promise((resolve) => {
      const py   = pythonExe();
      const proc = spawn(py, pythonArgs(script,
        '--file',         filePath,
        '--page',         String(page || 0),
        '--enhance-file', enhanceFile,
      ), { windowsHide: true });
      let out = '', err = '';
      proc.stdout.on('data', d => { out += d.toString(); });
      proc.stderr.on('data', d => { err += d.toString(); });
      proc.on('close', () => {
        try { fs.unlinkSync(enhanceFile); } catch {}
        try   { resolve(JSON.parse(out) || null); }
        catch {
          if (err) logger?.warn(`[preview] ${err.trim().slice(0, 200)}`);
          resolve(null);
        }
      });
    });
  });

  // ── Defer ───────────────────────────────────────────────────────────────────
  ipcMain.handle('defer-document', (_e, docId) => {
    requireRole('admin', 'edit');
    const db = getDb();
    documents.update(db, docId, { status: 'deferred' });
    logAudit(db, { action: 'review_deferred', target_type: 'document', target_id: docId, document_id: docId, outcome: 'success' });
    notifyMainWindow('review-count-changed',   documents.getReviewCount(db));
    notifyMainWindow('deferred-count-changed', documents.getDeferredCount(db));
    return true;
  });

  ipcMain.handle('restore-deferred', (_e, docId) => {
    requireRole('admin', 'edit');
    const db = getDb();
    documents.update(db, docId, { status: 'needs_review' });
    logAudit(db, { action: 'review_restored', target_type: 'document', target_id: docId, document_id: docId, outcome: 'success' });
    notifyMainWindow('review-count-changed',   documents.getReviewCount(db));
    notifyMainWindow('deferred-count-changed', documents.getDeferredCount(db));
    return true;
  });

  // Mark a flagged document as reviewed. This is the ONLY thing that lets a
  // flagged doc (validation note / correction candidate / below-threshold field)
  // become eligible for bulk "File All Ready" — it never files anything itself,
  // and is set only by a deliberate Mark Reviewed click, never by navigation.
  // Does not change the review count (doc stays in the queue), so no broadcast.
  ipcMain.handle('acknowledge-review', (_e, docId) => {
    requireRole('admin', 'edit');
    const db = getDb();
    const at = new Date().toISOString();
    documents.update(db, docId, { review_acknowledged_at: at });
    return at;
  });

  // ── Delete ──────────────────────────────────────────────────────────────────
  // Delete is the one queue action the user explicitly kept Admin-exclusive
  // (Edit gets the rest of the daily workflow — review, edit, confirm, defer,
  // reprocess — but not permanent deletion of a scanned document).
  ipcMain.handle('delete-document', async (_e, docId, filePath) => {
    requireRole('admin', 'edit');   // single-doc delete is Edit/Admin (matches the rest of Review)
    const db = getDb();
    // Delete file from disk
    if (filePath && fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (e) {
        console.warn('Could not delete file:', filePath, e.message);
      }
    }
    // Also remove the app-managed working copy, if any (avoid orphaned files).
    const wp = documents.getById(db, docId)?.working_path;
    if (wp && fs.existsSync(wp)) { try { fs.unlinkSync(wp); } catch {} }
    // Remove from DB
    documents.deleteDoc(db, docId);
    logAudit(db, { action: 'document_deleted', action_category: 'document', target_type: 'document',
      target_id: docId, document_id: docId, outcome: 'success', metadata: { had_file: !!filePath } });
    notifyMainWindow('review-count-changed',   documents.getReviewCount(db));
    notifyMainWindow('deferred-count-changed', documents.getDeferredCount(db));
    return true;
  });

  // ── Bulk delete of a whole queue (Admin only) ───────────────────────────────
  // Permanent deletion of scanned documents is Admin-exclusive, like the
  // single-doc delete above. Each helper is scoped to exactly one status so it
  // can never reach confirmed documents; source files are unlinked best-effort
  // first, then the rows (and their cascaded extractions) are removed in one
  // statement. Returning the deleted count lets the renderer report it.
  function _deleteQueue(status, rows, countEvent) {
    const db = getDb();
    for (const r of rows) {
      if (r.folder_path && r.original_filename) {
        const fp = path.join(r.folder_path, r.original_filename);
        try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) {
          console.warn('Could not delete file:', fp, e.message);
        }
      }
      // Remove the app-managed working copy too (avoid orphaned files).
      if (r.working_path && fs.existsSync(r.working_path)) {
        try { fs.unlinkSync(r.working_path); } catch {}
      }
    }
    const result = documents.deleteByStatus(db, status);
    notifyMainWindow(countEvent, status === 'needs_review'
      ? documents.getReviewCount(db) : documents.getDeferredCount(db));
    return { success: true, deleted: result.changes };
  }

  ipcMain.handle('delete-all-review', async () => {
    requireRole('admin');
    return _deleteQueue('needs_review', documents.getReviewQueue(getDb()), 'review-count-changed');
  });

  ipcMain.handle('delete-all-deferred', async () => {
    requireRole('admin');
    return _deleteQueue('deferred', documents.getDeferredQueue(getDb()), 'deferred-count-changed');
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
    // The app-managed working copy is the stable source for filing (the user's
    // original source may be gone). Captured before filing; cleaned up after.
    const workingPath = documents.getById(db, document_id)?.working_path || null;

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
      workingPath,
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

    // Update document record
    documents.confirm(db, document_id, {
      stored_filename: filingResult.filename,
      stored_path:     filingResult.filePath,
    });

    logAudit(db, { action: 'review_confirmed', target_type: 'document', target_id: document_id,
      document_id, outcome: 'success',
      metadata: { type: document_type_slug || null, filed: filingResult.filename,
                  fields_changed: Object.keys(corrections || {}).join(',') || null } });

    // Clear the per-field review AIDS now that a human has reviewed and accepted
    // this document. validation_note / corrected_to are pre-confirmation prompts
    // (e.g. the Stage 4.5 format-anomaly "/" warning); leaving them on the
    // extractions meant a re-opened COMMITTED doc still showed the stale warning
    // even though it was already reviewed. Display-only fields (not read by
    // learning), scoped to this document, so this is safe and targeted.
    db.prepare(
      'UPDATE extractions SET validation_note = NULL, corrected_to = NULL WHERE document_id = ?'
    ).run(document_id);

    // The working copy has served its purpose (the doc is now filed at
    // stored_path) — remove it and clear the pointer so resolveFilePath falls
    // through to the filed copy. Best-effort; a leftover file is harmless.
    if (workingPath) {
      try { if (fs.existsSync(workingPath)) fs.unlinkSync(workingPath); } catch {}
      documents.update(db, document_id, { working_path: null });
    }

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

  // ── Lightweight current-template recheck ────────────────────────────────────
  // A document can sit in the review queue from before a template covering its
  // layout was created (via "Add to Template Manager" below). Its template_id
  // and identification pill were set once at processing time and never refresh.
  // This re-runs only the cheap identification step — logo-hash hamming
  // distance and keyword-fingerprint scoring against the CURRENT template list,
  // using the document's already-stored logo_phash/ocr_text — so the review UI
  // can reflect a newly-available template without reprocessing or re-OCRing.
  ipcMain.handle('check-template-match-for-document', (_e, documentId) => {
    requireRole('admin', 'edit');
    const db  = getDb();
    const doc = db.prepare(
      'SELECT template_id, logo_phash, ocr_text FROM documents WHERE id = ?'
    ).get(documentId);
    if (!doc || doc.template_id) return { matched: false };

    const match = templates.identifyByFingerprint(db, {
      logo_phash: doc.logo_phash,
      ocr_text:   doc.ocr_text,
    });
    if (!match) return { matched: false };

    return {
      matched:      true,
      templateId:   match.template.id,
      templateName: match.template.name,
      confidence:   match.confidence,
      method:       match.method,
    };
  });

  // ── Add to Template Manager (explicit promotion) ───────────────────────────
  // Templates are no longer auto-created/refreshed on every confirm (see
  // _upsertTemplate's removal from confirm-review above). Automatic learning
  // — anchors, hints, corrections via saveCorrections — keeps working on every
  // confirm regardless. This handler is the deliberate escalation path: a user
  // looking at a recurring layout that keeps misdetecting can promote the
  // current document's reviewed values into a managed template (creating one,
  // or refreshing an existing one matched by logo), using the same field-
  // building logic confirm-review used to run unconditionally.
  ipcMain.handle('promote-to-template', async (_e, payload) => {
    requireRole('admin', 'edit');
    const { document_id, allValues, document_type_slug, supplier_name } = payload || {};
    if (!document_id || !allValues) {
      return { success: false, error: 'Missing document or field values' };
    }
    const db = getDb();
    const dtInfo = document_type_slug
      ? doctypes.getWithFields(db, document_type_slug)
      : null;
    // Authoritative guard (the renderer also blocks this): a template with no
    // resolvable document type is created field-less and its custom fields never
    // appear in the Template Manager. Require a real, known doc type.
    if (!dtInfo) {
      return { success: false, error: 'Select a document type before adding to Template Manager.' };
    }
    try {
      const result = await _upsertTemplate(ctx, db, document_id, {
        allValues, document_type_slug, supplier_name, dtInfo,
      });
      // Pin the promoted document as the template's sample so the template
      // editor, opened straight from here, has it loaded in the preview pane
      // (no second manual browse). This is the doc the admin just curated, so
      // it is the right representative sample.
      if (result.templateId) {
        templates.setSampleDocument(db, result.templateId, document_id);
      }
      return { success: true, ...result };
    } catch (e) {
      return { success: false, error: e.message };
    }
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
  if (!doc) throw new Error('Document not found');

  const logo_phash           = doc.logo_phash || null;
  const keyword_fingerprint  = _parseJson(doc.keyword_fingerprint, []);

  // Build template field rules from confirmed values
  const fields = _buildTemplateFields(db, allValues, dtInfo);

  // `doc.template_id` reflects whatever Stage 0 matched DURING PROCESSING —
  // which, for a freshly-scanned batch, runs before any of that batch's own
  // confirmations have created a template. Confirming document #1 creates
  // the supplier's first template; #2-#4 were OCR'd/matched against the
  // template list as it stood when the *batch* was processed (template_id
  // still null on each of them), even though a same-layout template now
  // exists by the time they're confirmed. Re-check by logo phash — the
  // strongest stable identity signal already in the system: position-
  // anchored, immune to per-document variable content (customer name,
  // invoice number, totals, dates), and compared with the exact same
  // Hamming-distance/confidence model and accept gate as Stage 0's logo
  // match (confidence >= 65 ⇔ distance <= 5 — see template_matcher.py
  // identify_template/_match_by_logo). findByLogoHash already existed in
  // templates.js as the JS-side mirror of that primitive but was unused —
  // wiring it in here converges repeats of the same supplier/layout onto
  // one template without loosening what counts as "the same" beyond what
  // Stage 0 already accepts.
  let templateId = doc.template_id || null;
  if (!templateId && logo_phash) {
    const reuse = templates.findByLogoHash(db, logo_phash);
    if (reuse && reuse.confidence >= 60) templateId = reuse.id;
  }

  if (templateId) {
    // Update existing (or now logo-matched) template. update() STABILISES the
    // stored identity across confirms (intersect-with-floor on the keyword
    // fingerprint; keep an established logo_phash) so one noisy sample's OCR
    // garble / per-document tokens can't poison Stage 0 matching and strand the
    // learned anchors — see templates.stabiliseFingerprint / chooseLogoPhash.
    templates.update(db, templateId, { logo_phash, keyword_fingerprint, fields });
    if (!doc.template_id) {
      db.prepare('UPDATE documents SET template_id = ? WHERE id = ?').run(templateId, document_id);
    }
    _writeTemplateFile(db, templateId, path, fs, templatesDir());
    const tmpl = templates.getById(db, templateId);
    return { created: false, templateId, name: tmpl?.name || null };
  } else {
    // Create new template — name from supplier + doc type
    const typeName  = document_type_slug
      ? document_type_slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      : 'Document';
    const name      = supplier_name
      ? `${supplier_name} ${typeName}`
      : `${typeName} Template`;

    const newTemplateId = templates.create(db, {
      name,
      document_type_slug: document_type_slug || null,
      logo_phash,
      keyword_fingerprint,
      fields,
    });

    // Link document to its new template
    db.prepare('UPDATE documents SET template_id = ? WHERE id = ?').run(newTemplateId, document_id);
    _writeTemplateFile(db, newTemplateId, path, fs, templatesDir());
    return { created: true, templateId: newTemplateId, name };
  }
}

// Fields proven VARIABLE by confirmed history: >=2 distinct final confirmed
// values for this doc-type (corrected value if the user edited, else the
// extracted one — the same "final value" getFieldFormats uses). Evidence that a
// field differs per document, regardless of the schema's variability guess.
function _fieldsWithMultipleConfirmedValues(db, dtInfo) {
  const out = new Set();
  if (!db || !dtInfo || !dtInfo.id) return out;
  try {
    const rows = db.prepare(`
      SELECT e.field_key AS k,
             COUNT(DISTINCT TRIM(COALESCE(c.corrected_value, e.display_value))) AS n
      FROM extractions e
      JOIN documents d ON d.id = e.document_id
      LEFT JOIN corrections c ON c.document_id = e.document_id AND c.field_key = e.field_key
      WHERE d.status = 'confirmed' AND d.document_type_id = ?
        AND TRIM(COALESCE(c.corrected_value, e.display_value)) != ''
      GROUP BY e.field_key
    `).all(dtInfo.id);
    for (const r of rows) if ((r.n || 0) >= 2) out.add(r.k);
  } catch { /* older schema -> fall back to the schema heuristic only */ }
  return out;
}

function _buildTemplateFields(db, allValues, dtInfo) {
  // A field is "variable" (differs per document — reference, date, and ALSO any
  // field the confirmed history shows taking multiple values) or "constant" for a
  // supplier (company name, address). The schema gives a first guess
  // (ref_field_key / date_field_key / type, via _annotateFieldVariability) but it
  // is INVOICE-CENTRIC: it treats any non-ref/non-date field as constant, which
  // wrongly FROZE a worksheet 'customer' to one stale value. So a field is frozen
  // (fixed_value) ONLY when the schema says constant AND confirmed history has NOT
  // shown it varying. The cost of a false "variable" is a harmless re-extract; a
  // false "fixed" commits a wrong value on every other document — so we bias to
  // variable. This self-heals an already-frozen field on the next confirm.
  // Variable fields get no anchor_label here — they are templated by the
  // user-taught ⊕ field-anchor tool (Stage 2) / drawn mappings (Stage 0.5),
  // which are coordinate-based and immune to text-substring collisions.
  const fieldMeta   = new Map((dtInfo?.fields || []).map(f => [f.key, f]));
  const multiValued = _fieldsWithMultipleConfirmedValues(db, dtInfo);

  return Object.entries(allValues)
    .filter(([, v]) => v && String(v).trim())
    .map(([key, value]) => {
      const meta = fieldMeta.get(key);
      const schemaVariable = meta ? !!meta.is_variable : true;
      const isVariable = schemaVariable || multiValued.has(key);
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
