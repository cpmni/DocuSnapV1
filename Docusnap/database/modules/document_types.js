'use strict';

const { addLabelOverrides } = require('./label_overrides');
const { safeSlug, uniqueSlug } = require('./slug');

// ── Structural roles ──────────────────────────────────────────────────────────
// Every document has three STRUCTURAL fields that drive both filing
// (Company/Year/Month/DocType.Date.Ref) AND all per-supplier learning
// (logo_fingerprints, supplier_hints, field_anchors, corrections, template
// identity — all keyed off the company/scope value). They are PERMANENT: their
// per-document VALUE stays editable (so a mis-read can be corrected — that's what
// feeds learning), but the FIELD itself cannot be deleted, disabled, renamed or
// retyped. A field is structural when its key is the type's reference or date key,
// or it is the COMPANY/identity field. COMPANY_KEYS is the internal scope key; the
// DISPLAY label is "Document Issuer" for BOTH (the entity that issued the document) —
// one unambiguous label so an operator never puts variable data (e.g. a customer name)
// in the identity field. The KEY is the learning scope, so the schema is untouched.
const COMPANY_KEYS = ['supplier_name', 'customer_name'];

function isStructuralKey(dt, key) {
  return COMPANY_KEYS.includes(key)
      || key === (dt && dt.ref_field_key)
      || key === (dt && dt.date_field_key);
}

// ── Default document types and their field sets ───────────────────────────────

