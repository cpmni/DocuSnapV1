#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_digits_only_fields.js
 * -------------------------------------------
 * Focused test for learning.getDigitsOnlyFields — the Review-side data that
 * drives the "this field usually contains only digits" confirm warning (Part 2).
 * A field qualifies only with >=3 distinct confirmed values whose 3 newest are
 * pure digits, scoped to (supplier_name, document_type slug).
 *
 * Usage (from project root):
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_digits_only_fields.js
 */

const Database = require('better-sqlite3');
const learning = require('./learning');

function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); return cond; }

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE document_types (id INTEGER PRIMARY KEY, slug TEXT);
  CREATE TABLE documents (
    id INTEGER PRIMARY KEY, supplier_name TEXT, document_type_id INTEGER,
    status TEXT, confirmed_at TEXT
  );
  CREATE TABLE extractions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER,
    field_key TEXT, display_value TEXT
  );
  CREATE TABLE corrections (
    id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER,
    field_key TEXT, corrected_value TEXT
  );
`);
db.prepare(`INSERT INTO document_types (id, slug) VALUES (1, 'invoice')`).run();
const doc = db.prepare(`INSERT INTO documents (id, supplier_name, document_type_id, status, confirmed_at) VALUES (?,?,?,?,?)`);
const ext = db.prepare(`INSERT INTO extractions (document_id, field_key, display_value) VALUES (?,?,?)`);

// 3 confirmed docs for Acme/invoice: invoice_number is digits, po_ref is not.
const data = [
  [1, '1001', 'PO-1'],
  [2, '1002', 'PO-2'],
  [3, '1003', 'PO-3'],
];
let when = 1;
for (const [id, inv, po] of data) {
  doc.run(id, 'Acme', 1, 'confirmed', `2026-06-0${when++} 10:00:00`);
  ext.run(id, 'invoice_number', inv);
  ext.run(id, 'po_ref', po);
}

let fail = 0;
const fields = learning.getDigitsOnlyFields(db, 'Acme', 'invoice');
console.log('digits-only fields:', JSON.stringify(fields));
fail += !check('invoice_number (3 distinct digit values) is detected as digits-only', fields.includes('invoice_number'));
fail += !check('po_ref (PO-1/2/3, non-digit) is NOT digits-only', !fields.includes('po_ref'));
fail += !check('unknown supplier yields no digits-only fields', learning.getDigitsOnlyFields(db, 'Nobody', 'invoice').length === 0);
fail += !check('wrong document type yields no digits-only fields', learning.getDigitsOnlyFields(db, 'Acme', 'purchase_order').length === 0);
fail += !check('empty supplier is a safe no-op', learning.getDigitsOnlyFields(db, '', 'invoice').length === 0);

db.close();
console.log(fail ? `\n${fail} FAILED` : '\nAll digits-only-field checks passed');
process.exit(fail ? 1 : 0);
