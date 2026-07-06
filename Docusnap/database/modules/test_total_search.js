#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_total_search.js
 * -------------------------------------
 * Guards documents.search's TOTAL filter (Equals / Above / Below). The total lives in
 * extractions as a display string ("£1,046.16"); the filter parses it numerically in SQL,
 * matches the common total field keys, and compares with the chosen operator.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_total_search.js
 */

const Database  = require('better-sqlite3');
const documents = require('./documents');

let fails = 0;
function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; }

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE document_types (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT);
    CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT, supplier_name TEXT,
      reference_number TEXT, doc_date TEXT, ocr_text TEXT, confirmed_at TEXT, processed_at TEXT, document_type_id INTEGER);
    CREATE TABLE extractions (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT, display_value TEXT, raw_value TEXT);
    CREATE TABLE corrections (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT, corrected_value TEXT);
  `);
  const tid = db.prepare("INSERT INTO document_types (name,slug) VALUES ('Invoice','invoice')").run().lastInsertRowid;
  const doc = (total, key = 'total_amount') => {
    const id = db.prepare("INSERT INTO documents (status, supplier_name, confirmed_at, document_type_id) VALUES ('confirmed','ACME',datetime('now'),?)").run(tid).lastInsertRowid;
    db.prepare("INSERT INTO extractions (document_id, field_key, display_value) VALUES (?,?,?)").run(id, key, total);
    return id;
  };
  return { db, d1: doc('£100.00'), d2: doc('£250.50'), d3: doc('1,046.16', 'total') };
}

const ids = rows => rows.map(r => r.id).sort((a, b) => a - b);
const eq  = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function main() {
  const { db, d1, d2, d3 } = makeDb();
  const S = p => documents.search(db, p);
  console.log('documents.search total filter');
  check("equals 250.50 → d2",                              eq(ids(S({ total: '250.50', totalOp: 'eq' })), [d2]));
  check("above 200 → d2, d3",                              eq(ids(S({ total: '200', totalOp: 'gt' })), [d2, d3].sort((a, b) => a - b)));
  check("below 200 → d1",                                  eq(ids(S({ total: '200', totalOp: 'lt' })), [d1]));
  check("equals £1,046.16 (comma-stripped, custom 'total' key) → d3", eq(ids(S({ total: '£1,046.16', totalOp: 'eq' })), [d3]));
  check("no total param → all 3",                          S({}).length === 3);
  check("equals 999 → none",                               S({ total: '999', totalOp: 'eq' }).length === 0);
  check("garbage total value ('abc') → filter ignored (NaN)", S({ total: 'abc', totalOp: 'gt' }).length === 3);
  console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}`);
  process.exit(fails === 0 ? 0 : 1);
}
main();
