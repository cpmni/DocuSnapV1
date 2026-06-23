'use strict';

// Multi-reference logo phash (migration 26): a template's identity is a SET of
// perceptual hashes, not one. Per-scan DPI/enhance drift shifts a recomputed phash
// by double-digit Hamming, so a single frozen hash spawns duplicate templates.
// Matching takes the MIN distance over the set; confirms APPEND drifted-but-related
// hashes (within the band, not near-dupes) so the set converges to span the drift.
const LOGO_HASH_CAP    = 8;    // max stored hashes per template
const LOGO_DEDUP_FLOOR = 2;    // <= this to the nearest existing ref -> already covered, skip
const LOGO_APPEND_BAND = 13;   // append only within this Hamming of an existing ref (= the matcher candidate net)

function getAll(db) {
  const rows = db.prepare(
    'SELECT * FROM templates ORDER BY confirmed_count DESC, name'
  ).all();
  for (const t of rows) {
    t.fields              = getFields(db, t.id);
    t.field_mappings      = getMappings(db, t.id);
    t.landmarks           = getLandmarks(db, t.id);
    t.logo_phashes        = getLogoHashes(db, t.id);
    t.keyword_fingerprint = _parseJson(t.keyword_fingerprint, []);
    t.ocr_auto_params     = _parseJson(t.ocr_auto_params, null);
  }
  return rows;
}

function getById(db, id) {
  const t = db.prepare('SELECT * FROM templates WHERE id = ?').get(id);
  if (!t) return null;
  t.fields              = getFields(db, t.id);
  t.field_mappings      = getMappings(db, t.id);
  t.keyword_fingerprint = _parseJson(t.keyword_fingerprint, []);
  t.ocr_auto_params     = _parseJson(t.ocr_auto_params, null);
  t.sample_document     = t.sample_document_id ? getSampleDocument(db, t.sample_document_id) : null;
  t.landmarks           = getLandmarks(db, t.id);
  t.logo_phashes        = getLogoHashes(db, t.id);
  return t;
}

// Minimal projection — just enough for the viewer to resolve a preview path
// (mirrors the {folderPath, filename} resolution search/renderer.js already
// does for confirmed vs. unconfirmed documents) and show a caption.
function getSampleDocument(db, documentId) {
  return db.prepare(`
    SELECT id, original_filename, stored_filename, stored_path, folder_path,
           status, supplier_name, doc_date, reference_number
    FROM documents WHERE id = ?
  `).get(documentId) || null;
}

function getFields(db, templateId) {
  return db.prepare(
    'SELECT * FROM template_fields WHERE template_id = ? ORDER BY field_key'
  ).all(templateId);
}

// ── Field anchor → target mappings (Template Viewer) ─────────────────────────
// Additive companion to template_fields: those store text-search anchor RULES
// (label + direction, no coordinates); these store admin-DRAWN anchor/target
// RECTANGLES on a pinned sample document, for crop-and-OCR extraction. Kept
// in their own table (rather than extending template_fields) so templates
// without any drawn mappings are byte-for-byte unaffected — see
// template_mapper.py for how they're consumed.

function getMappings(db, templateId) {
  const rows = db.prepare(
    'SELECT * FROM template_field_mappings WHERE template_id = ? ORDER BY field_key'
  ).all(templateId);
  for (const r of rows) r.region_hint = _parseJson(r.region_hint, []);
  return rows;
}

function getMapping(db, templateId, fieldKey) {
  const r = db.prepare(
    'SELECT * FROM template_field_mappings WHERE template_id = ? AND field_key = ?'
  ).get(templateId, fieldKey);
  if (r) r.region_hint = _parseJson(r.region_hint, []);
  return r || null;
}

