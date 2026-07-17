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
    onScopeGraduated: (db, docId, info) => _maybeGraduationTemplate(ctx, db, docId, info),
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
    // releaseDelayMs stays 0 (the default): the old 150ms "release the preview file handle" wait
    // before filing was vestigial — the preview is an in-memory data URL, not an OS handle, and the
    // source-file delete is already deferred + retry-guarded — so it only added confirm latency
    // (eric/Oracle-verified). The renderer's twin 150ms was removed too. See reviewService.confirm.
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
  // Source documents behind a learned value (Learning-history → "Open in Review"). Read-only.
  ipcMain.handle('get-documents-for-field-value', (_e, scope) => {
    requireRole('admin', 'edit');
    return learning.getDocumentsForFieldValue(getDb(), scope || {});
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
  // Learned ANCHORS for a (supplier, doc-type, field) scope — the "learned anchors" panel in the
  // learning history, so an operator can SEE where a field reads from. Read-only.
  ipcMain.handle('get-anchors-for-scope', (_e, scope) => {
    requireRole('admin', 'edit');
    return learning.getAnchorsForScope(getDb(), scope || {});
  });
  // Which fields have a learned anchor for a (supplier, doc-type) scope — powers the Review per-field
  // "position taught" dot. Read-only; returns [] on any error so the indicator can never break render.
  ipcMain.handle('get-taught-field-keys', (_e, scope) => {
    requireRole('admin', 'edit');
    try { return learning.getTaughtFieldKeys(getDb(), scope || {}); } catch { return []; }
  });
  // How many CONFIRMED docs already exist for a (supplier, doc-type) scope. Drives the Review
  // renderer's live suppression of the stale "heading names a type that doesn't match this
  // supplier's saved layout" note: once ONE doc of that type is confirmed for the supplier, the
  // type IS valid for them and the (already-stored) note is out of date. Forgiving supplier match
  // (getConfirmedDocsForScope uses LIKE) so a slightly-garbled variant still counts.
  ipcMain.handle('scope-confirmed-count', (_e, scope) => {
    requireRole('admin', 'edit');
    const { supplier_name, document_type_slug } = scope || {};
    if (!document_type_slug) return 0;
    try { return documents.getConfirmedDocsForScope(getDb(), { supplier_name, document_type_slug }).length; }
    catch { return 0; }
  });
  // Delete ONE mis-stored learned anchor (learning-history → 🗑). Admin/edit; audited.
  ipcMain.handle('delete-field-anchor', (_e, payload) => {
    requireRole('admin', 'edit');
    const db = getDb();
    const id = payload && payload.id;
    const { removed } = learning.deleteAnchor(db, id);
    try {
      logAudit(db, { action: 'learning_anchor_deleted', action_category: 'learning',
        outcome: removed ? 'success' : 'noop', metadata: { anchor_id: id, ...(payload || {}), removed } });
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

  // Batch auto-file eligibility for the renderer Reprocess-All path — the SAME predicate the
  // backend import path uses (scope graduation floor + structural safety gate), decided
  // server-side with getFieldFormats scanned ONCE. Keeps the two auto-file sites from drifting.
  ipcMain.handle('get-auto-file-eligible', (_e, docIds) => {
    requireRole('admin', 'edit');
    const db = getDb();
    const trust = require('../../../database/modules/trust');
    const rows = (Array.isArray(docIds) ? docIds : []).map(id => documents.getById(db, id)).filter(Boolean);
    return { ids: trust.autoFileEligibleIds(db, rows) };
  });

  // Graduation roster + per-supplier opt-out (Slice 5 UX — the "Suppliers handled automatically"
  // controls). Admin/edit gated like the rest of the review admin surface.
  ipcMain.handle('get-graduated-suppliers', () => {
    requireRole('admin', 'edit');
    const trust = require('../../../database/modules/trust');
    return { scopes: trust.listGraduatedScopes(getDb()) };
  });
  ipcMain.handle('set-graduation-optout', (_e, p) => {
    requireRole('admin', 'edit');
    if (!p || !p.supplier || !p.slug) return { ok: false };
    const trust = require('../../../database/modules/trust');
    trust.setScopeOptOut(getDb(), p.supplier, p.slug, !!p.optedOut);
    return { ok: true };
  });
  // Operator marks a flagged NAME value as valid ("This name is correct" button on a
  // wordness-flagged supplier/customer field). Adds the exact value to the accepted-names
  // allowlist so the wordness/truncation flags skip it on EVERY future doc, and clears the
  // name flag on THIS doc's field so it stops nagging immediately. Durable effect is the
  // allowlist (fed to the engine via buildTrainingArgs); the note-clear is live UX.
  ipcMain.handle('accept-name-value', (_e, p) => {
    requireRole('admin', 'edit');
    const db = getDb();
    const value = p && typeof p.value === 'string' ? p.value.trim() : '';
    if (!value) return { ok: false, error: 'empty-value' };
    const list = learning.addAcceptedName(db, value);
    // Clear only a NAME-related flag on the current doc's field (leave e.g. an identity-conflict
    // note intact). The wordness/truncation notes all speak to "reads like a name".
    let cleared = 0;
    if (p.docId && p.fieldKey) {
      const row = db.prepare('SELECT validation_note FROM extractions WHERE document_id = ? AND field_key = ?')
        .get(p.docId, p.fieldKey);
      const note = row && String(row.validation_note || '');
      if (note && /read like a name|reference\/code, not a name|document heading, not a name|truncat|cut off/i.test(note)) {
        cleared = db.prepare('UPDATE extractions SET validation_note = NULL WHERE document_id = ? AND field_key = ?')
          .run(p.docId, p.fieldKey).changes;
      }
    }
    try {
      logAudit(db, { action: 'name_value_accepted', action_category: 'learning',
        outcome: 'success', metadata: { value, field_key: p.fieldKey || null, doc_id: p.docId || null, cleared } });
    } catch {}
    return { ok: true, accepted: list, cleared };
  });
  // Operator marks a resolved issuer as CORRECT ("Issuer is correct" button on an identity-
  // conflict flag). Adds the resolved supplier to the issuer allowlist so the conflict flag
  // skips it on EVERY future doc (the explicit, one-click complement to the automatic
  // "established after N confirmations" fallback), and clears the identity-conflict note on
  // THIS doc's identity field so it stops nagging immediately.
  ipcMain.handle('accept-issuer', (_e, p) => {
    requireRole('admin', 'edit');
    const db = getDb();
    const value = p && typeof p.value === 'string' ? p.value.trim() : '';
    if (!value) return { ok: false, error: 'empty-value' };
    const list = learning.addAcceptedIssuer(db, value);
    // Clear only the identity-conflict note ("confirm the issuer") on the current doc's field.
    let cleared = 0;
    if (p.docId && p.fieldKey) {
      const row = db.prepare('SELECT validation_note FROM extractions WHERE document_id = ? AND field_key = ?')
        .get(p.docId, p.fieldKey);
      const note = row && String(row.validation_note || '');
      if (note && /letterhead may read|confirm the issuer/i.test(note)) {
        cleared = db.prepare('UPDATE extractions SET validation_note = NULL WHERE document_id = ? AND field_key = ?')
          .run(p.docId, p.fieldKey).changes;
      }
    }
    try {
      logAudit(db, { action: 'issuer_accepted', action_category: 'learning',
        outcome: 'success', metadata: { value, field_key: p.fieldKey || null, doc_id: p.docId || null, cleared } });
    } catch {}
    return { ok: true, accepted: list, cleared };
  });
  // "Use '<name>'" resolve → the operator supplier PIN (Part B). Writes documents.supplier_pin so a
  // REPROCESS forces this supplier (--known-supplier) instead of reverting to the coarse-logo pick. Local
  // to the doc — writes NO logo/hint learning; the pin is cleared on confirm (documents.confirm). The
  // engine keeps a pinned read REVIEW-BOUND (method 'operator_pin' + note). Admin/edit; audited.
  ipcMain.handle('resolve-issuer', (_e, p) => {
    requireRole('admin', 'edit');
    const db = getDb();
    const value = p && typeof p.value === 'string' ? p.value.trim() : '';
    const docId = p && p.docId;
    if (!value || !docId) return { ok: false, error: 'missing-value-or-doc' };
    let changed = 0;
    try { changed = db.prepare('UPDATE documents SET supplier_pin = ? WHERE id = ?').run(value, docId).changes; }
    catch (e) { return { ok: false, error: e.message }; }
    try {
      logAudit(db, { action: 'supplier_resolved', action_category: 'learning',
        outcome: 'success', metadata: { value, doc_id: docId } });
    } catch {}
    return { ok: true, changed };
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
      `SELECT d.template_id, d.logo_phash, d.ocr_text, dt.slug AS document_type_slug
         FROM documents d
         LEFT JOIN document_types dt ON dt.id = d.document_type_id
        WHERE d.id = ?`
    ).get(documentId);
    if (!doc || doc.template_id) return { matched: false };

    // TYPE-SCOPED recheck: only a template of THIS document's own type counts as
    // "available". Without this the check is type-blind and matches a same-logo
    // sibling of a different type (a Sales Order template on an Invoice), which both
    // misreports "Template available" AND suppresses the Teach-this-document CTA, so
    // the operator can't create the genuinely-missing same-type template. Mirrors
    // the Python identify_template type refusal. Null slug (untyped doc) = unscoped.
    const match = templates.identifyByFingerprint(db, {
      logo_phash: doc.logo_phash,
      ocr_text:   doc.ocr_text,
      document_type_slug: doc.document_type_slug,
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
  // Templates are not auto-created on every confirm, with TWO exceptions: an explicit ⊕/wizard
  // TEACH (onTaughtConfirm), and ONCE at scope GRADUATION (onScopeGraduated → _maybeGraduationTemplate
  // → graduationTemplate.js) so a graduated supplier's sub-100 docs can auto-file. Automatic learning
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

module.exports = { register, _buildTemplateFields, _upsertTemplate };   // _buildTemplateFields + _upsertTemplate exported for tests (test_build_template_fields.js, test_upsert_type_link.js)

// ── Template create / update ──────────────────────────────────────────────────

async function _upsertTemplate(ctx, db, document_id, { allValues, document_type_slug, supplier_name, dtInfo }) {
  const { path, fs, templatesDir } = ctx;
  const templates = require('../../../database/modules/templates');

  // Read document record for stored logo_phash and keyword_fingerprint
  const doc = db.prepare(
    'SELECT template_id, logo_phash, logo_detail_hash, keyword_fingerprint FROM documents WHERE id = ?'
  ).get(document_id);
  if (!doc) throw new Error('Document not found');

  const logo_phash           = doc.logo_phash || null;
  const logo_detail_hash     = doc.logo_detail_hash || null;   // Slice B: isolated-mark discriminator, enrolled into the template set
  const keyword_fingerprint  = _parseJson(doc.keyword_fingerprint, []);

  // Build template field rules from confirmed values
  const fields = _buildTemplateFields(db, allValues, dtInfo);

  // The Document-Issuer value the operator CONFIRMED for this doc. COLD extraction reads no
  // supplier, so the `supplier_name` param is empty at a supplier's FIRST confirm even though the
  // user just typed the issuer in Review — fall back to the confirmed field values (allValues,
  // string-keyed by field_key), where the identity field carries it. This is what lets a template
  // be NAMED after its issuer ("City Office NI") instead of the generic "<Type> Template".
  const confirmedIssuer = String(
    (supplier_name && supplier_name.trim())
    || (allValues && allValues.supplier_name)
    || (allValues && allValues.customer_name)
    || ''
  ).trim();

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
  // Part D (TYPE-heading authority) — DETACH a WRONG-TYPE Stage-0 link before reuse. doc.template_id
  // reflects whatever Stage 0 matched during processing, which for a same-logo supplier can be a
  // SIBLING OF THE WRONG TYPE (a worksheet logo-matched to the delivery-note template). Confirming
  // as-is runs templates.update() on that wrong-type template — reinforcing it — and NEVER borns the
  // correct-type one, so the cluster never separates (root cause #3, self-reinforcing; it is why no
  // worksheet template with a logo is ever created). If the linked template's slug is PRESENT and
  // DIFFERS from the type the operator CONFIRMED, drop the link so the type-scoped reuse/create below
  // re-points the doc to a RIGHT-type template carrying this doc's logo. Detach ONLY on a real slug
  // mismatch — a legacy null-slug template stays attached (Oracle C4b). Kill switch TEMPLATE_TYPE_LINK_GUARD.
  let retypedLink = false;
  if (templateId && process.env.TEMPLATE_TYPE_LINK_GUARD !== '0') {
    const linked = templates.getById(db, templateId);
    const linkedSlug = linked && linked.document_type_slug;
    if (linkedSlug && document_type_slug && linkedSlug !== document_type_slug) {
      templateId = null;
      retypedLink = true;
    }
  }
  if (!templateId && logo_phash) {
    // TYPE-SCOPED reuse: a template is per (supplier, TYPE), and a supplier issuing several types on
    // one letterhead has same-logo siblings — so reusing the nearest logo BLINDLY would fold e.g. an
    // Invoice into the Sales Order template (wrong-type mapping). Scope the candidate set to this
    // document's own type, matching Stage 0's type precedence. Same-type-only means the STRICT branch
    // is now safe too, not just the convergence branch's explicit slug check (kept for clarity).
    const reuse = templates.findByLogoHash(db, logo_phash, 13, document_type_slug);   // min over the hash set, same-type only
    if (reuse && reuse.confidence >= 60) {
      templateId = reuse.id;
    } else if (reuse && reuse.match_distance <= 13
               && document_type_slug && reuse.document_type_slug === document_type_slug
               && templates.keywordOverlap(keyword_fingerprint, _parseJson(reuse.keyword_fingerprint, [])) >= 0.60) {
      templateId = reuse.id;
    }
  }

  // M2 — BRANDING-FINGERPRINT REUSE (docs/designs/TEMPLATE_CONVERGENCE_2026-07-17.md; kill switch
  // TEMPLATE_REUSE_BY_BRANDING, DEFAULT OFF => byte-identical). On scans the coarse logo phash drifts
  // past the accept band (measured up to 36 Hamming for the SAME supplier), so the logo arms above miss
  // a drifted doc's own template and the CREATE branch below spawns a DUPLICATE (the fragmentation birth
  // path). Reuse the canonical SAME-TYPE template identified by DISTINCTIVE branding tokens instead
  // (measured 0% cross-supplier false-match at 0.80). Placed under `!templateId` (NOT nested in the
  // logo_phash guard) so it also converges logo-LESS suppliers (Oracle cond 3). The far-drifted logo is
  // NOT folded into the reused template's set — update()'s append stays bounded at LOGO_APPEND_BAND=13.
  if (!templateId && process.env.TEMPLATE_REUSE_BY_BRANDING === '1') {
    const bg = templates.findByBrandingFingerprint(db, keyword_fingerprint, document_type_slug, 0.80);
    if (bg) templateId = bg.id;
  }

  if (templateId) {
    // Update existing (or now logo-matched) template. update() STABILISES the
    // stored identity across confirms (intersect-with-floor on the keyword
    // fingerprint; keep an established logo_phash) so one noisy sample's OCR
    // garble / per-document tokens can't poison Stage 0 matching and strand the
    // learned anchors — see templates.stabiliseFingerprint / chooseLogoPhash.
    templates.update(db, templateId, { logo_phash, logo_detail_hash, keyword_fingerprint, fields });
    // Heal a junk/generic auto-name (WIDENED 2026-07-10): a template created at a supplier's
    // FIRST confirm inherits whatever sat in the issuer field — a COLD confirm births
    // "<Type> Template", and a WRONG first detection births a postcode ("BT23 1BE") or a bare
    // caption word ("Ref") that the old generic-only heal never touched. A later confirm of
    // the SAME template carrying a PLAUSIBLE issuer now also heals those non-name shapes
    // (templates.shouldAdoptIssuerName — plausibility-gated both ways, postcode + caption-word
    // shapes, generic "… Template"). A plausible hand-edited or previously-adopted name is
    // NEVER touched, so the heal can't flip-flop between issuer variants. Cosmetic (the name
    // plays no role in matching/filing/learning-scope).
    if (confirmedIssuer) {
      const cur = templates.getById(db, templateId);
      if (cur && templates.shouldAdoptIssuerName(cur.name, confirmedIssuer)) {
        try { templates.rename(db, templateId, confirmedIssuer); } catch {}
      }
    }
    // Relink when the doc had no template, OR when Part D detached a wrong-type link and the
    // type-scoped reuse found a RIGHT-type template to converge onto (Oracle C4a).
    if (!doc.template_id || retypedLink) {
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
    const name      = confirmedIssuer || `${typeName} Template`;

    const newTemplateId = templates.create(db, {
      name,
      document_type_slug: document_type_slug || null,
      logo_phash,
      logo_detail_hash,
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
  const { isNameLikeField } = require('../../../database/modules/learning');
  const { COMPANY_KEYS }    = require('../../../database/modules/document_types');
  const companyKeys = COMPANY_KEYS || ['supplier_name'];
  const fieldMeta   = new Map((dtInfo?.fields || []).map(f => [f.key, f]));
  const multiValued = _fieldsWithMultipleConfirmedValues(db, dtInfo);

  // (A) OWN-TYPE FILTER (gary/Oracle): only build a field the template's OWN doc type actually has,
  // so a cross-type LEAK — a foreign field carried in allValues because a shared-logo wrong-type
  // template got confirmed (observed: a Worksheet 'custom_customer_name' polluting a PO template) —
  // can't pollute this template. Keep-all fallback when the type has no field metadata (mirrors
  // graduationTemplate._variableOnlyFields). Never drop the issuer or the type's ref/date role keys,
  // even if `fields` is malformed (defensive — those are load-bearing for filing).
  const roleKeys = new Set([...companyKeys, dtInfo?.ref_field_key, dtInfo?.date_field_key].filter(Boolean));
  const ownField = (key) => fieldMeta.size === 0 || fieldMeta.has(key) || roleKeys.has(key);

  return Object.entries(allValues)
    .filter(([key, v]) => v && String(v).trim() && ownField(key))
    .map(([key, value]) => {
      const meta = fieldMeta.get(key);
      const schemaVariable = meta ? !!meta.is_variable : true;
      // (B) NEVER FREEZE a non-issuer NAME-LIKE field (gary/Oracle). A recipient/customer name is
      // per-document; freezing it stamps ONE name onto every matching doc (template_fixed @95 — the
      // "Primrose Childcare"/"Aldermoor" bug). Only the ISSUER (companyKeys/supplier_name) is
      // legitimately constant for a supplier template; a genuinely-constant NON-name field (VAT,
      // terms) still freezes. An admin who truly wants a name fixed sets it via Template Manager
      // (fixed_locked, preserved by _upsertFields). ACCEPTED TRADE-OFF (pinned in the test): a
      // genuinely-constant recipient name is re-extracted / may route to review rather than frozen —
      // fail-toward-review, never a silent stamped value; do NOT restore the freeze "for recall".
      const recipientName = isNameLikeField(key, meta && meta.label) && !companyKeys.includes(key);
      const isVariable = schemaVariable || multiValued.has(key) || recipientName;
      return {
        field_key:    key,
        anchor_label: null,
        direction:    'right',
        fixed_value:  isVariable ? null : String(value).trim(),
        is_variable:  isVariable,
      };
    });
}

// Graduation auto-template (Electron caller of the pure database/modules/graduationTemplate.js).
// The pure module decides + does the DB create/link (synchronous, atomic on the single main loop);
// this wrapper adds the Electron-only follow-ups AFTER the create commits: the debug template-file
// write, pinning the graduating doc as the sample, and the Python landmark/fingerprint enrichment
// (mirrors promote-to-template). All best-effort — it runs detached, after the user's confirm has
// already returned, and must never throw. See graduationTemplate.js for the Oracle conditions.
async function _maybeGraduationTemplate(ctx, db, document_id, info) {
  const graduation = require('../../../database/modules/graduationTemplate');
  const templates  = require('../../../database/modules/templates');
  const { path, fs, templatesDir } = ctx;

  const decision = graduation.decide(db, document_id, info);
  if (!decision || decision.action === 'skip') return;
  const res = graduation.apply(db, document_id, decision);
  if (!res || !res.templateId) return;

  try { _writeTemplateFile(db, res.templateId, path, fs, templatesDir()); }
  catch (e) { console.warn('Graduation template file write failed:', e.message); }

  // Only a freshly CREATED template needs enrichment; a LINK reuses an already-enriched one.
  if (res.created) {
    try { templates.setSampleDocument(db, res.templateId, document_id); } catch (e) { console.warn('Graduation sample pin failed:', e.message); }
    try { if (ctx.generateLandmarks)   await ctx.generateLandmarks(res.templateId); }   catch (e) { console.warn('Graduation landmarks failed:', e.message); }
    try { if (ctx.generateFingerprint) await ctx.generateFingerprint(res.templateId); } catch (e) { console.warn('Graduation fingerprint failed:', e.message); }
    console.log(`[graduation] auto-created template "${res.name}" (id ${res.templateId}${res.keywordOnly ? ', keyword-only' : ''}) on scope graduation`);
  }
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
