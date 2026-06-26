#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_accept_correction.js
 * ------------------------------------------
 * Data-side coverage for the Review "Accept" button (correction candidates):
 *  - corrected_to persists through insertExtractions and is retrievable, so the
 *    button can be shown ONLY when a candidate exists (and is absent otherwise);
 *  - learning still flows through the single confirm path: whatever final value
 *    is confirmed is what gets learned — the accepted suggestion OR a different
 *    manual override.
 *
 * The button's DOM behaviour (click copies corrected_to into the input, no
 * auto-confirm) is in review/renderer.js and exercised manually; this test
 * locks the data contract the button depends on.
 *
 * Usage: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_accept_correction.js
 */

const Database = require('better-sqlite3');
const learning = require('./learning');

function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); return cond; }

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE extractions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT,
      raw_value TEXT, display_value TEXT, confidence INTEGER,
      extraction_method TEXT, validation_note TEXT,
      was_corrected INTEGER DEFAULT 0, corrected_to TEXT, anchor_label TEXT  -- migration 14
    );
    CREATE TABLE corrections (
      id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT,
      original_value TEXT, corrected_value TEXT, supplier_name TEXT, document_type TEXT,
      corrected_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE supplier_hints (
      id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_name TEXT, document_type TEXT,
      field_key TEXT, hint_value TEXT, usage_count INTEGER DEFAULT 1, last_seen TEXT,
      UNIQUE(supplier_name, document_type, field_key, hint_value)
    );
    CREATE TABLE field_anchors (
      id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_name TEXT, document_type TEXT,
      field_key TEXT, anchor_label TEXT, direction TEXT, page_zone TEXT,
      x_norm REAL, y_norm REAL, w_norm REAL, h_norm REAL,
      usage_count INTEGER DEFAULT 1, confidence REAL, last_seen TEXT
    );
  `);
  return db;
}
const hintVal = (db, fk) =>
  db.prepare(`SELECT hint_value FROM supplier_hints WHERE field_key=? AND supplier_name='Acme'`).get(fk)?.hint_value;

let fail = 0;

// 1+2: candidate persists corrected_to; plain field does not.
let db = freshDb();
learning.insertExtractions(db, 1, [
  { field_key: 'invoice_number', raw_value: '/ 36714', display_value: '/ 36714',
    confidence: 45, extraction_method: 'keyword',
    validation_note: 'format anomaly: correction candidate — 736714', corrected_to: '736714' },
  { field_key: 'total', raw_value: '12.00', display_value: '12.00',
    confidence: 90, extraction_method: 'keyword', validation_note: null },
]);
const cand = db.prepare(`SELECT corrected_to FROM extractions WHERE field_key='invoice_number'`).get();
const plain = db.prepare(`SELECT corrected_to FROM extractions WHERE field_key='total'`).get();
fail += !check('candidate field persists corrected_to (Accept button SHOWS)', cand.corrected_to === '736714');
fail += !check('plain field has null corrected_to (Accept button HIDDEN)', plain.corrected_to === null);
db.close();

// 3: confirming the ACCEPTED value learns the accepted value.
db = freshDb();
learning.saveCorrections(db, 1,
  { invoice_number: { original_value: '/ 36714', corrected_value: '736714' } },
  'Acme', 'invoice', { invoice_number: '736714' });
fail += !check('accepting suggestion then confirming learns the accepted value (736714)',
  hintVal(db, 'invoice_number') === '736714');
db.close();

// 4: overriding with a DIFFERENT manual value learns that value instead.
db = freshDb();
learning.saveCorrections(db, 2,
  { invoice_number: { original_value: '/ 36714', corrected_value: '999999' } },
  'Acme', 'invoice', { invoice_number: '999999' });
const learned = hintVal(db, 'invoice_number');
fail += !check('overriding the suggestion learns the overridden value (999999), not the candidate',
  learned === '999999');
db.close();

console.log(fail ? `\n${fail} FAILED` : '\nAll accept-correction data checks passed');
process.exit(fail ? 1 : 0);
