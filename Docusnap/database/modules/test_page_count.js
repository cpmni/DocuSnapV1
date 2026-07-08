/*
 * database/modules/test_page_count.js
 * -----------------------------------
 * Regression test for documents.page_count (migration 37, 2026-06): a document's page
 * count is captured at import so the Review list can flag multi-page documents. Verifies
 * insert() stores it, update() can change it, and a missing page_count stores NULL.
 *
 * Hermetic: in-memory SQLite with just the documents columns insert()/update()/get()
 * touch. Run with Electron-as-Node (better-sqlite3 is built for the Electron ABI):
 *   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron database/modules/test_page_count.js
 */
'use strict';

const Database  = require('better-sqlite3');
const documents = require('./documents');

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_filename TEXT, folder_path TEXT, document_type_id INTEGER,
    supplier_name TEXT, overall_confidence INTEGER, status TEXT,
    template_id INTEGER, logo_phash TEXT, keyword_fingerprint TEXT, ocr_text TEXT,
    error_message TEXT, stored_filename TEXT, stored_path TEXT, doc_date TEXT,
    reference_number TEXT, confirmed_at TEXT, working_path TEXT,
    review_acknowledged_at TEXT, page_count INTEGER
  );
`);

let failures = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'}  ${label}`); if (!cond) failures++; };

// 1) insert WITH a page count → stored.
const a = documents.insert(db, { original_filename: 'multi.pdf', folder_path: 'C:/in', status: 'needs_review', page_count: 4 });
check('multi-page count stored on insert', documents.getById(db, a.lastInsertRowid).page_count === 4);

// 2) insert WITHOUT a page count → NULL (not 0, not a crash).
const b = documents.insert(db, { original_filename: 'one.pdf', folder_path: 'C:/in', status: 'needs_review' });
check('missing page_count stores NULL', documents.getById(db, b.lastInsertRowid).page_count === null);

// 3) update() can change page_count (reprocess path).
documents.update(db, b.lastInsertRowid, { page_count: 2 });
check('page_count updatable via update()', documents.getById(db, b.lastInsertRowid).page_count === 2);

if (failures) { console.log(`\n${failures} check(s) failed — page_count regressed.`); process.exit(1); }
console.log('\nAll checks passed — documents.page_count round-trips.');
