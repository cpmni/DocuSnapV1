'use strict';

// ── Default document types and their field sets ───────────────────────────────

const BUILT_IN_TYPES = [
  {
    name:           'Invoice',
    slug:           'invoice',
    ref_field_key:  'invoice_number',
    date_field_key: 'invoice_date',
    sort_order:     10,
    fields: [
      { key: 'supplier_name',  label: 'Supplier Name',   type: 'text', required: 1, sort_order: 10 },
      { key: 'invoice_date',   label: 'Invoice Date',    type: 'date', required: 1, sort_order: 20 },
      { key: 'invoice_number', label: 'Invoice Number',  type: 'text', required: 1, sort_order: 30 },
    ]
  },
  {
    name:           'Sales Order',
    slug:           'sales_order',
    ref_field_key:  'sales_order_number',
    date_field_key: 'order_date',
    sort_order:     20,
    fields: [
      { key: 'customer_name',       label: 'Customer Name',       type: 'text', required: 1, sort_order: 10 },
      { key: 'order_date',          label: 'Order Date',          type: 'date', required: 1, sort_order: 20 },
      { key: 'sales_order_number',  label: 'Sales Order Number',  type: 'text', required: 1, sort_order: 30 },
    ]
  },
  {
    name:           'Purchase Order',
    slug:           'purchase_order',
    ref_field_key:  'po_number',
    date_field_key: 'po_date',
    sort_order:     30,
    fields: [
      { key: 'supplier_name', label: 'Supplier Name', type: 'text', required: 1, sort_order: 10 },
      { key: 'po_date',       label: 'PO Date',       type: 'date', required: 1, sort_order: 20 },
      { key: 'po_number',     label: 'PO Number',     type: 'text', required: 1, sort_order: 30 },
    ]
  },
];

function seedBuiltInTypes(db) {
  const insertType = db.prepare(`
    INSERT OR IGNORE INTO document_types
      (name, slug, built_in, ref_field_key, date_field_key, sort_order)
    VALUES
      (@name, @slug, 1, @ref_field_key, @date_field_key, @sort_order)
  `);

  const insertField = db.prepare(`
    INSERT OR IGNORE INTO fields
      (document_type_id, key, label, type, required, built_in, sort_order)
    VALUES
      (@document_type_id, @key, @label, @type, @required, 1, @sort_order)
  `);

  const seed = db.transaction(() => {
    for (const dt of BUILT_IN_TYPES) {
      insertType.run(dt);
      const row = db.prepare(
        'SELECT id FROM document_types WHERE slug = ?'
      ).get(dt.slug);
      if (!row) continue;
      for (const f of dt.fields) {
        insertField.run({ ...f, document_type_id: row.id });
      }
    }
  });
  seed();
}

// ── Field variability (schema-derived) ────────────────────────────────────────
//
// "Is this field's value constant for a given supplier (safe to remember as a
// template fixed_value / supplier hint) or does it vary per document (must be
// re-located on every document, never cached)?" used to be answered by
// hand-maintained per-field-key tables scattered across the codebase (e.g. a
// FIELD_ANCHORS map of "po_number: variable, supplier_name: not"). Those don't
// extend to custom document types/fields, can drift out of sync, and a wrong
// guess for a "variable" field is exactly how a stale value (e.g. one
// supplier's PO number) gets force-applied to a different document.
//
// The document type's own schema already encodes this: the designated
// reference/date fields are by definition unique per document, and so is any
// field typed as a date. Everything else defaults to "constant" — which is
// also the right default for supplier_name/customer_name/addresses/terms.
function _annotateFieldVariability(dt) {
  for (const f of dt.fields || []) {
    f.is_variable = (
      f.key === dt.ref_field_key ||
      f.key === dt.date_field_key ||
      f.type === 'date'
    ) ? 1 : 0;
  }
  return dt;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

function getAll(db) {
  return db.prepare(`
    SELECT * FROM document_types WHERE enabled = 1 ORDER BY sort_order, name
  `).all();
}

function getWithFields(db, slug) {
  const dt = db.prepare(
    'SELECT * FROM document_types WHERE slug = ?'
  ).get(slug);
  if (!dt) return null;
  dt.fields = db.prepare(`
    SELECT * FROM fields
    WHERE document_type_id = ? AND enabled = 1
    ORDER BY sort_order
  `).all(dt.id);
  return _annotateFieldVariability(dt);
}

function getAllWithFields(db) {
  const types = db.prepare(
    'SELECT * FROM document_types WHERE enabled = 1 ORDER BY sort_order'
  ).all();
  for (const dt of types) {
    dt.fields = db.prepare(`
      SELECT * FROM fields
      WHERE document_type_id = ? AND enabled = 1
      ORDER BY sort_order
    `).all(dt.id);
    _annotateFieldVariability(dt);
  }
  return types;
}

function getAllWithFieldsAll(db) {
  const types = db.prepare(
    'SELECT * FROM document_types ORDER BY sort_order, name'
  ).all();
  for (const dt of types) {
    dt.fields = db.prepare(`
      SELECT * FROM fields WHERE document_type_id = ? ORDER BY sort_order
    `).all(dt.id);
  }
  return types;
}

function addType(db, { name, ref_field_key, date_field_key }) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return db.prepare(`
    INSERT INTO document_types (name, slug, built_in, ref_field_key, date_field_key)
    VALUES (?, ?, 0, ?, ?)
  `).run(name, slug, ref_field_key || null, date_field_key || null);
}

function addField(db, { document_type_id, key, label, type = 'text',
                        required = 0, sort_order = 100 }) {
  const safeKey = key.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  return db.prepare(`
    INSERT INTO fields (document_type_id, key, label, type, required, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(document_type_id, safeKey, label, type, required, sort_order);
}

function updateField(db, id, changes) {
  const allowed = ['label', 'type', 'required', 'enabled',
                   'confidence_threshold', 'sort_order'];
  const sets = Object.keys(changes)
    .filter(k => allowed.includes(k))
    .map(k => `${k} = @${k}`)
    .join(', ');
  if (!sets) return;
  return db.prepare(`UPDATE fields SET ${sets} WHERE id = @id`)
    .run({ ...changes, id });
}

function deleteField(db, id) {
  return db.prepare(
    'DELETE FROM fields WHERE id = ? AND built_in = 0'
  ).run(id);
}

function updateType(db, id, changes) {
  const allowed = ['name', 'enabled', 'ref_field_key',
                   'date_field_key', 'sort_order'];
  const sets = Object.keys(changes)
    .filter(k => allowed.includes(k))
    .map(k => `${k} = @${k}`)
    .join(', ');
  if (!sets) return;
  return db.prepare(`UPDATE document_types SET ${sets} WHERE id = @id`)
    .run({ ...changes, id });
}

module.exports = {
  seedBuiltInTypes, getAll, getWithFields, getAllWithFields, getAllWithFieldsAll,
  addType, updateType, addField, updateField, deleteField,
};
