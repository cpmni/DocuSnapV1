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
const os   = require('os');

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
  const { requireRole, logAudit } = require('../auth/handler');   // Stage 5a: audit destructive template ops

  // Resolve a document row to an on-disk file (managed working copy preferred,
  // then the filed/stored location) — mirrors the preview/reprocess resolution.
  function _resolveDocPath(doc) {
    if (!doc) return null;
    const ok = (p) => (p && fs.existsSync(p) ? p : null);
    // stored_path is the FULL path to the FILED file (set on confirm) — use it once the
    // doc is COMMITTED; working_path is the app's inbox copy — the UNCOMMITTED version
    // before filing. Then fall back to the source folder. (The old code treated
    // stored_path as a directory and join()'d the filename onto it, so a committed doc
    // whose working copy had since been cleaned up resolved to nothing → "sample file
    // not found".)
    return ok(doc.stored_path)
        || ok(doc.working_path)
        || ok(doc.folder_path && doc.stored_filename   ? path.join(doc.folder_path, doc.stored_filename)   : null)
        || ok(doc.folder_path && doc.original_filename ? path.join(doc.folder_path, doc.original_filename) : null);
  }

  // Generate registration landmarks from a template's pinned sample page and
  // store them (templates.setLandmarks). Best-effort + async: a failure never
  // blocks pinning/mapping — the template simply falls back to the existing
  // anchor/offset path until landmarks exist. Reuses the same Python/Tesseract
  // the rest of processing uses (ocr/landmarks.py). This is the SAME mechanism
  // for new templates (auto on sample pin) and the existing-corpus backfill.
  // Taught value/anchor zones the auto landmark selector must AVOID — those regions
  // hold per-document VALUES, never stable chrome (Phase 2 value-zone exclusion).
  function _excludeBoxesFor(db, templateId) {
    const boxes = [];
    try {
      for (const m of (templates.getMappings(db, templateId) || [])) {
        if (m.target_x_norm != null) boxes.push({ x: m.target_x_norm, y: m.target_y_norm, w: m.target_w_norm, h: m.target_h_norm });
        if (m.anchor_x_norm != null) boxes.push({ x: m.anchor_x_norm, y: m.anchor_y_norm, w: m.anchor_w_norm, h: m.anchor_h_norm });
      }
    } catch (e) { /* best-effort */ }
    return boxes;
  }

  // Capture a confirmed document's high-conf words into the cross-sample corpus
  // (Phase 3). Best-effort + async — one OCR spawn; never blocks/raises into the
  // confirm path. Idempotent per doc (replaceSampleWords).
  function captureSampleWords(templateId, docId) {
    return new Promise((resolve) => {
      try {
        const db = getDb();
        if (!templateId || templates.hasManualLandmarks(db, templateId)) return resolve(false);
        const doc  = db.prepare('SELECT * FROM documents WHERE id = ?').get(docId);
        const file = _resolveDocPath(doc);
        if (!file) return resolve(false);
        const script = ctx.resourcePath('python_backend', 'ocr', 'landmarks.py');
        const proc = spawn(ctx.pythonExe(),
          ctx.pythonArgs(script, '--file', file, '--page', '0', '--emit-words', '--tesseract', ctx.tesseractPath()),
          { windowsHide: true });
        let out = '', err = '';
        proc.stdout.on('data', d => { out += d.toString(); });
        proc.stderr.on('data', d => { err += d.toString(); });
        proc.on('close', () => {
          if (err) console.error('capture-words stderr:', err.trim());
          let words = []; try { words = JSON.parse(out.trim()) || []; } catch {}
          if (Array.isArray(words) && words.length) {
            try { templates.replaceSampleWords(db, templateId, docId, words); }
            catch (e) { console.error('replaceSampleWords:', e.message); }
          }
          resolve(true);
        });
        proc.on('error', (e) => { console.error('capture-words spawn:', e.message); resolve(false); });
      } catch (e) { console.error('captureSampleWords:', e.message); resolve(false); }
    });
  }
  ctx.captureSampleWords = captureSampleWords;

  // Derive landmarks from the cross-sample corpus once >=3 confirmed docs exist —
  // the reliable AUTOMATIC source (recurring + positionally-stable words; no human
  // picking). Returns {derived,count}; never touches a manual set; writes 'cross_sample'.
  function tryCrossSampleLandmarks(db, templateId) {
    return new Promise((resolve) => {
      try {
        if (templates.hasManualLandmarks(db, templateId)) return resolve({ derived: false });
        if (templates.countSampleDocs(db, templateId) < 3) return resolve({ derived: false });
        const docs = templates.getSampleWordsByDoc(db, templateId);
        if (!docs.length) return resolve({ derived: false });
        const tmp = path.join(os.tmpdir(), `ds_xsample_${templateId}_${Date.now()}.json`);
        fs.writeFileSync(tmp, JSON.stringify({ docs, exclude_boxes: _excludeBoxesFor(db, templateId) }));
        const script = ctx.resourcePath('python_backend', 'ocr', 'landmarks.py');
        const proc = spawn(ctx.pythonExe(), ctx.pythonArgs(script, '--cross-sample-file', tmp), { windowsHide: true });
        let out = '', err = '';
        proc.stdout.on('data', d => { out += d.toString(); });
        proc.stderr.on('data', d => { err += d.toString(); });
        proc.on('close', () => {
          try { fs.unlinkSync(tmp); } catch {}
          if (err) console.error('cross-sample stderr:', err.trim());
          let list = []; try { list = JSON.parse(out.trim()) || []; } catch {}
          if (Array.isArray(list) && list.length) {
            try { templates.setLandmarks(db, templateId, list, 'cross_sample'); return resolve({ derived: true, count: list.length }); }
            catch (e) { console.error('setLandmarks(cross):', e.message); }
          }
          resolve({ derived: false });
        });
        proc.on('error', (e) => { try { fs.unlinkSync(tmp); } catch {}; console.error('cross-sample spawn:', e.message); resolve({ derived: false }); });
      } catch (e) { console.error('tryCrossSampleLandmarks:', e.message); resolve({ derived: false }); }
    });
  }

  async function generateLandmarks(templateId) {
    const db = getDb();
    // Manual landmarks are an explicit admin override — never clobber them with an
    // auto re-derivation. Clear them ("Use automatic") to revert to automatic.
    if (templates.hasManualLandmarks(db, templateId)) {
      return { success: true, manual: true, count: templates.getLandmarks(db, templateId).length };
    }
    // Prefer cross-sample recurrence (>=3 confirmed docs) — the reliable automatic
    // source. Falls through to the single-sample bootstrap otherwise.
    try {
      const cross = await tryCrossSampleLandmarks(db, templateId);
      if (cross && cross.derived) return { success: cross.count > 0, count: cross.count, source: 'cross_sample' };
    } catch (e) { console.error('cross-sample landmarks:', e.message); }

    const tmpl = templates.getById(db, templateId);
    if (!tmpl || !tmpl.sample_document_id) return { success: false, reason: 'no sample' };
    const doc  = db.prepare('SELECT * FROM documents WHERE id = ?').get(tmpl.sample_document_id);
    const file = _resolveDocPath(doc);
    if (!file) return { success: false, reason: 'sample file not found' };
    const exclude = JSON.stringify(_excludeBoxesFor(db, templateId));
    const script = ctx.resourcePath('python_backend', 'ocr', 'landmarks.py');
    return new Promise((resolve) => {
      const proc = spawn(ctx.pythonExe(),
        ctx.pythonArgs(script, '--file', file, '--page', '0', '--emit-phash',
                       '--exclude-boxes', exclude, '--tesseract', ctx.tesseractPath()),
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
        // overwrite an established phash (consistent with chooseLogoPhash).
        if (phash && !tmpl.logo_phash) {
          try {
            db.prepare("UPDATE templates SET logo_phash = ?, updated_at = datetime('now') WHERE id = ? AND (logo_phash IS NULL OR logo_phash = '')").run(phash, templateId);
          } catch (e) { console.error('seed logo_phash:', e.message); }
        }
        resolve({ success: list.length > 0, count: list.length, phashSeeded: !!(phash && !tmpl.logo_phash) });
      });
      proc.on('error', (e) => { console.error('landmarks spawn:', e.message); resolve({ success: false, reason: e.message }); });
    });
  }
  // Expose the landmark generator so the teach-wizard commit path
  // (review/handler.js -> promote-to-template) can derive landmarks right after it pins
  // its sample. Every OTHER sample-pin path (set-template-sample / import-sample) already
  // calls generateLandmarks, but promote-to-template only set the sample — so teach-created
  // templates were born with NO landmarks and registration (the drift correction) stayed
  // inert, letting a mapping box drift onto the wrong row. Best-effort; never throws.
  ctx.generateLandmarks = generateLandmarks;

  // TEACH-COMMIT SAMPLE-ANGLE WRITE (TEACH_ANGLE_COMPOSE enabler). The lazy heal in
  // processing/handler.js (_healSampleAngles) detects a template's sample tilt at RUN start,
  // fire-and-forget — so a JUST-taught template's angle lands only on the SECOND batch (the
  // "one batch behind" cost the owner's Chris rounds surfaced). Detect + store it HERE, at the
  // promote/link/graduation commit, so the very first process of a sibling composes correctly.
  // Same detector the heal uses (ocr/detect_angle.py -> {"angle": float|null}, 0.0 = level);
  // writes sample_deskew_angle ONLY when a finite number comes back and the column is still
  // unset (never clobbers an owner-set or heal-set value). Inert unless TEACH_ANGLE_COMPOSE is
  // ON (the compose step is the only reader); best-effort, never throws, never blocks the commit.
  async function generateSampleAngle(templateId) {
    const db   = getDb();
    const tmpl = templates.getById(db, templateId);
    if (!tmpl || !tmpl.sample_document_id) return { success: false, reason: 'no sample' };
    if (tmpl.sample_deskew_angle != null) return { success: true, skipped: true };   // already known
    const doc  = db.prepare('SELECT working_path, stored_path FROM documents WHERE id = ?')
                   .get(tmpl.sample_document_id);
    const file = _resolveDocPath(doc);
    if (!file) return { success: false, reason: 'sample file not found' };
    const script = ctx.resourcePath('python_backend', 'ocr', 'detect_angle.py');
    return new Promise((resolve) => {
      let proc;
      try { proc = spawn(ctx.pythonExe(), ctx.pythonArgs(script, '--file', file), { windowsHide: true }); }
      catch (e) { resolve({ success: false, reason: e.message }); return; }
      let out = '', err = '';
      proc.stdout.on('data', d => { out += d.toString(); });
      proc.stderr.on('data', d => { err += d.toString(); });
      proc.on('close', () => {
        if (err) console.error('detect_angle stderr:', err.trim());
        let angle = null;
        try { const r = JSON.parse(out.trim()); if (r && typeof r.angle === 'number' && isFinite(r.angle)) angle = r.angle; }
        catch {}
        if (angle != null) {
          try {
            db.prepare('UPDATE templates SET sample_deskew_angle = ? WHERE id = ? AND sample_deskew_angle IS NULL')
              .run(angle, templateId);
            console.log(`[templates] sample angle written at commit: template ${templateId} = ${angle.toFixed(2)} deg`);
          } catch (e) { console.error('write sample_deskew_angle:', e.message); }
        }
        resolve({ success: angle != null, angle });
      });
      proc.on('error', (e) => { console.error('detect_angle spawn:', e.message); resolve({ success: false, reason: e.message }); });
    });
  }
  ctx.generateSampleAngle = generateSampleAngle;

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

  // (Re)derive a template's KEYWORD FINGERPRINT from several of its documents,
  // keeping only the STABLE recurring words (template_fingerprint.py). This is what
  // lets a BORN-DIGITAL template (e.g. a Print Tracker email alert, whose logo crop
  // is fooled by a variable From/To/Subject header) be matched by its stable header
  // vocabulary instead of an unreliable logo phash. By default it only FILLS an
  // empty fingerprint (never clobbers a stabilised one); force:true overwrites.
  // Best-effort; never throws. Exposed for the promote-to-template path.
  async function generateFingerprint(templateId, { force = false } = {}) {
    const db   = getDb();
    const tmpl = templates.getById(db, templateId);
    if (!tmpl) return { success: false, reason: 'no template' };
    const existing = Array.isArray(tmpl.keyword_fingerprint) ? tmpl.keyword_fingerprint : [];
    if (existing.length && !force) return { success: true, skipped: true, count: existing.length };

    // Up to 8 of the template's documents (its pinned sample first, then confirmed).
    const sid  = tmpl.sample_document_id || -1;
    const docs = db.prepare(`
      SELECT working_path, stored_path, stored_filename, folder_path, original_filename
      FROM documents WHERE template_id = ? OR id = ?
      ORDER BY (id = ?) DESC, confirmed_at DESC LIMIT 8
    `).all(templateId, sid, sid);
    const files = [];
    for (const d of docs) { const f = _resolveDocPath(d); if (f && !files.includes(f)) files.push(f); }
    if (!files.length) return { success: false, reason: 'no sample files' };

    const learning = require('../../../database/modules/learning');
    let bornDigital = true;
    try { bornDigital = learning.getSetting(db, 'born_digital_enabled') !== 'false'; } catch {}

    const filesFile = path.join(os.tmpdir(), `ds_tfp_${templateId}_${Date.now()}.json`);
    try { fs.writeFileSync(filesFile, JSON.stringify(files)); }
    catch (e) { return { success: false, reason: e.message }; }
    const script = ctx.resourcePath('python_backend', 'template_fingerprint.py');
    return new Promise((resolve) => {
      const a = ['--files-file', filesFile, '--tesseract', ctx.tesseractPath()];
      if (bornDigital) a.push('--born-digital');
      const proc = spawn(ctx.pythonExe(), ctx.pythonArgs(script, ...a), { windowsHide: true });
      let out = '', err = '';
      proc.stdout.on('data', d => { out += d.toString(); });
      proc.stderr.on('data', d => { err += d.toString(); });
      proc.on('close', () => {
        try { fs.unlinkSync(filesFile); } catch {}
        if (err) console.error('template_fingerprint stderr:', err.trim());
        let parsed = null; try { parsed = JSON.parse(out.trim()); } catch {}
        const fp = (parsed && Array.isArray(parsed.fingerprint)) ? parsed.fingerprint : [];
        if (fp.length) {
          try {
            db.prepare("UPDATE templates SET keyword_fingerprint = ?, updated_at = datetime('now') WHERE id = ?")
              .run(JSON.stringify(fp), templateId);
          } catch (e) { console.error('set fingerprint:', e.message); }
        }
        resolve({ success: fp.length > 0, count: fp.length, docs: (parsed && parsed.docs) || 0 });
      });
      proc.on('error', (e) => { try { fs.unlinkSync(filesFile); } catch {}; resolve({ success: false, reason: e.message }); });
    });
  }
  ctx.generateFingerprint = generateFingerprint;

  // Lazy one-shot backfill: templates with documents but NO keyword fingerprint gain
  // one with no re-teach (the born-digital empty-fingerprint class). Delayed past the
  // landmarks backfill so the two never contend; best-effort.
  setTimeout(async () => {
    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT t.id FROM templates t
        WHERE (t.keyword_fingerprint IS NULL OR t.keyword_fingerprint = '' OR t.keyword_fingerprint = '[]')
          AND (t.sample_document_id IS NOT NULL
               OR EXISTS (SELECT 1 FROM documents d WHERE d.template_id = t.id))
      `).all();
      for (const r of rows) await generateFingerprint(r.id);
      if (rows.length) console.log(`[fingerprint] backfilled ${rows.length} template(s)`);
    } catch (e) { console.error('[fingerprint] backfill failed:', e.message); }
  }, 14000);

  // ── Browse ──────────────────────────────────────────────────────────────────
  ipcMain.handle('get-templates', () => {
    requireRole('admin', 'edit');   // Edit users need the list for Review's "link to an existing document"
    return templates.getAllWithLiveCounts(getDb());   // N: live confirmed-doc count (the stored column under-counts)
  });

  ipcMain.handle('get-template-detail', (_e, templateId) => {
    requireRole('admin');
    const db = getDb();
    const detail = templates.getById(db, templateId);
    if (detail) {
      detail.confirmed_count = templates.confirmedDocCount(db, templateId);   // N: same live truth as the roster
      detail.hidden_fields = templates.getHiddenFields(db, templateId);       // per-template field-hiding mask (mig 54)
      detail.type_fields   = templates.getTypeFieldsForHiding(db, templateId);// {key,label,structural,hidden} for the hide UI
    }
    return detail;
  });

  // Per-template field HIDING (migration 54): mark a field the type has but this layout lacks as
  // hidden, so Review stops flagging it missing. Backend REFUSES a structural role or a field not on
  // the type (superset-lock) and returns {ok:false, reason}. Admin-only (whole viewer is admin).
  ipcMain.handle('set-template-hidden-field', (_e, templateId, fieldKey, hidden) => {
    requireRole('admin');
    const db = getDb();
    const r  = templates.setHiddenField(db, templateId, fieldKey, !!hidden);
    // LIVE-UPDATE an open Review window: push the fresh hidden set for this template so a doc on
    // screen re-renders immediately (no close/reopen). The payload CARRIES the array so Review needs
    // no admin-gated re-fetch (a Review window can be an Edit user). No-op if Review isn't open.
    if (r && r.ok !== false) {
      try { ctx.notifyReview('review-visibility-changed', { templateId, hidden: templates.getHiddenFields(db, templateId) }); } catch {}
    }
    return r;
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
    const r = templates.rename(getDb(), templateId, (name || '').trim());
    logAudit(getDb(), { action: 'template_renamed', action_category: 'templates', target_type: 'template',
      target_id: String(templateId), outcome: 'success', metadata: { name: (name || '').trim().slice(0, 80) } });
    return r;
  });

  ipcMain.handle('delete-template', (_e, templateId) => {
    requireRole('admin');
    templates.remove(getDb(), templateId);
    logAudit(getDb(), { action: 'template_deleted', action_category: 'templates', target_type: 'template',
      target_id: String(templateId), outcome: 'success' });
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
      LIMIT 20
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

  // Re-derive the keyword fingerprint from the template's documents (force overwrite),
  // so an admin can fix a born-digital template whose logo phash is unreliable.
  ipcMain.handle('regenerate-template-fingerprint', async (_e, templateId) => {
    requireRole('admin');
    return generateFingerprint(templateId, { force: true });
  });

  // ── Manual registration landmarks ("Enhance detection") ──────────────────────
  // The admin draws stable labels (logo/title/field labels) on the sample; the
  // renderer OCRs each drawn box via the existing ocr-region recipe and sends the
  // normalised boxes + text here. Stored source='manual' so auto-generation never
  // overwrites them (generateLandmarks guard). Global, per-template, layout-agnostic
  // — it does not special-case any document. Capped defensively.
  ipcMain.handle('set-template-landmarks', (_e, templateId, landmarks) => {
    requireRole('admin');
    const db = getDb();
    const rows = (Array.isArray(landmarks) ? landmarks : [])
      .filter(l => l && l.label_text != null && String(l.label_text).trim())
      .slice(0, 8);
    const saved = templates.setLandmarks(db, templateId, rows, 'manual');
    return { success: true, count: saved.length, landmarks: saved };
  });

  ipcMain.handle('get-template-landmarks', (_e, templateId) => {
    requireRole('admin');
    return templates.getLandmarks(getDb(), templateId);
  });

  // Revert to automatic detection: drop the manual set and re-derive from the sample.
  ipcMain.handle('clear-template-landmarks', async (_e, templateId) => {
    requireRole('admin');
    templates.clearLandmarks(getDb(), templateId);
    logAudit(getDb(), { action: 'template_landmarks_cleared', action_category: 'templates', target_type: 'template',
      target_id: String(templateId), outcome: 'success' });
    return generateLandmarks(templateId);
  });

  // Reassign a poisoned/duplicate template's documents onto an existing correct
  // template (Learning Recovery → "Reassign"). Reversible link-only move; the
  // caller follows up with the existing delete-template if the source is now an
  // empty duplicate to be removed. Returns a {moved, sampleAdopted} summary.
  ipcMain.handle('reassign-template-documents', (_e, fromTemplateId, toTemplateId) => {
    requireRole('admin');
    const r = templates.reassignDocuments(getDb(), Number(fromTemplateId), Number(toTemplateId));
    // Audit the REAL outcome (2026-07-31 hardening): the old unconditional 'success' asserted
    // reassigns/merges that never happened — an audit log that can't be trusted is worse than
    // none. ok:false → 'failure' with the reason in metadata.
    logAudit(getDb(), { action: 'template_documents_reassigned', action_category: 'templates', target_type: 'template',
      target_id: String(toTemplateId), outcome: (r && r.ok !== false) ? 'success' : 'failure',
      metadata: { from: Number(fromTemplateId), to: Number(toTemplateId),
                  ...(r && r.ok === false ? { reason: r.reason || 'failed' } : { moved: r && r.moved }) } });
    return r;
  });

  // Consolidate a duplicate/fragment template INTO a canonical one and delete the
  // source (Learning Recovery → "Merge into…"). IRREVERSIBLE — folds the source's
  // doc links + missing mappings/fields/landmarks/sample/identity into the target
  // (target wins) and removes the source. See templates.mergeInto.
  ipcMain.handle('merge-template', (_e, fromTemplateId, toTemplateId) => {
    requireRole('admin');
    const r = templates.mergeInto(getDb(), Number(fromTemplateId), Number(toTemplateId));
    // Real outcome (2026-07-31 hardening — see reassign above): a refused merge
    // (self/missing source/missing target) must not audit as a merge that happened.
    logAudit(getDb(), { action: 'template_merged', action_category: 'templates', target_type: 'template',
      target_id: String(toTemplateId), outcome: (r && r.ok !== false) ? 'success' : 'failure',
      metadata: { from: Number(fromTemplateId), to: Number(toTemplateId),
                  ...(r && r.ok === false ? { reason: r.reason || 'failed' } : {}) } });
    return r;
  });

  // ── M3 template-convergence cleanup (docs/designs/TEMPLATE_CONVERGENCE_2026-07-17.md) ──────────
  // The engine (findMergeCandidates / planBackfill / applyBackfill) is READ-ONLY or LINK-only; only
  // the cluster merge is destructive, and it takes a DB backup first (Oracle M3 condition).
  const templateMerge = require('../../../database/modules/templateMerge');

  // Online DB backup to a timestamped sibling file (better-sqlite3 .backup handles WAL correctly).
  async function _backupDbBeforeMerge(db) {
    const src = db.name;
    if (!src || src === ':memory:') throw new Error('no database file to back up');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest  = path.join(path.dirname(src), `docusnap.db.merge-backup-${stamp}`);
    await db.backup(dest);
    return dest;
  }

  // READ-ONLY: clusters of duplicate same-supplier same-type templates worth reviewing for a merge.
  ipcMain.handle('get-merge-candidates', () => {
    requireRole('admin');
    return templateMerge.findMergeCandidates(getDb());
  });

  // READ-ONLY: confirmed documents with no template that a same-type branding match would LINK.
  ipcMain.handle('plan-template-backfill', () => {
    requireRole('admin');
    const plan = templateMerge.planBackfill(getDb());
    return { count: plan.length, plan };
  });

  // NON-DESTRUCTIVE: apply the backfill LINK (guarded `WHERE template_id IS NULL`; reversible).
  ipcMain.handle('apply-template-backfill', () => {
    requireRole('admin');
    const r = templateMerge.applyBackfill(getDb());
    logAudit(getDb(), { action: 'template_backfill_applied', action_category: 'templates', target_type: 'template',
      outcome: 'success', metadata: { linked: (r && (r.linked ?? r.count)) ?? undefined } });
    return r;
  });

  // DESTRUCTIVE, admin-confirmed: BACK UP THE DB, then fold each member template INTO the canonical
  // (templates.mergeInto DELETEs each source). Refuses to merge if the backup fails — never destroy
  // without the safety net. The renderer confirms + shows the structure verdict first.
  ipcMain.handle('merge-template-cluster', async (_e, canonicalId, memberIds) => {
    requireRole('admin');
    const db      = getDb();
    const canon   = Number(canonicalId);
    const members = (Array.isArray(memberIds) ? memberIds : []).map(Number).filter(id => id && id !== canon);
    if (!canon || !members.length) return { ok: false, reason: 'invalid' };
    let backup;
    try { backup = await _backupDbBeforeMerge(db); }
    catch (e) { return { ok: false, reason: 'backup-failed', error: e.message }; }
    const results = [];
    for (const m of members) {
      try { results.push({ from: m, ...templates.mergeInto(db, m, canon) }); }
      catch (e) { results.push({ from: m, ok: false, reason: e.message }); }
    }
    const merged = results.filter(r => r.ok).length;
    logAudit(db, { action: 'template_cluster_merged', action_category: 'templates', target_type: 'template',
      target_id: String(canon), outcome: merged > 0 ? 'success' : 'failure',
      metadata: { canonical: canon, members: members.length, merged, backup: !!backup } });
    return { ok: merged > 0, backup, canonicalId: canon, merged, attempted: members.length, results };
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
    // Multi-point licensing enforcement (F-01): defining a template mapping is a
    // high-value learning write. Network-free cached-license re-check.
    const licenseDenial = require('../licensing/handler').licenseDenied(getDb());
    if (licenseDenial) return { success: false, error: 'A valid license is required to edit templates. Please re-activate ScanFinder.', ...licenseDenial };
    if (!mapping || !mapping.field_key) return { success: false, error: 'field_key required' };
    const required = ['anchor_x_norm', 'anchor_y_norm', 'anchor_w_norm', 'anchor_h_norm',
                      'target_x_norm', 'target_y_norm', 'target_w_norm', 'target_h_norm'];
    if (required.some(k => mapping[k] == null)) {
      return { success: false, error: 'anchor and target boxes are both required' };
    }
    // GEOMETRY VALIDATION (2026-07-31 hardening): presence-only checking persisted NaN /
    // negative / off-page / zero-area boxes straight into Stage-0.5 geometry, where they
    // become silent mis-crops on every future doc of the template. Each coordinate must be
    // a finite normalised number; each box needs real area and must stay on the page.
    // Renderer draws can't produce these; a buggy/scripted caller could. NOTE anchor==target
    // is LEGITIMATE and must stay allowed — the teach wizard's POSITION-ONLY issuer mapping
    // deliberately sets the anchor box to the target box (teach/renderer.js ~:992, "never a
    // synthesised box"); do not add an identity refusal here.
    for (const k of required) {
      const v = Number(mapping[k]);
      if (!Number.isFinite(v) || v < 0 || v > 1) return { success: false, error: `invalid ${k}` };
    }
    for (const side of ['anchor', 'target']) {
      const x = Number(mapping[`${side}_x_norm`]), y = Number(mapping[`${side}_y_norm`]);
      const w = Number(mapping[`${side}_w_norm`]), h = Number(mapping[`${side}_h_norm`]);
      if (w <= 0 || h <= 0) return { success: false, error: `${side} box has no area` };
      if (x + w > 1.0001 || y + h > 1.0001) return { success: false, error: `${side} box off the page` };
    }
    const saved = templates.saveMapping(getDb(), templateId, mapping);

    // TAUGHT LABEL BECOMES THE KEYWORD — the WIZARD half (owner decision 2026-08-11).
    // The ⊕ Review teach writes this from `save-field-anchor`; the TEACH WIZARD does not go
    // through that path at all — it persists a Stage 0.5 anchor→target MAPPING instead. Hooking
    // only the anchor path would have missed the very case the owner reported, and the live
    // numbers say so plainly: 6 taught anchors carry a label against 38 template mappings
    // carrying `anchor_text`. Most taught captions arrive HERE.
    // Same rules as the anchor path: exclusive, doc-type-scoped, never an empty label (the
    // issuer's position-only mapping deliberately has none), and never fatal to the save above.
    // DEFAULT OFF — setting `teach_label_becomes_keyword`.
    try {
      const db = getDb();
      const learning = require('../../../database/modules/learning');
      if (learning.getSetting(db, 'teach_label_becomes_keyword', 'false') === 'true') {
        const label = String(mapping.anchor_text || '').trim();
        if (label) {
          const tpl = templates.getById ? templates.getById(db, templateId) : null;
          const slug = String((tpl && tpl.document_type_slug) || '').trim();
          if (slug) {
            // template_id (migration 62): the override applies only when THIS template matches
            // — "per doc type for each supplier, set at the template level" (owner 2026-08-11).
            require('../../../database/modules/label_overrides')
              .addLabelOverride(db, { doc_type_slug: slug, field_key: mapping.field_key,
                                      label, exclusive: 1, template_id: Number(templateId) || 0 });
          }
        }
      }
    } catch (e) {
      logger?.warn?.(`teach mapping label -> keyword: ${e.message}`);
    }
    return { success: true, mapping: saved };
  });

  ipcMain.handle('set-template-mapping-enabled', (_e, templateId, fieldKey, enabled) => {
    requireRole('admin');
    // F-01: same multi-point gate. This handler's contract is a boolean, so a denial
    // returns false (renderer-safe falsy) rather than an object that would read truthy.
    if (require('../licensing/handler').licenseDenied(getDb())) return false;
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
