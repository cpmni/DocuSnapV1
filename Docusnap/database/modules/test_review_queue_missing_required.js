/*
 * database/modules/test_review_queue_missing_required.js
 * ------------------------------------------------------
 * Guards getReviewQueue's missing_required_labels signal (2026-07). The Review queue must
 * tell apart a row that "looks good" (high confidence, no flags) but is actually
 * UN-FILEABLE because a required field read EMPTY — otherwise it wears a green
 * "Looks good · 95%" while Confirm is blocked. The signal must mirror validateConfirm in
 * review/renderer.js: the blocking-required set is the assigned Date/Reference roles plus
 * any custom Required field, EXCLUDING the Document-Issuer identity (supplier_name /
 * customer_name), which is warn-only. Also confirms the additive change didn't disturb the
 * existing review_flag_count / below_threshold_count columns.
 *
 * Hermetic in-memory SQLite. Run with Electron-as-Node (better-sqlite3 ABI):
 *   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron database/modules/test_review_queue_missing_required.js
 */
'use strict';

const Database  = require('better-sqlite3');
const documents = require('./documents');

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_filename TEXT, document_type_id INTEGER, supplier_name TEXT,
    overall_confidence INTEGER, status TEXT, processed_at TEXT,
    doc_date TEXT, reference_number TEXT, page_count INTEGER
  );
  CREATE TABLE document_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT,
    ref_field_key TEXT, date_field_key TEXT
  );
  CREATE TABLE fields (
    id INTEGER PRIMARY KEY AUTOINCREMENT, document_type_id INTEGER, key TEXT,
    label TEXT, type TEXT, required INTEGER, enabled INTEGER, confidence_threshold INTEGER
  );
  CREATE TABLE extractions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT,
    raw_value TEXT, display_value TEXT, confidence INTEGER,
    validation_note TEXT, corrected_to TEXT
  );
`);

let failures = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'}  ${label}`); if (!cond) failures++; };

// Invoice type: Reference role = invoice_number, Date role = invoice_date.
db.prepare(`INSERT INTO document_types (id,name,slug,ref_field_key,date_field_key)
            VALUES (1,'Invoice','invoice','invoice_number','invoice_date')`).run();
const addField = (key, label, required = 0) =>
  db.prepare(`INSERT INTO fields (document_type_id,key,label,type,required,enabled)
              VALUES (1,?,?,?,?,1)`).run(key, label, 'text', required);
addField('supplier_name', 'Document Issuer', 1);   // identity — warn-only, NEVER a blocker (even required)
addField('invoice_number', 'Invoice No.',    0);   // Reference role
addField('invoice_date',   'Invoice Date',   0);   // Date role
addField('total_amount',   'Total',          0);   // not required

const addDoc = (fname, conf) =>
  db.prepare(`INSERT INTO documents (original_filename,document_type_id,supplier_name,overall_confidence,status,processed_at)
              VALUES (?,1,'City Office NI',?, 'needs_review', ?)`).run(fname, conf, new Date().toISOString()).lastInsertRowid;
const addExtraction = (docId, key, val, conf = 90, note = null, corr = null) =>
  db.prepare(`INSERT INTO extractions (document_id,field_key,display_value,raw_value,confidence,validation_note,corrected_to)
              VALUES (?,?,?,?,?,?,?)`).run(docId, key, val, val, conf, note, corr);

// Doc A: high confidence, NO flags, but the Reference (invoice_number) read EMPTY (no row).
const A = addDoc('cityoffice_a.pdf', 95);
addExtraction(A, 'supplier_name', 'City Office NI');
addExtraction(A, 'invoice_date', '15-12-2025');
addExtraction(A, 'total_amount', '101.28');

// Doc B: every required field filled → not blocked.
const B = addDoc('cityoffice_b.pdf', 95);
addExtraction(B, 'supplier_name', 'City Office NI');
addExtraction(B, 'invoice_number', '152574');
addExtraction(B, 'invoice_date', '15-12-2025');

// Doc C: identity (supplier_name) empty but roles filled → NOT a blocker (warn-only).
const C = addDoc('cityoffice_c.pdf', 95);
addExtraction(C, 'invoice_number', '152575');
addExtraction(C, 'invoice_date', '16-12-2025');

// Doc D: invoice_number present but WHITESPACE-only → still counts as empty.
const D = addDoc('cityoffice_d.pdf', 95);
addExtraction(D, 'invoice_number', '   ');
addExtraction(D, 'invoice_date', '17-12-2025');

const rows = documents.getReviewQueue(db);
const by = Object.fromEntries(rows.map(r => [r.original_filename, r]));

check('A: empty Reference role surfaced as a blocker',
      (by['cityoffice_a.pdf'].missing_required_labels || '') === 'Invoice No.');
check('B: all required filled → no blocker',
      !by['cityoffice_b.pdf'].missing_required_labels);
check('C: empty identity (Document Issuer) is NOT a blocker (warn-only, even when required)',
      !by['cityoffice_c.pdf'].missing_required_labels);
check('D: whitespace-only value counts as empty',
      (by['cityoffice_d.pdf'].missing_required_labels || '') === 'Invoice No.');
// The change is additive — the existing enrichment columns must still be present.
check('review_flag_count still present', typeof by['cityoffice_a.pdf'].review_flag_count === 'number');
check('below_threshold_count still present', typeof by['cityoffice_a.pdf'].below_threshold_count === 'number');

if (failures) { console.log(`\n${failures} check(s) failed — missing_required_labels regressed.`); process.exit(1); }
console.log('\nAll checks passed — getReviewQueue.missing_required_labels mirrors the confirm gate.');
