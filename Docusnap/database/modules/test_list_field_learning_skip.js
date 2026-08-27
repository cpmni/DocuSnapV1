'use strict';
/*
 * test_list_field_learning_skip.js — LIST ownership at the hint writers (Oracle cond 7, 2026-08-27).
 *
 * A confirmed or corrected LIST value ('A1; C3') is THIS DOCUMENT's serial set. Written as a
 * supplier hint it would be replanted onto the next document of the sender (hints FILL EMPTY FIELDS
 * at usage>=2) — a wrong list, silently. Both writers (saveCorrections + replantConfirmHints) skip a
 * field the type declares as 'list'; the per-document correction row still lands, and the scalar
 * hint path is untouched (positive control — feedback_vacuous_pin_traps).
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe database/modules/test_list_field_learning_skip.js
 */
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const { runMigrations } = require('../index');
const document_types = require('./document_types');
const documents = require('./documents');
const learning = require('./learning');

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };

const db = new Database(':memory:');
runMigrations(db);

const tid = db.prepare("INSERT INTO document_types (name, slug, built_in) VALUES ('Service Worksheet', 'service_worksheet', 0)").run().lastInsertRowid;
document_types.addField(db, { document_type_id: tid, key: 'serial_number', label: 'Serial Number', type: 'list' });
document_types.addField(db, { document_type_id: tid, key: 'job_ref',       label: 'Job Ref',       type: 'text' });
const ins = documents.insert(db, {
  original_filename: 'ws.pdf', folder_path: 'C:/in', document_type_id: tid, supplier_name: 'Castellan',
  overall_confidence: 90, status: 'confirmed', template_id: null, logo_phash: null, logo_detail_hash: null,
  keyword_fingerprint: null, ocr_text: 'Serial No: A1\nSerial No: B2\nSerial No: C3\nJob Ref: JR-77\n', page_count: 1, detected_type_name: null,
});
const docId = (ins && ins.lastInsertRowid != null) ? ins.lastInsertRowid : ins;
db.prepare(`INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method)
            VALUES (?, 'serial_number', 'A1; B2; C3', 'A1; B2; C3', 85, 'keyword_list')`).run(docId);
db.prepare(`INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method)
            VALUES (?, 'job_ref', 'JR-77', 'JR-77', 90, 'keyword')`).run(docId);

const hints = () => db.prepare('SELECT supplier_name, field_key, hint_value FROM supplier_hints ORDER BY field_key, supplier_name').all();

console.log('\n1. saveCorrections — a corrected list (one pill removed) is per-document, never a hint');
learning.saveCorrections(db, docId,
  { serial_number: { original_value: 'A1; B2; C3', corrected_value: 'A1; C3' } },
  'Castellan', 'service_worksheet',
  { serial_number: 'A1; C3', job_ref: 'JR-77' }, [], {});
let h = hints();
check('no supplier_hints row for the LIST field (scoped or __global__)', !h.some(r => r.field_key === 'serial_number'));
check('the scalar field still hints as before (positive control)', h.some(r => r.field_key === 'job_ref' && r.hint_value === 'JR-77' && r.supplier_name === 'Castellan'));
const corr = db.prepare("SELECT corrected_value FROM corrections WHERE document_id = ? AND field_key = 'serial_number'").all(docId);
check('the per-document correction row still lands (Undo / history / the stored extraction stay honest)', corr.length === 1 && corr[0].corrected_value === 'A1; C3');
const ext = db.prepare("SELECT display_value, was_corrected FROM extractions WHERE document_id = ? AND field_key = 'serial_number'").get(docId);
check('the stored extraction reflects the corrected list', ext && ext.display_value === 'A1; C3' && ext.was_corrected === 1);

console.log('\n2. replantConfirmHints — the human-confirm replant skips the list field too');
db.prepare('DELETE FROM supplier_hints').run();
learning.replantConfirmHints(db, docId);
h = hints();
check('replant: no hint for the LIST field', !h.some(r => r.field_key === 'serial_number'));
check('replant: the scalar field is replanted (positive control)', h.some(r => r.field_key === 'job_ref' && r.hint_value === 'JR-77'));

console.log('\n3. the classifier is the field TYPE on the slug-keyed type — a text field named like a list is not one');
document_types.addField(db, { document_type_id: tid, key: 'serial_list', label: 'Serial list', type: 'text' });
db.prepare('DELETE FROM supplier_hints').run();
learning.saveCorrections(db, docId, {}, 'Castellan', 'service_worksheet', { serial_list: 'S-1; S-2' }, [], {});
check('a TEXT field whose value happens to contain ";" still hints (only the declared list type is skipped)',
      hints().some(r => r.field_key === 'serial_list'));
db.prepare('DELETE FROM supplier_hints').run();
learning.saveCorrections(db, docId, {}, 'Castellan', 'no_such_type', { serial_number: 'A1; C3' }, [], {});
check('an unknown type slug fails OPEN (hint written as before — the predicate never throws)',
      hints().some(r => r.field_key === 'serial_number'));

db.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
