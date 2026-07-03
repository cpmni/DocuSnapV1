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

// A field the doc never had an extraction row for must not crash or fabricate one.
learning.saveCorrections(
  db, docId,
  { customer_name: { original_value: 'X', corrected_value: 'Y' } },
  'Acme', 'invoice', { customer_name: 'Y' }, []
);
const none = db.prepare(
  "SELECT COUNT(*) n FROM extractions WHERE document_id=? AND field_key='customer_name'"
).get(docId);
check('no extraction row fabricated for a field that had none', none.n === 0);

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
