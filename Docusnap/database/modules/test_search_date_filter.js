#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_search_date_filter.js
 * -------------------------------------------
 * Regression for documents.search date-range filtering. doc_date is stored
 * DD-MM-YYYY but the Search date inputs supply ISO YYYY-MM-DD; the query now
 * reshapes a clean DD-MM-YYYY doc_date to ISO before comparing. Verifies the
 * range filter works, malformed doc_dates are excluded only when a date filter
 * is active, and the other filters (company/reference/full-text) are unaffected.
 *
 * Usage: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_search_date_filter.js
 */

const Database  = require('better-sqlite3');
const documents = require('./documents');

function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); return cond; }
const ids = (rows) => rows.map(r => r.id).sort((a, b) => a - b);
const eq  = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE document_types (id INTEGER PRIMARY KEY, name TEXT, slug TEXT);
  CREATE TABLE documents (
    id INTEGER PRIMARY KEY, supplier_name TEXT, reference_number TEXT,
    doc_date TEXT, document_type_id INTEGER, status TEXT, ocr_text TEXT,
    confirmed_at TEXT, processed_at TEXT
  );
  CREATE TABLE extractions (document_id INTEGER, field_key TEXT, display_value TEXT, raw_value TEXT);
  CREATE TABLE corrections (document_id INTEGER, field_key TEXT, corrected_value TEXT);
`);
db.prepare(`INSERT INTO document_types (id,name,slug) VALUES (1,'Invoice','invoice')`).run();
const ins = db.prepare(`INSERT INTO documents
  (id,supplier_name,reference_number,doc_date,document_type_id,status,ocr_text)
  VALUES (@id,@s,@r,@d,1,'confirmed',@o)`);
// id, doc_date (stored DD-MM-YYYY) ... + one malformed
ins.run({ id: 1, s: 'Acme',     r: 'INV-1', d: '16-03-2026', o: 'alpha widget' });   // Mar
ins.run({ id: 2, s: 'Acme',     r: 'INV-2', d: '03-06-2026', o: 'beta gadget' });    // Jun
ins.run({ id: 3, s: 'Bravo',    r: 'PO-9',  d: '29-05-2026', o: 'gamma' });          // May
ins.run({ id: 4, s: 'Bravo',    r: 'PO-10', d: '3/6/2026',   o: 'delta' });          // malformed

let fail = 0;

// Range entirely within March -> only doc 1.
fail += !check('dateFrom+dateTo (2026-03-01..2026-03-31) returns only the March doc',
  eq(ids(documents.search(db, { dateFrom: '2026-03-01', dateTo: '2026-03-31' })), [1]));

// dateFrom only (>= 2026-06-01) -> only the June doc (May/March excluded, malformed excluded).
fail += !check('dateFrom only (>=2026-06-01) returns only the June doc',
  eq(ids(documents.search(db, { dateFrom: '2026-06-01' })), [2]));

// dateTo only (<= 2026-05-31) -> March + May.
fail += !check('dateTo only (<=2026-05-31) returns March + May docs',
  eq(ids(documents.search(db, { dateTo: '2026-05-31' })), [1, 3]));

// Inclusive boundaries.
fail += !check('range is inclusive of exact endpoints (29-05-2026 in 2026-05-29..2026-05-29)',
  eq(ids(documents.search(db, { dateFrom: '2026-05-29', dateTo: '2026-05-29' })), [3]));

// Malformed doc_date excluded when a date filter is active...
fail += !check('malformed doc_date ("3/6/2026") excluded under a date filter',
  !ids(documents.search(db, { dateFrom: '2026-01-01', dateTo: '2026-12-31' })).includes(4));

// ...but present when NO date filter is applied (no silent data loss).
fail += !check('no date filter -> all confirmed docs returned (incl. malformed)',
  eq(ids(documents.search(db, {})), [1, 2, 3, 4]));

// Non-regression: other filters still work.
fail += !check('company filter still works', eq(ids(documents.search(db, { company: 'Bravo' })), [3, 4]));
fail += !check('reference filter still works', eq(ids(documents.search(db, { reference: 'INV-1' })), [1]));
fail += !check('full-text filter still works', eq(ids(documents.search(db, { fullText: 'gadget' })), [2]));
fail += !check('company + date combine correctly',
  eq(ids(documents.search(db, { company: 'Acme', dateFrom: '2026-06-01' })), [2]));

db.close();
console.log(fail ? `\n${fail} FAILED` : '\nAll search date-filter checks passed');
process.exit(fail ? 1 : 0);
