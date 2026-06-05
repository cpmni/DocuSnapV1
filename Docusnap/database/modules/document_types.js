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
      { key: 'supplier_name',        label: 'Supplier Name',       type: 'text',     required: 1, sort_order: 10 },
      { key: 'customer_name',        label: 'Customer Name',       type: 'text',     required: 0, sort_order: 20 },
      { key: 'invoice_number',       label: 'Invoice Number',      type: 'text',     required: 1, sort_order: 30 },
      { key: 'invoice_date',         label: 'Invoice Date',        type: 'date',     required: 1, sort_order: 40 },
      { key: 'due_date',             label: 'Due Date',            type: 'date',     required: 0, sort_order: 50 },
      { key: 'purchase_order_number',label: 'PO Reference',        type: 'text',     required: 0, sort_order: 60 },
      { key: 'payment_terms',        label: 'Payment Terms',       type: 'text',     required: 0, sort_order: 70 },
      { key: 'subtotal',             label: 'Subtotal',            type: 'currency', required: 0, sort_order: 80 },
      { key: 'vat_tax',              label: 'VAT / Tax',           type: 'currency', required: 0, sort_order: 90 },
      { key: 'total_amount',         label: 'Total Amount',        type: 'currency', required: 1, sort_order: 100 },
      { key: 'currency',             label: 'Currency',            type: 'text',     required: 0, sort_order: 110 },
      { key: 'supplier_address',     label: 'Supplier Address',    type: 'text',     required: 0, sort_order: 120 },
      { key: 'customer_address',     label: 'Customer Address',    type: 'text',     required: 0, sort_order: 130 },
      { key: 'notes',                label: 'Notes',               type: 'text',     required: 0, sort_order: 140 },
    ]
  },
  {
    name:           'Sales Order',
    slug:           'sales_order',
    ref_field_key:  'sales_order_number',
    date_field_key: 'order_date',
    sort_order:     20,
    fields: [
      { key: 'customer_name',        label: 'Customer Name',       type: 'text',     required: 1, sort_order: 10 },
      { key: 'supplier_name',        label: 'Supplier Name',       type: 'text',     required: 0, sort_order: 20 },
      { key: 'sales_order_number',   label: 'Sales Order Number',  type: 'text',     required: 1, sort_order: 30 },
      { key: 'order_date',           label: 'Order Date',          type: 'date',     required: 1, sort_order: 40 },
      { key: 'delivery_date',        label: 'Delivery Date',       type: 'date',     required: 0, sort_order: 50 },
      { key: 'customer_reference',   label: 'Customer Reference',  type: 'text',     required: 0, sort_order: 60 },
      { key: 'delivery_address',     label: 'Delivery Address',    type: 'text',     required: 0, sort_order: 70 },
      { key: 'subtotal',             label: 'Subtotal',            type: 'currency', required: 0, sort_order: 80 },
      { key: 'vat_tax',              label: 'VAT / Tax',           type: 'currency', required: 0, sort_order: 90 },
      { key: 'total_amount',         label: 'Total Amount',        type: 'currency', required: 0, sort_order: 100 },
      { key: 'currency',             label: 'Currency',            type: 'text',     required: 0, sort_order: 110 },
      { key: 'notes',                label: 'Notes',               type: 'text',     required: 0, sort_order: 120 },
    ]
  },
  {
    name:           'Purchase Order',
    slug:           'purchase_order',
    ref_field_key:  'po_number',
    date_field_key: 'po_date',
    sort_order:     30,
    fields: [
      { key: 'buyer_name',           label: 'Buyer Name',          type: 'text',     required: 1, sort_order: 10 },
      { key: 'supplier_name',        label: 'Supplier Name',       type: 'text',     required: 0, sort_order: 20 },
      { key: 'po_number',            label: 'PO Number',           type: 'text',     required: 1, sort_order: 30 },
      { key: 'po_date',              label: 'PO Date',             type: 'date',     required: 1, sort_order: 40 },
      { key: 'delivery_date',        label: 'Delivery Date',       type: 'date',     required: 0, sort_order: 50 },
      { key: 'delivery_address',     label: 'Delivery Address',    type: 'text',     required: 0, sort_order: 60 },
      { key: 'authorised_by',        label: 'Authorised By',       type: 'text',     required: 0, sort_order: 70 },
      { key: 'subtotal',             label: 'Subtotal',            type: 'currency', required: 0, sort_order: 80 },
      { key: 'vat_tax',              label: 'VAT / Tax',           type: 'currency', required: 0, sort_order: 90 },
      { key: 'total_amount',         label: 'Total Amount',        type: 'currency', required: 0, sort_order: 100 },
      { key: 'currency',             label: 'Currency',            type: 'text',     required: 0, sort_order: 110 },
      { key: 'notes',                label: 'Notes',               type: 'text',     required: 0, sort_order: 120 },
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
  return dt;
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
  seedBuiltInTypes, getAll, getWithFields, getAllWithFields,
  addType, updateType, addField, updateField, deleteField,
};
