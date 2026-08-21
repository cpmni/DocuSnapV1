'use strict';

/**
 * services/reviewService.js
 * -------------------------
 * Transport-agnostic document-review orchestration (confirm / defer / restore + queue reads),
 * shared by the desktop IPC handler and (Phase 3) the detached-client `/v1` API. Takes an
 * explicit `actor { username, role }` so the SAME rules apply on every transport.
 *
 * Design (locked in the plan):
 *  - AUTH + the workflow lock are enforced by the CALLER at its edge (desktop: requireUnlocked
 *    throws; API: editGuard → 403) — the service trusts the actor it's handed.
 *  - CONFIRM CLAIMS the document atomically (documents.confirmIfReviewable) BEFORE filing, so
 *    two confirms of one doc (two clients, a client vs the desktop, auto-file vs manual) can't
 *    both file it — the loser gets ALREADY_FILED with the winner's name. A re-file (an already-
 *    confirmed doc, "Edit in Review") skips the claim (it can't lose a needs_review race, and a
 *    claim-then-rollback would strand its filed state) — but ONLY when the caller passes an
 *    explicit `allowRefile` intent, so a queue confirm that raced into an already-filed doc still
 *    loses cleanly (ALREADY_FILED) instead of silently overwriting the first reviewer.
 *  - The Electron-only steps (source-move, landmark capture, taught-confirm template promote,
 *    count broadcast) are INJECTED hooks so the desktop path is byte-identical and the API path
 *    simply omits them.
 */

function fail(code, error, extra) { return { ok: false, success: false, code, error, ...(extra || {}) }; }

