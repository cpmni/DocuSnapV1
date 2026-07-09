#!/usr/bin/env node
'use strict';
/**
 * database/modules/test_saveanchor_scope.js
 * -----------------------------------------
 * Guards the SUPPLIER-SCOPED authoritative anchor sweep (gary Slice 1, 2026-07-09):
 * an authoritative ⊕ teach for one supplier must collapse only THAT supplier's stale
 * siblings for (field, doc_type) — it must NEVER delete another supplier's learned anchor
 * ("I taught one Anconia doc and it broke my other suppliers").
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_saveanchor_scope.js
 */
const Database = require('better-sqlite3');
const learning = require('./learning');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE field_anchors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_name TEXT, document_type TEXT, field_key TEXT,
    anchor_label TEXT, direction TEXT, page_zone TEXT,
    x_norm REAL, y_norm REAL, w_norm REAL DEFAULT 0, h_norm REAL DEFAULT 0,
    usage_count INTEGER DEFAULT 1, confidence REAL DEFAULT 0.6,
    last_seen TEXT DEFAULT (datetime('now')), last_authoritative_at TEXT,
    offset_dx_norm REAL, offset_dy_norm REAL
  );`);
  return db;
}
const insertPassive = (db, supplier, label) => db.prepare(
  `INSERT INTO field_anchors (supplier_name, document_type, field_key, anchor_label, direction, page_zone, x_norm, y_norm)
   VALUES (?, 'invoice', 'invoice_number', ?, 'right', 'top', 0.5, 0.3)`).run(supplier, label);
const rows = (db, supplier) => db.prepare(
  "SELECT anchor_label, last_authoritative_at FROM field_anchors WHERE supplier_name=? AND field_key='invoice_number'").all(supplier);

(function main() {
  const db = makeDb();
  insertPassive(db, 'City Office NI', 'Invoice No');          // another supplier's learned anchor
  insertPassive(db, 'Anconia Corp',   'Inv Number');          // this supplier's STALE sibling (diff label)

  // Authoritative teach for Anconia / invoice / invoice_number, label "INVOICE NUMBER".
  learning.saveAnchor(db, {
    supplier_name: 'Anconia Corp', document_type: 'invoice', field_key: 'invoice_number',
    anchor_label: 'INVOICE NUMBER', direction: 'right', page_zone: 'top',
    x_norm: 0.844, y_norm: 0.384, w_norm: 0.109, h_norm: 0.018, authoritative: true,
    offset_dx_norm: 0.185, offset_dy_norm: 0.002, label_detected: true,
  });

  const city = rows(db, 'City Office NI');
  check("City Office's own anchor SURVIVES the Anconia teach (Slice 1)",
    city.length === 1 && city[0].anchor_label === 'Invoice No');

  const anconia = rows(db, 'Anconia Corp');
  check("Anconia's STALE sibling ('Inv Number') is removed", !anconia.some(a => a.anchor_label === 'Inv Number'));
  const taught = anconia.find(a => a.anchor_label === 'INVOICE NUMBER');
  check("the new Anconia authoritative row exists with last_authoritative_at",
    !!taught && !!taught.last_authoritative_at);
  check("Anconia now has exactly ONE invoice_number anchor (its teach)", anconia.length === 1);

  db.close();
  console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}`);
  process.exit(fails ? 1 : 0);
})();
