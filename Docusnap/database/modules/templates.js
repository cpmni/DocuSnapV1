'use strict';

function getAll(db) {
  const rows = db.prepare(
    'SELECT * FROM templates ORDER BY confirmed_count DESC, name'
  ).all();
  for (const t of rows) {
    t.fields              = getFields(db, t.id);
    t.field_mappings      = getMappings(db, t.id);
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

function findByLogoHash(db, phash, threshold = 12) {
  if (!phash) return null;
  const rows = db.prepare(
    'SELECT * FROM templates WHERE logo_phash IS NOT NULL'
  ).all();
  let best = null, bestDist = threshold + 1;
  for (const t of rows) {
    const dist = hammingDistance(phash, t.logo_phash);
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
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const info = db.prepare(`
    INSERT INTO templates (name, slug, document_type_slug, logo_phash, keyword_fingerprint)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, slug, document_type_slug || null, logo_phash || null,
         JSON.stringify(keyword_fingerprint || []));
  const id = info.lastInsertRowid;
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
}

function _upsertFields(db, templateId, fields) {
  const stmt = db.prepare(`
    INSERT INTO template_fields
      (template_id, field_key, anchor_label, direction, fixed_value, is_variable)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(template_id, field_key) DO UPDATE SET
      anchor_label = excluded.anchor_label,
      direction    = excluded.direction,
      fixed_value  = excluded.fixed_value,
      is_variable  = excluded.is_variable
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

// Explicit admin-set fixed value for ONE template field (Template Manager →
// "Fixed Field Values"). A fixed value makes template_matcher.extract_with_template
// emit it for every matching document (method 'template_fixed', confidence 95),
// independent of OCR — exactly the same mechanism _buildTemplateFields uses on
// confirm, just driven explicitly from the UI instead of inferred. Clearing it
// (null/empty) sets fixed_value=NULL and is_variable=1, returning the field to
// normal variable behaviour. Only fixed_value + is_variable are touched on
// conflict, so any learned anchor_label/direction on the same row is preserved.
function setFieldFixedValue(db, templateId, fieldKey, fixedValue) {
  const val = (fixedValue == null || String(fixedValue).trim() === '')
    ? null
    : String(fixedValue).trim();
  const isVariable = val === null ? 1 : 0;
  db.prepare(`
    INSERT INTO template_fields (template_id, field_key, fixed_value, is_variable)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(template_id, field_key) DO UPDATE SET
      fixed_value = excluded.fixed_value,
      is_variable = excluded.is_variable
  `).run(templateId, fieldKey, val, isVariable);
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

module.exports = {
  getAll, getById, getFields, findByLogoHash, findByKeywordFingerprint, identifyByFingerprint,
  searchByName,
  create, update, remove, rename, hammingDistance,
  stabiliseFingerprint, chooseLogoPhash,
  getMappings, getMapping, saveMapping, setMappingEnabled, deleteMapping,
  recordMappingTest, setSampleDocument, reassignDocuments, setFieldFixedValue,
  setOcrAutoParams, setOcrAutoEnabled,
  getAllGroups, createGroup, deleteGroup, setTemplateGroup, getSiblings,
  GRID_COLS, GRID_ROWS,
};
