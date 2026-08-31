#!/usr/bin/env node
'use strict';
/**
 * test_reread_holds_required_roles.js — STRUCTURAL ROLES ARE REQUIRED BY NATURE (mig 92; Oracle SIGN-OFF-W/COND
 * C1 + C3, 2026-08-27).
 *
 * A wizard/editor-made type carried required=0 on its identity / ref-role / date-role fields (the shared editor's
 * create road never set the flag; the edit toggle is locked), so rereadHolds' `required` list was EMPTY on those
 * types: no "Read differently after learning" (S3-C5) hold and no first-fill "confirm once" hold, EVER, on their
 * roles — the quiet lane and the manual Reprocess were both blind there. Pins:
 *   §1 the UNCONDITIONAL startup heal (database/index.js, after the stamped 92) fixes a pre-existing required=0
 *      role row on a DB where 92 is already stamped (a verbatim row copy / hand SQL road);
 *   §2 the wizard road (addType + addField(required 0) + ensureStructuralRoles) yields required=1 on all three
 *      roles and leaves an optional List field at 0;
 *   §3 rereadHolds now sees the roles: S3-C5 fires on a changed ref (with the baseline offer) and a first-filled
 *      date role is held with the confirm-once note — the stated behaviour change for custom types.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/processing/test_reread_holds_required_roles.js
 */
const path = require('path');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..', '..');
let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; return cond; };

const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
const documents = require(path.join(ROOT, 'database', 'modules', 'documents'));
const doctypes = require(path.join(ROOT, 'database', 'modules', 'document_types'));
const holdsMod = require('./rereadHolds');

const db = new Database(':memory:');
runMigrations(db);
const req = (tid, key) => (db.prepare('SELECT required FROM fields WHERE document_type_id = ? AND key = ?').get(tid, key) || {}).required;
const ROLE_FIELDS = [['supplier_name', 'text'], ['reference_number', 'reference'], ['date', 'date'], ['serial_number', 'list']];

console.log('§1 the startup heal: a pre-existing required=0 role row is healed by the next runMigrations (92 already stamped)');
check('mig 92 is stamped on a fresh DB', !!db.prepare('SELECT 1 FROM migrations WHERE version = 92').get());
db.prepare("INSERT INTO document_types (id, name, slug, built_in, ref_field_key, date_field_key) VALUES (77, 'Old Worksheet', 'old_worksheet', 0, 'reference_number', 'date')").run();
for (const [k, type] of ROLE_FIELDS)
  db.prepare('INSERT INTO fields (document_type_id, key, label, type, required, enabled) VALUES (77, ?, ?, ?, 0, 1)').run(k, k, type);
check('control: the raw rows start at required=0', req(77, 'supplier_name') === 0 && req(77, 'reference_number') === 0 && req(77, 'date') === 0);
runMigrations(db);   // the next app start: the stamped 92 block is skipped, the unconditional heal runs
check('startup heal: identity required=1', req(77, 'supplier_name') === 1);
check('startup heal: ref role required=1', req(77, 'reference_number') === 1);
check('startup heal: date role required=1', req(77, 'date') === 1);
check('startup heal: the optional List field is untouched (0)', req(77, 'serial_number') === 0);

console.log('\n§2 the wizard road: addField(required 0) x3 + ensureStructuralRoles asserts the roles');
const tid = Number(doctypes.addType(db, { name: 'Wizard Worksheet', ref_field_key: 'reference_number', date_field_key: 'date' }).lastInsertRowid);
let order = 10;
for (const [k, type] of ROLE_FIELDS) { doctypes.addField(db, { document_type_id: tid, key: k, label: k, type, required: 0, sort_order: order }); order += 10; }
doctypes.ensureStructuralRoles(db, tid);
check('roles required=1 after the wizard road', req(tid, 'supplier_name') === 1 && req(tid, 'reference_number') === 1 && req(tid, 'date') === 1);
check('optional List field stays 0', req(tid, 'serial_number') === 0);
check('no generic date / reference field was added (designated ones respected)', db.prepare('SELECT COUNT(*) c FROM fields WHERE document_type_id = ?').get(tid).c === 4);

