'use strict';
/**
 * test_field_value_history.js
 * Guards learning.getFieldValueHistory / purgeFieldValue / renameFieldValue (the
 * Advanced → "View learning history" backend). Uses an in-memory DB with a minimal schema.
 *
 * Run with Electron-as-Node (native better-sqlite3 ABI):
 *   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron database/modules/test_field_value_history.js
 */
const path = require('path');
const Database = require(path.join(__dirname, '..', '..', 'node_modules', 'better-sqlite3'));
const learning = require('./learning');

let FAILS = 0;
const check = (label, cond) => { if (!cond) FAILS++; console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); };

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE document_types (id INTEGER PRIMARY KEY, slug TEXT);
  CREATE TABLE documents (id INTEGER PRIMARY KEY, supplier_name TEXT, document_type_id INTEGER, status TEXT, confirmed_at TEXT, original_filename TEXT);
  CREATE TABLE extractions (id INTEGER PRIMARY KEY, document_id INTEGER, field_key TEXT, raw_value TEXT, display_value TEXT);
  CREATE TABLE corrections (id INTEGER PRIMARY KEY, document_id INTEGER, field_key TEXT, original_value TEXT, corrected_value TEXT, supplier_name TEXT, document_type TEXT);
  CREATE TABLE supplier_hints (id INTEGER PRIMARY KEY, supplier_name TEXT, document_type TEXT, field_key TEXT, hint_value TEXT, usage_count INTEGER);
`);
db.prepare(`INSERT INTO document_types (id, slug) VALUES (1, 'worksheet')`).run();
const SN = 'Document Solutions', FK = 'reference_number';
// 3 confirmed docs: SO2, SO3, and an OCR slip $O2.
let docId = 0;
const addDoc = (val, when) => {
  docId++;
  db.prepare(`INSERT INTO documents (id, supplier_name, document_type_id, status, confirmed_at, original_filename) VALUES (?,?,1,'confirmed',?,?)`).run(docId, SN, when, `f${docId}.pdf`);
  db.prepare(`INSERT INTO extractions (document_id, field_key, raw_value, display_value) VALUES (?,?,?,?)`).run(docId, FK, val, val);
};
addDoc('SO2', '2026-06-01'); addDoc('SO3', '2026-06-02'); addDoc('$O2', '2026-06-03');
db.prepare(`INSERT INTO supplier_hints (supplier_name, document_type, field_key, hint_value, usage_count) VALUES (?,?,?,?,3)`).run(SN, 'worksheet', FK, '$O2');

const scope = { supplier_name: SN, document_type: 'worksheet', field_key: FK };

console.log('getFieldValueHistory:');
let hist = learning.getFieldValueHistory(db, scope);
check('returns 3 distinct values', hist.length === 3);
check('includes the $O2 slip', hist.some(r => r.value === '$O2'));
check('each value carries a count + last_seen', hist.every(r => r.count >= 1 && r.last_seen));

console.log('renameFieldValue ($O2 -> SO2, merges into existing):');
const changed = learning.renameFieldValue(db, { ...scope, oldValue: '$O2', newValue: 'SO2' });
check('reported >=1 row changed', changed >= 1);
hist = learning.getFieldValueHistory(db, scope);
check('$O2 is gone', !hist.some(r => r.value === '$O2'));
check('SO2 now counts 2 (merged)', (hist.find(r => r.value === 'SO2') || {}).count === 2);
check('stale $O2 hint dropped', db.prepare(`SELECT COUNT(*) c FROM supplier_hints WHERE hint_value='$O2'`).get().c === 0);

console.log('purgeFieldValue (remove SO3 entirely):');
const removed = learning.purgeFieldValue(db, { ...scope, value: 'SO3' });
check('reported >=1 row removed', removed >= 1);
hist = learning.getFieldValueHistory(db, scope);
check('SO3 is gone from history', !hist.some(r => r.value === 'SO3'));
check('SO2 still present', hist.some(r => r.value === 'SO2'));

console.log('guards:');
check('rename to same value is a no-op', learning.renameFieldValue(db, { ...scope, oldValue: 'SO2', newValue: 'SO2' }) === 0);
check('rename with empty newValue is a no-op', learning.renameFieldValue(db, { ...scope, oldValue: 'SO2', newValue: '' }) === 0);
check('purge with no value is a no-op', learning.purgeFieldValue(db, scope) === 0);

console.log('manual rename stays veto-free (Oracle T3, 2026-07-11):');
// The slip-fix PROPOSER (src/windows/shared/slipFix.js) carries an orientation veto that
// suppresses letter↔digit class-crossing renames it cannot locally justify. That veto must
// NEVER be "hardened" into this manual path: the 2026-07-11 inversion incident's own UNDO was
// five manual 0→O crossing renames toward the in-scope MINORITY (S0-66820→SO-66820, …). If
// renameFieldValue ever inherits the proposer's veto, the next inversion becomes un-undoable
// in-product. This pin fails the moment someone adds such a gate.
addDoc('S0-1', '2026-06-04');
check('manual class-crossing rename (S0-1 → SO-1) is accepted',
      learning.renameFieldValue(db, { ...scope, oldValue: 'S0-1', newValue: 'SO-1' }) >= 1);
hist = learning.getFieldValueHistory(db, scope);
check('renamed value visible in history as SO-1',
      hist.some(r => r.value === 'SO-1') && !hist.some(r => r.value === 'S0-1'));

console.log('getDocumentsForFieldValue (Learning-history "Open in Review"):');
// End state: SO2 is carried by doc 1 (display) AND doc 3 (renamed from $O2); SO3 was purged.
const so2docs = learning.getDocumentsForFieldValue(db, { ...scope, value: 'SO2' });
check('SO2 maps to its 2 source docs', so2docs.length === 2);
check('docs carry id + original_filename + confirmed_at',
      so2docs.every(d => d.id && d.original_filename && d.confirmed_at));
check('purged SO3 maps to no docs', learning.getDocumentsForFieldValue(db, { ...scope, value: 'SO3' }).length === 0);
check('empty value -> no docs', learning.getDocumentsForFieldValue(db, { ...scope, value: '' }).length === 0);
check('wrong-supplier scope -> no docs',
      learning.getDocumentsForFieldValue(db, { supplier_name: 'Other', document_type: 'worksheet', field_key: FK, value: 'SO2' }).length === 0);

db.close();
console.log(`\n${FAILS === 0 ? 'ALL PASS' : FAILS + ' FAILED'}`);
process.exit(FAILS ? 1 : 0);
