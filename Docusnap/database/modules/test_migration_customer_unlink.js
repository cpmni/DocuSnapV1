'use strict';
// Migration 44 — customer_name UNLINKED from identity. Verifies the SCHEMA reshape on an OLD-shape
// install (customer_name-identity Sales Order, no supplier_name field) AND the load-bearing
// invariant that NO document / filing / learning data is touched (the Oracle's SEND-BACK condition:
// an ambiguous historical customer_name value must NOT be injected into the supplier scope/learning).
//   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron database/modules/test_migration_customer_unlink.js
const Database = require('better-sqlite3');
const doctypes = require('./document_types');

let f = 0;
const check = (n, c) => { console.log((c ? 'OK  ' : 'BAD ') + n); if (!c) f++; };

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE document_types (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, built_in INTEGER DEFAULT 0,
     ref_field_key TEXT, date_field_key TEXT, enabled INTEGER DEFAULT 1);
  CREATE TABLE fields (id INTEGER PRIMARY KEY, document_type_id INTEGER, key TEXT, label TEXT,
     type TEXT DEFAULT 'text', required INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1,
     built_in INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 100, confidence_threshold INTEGER,
     UNIQUE(document_type_id, key));
  CREATE TABLE documents (id INTEGER PRIMARY KEY, document_type_id INTEGER, status TEXT,
     supplier_name TEXT, stored_path TEXT, folder_path TEXT);
  CREATE TABLE extractions (id INTEGER PRIMARY KEY, document_id INTEGER, field_key TEXT,
     display_value TEXT, extraction_method TEXT, confidence INTEGER);
  CREATE TABLE supplier_hints (id INTEGER PRIMARY KEY, supplier_name TEXT, document_type TEXT,
     field_key TEXT, hint_value TEXT, usage_count INTEGER);
`);

// OLD-shape Sales Order: customer_name = "Document Issuer" identity, NO supplier_name field.
const t = db.prepare(`INSERT INTO document_types (name,slug,ref_field_key,date_field_key)
                      VALUES ('Sales Order','sales_order','sales_order_number','order_date')`).run().lastInsertRowid;
const addF = db.prepare(`INSERT INTO fields (document_type_id,key,label,type,required,sort_order) VALUES (?,?,?,?,?,?)`);
addF.run(t, 'customer_name', 'Document Issuer', 'text', 1, 10);
addF.run(t, 'order_date', 'Order Date', 'date', 1, 20);
addF.run(t, 'sales_order_number', 'Sales Order Number', 'text', 1, 30);
// A confirmed doc with an EMPTY supplier scope + a customer_name (BUYER) value + a filed path.
const d = db.prepare(`INSERT INTO documents (document_type_id,status,supplier_name,stored_path,folder_path)
                      VALUES (?,?,?,?,?)`).run(t, 'confirmed', '', '/out/Unknown/x.pdf', '/out/Unknown').lastInsertRowid;
db.prepare(`INSERT INTO extractions (document_id,field_key,display_value,extraction_method,confidence)
            VALUES (?,?,?,?,?)`).run(d, 'customer_name', 'Antrim Coast Hotels', 'keyword', 80);

const docBefore = db.prepare(`SELECT supplier_name,stored_path,folder_path FROM documents WHERE id=?`).get(d);
const extCountBefore = db.prepare(`SELECT COUNT(*) n FROM extractions`).get().n;

// Run the migration core (idempotent).
const n1 = doctypes.reshapeCustomerIdentityTypes(db);
const n2 = doctypes.reshapeCustomerIdentityTypes(db);   // second run must be a no-op

const fld = (k) => db.prepare(`SELECT * FROM fields WHERE document_type_id=? AND key=?`).get(t, k);

// 1 — schema reshaped: supplier_name is now the identity, customer_name demoted
check('reshaped exactly 1 type', n1 === 1);
check('idempotent: second run reshapes 0', n2 === 0);
check('supplier_name identity field added, labelled "Document Issuer"', fld('supplier_name') && fld('supplier_name').label === 'Document Issuer' && fld('supplier_name').required === 1);
check('customer_name demoted to optional "Customer"', fld('customer_name').label === 'Customer' && fld('customer_name').required === 0);
check('supplier_name is structural, customer_name is NOT',
      doctypes.isStructuralKey({ ref_field_key: 'sales_order_number', date_field_key: 'order_date' }, 'supplier_name') === true &&
      doctypes.isStructuralKey({ ref_field_key: 'sales_order_number', date_field_key: 'order_date' }, 'customer_name') === false);

// 2 — INVARIANT: no document/filing/learning data touched (the Oracle condition)
const docAfter = db.prepare(`SELECT supplier_name,stored_path,folder_path FROM documents WHERE id=?`).get(d);
check('documents.supplier_name unchanged (still empty — no ambiguous back-fill)', docAfter.supplier_name === docBefore.supplier_name);
check('stored_path / folder_path unchanged (no re-file)', docAfter.stored_path === docBefore.stored_path && docAfter.folder_path === docBefore.folder_path);
check('no supplier_name extraction row synthesised (buyer name NOT injected into learning)',
      db.prepare(`SELECT COUNT(*) n FROM extractions WHERE field_key='supplier_name'`).get().n === 0);
check('extraction count unchanged', db.prepare(`SELECT COUNT(*) n FROM extractions`).get().n === extCountBefore);
check('no supplier_hints created from the buyer name', db.prepare(`SELECT COUNT(*) n FROM supplier_hints`).get().n === 0);

// 3 — a customer_name used as a SECONDARY field ("Deliver To") is left untouched
const t2 = db.prepare(`INSERT INTO document_types (name,slug) VALUES ('Delivery Note','delivery_note')`).run().lastInsertRowid;
addF.run(t2, 'supplier_name', 'Document Issuer', 'text', 1, 10);
addF.run(t2, 'customer_name', 'Deliver To', 'text', 0, 20);
doctypes.reshapeCustomerIdentityTypes(db);
const dn = db.prepare(`SELECT * FROM fields WHERE document_type_id=? AND key='customer_name'`).get(t2);
check('secondary customer_name ("Deliver To") left untouched', dn.label === 'Deliver To' && dn.required === 0);

console.log('\n' + (f ? `${f} FAILED` : 'All migration-44 checks passed'));
process.exit(f ? 1 : 0);
