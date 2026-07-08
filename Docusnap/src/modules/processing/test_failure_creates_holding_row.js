/*
 * src/modules/processing/test_failure_creates_holding_row.js
 * ----------------------------------------------------------
 * Keystone test for the "stuck docs" feature (Slice 1): a FAILED extraction
 * must now persist a status='error' document row. Previously _handleFileMessage
 * returned on !success BEFORE any insert, so a failed doc left no DB trace at
 * all and could never be surfaced or reprocessed.
 *
 * Hermetic: in-memory SQLite with just the documents columns insert()/update()
 * touch — no OCR, no Python, no Electron app context. The failure path is pure
 * better-sqlite3, so this exercises exactly the new producer.
 *
 * Run with Electron-as-Node (better-sqlite3 is built for the Electron ABI):
 *   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron \
 *     src/modules/processing/test_failure_creates_holding_row.js
 */
'use strict';

const Database   = require('better-sqlite3');
const documents  = require('../../../database/modules/documents');
const processing = require('./handler');

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
const check = (name, cond) => {
  console.log(`  ${cond ? 'OK ' : 'BAD'}  ${name}`);
  if (!cond) failures++;
};
const noop = () => {};

// ── A failed file_done now persists a status='error' row ──────────────────────
processing.handleFileMessage(
  db,
  { type: 'file_done', success: false, error: 'boom: OCR engine crashed', original_filename: 'scan001.pdf' },
  'C:/watch', noop, null,
);

const rows = db.prepare("SELECT * FROM documents WHERE status = 'error'").all();
check('one status=error row was inserted', rows.length === 1);
check('original_filename captured', rows[0] && rows[0].original_filename === 'scan001.pdf');
check('folder_path captured',       rows[0] && rows[0].folder_path === 'C:/watch');
check('error_message captured',      rows[0] && rows[0].error_message === 'boom: OCR engine crashed');
check('getStuckCount() returns 1',   documents.getStuckCount(db) === 1);

// ── A failure missing the filename still records (defensive) ──────────────────
processing.handleFileMessage(
  db, { type: 'file_done', success: false, error: 'no name' }, 'C:/watch', noop, null,
);
check('failure without a filename still records', documents.getStuckCount(db) === 2);

// ── file_begin / non-file_done are ignored (no spurious rows) ─────────────────
processing.handleFileMessage(db, { type: 'file_begin', filename: 'x.pdf' }, 'C:/watch', noop, null);
processing.handleFileMessage(db, { type: 'log', text: 'hi' }, 'C:/watch', noop, null);
check('file_begin / log produce no rows', documents.getStuckCount(db) === 2);

if (failures) {
  console.log(`\n${failures} check(s) failed — the failure-row producer regressed.`);
  process.exit(1);
}
console.log('\nAll checks passed — failed docs persist as status=error.');
process.exit(0);
