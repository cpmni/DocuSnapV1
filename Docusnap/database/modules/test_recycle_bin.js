/*
 * database/modules/test_recycle_bin.js
 * Soft-delete (recycle bin) round-trip: softDelete → bin → restore / purge.
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron database/modules/test_recycle_bin.js
 */
'use strict';
const Database  = require('better-sqlite3');
const documents = require('./documents');

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE document_types (id INTEGER PRIMARY KEY, name TEXT, slug TEXT);
  CREATE TABLE documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_filename TEXT, folder_path TEXT, document_type_id INTEGER,
    supplier_name TEXT, overall_confidence INTEGER, status TEXT,
    -- logo_detail_hash (migration 47) + detected_type_name are written by documents.insert; a
    -- fixture missing them fails at INSERT, which is what made this suite red from 2026-08-11.
    template_id INTEGER, logo_phash TEXT, logo_detail_hash TEXT, keyword_fingerprint TEXT, ocr_text TEXT,
    error_message TEXT, stored_filename TEXT, stored_path TEXT, doc_date TEXT,
    reference_number TEXT, confirmed_at TEXT, working_path TEXT, detected_type_name TEXT,
    review_acknowledged_at TEXT, page_count INTEGER, deleted_at TEXT
  );
`);
let fail = 0;
const check = (l, c) => { console.log(`  ${c ? 'OK ' : 'BAD'}  ${l}`); if (!c) fail++; };

const filed = documents.insert(db, { original_filename: 'a.pdf', folder_path: 'C:/o', status: 'confirmed' });
db.prepare("UPDATE documents SET confirmed_at = ? WHERE id = ?").run('2026-06-28T10:00:00Z', filed.lastInsertRowid);
const review = documents.insert(db, { original_filename: 'b.pdf', folder_path: 'C:/o', status: 'needs_review' });

// Soft-delete both → recycle bin
documents.softDelete(db, filed.lastInsertRowid);
documents.softDelete(db, review.lastInsertRowid);
check('both in the bin', documents.getDeletedCount(db) === 2);
check('getDeletedQueue lists them', documents.getDeletedQueue(db).length === 2);
check('deleted doc has deleted_at', !!documents.getById(db, filed.lastInsertRowid).deleted_at);
check('soft-deleted, NOT removed', !!documents.getById(db, filed.lastInsertRowid));

// Restore: a filed doc → confirmed, a review doc → needs_review
documents.restoreDeleted(db, filed.lastInsertRowid);
documents.restoreDeleted(db, review.lastInsertRowid);
check('filed doc restored to confirmed', documents.getById(db, filed.lastInsertRowid).status === 'confirmed');
check('review doc restored to needs_review', documents.getById(db, review.lastInsertRowid).status === 'needs_review');
check('restore clears deleted_at', documents.getById(db, filed.lastInsertRowid).deleted_at === null);
check('bin empty after restore', documents.getDeletedCount(db) === 0);

// Purge (permanent): soft-delete then deleteDoc removes the row
documents.softDelete(db, review.lastInsertRowid);
documents.deleteDoc(db, review.lastInsertRowid);
check('purge removes the row', !documents.getById(db, review.lastInsertRowid));

if (fail) { console.log(`\n${fail} check(s) failed.`); process.exit(1); }
console.log('\nAll recycle-bin checks passed.');
