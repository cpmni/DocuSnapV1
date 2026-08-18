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
  // Bin-changed signal (eric design + Oracle 2026-08-16): fired ONCE per bin-mutating op below —
  // the Search window's recycle-bin view re-pulls on it. Optional in ctx (pure unit fixtures).
  const notifyBinChanged = typeof ctx.notifyBinChanged === 'function' ? ctx.notifyBinChanged : () => {};

  const documents  = require('../../../database/modules/documents');
  const learning   = require('../../../database/modules/learning');
  const doctypes   = require('../../../database/modules/document_types');
  const templates  = require('../../../database/modules/templates');
  const previewService = require('../../services/previewService');
  const workflowService = require('../../services/workflowService');
  const accessService = require('../../services/accessService');
  const { requireRole, requireLogin, hasRole, logAudit, getCurrentUser } = require('../auth/handler');
  // Per-document read authz (Slice 0). Throws a FORBIDDEN error (crosses IPC as the
  // rejection reason) when the gate is on and the actor may not read this document.
  // not_found also denies (hide existence). Kill switch ACCESS_GATE_ENABLED (default ON).
  const _assertDocAccess = (db, sess, docId) => {
    if (!accessService.gateEnabled()) return;
    const acc = accessService.canAccessDocument(db, sess, docId);
    if (!acc.allow) throw Object.assign(new Error('You do not have permission to view this document.'), { code: 'FORBIDDEN' });
  };
  // Shared in-process presence map (the "being reviewed by" signal) — the SAME instance the /v1
  // client API publishes to, so a desktop reviewer is visible to clients and vice-versa.
  const presence = require('../../services/presenceService').shared();
  const _desktopKey = (uid) => `desktop:${uid}`;

  // Transport-agnostic review orchestration — the SAME confirm/defer/restore the detached-client
  // /v1 API will call (Phase 3). The desktop injects its Electron-only steps as hooks so this
  // path stays byte-identical; auth + the workflow lock are enforced at the edge (requireUnlocked).
  const reviewService = _sharedReviewServiceInstance = require('../../services/reviewService').createReviewService({
    documents, learning, doctypes,
    filing: require('../filing/handler'),
    fs, path, logger,
    audit: (db, entry) => logAudit(db, entry),
    onScheduleSourceMove: (args) => _scheduleSourceMove(ctx, getDb(), documents, args),
    onTaughtConfirm: (db, docId, info) => _upsertTemplate(ctx, db, docId, info),
    onScopeGraduated: (db, docId, info) => _maybeGraduationTemplate(ctx, db, docId, info),
    // Slice 1 (learn-on-commit) — keep a matched/graduated template's identity converging on
    // EVERY confirm, not only a taught one (kill switch template_learn_on_confirm, DEFAULT OFF).
    learnTemplateOnCommit: (db, docId, info) => templates.learnTemplateOnCommit(db, docId, info),
    captureSample: async (tId, docId) => {
      if (ctx.captureSampleWords) {
        await ctx.captureSampleWords(tId, docId);
        if (ctx.generateLandmarks) await ctx.generateLandmarks(tId);
        if (ctx.generateSampleAngle) await ctx.generateSampleAngle(tId);
      }
    },
    notifyCounts: (db) => {
      notifyMainWindow('review-count-changed',   documents.getReviewCount(db));
      notifyMainWindow('deferred-count-changed', documents.getDeferredCount(db));
    },
    // Slice 3 (amount routing): capture the total's trust context before the note-clear, and — detached +
    // fail-open — auto-create an approval route from it. Both no-op unless WORKFLOW_AMOUNT_ROUTING is armed
    // AND the workflow feature is entitled (a const, false today), so this is byte-identical + un-strandable.
    captureRouteContext: (db, docId, corrections) =>
      require('../../services/amountRouting').captureTotalContext(db, docId, corrections,
        { getExtractedTotalContext: documents.getExtractedTotalContext }),
    startDefaultRoute: (db, docId, routeCtx, meta) =>
      require('../../services/amountRouting').startDefaultRoute(db, docId, routeCtx, meta, {
        entitled: (d) => { try { return !!require('../../services/entitlementService').checkClientEntitlement(d).workflow.entitled; } catch { return false; } },
        hasActiveRoute: (d, id) => require('../../database/modules/workflow').hasActiveRoute(d, id),
        currencyConsistent: (d, sup, slug, fk, v) => require('../../database/modules/trust').currencyConsistentForField(d, sup, slug, fk, v),
        floor: (d) => parseInt(learning.getSetting(d, 'critical_field_conf_floor', '88'), 10) || 0,
        listActiveRules: (d) => require('../../database/modules/workflow').listActiveRouteRules(d),
        usersByRole: (d, role) => require('../../database/modules/auth').getAllUsers(d).filter(u => u.role === role),
        assign: (actor, opts) => require('../../services/workflowService').createWorkflowService({ audit: (e) => logAudit(db, e) }).assign(db, actor, opts),
        audit: (e) => logAudit(db, e),
        summarizeRule: (rule) => require('../../database/modules/workflow').summarizeRule(db, rule),
      }),
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
  // them. The FILE is read once and cached; every SETTING-dependent widening is applied
  // per call (see below). Returns {} if the file is missing/unparseable so the UI degrades
  // gracefully (no validation rather than a crash).
  //
  // WHY THE CACHE HOLDS THE RAW CONFIG AND NOT THE MERGED RESULT (Oracle C4, 2026-08-10):
  // Python re-reads `vat_eu_formats` at EVERY extraction spawn (processing/handler.js
  // `_reconcileEnv`), so caching the merged patterns here meant that flipping the toggle
  // widened extraction immediately while Review's on-blur check stayed narrow until the app
  // was restarted. That transient window is a live reinstatement of the exact UI-vs-pipeline
  // disagreement this widening exists to prevent (the `iban` defect of 2026-08-08) — and it
  // is what an owner hits within a minute of flipping. The merge is cheap (one concat on a
  // handful of strings); the file read is the expensive part, so that is what is cached.
  let _validationPatternsRaw;
  ipcMain.handle('get-validation-patterns', () => {
    requireLogin();
    if (_validationPatternsRaw === undefined) {
      try {
        const cfgFile = ctx.resourcePath('config', 'keyword_patterns.json');
        const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
        _validationPatternsRaw = cfg.validation_patterns || {};
      } catch (e) {
        logger?.warn?.(`get-validation-patterns: ${e.message}`);
        _validationPatternsRaw = {};
      }
    }
    // The renderer's twin of keyword._apply_vat_eu. The shipped `vat_gb` patterns are UK ONLY,
    // so an operator typing a correct Irish or German VAT number by hand is told their value is
    // wrong. The widening MUST happen on both sides or the UI and the pipeline disagree about the
    // same value. Merged here, at the one place the renderer's patterns are built, rather than in
    // the renderer, so the two consumers share one decision. Default OFF.
    //
    // NOT the only reader of these patterns: `database/modules/trust.js`
    // (`_sharedValidationPatterns`) loads the same file directly and deliberately does NOT widen —
    // see the note there. Three consumers, two of which widen from this setting.
    let out = _validationPatternsRaw;
    try {
      if (learning.getSetting(getDb(), 'vat_eu_formats', 'false') === 'true') {
        const eu = out.vat_eu || [];
        if (eu.length && out.vat_gb) {
          out = Object.assign({}, out, { vat_gb: out.vat_gb.concat(eu) });
        }
      }
    } catch { /* a settings read must never break field validation */ }
    return out;
  });

  // ── Taught-issuer plausibility (warning only) ────────────────────────────────
  // Chris round 2, 2026-08-11: a ⊕ teach read '@a eens Ee' off the page, showed a green
  // "Captured the Document Issuer position" toast, flagged nothing, and the value became two
  // output folders. His line for it — every guard in this product is pointed at ABSENCE, none at
  // CONFIDENT NONSENSE — is exactly right: the app warns plainly on an EMPTY issuer and says
  // nothing on a gibberish one.
  //
  // Answers a renderer question with the ONE shared predicate (learning.issuerReadLooksImplausible)
  // rather than letting the teach surfaces grow their own copy — this repo already carries four
  // spellings of a ref predicate and a warning about the fifth.
  //
  // WARNING ONLY. It never blocks a confirm, rewrites a value or rejects a teach. Kill switch:
  // setting `teach_issuer_plausibility_warn` = 'false'. DEFAULT ON, mirroring
  // `teach_typed_value_locate` — nothing is persisted or changed by it, it only adds a sentence,
  // and the defect it answers files documents into junk folders silently.
  ipcMain.handle('check-issuer-read', (_e, value) => {
    requireLogin();
    try {
      if (learning.getSetting(getDb(), 'teach_issuer_plausibility_warn', 'true') === 'false') {
        return { implausible: false, off: true };
      }
      return { implausible: !!learning.issuerReadLooksImplausible(value) };
    } catch (e) {
      logger?.warn?.(`check-issuer-read: ${e.message}`);
      return { implausible: false };          // a failed check must never block a teach
    }
  });

  // ── "That name is one character off one you already use" (read-only, advisory) ─────────────
  // The customer-facing half of the write guard in `dc4bf1d`. `templates._upsertFields` already
  // KEEPS an incumbent frozen identity when a teach brings a near match; this lets the teach
  // surfaces SAY so at the draw, in the operator's own moment, instead of the app appearing to
  // ignore them. Chris round 4, card 2 — his own proposed sentence.
  //
  // Advisory only: no write, no block, no rewrite. A failure returns "not near", so a broken
  // lookup can never stop a teach (the same posture as check-issuer-read).
  ipcMain.handle('check-identity-near-match', (_e, value) => {
    requireLogin();
    try {
      return learning.findNearMatchIdentity(getDb(), value);
    } catch (e) {
      logger?.warn?.(`check-identity-near-match: ${e.message}`);
      return { near: false, reason: 'error' };
    }
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
  ipcMain.handle('get-review-split',  () => { requireRole('admin', 'edit'); return documents.getReviewSplit(getDb()); });
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
    let ids = [], approved = [];
    try {
      const o = JSON.parse(learning.getSetting(db, 'recent_auto_filed', '') || 'null');
      if (o && Array.isArray(o.ids) && (!o.at || (Date.now() - o.at) <= 7 * 864e5)) {
        ids = o.ids;
        // operator-approved subset (the consent bar's File N) — counted separately by the banner
        // (Chris r7 card 2). An old record without the array = everything counted automatic.
        if (Array.isArray(o.approved)) approved = o.approved.filter(id => ids.includes(id));
      }
    } catch {}
    const docs = ids.length ? documents.getByIds(db, ids) : [];
    return { count: docs.length, docs, approvedIds: approved };
  });
  ipcMain.handle('clear-recent-auto-filed', () => {
    requireRole('admin', 'edit');
    try { learning.setSetting(getDb(), 'recent_auto_filed', JSON.stringify({ ids: [], at: Date.now() })); } catch {}
    return { ok: true };
  });

  // RETIRED 2026-08-12 (Oracle C5): 'get-auto-file-eligible' fed the renderer's queue-wide
  // autoCommitFullConfidence sweep — a renderer-supplied id list was the defect surface (it filed
  // 101 docs across every supplier after a 14-doc group reprocess). The post-reprocess offer is now
  // computed SERVER-side from the batch's own recorded docIds in consume-reprocess-completion
  // (processing/handler.js) and accepted via the payload-less reprocess-autocommit-accept.
  // No restore door: queue-wide bulk filing belongs to File All Ready (human) + the scope sweep.

  // WHY is this one document not filing itself? Returns the SAME predicate's verdict verbatim, so
  // Review can state the real reason instead of re-deriving one from the confidence threshold.
  // It re-derived it before, and got it WRONG in two directions: a doc held by the structural gate
  // was told "just below the X% you've set — lower the threshold" (the threshold cannot help; the
  // gate refuses at any floor), and a graduated doc ABOVE its floor was told "Ready to file" —
  // asserting readiness for a document this very predicate had refused.
  ipcMain.handle('get-auto-file-reason', (_e, docId) => {
    requireRole('admin', 'edit');
    const db = getDb();
    const trust = require('../../../database/modules/trust');
    const doc = documents.getById(db, Number(docId));
    if (!doc) return null;
    const r = trust.isAutoFileEligible(db, doc) || {};
    // reason is 'kind:field_key' (e.g. unverifiable-value:customer_name) — split so the renderer
    // never has to parse it, and can name the field in plain English.
    const [kind, field] = String(r.reason || '').split(':');
    const out = { eligible: !!r.eligible, kind: kind || null, field: field || null,
                  floor: r.floor ?? null, trusted: !!r.trusted };
    // COLD-START COUNTDOWN (2026-08-18, Oracle C2 + Chris "say the negative result out loud").
    // `unverifiable-value` reads as a mystery — "couldn't be checked automatically" — when its
    // commonest cause on a young install is simply that this sender has not been confirmed enough
    // times yet for its learned format to leave the provisional channel the gate deliberately
    // cannot see (learning.FORMAT_SOLID_MIN). Measured on the owner's own install: 34 of 53 held
    // documents were exactly this, every one from a sender sitting on 2 confirms. Attach the two
    // numbers so Review can state the real reason AND what clears it, instead of inviting another
    // pointless Reprocess All. Advisory only — no gate reads this.
    // STALE LAYOUT NOTE (owner-found 2026-08-18). The engine's "Couldn't match this document to
    // the supplier's saved <Type> layout" note goes obsolete the moment the operator confirms one
    // document of that type for that sender — and Review already strips it from the DISPLAY on
    // exactly that condition (renderer.js ~1406). But the strip is cosmetic: the row keeps the
    // note, so the summary still counts a flag the user cannot see, and the gate still refuses the
    // document for good. Report the class distinctly so Review can say the truthful thing and
    // point at the ONE-document re-read that actually clears it, instead of a mystery flag that
    // sends the customer to Reprocess All. Read-only: the row is not touched here.
    if (kind === 'flagged') {
      try {
        const STALE = /doesn't match this supplier's saved layout|match this document to (?:the supplier's|a) saved/i;
        const noted = db.prepare(`SELECT field_key, validation_note FROM extractions
                                   WHERE document_id = ? AND TRIM(COALESCE(validation_note,'')) <> ''`).all(doc.id);
        const stale = noted.filter(e => STALE.test(e.validation_note));
        if (stale.length && stale.length === noted.length && String(doc.supplier_name || '').trim()) {
          const n = db.prepare(`SELECT COUNT(*) AS n FROM documents
             WHERE status = 'confirmed' AND document_type_id = ?
               AND LOWER(TRIM(supplier_name)) = LOWER(TRIM(?))`).get(doc.document_type_id, doc.supplier_name).n;
          if (n > 0) { out.kind = 'stale-layout-note'; out.field = stale[0].field_key; out.scopeConfirms = n; }
        }
      } catch { /* advisory — never break the reason panel */ }
    }
    if (kind === 'unverifiable-value' && field) {
      try {
        const dt = db.prepare('SELECT id FROM document_types WHERE id = ?').get(doc.document_type_id);
        if (dt && String(doc.supplier_name || '').trim()) {
          const n = db.prepare(`SELECT COUNT(*) AS n FROM documents
             WHERE status = 'confirmed' AND document_type_id = ?
               AND LOWER(TRIM(supplier_name)) = LOWER(TRIM(?))`).get(dt.id, doc.supplier_name).n;
          const need = require('../../../database/modules/learning').FORMAT_SOLID_MIN;
          if (n < need) { out.scopeConfirms = n; out.confirmsNeeded = need; }
        }
      } catch { /* advisory — never break the reason panel */ }
    }
    return out;
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
  // ── CORRECTION RIPPLE (identity text-first, slice 2) ─────────────────────────────────
  // One correction should heal the batch. Siblings are found BY TEXT (the same distinctive
  // branding tokens), never by the logo layer — nearest-neighbour would keep favouring the
  // bigger WRONG pool, which is exactly why the owner's single correction didn't heal the
  // other 19 Larkspur dockets. Read-only; the apply goes through the existing supplier-PIN
  // rail, so everything stays review-bound and plants no learning.
  // Kill switch SUPPLIER_RIPPLE=0 (additive feature; the IPCs simply report nothing).
  ipcMain.handle('find-issuer-siblings', (_e, p) => {
    requireRole('admin', 'edit');
    if (process.env.SUPPLIER_RIPPLE === '0') return { ok: true, siblings: [] };
    const docId = p && p.docId, value = p && p.value;
    if (!docId || !value) return { ok: true, siblings: [] };
    try {
      const siblings = require('../../../database/modules/supplierSiblings')
        .findSiblings(getDb(), docId, value);
      return { ok: true, siblings };
    } catch (e) {
      logger?.warn?.(`find-issuer-siblings: ${e.message}`);
      return { ok: true, siblings: [] };   // advisory — never break the resolve it follows
    }
  });
  ipcMain.handle('apply-issuer-ripple', (_e, p) => {
    requireRole('admin', 'edit');
    const db = getDb();
    const value = p && typeof p.value === 'string' ? p.value.trim() : '';
    const ids = Array.isArray(p && p.docIds) ? p.docIds.map(Number).filter(Number.isInteger) : [];
    if (!value || !ids.length) return { ok: false, error: 'missing-value-or-docs' };
    let applied = 0;
    // Same single-doc write as resolve-issuer, per document: a PIN only — no logo/hint learning,
    // cleared on confirm, and the engine keeps a pinned read review-bound ('operator_pin' + note).
    const stmt = db.prepare('UPDATE documents SET supplier_pin = ? WHERE id = ? AND status IN (\'needs_review\',\'deferred\')');
    for (const id of ids.slice(0, 100)) {
      try { applied += stmt.run(value, id).changes; } catch { /* skip the row, never abort the ripple */ }
    }
    try {
      logAudit(db, { action: 'supplier_ripple_applied', action_category: 'learning',
        outcome: 'success', metadata: { value, doc_ids: ids.slice(0, 100), applied } });
    } catch {}
    return { ok: true, applied, docIds: ids.slice(0, 100) };
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

  // get-document-with-extractions is the FULL detail (paths + ocr_text ride along via
  // getById SELECT *) — REVIEW-ONLY since the Document-detail DTO follow-up (owner
  // 2026-08-02, Oracle C3): Review genuinely consumes doc.folder_path (page fetch) and
  // doc.ocr_text (name-presence), and the Review window is admin/edit by construction.
  // Every OTHER surface (Search preview, mailbox click, resubmit — incl. Read Only)
  // uses the PROJECTED get-document-detail below. get-document-pages stays any-role
  // (it returns page images, never fields or paths).
  ipcMain.handle('get-document-with-extractions', (_e, id) => {
    const sess = requireRole('admin', 'edit');
    const db  = getDb();
    _assertDocAccess(db, sess, id);
    // Pure data assembly (doc + extractions + resolved slug + digit-only fields)
    // lives in the shared service so a detached client can reuse it; auth + audit
    // stay here at the transport edge.
    const doc = previewService.getDocumentDetail(db, id, { learning });
    if (doc) {
      // Per-template field HIDING (migration 54): the fields hidden for THIS doc's matched template,
      // so the renderer can skip their rows (a layout that lacks a field stops showing it empty).
      // When the doc matched NO template (a Stage-0 miss — the "No template match" case), fall back to
      // resolving the supplier's layout by the issuer name / branding, so the hidden-field config still
      // applies (owner 2026-07-25). Kill switch FIELD_VIS_LIVE_RESOLVE=0 restores template_id-only.
      // Empty [] ⇒ show all fields (fail-safe; byte-identical when nothing resolves).
      try {
        const _t = require('../../../database/modules/templates');
        // Start with the MATCHED template's hidden fields (unchanged when the resolver is off).
        let _hidden = doc.template_id ? _t.getHiddenFields(db, doc.template_id) : [];
        // UNION the (supplier, type) config across ALL sibling templates — so a per-supplier hide applies
        // regardless of WHICH duplicate template the logo matched, and EVEN when a template matched (the
        // old code resolved by name+type only on a Stage-0 MISS, so a doc matching the empty duplicate
        // sibling showed the fields the owner had hidden on the other sibling). Owner 2026-07-27:
        // same-supplier same-type templates are treated as one AUTOMATICALLY, no manual merge. Display-
        // only + fail-safe (show all when nothing resolves). FIELD_VIS_LIVE_RESOLVE=0 ⇒ matched-only ⇒
        // byte-identical to before.
        if (process.env.FIELD_VIS_LIVE_RESOLVE !== '0' && doc.type_slug) {
          const _mode = String((db.prepare('SELECT value FROM settings WHERE key = ?').get('field_visibility_resolve_mode') || {}).value) === '2' ? 2 : 1;
          let _fp = null; try { _fp = JSON.parse(doc.keyword_fingerprint || 'null'); } catch {}
          const _res = _t.getHiddenFieldsForSupplierType(db, { supplier_name: doc.supplier_name,
            document_type_slug: doc.type_slug, keyword_fingerprint: Array.isArray(_fp) ? _fp : null, mode: _mode });
          _hidden = [...new Set([..._hidden, ..._res])];
        }
        doc.hidden_fields = _hidden;
      } catch { doc.hidden_fields = []; }
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

  // PROJECTED single-document detail (the Document-detail DTO follow-up, Oracle C3): what
  // the Search/mailbox/resubmit surfaces actually render — display fields + extractions —
  // through the /v1 trust-boundary shape (dto.projectDocumentDetail) REUSED VERBATIM, so
  // the desktop and wire projections cannot drift. No paths, no ocr_text, no hashes cross
  // to those renderers on the single-doc click any more (the row surface was de-pathed in
  // the prior slice). Same access gate + document_open audit as the full read.
  ipcMain.handle('get-document-detail', (_e, id) => {
    const sess = requireLogin();
    const db = getDb();
    _assertDocAccess(db, sess, id);
    const doc = previewService.getDocumentDetail(db, id, { learning });
    if (doc) {
      logAudit(db, { action: 'document_open', target_type: 'document', target_id: id,
        document_id: id, outcome: 'success',
        metadata: { type: doc.type_slug || null, status: doc.status || null, via: 'detail' } });
    }
    return require('../../services/dto').projectDocumentDetail(doc);
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

  // LIVE field visibility by the ENTERED supplier + type (2026-07-25, owner request). Review calls this
  // on issuer-blur and on load for a doc that matched NO template, so a supplier's hidden-field config
  // still applies (the per-template config is keyed on template_id, which is null on a "No template match"
  // doc). Read-only. FAIL-SAFE: returns hidden:[] (show ALL fields) whenever nothing resolves — the owner's
  // stated rule. Kill switch FIELD_VIS_LIVE_RESOLVE=0 ⇒ {disabled:true}; the renderer then keeps the
  // template_id-keyed set from get-document-with-extractions ⇒ byte-identical to before. Mode (setting
  // `field_visibility_resolve_mode`): 1 = entered name, doc branding fingerprint as backup (default);
  // 2 = entered name ONLY (the dev A/B switch — flip via set-setting to test).
  ipcMain.handle('resolve-field-visibility', (_e, payload = {}) => {
    try {
      requireLogin();
      if (process.env.FIELD_VIS_LIVE_RESOLVE === '0') return { disabled: true };
      const db = getDb();
      const templatesMod = require('../../../database/modules/templates');
      const { supplier_name, document_type_slug, doc_id } = payload || {};
      if (!document_type_slug) return { hidden: [], templateId: null };
      const modeRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('field_visibility_resolve_mode');
      const mode = String(modeRow && modeRow.value) === '2' ? 2 : 1;
      let fp = null;
      if (mode === 1 && doc_id) {
        try { fp = JSON.parse(db.prepare('SELECT keyword_fingerprint FROM documents WHERE id = ?').get(doc_id)?.keyword_fingerprint || 'null'); } catch {}
      }
      const tid = templatesMod.findForSupplierType(db, {
        supplier_name, document_type_slug, keyword_fingerprint: Array.isArray(fp) ? fp : null, mode });
      // UNION the hidden-field config across ALL (supplier, type) sibling templates (duplicate-proof),
      // not just the single tie-broken pick — same automatic resolution as get-document-with-extractions.
      const hidden = templatesMod.getHiddenFieldsForSupplierType(db, {
        supplier_name, document_type_slug, keyword_fingerprint: Array.isArray(fp) ? fp : null, mode });
      return { hidden, templateId: tid || null, mode };
    } catch { return { hidden: [], templateId: null }; }
  });

  // ── Document pages for preview ──────────────────────────────────────────────
  ipcMain.handle('get-document-pages', async (_e, docId, folderPath, filename, scale) => {
    const sess = requireLogin();
    const db = getDb();
    _assertDocAccess(db, sess, docId);
    // SECURITY (mirror /v1 F-02): resolve the on-disk location SERVER-SIDE from the doc
    // row ONLY — the client-supplied folderPath/filename are NOT read (a compromised/replaced
    // renderer could otherwise path.join arbitrary host paths through the render pipeline).
    // Precedence matches the in-process preview: working copy -> filed copy -> recorded source.
    const row = db.prepare(
      'SELECT working_path, stored_path, folder_path, original_filename FROM documents WHERE id = ?').get(docId);
    let rFolder = null, rFile = null;
    if (row) {
      const pick = row.working_path || row.stored_path
        || (row.folder_path && row.original_filename ? path.join(row.folder_path, row.original_filename) : null);
      if (pick) { rFolder = path.dirname(pick); rFile = path.basename(pick); }
    }
    if (!rFolder || !rFile) {
      console.log(`[pages] docId=${docId} no resolvable file`);
      return [];
    }
    const sourcePath = path.join(rFolder, rFile);

    // A new document loading is our signal that the previous one's preview
    // has moved on — fire any deferred source-file move now (unless, oddly,
    // it's pending removal of the very file we're about to load). This is a
    // Review-window filing concern and stays here, not in the shared service.
    if (_pendingSourceMove && _pendingSourceMove.srcPath !== sourcePath) {
      _runPendingSourceMove(ctx, 'next document loaded');
    }

    // Transport-agnostic page render lives in the shared service so the detached
    // client can reuse it; Electron collaborators are injected via deps.
    return previewService.getDocumentPages(db, { docId, folderPath: rFolder, filename: rFile, scale }, {
      fs, path, spawn, pythonExe, pythonArgs,
      renderScript: ctx.resourcePath('python_backend', 'render', 'pages.py'),
    });
  });

  // ── Small page-1 thumbnail for the document lists + add-template picker ──────
  ipcMain.handle('get-document-thumbnail', async (_e, docId, folderPath, filename) => {
    const sess = requireLogin();
    const db = getDb();
    _assertDocAccess(db, sess, docId);
    // Same server-side path resolution as get-document-pages (never trust client paths).
    const row = db.prepare(
      'SELECT working_path, stored_path, folder_path, original_filename FROM documents WHERE id = ?').get(docId);
    let rFolder = null, rFile = null;
    if (row) {
      const pick = row.working_path || row.stored_path
        || (row.folder_path && row.original_filename ? path.join(row.folder_path, row.original_filename) : null);
      if (pick) { rFolder = path.dirname(pick); rFile = path.basename(pick); }
    }
    if (!rFolder || !rFile) return null;
    return previewService.getThumbnail(db, { docId, folderPath: rFolder, filename: rFile }, {
      fs, path, spawn, pythonExe, pythonArgs,
      renderScript: ctx.resourcePath('python_backend', 'render', 'pages.py'),
    });
  });

  // ── OCR preprocessing preview ────────────────────────────────────────────────
  ipcMain.handle('get-enhanced-preview', async (_e, { docId, page, enhanceParams }) => {
    const sess = requireLogin();
    if (docId == null || !enhanceParams) return null;
    const db = getDb();
    _assertDocAccess(db, sess, docId);
    // SECURITY (Stage 1 — H3, mirror get-document-pages): resolve the on-disk file SERVER-SIDE from
    // the doc row ONLY — the client-supplied folderPath/filename are NOT read. A compromised/replaced
    // renderer could otherwise render (and read back as an image) any file on disk, or point a UNC
    // path at an attacker host to trigger an outbound SMB/NTLM authentication.
    const row = db.prepare(
      'SELECT working_path, stored_path, folder_path, original_filename FROM documents WHERE id = ?').get(docId);
    const filePath = row
      ? (row.working_path || row.stored_path
         || (row.folder_path && row.original_filename ? path.join(row.folder_path, row.original_filename) : null))
      : null;
    if (!filePath || !fs.existsSync(filePath)) return null;

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
  // Close any OPEN routes on a doc that was just soft-deleted (FYI slice, Oracle C1/C2):
  // 'recalled' + "Document deleted by <name>" — an honest Completed-list tombstone instead of a
  // silent vanish (ack, newly deletable) or a stranded-open inbox item (approve via admin
  // override / the previously-unguarded bulk doors). Audits + notifies ONLY when something
  // closed; ONE notify per call (a batch door passes many docs' worth through one call site).
  // 'auto_closed' is deliberately UNKNOWN to workflowNotify.eventDirection ⇒ badge-ping only,
  // no toast (the recipient finds the tombstone in Completed; a toast for a dead doc is noise).
  function _closeRoutesForDeleted(db, docIds, deletedByName) {
    let closed = 0;
    for (const id of docIds) {
      const res = workflowService.closeOpenRoutesForDeletedDoc(db, { documentId: id, deletedByName });
      if (res.closed.length) {
        closed += res.closed.length;
        logAudit(db, { action: 'workflow_route_closed_on_delete', action_category: 'workflow',
          target_type: 'document', target_id: id, document_id: id, outcome: 'success',
          metadata: { routes: res.closed.map(r => r.id), deleted_by: deletedByName } });
      }
    }
    if (closed > 0) { try { ctx.notifyWorkflowEvent && ctx.notifyWorkflowEvent({ event: 'auto_closed' }); } catch { /* best-effort */ } }
    return closed;
  }

  ipcMain.handle('delete-document', async (_e, docId /*, filePath */) => {
    requireRole('admin', 'edit');
    const db = getDb();
    // Blocked while under an open APPROVAL route (an open FYI route never blocks — FYI slice);
    // admin override proceeds and the route-close below leaves the honest tombstone.
    const sess = requireUnlocked(db, docId, 'delete');
    documents.softDelete(db, docId);
    _closeRoutesForDeleted(db, [docId], sess.displayName || sess.username);
    logAudit(db, { action: 'document_deleted', action_category: 'document', target_type: 'document',
      target_id: docId, document_id: docId, outcome: 'success', metadata: { soft: true } });
    notifyMainWindow('review-count-changed',   documents.getReviewCount(db));
    notifyMainWindow('deferred-count-changed', documents.getDeferredCount(db));
    notifyBinChanged();
    return true;
  });

  // Recycle bin: list, restore, and permanently remove deleted documents.
  // Same de-pathing projection as the search rows — the bin renders in the SAME window
  // (getDeletedQueue is SELECT d.*; the search renderer is its only consumer).
  ipcMain.handle('get-deleted-queue', () => {
    requireRole('admin', 'edit');
    const { projectSearchRow } = require('../../services/searchService');
    return documents.getDeletedQueue(getDb()).map(projectSearchRow);
  });

  ipcMain.handle('restore-document', (_e, docId) => {
    requireRole('admin', 'edit');
    const db = getDb();
    documents.restoreDeleted(db, docId);
    logAudit(db, { action: 'document_restored', action_category: 'document', target_type: 'document',
      target_id: docId, document_id: docId, outcome: 'success' });
    notifyMainWindow('review-count-changed',   documents.getReviewCount(db));
    notifyMainWindow('deferred-count-changed', documents.getDeferredCount(db));
    notifyBinChanged();
    return true;
  });

  // Bulk restore — the counterpart Empty bin always had and Restore didn't (Chris r2
  // 2026-08-11, finding 8: "still no Restore all"). Same role gate as single restore.
  ipcMain.handle('restore-all-deleted', () => {
    requireRole('admin', 'edit');
    const db = getDb();
    const ids = documents.getDeletedQueue(db).map(d => d.id);
    for (const id of ids) documents.restoreDeleted(db, id);
    logAudit(db, { action: 'recycle_bin_restored', action_category: 'document', target_type: 'document',
      outcome: 'success', metadata: { count: ids.length } });
    notifyMainWindow('review-count-changed',   documents.getReviewCount(db));
    notifyMainWindow('deferred-count-changed', documents.getDeferredCount(db));
    notifyBinChanged();   // once for the whole bulk restore, never per-row
    return { restored: ids.length };
  });

  // Permanent removal (irreversible) — admin only. Unlinks the filed file + the app's
  // working copy, then deletes the row. `purge-all-deleted` empties the whole bin.
  // THE PROMISE WAS NOT KEPT, and the reason is two independent defects (Chris round 4, card 4:
  // "Empty bin says it deletes the PDF files. It didn't." — verified at source 2026-08-13).
  //   1. This loop's first entry was `documents.resolveFilePath(doc)`, which returns `working_path`
  //      FIRST when one exists (documents.js:675). A binned doc that was previously filed has BOTH,
  //      so both loop entries resolved to the same working copy and `stored_path` — the filed PDF
  //      the dialog names — was never unlinked.
  //   2. resolveFilePath's `stored_path` branch requires `status === 'confirmed'`, and a binned doc
  //      is `'deleted'`. So even with no working copy it fell through to
  //      `folder_path + original_filename` — the CUSTOMER'S OWN SOURCE SCAN, which no dialog
  //      promises to delete and which the app does not own.
  // Now the set is explicit and app-owned only: the working copy and the filed copy, never the
  // source. Deleting the filed copy is the documented intent of purge (this function's own header,
  // and the admin-only dialog that says "including their PDF files"), so the promise becomes true
  // rather than the copy becoming weaker.
  function _purgeOne(db, docId) {
    const doc = documents.getById(db, docId);
    if (!doc) return;
    const targets = new Set();
    if (doc.working_path) targets.add(doc.working_path);   // the app-managed inbox copy
    if (doc.stored_path)  targets.add(doc.stored_path);    // the filed copy in the output tree
    for (const p of targets) {
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
    notifyBinChanged();   // purge previously broadcast NOTHING — the stale-bin exhibit
    return true;
  });
  ipcMain.handle('purge-all-deleted', () => {
    requireRole('admin');
    const db = getDb();
    const ids = documents.getDeletedQueue(db).map(d => d.id);
    for (const id of ids) _purgeOne(db, id);
    logAudit(db, { action: 'recycle_bin_emptied', action_category: 'document', target_type: 'document',
      outcome: 'success', metadata: { count: ids.length } });
    notifyBinChanged();   // once for the whole empty-bin
    return { purged: ids.length };
  });

  // ── Bulk delete of a whole queue (Admin only) ───────────────────────────────
  // Permanent deletion of scanned documents is Admin-exclusive, like the
  // single-doc delete above. Each helper is scoped to exactly one status so it
  // can never reach confirmed documents. SOFT delete: every row goes to the recycle
  // bin (status='deleted' + deleted_at; restorable from Search; files on disk KEPT) —
  // the renderer's dialogs promise exactly that recoverability, so this must NEVER be
  // "restored" to a hard delete without rewriting those dialogs in the same commit.
  // Returning the deleted count lets the renderer report it.
  function _deleteQueue(status, rows, countEvent, deletedByName) {
    const db = getDb();
    let n = 0;
    for (const r of rows) { documents.softDelete(db, r.id); n++; }   // → recycle bin (recoverable; files kept)
    // Previously-unguarded door: open routes (approve included) were stranded pending-forever
    // against the deleted docs. One notify for the whole batch (Oracle C2).
    _closeRoutesForDeleted(db, rows.map(r => r.id), deletedByName);
    notifyMainWindow(countEvent, status === 'needs_review'
      ? documents.getReviewCount(db) : documents.getDeferredCount(db));
    notifyBinChanged();   // once after the loop — a 45-doc Delete-All is ONE bin event
    return { success: true, deleted: n };
  }

  ipcMain.handle('delete-all-review', async () => {
    const sess = requireRole('admin');
    return _deleteQueue('needs_review', documents.getReviewQueue(getDb()), 'review-count-changed', sess.displayName || sess.username);
  });

  ipcMain.handle('delete-all-deferred', async () => {
    const sess = requireRole('admin');
    return _deleteQueue('deferred', documents.getDeferredQueue(getDb()), 'deferred-count-changed', sess.displayName || sess.username);
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
    const r = await reviewService.confirm(db, { userId: sess.id, username: sess.username, role: sess.role }, payload);
    if (!r.ok) {
      return { success: false, error: r.error,
               ...(r.code ? { code: r.code } : {}),
               ...(r.confirmedBy ? { confirmedBy: r.confirmedBy } : {}),
               ...(r.code === 'PREFIX_OUTLIER' ? { prefixOutlier: { field: r.field, dominant: r.dominant, prefix: r.prefix } } : {}),
               // ISSUER_NEAR_MATCH's payload MUST ride along too (owner-found 2026-08-18): this
               // whitelist dropped it, so the renderer's showIssuerNearMatchHold got `undefined`,
               // skipped the inline note entirely and fell back to a toast reading the literal
               // placeholder 'a company you already use'. That fallback carries NO buttons — so the
               // hold became a DEAD END: the operator could neither adopt the known spelling nor
               // keep their own, and a correct document could not be filed at all.
               ...(r.code === 'ISSUER_NEAR_MATCH' ? { nearMatch: r.nearMatch } : {}) };
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
      `SELECT d.template_id, d.logo_phash, d.logo_detail_hash, d.ocr_text, dt.slug AS document_type_slug
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
      // 256-bit isolated-mark evidence (mig 47, populated at processing time): arms the
      // detail-hash veto so this recheck — which also picks the Template Wizard's SAVE
      // TARGET via resolveWizardTemplate — can never name a template whose enrolled mark
      // positively contradicts this page's mark (the Thornbury-on-Copperfield pill).
      logo_detail_hash: doc.logo_detail_hash,
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
      if (result && result.skipped === 'generic-type') {
        return { success: false, error: 'General Documents are filed without templates — there is nothing to add to the Template Manager.' };
      }
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
        // TEACH_ANGLE_COMPOSE enabler: record the sample's tilt NOW so the first process of a
        // sibling composes the teach coords to level (else the lazy heal lands it one batch late).
        try { if (ctx.generateSampleAngle) await ctx.generateSampleAngle(result.templateId); }
        catch (e) { console.error('promote-to-template sample-angle:', e.message); }
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
      if (result && result.skipped === 'generic-type') {
        return { success: false, error: 'General Documents are filed without templates — retype the document first if it belongs with this template.' };
      }
      const newId = result.templateId;
      // Only pin/derive on a genuinely NEW template — never disturb an existing one's sample.
      if (newId && result.created) {
        templates.setSampleDocument(db, newId, document_id);
        try { if (ctx.generateLandmarks)  await ctx.generateLandmarks(newId); }  catch (e) { console.error('link landmarks:', e.message); }
        try { if (ctx.generateFingerprint) await ctx.generateFingerprint(newId); } catch (e) { console.error('link fingerprint:', e.message); }
        try { if (ctx.generateSampleAngle) await ctx.generateSampleAngle(newId); } catch (e) { console.error('link sample-angle:', e.message); }
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

// The ONE shared reviewService instance (set in register) — the Catch-up sweep accept files
// through it so there is never a second confirm/filing implementation. Null until register runs.
let _sharedReviewServiceInstance = null;
module.exports = { register, _buildTemplateFields, _upsertTemplate,   // _buildTemplateFields + _upsertTemplate exported for tests (test_build_template_fields.js, test_upsert_type_link.js)
                   getReviewService: () => _sharedReviewServiceInstance };

// ── Template create / update ──────────────────────────────────────────────────

async function _upsertTemplate(ctx, db, document_id, { allValues, document_type_slug, supplier_name, dtInfo }) {
  // Generic Document (docs/designs/GENERIC_DOCTYPE_2026-07-18.md §3, pinned trade-off):
  // the heterogeneous "General Document" pile must NEVER mint templates — a generic-born
  // template could later Stage-0-match and stamp generic over a doc a real type fits.
  // No template learning on the pile in v1; the Teach-Me Funnel is the later graduation path.
  if (document_type_slug === require('../../../database/modules/document_types').GENERIC_SLUG) {
    return { skipped: 'generic-type' };
  }
  const { path, fs, templatesDir } = ctx;
  const templates = require('../../../database/modules/templates');

  // Read document record for stored logo_phash and keyword_fingerprint
  const doc = db.prepare(
    'SELECT template_id, logo_phash, logo_detail_hash, keyword_fingerprint FROM documents WHERE id = ?'
  ).get(document_id);
  if (!doc) throw new Error('Document not found');

  const logo_phash           = doc.logo_phash || null;
  const logo_detail_hash     = doc.logo_detail_hash || null;   // Slice B: isolated-mark discriminator, enrolled into the template set
  let keyword_fingerprint    = _parseJson(doc.keyword_fingerprint, []);

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

  // FINGERPRINT_HYGIENE (slice 3 of the distinctive-token train, Oracle-signed 2026-07-20): the
  // doc-side fingerprint can carry the RECIPIENT's name when the recipient marker OCR'd garbled
  // ("Bill To" → "Bi Te" defeated the harvest truncation) — the live Vellum template froze its
  // sample's customer ("Ashcombe Care Homes") into its permanent identity, diluting its own rival
  // ratio below the naming bar exactly when it was the true supplier. At CONFIRM time the
  // recipient is GROUND TRUTH (the operator just confirmed customer_name), so subtract those
  // tokens — never fuzzy-match garbled markers (difflib on 5-7 char markers scores ~0.67, below
  // any safe bar; both advisors rejected it). Oracle condition E: a token also present in the
  // confirmed ISSUER is never subtracted (a company billing its own branch must not strip its own
  // identity). On the UPDATE path stabiliseFingerprint INTERSECTS stored∩incoming, so a stored
  // leak ('Ashcombe') heals on the very next confirm without a migration — pinned.
  // Skipped entirely when the issuer identity CAME from the customer field (the confirmedIssuer
  // fallback above) — subtracting there would strip the issuer's own identity.
  if (process.env.FINGERPRINT_HYGIENE !== '0' && allValues && allValues.customer_name
      && confirmedIssuer && confirmedIssuer !== String(allValues.customer_name).trim()) {
    const toks = (s) => new Set((String(s || '').toLowerCase().match(/[a-z0-9]{2,}/g)) || []);
    const custToks = toks(allValues.customer_name);
    const issuerToks = toks(confirmedIssuer);
    keyword_fingerprint = keyword_fingerprint.filter(w => {
      const wl = String(w == null ? '' : w).toLowerCase();
      return !(custToks.has(wl) && !issuerToks.has(wl));
    });
  }

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
  // Part E (TEMPLATE_SUPPLIER_LINK_GUARD — Oracle condition A, the confirm-time reinforcement
  // loop, 2026-07-20): never REUSE a template whose established supplier identity is NAME-DISJOINT
  // from the issuer the operator just confirmed. Without this, a foreign doc that Stage-0
  // logo-matched another supplier's template (the misfiled docs sit at hamming 4-6 — INSIDE the
  // logo append band) would, on its corrected taught-confirm/promote, bump that template's count,
  // APPEND its phash into the wrong reference set (making the collision match BETTER next time),
  // dilute its dominant issuer and rewrite its fields. Applied to the surviving doc link here AND
  // to the logo/branding reuse acquisitions below (the same foreign template is re-acquirable by
  // findByLogoHash at the same distance). Unjudgeable identity ⇒ reuse (fail toward today);
  // detached ⇒ fall through to CREATE — a genuinely different sender gets its OWN template.
  const _supplierLinkOk = (tid) => {
    if (!tid || !confirmedIssuer || process.env.TEMPLATE_SUPPLIER_LINK_GUARD === '0') return true;
    // SELF-INDEPENDENT identity (TEMPLATE_GUARD_SELF_INDEPENDENT, 2026-07-21): this runs from the
    // detached onTaughtConfirm hook AFTER the doc is confirmed + supplier_name=confirmedIssuer, so —
    // exactly like the reviewService arm — a plain establishedIdentity counts the doc against itself.
    // Exclude document_id (in scope from the _upsertTemplate signature). OFF ⇒ null ⇒ byte-identical.
    const _selfIndep = process.env.TEMPLATE_GUARD_SELF_INDEPENDENT !== '0';
    const ident = templates.establishedIdentity(db, tid, _selfIndep ? document_id : null);
    return !(ident && templates.supplierNamesDisjoint(confirmedIssuer, ident));
  };
  let supplierDetached = false;
  if (templateId && !_supplierLinkOk(templateId)) {
    templateId = null;
    supplierDetached = true;
  }
  // NAME-PRIMARY REUSE (Lever 1, TEMPLATE_REUSE_BY_NAME default ON, Phillip/Oracle SIGN-OFF-WITH-CONDITIONS
  // 2026-07-27): the CONFIRMED ISSUER is the one clean reuse signal — the 64-bit logo phash can't separate
  // suppliers (it folds a FOREIGN nearest template) and branding overlap is polluted by per-doc OCR-garble /
  // recipient tokens, so BOTH the logo + branding arms below can MISS the true same-supplier sibling and mint
  // a DUPLICATE (the measured id33/id34 birth). Reuse a same-TYPE template whose established (dominant
  // confirmed) identity EXACTLY matches this doc's confirmed issuer, BEFORE the unreliable logo/branding arms.
  // Part-E-again (below) re-validates the acquisition (establishedIdentity == confirmedIssuer ⇒ non-disjoint ⇒
  // kept). Reversible LINK; OFF ⇒ byte-identical (arm skipped). Precision (Oracle C1) lives in
  // templates.reuseByEstablishedName: establishedIdentity not the cosmetic name, EXACT _normNameForVis
  // equality (never containment), same slug, plausible + len>=3, canonical = richest sibling.
  // TODO (same lever, follow-up): mirror this arm before graduationTemplate's create (a separate birth path).
  if (!templateId && process.env.TEMPLATE_REUSE_BY_NAME !== '0' && confirmedIssuer && document_type_slug) {
    const _nmReuse = templates.reuseByEstablishedName(db, confirmedIssuer, document_type_slug, document_id);
    if (_nmReuse) { templateId = _nmReuse; supplierDetached = true; }   // supplierDetached => relink the doc to the reused canonical
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

  // M2 — BRANDING-FINGERPRINT REUSE (docs/designs/TEMPLATE_CONVERGENCE_2026-07-17.md +
  // TEMPLATE_DEFRAG_2026-07-25.md; kill switch TEMPLATE_REUSE_BY_BRANDING, DEFAULT ON since 2026-07-25 —
  // set '0' to disable). On scans the coarse logo phash drifts past the accept band (measured up to 36
  // Hamming for the SAME supplier), so the logo arms above miss a drifted doc's own template and the
  // CREATE branch below spawns a DUPLICATE (the fragmentation birth path). Reuse the canonical SAME-TYPE
  // template identified by DISTINCTIVE branding tokens instead. Placed under `!templateId` (NOT nested in
  // the logo_phash guard) so it also converges logo-LESS suppliers (Oracle cond 3). The far-drifted logo
  // is NOT folded into the reused template's set — update()'s append stays bounded at LOGO_APPEND_BAND=13.
  // WHY DEFAULT ON IS SAFE (Oracle SIGN-OFF-WITH-CONDITIONS 2026-07-25): this is a CONFIRM-TIME path the
  // corpus harness never exercises, so its safety is a live REPLAY not a corpus run — 534 confirmed docs
  // gave 482 same-supplier reuses and 0 cross-supplier false matches at 0.80. The real guard is NOT that
  // number but the BLAST RADIUS: a mis-bind is a reversible `template_id` LINK, never a value write, and
  // the Part-E `_supplierLinkOk` re-check below detaches a name-disjoint acquisition. TODO (Phillip's
  // Slice-2 condition, follow-up): harden findByBrandingFingerprint against short/generic-token collisions
  // (two "___ Services Ltd" sharing 3 boilerplate tokens) via a per-DB IDF/rarity weight — a synthetic
  // corpus can't expose it. Real gate before wide rollout = one live owner batch that reuses cleanly.
  if (!templateId && process.env.TEMPLATE_REUSE_BY_BRANDING !== '0') {
    const bg = templates.findByBrandingFingerprint(db, keyword_fingerprint, document_type_slug, 0.80);
    if (bg) templateId = bg.id;
  }
  // Part E again, on the reuse ACQUISITIONS: the same foreign template the doc-link check above
  // detached is re-acquirable by findByLogoHash at the same hamming distance (the Vellum docs sit
  // at dist 4 from the Copperfield set — inside the strict reuse gate).
  if (templateId && !_supplierLinkOk(templateId)) {
    templateId = null;
    supplierDetached = true;
  }

  if (templateId) {
    // Update existing (or now logo-matched) template. update() STABILISES the
    // stored identity across confirms (intersect-with-floor on the keyword
    // fingerprint; keep an established logo_phash) so one noisy sample's OCR
    // garble / per-document tokens can't poison Stage 0 matching and strand the
    // learned anchors — see templates.stabiliseFingerprint / chooseLogoPhash.
    templates.update(db, templateId, { logo_phash, logo_detail_hash, keyword_fingerprint, fields });
    // BUYER-ISSUED MARK (migration 66): record that this layout came from a PO-shaped document —
    // the class behind Chris's "40 documents from two other companies under MY company's name".
    // Recorded on every confirm, so a template that predates the column earns its mark the next
    // time it is confirmed rather than needing a backfill. Recording is unconditional and free;
    // ACTING on it is Python's, behind TEMPLATE_BUYER_ISSUED_TYPE_SCOPE (DEFAULT OFF).
    try { templates.markBuyerIssued(db, templateId, dtInfo); } catch {}
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
    // type-scoped reuse found a RIGHT-type template to converge onto (Oracle C4a), OR when Part E
    // detached a wrong-SUPPLIER link and a different (same-supplier) template was legitimately reused.
    if (!doc.template_id || retypedLink || supplierDetached) {
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

    try { templates.markBuyerIssued(db, newTemplateId, dtInfo); } catch {}   // migration 66, see above

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

// TEMPLATE_FREEZE_ISSUER_ONLY (kill switch, DEFAULT OFF — eric design + measurement 2026-08-08).
// Mirrors trust._shadowRowSkipEnabled exactly: env wins IN BOTH DIRECTIONS so an A/B arm is
// unambiguous, else the setting, and try/catch defaults OFF because test_build_template_fields.js
// builds a fixture DB with no `settings` table at all.
function _freezeIssuerOnlyEnabled(db) {
  const env = process.env.TEMPLATE_FREEZE_ISSUER_ONLY;
  if (env === '1') return true;
  if (env === '0') return false;
  try {
    return require('../../../database/modules/learning')
      .getSetting(db, 'template_freeze_issuer_only', 'false') === 'true';
  } catch { return false; }
}

// TEMPLATE_FREEZE_QUALIFY — env wins in BOTH directions so an A/B arm is unambiguous, then the
// setting. try/catch → OFF, because test_build_template_fields.js builds a fixture DB with no
// settings table (the same shape as _freezeIssuerOnlyEnabled above, deliberately).
function _freezeQualifyEnabled(db) {
  const env = process.env.TEMPLATE_FREEZE_QUALIFY;
  if (env === '1') return true;
  if (env === '0') return false;
  try {
    return require('../../../database/modules/learning')
      .getSetting(db, 'template_freeze_qualify', 'false') === 'true';
  } catch { return false; }
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
  // variable. ⚠ CORRECTED 2026-08-08: this block used to claim the bias "self-heals an already-
  // frozen field on the next confirm". It does NOT. This builder is reached only via
  // _upsertTemplate — from promote-to-template, link-document-to-template, and the onTaughtConfirm
  // hook, which reviewService fires only when `taught_fields` is non-empty. An ordinary confirm and
  // the whole auto-file path never rebuild, and even a rebuild skips keys that are blank on the
  // healing document. See rule (C) below for why the freeze also manufactures its own evidence.
  // Variable fields get no anchor_label here — they are templated by the
  // user-taught ⊕ field-anchor tool (Stage 2) / drawn mappings (Stage 0.5),
  // which are coordinate-based and immune to text-substring collisions.
  const { isNameLikeField } = require('../../../database/modules/learning');
  const { freezeDeclineReason } = require('../../../database/modules/freeze_guard');
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
  // Shared with the P2 foreign-row drop (reviewService.confirm + _autoFileDoc) via foreignFields.js,
  // so the keep-predicate can't drift between the template builder and the storage-scope fix.
  const ownField = require('../../lib/foreignFields').ownFieldPredicate(dtInfo);
  // (C) FREEZE NOTHING BUT THE ISSUER (kill switch, default OFF). MEASURED 2026-08-08 on a 10-issuer
  // teach test: `_annotateFieldVariability` marks only ref/date/date-typed/currency-typed fields
  // variable (document_types.js:222-227), so a TEXT-typed code field — po_ref, serials, account_no —
  // can never be schema-variable; `multiValued` needs >=2 distinct CONFIRMED values, which a single
  // taught document cannot supply; and rule (B) covers NAME-like fields only. So those fields froze
  // to the taught document's value and were stamped on every sibling as template_fixed @95 (above
  // the 88 auto-file floor): expected 'PO-85510', got 'PO-78567'.
  // It is SELF-REINFORCING, which is why the "self-heals on the next confirm" claim above is false:
  // this builder is only reached from _upsertTemplate, and neither the auto-file path nor an
  // ordinary human confirm rebuilds — so every stamped value is re-confirmed as evidence that the
  // field is constant, and `multiValued` never fires. The freeze manufactures its own proof.
  // Measured on the sandbox: every frozen field ALSO has a taught Stage-0.5 mapping, and the stamp
  // only wins where that mapping produced nothing (po_ref: mapping x29 vs fixed x7) — so this
  // removes a WRONG FALLBACK, not a reader. The genuine-constant case is served better by
  // supplier_hints (>=2 usages, supplier-scoped, capped at 90, fill-empty-only) and by the admin's
  // explicit fixed_locked. The issuer is untouched, in either direction.
  const freezeIssuerOnly = _freezeIssuerOnlyEnabled(db);

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
      const nonIssuerBlocked = freezeIssuerOnly && !companyKeys.includes(key);
      // (D) QUALIFY THE VALUE ITSELF (kill switch, default OFF). Rules A-C ask what KIND of field
      // this is; none of them looks at what is about to be written. So the wizard's draw-box OCR
      // read becomes a permanent value at conf 95 whatever it says — and on the live install that
      // froze the literal string 'VAT' as a template's VAT number, stamped on 21 of 145 documents.
      // Nothing downstream can catch it: `template_fixed` is on the exempt list of essentially
      // every credibility rail in engine.py, deliberately, because it is meant to be a human-set
      // literal. This is the last point of control. See database/modules/freeze_guard.js for the
      // three arms and the two exclusions (the issuer is never governed; fixed_locked is never
      // touched). A decline leaves the field VARIABLE — re-extracted per document, exactly as an
      // unfrozen field always was — never a capped or noted stamp, which was ruled dominated.
      const declineReason = _freezeQualifyEnabled(db)
        ? freezeDeclineReason(key, value, meta, { companyKeys,
            extraCaptions: (dtInfo?.fields || []).map(f => f && f.label) })
        : null;
      // (E) A LIST-typed field NEVER freezes (2026-08-11, gary + Oracle — the real lever for the
      // serials defect class: template_fixed 'Serial No:' ×24 in the live DB). A list is
      // per-document by construction; unconditional, no kill switch — freezing one is never right.
      const listTyped = meta && String(meta.type || '').toLowerCase() === 'list';
      const isVariable = schemaVariable || multiValued.has(key) || recipientName
                         || nonIssuerBlocked || !!declineReason || listTyped;
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
    try { if (ctx.generateSampleAngle) await ctx.generateSampleAngle(res.templateId); } catch (e) { console.warn('Graduation sample-angle failed:', e.message); }
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
