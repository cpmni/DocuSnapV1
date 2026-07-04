'use strict';
/**
 * test_rename_supplier.js
 * Guards learning.renameSupplier / getSupplierScopeCounts — the Learning-Recovery
 * "rename a supplier identity everywhere" backend. The per-field learning-history tools
 * can't repair the identity field (they are scoped BY supplier); this rewrites that scope
 * key across documents/hints/anchors/logos/corrections + the stored identity value.
 *
 * Run with Electron-as-Node (native better-sqlite3 ABI):
 *   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron database/modules/test_rename_supplier.js
 */
const path = require('path');
const Database = require(path.join(__dirname, '..', '..', 'node_modules', 'better-sqlite3'));
const learning = require('./learning');

let FAILS = 0;
const check = (label, cond) => { if (!cond) FAILS++; console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); };

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE documents (id INTEGER PRIMARY KEY, supplier_name TEXT, status TEXT);
  CREATE TABLE extractions (id INTEGER PRIMARY KEY, document_id INTEGER, field_key TEXT, raw_value TEXT, display_value TEXT);
  CREATE TABLE corrections (id INTEGER PRIMARY KEY, document_id INTEGER, field_key TEXT, corrected_value TEXT, supplier_name TEXT, document_type TEXT);
  CREATE TABLE supplier_hints (id INTEGER PRIMARY KEY, supplier_name TEXT, document_type TEXT, field_key TEXT, hint_value TEXT, usage_count INTEGER,
    UNIQUE(supplier_name, document_type, field_key, hint_value));
  CREATE TABLE field_anchors (id INTEGER PRIMARY KEY, supplier_name TEXT, document_type TEXT, field_key TEXT, anchor_label TEXT, direction TEXT,
    UNIQUE(supplier_name, document_type, field_key, anchor_label, direction));
  CREATE TABLE logo_fingerprints (id INTEGER PRIMARY KEY, supplier_name TEXT, phash TEXT, ahash TEXT);
