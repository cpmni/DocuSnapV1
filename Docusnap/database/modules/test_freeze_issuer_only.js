'use strict';
/* test_freeze_issuer_only.js — TEMPLATE_FREEZE_ISSUER_ONLY + the generalised unfreeze sweep.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_freeze_issuer_only.js
 *
 * WHAT THIS PINS. _buildTemplateFields freezes a field as a supplier CONSTANT when the schema calls
 * it constant and confirmed history has not shown it varying. On a sample of ONE taught document
 * neither escape can fire, so per-document codes (po_ref, serials, account_no) froze and were
 * stamped on every sibling at template_fixed @95 — above the 88 auto-file floor.
 *
 * ⚠ THE SWITCH IS DEFAULT OFF AND IS NOT RECOMMENDED FOR FLIPPING ON THIS EVIDENCE. Measured on a
 * 200-document replay of a real teach run: unfreezing moved po_ref 35%->50% but vat_no 51%->16%
 * (empties 32->95), because a VAT number IS a genuine per-supplier constant whose taught mapping
 * often fails to read, and the stamp was carrying it. Net NEGATIVE. The switch and the sweep exist
 * so the decision is available and reversible, not because the flip is indicated. Re-measure before
 * flipping; the arm is stress_test/teach_run_ab.js.
 *
 * The sweep is the migration-46 sibling: an existing template is ALREADY poisoned and the auto-file
 * path never rebuilds its fields, so a go-forward guard alone cannot heal one.
 */
const path = require('path');
const Database = require(path.join('c:/GIT Projects/Docusnap', 'node_modules', 'better-sqlite3'));
const templates = require('./templates');

let pass = 0, fail = 0;
const ok = (label, cond, extra) => {
  if (cond) { pass++; console.log(`  OK  ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${extra ? ' — ' + extra : ''}`); }
};

function db() {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
          CREATE TABLE document_types (id INTEGER PRIMARY KEY, name TEXT, slug TEXT,
                                       ref_field_key TEXT, date_field_key TEXT);
          CREATE TABLE fields (id INTEGER PRIMARY KEY, document_type_id INTEGER, key TEXT, label TEXT);
          CREATE TABLE templates (id INTEGER PRIMARY KEY, name TEXT, document_type_slug TEXT);
          CREATE TABLE template_fields (id INTEGER PRIMARY KEY, template_id INTEGER, field_key TEXT,
                                        anchor_label TEXT, direction TEXT, fixed_value TEXT,
                                        is_variable INTEGER, fixed_locked INTEGER DEFAULT 0);
          INSERT INTO document_types (id,name,slug,ref_field_key,date_field_key)
            VALUES (1,'Delivery Note','delivery_note','delivery_number','delivery_date');
          INSERT INTO fields (document_type_id,key,label) VALUES
            (1,'supplier_name','Document Issuer'), (1,'customer_name','Customer'),
            (1,'po_ref','Your PO'), (1,'vat_no','VAT Number'), (1,'delivery_number','Number');
          INSERT INTO templates (id,name,document_type_slug) VALUES (1,'Oakhaven','delivery_note');`);
  return d;
}

const frozen = (d, key, value, locked = 0) =>
  d.prepare(`INSERT INTO template_fields (template_id,field_key,fixed_value,is_variable,fixed_locked)
             VALUES (1,?,?,0,?)`).run(key, value, locked);
const rowOf = (d, key) =>
  d.prepare('SELECT fixed_value, is_variable FROM template_fields WHERE field_key = ?').get(key);

// ── 1. the sweep ─────────────────────────────────────────────────────────────
console.log('\n1. Generalised unfreeze sweep');
{
  const d = db();
  frozen(d, 'supplier_name', 'Oakhaven Electrical');
  frozen(d, 'po_ref', 'PO-78567');
  frozen(d, 'vat_no', 'GB 660 1173 45');
  frozen(d, 'customer_name', 'Bramblewood Joinery Ltd', 1);   // admin-locked

  const res = templates.unfreezeAutoFrozenFields(d, { backupKey: 'freeze_backup' });
  ok('unfroze exactly the non-issuer, non-locked rows', res.unfrozen === 2, `got ${res.unfrozen}`);
  ok('ISSUER stays frozen', rowOf(d, 'supplier_name').is_variable === 0);
  ok('admin-locked row untouched', rowOf(d, 'customer_name').fixed_value === 'Bramblewood Joinery Ltd');
  ok('po_ref released', rowOf(d, 'po_ref').fixed_value === null && rowOf(d, 'po_ref').is_variable === 1);
  ok('vat_no released', rowOf(d, 'vat_no').fixed_value === null);

  const again = templates.unfreezeAutoFrozenFields(d, { backupKey: 'freeze_backup2' });
  ok('idempotent — a second run finds nothing', again.unfrozen === 0, `got ${again.unfrozen}`);
}

// ── 2. reversibility (the owner's constraint: tonight's work must be undoable) ─
console.log('\n2. Revert from the backup blob');
{
  const d = db();
  frozen(d, 'supplier_name', 'Oakhaven Electrical');
  frozen(d, 'po_ref', 'PO-78567');
  frozen(d, 'vat_no', 'GB 660 1173 45');
  const before = d.prepare('SELECT field_key, fixed_value, is_variable FROM template_fields ORDER BY field_key').all();

  templates.unfreezeAutoFrozenFields(d, { backupKey: 'freeze_backup' });
  const blob = d.prepare("SELECT value FROM settings WHERE key='freeze_backup'").get();
  ok('backup blob written BEFORE the update', !!blob && JSON.parse(blob.value).length === 2);

  const r = templates.restoreFrozenFieldsFromBackup(d, 'freeze_backup');
  ok('restored both rows', r.restored === 2, `got ${r.restored}`);
  const after = d.prepare('SELECT field_key, fixed_value, is_variable FROM template_fields ORDER BY field_key').all();
  ok('template_fields byte-identical to pre-sweep', JSON.stringify(before) === JSON.stringify(after),
     JSON.stringify(after));
}

// ── 3. a value an admin set by hand after the sweep is never clobbered ────────
console.log('\n3. Rollback respects a later admin edit');
{
  const d = db();
  frozen(d, 'po_ref', 'PO-78567');
  templates.unfreezeAutoFrozenFields(d, { backupKey: 'b' });
  d.prepare("UPDATE template_fields SET fixed_value='PO-ADMIN', is_variable=0, fixed_locked=1 WHERE field_key='po_ref'").run();
  const r = templates.restoreFrozenFieldsFromBackup(d, 'b');
  ok('locked/re-frozen row is skipped by the rollback', r.restored === 0 && rowOf(d, 'po_ref').fixed_value === 'PO-ADMIN');
}

// ── 4. migration 46 still behaves exactly as before ──────────────────────────
console.log('\n4. The migration-46 wrapper is unchanged by the generalisation');
{
  const d = db();
  frozen(d, 'supplier_name', 'Oakhaven Electrical');
  frozen(d, 'customer_name', 'Bramblewood Joinery Ltd');
  frozen(d, 'vat_no', 'GB 660 1173 45');
  const res = templates.unfreezeAutoFrozenRecipientNames(d);
  ok('unfreezes the recipient NAME only', res.unfrozen === 1, `got ${res.unfrozen}`);
  ok('issuer still frozen', rowOf(d, 'supplier_name').is_variable === 0);
  ok('non-name constant still frozen (that is the 46 contract)', rowOf(d, 'vat_no').is_variable === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
