'use strict';
/*
 * test_document_barcodes.js — the BARCODE INVENTORY store (mig 91 `document_barcodes`; barry → gary
 * design 2026-08-26; DARK `barcode_inventory`). Pins: the migration shape; replace is idempotent and
 * deduped; `[]` CLEARS while an absent key must be honoured by the CALLER (tri-state — pinned at the
 * handler source); cascade on document delete; search-by-value is separator-blind.
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron.cmd database/modules/test_document_barcodes.js
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { runMigrations } = require('../index');
const barcodes = require('./barcodes');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

function fresh() { const db = new Database(':memory:'); db.pragma('foreign_keys = ON'); runMigrations(db); return db; }

const db = fresh();
const cols = db.prepare("SELECT name FROM pragma_table_info('document_barcodes')").all().map(r => r.name);
check('mig 91: document_barcodes exists with the expected columns',
      ['document_id', 'page', 'symbology', 'value', 'x_norm', 'y_norm', 'w_norm', 'h_norm', 'orientation', 'content_type'].every(c => cols.includes(c)));
check('mig 91: value + document_id indexes exist',
      db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND tbl_name='document_barcodes'").get().n >= 2);

db.prepare("INSERT INTO documents (id, original_filename, folder_path, status, ocr_text) VALUES (1,'a.pdf','C:/in','needs_review','Invoice 1001 no bars here')").run();
db.prepare("INSERT INTO documents (id, original_filename, folder_path, status, ocr_text) VALUES (2,'b.pdf','C:/in','needs_review','other')").run();

const ROWS = [
  { page: 0, symbology: 'Code128', value: 'INV-20260826', x_norm: 0.1, y_norm: 0.2, w_norm: 0.3, h_norm: 0.05, orientation: 0, content_type: 'Text' },
  { page: 0, symbology: 'QRCode', value: 'https://example.com/pay/123', x_norm: 0.6, y_norm: 0.2, w_norm: 0.1, h_norm: 0.1, orientation: 0, content_type: 'Text' },
  { page: 0, symbology: 'Code128', value: 'INV-20260826' },   // duplicate → one row
  { page: 1, symbology: 'Code128', value: 'INV-20260826' },   // same value, other page → its own row
  { value: '' }, null, 'garbage',                             // ignored
];
check('replace writes the distinct (page, symbology, value) rows', barcodes.replaceDocumentBarcodes(db, 1, ROWS) === 3);
check('getForDocument returns them in page order', barcodes.getForDocument(db, 1).map(r => `${r.page}:${r.value}`).join('|') === '0:INV-20260826|0:https://example.com/pay/123|1:INV-20260826');
check('replace is idempotent (same rows again → still 3)', barcodes.replaceDocumentBarcodes(db, 1, ROWS) === 3 && barcodes.getForDocument(db, 1).length === 3);
check('search: exact value finds the document', barcodes.findDocumentIds(db, 'INV-20260826').includes(1));
check('search: separator-blind ("inv 20260826" finds "INV-20260826")', barcodes.findDocumentIds(db, 'inv 20260826').includes(1));
check('search: a substring of the QR URL finds it', barcodes.findDocumentIds(db, 'pay/123').includes(1));
check('search: unrelated value finds nothing', barcodes.findDocumentIds(db, 'ZZZ-999').length === 0 && barcodes.findDocumentIds(db, '').length === 0);
// The search window's full-text OR-chain reaches the decode: a value printed ONLY as bars (absent
// from ocr_text and every field) finds its document; separator-blind through the same REPLACE.
const documents = require('./documents');
check('documents.search fullText finds a bar-only value', documents.search(db, { status: 'needs_review', fullText: 'INV-20260826' }).some(d => d.id === 1));
check('documents.search fullText: an unrelated value still finds nothing', documents.search(db, { status: 'needs_review', fullText: 'NOPE-404' }).length === 0);
check('[] CLEARS the rows (rendered, nothing found)', barcodes.replaceDocumentBarcodes(db, 1, []) === 0 && barcodes.getForDocument(db, 1).length === 0);
barcodes.replaceDocumentBarcodes(db, 2, ROWS.slice(0, 1));
db.prepare('DELETE FROM documents WHERE id = 2').run();
check('cascade: deleting the document removes its barcode rows', barcodes.getForDocument(db, 2).length === 0);

// Column-tolerant on a DB without the table
const bare = new Database(':memory:');
check('no table → replace 0 / get [] / find [] (never throws)',
      barcodes.replaceDocumentBarcodes(bare, 1, ROWS) === 0 && barcodes.getForDocument(bare, 1).length === 0 && barcodes.findDocumentIds(bare, 'x').length === 0);

// SOURCE CONTRACT — the tri-state at both persist doors (the handler must only replace when the emit
// CARRIED the key; an absent key keeps a document's rows), and the reprocess replace sits INSIDE the
// row transaction.
const handler = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'modules', 'processing', 'handler.js'), 'utf8').replace(/\r\n/g, '\n');
check("import door: hasOwnProperty(msg, 'barcodes') guards the replace",
      /hasOwnProperty\.call\(msg \|\| \{\}, 'barcodes'\)[\s\S]{0,200}replaceDocumentBarcodes\(db, docId, msg\.barcodes\)/.test(handler));
check("reprocess door: hasOwnProperty(result, 'barcodes') → _replaceBarcodes inside BOTH transactions",
      /hasOwnProperty\.call\(result \|\| \{\}, 'barcodes'\)/.test(handler)
      && (handler.match(/learning\.insertExtractions\(db, docId, mergedRows\);\n\s+_replaceBarcodes\(\);/g) || []).length === 2);
// The Python emit's tri-state (absent when no decode ran) — pinned at its source too.
const pd = fs.readFileSync(path.join(__dirname, '..', '..', 'python_backend', 'process_docs.py'), 'utf8');
check('process_docs emits "barcodes" only when the inventory is armed AND a decode ran (_bc is not None)',
      /\*\*\(\{"barcodes": _bc\} if \(os\.environ\.get\("BARCODE_INVENTORY", "0"\) != "0" and _bc is not None\) else \{\}\)/.test(pd));

console.log(fails ? `\n${fails} FAILED` : '\nAll document_barcodes checks passed');
process.exit(fails ? 1 : 0);
