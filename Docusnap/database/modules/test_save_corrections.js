#!/usr/bin/env node
'use strict';
// saveCorrections must reflect a confirmed edit back onto the STORED extraction
// (extractions.display_value), so a doc reopened via Learning History "Open in
// Review" / Learning Repair / Search shows the corrected value. getWithExtractions
// reads display_value and does NOT merge the corrections table, so before this fix
// an edit made on an already-confirmed doc looked "lost" on reopen.
// Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_save_corrections.js

const Database = require('better-sqlite3');
const { runMigrations } = require('../index');
const documents = require('./documents');
const doctypes  = require('./document_types');
const learning  = require('./learning');

let fail = 0;
const check = (l, c) => { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}`); if (!c) fail++; };

const db = new Database(':memory:');
runMigrations(db);
doctypes.seedBuiltInTypes(db);
const invId = db.prepare("SELECT id FROM document_types WHERE slug='invoice'").get().id;

// A confirmed doc whose stored extraction still reads the pre-edit OCR value.
const docId = documents.insert(db, {
  original_filename: 'scan.pdf', folder_path: 'C:\\in', document_type_id: invId, status: 'confirmed',
}).lastInsertRowid;
// The learning readers (getFieldValueHistory / getDocumentsForFieldValue) scope on the
// DOCUMENT row's supplier_name + type slug — give the doc its confirmed identity.
db.prepare("UPDATE documents SET supplier_name='Acme', confirmed_at=datetime('now') WHERE id=?").run(docId);
db.prepare(`INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method)
            VALUES (?, 'invoice_number', 'OLD', 'OLD', 90, 'keyword')`).run(docId);

// The user edits invoice_number OLD -> NEW and confirms (Edit-in-place).
learning.saveCorrections(
  db, docId,
  { invoice_number: { original_value: 'OLD', corrected_value: 'NEW' } },
  'Acme', 'invoice',
  { supplier_name: 'Acme', invoice_number: 'NEW' },
  []
);

const ext = db.prepare(
  "SELECT display_value, was_corrected FROM extractions WHERE document_id=? AND field_key='invoice_number'"
).get(docId);
check('extraction display_value now reflects the edit (NEW)', ext.display_value === 'NEW');
check('extraction marked was_corrected', ext.was_corrected === 1);
const corr = db.prepare(
  "SELECT corrected_value FROM corrections WHERE document_id=? AND field_key='invoice_number'"
).get(docId);
check('correction row still written (regression guard)', corr && corr.corrected_value === 'NEW');

// CONFIRM-UPSERT (Oracle-signed 2026-07-10 — deliberately REVERSES the old "must not
// fabricate" pin): a value typed into a field the engine never READ used to live only
// in corrections — invisible to getFieldFormats / getFieldValueHistory /
// getDocumentsForFieldValue (all select FROM extractions), invisible to search, and
// "lost" on reopen ("worksheets are no longer learning values"). It must now become a
// MANUAL extraction row: method 'manual', confidence 100, was_corrected 1,
// corrected_to NULL (the engine's auto-correction signal — must stay clear).
learning.saveCorrections(
  db, docId,
  { customer_name: { original_value: 'X', corrected_value: 'Y' } },
  'Acme', 'invoice', { customer_name: 'Y' }, []
);
const man = db.prepare(
  "SELECT raw_value, display_value, confidence, extraction_method, was_corrected, corrected_to FROM extractions WHERE document_id=? AND field_key='customer_name'"
).get(docId);
check('typed-into-empty field now persists as a MANUAL extraction row', !!man && man.display_value === 'Y');
check("... method 'manual', confidence 100", man && man.extraction_method === 'manual' && man.confidence === 100);
check('... was_corrected set, corrected_to left NULL (engine signal untouched)',
      man && man.was_corrected === 1 && man.corrected_to === null);
check('... raw_value NULL (nothing was read)', man && man.raw_value === null);

// A SECOND confirm of the same field UPDATES the manual row — never a duplicate.
learning.saveCorrections(
  db, docId,
  { customer_name: { original_value: 'Y', corrected_value: 'Z' } },
  'Acme', 'invoice', { customer_name: 'Z' }, []
);
const again = db.prepare(
  "SELECT COUNT(*) n, MAX(display_value) v FROM extractions WHERE document_id=? AND field_key='customer_name'"
).get(docId);
check('second confirm updates in place — still exactly ONE row', again.n === 1 && again.v === 'Z');

// An EMPTY corrected value on a row-less field creates nothing (empty is not a value).
learning.saveCorrections(
  db, docId,
  { total: { original_value: 'X', corrected_value: '' } },
  'Acme', 'invoice', { total: '' }, []
);
const emptyNone = db.prepare(
  "SELECT COUNT(*) n FROM extractions WHERE document_id=? AND field_key='total'"
).get(docId);
check('empty corrected_value on a row-less field creates no row', emptyNone.n === 0);

// The manual row is now VISIBLE to the learning readers (the point of the fix) —
// getFieldValueHistory and getDocumentsForFieldValue share the exact scope + final-value
// expression the Learning-history modal uses ("No learned values yet" was the symptom).
const hist = learning.getFieldValueHistory(db, {
  supplier_name: 'Acme', document_type: 'invoice', field_key: 'customer_name',
});
check('getFieldValueHistory now includes the typed value',
      Array.isArray(hist) && hist.some(h => String(h.value) === 'Z'));
const srcDocs = learning.getDocumentsForFieldValue(db, {
  supplier_name: 'Acme', document_type: 'invoice', field_key: 'customer_name', value: 'Z',
});
check('getDocumentsForFieldValue maps the typed value back to its source doc',
      Array.isArray(srcDocs) && srcDocs.some(d => d.id === docId));

// Clearing a field (corrected_value '') should be reflected, not skipped.
db.prepare(`INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method)
            VALUES (?, 'po_number', 'PO-9', 'PO-9', 80, 'keyword')`).run(docId);
learning.saveCorrections(
  db, docId,
  { po_number: { original_value: 'PO-9', corrected_value: '' } },
  'Acme', 'invoice', { po_number: '' }, []
);
const cleared = db.prepare(
  "SELECT display_value FROM extractions WHERE document_id=? AND field_key='po_number'"
).get(docId);
check('cleared field reflects the empty value on the extraction', cleared.display_value === '');

console.log(fail ? `\n${fail} check(s) FAILED` : '\nAll saveCorrections display_value checks passed.');
process.exit(fail ? 1 : 0);
