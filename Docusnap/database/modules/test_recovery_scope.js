#!/usr/bin/env node
'use strict';
// Slice 1 of the "Fix a document type" recovery feature — the data-layer helpers:
//   • relaxed clear*ForScope (supplier optional; at-least-one-key guard; slug-keyed)
//   • requeueConfirmedDocsForScope (scoped de-confirm)
//   • getConfirmedDocsForScope / getLearningFootprintForDocuments (read-only)
//   • the DERIVED-MODEL proof: soft-deleting a confirmed doc drops its value out of
//     getFieldValueHistory (confirmed-only), which is why a learning-only reset "comes back".
// Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_recovery_scope.js

const Database = require('better-sqlite3');
const { runMigrations } = require('../index');
const documents = require('./documents');
const doctypes  = require('./document_types');
const learning  = require('./learning');

let fail = 0;
const check = (l, c, extra) => { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}${extra ? '  ' + extra : ''}`); if (!c) fail++; };

const db = new Database(':memory:');
runMigrations(db);
doctypes.seedBuiltInTypes(db);
const invId = db.prepare("SELECT id FROM document_types WHERE slug='invoice'").get().id;
const soId  = db.prepare("SELECT id FROM document_types WHERE slug='sales_order'").get().id;

// ── Seed a confirmed doc + its extraction/correction; return id ──────────────
let seq = 0;
function seedDoc({ supplier, typeId, field, value }) {
  const r = documents.insert(db, { original_filename: `d${++seq}.pdf`, folder_path: '/in', document_type_id: typeId, supplier_name: supplier, status: 'needs_review' });
  const id = r.lastInsertRowid;
  documents.update(db, id, { status: 'confirmed', confirmed_at: new Date().toISOString(), supplier_name: supplier, document_type_id: typeId });
  db.prepare("INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method) VALUES (?,?,?,?,?,?)")
    .run(id, field, value, value, 90, 'keyword');
  return id;
}
// Learning rows via direct insert (minimal columns), scoped by slug like the real writers.
const insHint = db.prepare("INSERT INTO supplier_hints (supplier_name, document_type, field_key, hint_value, usage_count) VALUES (?,?,?,?,2)");
const insRule = db.prepare("INSERT INTO field_rules (supplier_name, document_type, field_key, rule_type, token_norm) VALUES (?,?,?,?,?)");
const insAnc  = db.prepare("INSERT INTO field_anchors (supplier_name, document_type, field_key, anchor_label, direction, page_zone) VALUES (?,?,?,?,?,?)");
const insCorr = db.prepare("INSERT INTO corrections (document_id, field_key, original_value, corrected_value, supplier_name, document_type) VALUES (?,?,?,?,?,?)");

// Scopes: (Acme, invoice), (Beta, invoice), (Acme, sales_order), plus a __global__ hint.
const dAcmeInv = seedDoc({ supplier: 'Acme', typeId: invId, field: 'total_amount', value: '$111.00' });
const dBetaInv = seedDoc({ supplier: 'Beta', typeId: invId, field: 'total_amount', value: '$222.00' });
const dAcmeSO  = seedDoc({ supplier: 'Acme', typeId: soId,  field: 'total_amount', value: '$333.00' });
insHint.run('Acme', 'invoice', 'total_amount', '$111.00');
insHint.run('Beta', 'invoice', 'total_amount', '$222.00');
insHint.run('Acme', 'sales_order', 'total_amount', '$333.00');
insHint.run('__global__', 'invoice', 'total_amount', '$111.00');   // the global fill-empty copy
insRule.run('Acme', 'invoice', 'supplier_name', 'remove_text', 'ltd');
insRule.run('Beta', 'invoice', 'supplier_name', 'remove_text', 'inc');
insAnc.run('Acme', 'invoice', 'total_amount', 'Total', 'right', 'full');
insAnc.run('Acme', 'sales_order', 'total_amount', 'Total', 'right', 'full');
insCorr.run(dAcmeInv, 'total_amount', '$11l.00', '$111.00', 'Acme', 'invoice');

const nHints = () => db.prepare('SELECT COUNT(*) n FROM supplier_hints').get().n;
const nRules = () => db.prepare('SELECT COUNT(*) n FROM field_rules').get().n;
const nAnc   = () => db.prepare('SELECT COUNT(*) n FROM field_anchors').get().n;

// ── Relaxed clears ──────────────────────────────────────────────────────────
check('guard: both keys null → no-op (never wipes the table)',
  learning.clearSupplierHintsForScope(db, {}).changes === 0 && nHints() === 4);

// supplier+type: only Acme/invoice hint (leaves Beta/invoice, Acme/sales_order, __global__)
learning.clearSupplierHintsForScope(db, { supplier_name: 'Acme', document_type: 'invoice' });
check('supplier+type clear removes only that scope', nHints() === 3 &&
  !db.prepare("SELECT 1 FROM supplier_hints WHERE supplier_name='Acme' AND document_type='invoice'").get());
check('  → leaves Beta/invoice, Acme/sales_order, __global__',
  !!db.prepare("SELECT 1 FROM supplier_hints WHERE supplier_name='Beta'").get() &&
  !!db.prepare("SELECT 1 FROM supplier_hints WHERE supplier_name='Acme' AND document_type='sales_order'").get() &&
  !!db.prepare("SELECT 1 FROM supplier_hints WHERE supplier_name='__global__'").get());

// type-only (supplier null): clears ALL invoice rules across suppliers
learning.clearFieldRulesForScope(db, { document_type: 'invoice' });
check('type-only clear removes all suppliers of that type', nRules() === 0);

// type-only hint clear sweeps the __global__ copy too, leaves the other type
learning.clearSupplierHintsForScope(db, { document_type: 'invoice' });
check('type-only hint clear sweeps __global__ + leaves the other type',
  !db.prepare("SELECT 1 FROM supplier_hints WHERE document_type='invoice'").get() &&
  !!db.prepare("SELECT 1 FROM supplier_hints WHERE document_type='sales_order'").get());

// anchors: supplier+type leaves the other type
learning.clearFieldAnchorsForScope(db, { supplier_name: 'Acme', document_type: 'invoice' });
check('anchor supplier+type clear leaves the supplier\'s other type', nAnc() === 1 &&
  !!db.prepare("SELECT 1 FROM field_anchors WHERE document_type='sales_order'").get());

// ── Derived-model proof: soft-delete drops a value from the confirmed-only history ──
const before = learning.getFieldValueHistory(db, { supplier_name: 'Acme', document_type: 'invoice', field_key: 'total_amount' });
check('value history includes the confirmed value before set-aside', before.some(v => v.value === '$111.00'));
documents.softDelete(db, dAcmeInv);
const after = learning.getFieldValueHistory(db, { supplier_name: 'Acme', document_type: 'invoice', field_key: 'total_amount' });
check('soft-delete removes the value from the derived history (the "it came back" fix)', !after.some(v => v.value === '$111.00'));
check('restore brings the confirmed value back',
  (documents.restoreDeleted(db, dAcmeInv), learning.getFieldValueHistory(db, { supplier_name: 'Acme', document_type: 'invoice', field_key: 'total_amount' }).some(v => v.value === '$111.00')));

// ── requeueConfirmedDocsForScope ────────────────────────────────────────────
check('requeue needs a slug (no-op without one)', documents.requeueConfirmedDocsForScope(db, {}).changes === 0);
const r = documents.requeueConfirmedDocsForScope(db, { document_type_slug: 'invoice' });
check('requeue de-confirms only the invoice docs', r.changes === 2 &&
  documents.getById(db, dAcmeInv).status === 'needs_review' &&
  documents.getById(db, dBetaInv).status === 'needs_review' &&
  documents.getById(db, dAcmeSO).status === 'confirmed', `(changed ${r.changes})`);
check('requeue nulls confirmed_at', documents.getById(db, dAcmeInv).confirmed_at == null);

// ── getConfirmedDocsForScope + footprint ────────────────────────────────────
check('getConfirmedDocsForScope lists only the scope\'s confirmed docs',
  documents.getConfirmedDocsForScope(db, { document_type_slug: 'sales_order' }).length === 1);
const fp = learning.getLearningFootprintForDocuments(db, [dAcmeSO]);
check('footprint enumerates a doc\'s contributed values', fp.values.some(v => v.value === '$333.00' && v.document_type === 'sales_order'));

db.close();
console.log(`\n${fail ? fail + ' FAILED' : 'All recovery-scope data-layer checks passed.'}`);
process.exit(fail ? 1 : 0);
