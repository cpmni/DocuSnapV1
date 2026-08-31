'use strict';
/*
 * test_company_key_own_scope.js — Chris round 19 N2 (Oracle WRONG LAYER → trust._scopeFormats, 2026-08-23).
 *
 * THE INCIDENT: Ironbridge filed 18 invoices by itself on ZERO hand confirms. The doc-TYPE-scoped
 * supplier_name group held exactly two distinct names (Copperfield ×7 + Ironbridge's own wizard confirm)
 * → `constant` → set membership → every sibling "matched". A company key is an IDENTITY: with the switch
 * on it verifies only against its supplier-scoped group; the type-wide fallback stays for other fields.
 * DARK: trust_company_key_own_scope / TRUST_COMPANY_KEY_OWN_SCOPE.
 *
 * Pins (fail on the pre-fix code): the Ironbridge shape (type-wide constant {A, B}, no supplier-scoped
 * group for B) → OFF eligible (the hole), ON 'unverifiable-value:supplier_name'; positive control: a
 * supplier-scoped solid group → ON passes; the type-wide fallback still serves NON-company fields;
 * the badge (scopeReadiness.isReady) and the gate now agree on the Ironbridge shape.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_company_key_own_scope.js
 */
const Database = require('better-sqlite3');
const { runMigrations } = require('../index');
const documents = require('./documents');
const trust = require('./trust');
const learning = require('./learning');
const scopeReadiness = require('./scopeReadiness');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

const db = new Database(':memory:');
runMigrations(db);
db.prepare("INSERT INTO document_types (id, name, slug, built_in, ref_field_key, date_field_key) VALUES (1, 'Invoice', 'invoice', 1, 'invoice_number', 'invoice_date')").run();
for (const [k, req] of [['supplier_name', 1], ['invoice_number', 1], ['invoice_date', 1]])
  db.prepare("INSERT INTO fields (document_type_id, key, label, type, required, enabled, built_in) VALUES (1, ?, ?, 'text', ?, 1, 1)").run(k, k, req);
learning.setSetting(db, 'auto_file_threshold', '90');
learning.setSetting(db, 'learning_exclude_machine_confirms', 'true');
db.prepare("INSERT INTO templates (id, name, slug, document_type_slug) VALUES (7, 'Ironbridge Invoice', 'ironbridge-invoice', 'invoice')").run();
db.prepare("INSERT INTO template_fields (template_id, field_key, fixed_value) VALUES (7, 'supplier_name', 'Ironbridge Fabrication')").run();
const confirmed = (sup, i) => {
  const id = Number(documents.insert(db, { original_filename: `${sup}-${i}.pdf`, folder_path: '/in', status: 'confirmed', supplier_name: sup, document_type_id: 1 }).lastInsertRowid);
  for (const [k, v] of [['supplier_name', sup], ['invoice_number', `INV-${10000 + i}`], ['invoice_date', `${String(1 + (i % 28)).padStart(2, '0')}-03-2026`]])
    db.prepare("INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method) VALUES (?, ?, ?, ?, 95, 'keyword')").run(id, k, v, v);
  return id;
};
// the r19 shape at 02:23:58: Copperfield ×7 human confirms + Ironbridge's ONE wizard confirm
for (let i = 0; i < 7; i++) confirmed('Copperfield Electrical', i);
confirmed('Ironbridge Fabrication', 99);
const held = (sup) => {
  const id = Number(documents.insert(db, { original_filename: `${sup}-held.pdf`, folder_path: '/in', status: 'needs_review', supplier_name: sup, document_type_id: 1, template_id: 7 }).lastInsertRowid);
  db.prepare('UPDATE documents SET overall_confidence = 97 WHERE id = ?').run(id);
  for (const [k, v] of [['supplier_name', sup], ['invoice_number', 'INV-79039'], ['invoice_date', '19-10-2026']])
    db.prepare("INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method) VALUES (?, ?, ?, ?, 97, 'template_mapping')").run(id, k, v, v);
  return id;
};
const row = (id) => db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
const ib = held('Ironbridge Fabrication');

console.log('the Ironbridge shape:');
const ready = scopeReadiness.isReady(db, 'Ironbridge Fabrication', 'invoice');
check('the badge says NOT ready (no supplier-scoped solid formats)', ready.ready === false);
process.env.TRUST_COMPANY_KEY_OWN_SCOPE = '0';
const vOff = trust.isAutoFileEligible(db, row(ib));
check('OFF: the predicate files it anyway (the r19 hole — one confirm self-licensed 18)', vOff.eligible === true);
process.env.TRUST_COMPANY_KEY_OWN_SCOPE = '1';
const vOn = trust.isAutoFileEligible(db, row(ib));
check("ON: refused 'unverifiable-value:supplier_name' — the gate now agrees with the badge", vOn.eligible === false && vOn.reason === 'unverifiable-value:supplier_name');
check('ON: the type-wide fallback still serves NON-company fields (invoice_number / invoice_date resolve)', (() => { const f = trust._scopeFormats(db, 'ironbridge fabrication', 'invoice'); return f.has('invoice_number') && f.has('invoice_date') && !f.has('supplier_name'); })());

console.log('\npositive control — three of its own confirms:');
for (let i = 0; i < 2; i++) confirmed('Ironbridge Fabrication', 200 + i);
const vOn3 = trust.isAutoFileEligible(db, row(ib));
const ready3 = scopeReadiness.isReady(db, 'Ironbridge Fabrication', 'invoice');
check('after 3 Ironbridge confirms the badge says ready AND the gate passes the identity (Larkspur\'s road)', ready3.ready === true && vOn3.reason !== 'unverifiable-value:supplier_name');
process.env.TRUST_COMPANY_KEY_OWN_SCOPE = '0';
check('env 0 → off', trust._companyKeyOwnScopeEnabled(db) === false);
delete process.env.TRUST_COMPANY_KEY_OWN_SCOPE;
check('default (no setting) → OFF (DARK)', trust._companyKeyOwnScopeEnabled(db) === false);

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
