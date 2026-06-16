'use strict';

/**
 * database/modules/label_overrides.js
 * Admin-managed keyword label overrides (migration 19).
 *
 * Extra label words for a (doc_type_slug, field_key) so the cheap keyword stage
 * (Stage 1) catches a field without per-document anchor teaching. These are
 * CUSTOMER-SPECIFIC and per-installation: the table lives in the userData DB and
 * is NEVER packaged — only the shipped config/keyword_patterns.json carries
 * default labels. The processing handler reads getForExtraction() into a temp
 * file each run; the Python extractor merges them onto the shipped defaults,
 * scoped to the detected doc-type slug (see keyword.merge_label_overrides).
 */

// Full rows for the admin UI (Settings → Advanced).
function listLabelOverrides(db) {
  return db.prepare(`
    SELECT id, doc_type_slug, field_key, label, created_at
    FROM field_label_overrides
    ORDER BY doc_type_slug, field_key, label
  `).all();
}

// Minimal shape the Python extractor consumes.
function getForExtraction(db) {
  return db.prepare(
    'SELECT doc_type_slug, field_key, label FROM field_label_overrides'
  ).all();
}

function addLabelOverride(db, { doc_type_slug, field_key, label } = {}) {
  const slug = String(doc_type_slug || '').trim();
  const key  = String(field_key || '').trim();
  const lab  = String(label || '').trim();
  if (!slug || !key || !lab) return { ok: false, code: 'missing_fields' };
  if (lab.length > 120) return { ok: false, code: 'label_too_long' };
  const info = db.prepare(`
    INSERT OR IGNORE INTO field_label_overrides (doc_type_slug, field_key, label)
    VALUES (?, ?, ?)
  `).run(slug, key, lab);
  return { ok: true, inserted: info.changes };  // inserted=0 -> duplicate (no-op)
}

// Soft cap on labels per (doc-type, field): stops an accidental giant paste from
// bloating every Stage-1 run (each label is an extra scan loop per document).
const MAX_LABELS_PER_FIELD = 25;

// Split admin input into clean labels. Accepts an array OR a string delimited by
// commas and/or newlines (so a pasted vertical list works too). Trims, drops
// empties, and de-duplicates within the input case-insensitively (keeping the
// first-seen casing). Pure.
function parseLabels(input) {
  const raw = Array.isArray(input) ? input : String(input == null ? '' : input).split(/[,\n]+/);
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const lab = String(item == null ? '' : item).trim();
    if (!lab) continue;
    const k = lab.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(lab);
  }
  return out;
}

// Bulk add — one transaction. `labels` may be an array or a comma/newline string.
// Returns { ok, inserted, alreadyExisted, rejected:[{label,code}], warnings:[{label,field_key}] }.
// rejected codes: 'too_long' | 'cap_reached'. warnings flag a label already used by
// a DIFFERENT field of the same doc type (non-blocking — the label is still added).
function addLabelOverrides(db, { doc_type_slug, field_key, labels } = {}) {
  const slug = String(doc_type_slug || '').trim();
  const key  = String(field_key || '').trim();
  if (!slug || !key) return { ok: false, code: 'missing_fields' };
  const parsed = parseLabels(labels);
  if (!parsed.length) return { ok: false, code: 'no_labels' };

  const insert = db.prepare(`
    INSERT OR IGNORE INTO field_label_overrides (doc_type_slug, field_key, label)
    VALUES (?, ?, ?)
  `);
  const countForField = db.prepare(
    'SELECT COUNT(*) AS c FROM field_label_overrides WHERE doc_type_slug = ? AND field_key = ?'
  );
  const sameLabelOtherField = db.prepare(`
    SELECT field_key FROM field_label_overrides
    WHERE doc_type_slug = ? AND lower(label) = lower(?) AND field_key != ?
    LIMIT 1
  `);

  const result = { ok: true, inserted: 0, alreadyExisted: 0, rejected: [], warnings: [] };
  db.transaction(() => {
    let count = countForField.get(slug, key).c;   // existing rows for this field
    for (const lab of parsed) {
      if (lab.length > 120)              { result.rejected.push({ label: lab, code: 'too_long' });    continue; }
      if (count >= MAX_LABELS_PER_FIELD) { result.rejected.push({ label: lab, code: 'cap_reached' }); continue; }
      const collision = sameLabelOtherField.get(slug, lab, key);
      const info = insert.run(slug, key, lab);
      if (info.changes) {
        result.inserted++;
        count++;
        if (collision) result.warnings.push({ label: lab, field_key: collision.field_key });
      } else {
        result.alreadyExisted++;
      }
    }
  })();
  return result;
}

function deleteLabelOverride(db, id) {
  const info = db.prepare('DELETE FROM field_label_overrides WHERE id = ?').run(id);
  return { ok: true, deleted: info.changes };
}

module.exports = {
  listLabelOverrides, getForExtraction,
  addLabelOverride, addLabelOverrides, parseLabels, deleteLabelOverride,
};
