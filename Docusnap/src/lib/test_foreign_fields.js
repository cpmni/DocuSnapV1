#!/usr/bin/env node
'use strict';

/**
 * src/lib/test_foreign_fields.js  (P2 — type-scoped extraction hygiene)
 * --------------------------------------------------------------------
 * Gate for foreignFields.js + its two confirm-transition call sites (Oracle SIGN-OFF-WITH-CONDITIONS
 * 2026-07-22). realdoc_regression is BLIND to a storage-seam change, so THIS is the gate.
 *
 *   §0 ownFieldPredicate — keeps own fields / company key / ref+date roles, drops foreign, fail-open.
 *   §1 dropForeignExtractions ON  — a delivery note's foreign invoice/order/po_date rows are deleted;
 *                                   supplier_name + delivery_date + delivery_number remain.
 *   §2 kill switch OFF (FOREIGN_FIELD_DROP=0) — NO rows deleted (byte-identical).
 *   §3 fail-open — a type with no field metadata keeps EVERY row.
 *   §4 defensive — a ref/date role key not present in `fields` is still kept (never drop a role).
 *   §5 ORDERING PIN (load-bearing) — the drop call sits AFTER the auto-file eligibility gate in
 *      _autoFileDoc and AFTER filing in reviewService.confirm. This is the pin that would go RED
 *      against an import-seam implementation (which would drop before the gate and silently open it).
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/lib/test_foreign_fields.js
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const ff = require('./foreignFields');

let fails = 0;
function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; return cond; }
function section(t) { console.log(`\n${t}`); }

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE extractions (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT,
                              display_value TEXT, raw_value TEXT, validation_note TEXT, corrected_to TEXT);
  `);
  return db;
}
function seed(db, docId, keys) {
  const ins = db.prepare('INSERT INTO extractions (document_id, field_key, display_value) VALUES (?,?,?)');
  for (const k of keys) ins.run(docId, k, `${k}-val`);
}
function keysFor(db, docId) {
  return db.prepare('SELECT field_key FROM extractions WHERE document_id = ? ORDER BY field_key').all(docId).map(r => r.field_key);
}

// A delivery_note descriptor mirroring doctypes.getWithFields output. supplier_name is kept via
// COMPANY_KEYS (it need not appear in `fields`); delivery_date/number via fields + the role keys.
const dtDelivery = {
  id: 1, slug: 'delivery_note',
  ref_field_key: 'delivery_number', date_field_key: 'delivery_date',
  fields: [
    { key: 'supplier_name',   label: 'Document Issuer' },
    { key: 'delivery_date',   label: 'Delivery Date' },
    { key: 'delivery_number', label: 'Delivery Number' },
    { key: 'customer_name',   label: 'Customer' },
  ],
};
const FOREIGN = ['invoice_date', 'order_date', 'po_date', 'total_amount'];
const OWN     = ['supplier_name', 'delivery_date', 'delivery_number', 'customer_name'];

function main() {
  section('0. ownFieldPredicate — keep own / company / roles, drop foreign, fail-open');
  const keep = ff.ownFieldPredicate(dtDelivery);
  check('keeps a defined field (delivery_number)', keep('delivery_number') === true);
  check('keeps the company/identity key (supplier_name)', keep('supplier_name') === true);
  check('keeps the date role (delivery_date)', keep('delivery_date') === true);
  check('drops a foreign key (invoice_date)', keep('invoice_date') === false);
  check('drops a foreign key (po_date)', keep('po_date') === false);
  check('fail-open: no field metadata => keeps everything', ff.ownFieldPredicate({ id: 9, fields: [] })('anything') === true);
  check('fail-open: null dtInfo => keeps everything', ff.ownFieldPredicate(null)('invoice_date') === true);

  section('1. dropForeignExtractions ON — foreign date rows deleted, own rows remain');
  delete process.env.FOREIGN_FIELD_DROP;   // default ON
  let db = makeDb();
  seed(db, 1, [...OWN, ...FOREIGN]);
  const n = ff.dropForeignExtractions(db, 1, dtDelivery);
  const after = keysFor(db, 1);
  check('returned count === 4 foreign rows dropped', n === 4);
  check('foreign invoice_date GONE', !after.includes('invoice_date'));
  check('foreign order_date GONE',   !after.includes('order_date'));
  check('foreign po_date GONE',      !after.includes('po_date'));
  check('foreign total_amount GONE', !after.includes('total_amount'));
  check('own supplier_name REMAINS',   after.includes('supplier_name'));
  check('own delivery_date REMAINS',   after.includes('delivery_date'));
  check('own delivery_number REMAINS', after.includes('delivery_number'));
  check('own customer_name REMAINS',   after.includes('customer_name'));
  db.close();

  section('2. kill switch OFF (FOREIGN_FIELD_DROP=0) — byte-identical, nothing deleted');
  process.env.FOREIGN_FIELD_DROP = '0';
  db = makeDb();
  seed(db, 1, [...OWN, ...FOREIGN]);
  const nOff = ff.dropForeignExtractions(db, 1, dtDelivery);
  check('returns 0 when disabled', nOff === 0);
  check('all rows retained when disabled', keysFor(db, 1).length === OWN.length + FOREIGN.length);
  db.close();
  delete process.env.FOREIGN_FIELD_DROP;   // restore default for later sections

  section('3. fail-open — a type with no field metadata keeps every row');
  db = makeDb();
  seed(db, 1, [...OWN, ...FOREIGN]);
  const nNoMeta = ff.dropForeignExtractions(db, 1, { id: 9, slug: 'x', fields: [] });
  check('returns 0 (fail-open)', nNoMeta === 0);
  check('all rows retained', keysFor(db, 1).length === OWN.length + FOREIGN.length);
  db.close();

  section('4. defensive — a role key absent from `fields` is still kept');
  db = makeDb();
  seed(db, 1, ['supplier_name', 'delivery_number', 'invoice_date']);
  // fields omit delivery_number, but it is the ref_field_key => must survive via the role set.
  const dtRoleOnly = { id: 2, slug: 'dn', ref_field_key: 'delivery_number', date_field_key: 'delivery_date',
                       fields: [{ key: 'supplier_name' }, { key: 'delivery_date' }] };
  ff.dropForeignExtractions(db, 1, dtRoleOnly);
  const roleAfter = keysFor(db, 1);
  check('role key delivery_number kept though not in `fields`', roleAfter.includes('delivery_number'));
  check('company key supplier_name kept', roleAfter.includes('supplier_name'));
  check('foreign invoice_date dropped', !roleAfter.includes('invoice_date'));
  db.close();

  section('5. ORDERING PIN (load-bearing) — drop is placed AFTER the gate / after filing (not import-seam)');
  const handlerSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'processing', 'handler.js'), 'utf8');
  const af = handlerSrc.indexOf('async function _autoFileDoc');
  const afEnd = handlerSrc.indexOf('\nfunction _autoFileRouteDeps', af);   // next top-level fn
  const afBody = handlerSrc.slice(af, afEnd > af ? afEnd : undefined);
  const gateIdx = afBody.indexOf('isAutoFileEligible');
  const dropIdx = afBody.indexOf('dropForeignExtractions');
  check('_autoFileDoc calls isAutoFileEligible', gateIdx >= 0);
  check('_autoFileDoc calls dropForeignExtractions', dropIdx >= 0);
  check('drop runs AFTER the isAutoFileEligible gate (not import-seam)', gateIdx >= 0 && dropIdx > gateIdx);

  const rsSrc = fs.readFileSync(path.join(__dirname, '..', 'services', 'reviewService.js'), 'utf8');
  const commitIdx = rsSrc.indexOf('filing.commitDocument');
  const rsDropIdx = rsSrc.indexOf('foreignFields.dropForeignExtractions');
  check('reviewService.confirm calls dropForeignExtractions', rsDropIdx >= 0);
  check('drop runs AFTER filing.commitDocument (post-file, post-claim)', commitIdx >= 0 && rsDropIdx > commitIdx);

  console.log('\n' + (fails === 0 ? 'ALL PASS' : `${fails} FAILED`));
  process.exit(fails ? 1 : 0);
}

main();