function saveMapping(db, templateId, mapping) {
  const m = {
    template_id:      templateId,
    field_key:        mapping.field_key,
    page_number:      mapping.page_number || 0,
    anchor_text:      mapping.anchor_text || null,
    anchor_x_norm:    mapping.anchor_x_norm,
    anchor_y_norm:    mapping.anchor_y_norm,
    anchor_w_norm:    mapping.anchor_w_norm,
    anchor_h_norm:    mapping.anchor_h_norm,
    target_x_norm:    mapping.target_x_norm,
    target_y_norm:    mapping.target_y_norm,
    target_w_norm:    mapping.target_w_norm,
    target_h_norm:    mapping.target_h_norm,
    offset_dx_norm:   mapping.target_x_norm - mapping.anchor_x_norm,
    offset_dy_norm:   mapping.target_y_norm - mapping.anchor_y_norm,
    ocr_type:         mapping.ocr_type || 'text',
    search_expansion: mapping.search_expansion ?? 0.04,
    region_hint:      JSON.stringify(_computeRegionHint(mapping)),
    enabled:          mapping.enabled === false ? 0 : 1,
  };
  db.prepare(`
    INSERT INTO template_field_mappings
      (template_id, field_key, page_number, anchor_text,
       anchor_x_norm, anchor_y_norm, anchor_w_norm, anchor_h_norm,
       target_x_norm, target_y_norm, target_w_norm, target_h_norm,
       offset_dx_norm, offset_dy_norm, ocr_type, search_expansion,
       region_hint, enabled)
    VALUES
      (@template_id, @field_key, @page_number, @anchor_text,
       @anchor_x_norm, @anchor_y_norm, @anchor_w_norm, @anchor_h_norm,
       @target_x_norm, @target_y_norm, @target_w_norm, @target_h_norm,
       @offset_dx_norm, @offset_dy_norm, @ocr_type, @search_expansion,
       @region_hint, @enabled)
    ON CONFLICT(template_id, field_key) DO UPDATE SET
      page_number      = excluded.page_number,
      anchor_text      = excluded.anchor_text,
      anchor_x_norm    = excluded.anchor_x_norm,
      anchor_y_norm    = excluded.anchor_y_norm,
      anchor_w_norm    = excluded.anchor_w_norm,
      anchor_h_norm    = excluded.anchor_h_norm,
      target_x_norm    = excluded.target_x_norm,
      target_y_norm    = excluded.target_y_norm,
      target_w_norm    = excluded.target_w_norm,
      target_h_norm    = excluded.target_h_norm,
      offset_dx_norm   = excluded.offset_dx_norm,
      offset_dy_norm   = excluded.offset_dy_norm,
      ocr_type         = excluded.ocr_type,
      search_expansion = excluded.search_expansion,
      region_hint      = excluded.region_hint,
      enabled          = excluded.enabled,
      updated_at       = datetime('now')
  `).run(m);
  return getMapping(db, templateId, mapping.field_key);
}

function setMappingEnabled(db, templateId, fieldKey, enabled) {
  db.prepare(`
    UPDATE template_field_mappings SET enabled = ?, updated_at = datetime('now')
    WHERE template_id = ? AND field_key = ?
  `).run(enabled ? 1 : 0, templateId, fieldKey);
}

function deleteMapping(db, templateId, fieldKey) {
  return db.prepare(
    'DELETE FROM template_field_mappings WHERE template_id = ? AND field_key = ?'
  ).run(templateId, fieldKey);
}

function recordMappingTest(db, templateId, fieldKey, { value, confidence, status }) {
  db.prepare(`
    UPDATE template_field_mappings
    SET last_test_value = ?, last_test_confidence = ?, last_test_status = ?,
        last_test_at = datetime('now')
    WHERE template_id = ? AND field_key = ?
  `).run(value ?? null, confidence ?? null, status || null, templateId, fieldKey);
}

// 8-region coarse grid: 2 columns × 4 rows of the page, indexed 0-7
// (row-major, top-left = 0). Purely an optimisation HINT recorded alongside
// the real anchor/target geometry — see CLAUDE.md: "do not make the fixed
// grid the sole extraction mechanism". A target spanning multiple cells
// records all of them so a future full-OCR-skip pass knows to merge zones.
const GRID_COLS = 2;
const GRID_ROWS = 4;

function _computeRegionHint({ target_x_norm, target_y_norm, target_w_norm, target_h_norm }) {
  if ([target_x_norm, target_y_norm, target_w_norm, target_h_norm].some(v => v == null)) return [];
  const x0 = Math.max(0, Math.min(1, target_x_norm));
  const y0 = Math.max(0, Math.min(1, target_y_norm));
  const x1 = Math.max(0, Math.min(1, target_x_norm + target_w_norm));
  const y1 = Math.max(0, Math.min(1, target_y_norm + target_h_norm));
  const cells = new Set();
  const c0 = Math.floor(x0 * GRID_COLS), c1 = Math.max(c0, Math.ceil(x1 * GRID_COLS) - 1);
  const r0 = Math.floor(y0 * GRID_ROWS), r1 = Math.max(r0, Math.ceil(y1 * GRID_ROWS) - 1);
  for (let r = r0; r <= Math.min(r1, GRID_ROWS - 1); r++) {
    for (let c = c0; c <= Math.min(c1, GRID_COLS - 1); c++) {
      cells.add(r * GRID_COLS + c);
    }
  }
  return [...cells].sort((a, b) => a - b);
}

// ── Sample document ───────────────────────────────────────────────────────────

function setSampleDocument(db, templateId, documentId) {
  db.prepare(`
    UPDATE templates SET sample_document_id = ?, updated_at = datetime('now') WHERE id = ?
  `).run(documentId || null, templateId);
}

// ── OCR auto-processing rule ─────────────────────────────────────────────────
// A learned, template-tied OCR preprocessing baseline (skew/threshold/noise
// params — same shape as review/renderer.js getEnhanceParams()). Persisted
// here so it can apply automatically on reprocess for documents matched to
// this template, independent of manual OCR Preview state — see
// processing/handler.js reprocess-document.

