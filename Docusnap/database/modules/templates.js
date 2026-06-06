'use strict';

function getAll(db) {
  const rows = db.prepare(
    'SELECT * FROM templates ORDER BY confirmed_count DESC, name'
  ).all();
  for (const t of rows) {
    t.fields              = getFields(db, t.id);
    t.keyword_fingerprint = _parseJson(t.keyword_fingerprint, []);
  }
  return rows;
}

function getFields(db, templateId) {
  return db.prepare(
    'SELECT * FROM template_fields WHERE template_id = ? ORDER BY field_key'
  ).all(templateId);
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

module.exports = { getAll, getFields, findByLogoHash, create, update, hammingDistance };
