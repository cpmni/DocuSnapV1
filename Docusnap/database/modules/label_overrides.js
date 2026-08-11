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

// Full rows for the admin UI (Settings → Learning). exclusive + template scope included
// (Oracle C3, 2026-08-11): turning `teach_label_becomes_keyword` OFF does not retire rows —
// only WRITES are gated — so deletion in this list is the one remediation, and the operator
// must be able to SEE which rows are teach-written (exclusive) and which template they scope
// to. template_name is joined for display; the scope key stays template_id.
function listLabelOverrides(db) {
  return db.prepare(`
    SELECT o.id, o.doc_type_slug, o.field_key, o.label, o.created_at,
           COALESCE(o.exclusive, 0) AS exclusive,
           COALESCE(o.template_id, 0) AS template_id,
           t.name AS template_name
    FROM field_label_overrides o
    LEFT JOIN templates t ON t.id = o.template_id
    ORDER BY o.doc_type_slug, o.field_key, o.label
  `).all();
}

// Minimal shape the Python extractor consumes. template_id (migration 62): 0 = doc-type-wide
// (admin/preset rows); non-zero = applies only when THAT template matched the document.
function getForExtraction(db) {
  return db.prepare(
    'SELECT doc_type_slug, field_key, label, exclusive, template_id FROM field_label_overrides'
  ).all();
}

// `exclusive` (migration 61, owner decision 2026-08-11): the label REPLACES the shipped caption
// bank for its (doc type, field) instead of being prepended to it — see keyword.merge_label_overrides.
// `template_id` (migration 62, owner decision same day): a TEACH-written override is scoped to the
// template it was taught on ("per doc type for each supplier — set at the template level"), so one
// supplier's caption never becomes the keyword for every supplier's documents of that type.
// Written by the TEACH path (a confirmed taught caption); the admin Settings screen never passes
// either, so an admin-typed override stays additive and doc-type-wide.
// NOTE the INSERT OR IGNORE: re-teaching the SAME label is a no-op, which is correct, but it also
// means an existing ADDITIVE row for that label is not promoted to exclusive. Promote explicitly so
// a re-teach after an admin typed the same caption still does what the operator asked — the promote
// targets the SAME-SCOPE row (matching template_id), never an admin's doc-type-wide row.
function addLabelOverride(db, { doc_type_slug, field_key, label, exclusive, template_id } = {}) {
  const slug = String(doc_type_slug || '').trim();
  const key  = String(field_key || '').trim();
  const lab  = String(label || '').trim();
  if (!slug || !key || !lab) return { ok: false, code: 'missing_fields' };
  if (lab.length > 120) return { ok: false, code: 'label_too_long' };
  const ex = exclusive ? 1 : 0;
  const tpl = Number.isInteger(template_id) && template_id > 0 ? template_id : 0;
  const info = db.prepare(`
    INSERT OR IGNORE INTO field_label_overrides (doc_type_slug, field_key, label, exclusive, template_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(slug, key, lab, ex, tpl);
  let promoted = 0;
  if (ex && !info.changes) {
    promoted = db.prepare(`
      UPDATE field_label_overrides SET exclusive = 1
      WHERE doc_type_slug = ? AND field_key = ? AND label = ? AND template_id = ?
        AND COALESCE(exclusive, 0) = 0
    `).run(slug, key, lab, tpl).changes;
  }
  return { ok: true, inserted: info.changes, promoted };  // inserted=0 -> duplicate (no-op)
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
