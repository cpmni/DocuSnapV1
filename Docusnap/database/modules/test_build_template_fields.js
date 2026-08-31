#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_build_template_fields.js
 * ----------------------------------------------
 * Guards the _buildTemplateFields template-field guard (gary-designed, Oracle SIGN-OFF-WITH-CONDITIONS):
 *   (A) OWN-TYPE FILTER — a foreign-type key (cross-type leak via a shared-logo wrong-type confirm)
 *       is dropped; keep-all fallback when the type has no field metadata.
 *   (B) NEVER FREEZE a non-issuer NAME-LIKE field — a recipient/customer name is per-document and
 *       must never be frozen into a template_fixed stamp; only the ISSUER (supplier_name) freezes.
 * Plus the faithful isNameLikeField port (value_quality.py parity incl. the technical-address exclusion).
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_build_template_fields.js
 */

const Database = require('better-sqlite3');
const learning = require('./learning');
const { _buildTemplateFields } = require('../../src/modules/review/handler');

let fails = 0;
function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; return cond; }
function section(t) { console.log(`\n${t}`); }

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE document_types (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT, ref_field_key TEXT, date_field_key TEXT);
    CREATE TABLE fields (id INTEGER PRIMARY KEY AUTOINCREMENT, document_type_id INTEGER, key TEXT, label TEXT, type TEXT, required INTEGER DEFAULT 0);
    CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, document_type_id INTEGER, status TEXT);
    CREATE TABLE extractions (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT, display_value TEXT);
    CREATE TABLE corrections (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT, corrected_value TEXT);
  `);
  return db;
}

// A doc-type descriptor with per-field schema variability we control (mirrors getWithFields output).
const dtInfo = {
  id: 1, ref_field_key: 'invoice_number', date_field_key: 'invoice_date',
  fields: [
    { key: 'supplier_name',        label: 'Document Issuer', is_variable: 0 },   // issuer — freezes
    { key: 'customer_name',        label: 'Customer',        is_variable: 0 },   // recipient — never freezes
    { key: 'custom_customer_name', label: 'Customer Name',   is_variable: 0 },   // custom recipient — never freezes
    { key: 'field_7',              label: 'Customer Name',   is_variable: 0 },   // opaque key, name-like LABEL — never freezes
    { key: 'payment_terms',        label: 'Payment Terms',   is_variable: 0 },   // constant NON-name — still freezes
    { key: 'mac_address',          label: 'MAC Address',     is_variable: 0 },   // technical addr, NOT name — still freezes
    { key: 'site',                 label: 'Site',            is_variable: 0 },   // constant NON-name — freezes unless multi-valued
    { key: 'invoice_number',       label: 'Invoice Number',  is_variable: 1 },   // ref — variable by schema
  ],
};
const byKey = (rows) => Object.fromEntries(rows.map(r => [r.field_key, r]));

function main() {
  section('0. isNameLikeField — value_quality.py parity (Oracle C3)');
  check('customer_name → name-like',        learning.isNameLikeField('customer_name') === true);
  check('supplier_name → name-like',        learning.isNameLikeField('supplier_name') === true);
  check('custom_customer_name → name-like', learning.isNameLikeField('custom_customer_name') === true);
  check('opaque key + "Customer Name" LABEL → name-like (label-aware)', learning.isNameLikeField('field_7', 'Customer Name') === true);
  check('"cust" whole-word → name-like',    learning.isNameLikeField('cust') === true);
  check('bill_to → name-like',              learning.isNameLikeField('bill_to') === true);
  check('mac_address → NOT name-like (technical address excluded)', learning.isNameLikeField('mac_address') === false);
  check('ip_address → NOT name-like',       learning.isNameLikeField('ip_address') === false);
  check('postal address → name-like',       learning.isNameLikeField('delivery_address') === true);
  check('custom_ref (contains "cust" as substring, not whole word) → NOT name-like',
        learning.isNameLikeField('custom_ref') === false);
  check('payment_terms → NOT name-like',    learning.isNameLikeField('payment_terms') === false);

  const db = makeDb();
  const allValues = {
    supplier_name: 'Cascade Water Systems', customer_name: 'Primrose Childcare',
    custom_customer_name: 'Ashcombe Care Homes Ltd', field_7: 'Bluefin Marine Ltd',
    payment_terms: 'Net 30', mac_address: 'D4:F0:C9:25:9B:64', site: 'Reservoir Works',
    invoice_number: 'INV-1001',
    leaked_worksheet_field: 'some worksheet value',   // FOREIGN — not in dtInfo.fields
  };

  section('1. (A) own-type filter + (B) never-freeze-recipient');
  const rows = _buildTemplateFields(db, allValues, dtInfo);
  const m = byKey(rows);
  check('(A) foreign key "leaked_worksheet_field" is DROPPED', !m.leaked_worksheet_field);
  check('(B) customer_name is VARIABLE (not frozen) despite schema-constant + uniform history',
        m.customer_name && m.customer_name.is_variable === true && m.customer_name.fixed_value === null);
  check('(B) custom_customer_name is VARIABLE', m.custom_customer_name && m.custom_customer_name.is_variable === true);
  check('(B) opaque key field_7 (labelled "Customer Name") is VARIABLE (label-aware)',
        m.field_7 && m.field_7.is_variable === true && m.field_7.fixed_value === null);
  check('ISSUER supplier_name is STILL FROZEN', m.supplier_name && m.supplier_name.is_variable === false && m.supplier_name.fixed_value === 'Cascade Water Systems');
  check('legit constant NON-name payment_terms is STILL FROZEN', m.payment_terms && m.payment_terms.is_variable === false && m.payment_terms.fixed_value === 'Net 30');
  check('technical mac_address is STILL FROZEN (not treated as a name)', m.mac_address && m.mac_address.is_variable === false);
  check('schema-variable invoice_number stays variable', m.invoice_number && m.invoice_number.is_variable === true);

  section('2. multi-valued confirmed history still forces variable (regression pin)');
  // Seed 2 confirmed docs giving `site` two distinct values → _fieldsWithMultipleConfirmedValues flags it.
  const d1 = db.prepare("INSERT INTO documents (document_type_id, status) VALUES (1,'confirmed')").run().lastInsertRowid;
  const d2 = db.prepare("INSERT INTO documents (document_type_id, status) VALUES (1,'confirmed')").run().lastInsertRowid;
  db.prepare("INSERT INTO extractions (document_id, field_key, display_value) VALUES (?,?,?)").run(d1, 'site', 'Reservoir Works');
  db.prepare("INSERT INTO extractions (document_id, field_key, display_value) VALUES (?,?,?)").run(d2, 'site', 'Springfield Depot');
  const rows2 = byKey(_buildTemplateFields(db, allValues, dtInfo));
  check('`site` frozen when uniform, but VARIABLE once history shows 2 distinct values',
        rows2.site && rows2.site.is_variable === true);

  section('3. (A) keep-all fallback when the type has no field metadata');
  const rowsNoMeta = byKey(_buildTemplateFields(db, { supplier_name: 'X Co', anything: 'y' }, { id: 9, fields: [] }));
  check('no-meta → all keys retained', rowsNoMeta.supplier_name && rowsNoMeta.anything);
  check('no-meta → nothing frozen (all variable — mirrors graduationTemplate)',
        rowsNoMeta.supplier_name.is_variable === true && rowsNoMeta.anything.is_variable === true);

  section('4. PINNED TRADE-OFF (must not be "fixed" back for recall)');
  // A name-like non-issuer field with PERFECTLY uniform confirmed history is STILL variable.
  const d3 = db.prepare("INSERT INTO documents (document_type_id, status) VALUES (1,'confirmed')").run().lastInsertRowid;
  db.prepare("INSERT INTO extractions (document_id, field_key, display_value) VALUES (?,?,?)").run(d3, 'customer_name', 'Primrose Childcare');
  const rows3 = byKey(_buildTemplateFields(db, allValues, dtInfo));
  check('customer_name STILL variable even with uniform confirmed history (accepted fail-toward-review trade-off)',
        rows3.customer_name && rows3.customer_name.is_variable === true);

  section('5. (E) a LIST-typed field NEVER freezes (2026-08-11 — the serials-defect pin)');
  // The live DB carried template_fixed 'Serial No:' ×24 because a TEXT-typed code field froze from
  // one taught document. A field typed 'list' is per-document by construction — unconditional, no
  // kill switch; a future dev restoring the freeze "for recall" turns this red.
  const dtList = { id: 1, ref_field_key: 'invoice_number', date_field_key: 'invoice_date',
    fields: [{ key: 'serials', label: 'Serials', type: 'list', is_variable: 0 },
             { key: 'payment_terms', label: 'Payment Terms', type: 'text', is_variable: 0 }] };
  const rowsL = byKey(_buildTemplateFields(db, { serials: 'NW-1; NW-2', payment_terms: '30 days' }, dtList));
  check('list-typed field is variable (never frozen), whatever its schema flag says',
        rowsL.serials && rowsL.serials.is_variable === true && rowsL.serials.fixed_value === null);
  check('CONTROL: a constant text sibling still freezes (the exclusion is type-scoped)',
        rowsL.payment_terms && rowsL.payment_terms.is_variable === false
        && rowsL.payment_terms.fixed_value === '30 days');

  section('6. THE IDENTITY UNFREEZE CLASS (2026-08-22 night; Oracle C9.1/C9.2/C9.5) — company keys judged per TEMPLATE by dominance');
  // The type-wide distinct count unfroze every second sender of a type (and a sender with ONE confirmed
  // garble row). Now: supplier_name is multi-valued only when THIS template's own confirmed documents
  // hold no strict-majority issuer. The fixture needs documents.template_id + supplier_name.
  const db6 = makeDb();
  db6.exec("ALTER TABLE documents ADD COLUMN template_id INTEGER; ALTER TABLE documents ADD COLUMN supplier_name TEXT");
  const addDoc = (tpl, sup, vat) => {
    const id = db6.prepare("INSERT INTO documents (document_type_id, status, template_id, supplier_name) VALUES (1,'confirmed',?,?)").run(tpl, sup).lastInsertRowid;
    db6.prepare("INSERT INTO extractions (document_id, field_key, display_value) VALUES (?,?,?)").run(id, 'supplier_name', sup);
    if (vat) db6.prepare("INSERT INTO extractions (document_id, field_key, display_value) VALUES (?,?,?)").run(id, 'payment_terms', vat);
    return id;
  };
  // two senders of ONE type, each on its own template
  for (let i = 0; i < 3; i++) addDoc(1, 'Veltrix Automotive Parts', '30 days');
  for (let i = 0; i < 3; i++) addDoc(2, 'Silverbeck Cleaning Supplies', '14 days');
  const vel = byKey(_buildTemplateFields(db6, { supplier_name: 'Veltrix Automotive Parts', payment_terms: '30 days' }, dtInfo, { templateId: 1 }));
  const sil = byKey(_buildTemplateFields(db6, { supplier_name: 'Silverbeck Cleaning Supplies', payment_terms: '14 days' }, dtInfo, { templateId: 2 }));
  check('two senders of one type on two templates → BOTH identities stay frozen (the type-wide count no longer unfreezes the second sender)',
        vel.supplier_name.is_variable === false && vel.supplier_name.fixed_value === 'Veltrix Automotive Parts'
        && sil.supplier_name.is_variable === false && sil.supplier_name.fixed_value === 'Silverbeck Cleaning Supplies');
  check('POSITIVE CONTROL: a non-company key (payment_terms) is STILL judged type-wide → two suppliers\' terms differ → variable (the freeze_guard class)',
        vel.payment_terms.is_variable === true && sil.payment_terms.is_variable === true);
  // a garble row on the sender's OWN template: A×3 + 'rdwind…'×1 → dominant 3/4 → stays frozen
  addDoc(1, 'eltrix Automotive Parts');
  const velG = byKey(_buildTemplateFields(db6, { supplier_name: 'Veltrix Automotive Parts' }, dtInfo, { templateId: 1 }));
  check('A×3 + one confirmed garble row on the same template → still frozen (dominance, not distinct-count)', velG.supplier_name.is_variable === false);
  // a buyer-issued layout: A/B/C ×1 → no majority → variable
  addDoc(3, 'Quillstone Print'); addDoc(3, 'Bramblewood Joinery Ltd'); addDoc(3, 'Oakhaven Electrical');
  const buyer = byKey(_buildTemplateFields(db6, { supplier_name: 'Quillstone Print' }, dtInfo, { templateId: 3 }));
  check('a buyer-issued layout (three issuers ×1) → variable (no majority)', buyer.supplier_name.is_variable === true && buyer.supplier_name.fixed_value === null);
  // A×1 / B×1 → fail toward variable (pinned trade-off)
  addDoc(4, 'Acme Ltd'); addDoc(4, 'Bolt Ltd');
  const tie = byKey(_buildTemplateFields(db6, { supplier_name: 'Acme Ltd' }, dtInfo, { templateId: 4 }));
  check('PINNED TRADE-OFF: A×1 / B×1 on one template → variable (fail toward variable)', tie.supplier_name.is_variable === true);
  // CREATE (no template yet) → freeze at birth as today, even with many senders of the type
  const born = byKey(_buildTemplateFields(db6, { supplier_name: 'Harrowgate Timber Supplies' }, dtInfo, { templateId: null }));
  check('CREATE (templateId null) → the identity freezes at birth regardless of the type\'s other senders', born.supplier_name.is_variable === false);
  // the document being confirmed is excluded from its own dominance (self-exclusion via documentId)
  const selfId = addDoc(5, 'elican Office');                       // the doc being (re)confirmed carries the garble row
  addDoc(5, 'Pelican Office Interiors'); addDoc(5, 'Pelican Office Interiors'); addDoc(5, 'elican Office');
  const self = byKey(_buildTemplateFields(db6, { supplier_name: 'Pelican Office Interiors' }, dtInfo, { templateId: 5, documentId: selfId }));
  check('the confirming document is excluded from its own template\'s dominance (without it 2 vs 1 → a majority → frozen)', self.supplier_name.is_variable === false);
  const selfIn = byKey(_buildTemplateFields(db6, { supplier_name: 'Pelican Office Interiors' }, dtInfo, { templateId: 5 }));
  check('…positive control: counted in, 2 vs 2 is no majority → variable', selfIn.supplier_name.is_variable === true);
  // source pin: _upsertTemplate builds fields lazily after the template resolves, at both consumers
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'src', 'modules', 'review', 'handler.js'), 'utf8');
  check('source: _upsertTemplate builds fields AFTER template resolution (buildFields(templateId) on UPDATE, buildFields(null) on CREATE)',
        /const buildFields = \(tid\) => _buildTemplateFields\(db, allValues, dtInfo, \{ templateId: tid \|\| null, documentId: document_id \}\);/.test(src)
        && /const fields = buildFields\(templateId\);\s*\n\s*templates\.update\(db, templateId/.test(src.replace(/\r\n/g, '\n'))
        && /const fields = buildFields\(null\);\s*\n\s*const newTemplateId = templates\.create/.test(src.replace(/\r\n/g, '\n')));
  const tsrc = require('fs').readFileSync(require('path').join(__dirname, 'templates.js'), 'utf8');
  check('source: the writer guard is LOUD on a NULL landing over a frozen identity (template_identity_unfrozen audit)',
        /\[identity-guard\] UNFROZE template/.test(tsrc) && /action: 'template_identity_unfrozen'/.test(tsrc));

  console.log('\n' + (fails === 0 ? 'ALL PASS' : `${fails} FAILED`));
  process.exit(fails ? 1 : 0);
}

main();
