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
  const previewService = require('../../services/previewService');
  const workflowService = require('../../services/workflowService');
  const { requireRole, requireLogin, hasRole, logAudit, getCurrentUser } = require('../auth/handler');
  // Shared in-process presence map (the "being reviewed by" signal) — the SAME instance the /v1
  // client API publishes to, so a desktop reviewer is visible to clients and vice-versa.
  const presence = require('../../services/presenceService').shared();
  const _desktopKey = (uid) => `desktop:${uid}`;

  // Transport-agnostic review orchestration — the SAME confirm/defer/restore the detached-client
  // /v1 API will call (Phase 3). The desktop injects its Electron-only steps as hooks so this
  // path stays byte-identical; auth + the workflow lock are enforced at the edge (requireUnlocked).
  const reviewService = require('../../services/reviewService').createReviewService({
    documents, learning, doctypes,
    filing: require('../filing/handler'),
    fs, path, logger,
    audit: (db, entry) => logAudit(db, entry),
    onScheduleSourceMove: (args) => _scheduleSourceMove(ctx, getDb(), documents, args),
    onTaughtConfirm: (db, docId, info) => _upsertTemplate(ctx, db, docId, info),
    captureSample: async (tId, docId) => {
      if (ctx.captureSampleWords) {
        await ctx.captureSampleWords(tId, docId);
        if (ctx.generateLandmarks) await ctx.generateLandmarks(tId);
      }
    },
    notifyCounts: (db) => {
      notifyMainWindow('review-count-changed',   documents.getReviewCount(db));
      notifyMainWindow('deferred-count-changed', documents.getDeferredCount(db));
    },
    releaseDelayMs: 150,
  });

  // ── Validation patterns (shared source of truth for UI field validation) ─────
  // The Review window validates an edited field on blur (regex/type) using the
  // EXACT same `validation_patterns` the Python extraction qualification uses
  // (config/keyword_patterns.json), so UI and pipeline can never drift apart — the
  // renderer compiles these literal strings to RegExp rather than re-authoring
  // them. Read once and cached; returns {} if the file is missing/unparseable so
  // the UI degrades gracefully (no validation rather than a crash).
  let _validationPatternsCache;
  ipcMain.handle('get-validation-patterns', () => {
    requireLogin();
    if (_validationPatternsCache === undefined) {
      try {
        const cfgFile = ctx.resourcePath('config', 'keyword_patterns.json');
        const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
        _validationPatternsCache = cfg.validation_patterns || {};
      } catch (e) {
        logger?.warn?.(`get-validation-patterns: ${e.message}`);
        _validationPatternsCache = {};
      }
    }
    return _validationPatternsCache;
  });

  // ── Built-in field label words (read-only, for the label-overrides UI) ───────
  // The shipped `field_patterns` own the canonical fields' detection words globally
  // (invoice_number, supplier_name, total_amount, …). The Settings → label-overrides
  // screen surfaces these per field so canonical types (invoice/sales order/etc., which
  // carry NO per-install overrides by design) still show their suggested words. Returns
  // { field_key: [labelText, …] }, flattening the string | {text,directions} label forms.
  let _fieldPatternLabelsCache;
  ipcMain.handle('get-field-patterns', () => {
    requireLogin();
    if (_fieldPatternLabelsCache === undefined) {
      try {
        const cfgFile = ctx.resourcePath('config', 'keyword_patterns.json');
        const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
        const out = {};
        for (const [key, def] of Object.entries(cfg.field_patterns || {})) {
          const labels = (def && def.labels) || [];
          out[key] = labels
            .map(l => (typeof l === 'string' ? l : (l && l.text) || ''))
            .filter(Boolean);
        }
        _fieldPatternLabelsCache = out;
      } catch (e) {
        logger?.warn?.(`get-field-patterns: ${e.message}`);
        _fieldPatternLabelsCache = {};
      }
    }
    return _fieldPatternLabelsCache;
  });

  // WORKFLOW_LOCK (Stage 5b): block a Review-pipeline mutation while the document
  // has an OPEN approval route, so the mailbox and the review/learning pipeline
  // can't both edit the same row. Admin may override (audited). Throws like
  // requireRole so the rejection crosses IPC; returns the actor's session.
  function requireUnlocked(db, docId, action) {
    const sess = requireRole('admin', 'edit');
    const guard = workflowService.editGuard(db, docId, sess.role);
    if (!guard.ok) throw Object.assign(new Error(guard.error), { code: guard.code });
    if (guard.overridden) {
      logAudit(db, { action: 'workflow_lock_overridden', action_category: 'workflow',
        target_type: 'document', target_id: docId, document_id: docId, outcome: 'success',
        metadata: { action } });
    }
    return sess;
  }

  // ── Queue queries ───────────────────────────────────────────────────────────
  // The review/deferred queues are the working-document workflow surface —
  // every action on them (edit, confirm, defer, reprocess) is Admin/Edit only,
  // so Read Only has no use for the queue contents either (their "view" role
  // is served by Search, which lists filed documents — see search/handler.js).
  // Type-ahead suggestions: distinct values already CONFIRMED for this field on this
  // document type (Review text fields, after 3 chars). Read-only; edit/admin gated.
  ipcMain.handle('get-field-suggestions', (_e, documentId, fieldKey) => {
    requireRole('admin', 'edit');
    try { return documents.getFieldValueSuggestions(getDb(), documentId, fieldKey); }
    catch (e) { logger?.warn?.(`get-field-suggestions: ${e.message}`); return []; }
  });

  ipcMain.handle('get-review-queue',  () => { requireRole('admin', 'edit'); return documents.getReviewQueue(getDb()); });
  ipcMain.handle('get-deferred-queue',() => { requireRole('admin', 'edit'); return documents.getDeferredQueue(getDb()); });
  ipcMain.handle('get-review-count',  () => { requireRole('admin', 'edit'); return documents.getReviewCount(getDb()); });
  ipcMain.handle('get-deferred-count',() => { requireRole('admin', 'edit'); return documents.getDeferredCount(getDb()); });

  // Advanced → "View learning history": list the confirmed values learned for a
  // (supplier, doc-type, field) scope, and purge a value that shouldn't exist for the field
  // (e.g. a drift artifact like "Booking" on a reference field) so it stops polluting the
  // learned shape/hints. Admin/edit only; purge is audited.
  ipcMain.handle('get-field-value-history', (_e, scope) => {
    requireRole('admin', 'edit');
    return learning.getFieldValueHistory(getDb(), scope || {});
  });
  ipcMain.handle('purge-field-value', (_e, scope) => {
    requireRole('admin', 'edit');
    const db = getDb();
    const removed = learning.purgeFieldValue(db, scope || {});
    try {
      logAudit(db, { action: 'learning_value_purged', action_category: 'learning',
        outcome: 'success', metadata: { ...(scope || {}), removed } });
    } catch {}
    return { removed };
  });
  // Saved field rules (read-only) — lets the Review right-click menu reflect a persisted
  // rule (e.g. show "wrapping is on" for a field that already has a multiline_continue rule).
  ipcMain.handle('get-field-rules', () => {
    requireRole('admin', 'edit');
    return learning.getFieldRules(getDb());
  });

  // Recently AUTO-FILED (100%-confidence) docs, so the Review window can offer "X auto-committed
  // — view them" and re-surface them (now confirmed) for checking/editing. Backed by the rolling
  // recent_auto_filed setting written by processing/handler._recordAutoFiled.
  ipcMain.handle('get-recent-auto-filed', () => {
    requireRole('admin', 'edit');
    const db = getDb();
    let ids = [];
    try {
      const o = JSON.parse(learning.getSetting(db, 'recent_auto_filed', '') || 'null');
      if (o && Array.isArray(o.ids) && (!o.at || (Date.now() - o.at) <= 7 * 864e5)) ids = o.ids;
    } catch {}
    const docs = ids.length ? documents.getByIds(db, ids) : [];
    return { count: docs.length, docs };
  });
  ipcMain.handle('clear-recent-auto-filed', () => {
    requireRole('admin', 'edit');
    try { learning.setSetting(getDb(), 'recent_auto_filed', JSON.stringify({ ids: [], at: Date.now() })); } catch {}
    return { ok: true };
  });
  ipcMain.handle('rename-field-value', (_e, scope) => {
    requireRole('admin', 'edit');
    const db = getDb();
    const changed = learning.renameFieldValue(db, scope || {});
    try {
      logAudit(db, { action: 'learning_value_renamed', action_category: 'learning',
        outcome: 'success', metadata: { ...(scope || {}), changed } });
    } catch {}
    return { changed };
  });

  // get-document-with-extractions / get-document-pages are shared with the
  // Search window (Read Only previews filed documents there too) — gate to
  // "any signed-in user", not a specific role.
  ipcMain.handle('get-document-with-extractions', (_e, id) => {
    const sess = requireLogin();
    const db  = getDb();
    // Pure data assembly (doc + extractions + resolved slug + digit-only fields)
    // lives in the shared service so a detached client can reuse it; auth + audit
    // stay here at the transport edge.
    const doc = previewService.getDocumentDetail(db, id, { learning });
    if (doc) {
      logAudit(db, { action: 'document_open', target_type: 'document', target_id: id,
        document_id: id, outcome: 'success', metadata: { type: doc.type_slug || null, status: doc.status || null } });
      // Publish desktop REVIEW presence so clients see "being reviewed by <name>" — only for a
      // review-able doc opened by a reviewer (NOT a read-only Search preview of a filed doc).
      // A single heartbeat (TTL-expiring); the renderer refreshes it while the doc stays open.
      if ((doc.status === 'needs_review' || doc.status === 'deferred') && (sess.role === 'admin' || sess.role === 'edit')) {
        presence.heartbeat(id, { key: _desktopKey(sess.id), username: sess.username, displayName: sess.displayName || sess.username });
      }
    }
    return doc;
  });

  // Renderer-driven presence refresh: the open Review window beats every ~25s so a desktop
  // reviewer stays visible to clients past the 60s TTL while they work. Cheap in-process call;
  // any signed-in reviewer, review-able doc only.
  ipcMain.handle('review-heartbeat', (_e, id) => {
    try {
      const sess = requireLogin();
      if (!(sess.role === 'admin' || sess.role === 'edit')) return false;
      const row = documents.getById(getDb(), id);
      if (row && (row.status === 'needs_review' || row.status === 'deferred')) {
        presence.heartbeat(id, { key: _desktopKey(sess.id), username: sess.username, displayName: sess.displayName || sess.username });
        return true;
      }
    } catch { /* not logged in / gone */ }
    return false;
  });

  // Document close — the Review window fires this when it navigates away from a
  // document or the window is closed. Completes the open/close audit pair.
  ipcMain.on('notify-doc-closed', (_e, docId) => {
    if (docId == null) return;
    try { logAudit(getDb(), { action: 'document_close', target_type: 'document', target_id: docId,
      document_id: docId, outcome: 'success' }); } catch {}
    // Drop this desktop reviewer's presence immediately (the TTL is the backstop).
    try { const u = getCurrentUser(); if (u) presence.release(docId, _desktopKey(u.id)); } catch {}
  });

  // ── Document pages for preview ──────────────────────────────────────────────
  ipcMain.handle('get-document-pages', async (_e, docId, folderPath, filename, scale) => {
    requireLogin();
    if (!folderPath || !filename) {
      console.log(`[pages] docId=${docId} missing path — folderPath=${folderPath} filename=${filename}`);
      return [];
    }
    const sourcePath = path.join(folderPath, filename);

    // A new document loading is our signal that the previous one's preview
    // has moved on — fire any deferred source-file move now (unless, oddly,
    // it's pending removal of the very file we're about to load). This is a
    // Review-window filing concern and stays here, not in the shared service.
    if (_pendingSourceMove && _pendingSourceMove.srcPath !== sourcePath) {
      _runPendingSourceMove(ctx, 'next document loaded');
    }

    // Transport-agnostic page render lives in the shared service so the detached
    // client can reuse it; Electron collaborators are injected via deps.
    return previewService.getDocumentPages(getDb(), { docId, folderPath, filename, scale }, {
      fs, path, spawn, pythonExe, pythonArgs,
      renderScript: ctx.resourcePath('python_backend', 'render', 'pages.py'),
    });
  });

  // ── Small page-1 thumbnail for the document lists + add-template picker ──────
  ipcMain.handle('get-document-thumbnail', async (_e, docId, folderPath, filename) => {
    requireLogin();
    if (!folderPath || !filename) return null;
    return previewService.getThumbnail(getDb(), { docId, folderPath, filename }, {
      fs, path, spawn, pythonExe, pythonArgs,
      renderScript: ctx.resourcePath('python_backend', 'render', 'pages.py'),
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
    const db = getDb();
    const sess = requireUnlocked(db, docId, 'defer');
    return reviewService.defer(db, { username: sess.username, role: sess.role }, docId).ok;
  });

  ipcMain.handle('restore-deferred', (_e, docId) => {
    const db = getDb();
    const sess = requireUnlocked(db, docId, 'restore');
    return reviewService.restore(db, { username: sess.username, role: sess.role }, docId).ok;
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
  // Delete is now a SOFT delete → the document goes to the RECYCLE BIN (status='deleted',
  // recoverable; files are KEPT). Permanent removal is the separate purge below.
  ipcMain.handle('delete-document', async (_e, docId /*, filePath */) => {
    requireRole('admin', 'edit');
    const db = getDb();
    requireUnlocked(db, docId, 'delete'); // blocked while under an open approval route
    documents.softDelete(db, docId);
    logAudit(db, { action: 'document_deleted', action_category: 'document', target_type: 'document',
      target_id: docId, document_id: docId, outcome: 'success', metadata: { soft: true } });
    notifyMainWindow('review-count-changed',   documents.getReviewCount(db));
    notifyMainWindow('deferred-count-changed', documents.getDeferredCount(db));
    return true;
  });

  // Recycle bin: list, restore, and permanently remove deleted documents.
  ipcMain.handle('get-deleted-queue', () => { requireRole('admin', 'edit'); return documents.getDeletedQueue(getDb()); });

  ipcMain.handle('restore-document', (_e, docId) => {
    requireRole('admin', 'edit');
    const db = getDb();
    documents.restoreDeleted(db, docId);
    logAudit(db, { action: 'document_restored', action_category: 'document', target_type: 'document',
      target_id: docId, document_id: docId, outcome: 'success' });
    notifyMainWindow('review-count-changed',   documents.getReviewCount(db));
    notifyMainWindow('deferred-count-changed', documents.getDeferredCount(db));
    return true;
  });

  // Permanent removal (irreversible) — admin only. Unlinks the filed file + the app's
  // working copy, then deletes the row. `purge-all-deleted` empties the whole bin.
  function _purgeOne(db, docId) {
    const doc = documents.getById(db, docId);
    if (!doc) return;
    for (const p of [documents.resolveFilePath(doc), doc.working_path]) {
      if (p && fs.existsSync(p)) { try { fs.unlinkSync(p); } catch (e) { console.warn('purge unlink:', p, e.message); } }
    }
    documents.deleteDoc(db, docId);
  }
  ipcMain.handle('purge-document', (_e, docId) => {
    requireRole('admin');
    const db = getDb();
    _purgeOne(db, docId);
    logAudit(db, { action: 'document_purged', action_category: 'document', target_type: 'document',
      target_id: docId, document_id: docId, outcome: 'success' });
    return true;
  });
  ipcMain.handle('purge-all-deleted', () => {
    requireRole('admin');
    const db = getDb();
    const ids = documents.getDeletedQueue(db).map(d => d.id);
    for (const id of ids) _purgeOne(db, id);
    logAudit(db, { action: 'recycle_bin_emptied', action_category: 'document', target_type: 'document',
      outcome: 'success', metadata: { count: ids.length } });
    return { purged: ids.length };
  });

  // ── Bulk delete of a whole queue (Admin only) ───────────────────────────────
  // Permanent deletion of scanned documents is Admin-exclusive, like the
  // single-doc delete above. Each helper is scoped to exactly one status so it
  // can never reach confirmed documents; source files are unlinked best-effort
  // first, then the rows (and their cascaded extractions) are removed in one
  // statement. Returning the deleted count lets the renderer report it.
  function _deleteQueue(status, rows, countEvent) {
    const db = getDb();
    let n = 0;
    for (const r of rows) { documents.softDelete(db, r.id); n++; }   // → recycle bin (recoverable; files kept)
    notifyMainWindow(countEvent, status === 'needs_review'
      ? documents.getReviewCount(db) : documents.getDeferredCount(db));
    return { success: true, deleted: n };
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
    const db = getDb();
    // Multi-point licensing enforcement (F-01): filing a confirmed document is a high-value
    // write path. Re-check the cached license verdict here (network-free) so neutralising the
    // single startup gate does not silently re-enable confirms.
    const licenseDenial = require('../licensing/handler').licenseDenied(db);
    if (licenseDenial) {
      return { success: false, error: 'A valid license is required to file documents. Please re-activate ScanFinder.', ...licenseDenial };
    }
    // requireUnlocked enforces Admin/Edit + the workflow lock at the edge and returns the actor;
    // the shared reviewService does the claim-before-file, filing, learning and cleanup so the
    // desktop and the /v1 client API file documents through ONE race-safe path.
    const sess = requireUnlocked(db, payload.document_id, 'confirm');
    const r = await reviewService.confirm(db, { username: sess.username, role: sess.role }, payload);
    if (!r.ok) {
      return { success: false, error: r.error,
               ...(r.code ? { code: r.code } : {}),
               ...(r.confirmedBy ? { confirmedBy: r.confirmedBy } : {}) };
    }
    return r;   // { ok:true, success:true, ...filingResult }
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
        // Derive registration landmarks from the just-pinned sample (best-effort), so a
        // teach-created template gets the SAME drift correction as every other pin path
        // (set-template-sample / import-sample). Without this, teach templates had no
        // landmarks -> registration inert -> a mapping box drifts onto the wrong row
        // (the "90 Galaorm Road 7" case). Never blocks the commit; generateLandmarks
        // resolves (never rejects) and the template still works via anchors meanwhile.
        try { if (ctx.generateLandmarks) await ctx.generateLandmarks(result.templateId); }
        catch (e) { console.error('promote-to-template landmarks:', e.message); }
        // Same for the keyword FINGERPRINT — a teach-promoted born-digital template
        // (whose sample doc may have an empty stored ocr_text) would otherwise be born
        // fingerprint-less and only matchable by an unreliable logo phash. Fills only
        // when empty; best-effort, never blocks the commit.
        try { if (ctx.generateFingerprint) await ctx.generateFingerprint(result.templateId); }
        catch (e) { console.error('promote-to-template fingerprint:', e.message); }
      }
      return { success: true, ...result };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // "This is like another document" (Review CTA): the operator says an unmatched doc
  // belongs with an EXISTING template. Create a template for this doc (reusing the same
  // promote machinery — sample pin, landmarks, fingerprint), then put both templates in
  // ONE group so they share learning (engine.select_mapping_source borrows a grouped
  // sibling's mappings). The renderer reprocesses the doc afterwards so it picks the
  // group up immediately. Idempotent: if this doc's logo already matched the target, no
  // duplicate is made and grouping is a no-op.
  ipcMain.handle('link-document-to-template', async (_e, payload) => {
    requireRole('admin', 'edit');
    const { document_id, allValues, document_type_slug, supplier_name, target_template_id } = payload || {};
    if (!document_id || !allValues || !target_template_id) {
      return { success: false, error: 'Missing document or target template.' };
    }
    const db = getDb();
    const target = templates.getById(db, target_template_id);
    if (!target) return { success: false, error: 'That template no longer exists.' };
    const dtInfo = document_type_slug ? doctypes.getWithFields(db, document_type_slug) : null;
    if (!dtInfo) return { success: false, error: 'Select a document type before linking.' };
    try {
      // 1) Create (or logo-reuse) a template for THIS document.
      const result = await _upsertTemplate(ctx, db, document_id, {
        allValues, document_type_slug, supplier_name, dtInfo,
      });
      const newId = result.templateId;
      // Only pin/derive on a genuinely NEW template — never disturb an existing one's sample.
      if (newId && result.created) {
        templates.setSampleDocument(db, newId, document_id);
        try { if (ctx.generateLandmarks)  await ctx.generateLandmarks(newId); }  catch (e) { console.error('link landmarks:', e.message); }
        try { if (ctx.generateFingerprint) await ctx.generateFingerprint(newId); } catch (e) { console.error('link fingerprint:', e.message); }
      }
      // 2) Put both templates in the SAME group (reuse the target's group, else make one).
      let groupId = target.group_id || null;
      if (!groupId) {
        groupId = templates.createGroup(db, (target.name || supplier_name || 'Group').toString());
        templates.setTemplateGroup(db, target_template_id, groupId);
      }
      if (newId && newId !== target_template_id) templates.setTemplateGroup(db, newId, groupId);
      return { success: true, templateId: newId, groupId, name: result.name, targetName: target.name };
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
  // Reuse decision, in order of safety (migration 26 multi-reference phash):
  //   1. STRICT — nearest stored hash within dist<=6 (conf>=60): exact Stage-0
  //      parity, always safe.
  //   2. CONVERGENCE (7-13 band) — a phash drifted past the strict gate but within
  //      the matcher candidate net, of the SAME doc-type, with strong keyword
  //      corroboration (>=60% overlap) is the same supplier whose render drifted.
  //      Reuse so update() APPENDS the drifted hash and the reference set converges
  //      — instead of spawning a near-duplicate template. Same-slug + keyword floor
  //      keep this from merging two different suppliers with similar logos.
  let templateId = doc.template_id || null;
  if (!templateId && logo_phash) {
    const reuse = templates.findByLogoHash(db, logo_phash);   // min over the hash set
    if (reuse && reuse.confidence >= 60) {
      templateId = reuse.id;
    } else if (reuse && reuse.match_distance <= 13
               && document_type_slug && reuse.document_type_slug === document_type_slug
               && templates.keywordOverlap(keyword_fingerprint, _parseJson(reuse.keyword_fingerprint, [])) >= 0.60) {
      templateId = reuse.id;
    }
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
    // Name the template after the Document Issuer value (e.g. "Beaumont Care Homes") so
    // it's instantly recognisable in Template Manager. A supplier that sends several
    // layouts gets several same-named templates — that's fine, the slug stays unique
    // (templates.create suffixes it). Falls back to the doc-type name when there's no
    // issuer value (e.g. a customer-identity type read nothing).
    const typeName  = document_type_slug
      ? document_type_slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      : 'Document';
    const name      = (supplier_name && supplier_name.trim())
      ? supplier_name.trim()
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
