#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_structural_fields.js
 * ------------------------------------------
 * Structural fields (migration 27 + document_types guards): Company / Date /
 * Reference are PERMANENT — relabelled "Company", surfaced via is_structural, and
 * protected from rename / disable / delete. The per-document VALUE stays editable;
 * only the field DEFINITION is locked. Custom (non-built-in) fields are unaffected.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_structural_fields.js
 */

const Database  = require('better-sqlite3');
const doctypes  = require('./document_types');

function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); return cond; }

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE document_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT UNIQUE, built_in INTEGER DEFAULT 0,
      ref_field_key TEXT, date_field_key TEXT, sort_order INTEGER DEFAULT 100, enabled INTEGER DEFAULT 1
    );
    CREATE TABLE fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT, document_type_id INTEGER, key TEXT, label TEXT,
      type TEXT DEFAULT 'text', required INTEGER DEFAULT 0, built_in INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1, confidence_threshold REAL, sort_order INTEGER DEFAULT 100
    );
  `);
  return db;
}

function fieldId(db, key) {
  return db.prepare('SELECT id FROM fields WHERE key = ?').get(key).id;
}
function field(db, key) {
  return db.prepare('SELECT * FROM fields WHERE key = ?').get(key);
}
function fieldsOf(db, typeId) { return db.prepare('SELECT * FROM fields WHERE document_type_id = ?').all(typeId); }
function fkey(db, typeId, key) { return db.prepare('SELECT * FROM fields WHERE document_type_id = ? AND key = ?').get(typeId, key); }
function dtRow(db, typeId) { return db.prepare('SELECT * FROM document_types WHERE id = ?').get(typeId); }

function main() {
  let f = 0;
  const db = makeDb();
  doctypes.seedBuiltInTypes(db);

  // 1. Label: the company/identity field is labelled "Document Issuer" (both roles).
  f += !check('invoice supplier_name labelled "Document Issuer"', field(db, 'supplier_name').label === 'Document Issuer');
  // customer_name is no longer the identity (migration 44) — it's an ordinary optional 'Customer'
  // field; the sales-order identity is now supplier_name (labelled "Document Issuer").
  f += !check('sales-order identity is supplier_name "Document Issuer"', field(db, 'supplier_name').label === 'Document Issuer');
  f += !check('sales-order customer_name is now optional "Customer" (not the identity)', field(db, 'customer_name').label === 'Customer');
  f += !check('sales-order customer_name is NOT structural', doctypes.isStructuralKey({ ref_field_key: 'sales_order_number', date_field_key: 'order_date' }, 'customer_name') === false);

  // 2. is_structural annotation (Company / Date / Reference roles).
  const inv = doctypes.getWithFields(db, 'invoice');
  const byKey = Object.fromEntries(inv.fields.map(x => [x.key, x]));
  f += !check('supplier_name is structural', byKey.supplier_name.is_structural === 1);
  f += !check('invoice_date (date role) is structural', byKey.invoice_date.is_structural === 1);
  f += !check('invoice_number (ref role) is structural', byKey.invoice_number.is_structural === 1);

  // 3. updateField: a structural field can't be renamed, disabled or retyped.
  doctypes.updateField(db, fieldId(db, 'supplier_name'),
    { label: 'Vendor', enabled: 0, type: 'multiline_text' });
  const sn = field(db, 'supplier_name');
  f += !check('structural field NOT renamed', sn.label === 'Document Issuer');
  f += !check('structural field NOT disabled', sn.enabled === 1);
  f += !check('structural field NOT retyped', sn.type === 'text');
  // ...but a tunable (threshold) still applies.
  doctypes.updateField(db, fieldId(db, 'supplier_name'), { confidence_threshold: 0.8 });
  f += !check('structural field threshold still editable', field(db, 'supplier_name').confidence_threshold === 0.8);

  // 4. deleteField: a structural field can't be deleted.
  doctypes.deleteField(db, fieldId(db, 'invoice_date'));
  f += !check('structural date field NOT deleted', !!field(db, 'invoice_date'));

  // 5. A CUSTOM (non-structural) field is still fully editable + deletable.
  const invId = db.prepare("SELECT id FROM document_types WHERE slug='invoice'").get().id;
  doctypes.addField(db, { document_type_id: invId, key: 'po_ref', label: 'PO Ref', type: 'text' });
  const custId = fieldId(db, 'po_ref');
  f += !check('custom field is NOT structural', doctypes.getWithFields(db, 'invoice').fields.find(x => x.key === 'po_ref').is_structural === 0);
  doctypes.updateField(db, custId, { label: 'Purchase Ref', enabled: 0 });
  f += !check('custom field CAN be renamed', field(db, 'po_ref').label === 'Purchase Ref');
  f += !check('custom field CAN be disabled', field(db, 'po_ref').enabled === 0);
  doctypes.deleteField(db, custId);
  f += !check('custom field CAN be deleted', !field(db, 'po_ref'));

  // ── ensureStructuralRoles: force Company + Date on new custom types ──────────
  // 6. Empty custom type -> Company + Date created, date_field_key set, both protected.
  const e1 = doctypes.addType(db, { name: 'Empty Custom' }).lastInsertRowid;
  doctypes.ensureStructuralRoles(db, e1);
  f += !check('custom: Document Issuer field created', fkey(db, e1, 'supplier_name')?.label === 'Document Issuer');
  f += !check('custom: Date field created (type date)', fkey(db, e1, 'date')?.type === 'date');
  f += !check('custom: date_field_key set to date', dtRow(db, e1).date_field_key === 'date');
  f += !check('custom: Company + Date are structural',
              doctypes.isStructuralKey(dtRow(db, e1), 'supplier_name') && doctypes.isStructuralKey(dtRow(db, e1), 'date'));
  doctypes.updateField(db, fkey(db, e1, 'date').id, { enabled: 0, label: 'X', type: 'text' });
  const d1 = fkey(db, e1, 'date');
  f += !check('custom: Date protected (not disabled/renamed/retyped)',
              d1.enabled === 1 && d1.label === 'Date' && d1.type === 'date');
  doctypes.deleteField(db, fkey(db, e1, 'date').id);
  f += !check('custom: Date not deletable', !!fkey(db, e1, 'date'));

  // 7. Designated date is respected (no generic 'date' added).
  const e2 = doctypes.addType(db, { name: 'Has Date', date_field_key: 'invoice_date' }).lastInsertRowid;
  doctypes.addField(db, { document_type_id: e2, key: 'invoice_date', label: 'Invoice Date', type: 'date', required: 1 });
  doctypes.ensureStructuralRoles(db, e2);
  f += !check('designated date respected: no generic date field', !fkey(db, e2, 'date'));
  f += !check('designated date_field_key unchanged', dtRow(db, e2).date_field_key === 'invoice_date');
  f += !check('Company still added alongside designated date', !!fkey(db, e2, 'supplier_name'));

  // 8. Dangling date_field_key (set, field missing) is re-healed.
  const e3 = doctypes.addType(db, { name: 'Dangling', date_field_key: 'ghost_date' }).lastInsertRowid;
  doctypes.ensureStructuralRoles(db, e3);
  f += !check('dangling date_field_key healed: generic date created', !!fkey(db, e3, 'date'));
  f += !check('dangling re-pointed to date', dtRow(db, e3).date_field_key === 'date');

  // 9. Reference is NOT force-created; a designated ref is preserved + protected.
  const e4 = doctypes.addType(db, { name: 'Ref Type', ref_field_key: 'my_ref' }).lastInsertRowid;
  doctypes.addField(db, { document_type_id: e4, key: 'my_ref', label: 'My Ref', type: 'text' });
  doctypes.ensureStructuralRoles(db, e4);
  f += !check('no generic reference_number created', !fkey(db, e4, 'reference_number'));
  f += !check('designated ref preserved + structural', doctypes.isStructuralKey(dtRow(db, e4), 'my_ref'));
  const e5 = doctypes.addType(db, { name: 'No Ref' }).lastInsertRowid;
  doctypes.ensureStructuralRoles(db, e5);
  f += !check('reference NOT forced when undesignated', !fkey(db, e5, 'reference_number') && !dtRow(db, e5).ref_field_key);

  // 10. Generic-key collision: a pre-existing 'date' field (not designated) is reused.
  const e6 = doctypes.addType(db, { name: 'Date Collide' }).lastInsertRowid;
  doctypes.addField(db, { document_type_id: e6, key: 'date', label: 'Some Date', type: 'date' });
  doctypes.ensureStructuralRoles(db, e6);   // must NOT throw on UNIQUE(type,key)
  f += !check('collision: existing date field reused (no duplicate)', fieldsOf(db, e6).filter(x => x.key === 'date').length === 1);
  f += !check('collision: date_field_key set to existing date', dtRow(db, e6).date_field_key === 'date');

  // 11. Idempotent: a second pass adds nothing / no UNIQUE violation.
  doctypes.ensureStructuralRoles(db, e1);
  f += !check('idempotent: Company not duplicated', fieldsOf(db, e1).filter(x => x.key === 'supplier_name').length === 1);
  f += !check('idempotent: Date not duplicated', fieldsOf(db, e1).filter(x => x.key === 'date').length === 1);

  // 12. Dangling structural role (the "deleted the Reference field" case) is self-healed
  //     on the UI list-load paths: a ref_field_key pointing at a non-existent field is
  //     cleared to NULL so Review's Confirm gate isn't impossible + Settings can re-pick.
  const w = doctypes.addType(db, { name: 'Service Worksh' }).lastInsertRowid;
  doctypes.addField(db, { document_type_id: w, key: 'ticket_no', label: 'Ticket No.', type: 'text' });
  doctypes.addField(db, { document_type_id: w, key: 'date', label: 'Date', type: 'date' });
  db.prepare('UPDATE document_types SET ref_field_key = ?, date_field_key = ? WHERE id = ?')
    .run('reference_number', 'date', w);  // ref dangling, date valid
  const healed = doctypes.getAllWithFieldsAll(db).find(t => t.id === w);
  f += !check('dangling ref_field_key surfaced as null after load', healed.ref_field_key === null);
  f += !check('dangling ref cleared in the DB (self-heal persisted)', dtRow(db, w).ref_field_key === null);
  f += !check('valid date role untouched by repair', dtRow(db, w).date_field_key === 'date');

  // 13. updateType refuses to (re)create a dangling role, but allows a valid key + clearing.
  doctypes.updateType(db, w, { ref_field_key: 'does_not_exist' });
  f += !check('updateType drops a non-existent role key', dtRow(db, w).ref_field_key === null);
  doctypes.updateType(db, w, { ref_field_key: 'ticket_no' });
  f += !check('updateType accepts a real field as the ref role', dtRow(db, w).ref_field_key === 'ticket_no');
  f += !check('ticket_no now structural', doctypes.isStructuralKey(dtRow(db, w), 'ticket_no'));
  doctypes.updateType(db, w, { ref_field_key: null });
  f += !check('updateType allows clearing a role to null', dtRow(db, w).ref_field_key === null);

  db.close();
  console.log(f ? `\n${f} FAILED` : '\nAll structural-field checks passed');
  process.exit(f ? 1 : 0);
}

main();