`);

const OLD = 'Profile Construction ACME Inc', NEW = 'Profile Construction';

// Two docs under the merged identity: one confirmed, one needs_review, each with the identity
// stored as the supplier_name field value + an unrelated field.
for (const [id, st] of [[1, 'confirmed'], [2, 'needs_review']]) {
  db.prepare(`INSERT INTO documents (id, supplier_name, status) VALUES (?,?,?)`).run(id, OLD, st);
  db.prepare(`INSERT INTO extractions (document_id, field_key, raw_value, display_value) VALUES (?,?,?,?)`).run(id, 'supplier_name', OLD, OLD);
  db.prepare(`INSERT INTO extractions (document_id, field_key, raw_value, display_value) VALUES (?,?,?,?)`).run(id, 'invoice_number', '100' + id, '100' + id);
}
// A doc that legitimately belongs to a DIFFERENT supplier — must be untouched.
db.prepare(`INSERT INTO documents (id, supplier_name, status) VALUES (9,'Other Co','confirmed')`).run();
db.prepare(`INSERT INTO extractions (document_id, field_key, raw_value, display_value) VALUES (9,'supplier_name','Other Co','Other Co')`).run();

db.prepare(`INSERT INTO supplier_hints (supplier_name, document_type, field_key, hint_value, usage_count) VALUES (?,?,?,?,4)`).run(OLD, 'invoice', 'invoice_number', '1001');
// A hint that ALREADY exists under the NEW name with the SAME (doc_type, field, value) — the
// rename must MERGE (not crash on the UNIQUE constraint): the old duplicate is dropped.
db.prepare(`INSERT INTO supplier_hints (supplier_name, document_type, field_key, hint_value, usage_count) VALUES (?,?,?,?,9)`).run(NEW, 'invoice', 'invoice_number', '1001');
db.prepare(`INSERT INTO supplier_hints (supplier_name, document_type, field_key, hint_value, usage_count) VALUES (?,?,?,?,2)`).run(OLD, 'invoice', 'invoice_number', '1002');

db.prepare(`INSERT INTO field_anchors (supplier_name, document_type, field_key, anchor_label, direction) VALUES (?,?,?,?,?)`).run(OLD, 'invoice', 'total', 'Total', 'right');
db.prepare(`INSERT INTO logo_fingerprints (supplier_name, phash, ahash) VALUES (?,?,?)`).run(OLD, 'abc', 'def');
db.prepare(`INSERT INTO corrections (document_id, field_key, corrected_value, supplier_name, document_type) VALUES (1,'supplier_name',?,?, 'invoice')`).run(OLD, OLD);

console.log('getSupplierScopeCounts (before):');
const before = learning.getSupplierScopeCounts(db, OLD);
check('documents=2', before.documents === 2);
check('supplier_hints=2 (old-name rows)', before.supplier_hints === 2);
check('field_anchors=1', before.field_anchors === 1);
check('logo_fingerprints=1', before.logo_fingerprints === 1);
check('corrections=1', before.corrections === 1);

console.log('renameSupplier (merged identity -> corrected):');
let res;
try { res = learning.renameSupplier(db, { oldName: OLD, newName: NEW }); check('did not throw on the hint UNIQUE collision', true); }
catch (e) { check('did not throw on the hint UNIQUE collision', false); console.log('   ', e.message); }

check('nothing left under the OLD identity (documents)', db.prepare(`SELECT COUNT(*) n FROM documents WHERE supplier_name=?`).get(OLD).n === 0);
check('nothing left under the OLD identity (hints)', db.prepare(`SELECT COUNT(*) n FROM supplier_hints WHERE supplier_name=?`).get(OLD).n === 0);
check('nothing left under the OLD identity (anchors)', db.prepare(`SELECT COUNT(*) n FROM field_anchors WHERE supplier_name=?`).get(OLD).n === 0);
check('nothing left under the OLD identity (logos)', db.prepare(`SELECT COUNT(*) n FROM logo_fingerprints WHERE supplier_name=?`).get(OLD).n === 0);
check('nothing left under the OLD identity (corrections)', db.prepare(`SELECT COUNT(*) n FROM corrections WHERE supplier_name=?`).get(OLD).n === 0);

check('documents now under NEW identity (2)', db.prepare(`SELECT COUNT(*) n FROM documents WHERE supplier_name=?`).get(NEW).n === 2);
check('collision MERGED: one 1001 hint under NEW (not duplicated)',
  db.prepare(`SELECT COUNT(*) n FROM supplier_hints WHERE supplier_name=? AND hint_value='1001'`).get(NEW).n === 1);
check('non-colliding 1002 hint renamed to NEW',
  db.prepare(`SELECT COUNT(*) n FROM supplier_hints WHERE supplier_name=? AND hint_value='1002'`).get(NEW).n === 1);
check('anchor + logo now under NEW',
  db.prepare(`SELECT COUNT(*) n FROM field_anchors WHERE supplier_name=?`).get(NEW).n === 1 &&
  db.prepare(`SELECT COUNT(*) n FROM logo_fingerprints WHERE supplier_name=?`).get(NEW).n === 1);

console.log('stored identity VALUE updated:');
check('supplier_name field value now = NEW on both docs',
  db.prepare(`SELECT COUNT(*) n FROM extractions WHERE field_key='supplier_name' AND display_value=?`).get(NEW).n === 2);
check('no supplier_name field value still = OLD',
  db.prepare(`SELECT COUNT(*) n FROM extractions WHERE field_key='supplier_name' AND display_value=?`).get(OLD).n === 0);
check('correction identity value updated to NEW',
  db.prepare(`SELECT COUNT(*) n FROM corrections WHERE field_key='supplier_name' AND corrected_value=?`).get(NEW).n === 1);

console.log('unrelated data untouched:');
check("'Other Co' document untouched", db.prepare(`SELECT COUNT(*) n FROM documents WHERE supplier_name='Other Co'`).get().n === 1);
check("'Other Co' identity value untouched", db.prepare(`SELECT COUNT(*) n FROM extractions WHERE field_key='supplier_name' AND display_value='Other Co'`).get().n === 1);
check('unrelated invoice_number extractions untouched (2)',
  db.prepare(`SELECT COUNT(*) n FROM extractions WHERE field_key='invoice_number'`).get().n === 2);

console.log('return payload + no-ops:');
check('reports before/after scope counts', res && res.before && res.after && res.after.documents === 2);
check('same old==new is a no-op', learning.renameSupplier(db, { oldName: NEW, newName: NEW }).renamed === 0);
check('empty names are a no-op', learning.renameSupplier(db, { oldName: '', newName: 'X' }).renamed === 0);

console.log(FAILS ? `\n${FAILS} FAILED` : '\nAll renameSupplier checks passed.');
process.exit(FAILS ? 1 : 0);
