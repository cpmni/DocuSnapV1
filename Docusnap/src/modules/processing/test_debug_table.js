'use strict';
/*
 * test_debug_table.js — pins the SFDEV bulk debug-table builder + saver (dev-only tool).
 * THE SEAMS THIS PINS:
 *   1. The grid is scoped to the REVIEW QUEUE (needs_review + deferred) — a confirmed doc
 *      never leaks in (it would drown the detection-triage signal).
 *   2. Columns are the STRUCTURAL-FIRST, de-duped union of the present types' fields — a
 *      shared structural field (supplier_name) appears exactly once, ahead of body fields,
 *      and a type-specific field still gets its own column.
 *   3. A cell prefers display_value over raw_value and carries confidence + method.
 *   4. _saveDebugTable copies ONLY a slice path that resolves INSIDE devSliceDir (the same
 *      path-validation as dev-get-slice) — a path outside it is silently dropped, never read.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/processing/test_debug_table.js
 */
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const Database = require('better-sqlite3');
const { runMigrations } = require('../../../database/index');
const { _buildDebugTable, _saveDebugTable } = require('./handler.js');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

function seed() {
  const db = new Database(':memory:');
  runMigrations(db);
  // Two types. supplier_name is the shared structural issuer; each carries its own ref/date roles.
  db.prepare(`INSERT INTO document_types (id, name, slug, built_in, ref_field_key, date_field_key)
              VALUES (1,'Invoice','invoice',1,'invoice_number','invoice_date')`).run();
  db.prepare(`INSERT INTO document_types (id, name, slug, built_in, ref_field_key, date_field_key)
              VALUES (2,'Credit Note','credit_note',0,'credit_note_number','credit_note_date')`).run();
  const fld = db.prepare(`INSERT INTO fields (document_type_id, key, label, type, required, enabled, sort_order)
                          VALUES (?,?,?,?,?,1,?)`);
  // Invoice: issuer (structural), invoice_number (structural ref), invoice_date (structural), total_amount (body)
  fld.run(1, 'supplier_name', 'Document Issuer', 'text', 1, 1);
  fld.run(1, 'invoice_number', 'Invoice No', 'text', 1, 2);
  fld.run(1, 'invoice_date', 'Invoice Date', 'date', 1, 3);
  fld.run(1, 'total_amount', 'Total', 'currency', 0, 4);
  // Credit Note: shares supplier_name; its own ref/date + a unique body field
  fld.run(2, 'supplier_name', 'Document Issuer', 'text', 1, 1);
  fld.run(2, 'credit_note_number', 'Credit Note No', 'text', 1, 2);
  fld.run(2, 'credit_note_date', 'Credit Date', 'date', 1, 3);
  fld.run(2, 'reason', 'Reason', 'text', 0, 4);

  const mkDoc = (id, type, status, fn) => db.prepare(
    `INSERT INTO documents (id, original_filename, folder_path, document_type_id, status, supplier_name, overall_confidence)
     VALUES (?,?,?,?,?,?,?)`).run(id, fn, '/in', type, status, 'Castellan', 90);
  mkDoc(1, 1, 'needs_review', 'inv1.pdf');
  mkDoc(2, 2, 'deferred', 'cn1.pdf');
  mkDoc(3, 1, 'confirmed', 'inv2.pdf');    // MUST NOT appear (confirmed)

  const ex = db.prepare(
    `INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method)
     VALUES (?,?,?,?,?,?)`);
  ex.run(1, 'invoice_number', 'INV-001', 'INV-001', 95, 'keyword');
  ex.run(1, 'invoice_date', '01072025', '01-07-2025', 88, 'template_mapping');   // display_value preferred
  ex.run(2, 'credit_note_number', 'CN-9', 'CN-9', 70, 'anchor_crop');
  ex.run(2, 'reason', 'return', 'return', 60, 'keyword');
  ex.run(3, 'invoice_number', 'INV-777', 'INV-777', 99, 'keyword');              // confirmed → excluded
  return db;
}

// ── Builder ──────────────────────────────────────────────────────────────────
const db = seed();
const t = _buildDebugTable(db);