const BUILT_IN_TYPES = [
  {
    name:           'Invoice',
    slug:           'invoice',
    ref_field_key:  'invoice_number',
    date_field_key: 'invoice_date',
    sort_order:     10,
    fields: [
      { key: 'supplier_name',  label: 'Document Issuer',   type: 'text', required: 1, sort_order: 10 },
      { key: 'invoice_date',   label: 'Invoice Date',    type: 'date', required: 1, sort_order: 20 },
      { key: 'invoice_number', label: 'Invoice Number',  type: 'text', required: 1, sort_order: 30 },
      // NOTE: money fields (total/subtotal/VAT/shipping/discount) are deliberately NOT seeded.
      // The reconciliation components are SHADOW-extracted in the background for the
      // "mathematically verified" check; they are only shown as fields if the USER adds them.
    ]
  },
  {
    name:           'Sales Order',
    slug:           'sales_order',
    ref_field_key:  'sales_order_number',
    date_field_key: 'order_date',
    sort_order:     20,
    fields: [
      { key: 'customer_name',       label: 'Document Issuer',       type: 'text', required: 1, sort_order: 10 },
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
      { key: 'supplier_name', label: 'Document Issuer', type: 'text', required: 1, sort_order: 10 },
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
  _cleanupAutoMoneyFields(db);
}

// One-time cleanup: an interim build auto-added money component fields
// (total_amount/subtotal/vat_tax/shipping/discount) to built-in types. Those are now
// SHADOW-extracted in the background for the reconciliation check instead of shown as
// fields, so remove the auto-added ones. GUARDED: only a field that is built_in=1 (auto —
// a user's own field is built_in=0) AND carries NO confirmed data is removed, so a
// user-created or populated field is never touched. Idempotent + inert once clean.
const _AUTO_MONEY_KEYS = ['total_amount', 'subtotal', 'vat_tax', 'shipping', 'discount'];
function _cleanupAutoMoneyFields(db) {
  try {
    const placeholders = _AUTO_MONEY_KEYS.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT f.id FROM fields f
      JOIN document_types dt ON dt.id = f.document_type_id
      WHERE dt.built_in = 1 AND f.built_in = 1 AND f.key IN (${placeholders})
        AND NOT EXISTS (
          SELECT 1 FROM extractions e
          JOIN documents d ON d.id = e.document_id
          WHERE e.field_key = f.key AND d.document_type_id = f.document_type_id
            AND d.status = 'confirmed' AND COALESCE(e.display_value, '') <> ''
        )
    `).all(..._AUTO_MONEY_KEYS);
    if (!rows.length) return;
    const del = db.prepare('DELETE FROM fields WHERE id = ?');
    db.transaction(() => { for (const r of rows) del.run(r.id); })();
  } catch (e) { /* cleanup is best-effort — never block startup */ }
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
// field typed as a date OR as CURRENCY — a total/subtotal/tax/amount differs on
// every document, so replaying a remembered value (via supplier hints) or
// freezing one as a template fixed_value is exactly how one invoice's total
// ($3,446.16) ends up stamped onto every other invoice whose total read empty
// (a self-reinforcing monoculture the evidence-based variability guard can't
// break once every confirmed doc carries the same wrong value). Everything else
// defaults to "constant" — the right default for supplier/customer/addresses/terms.
function _annotateFieldVariability(dt) {
  for (const f of dt.fields || []) {
    f.is_variable = (
      f.key === dt.ref_field_key ||
      f.key === dt.date_field_key ||
      f.type === 'date' ||
      f.type === 'currency'
    ) ? 1 : 0;
    // STRUCTURAL = Company / Date / Reference role: permanent, can't be deleted,
    // disabled, renamed or retyped (the value stays editable). Surfaced so the
    // Settings UI can lock these fields.
    f.is_structural = isStructuralKey(dt, f.key) ? 1 : 0;
  }
  return dt;
}

// A structural role (ref_field_key/date_field_key) can end up pointing at a field
// that no longer exists — e.g. the Reference field was deleted, or a type was created
// with a role key that never matched a real field. That "dangling role" makes Review's
// Confirm gate impossible to satisfy (the required key matches no field). Self-heal by
// CLEARING a dangling role to NULL so the state is honest ("unset") and the Settings UI
// prompts the user to pick the right field. Idempotent; writes only when it changes
// something. Operates on an already-loaded dt (with dt.fields). Not auto-repointed —
// guessing the correct field (e.g. ticket_no vs serial_number) is the user's call.
function repairStructuralRoles(db, dt) {
  if (!dt || !Array.isArray(dt.fields)) return dt;
  const keys = new Set(dt.fields.map(f => f.key));
  for (const role of ['ref_field_key', 'date_field_key']) {
    if (dt[role] && !keys.has(dt[role])) {
      try { db.prepare(`UPDATE document_types SET ${role} = NULL WHERE id = ?`).run(dt.id); } catch { /* read-only ctx */ }
      dt[role] = null;
    }
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
    repairStructuralRoles(db, dt);   // self-heal a dangling ref/date role before annotating
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
    repairStructuralRoles(db, dt);   // self-heal a dangling ref/date role before annotating
    _annotateFieldVariability(dt);   // adds is_structural so the Settings UI can lock roles
  }
  return types;
}

function addType(db, { name, ref_field_key, date_field_key }) {
  // Canonical slug + a live uniqueness suffix: two distinct names that collapse
  // to the same base (e.g. non-Latin "发票"/"账单" -> the fallback) no longer throw
  // a raw "UNIQUE constraint failed: document_types.slug". (Name is separately
  // UNIQUE, so a true duplicate name still errors as before.)
  const slugTaken = db.prepare('SELECT 1 FROM document_types WHERE slug = ?');
  const slug = uniqueSlug(name, (s) => slugTaken.get(s), { fallback: 'type' });
  return db.prepare(`
    INSERT INTO document_types (name, slug, built_in, ref_field_key, date_field_key)
    VALUES (?, ?, 0, ?, ?)
  `).run(name, slug, ref_field_key || null, date_field_key || null);
}

function addField(db, { document_type_id, key, label, type = 'text',
                        required = 0, sort_order = 100 }) {
  // Canonical key (collapse non-alnum runs, trim edges, non-empty fallback) so a
  // malformed key like "ref__"/"_"/"amount_" can't reach filing (buildXml crash).
  const safeKey = safeSlug(key, { fallback: 'field' });
  return db.prepare(`
    INSERT INTO fields (document_type_id, key, label, type, required, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(document_type_id, safeKey, label, type, required, sort_order);
}

// Is this field one of the type's STRUCTURAL roles (Company / Date / Reference)?
function _isStructuralField(db, id) {
  const r = db.prepare(`
    SELECT f.key AS key, dt.ref_field_key AS rk, dt.date_field_key AS dk
    FROM fields f JOIN document_types dt ON dt.id = f.document_type_id
    WHERE f.id = ?
  `).get(id);
  if (!r) return false;
  return COMPANY_KEYS.includes(r.key) || r.key === r.rk || r.key === r.dk;
}

function updateField(db, id, changes) {
  let allowed = ['label', 'type', 'required', 'enabled',
                 'confidence_threshold', 'sort_order'];
  // A structural role is permanent: callers may still tune its threshold / order,
  // but NEVER rename (label), disable (enabled), retype (type) or un-require it.
  if (_isStructuralField(db, id)) {
    allowed = ['confidence_threshold', 'sort_order'];
  }
  const sets = Object.keys(changes)
    .filter(k => allowed.includes(k))
    .map(k => `${k} = @${k}`)
    .join(', ');
  if (!sets) return;
  return db.prepare(`UPDATE fields SET ${sets} WHERE id = @id`)
    .run({ ...changes, id });
}

function deleteField(db, id) {
  // Structural roles can't be deleted even on a CUSTOM type (where built_in may be
  // 0); built-in fields are also protected by the built_in = 0 clause as before.
  if (_isStructuralField(db, id)) return;
  return db.prepare(
    'DELETE FROM fields WHERE id = ? AND built_in = 0'
  ).run(id);
}

function updateType(db, id, changes) {
  const allowed = ['name', 'enabled', 'ref_field_key',
                   'date_field_key', 'sort_order'];
  changes = { ...changes };
  // A structural role must point at a field that EXISTS on this type — never let a
  // caller create a dangling ref/date role (which would make Review's Confirm gate
  // impossible to satisfy). A non-null role key with no matching field is dropped from
  // the update; clearing a role to null/'' is always allowed.
  for (const role of ['ref_field_key', 'date_field_key']) {
    if (role in changes && changes[role]) {
      const exists = db.prepare(
        'SELECT 1 FROM fields WHERE document_type_id = ? AND key = ? LIMIT 1'
      ).get(id, changes[role]);
      if (!exists) delete changes[role];
    }
  }
  const sets = Object.keys(changes)
    .filter(k => allowed.includes(k))
    .map(k => `${k} = @${k}`)
    .join(', ');
  if (!sets) return;
  return db.prepare(`UPDATE document_types SET ${sets} WHERE id = @id`)
    .run({ ...changes, id });
}

// Force the structural ID fields to EXIST + be protected on a doc type. Idempotent;
// call AFTER any user fields are inserted (so a designated date field is respected).
//   Company — the identity AND learning-scope key (logo/hints/anchors/templates).
//   Date    — the Year/Month folder + filename date; absence misfiles into "Unknown".
// Reference is deliberately NOT forced: setting ref_field_key would also gate review
// (the gate keys off the role assignment, not field.required), and gating a reference
// on a type that has none trains operators to enter junk that poisons the filename and
// reference learning. A caller-designated ref_field_key is left untouched (respected +
// protected as usual). Setting date_field_key auto-confers structural protection via
// isStructuralKey. Built-in types already have these, so this only runs for custom types.
function ensureStructuralRoles(db, typeId) {
  const dt = db.prepare('SELECT * FROM document_types WHERE id = ?').get(typeId);
  if (!dt) return;
  const fields = db.prepare('SELECT key FROM fields WHERE document_type_id = ?').all(typeId);
  const keys   = new Set(fields.map(f => f.key));

  if (!fields.some(f => COMPANY_KEYS.includes(f.key))) {
    addField(db, { document_type_id: typeId, key: 'supplier_name', label: 'Document Issuer',
                   type: 'text', required: 1, sort_order: 1 });
  }

  // "Usable" date role = key set AND its field row exists (re-heals a dangling pointer).
  const dateUsable = dt.date_field_key && keys.has(dt.date_field_key);
  if (!dateUsable) {
    if (!keys.has('date')) {   // existence-by-key guard (fields has UNIQUE(type,key))
      addField(db, { document_type_id: typeId, key: 'date', label: 'Date',
                     type: 'date', required: 1, sort_order: 2 });
    }
    updateType(db, typeId, { date_field_key: 'date' });
  }
}

// ── Preset document-type catalog ──────────────────────────────────────────────
//
// A library of READY-MADE document types a business can tick to add (Settings →
// Document Types → "Add from catalog…"). Each preset ships sensible fields, the
// right structural roles, and LIKELY LABEL ALIASES per field. Ticking one creates
// the type + fields (reusing addType/addField/ensureStructuralRoles) and seeds its
// label aliases into field_label_overrides (per-install, doc-type-scoped — see
// label_overrides.js + keyword.merge_label_overrides), so Stage-1 anchored
// label→value extraction works on document #1 with no teaching.
//
// `company_key` is the structural identity/learning-scope field for the type:
// supplier_name for documents you RECEIVE (purchase invoice, statement, receipt),
// customer_name for documents about who PAYS/ORDERS you (sales invoice, remittance).
// The slug is DERIVED from the name (presetSlug, mirroring addType) so labels seed
// under the exact slug the engine resolves at runtime.
//
// Label lists are PRECISION-FIRST and reggie-reviewed. Only DOC-SPECIFIC captions and
// the NOVEL ref/date fields are seeded as overrides; the canonical fields
// (supplier_name/customer_name/invoice_number/invoice_date/delivery_date + the generic
// total) are left to the shipped config/keyword_patterns.json field_patterns — the
// single source of truth, so the override table can't drift from it. Bare generic
// captions ("From"/"Date"/"Amount"/"Customer"/"Balance"/"Account") are deliberately
// DROPPED: the keyword stage applies NO format gate to a field with no shipped pattern
// entry (keyword.merge_label_overrides seeds labels without a validation key), so a
// generic caption could anchor the wrong value. Two engine hardenings would let these
// be relaxed later (a single-word boundary guard in keyword._label_pattern; validation
// inferred by field-key role in merge_label_overrides) — tracked separately.
const PRESET_CATALOG = [
  {
    name: 'Purchase Invoice', ref_field_key: 'invoice_number', date_field_key: 'invoice_date',
    company_key: 'supplier_name',
    fields: [   // all canonical → shipped field_patterns own the labels
      { key: 'supplier_name',  label: 'Document Issuer',  type: 'text',     required: 1 },
      { key: 'invoice_number', label: 'Invoice Number', type: 'text',     required: 1 },
      { key: 'invoice_date',   label: 'Invoice Date',   type: 'date',     required: 1 },
      { key: 'total_amount',   label: 'Total',          type: 'currency', required: 0 },
    ],
  },
  {
    name: 'Sales Invoice', ref_field_key: 'invoice_number', date_field_key: 'invoice_date',
    company_key: 'customer_name',
    fields: [   // all canonical → shipped field_patterns own the labels
      { key: 'customer_name',  label: 'Document Issuer',  type: 'text',     required: 1 },
      { key: 'invoice_number', label: 'Invoice Number', type: 'text',     required: 1 },
      { key: 'invoice_date',   label: 'Invoice Date',   type: 'date',     required: 1 },
      { key: 'total_amount',   label: 'Total',          type: 'currency', required: 0 },
    ],
  },
  {
    name: 'Remittance Advice', ref_field_key: 'remittance_number', date_field_key: 'remittance_date',
    company_key: 'customer_name',
    fields: [
      { key: 'customer_name',     label: 'Document Issuer',     type: 'text',     required: 1,
        // QUALIFIED/directional only — name fields are ungated, so a bare "From"
        // (also the supplier-address / email-header sense) is unsafe; use the payer-specific forms.
        labels: ['Remitter', 'Received From', 'Payment From', 'Payer', 'Paid By'] },
      { key: 'remittance_number', label: 'Remittance Number', type: 'text',     required: 1,
        labels: ['Remittance No', 'Remittance Number', 'Remittance Ref', 'Advice No', 'Payment Ref', 'Payment Reference'] },
      { key: 'remittance_date',   label: 'Remittance Date',   type: 'date',     required: 1,
        labels: ['Remittance Date', 'Payment Date', 'Date Paid'] },
      { key: 'total_amount',      label: 'Amount Paid',       type: 'currency', required: 0,
        labels: ['Amount Paid', 'Total Paid', 'Payment Amount', 'Net Paid'] },
    ],
  },
  {
    name: 'Credit Note', ref_field_key: 'credit_note_number', date_field_key: 'credit_note_date',
    company_key: 'supplier_name',
    fields: [
      { key: 'supplier_name',      label: 'Document Issuer',      type: 'text',     required: 1 },
      { key: 'credit_note_number', label: 'Credit Note Number', type: 'text',     required: 1,
        labels: ['Credit Note No', 'Credit Note Number', 'Credit Note #', 'Credit No', 'CN No', 'Credit Memo No'] },
      { key: 'credit_note_date',   label: 'Credit Note Date',   type: 'date',     required: 1,
        labels: ['Credit Note Date', 'Date of Credit', 'Issue Date'] },
      { key: 'total_amount',       label: 'Total',              type: 'currency', required: 0,
        labels: ['Credit Amount', 'Total Credit', 'Credit Total'] },
    ],
  },
  {
    name: 'Delivery Note', ref_field_key: 'delivery_number', date_field_key: 'delivery_date',
    company_key: 'supplier_name',
    fields: [
      { key: 'supplier_name',   label: 'Document Issuer',   type: 'text', required: 1,
        labels: ['Delivered By', 'Despatched By', 'Dispatched By'] },
      { key: 'customer_name',   label: 'Document Issuer',   type: 'text', required: 0,
        labels: ['Deliver To', 'Delivery To', 'Ship To', 'Consignee'] },
      { key: 'delivery_number', label: 'Delivery Number', type: 'text', required: 1,
        labels: ['Delivery No', 'Delivery Number', 'Delivery Note No', 'DN No', 'Despatch No', 'Dispatch No', 'Docket No', 'Note No'] },
      { key: 'delivery_date',   label: 'Delivery Date',   type: 'date', required: 1 },
    ],
  },
  {
    name: 'Statement', ref_field_key: 'statement_number', date_field_key: 'statement_date',
    company_key: 'supplier_name',
    fields: [
      { key: 'supplier_name',    label: 'Document Issuer',    type: 'text',     required: 1,
        labels: ['Statement From'] },
      { key: 'customer_name',    label: 'Document Issuer',    type: 'text',     required: 0,
        labels: ['Statement To', 'Account Holder'] },
      { key: 'statement_number', label: 'Statement Number', type: 'text',     required: 1,
        labels: ['Statement No', 'Statement Number', 'Statement Ref'] },
      { key: 'statement_date',   label: 'Statement Date',   type: 'date',     required: 1,
        labels: ['Statement Date', 'As At', 'As At Date', 'Statement Period'] },
      { key: 'total_amount',     label: 'Balance Due',      type: 'currency', required: 0,
        // single-anchored: "Closing Balance" vs "Opening Balance" rely on direction; never seed bare "Balance".
        labels: ['Balance Due', 'Total Due', 'Amount Due', 'Total Outstanding', 'Closing Balance'] },
    ],
  },
  {
    name: 'Receipt', ref_field_key: 'receipt_number', date_field_key: 'receipt_date',
    company_key: 'supplier_name',
    fields: [
      { key: 'supplier_name',  label: 'Document Issuer',  type: 'text',     required: 1,
        labels: ['Merchant', 'Sold By'] },
      { key: 'receipt_number', label: 'Receipt Number', type: 'text',     required: 1,
        labels: ['Receipt No', 'Receipt Number', 'Receipt #', 'Transaction No', 'Transaction ID', 'Ref No'] },
      { key: 'receipt_date',   label: 'Receipt Date',   type: 'date',     required: 1,
        labels: ['Receipt Date', 'Transaction Date', 'Date of Purchase'] },
      { key: 'total_amount',   label: 'Total',          type: 'currency', required: 0,
        labels: ['Amount Paid', 'Total Paid'] },
    ],
  },
  {
    name: 'Quote', ref_field_key: 'quote_number', date_field_key: 'quote_date',
    company_key: 'supplier_name',
    fields: [
      { key: 'supplier_name', label: 'Document Issuer', type: 'text',     required: 1,
        labels: ['Quote From'] },
      { key: 'quote_number',  label: 'Quote Number',  type: 'text',     required: 1,
        labels: ['Quote No', 'Quotation No', 'Quote Number', 'Quotation Number', 'Quote Ref', 'Quote #', 'Estimate No', 'Estimate Ref'] },
      { key: 'quote_date',    label: 'Quote Date',    type: 'date',     required: 1,
        // dropped "Valid From" — that's a validity/terms date, not the quote date.
        labels: ['Quote Date', 'Quotation Date', 'Date of Quote'] },
      { key: 'total_amount',  label: 'Total',         type: 'currency', required: 0,
        labels: ['Quote Total', 'Quotation Total', 'Estimated Total', 'Total Estimate'] },
    ],
  },
];

// Slug a preset's display name EXACTLY as addType does, so labels seed under the
// same slug the type is created with (and the engine resolves at runtime).
function presetSlug(name) {
  return safeSlug(name, { fallback: 'type' });
}

// The catalog for the Settings tick-list: each entry + its derived slug + whether
// it is already present in this install (so the UI shows it ticked/disabled).
function getPresetCatalog(db) {
  const present = db.prepare('SELECT slug FROM document_types').all();
  const have = new Set(present.map(r => r.slug));
  return PRESET_CATALOG.map(p => ({
    name: p.name,
    slug: presetSlug(p.name),
    ref_field_key: p.ref_field_key,
    date_field_key: p.date_field_key,
    company_key: p.company_key,
    fields: p.fields.map(f => ({ key: f.key, label: f.label, type: f.type, required: !!f.required })),
    already_present: have.has(presetSlug(p.name)),
  }));
}

// Add the ticked presets. For each requested slug not already present: create the
// type + fields, force structural roles, then seed the field label aliases — all in
// ONE transaction per preset (nested addLabelOverrides runs as a savepoint). Returns
// a per-slug result list; an already-present slug is a no-op ('already_present').
function addPresetTypes(db, slugs) {
  const want = new Set((slugs || []).map(s => String(s || '').trim()).filter(Boolean));
  const results = [];
  for (const preset of PRESET_CATALOG) {
    const slug = presetSlug(preset.name);
    if (!want.has(slug)) continue;
    if (db.prepare('SELECT id FROM document_types WHERE slug = ?').get(slug)) {
      results.push({ slug, status: 'already_present' });
      continue;
    }
    try {
      const out = db.transaction(() => {
        const info = addType(db, {
          name: preset.name,
          ref_field_key: preset.ref_field_key,
          date_field_key: preset.date_field_key,
        });
        const typeId = Number(info.lastInsertRowid);
        let sort = 10;
        for (const f of preset.fields) {
          addField(db, {
            document_type_id: typeId, key: f.key, label: f.label,
            type: f.type || 'text', required: f.required ? 1 : 0, sort_order: sort,
          });
          sort += 10;
        }
        ensureStructuralRoles(db, typeId);   // honours a customer_name company field (Sales Invoice/Remittance)
        const realSlug = db.prepare('SELECT slug FROM document_types WHERE id = ?').get(typeId).slug;
        let labelsSeeded = 0;
        for (const f of preset.fields) {
          if (Array.isArray(f.labels) && f.labels.length) {
            const r = addLabelOverrides(db, { doc_type_slug: realSlug, field_key: f.key, labels: f.labels });
            labelsSeeded += (r && r.inserted) || 0;
          }
        }
        return { typeId, realSlug, labelsSeeded };
      })();
      results.push({ slug: out.realSlug, status: 'added', id: out.typeId, labels_seeded: out.labelsSeeded });
    } catch (e) {
      results.push({ slug, status: 'error', error: String((e && e.message) || e) });
    }
  }
  return results;
}

module.exports = {
  seedBuiltInTypes, getAll, getWithFields, getAllWithFields, getAllWithFieldsAll,
  addType, updateType, addField, updateField, deleteField, ensureStructuralRoles,
  COMPANY_KEYS, isStructuralKey,
  PRESET_CATALOG, presetSlug, getPresetCatalog, addPresetTypes,
};
