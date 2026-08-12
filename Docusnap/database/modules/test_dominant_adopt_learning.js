#!/usr/bin/env node
'use strict';
// ORACLE B3 PIN (CONFIRMED_DOMINANT_ADOPT, 2026-08-12): a '+confirmed_adopt' extraction row is
// UNCONDITIONALLY excluded from getFieldFormats learning — the adopted value IS the learned
// dominant, so counting it would let dominance vote for itself (machine echoes locking the
// literal in past a real-world change; confirmed_via cannot separate graduated machine files
// from humans — both stamp NULL). Shape-agnostic: exclusion is proven by equivalence to an
// EMPTY install, and non-exclusion of a normal row by difference from it.
// Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_dominant_adopt_learning.js

const Database = require('better-sqlite3');
const learning = require('./learning');

let fails = 0;
const check = (l, c) => { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}`); if (!c) fails++; };

function makeDb(method) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE document_types (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT);
    CREATE TABLE fields (id INTEGER PRIMARY KEY AUTOINCREMENT, document_type_id INTEGER, key TEXT, label TEXT, type TEXT);
    CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_name TEXT, document_type_id INTEGER,
                            status TEXT, confirmed_at TEXT);
    CREATE TABLE extractions (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT,
                              display_value TEXT, extraction_method TEXT);
    CREATE TABLE corrections (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT, corrected_value TEXT);
  `);
  const tid = db.prepare("INSERT INTO document_types (name, slug) VALUES ('Statement','statement')").run().lastInsertRowid;
  db.prepare('INSERT INTO fields (document_type_id, key, type) VALUES (?, ?, ?)').run(tid, 'customer_name', 'text');
  if (method !== null) {
    for (let i = 0; i < 3; i++) {   // 3 rows — clears any minimum-sample threshold in the learner
      const did = db.prepare("INSERT INTO documents (supplier_name, document_type_id, status, confirmed_at) VALUES ('Ironclad', ?, 'confirmed', '2026-08-12')").run(tid).lastInsertRowid;
      db.prepare('INSERT INTO extractions (document_id, field_key, display_value, extraction_method) VALUES (?, ?, ?, ?)')
        .run(did, 'customer_name', 'Bramblewood Joinery Ltd', method);
    }
  }
  return db;
}

const empty   = JSON.stringify(learning.getFieldFormats(makeDb(null)));
const normal  = JSON.stringify(learning.getFieldFormats(makeDb('keyword')));
const adopted = JSON.stringify(learning.getFieldFormats(makeDb('keyword+confirmed_adopt')));
const tmplAdopted = JSON.stringify(learning.getFieldFormats(makeDb('template_mapping+confirmed_adopt')));

check('a normal keyword row IS learned (differs from an empty install)', normal !== empty);
check("a 'keyword+confirmed_adopt' row is EXCLUDED (identical to an empty install)", adopted === empty);
check("a 'template_mapping+confirmed_adopt' row is excluded too (suffix, any base)", tmplAdopted === empty);

console.log(`\n${fails ? 'FAIL' : 'PASS'} — ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
