'use strict';
/**
 * test_lookup.js — pins Quick File RECORDS LISTS (auto-fill lookup; mig 197; design
 * QUICKFILE_LOOKUP_LISTS_2026-09-21.md, Oracle SIGN-OFF-W/COND). Covers: list/record CRUD, the SURROGATE-id
 * collision guarantee (two "John Doe" never merge), token-PREFIX suggest (Oracle C3 / PIN 3 — never a
 * substring), the one-list-per-type field map (Oracle C6), resolve→prefill, and PIN 1 / C7 (learning-leak):
 * the lookup readers touch NO learning store and prefill is unreachable from the Review confirm door.
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_lookup.js
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { runMigrations } = require('../index');
const lookup = require('./lookup');

let fails = 0;
const check = (l, c) => { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}`); if (!c) fails++; };

function freshDb() { const db = new Database(':memory:'); runMigrations(db); return db; }
const CHILD_COLS = [
  { key: 'child_name', label: 'Child', is_master: true },
  { key: 'dob', label: 'DOB', type: 'date' },
  { key: 'address', label: 'Address' },
];

console.log('§1 list + record CRUD; surrogate id — two "John Doe" are two rows that never merge');
let db = freshDb();
const cl = lookup.createList(db, { name: 'Children', master_key: 'child_name', columns: CHILD_COLS, disambiguator_key: 'dob' });
check('createList ok', cl.ok && cl.id > 0);
const r1 = lookup.addRecord(db, cl.id, { values: { child_name: 'John Doe', dob: '01-01-2020', address: '12 High St' } });
const r2 = lookup.addRecord(db, cl.id, { values: { child_name: 'John Doe', dob: '05-06-2021', address: '9 Oak Rd' }, disambiguator: '05-06-2021' });
check('two same-named records → two distinct surrogate ids', r1.ok && r2.ok && r1.id !== r2.id);
check('blank master refused', lookup.addRecord(db, cl.id, { values: { child_name: '  ', dob: 'x' } }).error === 'blank_master');
check('record count = 2', lookup.countRecords(db, cl.id) === 2);
lookup.addRecord(db, cl.id, { values: { child_name: 'Susanna Bell', dob: '02-02-2019' } });
lookup.addRecord(db, cl.id, { values: { child_name: "Aoife O'Brien", dob: '03-03-2018' } });

console.log('§2 suggest — token-PREFIX (PIN 3), 3-char min, both John Does returned, disambiguator carried');
{
  const doe = lookup.suggest(db, cl.id, 'doe');            // surname token prefix
  check("'doe' matches John Doe (surname token prefix)", doe.rows.length === 2 && doe.rows.every(r => r.master_value === 'John Doe'));
  check('both John Does returned, with distinct disambiguator/values', doe.rows[0].id !== doe.rows[1].id);
  const jodo = lookup.suggest(db, cl.id, 'jo do');         // two token prefixes
  check("'jo do' matches John Doe", jodo.rows.length === 2);
  const obrien = lookup.suggest(db, cl.id, 'obrien');      // apostrophe fold
  check("'obrien' matches O'Brien (apostrophe join)", obrien.rows.length === 1 && /O'Brien/.test(obrien.rows[0].master_value));
  // PIN 3 — token-PREFIX, NOT substring:
  check("PIN 3: 'ann' does NOT match 'Susanna' (substring, not a token prefix)", lookup.suggest(db, cl.id, 'ann').rows.length === 0);
  check("PIN 3: 'ohn' does NOT match 'John' (mid-string, not a token prefix)", lookup.suggest(db, cl.id, 'ohn').rows.length === 0);
  check("3-char minimum: 'jo' returns nothing", lookup.suggest(db, cl.id, 'jo').rows.length === 0);
}

console.log('§3 field maps — ONE list per type (Oracle C6), master→trigger, resolve→prefill');
{
  const typeId = db.prepare("INSERT INTO document_types (name, slug, reading_mode, quick_file, built_in) VALUES ('Child Record','child_record','none',1,0)").run().lastInsertRowid;
  const set = lookup.setFieldMaps(db, typeId, cl.id, [
    { field_key: 'supplier_name', column_key: 'child_name' },
    { field_key: 'child_dob', column_key: 'dob' },
    { field_key: 'home_address', column_key: 'address' },
  ]);
  check('setFieldMaps ok', set.ok);
  check('getListForType returns the bound list', lookup.getListForType(db, typeId) === cl.id);
  const maps = lookup.getFieldMaps(db, typeId);
  check('3 maps stored, all referencing ONE list (C6)', maps.length === 3 && maps.every(m => m.list_id === cl.id));
  check('the master-mapped field is the trigger', maps.find(m => m.column_key === 'child_name').is_trigger === 1);
  const res = lookup.resolveRecordForType(db, typeId, r1.id);
  check('resolve → prefill map from the chosen record', res.ok && res.fields.supplier_name === 'John Doe' && res.fields.child_dob === '01-01-2020' && res.fields.home_address === '12 High St');
  // setFieldMaps replaces (no accumulation); empty unbinds.
  lookup.setFieldMaps(db, typeId, cl.id, [{ field_key: 'supplier_name', column_key: 'child_name' }]);
  check('setFieldMaps replaces the whole set (now 1 map)', lookup.getFieldMaps(db, typeId).length === 1);
  lookup.setFieldMaps(db, typeId, null, []);
  check('empty maps unbind the type', lookup.getListForType(db, typeId) === null);
}

console.log('§4 deleteList cascades records + maps');
{
  const before = lookup.countRecords(db, cl.id);
  lookup.deleteList(db, cl.id);
  check('records cascade-deleted with the list', before > 0 && db.prepare('SELECT COUNT(*) n FROM lookup_records WHERE list_id=?').get(cl.id).n === 0);
}

console.log('§5 PIN 1 / C7 — learning-leak source-contract (the whole reason this lane is safe)');
{
  const lookupSrc = fs.readFileSync(path.join(__dirname, 'lookup.js'), 'utf8');
  const handlerSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'modules', 'lookup', 'handler.js'), 'utf8');
  const banned = /getFieldFormats|getFieldValueSuggestions|getFieldValueHistory|getPrefixModelForScope|supplier_hints|corrections|field_anchors|reviewService|isAutoFileEligible/;
  check('lookup.js references NO learning reader/writer', !banned.test(lookupSrc));
  check('lookup handler references NO learning reader/writer', !banned.test(handlerSrc));
  // C7: prefill must be unreachable from the Review/OCR confirm door — reviewService must not know about lookup.
  const reviewSvc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'services', 'reviewService.js'), 'utf8');
  check('reviewService does NOT reference the lookup module (prefill unreachable from confirm — C7)', !/modules\/lookup|database\/modules\/lookup|resolveRecordForType/.test(reviewSvc));
}

console.log(`\n${fails ? 'FAIL' : 'PASS'} — ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
