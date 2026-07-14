'use strict';
/*
 * test_field_candidates_persist.js — disambiguation-picker PERSISTENCE (G4).
 * Migration 48 adds extractions.candidates; insertExtractions persists the JSON; getWithExtractions
 * parses it back to an array; a field with no candidates round-trips as null (no throw). This is the
 * gate that proves the picker survives a queued doc being reopened from the DB (not just live).
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron database/modules/test_field_candidates_persist.js
 */
const path = require('path');
const Database = require('better-sqlite3');
const REPO = 'c:/GIT Projects/Docusnap';
const { runMigrations } = require(path.join(REPO, 'database', 'index.js'));
const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const documents = require(path.join(REPO, 'database', 'modules', 'documents.js'));

let fails = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'BAD ') + label); if (!cond) fails++; };

const db = new Database(':memory:');
runMigrations(db);

const cols = db.prepare('PRAGMA table_info(extractions)').all().map(c => c.name);
check('migration 48: extractions.candidates column exists', cols.includes('candidates'));

const dt = db.prepare("INSERT INTO document_types (name, slug) VALUES ('Sales Order','sales_order')").run();
const doc = db.prepare("INSERT INTO documents (document_type_id, original_filename, stored_filename, folder_path, status) VALUES (?, 'd.pdf', 'd.pdf', '', 'needs_review')")
              .run(dt.lastInsertRowid);
const docId = doc.lastInsertRowid;

const candArr = [
  { value: 'Fernbank Veterinary Clinic', box: null, source_label: 'beside the label', method: 'keyword', confidence: 78 },
  { value: 'Customer Site tee', box: { x_norm: 0.1, y_norm: 0.2, w_norm: 0.3, h_norm: 0.05 }, source_label: 'from the taught box', method: 'anchor_crop_relocated', confidence: 82 },
];
learning.insertExtractions(db, docId, [
  { field_key: 'customer_name', raw_value: 'Fernbank Veterinary Clinic', display_value: 'Fernbank Veterinary Clinic',
    confidence: 69, extraction_method: 'keyword', validation_note: 'note', candidates: JSON.stringify(candArr) },
  { field_key: 'order_date', raw_value: '01-01-2026', display_value: '01-01-2026',
    confidence: 90, extraction_method: 'keyword', validation_note: null },   // no candidates key → default-null spread, must not throw
]);

const got = documents.getWithExtractions(db, docId);
const cn = got.extractions.find(e => e.field_key === 'customer_name');
const od = got.extractions.find(e => e.field_key === 'order_date');
check('round-trip: customer_name.candidates parsed to an array of 2', Array.isArray(cn.candidates) && cn.candidates.length === 2);
check('round-trip: value + box preserved', cn.candidates[1].value === 'Customer Site tee' && cn.candidates[1].box.w_norm === 0.3);
check('round-trip: box=null candidate preserved', cn.candidates[0].box === null);
check('field WITHOUT candidates → null (no throw on the null default spread)', od.candidates == null);

console.log('\n' + (fails === 0 ? 'ALL PASS' : `${fails} FAILED`));
process.exit(fails ? 1 : 0);