console.log('\n§3 rereadHolds sees the roles of a wizard-made type');
const holds = holdsMod.create({ corroborated: () => false, k: 1 });
const SUP = 'Castellan Security Systems';
const insRow = db.prepare('INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method) VALUES (?, ?, ?, ?, 94, ?)');
const mk = (rows) => {
  const id = Number(documents.insert(db, { original_filename: `ws-${Math.random().toString(36).slice(2, 6)}.pdf`, folder_path: '/in', status: 'needs_review', supplier_name: SUP, document_type_id: tid }).lastInsertRowid);
  for (const r of rows) insRow.run(id, r.key, r.value, r.value, 'keyword');
  return id;
};
const snapshot = (id) => db.prepare('SELECT * FROM extractions WHERE document_id = ?').all(id);
const setRows = (id, rows) => { db.prepare('DELETE FROM extractions WHERE document_id = ?').run(id); for (const r of rows) insRow.run(id, r.key, r.value, r.value, 'template_mapping'); };
const ext = (id, key) => db.prepare('SELECT display_value, validation_note, corrected_to FROM extractions WHERE document_id = ? AND field_key = ?').get(id, key) || {};

const d1 = mk([{ key: 'supplier_name', value: SUP }, { key: 'reference_number', value: 'CJB-9791' }, { key: 'date', value: '' }]);
const existing = snapshot(d1);
setRows(d1, [{ key: 'supplier_name', value: SUP }, { key: 'reference_number', value: 'CJB-9797' }, { key: 'date', value: '12-08-2026' }]);
const changed = holds.holdChangedReads(db, d1, existing);
check("S3-C5 fires on the ref role (was 'CJB-9791', now 'CJB-9797')",
      changed.some(c => c.key === 'reference_number') && /Read differently after learning — was 'CJB-9791', now 'CJB-9797'/.test(ext(d1, 'reference_number').validation_note || ''));
check('…and offers the baseline (corrected_to = CJB-9791)', ext(d1, 'reference_number').corrected_to === 'CJB-9791');
const held = holds.holdFirstFills(db, d1, existing, holdsMod.NOTES.manual);
check('the first-filled date role is held with the confirm-once note', held.some(h => h.key === 'date') && /confirm once/.test(ext(d1, 'date').validation_note || ''));
check('the optional List field is never a first-fill hold candidate', !held.some(h => h.key === 'serial_number'));

// Anti-restore control: with the roles forced back to 0 the holds go blind again — proving the pins above
// exercise the flag and not something else.
db.prepare("UPDATE fields SET required = 0 WHERE document_type_id = ? AND key IN ('supplier_name', 'reference_number', 'date')").run(tid);
const d2 = mk([{ key: 'supplier_name', value: SUP }, { key: 'reference_number', value: 'CJB-1000' }, { key: 'date', value: '' }]);
const ex2 = snapshot(d2);
setRows(d2, [{ key: 'supplier_name', value: SUP }, { key: 'reference_number', value: 'CJB-2000' }, { key: 'date', value: '01-01-2026' }]);
check('control: with required=0 roles S3-C5 is BLIND (the pre-fix state)', holds.holdChangedReads(db, d2, ex2).length === 0);
check('control: with required=0 roles the first-fill hold is BLIND (the pre-fix state)', holds.holdFirstFills(db, d2, ex2, holdsMod.NOTES.manual).length === 0);
check('…and the startup heal restores them', (runMigrations(db), req(tid, 'reference_number') === 1));

console.log(fails ? `\n${fails} FAILED` : '\nAll required-role reread-hold checks passed');
process.exit(fails ? 1 : 0);