function createReviewService(deps = {}) {
  const documents = deps.documents || require('../../database/modules/documents');
  const learning  = deps.learning  || require('../../database/modules/learning');
  const doctypes  = deps.doctypes  || require('../../database/modules/document_types');
  const templates = deps.templates || require('../../database/modules/templates');
  const prefixOutlier = deps.prefixOutlier || require('../../database/modules/prefix_outlier');
  const filing    = deps.filing    || require('../modules/filing/handler');
  const foreignFields = deps.foreignFields || require('../lib/foreignFields');
  const fs   = deps.fs   || require('fs');
  const path = deps.path || require('path');
  const logger = deps.logger || null;
  const audit  = deps.audit || (() => {});
  // Optional Electron-only hooks — no-ops for the API path.
  const onScheduleSourceMove = deps.onScheduleSourceMove || (() => {});
  const onTaughtConfirm      = deps.onTaughtConfirm      || (async () => {});
  const onScopeGraduated     = deps.onScopeGraduated     || (async () => {});
  const learnTemplateOnCommit = deps.learnTemplateOnCommit || (async () => {});   // Slice 1: identity convergence on every commit (dark)
  const captureSample        = deps.captureSample        || (async () => {});
  const notifyCounts         = deps.notifyCounts         || (() => {});
  const captureRouteContext  = deps.captureRouteContext  || (() => null);   // Slice 3: total trust ctx captured pre-note-clear
  const startDefaultRoute    = deps.startDefaultRoute    || (() => {});     // Slice 3: amount-threshold auto-route (detached)
  const releaseDelayMs       = deps.releaseDelayMs != null ? deps.releaseDelayMs : 0;
  // Slice 1 (2026-08-21): after a HUMAN confirm lands, tell the scope-local auto-accept scheduler
  // (processing/handler). Fired for every human confirm — desktop, File-All, /v1 — which is why it
  // lives here and not on a renderer timer. Fire-and-forget; can never affect the returned confirm.
  const onAfterConfirm       = deps.onAfterConfirm       || (() => {});

  // ── Queue reads (Admin/Edit; the caller gates) ────────────────────────────────
  const queue    = (db) => documents.getReviewQueue(db);
  const deferred = (db) => documents.getDeferredQueue(db);
  const counts   = (db) => ({ review: documents.getReviewCount(db), deferred: documents.getDeferredCount(db) });

  // ── Confirm / file ────────────────────────────────────────────────────────────
  async function confirm(db, actor, payload, internal = {}) {
    const {
      document_id,
      corrections, allValues, supplier_name,
      document_type, document_type_slug, taught_fields, bulk,
    } = payload || {};
    // Machine-confirm sentinels, set ONLY by server-side call sites via the INTERNAL arg —
    // never from the renderer/client payload (a compromised client must not be able to label
    // its confirms as machine confirms or vice versa). Anything outside the exact set collapses
    // to null (human/legacy). 'scope_sweep' = Catch-up Filing accept (design 2026-07-31);
    // 'auto_reprocess' = the post-reprocess consent-bar accept (Oracle-signed 2026-08-12 —
    // replaces the renderer queue-wide autoCommitFullConfidence sweep that filed as the human).
    const _VIA_SENTINELS = ['scope_sweep', 'auto_reprocess'];
    const _via = internal && _VIA_SENTINELS.includes(internal.via) ? internal.via : null;
    const actorName = (actor && actor.username) || null;
    const _t0 = Date.now();   // confirm return-latency probe (logged below when diag logging is on)

    const docRow = documents.getById(db, document_id);
    if (!docRow) return fail('NOT_FOUND', 'Document not found.');
    // SECURITY (Stage 1 — H1/M12): the on-disk source paths are resolved SERVER-SIDE from the doc
    // row, NEVER from the payload (which carries field VALUES only). This mirrors the /v1 confirm
    // path (api/handler.js), which already reads folder_path/original_filename from the row. Without
    // this, a compromised/replaced renderer could aim filing's copy-in (arbitrary file → output
    // tree) or the deferred source-unlink (arbitrary file delete) at any host path it named.
    const folder_path       = docRow.folder_path || null;
    const original_filename = docRow.original_filename || null;
    const workingPath = docRow.working_path || null;
    // PREVIOUSLY-FILED copy: the doc's current filed copy, captured REGARDLESS of status and
    // BEFORE the claim below (which nulls the row's stored_path). Two cases carry one:
    //   • an already-confirmed doc ("Edit in Review" / re-surfaced auto-filed doc), and
    //   • a doc that was filed, then sent back to the review queue by Learning Repair
    //     (deconfirmDocument KEEPS stored_path). In BOTH, passing it as existingFiledPath makes
    //     the re-confirm REPLACE the original copy IN PLACE instead of minting a -DUPLICATE.
    const oldStoredPath = (docRow && docRow.stored_path) ? docRow.stored_path : null;

    // NO-PAGE GUARD (Chris round 5, card 1): never file a document whose scanned page is gone.
    // The reconcileHolding fix stops NEW page loss, but a doc damaged by the old startup sweep —
    // or by OneDrive dehydration, a manual file deletion, or a crash — can still reach here with a
    // stale working_path and no file on disk. Filing would fail deep in commitDocument with a raw
    // "Source file not found: <path>"; refuse EARLY (before the claim, so no status churn) with a
    // message the operator can act on. Mirrors filing.commitDocument's copyFrom precedence exactly.
    const _srcPath = (folder_path && original_filename) ? path.join(folder_path, original_filename) : null;
    const _hasPage = (workingPath   && fs.existsSync(workingPath))
                  || (oldStoredPath && fs.existsSync(oldStoredPath))
                  || (_srcPath      && fs.existsSync(_srcPath));
    if (!_hasPage) {
      return fail('NO_SOURCE_FILE',
        "The scanned page for this document is no longer available, so it can’t be filed. "
        + "Its details are still in Search — you can delete this entry from the queue.");
    }

    // isRefile = SKIP the atomic claim. Only an ALREADY-CONFIRMED doc with explicit caller intent
    // does so ("Edit in Review"; renderer: allowRefile = status==='confirmed'). A confirm from the
    // review QUEUE (needs_review — incl. a Learning-Repair send-back) must still CLAIM (so a lost
    // race gets ALREADY_FILED, not a last-writer overwrite), yet it still replaces its own old copy
    // in place via oldStoredPath above. The /v1 client never sets allowRefile (server-decided).
    const isRefile = !!oldStoredPath && docRow.status === 'confirmed' && !!(payload && payload.allowRefile === true);

    const dtInfo = document_type_slug ? doctypes.getWithFields(db, document_type_slug) : null;

    // CENTRAL DATE NORMALISATION — the ONE point where a submitted date becomes the core's
    // canonical DD-MM-YYYY. Whatever a client (desktop or /v1) sends (a user might type
    // "Aug 03 2012", "2012-08-03", "3/8/2012"), normalise it HERE, before BOTH filing and the
    // learned corrections, so the stored value, the filename and the learning corpus all agree
    // and no client re-implements date parsing. Unparseable values are left as typed (never
    // dropped). Reuses filing.normaliseDate (same logic the filename builder uses).
    if (dtInfo && allValues && typeof filing.normaliseDate === 'function') {
      const dateKeys = new Set();
      if (Array.isArray(dtInfo.fields)) for (const f of dtInfo.fields) if (f && f.type === 'date') dateKeys.add(f.key);
      if (dtInfo.date_field_key) dateKeys.add(dtInfo.date_field_key);
      for (const k of dateKeys) {
        const norm = filing.normaliseDate(allValues[k]);
        if (norm && norm !== allValues[k]) {
          allValues[k] = norm;
          if (corrections && corrections[k] && corrections[k].corrected_value != null) {
            corrections[k].corrected_value = norm;
          }
        }
      }
    }

    const outputRoot = learning.getSetting(db, 'output_folder', null);
    if (!outputRoot) return fail('NO_OUTPUT', 'No output folder set. Please configure it in Settings.');

    // ── PREFIX-OUTLIER confirm gate (Slice 1, cold-start) ────────────────────────────────────────
    // The extraction-time prefix guard is INERT on a first bulk import (its history snapshot is
    // empty), so RE-CHECK the reference here against LIVE confirmed history and HOLD an odd-one-out
    // for review BEFORE it files. Flag-only + PRE-CLAIM: writes a review note, leaves the doc
    // needs_review; nothing is claimed or filed. Exempt: a re-file, a human-typed value (a
    // correction), and an explicit acknowledge ("Confirm anyway"). Dual kill switch (env + setting).
    // Reuses the SAME weight-aware predicate as the Python extraction guard (prefix_outlier.js
    // mirrors ocr_corrector.py; parity pinned by test_prefix_outlier.js). ADVISORY: a gate error
    // fails OPEN (never blocks a confirm), like the Python guard.
    if (!isRefile && dtInfo && dtInfo.ref_field_key
        && process.env.PREFIX_OUTLIER_CONFIRM_GUARD !== '0'
        && learning.getSetting(db, 'prefix_outlier_confirm_guard_enabled', 'true') !== 'false') {
      try {
        const refKey = dtInfo.ref_field_key;
        const refVal = allValues ? allValues[refKey] : null;
        const humanCorrected = !!(corrections && corrections[refKey] && corrections[refKey].corrected_value != null);
        const acked = Array.isArray(payload && payload.acknowledgePrefixOutlier)
                   && payload.acknowledgePrefixOutlier.includes(refKey);
        if (refVal && !humanCorrected && !acked) {
          const scopeSupplier = (allValues && allValues.supplier_name) || supplier_name || null;
          const rec = learning.getPrefixModelForScope(db, scopeSupplier, document_type_slug, refKey);
          const chk = prefixOutlier.checkValue(refVal, rec);   // { outlier, prefix, dominant }
          if (chk.outlier) {
            db.prepare('UPDATE extractions SET validation_note = ? WHERE document_id = ? AND field_key = ?')
              .run(`Reference starts "${chk.prefix}-" but this sender's usually start "${chk.dominant}-" - please check.`,
                   document_id, refKey);
            audit(db, { action: 'confirm_held_prefix_outlier', target_type: 'document', target_id: document_id,
              document_id, outcome: 'held', actor_username: actorName,
              metadata: { field: refKey, dominant: chk.dominant, prefix: chk.prefix } });
            notifyCounts(db);
            return fail('PREFIX_OUTLIER', 'The reference looks unusual for this sender - please review.',
              { field: refKey, dominant: chk.dominant, prefix: chk.prefix });
          }
        }
      } catch (e) {
        if (logger && logger.warn) logger.warn('prefix-outlier confirm gate skipped: ' + (e && e.message));
      }
    }

    // ── ISSUER NEAR-MATCH confirm gate (Chris round 6; issuer_near_match_confirm_guard, default ON) ─
    // A Document Issuer that is 1-2 characters off a company you ALREADY use would file this sender
    // into a SECOND folder and split it across two Search identities. The teach-time challenge
    // (findNearMatchIdentity, Tier A human confirms + Tier B frozen template identities) catches it
    // at the ⊕ draw and the wizard, but NOT on a TYPED correction into the issuer field — the path
    // a customer actually uses, and the one Chris drove into a `Drambiewood-Joinery-Ltd` folder.
    // This is that check at the LAST gate before filing, so no route can misfile a near-miss silently.
    // Unlike the prefix guard, a HUMAN-TYPED value is NOT exempt — a typo is exactly what this catches.
    // PRE-CLAIM + advisory (a gate error fails OPEN). Exempt: a re-file, and an explicit acknowledge
    // ("Keep what I typed"). Bulk callers pass no acknowledge, so a near-miss is HELD (left in the
    // queue) rather than bulk-filed. Dual kill switch (env + setting).
    if (!isRefile
        && process.env.ISSUER_NEAR_MATCH_CONFIRM_GUARD !== '0'
        && learning.getSetting(db, 'issuer_near_match_confirm_guard', 'true') !== 'false') {
      try {
        const issuerVal = (allValues && allValues.supplier_name != null) ? String(allValues.supplier_name).trim() : '';
        const acked = !!(payload && payload.acknowledgeIssuerNearMatch === true);
        if (issuerVal && !acked) {
          const nm = learning.findNearMatchIdentity(db, issuerVal);
          if (nm && nm.near && issuerVal.toLowerCase() !== String(nm.existing).toLowerCase()) {
            audit(db, { action: 'confirm_held_issuer_near_match', target_type: 'document', target_id: document_id,
              document_id, outcome: 'held', actor_username: actorName,
              metadata: { typed: issuerVal, existing: nm.existing, distance: nm.distance, source: nm.source } });
            return fail('ISSUER_NEAR_MATCH',
              `"${issuerVal}" looks like "${nm.existing}", a company you already use — please check the issuer.`,
              { nearMatch: { existing: nm.existing, distance: nm.distance, confirms: nm.confirms, source: nm.source } });
          }
        }
      } catch (e) {
        if (logger && logger.warn) logger.warn('issuer near-match confirm gate skipped: ' + (e && e.message));
      }
    }

    // CLAIM before filing (first-confirm only) so a lost race can't double-file. The loser
    // reads the winner's name off confirmed_by_username and reports it.
    if (!isRefile) {
      // 'auto_reprocess' stamps a machine username so audit/search/banner can tell these files
      // from hand confirms (today's incident forensics needed exactly this). scope_sweep keeps
      // the human name byte-identical — it is a human-CONSENTED action, shipped and flipped ON.
      const claim = documents.confirmIfReviewable(db, document_id, {
        confirmed_by_username: _via === 'auto_reprocess' ? 'Auto-filed (reprocess)' : actorName,
        confirmed_via: _via });
      if (!claim || claim.changes === 0) {
        const winner = documents.getById(db, document_id)?.confirmed_by_username || 'another user';
        return fail('ALREADY_FILED', `This document was already filed by ${winner}.`, { confirmedBy: winner });
      }
    }

    // Release the preview file handle (desktop only; bulk skips it — no preview was loaded).
    if (releaseDelayMs && !bulk) await new Promise(r => setTimeout(r, releaseDelayMs));

    let filingResult;
    try {
      filingResult = await filing.commitDocument({
        db, fs, path, outputRoot,
        folderPath:        folder_path,
        originalFilename:  original_filename,
        workingPath,
        existingFiledPath: oldStoredPath,
        allValues,
        documentType:      document_type || dtInfo?.name,
        dtInfo, logger,
      });
    } catch (e) { filingResult = { success: false, error: e && e.message }; }

    if (!filingResult || !filingResult.success) {
      // Filing failed AFTER the claim — roll the doc back to the queue so it isn't stranded as
      // "confirmed" with no stored file. (A re-file was never re-claimed, so leave it as-is.)
      // The claim nulled stored_*; if this doc was PREVIOUSLY filed (oldStoredPath), restore that
      // pointer so a Learning-Repair send-back doesn't lose track of its still-on-disk copy.
      if (!isRefile) {
        const restore = { status: 'needs_review', confirmed_at: null, confirmed_by_username: null };
        if (oldStoredPath) { restore.stored_path = oldStoredPath; restore.stored_filename = docRow.stored_filename || null; }
        try { documents.update(db, document_id, restore); } catch {}
      }
      logger?.err?.(`Confirm failed: ${original_filename} — ${filingResult && filingResult.error}`);
      return { ok: false, ...filingResult };
    }

    if (logger) {
      const fieldSummary = Object.entries(allValues || {}).filter(([, v]) => v)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' | ');
      logger.log(`Confirmed: ${original_filename} → type=${document_type_slug || '?'}` +
        ` supplier=${allValues?.supplier_name || supplier_name || '?'} filed=${filingResult.filename}` +
        ` (${Date.now() - _t0}ms to file; landmark learning detached)`);
      if (fieldSummary) logger.log(`  Values: ${fieldSummary}`);
    }

    // C7 (2026-07-23, the un-plant's plant-side twin): the desktop panel is fieldDefs-driven, but
    // this service is SHARED (bulk File-All + /v1) and the foreign-row drop below runs AFTER this
    // plant — so a payload carrying foreign keys could learn hints the later row-drop orphans.
    // Filter the LEARNING input through the same keep-predicate + switch (FOREIGN_FIELD_DROP);
    // the original `corrections` object still feeds captureRouteContext below, unfiltered.
    const _learn = foreignFields.filterLearningInput(allValues, corrections || {}, dtInfo);
    // Catch-up LEARNING RULING (Oracle, design 2026-07-31): a machine 'scope_sweep' confirm
    // SKIPS saveCorrections entirely — no hint usage inflation on machine echoes, no
    // corrections rows, no anchor writes (the sweep files stored values verbatim; there is
    // nothing human-taught to learn). Live-DERIVED learning (formats/shapes/prefix — computed
    // from confirmed status at read time) still flows and rolls back cleanly on undo, which is
    // what makes "Undo all" honest. learnTemplateOnCommit self-guards on confirmed_via.
    if (!_via) {
      learning.saveCorrections(db, document_id, _learn.corrections || {}, supplier_name, document_type_slug, _learn.allValues, taught_fields || []);
    }

    // Record the stored location. First-confirm already flipped status/confirmed_at/confirmed_by
    // in the claim; a re-file confirms now (and records who re-filed).
    if (isRefile) {
      documents.confirm(db, document_id, { stored_filename: filingResult.filename, stored_path: filingResult.filePath, confirmed_by_username: actorName });
    } else {
      documents.update(db, document_id, { stored_filename: filingResult.filename, stored_path: filingResult.filePath });
    }

    audit(db, { action: 'review_confirmed', target_type: 'document', target_id: document_id,
      document_id, outcome: 'success', actor_username: actorName,
      metadata: { type: document_type_slug || null, filed: filingResult.filename,
                  fields_changed: Object.keys(corrections || {}).join(',') || null,
                  ...(_via ? { via: _via } : {}) } });

    // Slice 3 (amount routing): capture the total's trust context — its note + confidence — BEFORE the
    // note-clear below wipes it (Oracle A1). No-op (returns null) unless WORKFLOW_AMOUNT_ROUTING is armed,
    // so OFF is byte-identical. Consumed by the detached startDefaultRoute in the !bulk block.
    const _routeCtx = captureRouteContext(db, document_id, corrections || {});

    // Clear pre-confirmation review aids (display-only; not read by learning).
    db.prepare('UPDATE extractions SET validation_note = NULL, corrected_to = NULL WHERE document_id = ?').run(document_id);

    // P2 — drop FOREIGN extraction rows (keys not on this doc's assigned type: the union-of-keys
    // bleed where a delivery docket's bare `Date:` also filled invoice/order/po_date). AFTER the
    // claim + file above, so it can't affect the filing decision. Kill switch FOREIGN_FIELD_DROP=0.
    // Shares _buildTemplateFields' keep-predicate (foreignFields.js) so the two can't drift.
    if (dtInfo) { try { foreignFields.dropForeignExtractions(db, document_id, dtInfo); } catch (e) { logger?.warn?.('foreign-field drop skipped: ' + (e && e.message)); } }

    // ── PERSIST THE OPERATOR'S APPROVED VALUES (gary → Oracle SIGN-OFF-W/COND, 2026-08-18) ──────
    // A value the operator APPROVED without editing never became an extraction row: the
    // confirm-upsert fires only from the corrections loop, and a teach sends `corrections: []` by
    // design. Since `getFieldFormats` reads FROM extractions, a taught document was invisible to
    // the evidence that decides whether its sender can file itself (measured: 9/10 taught docs had
    // no issuer row). Mint a row for any approved value that has none.
    //
    // ORDERING IS LOAD-BEARING — this must stay STRICTLY LAST of the learning writes:
    //   claim → commitDocument → filterLearningInput → saveCorrections → note clear (:303)
    //   → dropForeignExtractions (:309) → persistConfirmedValues (here)
    // so (1) every filing/auto-file decision on THIS document was already made — a minted row can
    // never open its own gate; (2) it cannot resurrect what the drop just removed (it writes only
    // `_learn.allValues`, filtered by the SAME ownFieldPredicate, and runs after the drop).
    //
    // Oracle C1: an EXPLICIT `!_via` guard — the one at :279 closes at :281, so relying on it here
    // would be a machine hole waiting for a refactor. Machine confirms (scope_sweep,
    // auto_reprocess) must never mint evidence for their own future trust.
    // Oracle C3: `dtInfo` mirrored from the drop above — with no field metadata, filterLearningInput
    // is a passthrough and the drop is a no-op, so minting would write rows nothing would ever
    // clean up. A metadata-gap document mints nothing.
    if (!_via && dtInfo && process.env.CONFIRM_PERSIST_VALUES !== '0'
        && (process.env.CONFIRM_PERSIST_VALUES === '1'
            || learning.getSetting(db, 'confirm_persist_values', 'false') === 'true')) {
      try { learning.persistConfirmedValues(db, document_id, _learn.allValues); }
      catch (e) { logger?.warn?.('confirmed-value persist skipped: ' + (e && e.message)); }
    }

    // The working copy has served its purpose — remove it + clear the pointer.
    if (workingPath) {
      try { if (fs.existsSync(workingPath)) fs.unlinkSync(workingPath); } catch {}
      documents.update(db, document_id, { working_path: null });
    }

    // RE-FILE cleanup: remove the OLD filed copy + its metadata, only after the new copy + the
    // new stored_path are recorded (no data-loss window). Same-location overwrite → nothing to do.
    if (oldStoredPath && filingResult.filePath && path.resolve(oldStoredPath) !== path.resolve(filingResult.filePath)) {
      try { if (fs.existsSync(oldStoredPath)) fs.unlinkSync(oldStoredPath); } catch {}
      try {
        const oldExt = path.extname(oldStoredPath);
        const oldXml = path.join(path.dirname(oldStoredPath), '.metadata', path.basename(oldStoredPath, oldExt) + '.xml');
        if (fs.existsSync(oldXml)) fs.unlinkSync(oldXml);
      } catch {}
    }

    // Denormalised search fields.
    const refField  = dtInfo?.ref_field_key  || 'invoice_number';
    const dateField = dtInfo?.date_field_key || 'invoice_date';
    documents.update(db, document_id, {
      supplier_name:    (allValues && allValues.supplier_name) || supplier_name || null,
      doc_date:         (allValues && allValues[dateField]) || null,
      reference_number: (allValues && allValues[refField]) || null,
      document_type_id: dtInfo?.id || null,
    });

    // TEMPLATE SUPPLIER-LINK GUARD (Oracle condition A on the template-misfile fix, 2026-07-20).
    // A doc Stage-0-matched to ANOTHER supplier's template keeps that template_id through confirm —
    // Part D (review/handler.js _upsertTemplate) detaches on TYPE mismatch only, so an invoice
    // mis-matched to a foreign invoice template survives here. The stale link then poisons the
    // wrong template on a PLAIN confirm through three doors: its LIVE confirmed_count (matcher
    // tiebreaks), its dominant_supplier distribution (the identity key for the branding banks and
    // gates), and captureSample below (this foreign page would become a LANDMARK SAMPLE of the
    // wrong template). Detach ONLY when the confirmed issuer is NAME-DISJOINT from the template's
    // established identity (zero shared distinctive tokens — a suffix/variant spelling shares one
    // and keeps the link); an unjudgeable identity keeps the link (fail toward today). Runs for
    // bulk confirms too — the count/dominant doors are derived state, not hooks.
    if (process.env.TEMPLATE_SUPPLIER_LINK_GUARD !== '0') {
      try {
        const linkId = db.prepare('SELECT template_id FROM documents WHERE id = ?').get(document_id)?.template_id;
        const confirmedIssuer = (allValues && allValues.supplier_name) || supplier_name || null;
        if (linkId && confirmedIssuer) {
          // SELF-INDEPENDENT identity (TEMPLATE_GUARD_SELF_INDEPENDENT, 2026-07-21): judge the
          // template's identity from its OTHER confirmed docs — this doc is ALREADY confirmed +
          // linked + supplier_name=confirmedIssuer at this point, so a plain establishedIdentity
          // counts it against itself and the guard compares the issuer to itself (never disjoint →
          // never detaches → the wrong template's dominant is permanently poisoned). Passing
          // document_id removes the self-vote. OFF ('0') ⇒ excludeDocId=null ⇒ byte-identical.
          const _selfIndep = process.env.TEMPLATE_GUARD_SELF_INDEPENDENT !== '0';
          const ident = templates.establishedIdentity(db, linkId, _selfIndep ? document_id : null);
          if (ident && templates.supplierNamesDisjoint(confirmedIssuer, ident)) {
            documents.update(db, document_id, { template_id: null });
            if (logger) logger.log(`  Supplier-link guard: detached template ${linkId} (${ident}) from doc ${document_id} — confirmed issuer '${confirmedIssuer}'`);
          }
        }
      } catch { /* guard is best-effort; a failure must never affect the confirm */ }
    }

    if (filingResult.srcPath) onScheduleSourceMove({ srcPath: filingResult.srcPath, originalFilename: original_filename });
    notifyCounts(db);

    // Cross-sample landmark learning + taught-confirm auto-promote (best-effort). Both SPAWN a
    // Python landmark subprocess and were AWAITED here — the dominant slice of the single-confirm
    // pause the operator felt before the next doc loaded. They are now DETACHED (fire-and-forget)
    // so confirm RETURNS immediately after the DB claim/file/counts: filing and the double-file
    // claim do NOT depend on them, they already ran AFTER all persistence + notifyCounts, and each
    // is try/caught + resolves-on-error. SKIPPED in bulk exactly as before (the !bulk guard). A
    // detached rejection is swallowed so it can't surface as an unhandledRejection; a concurrent
    // same-template regen from two quick confirms is benign (setLandmarks is last-write-wins over
    // equivalent landmark sets, the manual-landmark case is guarded, and the startup backfill
    // regenerates redundantly anyway). Ordered captureSample→onTaughtConfirm, as before. (Oracle B+.)
    if (!bulk) {
      Promise.resolve().then(async () => {
        try {
          const tId = documents.getById(db, document_id)?.template_id || null;
          if (tId) await captureSample(tId, document_id);
        } catch (e) { console.warn('Landmark sample capture on confirm failed:', e.message); }
        if (Array.isArray(taught_fields) && taught_fields.length && (document_type_slug || dtInfo)) {
          try { await onTaughtConfirm(db, document_id, { allValues, document_type_slug, supplier_name, dtInfo }); }
          catch (e) { console.warn('Auto-promote on taught confirm failed:', e.message); }
        }
        // Graduation auto-template (best-effort): the first confirm that GRADUATES a (supplier,type)
        // scope with no template yet mints one, so its sub-100 docs can auto-file. Runs AFTER
        // onTaughtConfirm so a taught confirm's template already exists → the hook's existence check
        // sees it and links/skips instead of double-creating (Oracle ordering condition). Fires on
        // EVERY non-bulk confirm (outside the taught_fields guard) — the common graduation case has
        // no taught fields. The hook self-gates on scopeTrust + kill switch + a "no template yet"
        // check; a failure here can never affect the already-returned confirm.
        try { await onScopeGraduated(db, document_id, { allValues, document_type_slug, supplier_name, dtInfo }); }
        catch (e) { console.warn('Graduation auto-template failed:', e.message); }
        // Slice 1 (learn-on-commit): AFTER graduation may have created/linked the template, keep its
        // identity converging on this confirm (kill switch template_learn_on_confirm, DEFAULT OFF ⇒
        // no-op). SKIP a taught confirm — onTaughtConfirm already enriched via templates.update. The
        // hook self-gates on a resolvable same-type/same-supplier template; a failure can never affect
        // the already-returned confirm.
        if (!(Array.isArray(taught_fields) && taught_fields.length)) {
          try { await learnTemplateOnCommit(db, document_id, { document_type_slug, supplier_name }); }
          catch (e) { console.warn('Learn-on-commit failed:', e.message); }
        }
      }).catch(() => {});
    }

    // HOLD THE SIBLINGS — the release (owner decision 4, 2026-08-13). When a teach replaced a
    // template's frozen identity with a genuinely DIFFERENT company, that template's other
    // documents are held below full confidence until a SECOND document agrees. This is where
    // agreement is observed: a human has just confirmed a document bound to the template, and the
    // issuer they confirmed either matches the new frozen name or does not. One agreeing document
    // releases the hold; the teach itself never counts, because it is the evidence being tested.
    // Runs on BOTH bulk and single confirms (a filed doc is a filed doc, Oracle D2), inert unless
    // the column exists AND the flag is armed, and can never affect the already-returned confirm.
    // A TAUGHT confirm is SKIPPED (Oracle blocking condition, 2026-08-16): the teach is the very
    // evidence being tested, so its own confirm may not release the hold it is about to create.
    // Before the identical-rewrite fix this was true only by ordering accident — the detached
    // onTaughtConfirm re-write RE-marked the template after this release ran; with identical
    // rewrites no longer marking, an unguarded release here would let a genuine-change teach
    // self-release and the round-4 protection (20 siblings @95, 12 misfiled) would die silently.
    try {
      if (!(Array.isArray(taught_fields) && taught_fields.length)) {
        const _tid = (documents.getById(db, document_id) || {}).template_id;
        if (_tid) {
          require('../../database/modules/templates')
            .noteIdentitySupported(db, _tid, (allValues && allValues.supplier_name) || supplier_name || '');
        }
      }
    } catch (e) { logger?.warn?.('identity-hold release skipped: ' + (e && e.message)); }

    // Routing (SEAM A/A'): auto-create an approval route from the extracted total/type. Fires on BOTH
    // bulk and non-bulk confirms — a filed doc is a filed doc (Oracle D2); the !bulk guard above exists
    // only to throttle the Python-spawning landmark hooks, which routing is not. Detached + fail-open
    // (can never affect the already-returned confirm). NOT on a re-file (Oracle B1 — an "Edit in Review"
    // of a settled doc must not spawn a second route); the engine self-guards on the kill switch + real
    // entitlement + hasActiveRoute.
    if (!isRefile) {
      Promise.resolve().then(() => {
        startDefaultRoute(db, document_id, _routeCtx, {
          actor,
          supplierName: (allValues && allValues.supplier_name) || supplier_name || null,
          slug: document_type_slug || (dtInfo && dtInfo.slug) || null,
          documentTypeId: (dtInfo && dtInfo.id) || null,
        });
      }).catch(() => {});
    }

    // Slice 1 (learn-on-commit) — the !bulk chain above is SKIPPED on File-All/bulk, but bulk is the
    // owner's common route, so mirror the hook here for bulk exactly as routing fires on both. Bulk
    // carries no taught_fields, so no taught-skip is needed. Detached + fail-open + self-gated on the
    // kill switch (DEFAULT OFF ⇒ byte-identical).
    if (bulk) {
      Promise.resolve().then(() => learnTemplateOnCommit(db, document_id, { document_type_slug, supplier_name }))
        .catch(() => {});
    }

    // ── THE HUMAN-LICENSED CLASS CORRECTION (gary + reggie → Oracle S-O-W/COND, 2026-08-19) ──────
    // The operator corrected one reference by a single confusable glyph inside its prefix ('P1/' →
    // 'PI/'). Apply that same byte-exact substitution to the other QUEUED documents of this sender
    // and tell them afterwards, with an undo. Owner's ask: no dialog beforehand, and NO second
    // dialog after — "if the user has already told us it is correct, there is no need".
    //
    // PLACEMENT (Oracle C7): LAST, after every effect of THIS confirm has landed, as its own
    // transaction — never nested inside another. Its own explicit `!_via` check rather than
    // borrowing the one at :279 (that guard closes at :281; leaning on it from here is the machine
    // hole a refactor opens, the same ruling as persistConfirmedValues). `!bulk` because File-All
    // iterates confirms, and a propagation firing mid-loop would rewrite siblings the loop has
    // already read into memory. Fail-open: this can never fail an already-completed confirm.
    let _classFix = null;
    if (!_via && !bulk && dtInfo) {
      try {
        _classFix = require('./classFixService').applyForConfirm(db, {
          documentId: document_id, corrections: corrections || {},
          supplierName: (allValues && allValues.supplier_name) || supplier_name || null,
          typeSlug: document_type_slug || (dtInfo && dtInfo.slug) || null,
          dtInfo, actorName, learning, audit,
          presence: (() => { try { return require('./presenceService').shared(); } catch { return null; } })(),
          logger,
        });
      } catch (e) { logger?.warn?.('class fix skipped: ' + (e && e.message)); }
    }

    // Slice 1 trigger (S1-C3): HUMAN confirms only — its own explicit `!_via` (same ruling as the
    // two guards above: never lean on a closed guard). A machine-filed doc (scope_sweep / auto_*)
    // never re-triggers, so the auto-accept cannot chain. `bulk` confirms DO trigger — File-All is
    // the moment a sender crosses the line — and the scheduler debounces the burst into one pass.
    if (!_via) {
      try {
        onAfterConfirm(db, { document_id, supplier_name: (allValues && allValues.supplier_name) || supplier_name || null,
                             typeSlug: document_type_slug || (dtInfo && dtInfo.slug) || null, bulk: !!bulk, via: null });
      } catch (e) { logger?.warn?.('onAfterConfirm skipped: ' + (e && e.message)); }
    }

    return { ok: true, success: true, ...filingResult, ...(_classFix ? { classFix: _classFix } : {}) };
  }

  // ── Defer / restore (status-guarded) ──────────────────────────────────────────
  function defer(db, actor, docId) {
    const r = documents.deferIfReviewable(db, docId);
    if (!r || r.changes === 0) return fail('NOT_REVIEWABLE', 'This document is no longer in the review queue.');
    audit(db, { action: 'review_deferred', target_type: 'document', target_id: docId, document_id: docId,
      outcome: 'success', actor_username: (actor && actor.username) || null });
    notifyCounts(db);
    return { ok: true, success: true };
  }

  function restore(db, actor, docId) {
    const r = documents.restoreIfDeferred(db, docId);
    if (!r || r.changes === 0) return fail('NOT_DEFERRED', 'This document is no longer deferred.');
    audit(db, { action: 'review_restored', target_type: 'document', target_id: docId, document_id: docId,
      outcome: 'success', actor_username: (actor && actor.username) || null });
    notifyCounts(db);
    return { ok: true, success: true };
  }

  return { queue, deferred, counts, confirm, defer, restore };
}

module.exports = { createReviewService, fail };
