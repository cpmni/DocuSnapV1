#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_doctype_presets.js
 * ----------------------------------------
 * Preset document-type catalog (Settings → "Add from catalog…"). Ticking a preset
 * must create the type + fields with the right STRUCTURAL roles — post-migration-44
 * EVERY preset's identity/company role is supplier_name (the sole scope key), and
 * customer_name is an ordinary optional RECIPIENT field where a direction has one
 * (Sales Invoice / Remittance / Delivery Note / Statement) — and seed each field's
 * likely label aliases into field_label_overrides scoped to the type's slug. Adding a
 * preset that already exists is a no-op (idempotent — no duplicate fields/labels).
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_doctype_presets.js
 */

const Database = require('better-sqlite3');
const doctypes = require('./document_types');

function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); return cond; }

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE document_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT UNIQUE, built_in INTEGER DEFAULT 0,
      ref_field_key TEXT, date_field_key TEXT, sort_order INTEGER DEFAULT 100, enabled INTEGER DEFAULT 1
    );
    CREATE TABLE fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT, document_type_id INTEGER, key TEXT, label TEXT,
      type TEXT DEFAULT 'text', required INTEGER DEFAULT 0, built_in INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1, confidence_threshold REAL, sort_order INTEGER DEFAULT 100,
      UNIQUE(document_type_id, key)
    );
    CREATE TABLE field_label_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_type_slug TEXT NOT NULL, field_key TEXT NOT NULL, label TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(doc_type_slug, field_key, label)
    );
  `);
  return db;
}

const typeBySlug = (db, slug) => db.prepare('SELECT * FROM document_types WHERE slug = ?').get(slug);
const fieldsOfSlug = (db, slug) => {
  const t = typeBySlug(db, slug);
  return t ? db.prepare('SELECT * FROM fields WHERE document_type_id = ?').all(t.id) : [];
};
const fkey = (db, slug, key) => fieldsOfSlug(db, slug).find(f => f.key === key);
const labelCount = (db, slug, key) =>
  db.prepare('SELECT COUNT(*) c FROM field_label_overrides WHERE doc_type_slug = ? AND field_key = ?').get(slug, key).c;
const hasLabel = (db, slug, key, label) =>
  !!db.prepare('SELECT 1 FROM field_label_overrides WHERE doc_type_slug=? AND field_key=? AND label=?').get(slug, key, label);

function main() {
  let f = 0;
  const db = makeDb();

  // 0. Catalog shape: every preset has a derived slug, a company_key, and labelled fields.
  const cat = doctypes.getPresetCatalog(db);
  f += !check('catalog non-empty', cat.length >= 8);
  f += !check('every preset has slug + company_key', cat.every(p => p.slug && p.company_key));
  f += !check('Purchase Invoice present, not yet added', cat.some(p => p.slug === 'purchase_invoice' && !p.already_present));

  // 1. Add a representative subset: canonical-only types (no overrides) + doc-specific
  //    types (overrides), both invoice directions, + a customer-company type.
  const res = doctypes.addPresetTypes(db,
    ['purchase_invoice', 'sales_invoice', 'remittance_advice', 'statement', 'delivery_note', 'quote']);
  const bySlug = Object.fromEntries(res.map(r => [r.slug, r]));
  f += !check('6 presets added', res.filter(r => r.status === 'added').length === 6);
  // reggie tightening: canonical-only presets duplicate shipped labels → seed NOTHING.
  f += !check('canonical-only presets seed 0 overrides',
    bySlug['purchase_invoice'].labels_seeded === 0 && bySlug['sales_invoice'].labels_seeded === 0);
  // Doc-specific presets DO seed (their novel ref/date fields + special captions).
  f += !check('doc-specific presets seed overrides',
    bySlug['remittance_advice'].labels_seeded > 0 && bySlug['statement'].labels_seeded > 0 &&
    bySlug['delivery_note'].labels_seeded > 0 && bySlug['quote'].labels_seeded > 0);

  // 2. Types created with correct ref/date roles.
  const pi = typeBySlug(db, 'purchase_invoice');
  f += !check('purchase_invoice created', !!pi);
  f += !check('purchase_invoice ref=invoice_number', pi && pi.ref_field_key === 'invoice_number');
  f += !check('purchase_invoice date=invoice_date', pi && pi.date_field_key === 'invoice_date');
  f += !check('catalog-added type is custom (built_in=0)', pi && pi.built_in === 0);

  // 3. Structural identity is supplier_name on EVERY preset (migration 44 — the sole scope key);
  //    customer_name is an ordinary optional RECIPIENT field where the direction has one.
  f += !check('Purchase Invoice identity = supplier_name', !!fkey(db, 'purchase_invoice', 'supplier_name'));
  f += !check('Sales Invoice identity = supplier_name (migration 44)', !!fkey(db, 'sales_invoice', 'supplier_name'));
  f += !check('Sales Invoice ALSO has customer_name (recipient field)', !!fkey(db, 'sales_invoice', 'customer_name'));
  f += !check('Remittance identity = supplier_name', !!fkey(db, 'remittance_advice', 'supplier_name'));
  f += !check('Remittance ALSO has customer_name (recipient field)', !!fkey(db, 'remittance_advice', 'customer_name'));

  // 4. ensureStructuralRoles did not inject a stray generic "date" field (real date exists).
  f += !check('no stray generic date field on sales_invoice', !fkey(db, 'sales_invoice', 'date'));

  // 5. Field types drive val_type downstream (date/currency must be preserved).
  f += !check('invoice_date typed date', fkey(db, 'purchase_invoice', 'invoice_date').type === 'date');
  f += !check('total_amount typed currency', fkey(db, 'purchase_invoice', 'total_amount').type === 'currency');

  // 6. Labels: canonical fields NOT seeded (shipped owns them); novel fields ARE; scoped.
  f += !check('canonical invoice_number NOT seeded', labelCount(db, 'purchase_invoice', 'invoice_number') === 0);
  f += !check('canonical supplier_name NOT seeded', labelCount(db, 'purchase_invoice', 'supplier_name') === 0);
  f += !check('novel remittance_number seeded', labelCount(db, 'remittance_advice', 'remittance_number') >= 4);
  f += !check('statement balance caption seeded', hasLabel(db, 'statement', 'total_amount', 'Balance Due'));
  f += !check('recall gap added: Dispatch No', hasLabel(db, 'delivery_note', 'delivery_number', 'Dispatch No'));
  f += !check('recall gap added: Estimate Ref', hasLabel(db, 'quote', 'quote_number', 'Estimate Ref'));
  f += !check('aliases slug-scoped (Balance Due not on remittance)', !hasLabel(db, 'remittance_advice', 'total_amount', 'Balance Due'));

  // 6b. reggie precision: bare generics dropped on unprotected (un-gated) fields.
  f += !check('bare "Date" dropped on remittance_date', !hasLabel(db, 'remittance_advice', 'remittance_date', 'Date'));
  f += !check('bare "From" dropped on statement supplier_name', !hasLabel(db, 'statement', 'supplier_name', 'From'));
  f += !check('bare "Total"/"Amount" dropped on remittance total',
    !hasLabel(db, 'remittance_advice', 'total_amount', 'Total') && !hasLabel(db, 'remittance_advice', 'total_amount', 'Amount'));
  f += !check('bare "Account" dropped on statement customer_name', !hasLabel(db, 'statement', 'customer_name', 'Account'));

  // 7. Catalog now reflects already_present.
  const cat2 = doctypes.getPresetCatalog(db);
  f += !check('catalog marks purchase_invoice already_present', cat2.find(p => p.slug === 'purchase_invoice').already_present === true);

  // 8. Idempotency: re-adding a doc-specific preset is a no-op (no dup fields/labels).
  const beforeFields = fieldsOfSlug(db, 'statement').length;
  const beforeLabels = labelCount(db, 'statement', 'total_amount');
  const res2 = doctypes.addPresetTypes(db, ['statement']);
  f += !check('re-add reports already_present', res2[0] && res2[0].status === 'already_present');
  f += !check('no duplicate fields after re-add', fieldsOfSlug(db, 'statement').length === beforeFields);
  f += !check('no duplicate labels after re-add', labelCount(db, 'statement', 'total_amount') === beforeLabels);

  // 9. Unticked presets were not created.
  f += !check('unticked preset (receipt) not created', !typeBySlug(db, 'receipt'));

  console.log(f === 0 ? '\nALL PASS' : `\n${f} FAILURE(S)`);
  process.exit(f === 0 ? 0 : 1);
}

main();
