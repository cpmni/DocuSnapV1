#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_migration_unfreeze_names.js
 * -------------------------------------------------
 * Guards migration 46 (templates.unfreezeAutoFrozenRecipientNames) — the sweep that heals templates
 * already poisoned by a frozen recipient name (Oracle C1/C2/C4). Reproduces the freeze, then proves:
 *   - a frozen customer_name is UNFROZEN;
 *   - the ISSUER (supplier_name) is UNCHANGED;
 *   - an admin-locked (fixed_locked=1) name field is UNCHANGED;
 *   - an opaque-key field labelled "Customer Name" is UNFROZEN (label-aware, Oracle C2);
 *   - a genuinely-constant NON-name field (payment_terms) is UNCHANGED;
 *   - re-run is a no-op (idempotent).
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_migration_unfreeze_names.js
 */

const Database  = require('better-sqlite3');
const templates = require('./templates');

let fails = 0;
function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; return cond; }

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE document_types (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT);
    CREATE TABLE fields (id INTEGER PRIMARY KEY AUTOINCREMENT, document_type_id INTEGER, key TEXT, label TEXT);
    CREATE TABLE templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, document_type_slug TEXT);
    CREATE TABLE template_fields (id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER, field_key TEXT,
      fixed_value TEXT, is_variable INTEGER DEFAULT 1, fixed_locked INTEGER DEFAULT 0);
  `);
  const dt = db.prepare("INSERT INTO document_types (name, slug) VALUES ('Sales Order','sales_order')").run().lastInsertRowid;
  const addF = (k, l) => db.prepare('INSERT INTO fields (document_type_id, key, label) VALUES (?,?,?)').run(dt, k, l);
  addF('supplier_name', 'Document Issuer'); addF('customer_name', 'Customer');
  addF('field_7', 'Customer Name'); addF('payment_terms', 'Payment Terms');
  const t = db.prepare("INSERT INTO templates (name, document_type_slug) VALUES ('Cascade Water Systems','sales_order')").run().lastInsertRowid;
  const addTF = (k, v, locked) => db.prepare('INSERT INTO template_fields (template_id, field_key, fixed_value, is_variable, fixed_locked) VALUES (?,?,?,0,?)').run(t, k, v, locked || 0);
  addTF('supplier_name', 'Cascade Water Systems', 0);   // issuer — keep frozen
  addTF('customer_name', 'Primrose Childcare', 0);      // recipient — unfreeze
  addTF('field_7', 'Bluefin Marine Ltd', 0);            // opaque key, name-like label — unfreeze
  addTF('payment_terms', 'Net 30', 0);                  // constant non-name — keep frozen
  addTF('customer_name', 'Ashcombe Care Homes Ltd', 1); // ADMIN-LOCKED name — keep frozen
  return { db, t };
}

const frozen = (db, key, locked) => {
  const q = db.prepare('SELECT is_variable, fixed_value, fixed_locked FROM template_fields WHERE field_key=? AND COALESCE(fixed_locked,0)=?');
  return q.get(key, locked ? 1 : 0);
};

function main() {
  const { db } = makeDb();
  const r = templates.unfreezeAutoFrozenRecipientNames(db);
  console.log(`\nsweep: unfroze ${r.unfrozen} of ${r.scanned} scanned`);

  check('frozen customer_name (unlocked) is UNFROZEN', (() => { const x = frozen(db, 'customer_name', 0); return x.is_variable === 1 && x.fixed_value === null; })());
  check('opaque field_7 (labelled "Customer Name") is UNFROZEN (label-aware)', (() => { const x = frozen(db, 'field_7', 0); return x.is_variable === 1 && x.fixed_value === null; })());
  check('ISSUER supplier_name is UNCHANGED (still frozen)', (() => { const x = frozen(db, 'supplier_name', 0); return x.is_variable === 0 && x.fixed_value === 'Cascade Water Systems'; })());
  check('constant NON-name payment_terms is UNCHANGED (still frozen)', (() => { const x = frozen(db, 'payment_terms', 0); return x.is_variable === 0 && x.fixed_value === 'Net 30'; })());
  check('ADMIN-LOCKED customer_name is UNCHANGED (fixed_locked preserved)', (() => { const x = frozen(db, 'customer_name', 1); return x.is_variable === 0 && x.fixed_value === 'Ashcombe Care Homes Ltd'; })());
  check('exactly 2 unfrozen (customer_name + field_7)', r.unfrozen === 2);

  const r2 = templates.unfreezeAutoFrozenRecipientNames(db);
  check('idempotent — re-run unfreezes 0', r2.unfrozen === 0);

  console.log('\n' + (fails === 0 ? 'ALL PASS' : `${fails} FAILED`));
  process.exit(fails ? 1 : 0);
}

main();