check('only the review queue is included (needs_review + deferred, NOT confirmed) → 2 rows',
      t.rows.length === 2 && !t.rows.some(r => r.filename === 'inv2.pdf'));
check('rows are ordered by id (inv1 then cn1)',
      t.rows[0].filename === 'inv1.pdf' && t.rows[1].filename === 'cn1.pdf');

const idx = (k) => t.columns.indexOf(k);
check('supplier_name (shared structural) appears exactly ONCE',
      t.columns.filter(c => c === 'supplier_name').length === 1);
check('structural fields precede body fields (supplier_name before total_amount / reason)',
      idx('supplier_name') < idx('total_amount') && idx('supplier_name') < idx('reason'));
check('the invoice ref/date structural columns are present and before the body total',
      idx('invoice_number') >= 0 && idx('invoice_date') >= 0 && idx('invoice_number') < idx('total_amount'));
check('the credit-note-only column (credit_note_number) is in the union',
      idx('credit_note_number') >= 0);
check('column labels are surfaced (invoice_number → "Invoice No")',
      t.labels.invoice_number === 'Invoice No');

const inv = t.rows[0].fields;
check('a cell prefers display_value over raw_value (invoice_date → 01-07-2025, not 01072025)',
      inv.invoice_date.value === '01-07-2025');
check('a cell carries confidence + method',
      inv.invoice_number.confidence === 95 && inv.invoice_number.method === 'keyword');
check('a queue doc surfaces its supplier + type on the row',
      t.rows[0].supplier === 'Castellan' && t.rows[0].typeName === 'Invoice');

// ── Saver (path-validated slice copy) ──────────────────────────────────────────
const sliceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-dbgslice-'));
const outBase  = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-dbgout-'));
const goodSlice = path.join(sliceDir, 'good.png');
fs.writeFileSync(goodSlice, 'PNGDATA');
const outsideSlice = path.join(outBase, 'evil.png');       // OUTSIDE devSliceDir
fs.writeFileSync(outsideSlice, 'EVIL');

// Redirect the output dir into a temp base by faking a packaged app (getPath('userData') → outBase).
const electron = require('electron');
const _origApp = electron.app;
const fakeApp = { isPackaged: true, getPath: (k) => outBase };
try { Object.defineProperty(electron, 'app', { value: fakeApp, configurable: true }); } catch {}

const ctx = { path, fs, devSliceDir: sliceDir };
const payload = { rows: [
  { id: 1, filename: 'inv1.pdf', supplier: 'Castellan', typeName: 'Invoice', typeSlug: 'invoice', status: 'needs_review',
    fields: {
      invoice_number: { value: 'INV-001', method: 'keyword', confidence: 95, wrong: true, correct: 'INV-002', slicePath: goodSlice },
      invoice_date:   { value: '01-07-2025', method: 'template_mapping', confidence: 88, wrong: false, correct: null, slicePath: outsideSlice },
    } },
] };
const res = _saveDebugTable(ctx, payload);
try { Object.defineProperty(electron, 'app', { value: _origApp, configurable: true }); } catch {}

check('save reports ok + doc_count + one flag', res.ok && res.doc_count === 1 && res.flags === 1);
check('save copied ONLY the in-devSliceDir slice (1, not 2)', res.slices === 1);
check('debug_values.json was written under the Debug dir', fs.existsSync(res.file));

const json = JSON.parse(fs.readFileSync(res.file, 'utf8'));
const f = json.rows[0].fields;
check('the flagged cell records wrong + correct value', f.invoice_number.wrong === true && f.invoice_number.correct === 'INV-002');
check('the good slice was copied to slices/<id>__<field>.png', f.invoice_number.slice === path.join('slices', '1__invoice_number.png')
      && fs.existsSync(path.join(path.dirname(res.file), f.invoice_number.slice)));
check('the OUTSIDE-devSliceDir slice was DROPPED (path traversal defence)', f.invoice_date.slice === null);

// cleanup
try { fs.rmSync(sliceDir, { recursive: true, force: true }); } catch {}
try { fs.rmSync(outBase, { recursive: true, force: true }); } catch {}

console.log(fails ? `\n${fails} FAILED` : '\nAll debug-table pins passed');
process.exit(fails ? 1 : 0);
