#!/usr/bin/env node
'use strict';
/**
 * Oracle condition 3 (label-caption guard, ANCHOR_CAPTION_HARVEST_GUARD): the LOAD-BEARING end-to-end
 * assertion the corpus gate CANNOT reach (realdoc_regression spawns process_docs.py and is blind to the
 * Electron persist + trust gate). The caption guard emits an extraction row with value=NULL + a
 * validation_note; this proves such a row TRIPS trust.isAutoFileEligible's flagged gate, so the doc is
 * HELD for review and never silently auto-files blank. The control (same null row WITHOUT the note)
 * proves the NOTE is load-bearing — if a future change drops it, the doc would auto-file blank.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_caption_empty_flagged.js
 */
const Database = require('better-sqlite3');
const trust = require('./trust');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE document_types (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT UNIQUE, ref_field_key TEXT, date_field_key TEXT);
    CREATE TABLE fields (id INTEGER PRIMARY KEY AUTOINCREMENT, document_type_id INTEGER, key TEXT, label TEXT, type TEXT DEFAULT 'text', required INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1);
    CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_name TEXT, document_type_id INTEGER, status TEXT, confirmed_at TEXT, template_id INTEGER, overall_confidence INTEGER);
    CREATE TABLE extractions (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT, display_value TEXT, raw_value TEXT, confidence INTEGER, extraction_method TEXT, validation_note TEXT, corrected_to TEXT);
    CREATE TABLE corrections (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT, original_value TEXT, corrected_value TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
  `);
  return db;
}
const NOTE = 'The label matched a heading on the page, not a value — please check this field.';

function main() {
  const db = makeDb();
  const tid = db.prepare("INSERT INTO document_types (name, slug, ref_field_key, date_field_key) VALUES ('Worksheet','worksheet','ticket_no','worksheet_date')").run().lastInsertRowid;
  // conf 100 + untrusted scope (status needs_review => no confirmed siblings) => floor 100, so the doc
  // clears the floor and REACHES the flagged check; the note is the only thing that can hold it.
  const mkDoc = () => db.prepare("INSERT INTO documents (supplier_name, document_type_id, status, overall_confidence) VALUES ('Document Solutions', ?, 'needs_review', 100)").run(tid).lastInsertRowid;
  const getDoc = (id) => db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
  const emit = (docId, note) => db.prepare(
    "INSERT INTO extractions (document_id, field_key, display_value, raw_value, confidence, extraction_method, validation_note) VALUES (?, 'item', NULL, NULL, 40, 'anchor', ?)"
  ).run(docId, note);

  const d1 = mkDoc(); emit(d1, NOTE);
  const r1 = trust.isAutoFileEligible(db, getDoc(d1));
  check("caption guard's empty (value=NULL) + note row -> NOT eligible", r1.eligible === false);
  check("  -> reason 'flagged' (held for review; never a silent blank auto-file)", trust.isFlaggedReason(r1.reason));

  const d2 = mkDoc(); emit(d2, null);   // control: identical row, no note
  const r2 = trust.isAutoFileEligible(db, getDoc(d2));
  check("control: SAME null-value row WITHOUT the note is NOT held (proves the note is load-bearing)", !trust.isFlaggedReason(r2.reason));

  // FLAGGED FIELD NAME (2026-09-24, Chris round card 2b; Oracle C9): the refusal names the FIRST blocking
  // row's field so Review can say "<Field> was flagged" — the customer's Total held 30 invoices with no field
  // named on screen. Deterministic: extraction-row (id) order, from the same filter that blocked.
  check("the refusal NAMES the flagged field: reason === 'flagged:item'", r1.reason === 'flagged:item', r1.reason);
  const d3 = mkDoc();
  db.prepare("INSERT INTO extractions (document_id, field_key, display_value, raw_value, confidence, extraction_method, validation_note) VALUES (?, 'ticket_no', 'T-1', 'T-1', 95, 'anchor', NULL)").run(d3);
  db.prepare("INSERT INTO extractions (document_id, field_key, display_value, raw_value, confidence, extraction_method, validation_note) VALUES (?, 'total', '10.00', '10.00', 95, 'keyword', ?)").run(d3, NOTE);
  db.prepare("INSERT INTO extractions (document_id, field_key, display_value, raw_value, confidence, extraction_method, validation_note) VALUES (?, 'item', 'x', 'x', 95, 'anchor', ?)").run(d3, NOTE);
  const r3 = trust.isAutoFileEligible(db, getDoc(d3));
  check("two noted rows: the FIRST by extraction id is named (total, not item); the clean row never is", r3.reason === 'flagged:total', r3.reason);
  check("isFlaggedReason accepts the result object, the keyed string and the bare string; rejects others",
        trust.isFlaggedReason(r3) && trust.isFlaggedReason('flagged:total') && trust.isFlaggedReason('flagged')
        && !trust.isFlaggedReason('below-floor') && !trust.isFlaggedReason('flaggedx') && !trust.isFlaggedReason(null));

  console.log('\n' + (fails === 0 ? 'ALL PASS' : `${fails} FAILED`));
  process.exit(fails ? 1 : 0);
}
main();