// Called when an admin/edit user reprocesses a document with OCR Preview
// active and that document has a known template_id — the manual params
// become this template's auto-processing baseline (enabled by default; an
// admin can turn it off via setOcrAutoEnabled without losing the params).
// Move every document linked to `fromTemplateId` onto `toTemplateId` — the
// reversible primitive behind admin "reassign a poisoned duplicate's documents
// to the correct template" (e.g. a near-identical layout that was learned twice,
// once under a bad short-token identity). Only the documents.template_id LINK
// moves; no extraction data, hints, anchors, or fingerprints are touched, and
// matching itself is link-independent (Stage 0 uses logo_phash/keyword_finger-
// print, not template_id) — so this is fully reversible by reassigning back.
// If the target has no pinned sample yet, it adopts the source's so the
// representative preview survives the move. Returns a summary for traceability.
function reassignDocuments(db, fromTemplateId, toTemplateId) {
  if (!fromTemplateId || !toTemplateId || fromTemplateId === toTemplateId) {
    return { moved: 0, sampleAdopted: false, from: fromTemplateId, to: toTemplateId };
  }
  let sampleAdopted = false;
  const tx = db.transaction(() => {
    const info = db.prepare(
      'UPDATE documents SET template_id = @to WHERE template_id = @from'
    ).run({ to: toTemplateId, from: fromTemplateId });
    const src = db.prepare('SELECT sample_document_id FROM templates WHERE id = ?').get(fromTemplateId);
    const dst = db.prepare('SELECT sample_document_id FROM templates WHERE id = ?').get(toTemplateId);
    if (src && src.sample_document_id && dst && !dst.sample_document_id) {
      db.prepare(`UPDATE templates SET sample_document_id = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(src.sample_document_id, toTemplateId);
      sampleAdopted = true;
    }
    return info.changes;
  });
  const moved = tx();
  return { moved, sampleAdopted, from: fromTemplateId, to: toTemplateId };
}

// Fold one template's learned data into a canonical target, then delete the
// source — the one-shot consolidation behind Learning Recovery → "Merge into…".
// IRREVERSIBLE (unlike reassignDocuments, which is link-only). Policy: TARGET
// WINS — the canonical template keeps its own identity, mappings, fields,
// landmarks and sample; it only GAINS what it LACKS from the source. So a
// fragment carrying the curated `customer` mapping hands it to the matched
// workhorse without clobbering the workhorse's own data. confirmed_count is
// summed. The source's own mappings/fields/landmarks cascade-delete with its row
// (the folds COPIED the needed ones under the target first); its document links
// move before the delete so the FK null-out is a no-op. One transaction.
function mergeInto(db, fromTemplateId, toTemplateId) {
  const fromId = Number(fromTemplateId), toId = Number(toTemplateId);
  if (!fromId || !toId || fromId === toId) {
    return { ok: false, reason: 'invalid', from: fromId, to: toId };
  }
  const from = db.prepare('SELECT * FROM templates WHERE id = ?').get(fromId);
  const to   = db.prepare('SELECT * FROM templates WHERE id = ?').get(toId);
  if (!from || !to) return { ok: false, reason: 'not_found', from: fromId, to: toId };

  const s = { ok: true, from: fromId, to: toId, movedDocs: 0, mappingsAdded: 0,
              fieldsAdded: 0, landmarksAdopted: false, sampleAdopted: false,
              phashAdopted: false };
  const tx = db.transaction(() => {
    // 1. Document links → target.
    s.movedDocs = db.prepare('UPDATE documents SET template_id = ? WHERE template_id = ?')
      .run(toId, fromId).changes;

    // 2. field_mappings: add only field_keys the target LACKS (target wins),
    //    preserving each folded mapping's enabled flag.
    const haveMap = new Set(getMappings(db, toId).map(m => m.field_key));
    for (const m of getMappings(db, fromId)) {
      if (haveMap.has(m.field_key)) continue;
      saveMapping(db, toId, { ...m, enabled: m.enabled !== 0 });
      s.mappingsAdded++;
    }

    // 3. template_fields: same add-missing fold.
    const haveF = new Set(getFields(db, toId).map(f => f.field_key));
    const missingF = getFields(db, fromId).filter(f => !haveF.has(f.field_key));
    if (missingF.length) { _upsertFields(db, toId, missingF); s.fieldsAdded = missingF.length; }

    // 4. landmarks / sample / phash / fingerprint: adopt source's ONLY if target lacks.
    if (!getLandmarks(db, toId).length) {
      const srcLm = getLandmarks(db, fromId);
      if (srcLm.length) { setLandmarks(db, toId, srcLm); s.landmarksAdopted = true; }
    }
    if (!to.sample_document_id && from.sample_document_id) {
      db.prepare(`UPDATE templates SET sample_document_id = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(from.sample_document_id, toId);
      s.sampleAdopted = true;
    }
    if (!to.logo_phash && from.logo_phash) {
      db.prepare(`UPDATE templates SET logo_phash = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(from.logo_phash, toId);
      s.phashAdopted = true;
    }
    // Fold the source's logo-hash reference set into the target (add-missing;
    // addLogoHash dedups via UNIQUE and re-applies the cap). So the canonical row
    // inherits every render variant the fragment had learned.
    for (const h of getLogoHashes(db, fromId)) addLogoHash(db, toId, h);
    if (from.logo_phash) addLogoHash(db, toId, from.logo_phash);
    if (!_parseJson(to.keyword_fingerprint, []).length) {
      const fp = _parseJson(from.keyword_fingerprint, []);
      if (fp.length) db.prepare('UPDATE templates SET keyword_fingerprint = ? WHERE id = ?')
        .run(JSON.stringify(fp), toId);
    }

    // 5. confirmed_count summed onto the canonical row.
    db.prepare('UPDATE templates SET confirmed_count = confirmed_count + ? WHERE id = ?')
      .run(from.confirmed_count || 0, toId);

    // 6. Delete the now-emptied source (mappings/fields/landmarks cascade; links moved).
    db.prepare('DELETE FROM templates WHERE id = ?').run(fromId);
  });
  tx();
  return s;
}

function setOcrAutoParams(db, templateId, params) {
  db.prepare(`
    UPDATE templates SET ocr_auto_enabled = 1, ocr_auto_params = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(JSON.stringify(params || {}), templateId);
  return getById(db, templateId);
}

function setOcrAutoEnabled(db, templateId, enabled) {
  db.prepare(`
    UPDATE templates SET ocr_auto_enabled = ?, updated_at = datetime('now') WHERE id = ?
  `).run(enabled ? 1 : 0, templateId);
  return getById(db, templateId);
}

// Closest template by logo phash, comparing against each template's WHOLE
// reference set (min distance), not just its primary — so a drifted scan still
// resolves once the set has converged. threshold 13 reaches the convergence band
// (callers apply their own accept gate, e.g. conf>=60 ⇔ dist<=6, on match_distance).
function findByLogoHash(db, phash, threshold = 13) {
  if (!phash) return null;
  const rows = db.prepare(
    'SELECT * FROM templates WHERE logo_phash IS NOT NULL'
  ).all();
  let best = null, bestDist = threshold + 1;
  for (const t of rows) {
    let hashes = getLogoHashes(db, t.id);
    if (!hashes.length && t.logo_phash) hashes = [t.logo_phash];   // legacy fallback
    let dist = 64;
    for (const h of hashes) { const d = hammingDistance(phash, h); if (d < dist) dist = d; }
    if (dist < bestDist) {
      bestDist = dist;
      best = { ...t, match_distance: dist, confidence: Math.max(0, 100 - dist * 6) };
    }
  }
  return best;
}

// Keyword-fingerprint match — JS mirror of template_matcher.py's
// _match_by_keywords (word-boundary regex over each template's stored
// keyword_fingerprint, score = hits/len(keywords)). KEYWORD_THRESHOLD there
// is 0.75 → confidence >= 75 here, with the same int()-style truncation.
function findByKeywordFingerprint(db, ocrText, threshold = 75) {
  if (!ocrText) return null;
  const ocrLower = ocrText.toLowerCase();
  const rows = db.prepare(
    'SELECT id, name, keyword_fingerprint FROM templates WHERE keyword_fingerprint IS NOT NULL'
  ).all();

  let best = null, bestScore = 0;
  for (const t of rows) {
    const keywords = _parseJson(t.keyword_fingerprint, []);
    if (!keywords.length) continue;
    let hits = 0;
    for (const kw of keywords) {
      const esc = kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`).test(ocrLower)) hits++;
    }
    const score = hits / keywords.length;
    if (score > bestScore) {
      bestScore = score;
      best = { template: { id: t.id, name: t.name }, confidence: Math.floor(score * 100), method: 'keywords' };
    }
  }
  return (best && best.confidence >= threshold) ? best : null;
}

// Lightweight current-template recheck — given a document's already-stored
// logo_phash/ocr_text (no page image, no OCR, no extraction pipeline), tries
// the same logo-then-keyword identification order and accept thresholds as
// template_matcher.identify_template(): logo confidence >= 60, else keyword
// confidence >= 75. Used by the review queue to detect that a template added
// via "Add to Template Manager" now covers a document that was queued before
// it existed.
function identifyByFingerprint(db, { logo_phash, ocr_text }) {
  if (logo_phash) {
    const logoMatch = findByLogoHash(db, logo_phash);
    if (logoMatch && logoMatch.confidence >= 60) {
      return { template: { id: logoMatch.id, name: logoMatch.name }, confidence: logoMatch.confidence, method: 'logo' };
    }
  }
  return findByKeywordFingerprint(db, ocr_text);
}

// Cheap name-based lookup for the Learning Recovery tab — shows managed
// templates alongside (but separate from) automatic learning data for the
// same supplier. Matching is purely cosmetic (template name vs. supplier
// name); it does not affect identification, which uses logo_phash /
// keyword_fingerprint exclusively (see identifyByFingerprint above).
function searchByName(db, query, document_type_slug) {
  const q = `%${(query || '').toLowerCase()}%`;
  return db.prepare(`
    SELECT id, name, document_type_slug, confirmed_count
    FROM templates
    WHERE LOWER(name) LIKE @q AND (@dt IS NULL OR document_type_slug = @dt)
    ORDER BY name
  `).all({ q, dt: document_type_slug || null });
}

function create(db, { name, document_type_slug, logo_phash, keyword_fingerprint, fields }) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'template';
  // templates.slug is UNIQUE, but the generated NAME is not: two documents of the
  // same type with no resolved supplier both yield "<Type> Template" -> the same
  // base slug, so a second one would hit "UNIQUE constraint failed: templates.slug".
  // De-duplicate by appending a counter. Slug/name are COSMETIC (identification is
  // by logo_phash / keyword_fingerprint — see template_matcher.py and rename()), so
  // a numbered slug is harmless. Reusable for every supplier/type.
  const slugExists = db.prepare('SELECT 1 FROM templates WHERE slug = ?');
  let slug = base, n = 1;
  while (slugExists.get(slug)) { n += 1; slug = `${base}_${n}`; }
  const info = db.prepare(`
    INSERT INTO templates (name, slug, document_type_slug, logo_phash, keyword_fingerprint)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, slug, document_type_slug || null, logo_phash || null,
         JSON.stringify(keyword_fingerprint || []));
  const id = info.lastInsertRowid;
  if (logo_phash) addLogoHash(db, id, logo_phash);   // seed the reference set (migration 26)
  if (fields && fields.length) _upsertFields(db, id, fields);
  return id;
}

// Cosmetic/admin-facing rename only — `name` plays no role in template
// matching (identification uses logo_phash / keyword_fingerprint exclusively,
// see template_matcher.py) and `slug` is left untouched, so this can never
// affect extraction, identification, or the debug-export filename derived
// from slug at creation time (review/handler.js _writeTemplateFile).
function rename(db, id, name) {
  db.prepare(`UPDATE templates SET name = ?, updated_at = datetime('now') WHERE id = ?`).run(name, id);
  return getById(db, id);
}

// Scoped delete — removes only this template's own row plus its
// template_fields / template_field_mappings (both ON DELETE CASCADE on
// template_id, see migrations 4 and 8). documents.template_id has no cascade
// and foreign_keys is ON, so any confirmed documents pointing at this template
// must be unlinked first or the DELETE would throw SQLITE_CONSTRAINT_FOREIGNKEY;
// nulling it out only clears the now-dangling reference — the documents, their
// extractions, learned anchors, supplier hints, and logo fingerprints are
// untouched. Wrapped in a transaction so the unlink and delete are atomic.
function remove(db, id) {
  const tx = db.transaction(() => {
    db.prepare('UPDATE documents SET template_id = NULL WHERE template_id = ?').run(id);
    db.prepare('DELETE FROM templates WHERE id = ?').run(id);
  });
  tx();
}

// ── Template identity stability ────────────────────────────────────────────
// A template's logo_phash + keyword_fingerprint ARE its Stage-0 identity (see
// template_matcher.py identify_template). Confirming a sample used to OVERWRITE
// both with that one document's freshly-OCR'd values, so a single noisy scan
// could replace a known-good identity with non-reproducible garble — OCR
// misreads ("OLUTIONS", "bol"), or per-document customer/invoice/date tokens.
// After such a confirm even the original sample no longer matched its own
// template, so the learned anchors/field-mappings never ran. These helpers make
// identity STABILISE across confirms instead of being clobbered by one sample.

// A pruned keyword identity below this many tokens is too thin to identify
// reliably, so a confirm that would erode it that far is ignored in favour of
// the established identity.
const FINGERPRINT_FLOOR = 3;

function _normTokens(arr) {
  const out = [], seen = new Set();
  for (const t of (Array.isArray(arr) ? arr : [])) {
    const s = String(t == null ? '' : t).trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;   // case-insensitive dedupe (matcher lowercases both sides)
    seen.add(k);
    out.push(s);                 // preserve first-seen casing/order
  }
  return out;
}

// Keep the tokens that RECUR across confirmed samples — the intersection of the
// established identity with the incoming sample. Per-document noise (a customer
// name, an invoice number, a one-off OCR misread) appears in only one sample and
// is dropped; stable supplier branding survives and converges. The FLOOR guards
// erosion: if the intersection is too thin to identify reliably, the established
// identity is kept unchanged so one noisy confirm cannot erase it. The first
// real identity (nothing established yet) is seeded as-is.
function stabiliseFingerprint(existing, incoming) {
  const ex  = _normTokens(existing);
  const inc = _normTokens(incoming);
  if (!ex.length)  return inc;   // nothing established yet — seed from this sample
  if (!inc.length) return ex;    // nothing to learn from — keep the proven identity
  const incSet = new Set(inc.map(t => t.toLowerCase()));
  const kept   = ex.filter(t => incSet.has(t.toLowerCase()));   // existing order/casing
  return kept.length >= FINGERPRINT_FLOOR ? kept : ex;
}

// Logo identity is a single perceptual hash, not a set, so it cannot intersect.
// The same per-render scan/DPI/enhance drift that affects the fingerprint shifts
// a recomputed phash by double-digit Hamming on the SAME document, so over-
// writing a populated hash every confirm only destabilises the Stage-0 logo
// gate. Seed it once when empty; otherwise keep the established value.
function chooseLogoPhash(existing, incoming) {
  const ex = existing == null ? '' : String(existing).trim();
  if (ex) return existing;
  return (incoming == null || String(incoming).trim() === '') ? null : incoming;
}

function update(db, id, { logo_phash, keyword_fingerprint, fields } = {}) {
  const sets   = ["confirmed_count = confirmed_count + 1", "updated_at = datetime('now')"];
  const params = [];

  // Identity must STABILISE across confirms, never be overwritten by one noisy
  // sample — read the established identity and merge the incoming sample into it
  // (see stabiliseFingerprint / chooseLogoPhash above).
  if (logo_phash !== undefined || keyword_fingerprint !== undefined) {
    const cur = db.prepare('SELECT logo_phash, keyword_fingerprint FROM templates WHERE id = ?').get(id) || {};
    if (logo_phash !== undefined) {
      sets.push('logo_phash = ?');
      params.push(chooseLogoPhash(cur.logo_phash, logo_phash));
    }
    if (keyword_fingerprint !== undefined) {
      const merged = stabiliseFingerprint(_parseJson(cur.keyword_fingerprint, []), keyword_fingerprint);
      sets.push('keyword_fingerprint = ?');
      params.push(JSON.stringify(merged));
    }
  }
  params.push(id);
  db.prepare(`UPDATE templates SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  if (fields && fields.length) _upsertFields(db, id, fields);

  // Multi-reference logo-hash maintenance (migration 26): seed the established
  // primary into the reference set, then APPEND this scan's hash when it's a
  // drifted-but-related sample (within the band, not a near-duplicate) so the set
  // converges to span this supplier's render drift. addLogoHash dedups + caps.
  if (logo_phash) {
    const primary = (db.prepare('SELECT logo_phash FROM templates WHERE id = ?').get(id) || {}).logo_phash;
    if (primary) addLogoHash(db, id, primary);
    const minD = minLogoDistance(db, id, logo_phash, primary);
    if (minD > LOGO_DEDUP_FLOOR && minD <= LOGO_APPEND_BAND) addLogoHash(db, id, logo_phash);
  }
}

function _upsertFields(db, templateId, fields) {
  // A confirmed-history rebuild must NOT erase an admin-LOCKED fixed value
  // (fixed_locked = 1) — the CASE keeps the existing row's fixed_value/is_variable
  // when locked, else takes the recomputed values (unchanged behaviour for unlocked
  // rows). fixed_locked itself is never touched here, so a locked row stays locked.
  const stmt = db.prepare(`
    INSERT INTO template_fields
      (template_id, field_key, anchor_label, direction, fixed_value, is_variable)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(template_id, field_key) DO UPDATE SET
      anchor_label = excluded.anchor_label,
      direction    = excluded.direction,
      fixed_value  = CASE WHEN fixed_locked = 1 THEN fixed_value ELSE excluded.fixed_value END,
      is_variable  = CASE WHEN fixed_locked = 1 THEN is_variable ELSE excluded.is_variable END
  `);
  for (const f of fields) {
    stmt.run(
      templateId,
      f.field_key,
      f.anchor_label  || null,
      f.direction     || 'right',
      f.fixed_value   || null,
      f.is_variable !== false && f.is_variable !== 0 ? 1 : 0
    );
  }
}

// Explicit admin-set fixed value for ONE template field (Template Manager /
// Template Wizard → "Fixed value"). A fixed value makes
// template_matcher.extract_with_template emit it for every matching document — and,
// because the admin set it deliberately, as the PROTECTED method
// 'template_fixed_locked' (confidence 95) that the engine guards from ordinary
// OCR/keyword/anchor overrides, NOT the overridable auto-derived 'template_fixed'.
// fixed_locked = 1 marks that intent and is preserved across confirmed-history
// rebuilds (_upsertFields). Clearing it (null/empty) sets fixed_value=NULL,
// is_variable=1 AND fixed_locked=0, returning the field to normal variable
// behaviour. Only fixed_value/is_variable/fixed_locked are touched on conflict, so
// any learned anchor_label/direction on the same row is preserved.
function setFieldFixedValue(db, templateId, fieldKey, fixedValue) {
  const val = (fixedValue == null || String(fixedValue).trim() === '')
    ? null
    : String(fixedValue).trim();
  const isVariable = val === null ? 1 : 0;
  const locked     = val === null ? 0 : 1;
  db.prepare(`
    INSERT INTO template_fields (template_id, field_key, fixed_value, is_variable, fixed_locked)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(template_id, field_key) DO UPDATE SET
      fixed_value  = excluded.fixed_value,
      is_variable  = excluded.is_variable,
      fixed_locked = excluded.fixed_locked
  `).run(templateId, fieldKey, val, isVariable, locked);
  return getById(db, templateId);
}

function hammingDistance(h1, h2) {
  if (!h1 || !h2 || h1.length !== h2.length) return 64;
  let dist = 0;
  for (let i = 0; i < h1.length; i++) {
    let xor = parseInt(h1[i], 16) ^ parseInt(h2[i], 16);
    while (xor) { dist += xor & 1; xor >>= 1; }
  }
  return dist;
}

function _parseJson(str, fallback) {
  try { return JSON.parse(str || 'null') || fallback; } catch { return fallback; }
}

// ── Template groups ───────────────────────────────────────────────────────────
// Organisational grouping only — v1 has no shared-anchor behaviour.  Matching
// (Stage 0 logo/keyword, Stage 0.5 mapping) is purely per-template; group_id
// is metadata consumed only by the admin UI and returned via getById's SELECT *.

function getAllGroups(db) {
  return db.prepare('SELECT * FROM template_groups ORDER BY name').all();
}

function createGroup(db, name) {
  const info = db.prepare('INSERT INTO template_groups (name) VALUES (?)').run(name.trim());
  return info.lastInsertRowid;
}

function deleteGroup(db, id) {
  const tx = db.transaction(() => {
    db.prepare('UPDATE templates SET group_id = NULL WHERE group_id = ?').run(id);
    db.prepare('DELETE FROM template_groups WHERE id = ?').run(id);
  });
  tx();
}

function setTemplateGroup(db, templateId, groupId) {
  db.prepare('UPDATE templates SET group_id = ? WHERE id = ?').run(groupId || null, templateId);
  return getById(db, templateId);
}

function getSiblings(db, groupId, excludeTemplateId) {
  return db.prepare(
    'SELECT id, name, document_type_slug FROM templates WHERE group_id = ? AND id != ? ORDER BY name'
  ).all(groupId, excludeTemplateId);
}

// ── Registration landmarks (migration 22) ───────────────────────────────────
// Per-template stable text landmarks used to fit a similarity/affine transform
// from the taught page onto an incoming (shifted/skewed/scaled) page — see
// python_backend/extraction/registration.py. Additive: a template with no
// landmarks simply falls through to the existing anchor/offset path.

// ── Multi-reference logo hashes (migration 26) ──────────────────────────────
function getLogoHashes(db, templateId) {
  return db.prepare(
    'SELECT phash FROM template_logo_hashes WHERE template_id = ? ORDER BY id'
  ).all(templateId).map(r => r.phash);
}

// Append a logo hash to a template's reference set (idempotent via UNIQUE), capped
// at LOGO_HASH_CAP. On overflow, evict the MOST REDUNDANT non-primary ref (smallest
// distance to another ref; tie-broken oldest), never the template's seed/primary
// logo_phash. One transaction.
function addLogoHash(db, templateId, phash) {
  if (!phash) return;
  const tx = db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO template_logo_hashes (template_id, phash) VALUES (?, ?)')
      .run(templateId, phash);
    const rows = db.prepare(
      'SELECT id, phash FROM template_logo_hashes WHERE template_id = ? ORDER BY id'
    ).all(templateId);
    if (rows.length <= LOGO_HASH_CAP) return;
    const primary = (db.prepare('SELECT logo_phash FROM templates WHERE id = ?').get(templateId) || {}).logo_phash || null;
    let victim = null, bestRedund = Infinity;
    for (const r of rows) {                       // rows ordered oldest-first → oldest wins ties
      if (r.phash === primary) continue;          // never evict the seed/primary
      let nearest = 64;
      for (const o of rows) {
        if (o.id === r.id) continue;
        const d = hammingDistance(r.phash, o.phash);
        if (d < nearest) nearest = d;
      }
      if (nearest < bestRedund) { bestRedund = nearest; victim = r.id; }
    }
    if (victim != null) db.prepare('DELETE FROM template_logo_hashes WHERE id = ?').run(victim);
  });
  tx();
}

// Min Hamming from a phash to a template's whole reference set — falls back to the
// legacy single logo_phash so pre-migration / un-backfilled templates still match.
function minLogoDistance(db, templateId, phash, primaryFallback) {
  if (!phash) return 64;
  let hashes = getLogoHashes(db, templateId);
  if (!hashes.length && primaryFallback) hashes = [primaryFallback];
  let best = 64;
  for (const h of hashes) { const d = hammingDistance(phash, h); if (d < best) best = d; }
  return best;
}

// Fraction of the candidate template's keyword fingerprint also present in the
// document's — the over-merge guard for the widened (7-13) convergence reuse band.
function _keywordOverlap(docFp, candFp) {
  const cand = (candFp || []).map(s => String(s).toLowerCase());
  if (!cand.length) return 0;
  const doc = new Set((docFp || []).map(s => String(s).toLowerCase()));
  let hits = 0;
  for (const k of cand) if (doc.has(k)) hits++;
  return hits / cand.length;
}

function getLandmarks(db, templateId) {
  return db.prepare(
    'SELECT * FROM template_landmarks WHERE template_id = ? ORDER BY page_number, id'
  ).all(templateId);
}

// Replace-all in one transaction (the wizard / backfill recomputes the whole
// set for a template at once, never appends piecemeal). `source` tags how the set
// was produced ('auto' = derived; 'manual' = admin-drawn via Enhance detection);
// a row's own l.source wins so an adopted (merge) set keeps its origin.
function setLandmarks(db, templateId, landmarks, source = 'auto') {
  const rows = Array.isArray(landmarks) ? landmarks : [];
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM template_landmarks WHERE template_id = ?').run(templateId);
    const ins = db.prepare(`
      INSERT INTO template_landmarks
        (template_id, label_text, x_norm, y_norm, w_norm, h_norm, ocr_conf, page_number, source)
      VALUES (@template_id, @label_text, @x_norm, @y_norm, @w_norm, @h_norm, @ocr_conf, @page_number, @source)
    `);
    for (const l of rows) {
      if (!l || l.label_text == null) continue;
      ins.run({
        template_id: templateId,
        label_text:  String(l.label_text),
        x_norm:      Number(l.x_norm), y_norm: Number(l.y_norm),
        w_norm:      Number(l.w_norm), h_norm: Number(l.h_norm),
        ocr_conf:    l.ocr_conf == null ? null : Number(l.ocr_conf),
        page_number: l.page_number == null ? 0 : (Number(l.page_number) | 0),
        source:      l.source || source,
      });
    }
  });
  tx();
  return getLandmarks(db, templateId);
}

// True if the template has admin-drawn (manual) landmarks — auto-derivation must
// NOT overwrite these (see generateLandmarks guard).
function hasManualLandmarks(db, templateId) {
  return !!db.prepare(
    "SELECT 1 FROM template_landmarks WHERE template_id = ? AND source = 'manual' LIMIT 1"
  ).get(templateId);
}

function clearLandmarks(db, templateId) {
  db.prepare('DELETE FROM template_landmarks WHERE template_id = ?').run(templateId);
}

// True if the template's landmarks were auto-derived from the cross-sample corpus
// (source='cross_sample') — the single-sample bootstrap must not downgrade these.
function hasCrossSampleLandmarks(db, templateId) {
  return !!db.prepare(
    "SELECT 1 FROM template_landmarks WHERE template_id = ? AND source = 'cross_sample' LIMIT 1"
  ).get(templateId);
}

// ── Cross-sample landmark corpus (migration 34) ──────────────────────────────
// Per-confirmed-document captured words. REPLACE-per-doc (idempotent) so
// re-confirming a document never double-counts it in the corpus.
function replaceSampleWords(db, templateId, docId, words) {
  const rows = Array.isArray(words) ? words : [];
  const tx = db.transaction(() => {
    if (docId != null) {
      db.prepare('DELETE FROM template_sample_words WHERE template_id = ? AND doc_id = ?').run(templateId, docId);
    }
    const ins = db.prepare(`
      INSERT INTO template_sample_words
        (template_id, doc_id, label_text, x_norm, y_norm, w_norm, h_norm, ocr_conf)
      VALUES (@template_id, @doc_id, @label_text, @x_norm, @y_norm, @w_norm, @h_norm, @ocr_conf)
    `);
    for (const w of rows) {
      if (!w || w.text == null) continue;
      ins.run({
        template_id: templateId, doc_id: docId == null ? null : docId,
        label_text: String(w.text),
        x_norm: Number(w.x_norm), y_norm: Number(w.y_norm),
        w_norm: Number(w.w_norm), h_norm: Number(w.h_norm),
        ocr_conf: w.conf == null ? null : Number(w.conf),
      });
    }
  });
  tx();
}

function countSampleDocs(db, templateId) {
  const r = db.prepare(
    'SELECT COUNT(DISTINCT doc_id) AS n FROM template_sample_words WHERE template_id = ?'
  ).get(templateId);
  return (r && r.n) || 0;
}

// Per-doc word lists for cross-sample selection: [[{text,conf,x_norm,…}], …].
function getSampleWordsByDoc(db, templateId) {
  const rows = db.prepare(`
    SELECT doc_id, label_text, x_norm, y_norm, w_norm, h_norm, ocr_conf
    FROM template_sample_words WHERE template_id = ? ORDER BY doc_id, id
  `).all(templateId);
  const byDoc = new Map();
  for (const r of rows) {
    const k = r.doc_id == null ? 0 : r.doc_id;
    if (!byDoc.has(k)) byDoc.set(k, []);
    byDoc.get(k).push({
      text: r.label_text, conf: r.ocr_conf,
      x_norm: r.x_norm, y_norm: r.y_norm, w_norm: r.w_norm, h_norm: r.h_norm,
    });
  }
  return [...byDoc.values()];
}

module.exports = {
  getAll, getById, getFields, findByLogoHash, findByKeywordFingerprint, identifyByFingerprint,
  searchByName,
  create, update, remove, rename, hammingDistance,
  stabiliseFingerprint, chooseLogoPhash,
  getMappings, getMapping, saveMapping, setMappingEnabled, deleteMapping,
  recordMappingTest, setSampleDocument, reassignDocuments, mergeInto, setFieldFixedValue,
  setOcrAutoParams, setOcrAutoEnabled,
  getLandmarks, setLandmarks, clearLandmarks, hasManualLandmarks, hasCrossSampleLandmarks,
  replaceSampleWords, countSampleDocs, getSampleWordsByDoc,
  getLogoHashes, addLogoHash, minLogoDistance, keywordOverlap: _keywordOverlap,
  getAllGroups, createGroup, deleteGroup, setTemplateGroup, getSiblings,
  GRID_COLS, GRID_ROWS,
};
