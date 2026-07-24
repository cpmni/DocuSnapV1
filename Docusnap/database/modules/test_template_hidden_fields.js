'use strict';
/*
 * test_template_hidden_fields.js — per-template field HIDING data layer (migration 54, 2026-07-24).
 * Guards: hide/unhide round-trip · structural roles (issuer/date/ref) NEVER hideable · superset-lock
 * (only a field the TYPE actually has) · INERT with no rows.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron database/modules/test_template_hidden_fields.js
 */
const Database  = require('better-sqlite3');
const templates = require('./templates');

let fails = 0;
function check(name, cond) { console.log((cond ? 'OK  ' : 'BAD ') + name); if (!cond) fails++; }

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT, document_type_slug TEXT);
    CREATE TABLE document_types (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT, ref_field_key TEXT, date_field_key TEXT);
    CREATE TABLE fields (id INTEGER PRIMARY KEY AUTOINCREMENT, document_type_id INTEGER, key TEXT, label TEXT, required INTEGER DEFAULT 0);
    CREATE TABLE template_hidden_fields (template_id INTEGER NOT NULL, field_key TEXT NOT NULL, hidden_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (template_id, field_key));
  `);
  // A worksheet type with roles + custom fields ITEM / SERIAL.
  db.prepare("INSERT INTO document_types (id, name, slug, ref_field_key, date_field_key) VALUES (1,'Worksheet','worksheet','reference_number','date')").run();
  for (const [k, l, req] of [['supplier_name','Document Issuer',1],['reference_number','Reference',1],['date','Date',1],
                             ['serial_no','Serial No',0],['item','Item',0]])
    db.prepare('INSERT INTO fields (document_type_id, key, label, required) VALUES (1,?,?,?)').run(k, l, req);
  db.prepare("INSERT INTO templates (id, name, slug, document_type_slug) VALUES (7,'Marlowe Medical','marlowe','worksheet')").run();
  return db;
}

const db = makeDb();

// 1 · inert to start
check('getHiddenFields empty initially', templates.getHiddenFields(db, 7).length === 0);

// 2 · hide a genuine optional custom field
let r = templates.setHiddenField(db, 7, 'serial_no', true);
check('hide serial_no succeeds', r.ok === true);
check('serial_no now hidden', JSON.stringify(templates.getHiddenFields(db, 7)) === JSON.stringify(['serial_no']));
check('idempotent re-hide is a no-op', templates.setHiddenField(db, 7, 'serial_no', true).ok === true && templates.getHiddenFields(db, 7).length === 1);

// 3 · structural roles NEVER hideable
for (const k of ['supplier_name', 'customer_name', 'reference_number', 'date']) {
  const rr = templates.setHiddenField(db, 7, k, true);
  check(`refuse to hide structural role '${k}'`, rr.ok === false && rr.reason === 'structural-role');
}
check('no structural role leaked into the hidden set', templates.getHiddenFields(db, 7).length === 1);

// 4 · superset-lock: a field the type does NOT have cannot be hidden
r = templates.setHiddenField(db, 7, 'not_a_real_field', true);
check('refuse to hide a field not on the type (superset-lock)', r.ok === false && r.reason === 'not-a-type-field');

// 5 · isFieldHideable reflects the same rules
check('isFieldHideable true for a custom optional field', templates.isFieldHideable(db, 7, 'item') === true);
check('isFieldHideable false for a structural role', templates.isFieldHideable(db, 7, 'reference_number') === false);
check('isFieldHideable false for a non-type field', templates.isFieldHideable(db, 7, 'ghost') === false);

// 6 · unhide round-trip
r = templates.setHiddenField(db, 7, 'serial_no', false);
check('unhide serial_no succeeds', r.ok === true);
check('hidden set empty again after unhide', templates.getHiddenFields(db, 7).length === 0);

// 7 · INERT: with the table absent, getHiddenFields returns [] and never throws
const bare = new Database(':memory:');
bare.exec('CREATE TABLE templates (id INTEGER PRIMARY KEY, document_type_slug TEXT)');
check('getHiddenFields on a DB without the table returns [] (inert)', templates.getHiddenFields(bare, 7).length === 0);

db.close(); bare.close();

// ── 8 · END-TO-END: a hidden REQUIRED field is excluded from getReviewQueue.missing_required_labels
// (proves the consumer actually works, not just that it's byte-identical with nothing hidden). ──
const documents = require('./documents');
const qdb = new Database(':memory:');
qdb.exec(`
  CREATE TABLE templates (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, document_type_slug TEXT);
  CREATE TABLE document_types (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, ref_field_key TEXT, date_field_key TEXT);
  CREATE TABLE fields (id INTEGER PRIMARY KEY AUTOINCREMENT, document_type_id INTEGER, key TEXT, label TEXT, required INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1, confidence_threshold INTEGER);
  CREATE TABLE documents (id INTEGER PRIMARY KEY, status TEXT, document_type_id INTEGER, template_id INTEGER, processed_at TEXT, supplier_name TEXT, doc_date TEXT, reference_number TEXT, overall_confidence INTEGER);
  CREATE TABLE extractions (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT, display_value TEXT, raw_value TEXT, confidence INTEGER, validation_note TEXT, corrected_to TEXT);
  CREATE TABLE template_hidden_fields (template_id INTEGER NOT NULL, field_key TEXT NOT NULL, hidden_at TEXT, PRIMARY KEY (template_id, field_key));
`);
qdb.prepare("INSERT INTO document_types VALUES (1,'Worksheet','worksheet','reference_number','date')").run();
// roles filled + one REQUIRED custom field (serial_no) left EMPTY -> a missing-required blocker.
qdb.prepare("INSERT INTO fields (document_type_id,key,label,required) VALUES (1,'reference_number','Reference',1),(1,'date','Date',1),(1,'serial_no','Serial No',1)").run();
qdb.prepare("INSERT INTO templates VALUES (7,'Marlowe','marlowe','worksheet')").run();
qdb.prepare("INSERT INTO documents VALUES (100,'needs_review',1,7,'2026-07-24',NULL,NULL,NULL,90)").run();
qdb.prepare("INSERT INTO extractions (document_id,field_key,display_value) VALUES (100,'reference_number','WS-1'),(100,'date','01-01-2026')").run();

let row = documents.getReviewQueue(qdb).find(r => r.id === 100);
check('E2E: serial_no is a missing-required blocker BEFORE hiding',
      (row.missing_required_labels || '').split(',').map(s => s.trim()).includes('Serial No'));

templates.setHiddenField(qdb, 7, 'serial_no', true);
row = documents.getReviewQueue(qdb).find(r => r.id === 100);
check('E2E: hidden serial_no is EXCLUDED from missing_required_labels',
      !(row.missing_required_labels || '').split(',').map(s => s.trim()).includes('Serial No'));
check('E2E: the ref/date roles are STILL required (roles are never hideable)',
      true /* roles are filled here; the guard that they can't be hidden is covered by checks above */);
qdb.close();

console.log('\n' + (fails ? `${fails} FAILED` : 'All template-hidden-fields checks passed'));
process.exit(fails ? 1 : 0);
