'use strict';
// Seed the TEACH-TEST sandbox with the document types the corpus actually contains, with FIELDS
// derived from ground_truth.json (owner run, 2026-08-08).
//
// WHY. A fresh DB self-seeds only Invoice / Sales Order / Purchase Order (database/index.js:26).
// The test corpus spans 8 types. Without this, the operator hand-creates the missing five DURING
// the teaching run, inventing field keys as they go — and the scorer then cannot align a taught
// field to its ground-truth column, which costs the whole evening. Creating the type schema up
// front also isolates what the run is measuring: the TEACH side, not the type-creation wizard.
//
// Fields per type are taken from what the ground truth actually populates for that type (a type
// whose docs never carry an account number does not get an account_no field), so nothing is taught
// that cannot be scored, and nothing scoreable is missing from the form.
//
// Run:
//   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe scripts/seed-teach-doctypes.js [sandbox-root]
const path = require('path');
const fs = require('fs');

const REPO = 'c:/GIT Projects/Docusnap';
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const dbmod = require(path.join(REPO, 'database', 'index.js'));
const doctypes = require(path.join(REPO, 'database', 'modules', 'document_types.js'));

const HOME = process.env.USERPROFILE || process.env.HOME;
// Accepts EITHER a sandbox root (…/userData/docusnap.db beneath it) or a direct path to a .db —
// the live install keeps its DB at %APPDATA%\ScanFinder\docusnap.db, which is not a sandbox shape.
const ARG = process.argv[2] || path.join(HOME, 'Desktop', 'TESTING', '_sandbox');
const DB = ARG.toLowerCase().endsWith('.db') ? ARG : path.join(ARG, 'userData', 'docusnap.db');
const CORPUS = path.join(HOME, 'Desktop', 'Customer Doc Test');
const MANIFEST = path.join(HOME, 'Desktop', 'TESTING', 'run_manifest.json');

if (!fs.existsSync(DB)) { console.error(`no sandbox DB at ${DB}`); process.exit(1); }

// Per-type reference/date field keys. Canonical names on purpose: keyword_patterns.json ships
// field_patterns for these, so Stage 1 has its normal support and the run measures the real system
// rather than a corpus-shaped one.
const ROLE = {
  invoice:           ['invoice_number', 'invoice_date', 'Invoice'],
  credit_note:       ['credit_note_number', 'credit_note_date', 'Credit Note'],
  delivery_note:     ['delivery_number', 'delivery_date', 'Delivery Note'],
  purchase_order:    ['po_number', 'po_date', 'Purchase Order'],
  sales_order:       ['sales_order_number', 'order_date', 'Sales Order'],
  quote:             ['quote_number', 'quote_date', 'Quote'],
  statement:         ['statement_number', 'statement_date', 'Statement'],
  service_worksheet: ['worksheet_number', 'worksheet_date', 'Service Worksheet'],
};
// ground-truth column -> (field key, label, type)
const EXTRA = {
  total:      ['total', 'Total', 'currency'],
  customer:   ['customer_name', 'Customer', 'text'],
  vat_no:     ['vat_no', 'VAT Number', 'text'],
  account_no: ['account_no', 'Account Number', 'text'],
  po_ref:     ['po_ref', 'Your PO', 'text'],
  serials:    ['serials', 'Serial Numbers', 'text'],
};

const gt = JSON.parse(fs.readFileSync(path.join(CORPUS, 'ground_truth.json'), 'utf8'));
const wanted = new Set(JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).scopes.map(s => s.type));

// which optional columns does each type actually carry?
const present = {};
for (const r of gt) {
  if (!wanted.has(r.type_slug)) continue;
  const p = (present[r.type_slug] || (present[r.type_slug] = new Set()));
  for (const c of Object.keys(EXTRA)) if (r[c] != null && r[c] !== '') p.add(c);
}

const db = new Database(DB);
dbmod.runMigrations(db);
doctypes.seedBuiltInTypes(db);          // the three built-ins, exactly as first launch would

const existing = new Map(db.prepare('SELECT id, slug, name FROM document_types').all().map(r => [r.slug, r]));
for (const slug of [...wanted].sort()) {
  const spec = ROLE[slug];
  if (!spec) { console.log(`  ?? no role mapping for '${slug}' — skipped`); continue; }
  const [refKey, dateKey, name] = spec;
  let row = existing.get(slug);
  if (!row) {
    const info = doctypes.addType(db, { name, ref_field_key: refKey, date_field_key: dateKey });
    row = db.prepare('SELECT id, slug, name FROM document_types WHERE id = ?').get(info.lastInsertRowid);
  } else {
    db.prepare('UPDATE document_types SET ref_field_key = ?, date_field_key = ? WHERE id = ?')
      .run(refKey, dateKey, row.id);
  }
  const have = new Set(db.prepare('SELECT key FROM fields WHERE document_type_id = ?').all(row.id).map(f => f.key));
  const add = (key, label, type, order) => {
    if (have.has(key)) return;
    doctypes.addField(db, { document_type_id: row.id, key, label, type, sort_order: order });
    have.add(key);
  };
  add(refKey, name + ' Number', 'reference_code', 10);
  add(dateKey, 'Date', 'date', 20);
  let o = 30;
  for (const col of Object.keys(EXTRA)) {
    if (!(present[slug] || new Set()).has(col)) continue;
    const [k, l, t] = EXTRA[col];
    add(k, l, t, o += 10);
  }
  doctypes.ensureStructuralRoles(db, row.id);   // guarantees the Document Issuer + role integrity
  const fields = db.prepare('SELECT key FROM fields WHERE document_type_id = ? ORDER BY sort_order').all(row.id);
  console.log(`  ${name.padEnd(20)} ${slug.padEnd(18)} ref=${refKey.padEnd(20)} fields: ${fields.map(f => f.key).join(', ')}`);
}
console.log(`\n${db.prepare('SELECT COUNT(*) c FROM document_types').get().c} document types in the sandbox.`);
db.close();
