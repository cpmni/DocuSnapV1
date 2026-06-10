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

// Cheap name-based lookup for the Learning Recovery tab — shows managed
// templates alongside (but separate from) automatic learning data for the
// same supplier. Matching is purely cosmetic (template name vs. supplier
// name); it does not affect identification, which uses logo_phash /
// keyword_fingerprint exclusively.
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

function update(db, id, { logo_phash, keyword_fingerprint, fields } = {}) {
  const sets   = ["confirmed_count = confirmed_count + 1", "updated_at = datetime('now')"];
  const params = [];
  if (logo_phash          !== undefined) { sets.push('logo_phash = ?');          params.push(logo_phash); }
  if (keyword_fingerprint !== undefined) { sets.push('keyword_fingerprint = ?'); params.push(JSON.stringify(keyword_fingerprint)); }
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
  getAll, getById, getFields, findByLogoHash, create, update, remove, rename, hammingDistance,
  searchByName,
  getMappings, getMapping, saveMapping, setMappingEnabled, deleteMapping,
  recordMappingTest, setSampleDocument,
  setOcrAutoParams, setOcrAutoEnabled,
  getAllGroups, createGroup, deleteGroup, setTemplateGroup, getSiblings,
  GRID_COLS, GRID_ROWS,
};
