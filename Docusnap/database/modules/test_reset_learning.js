#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_reset_learning.js
 * ---------------------------------------
 * Covers learning.resetAllLearning — the dev "Clear ALL learning memory" reset.
 * Verifies it wipes every learning corpus + the managed template store in one
 * transaction, leaves core settings and documents intact (only the template_id
 * link cleared), returns per-table counts, and is idempotent.
 *
 * Usage: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_reset_learning.js
 */

const Database = require('better-sqlite3');
const learning = require('./learning');

function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); return cond; }
const count = (db, t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;

const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE document_types (id INTEGER PRIMARY KEY, slug TEXT);
  CREATE TABLE documents (id INTEGER PRIMARY KEY, status TEXT, template_id INTEGER);
  CREATE TABLE supplier_hints (id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_name TEXT, document_type TEXT, field_key TEXT, hint_value TEXT, usage_count INTEGER, last_seen TEXT);
  CREATE TABLE field_anchors (id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_name TEXT, document_type TEXT, field_key TEXT, last_seen TEXT);
  CREATE TABLE logo_fingerprints (id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_name TEXT, phash TEXT, last_seen TEXT);
  CREATE TABLE corrections (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT, corrected_value TEXT, supplier_name TEXT, document_type TEXT, corrected_at TEXT);
  CREATE TABLE field_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_name TEXT, document_type TEXT, field_key TEXT);

  CREATE TABLE template_groups (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE templates (id INTEGER PRIMARY KEY, name TEXT, group_id INTEGER REFERENCES template_groups(id));
  CREATE TABLE template_fields (id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER REFERENCES templates(id) ON DELETE CASCADE, field_key TEXT);
  CREATE TABLE template_field_mappings (id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER REFERENCES templates(id) ON DELETE CASCADE, field_key TEXT);
`);

// Seed learning + non-learning data
db.prepare(`INSERT INTO settings VALUES ('output_folder','C:/out'),('theme','dark'),('processing_mode','smart')`).run();
db.prepare(`INSERT INTO document_types (id,slug) VALUES (1,'invoice')`).run();
db.prepare(`INSERT INTO documents (id,status,template_id) VALUES (1,'confirmed',7),(2,'needs_review',7),(3,'confirmed',NULL)`).run();
db.prepare(`INSERT INTO supplier_hints (supplier_name,document_type,field_key,hint_value,usage_count) VALUES ('Acme','invoice','supplier_name','Acme',3)`).run();
db.prepare(`INSERT INTO field_anchors (supplier_name,document_type,field_key) VALUES ('Acme','invoice','total')`).run();
db.prepare(`INSERT INTO logo_fingerprints (supplier_name,phash) VALUES ('Acme','abcd')`).run();
db.prepare(`INSERT INTO corrections (document_id,field_key,corrected_value,supplier_name,document_type) VALUES (1,'total','10','Acme','invoice')`).run();
db.prepare(`INSERT INTO template_groups (id,name) VALUES (5,'Group A')`).run();
db.prepare(`INSERT INTO templates (id,name,group_id) VALUES (7,'Acme Invoice',5)`).run();
db.prepare(`INSERT INTO template_fields (template_id,field_key) VALUES (7,'supplier_name'),(7,'total')`).run();
db.prepare(`INSERT INTO template_field_mappings (template_id,field_key) VALUES (7,'invoice_date')`).run();

let fail = 0;
const r = learning.resetAllLearning(db);
console.log('counts:', JSON.stringify(r));

for (const t of ['supplier_hints','field_anchors','logo_fingerprints','corrections',
                 'templates','template_fields','template_field_mappings','template_groups']) {
  fail += !check(`${t} fully cleared`, count(db, t) === 0);
}
fail += !check('returned counts are accurate (supplier_hints=1, templates=1, mappings=1)',
  r.supplier_hints === 1 && r.templates === 1 && r.template_field_mappings === 1 && r.documents_unlinked === 2);

// Non-learning state intact
fail += !check('settings untouched (3 rows)', count(db, 'settings') === 3);
fail += !check('output_folder setting intact', db.prepare(`SELECT value FROM settings WHERE key='output_folder'`).get().value === 'C:/out');
fail += !check('document_types untouched', count(db, 'document_types') === 1);
fail += !check('documents NOT deleted (3 rows remain)', count(db, 'documents') === 3);
fail += !check('document template links cleared (none point at a template)',
  db.prepare('SELECT COUNT(*) c FROM documents WHERE template_id IS NOT NULL').get().c === 0);

// Idempotent — second run is a clean no-op
const r2 = learning.resetAllLearning(db);
fail += !check('idempotent: second run deletes nothing',
  Object.values(r2).every(n => n === 0));

db.close();
console.log(fail ? `\n${fail} FAILED` : '\nAll reset-learning checks passed');
process.exit(fail ? 1 : 0);
