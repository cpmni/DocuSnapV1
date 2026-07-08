#!/usr/bin/env node
'use strict';
// Regression test for QA audit #1 — backup restore must NOT silently re-type a
// surviving document, must NOT abort on cross-machine FK edges, and must remap
// child FKs (fields/template children) + null a dangling sample_document_id.
// Run: ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe src/services/test_backup_retype.js

const Database = require('better-sqlite3');
const { applyBackup } = require('./backupService');

let fail = 0;
const check = (l, c) => { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}`); if (!c) fail++; };

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE document_types(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, slug TEXT UNIQUE);
  CREATE TABLE template_groups(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE);
  CREATE TABLE templates(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT UNIQUE,
    document_type_slug TEXT, group_id INTEGER REFERENCES template_groups(id));
  CREATE TABLE documents(id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_type_id INTEGER REFERENCES document_types(id),
    template_id INTEGER REFERENCES templates(id));
  ALTER TABLE templates ADD COLUMN sample_document_id INTEGER REFERENCES documents(id);
  CREATE TABLE fields(id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_type_id INTEGER NOT NULL REFERENCES document_types(id) ON DELETE CASCADE,
    key TEXT, UNIQUE(document_type_id, key));
  CREATE TABLE template_fields(id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    field_key TEXT, UNIQUE(template_id, field_key));
`);
db.pragma('foreign_keys = ON');

// LOCAL machine: Invoice=id1, Sales Order=id2. A surviving document is Sales Order.
db.prepare("INSERT INTO document_types VALUES(1,'Invoice','invoice')").run();
db.prepare("INSERT INTO document_types VALUES(2,'Sales Order','sales_order')").run();
db.prepare("INSERT INTO fields(document_type_id,key) VALUES(2,'sales_order_number')").run();
db.prepare("INSERT INTO template_groups VALUES(1,'Group A')").run();
db.prepare("INSERT INTO templates(id,name,slug,document_type_slug,group_id,sample_document_id) VALUES(1,'T1','t1','invoice',1,NULL)").run();
db.prepare("INSERT INTO documents(id,document_type_id,template_id) VALUES(1,2,1)").run();  // a Sales Order doc
db.prepare("INSERT INTO template_fields(template_id,field_key) VALUES(1,'stale_local')").run();

// BACKUP from ANOTHER machine where the ids are SWAPPED (id1=sales_order, id2=invoice)
// and the template's sample points at a doc id that doesn't exist here (999).
const payload = { tables: {
  document_types: [ {id:1,name:'Sales Order',slug:'sales_order'}, {id:2,name:'Invoice',slug:'invoice'} ],
  fields:         [ {id:5,document_type_id:2,key:'invoice_number'} ],   // backup invoice = id2
  template_groups:[ {id:9,name:'Group A'} ],
  templates:      [ {id:7,name:'T1',slug:'t1',document_type_slug:'invoice',group_id:9,sample_document_id:999} ],
  template_fields:[ {id:3,template_id:7,field_key:'total'} ],
}};

let threw = false;
try { applyBackup(db, payload); } catch (e) { threw = true; console.log('   restore error: ' + e.message); }
check('restore over surviving documents does NOT abort (no FK error)', !threw);

// The surviving document must STILL be a Sales Order (no silent re-type).
const doc = db.prepare('SELECT document_type_id FROM documents WHERE id=1').get();
const docType = db.prepare('SELECT slug FROM document_types WHERE id=?').get(doc.document_type_id);
check('surviving document NOT silently re-typed (still sales_order)', docType && docType.slug === 'sales_order');

// The backup Invoice field lands on the LOCAL invoice type (remapped, not backup id2 = local Sales Order).
const invType = db.prepare("SELECT id FROM document_types WHERE slug='invoice'").get();
const invFields = db.prepare('SELECT key FROM fields WHERE document_type_id=?').all(invType.id).map(r => r.key);
check('backup field remapped onto the correct local type', invFields.includes('invoice_number'));
check('sales_order type not polluted by the invoice field',
  !db.prepare("SELECT 1 FROM fields WHERE document_type_id=2 AND key='invoice_number'").get());

// Template upserted by slug; group remapped to the valid local group; dangling sample nulled.
const tmpl = db.prepare("SELECT * FROM templates WHERE slug='t1'").get();
check('template sample_document_id nulled (referent absent here)', tmpl.sample_document_id === null);
check('template group_id remapped to a valid local group',
  !!db.prepare('SELECT 1 FROM template_groups WHERE id=?').get(tmpl.group_id));
const tf = db.prepare('SELECT field_key FROM template_fields WHERE template_id=?').all(tmpl.id).map(r => r.field_key);
check('template children replaced from backup', tf.includes('total') && !tf.includes('stale_local'));

// FK integrity holds under a full check.
const fkErr = db.pragma('foreign_key_check');
check('no dangling foreign keys after restore', Array.isArray(fkErr) && fkErr.length === 0);

db.close();
console.log(fail ? `\n${fail} check(s) FAILED` : '\nAll backup re-type checks passed.');
process.exit(fail ? 1 : 0);
