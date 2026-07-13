#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_reprocess_type_flip.js
 * --------------------------------------------
 * Guards the reprocess TYPE-FLIP persistence (Oracle conditions 3+4, 2026-07-09):
 * when a reprocess CHANGES a doc's type (the machine-authority title override, or a
 * live template match resolving differently), the old type's stale extraction rows
 * must not survive (Review hides them but the trust gate / auto-file READ them), the
 * flip must carry an explanation note — and that note must be LOAD-BEARING: the last
 * section proves a flipped 100% doc auto-files if (and only if) the note is removed,
 * so a future dev deleting the note-planting re-opens a real silent-file hole and
 * this test goes red.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_reprocess_type_flip.js
 */

const Database = require('better-sqlite3');
const path     = require('path');
const { _mergeReprocessRows: merge } = require(path.join(__dirname, '..', '..', 'src', 'modules', 'processing', 'handler.js'));
const trust    = require('./trust');

let fails = 0;
function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; return cond; }
function section(t) { console.log(`\n${t}`); }

const row = (field_key, display_value, extra = {}) => ({
  field_key, raw_value: display_value, display_value,
  confidence: 90, extraction_method: 'keyword', validation_note: null, corrected_to: null, ...extra,
});

// ── 1. Non-flip merge is byte-identical to the legacy behaviour ────────────────
section('Non-flip merge (flip=null) — legacy behaviour byte-identical:');
{
  const existing = [row('invoice_number', 'INV-1', { validation_note: 'old note' }),
                    row('old_only', 'KEEPME'),
                    row('invoice_date', '01-01-2026')];
  const fresh    = [row('invoice_number', null),          // empty new read → backfilled from existing
                    row('invoice_date', '02-01-2026')];   // new value wins
  const out = merge(existing, fresh, null);
  const by  = Object.fromEntries(out.map(r => [r.field_key, r]));
  check('empty new read backfilled from existing (kept_existing)', by.invoice_number.display_value === 'INV-1');
  check('... including its validation_note', by.invoice_number.validation_note === 'old note');
  check('new value wins when present (used_new)', by.invoice_date.display_value === '02-01-2026');
  check('old-only valued row carried forward', by.old_only && by.old_only.display_value === 'KEEPME');
  check('no note planted anywhere without a flip', out.every(r => r.field_key === 'invoice_number' ? true : !r.validation_note));
}

// ── 2. Flip merge: stale old-type rows dropped + note planted ──────────────────
section('Flip merge — stale wrong-type rows dropped, note planted on the ref field:');
{
  // sales_order → worksheet: old rows carry sales_order fields; new type's field set
  // is the worksheet's. Shared key 'customer' must still merge normally.
  const existing = [row('sales_order_number', 'WS489770'),
                    row('order_date', '04-06-2026'),
                    row('customer_name', 'Beaumont Care Homes Ltd'),
                    row('customer', 'Beaumont Care Homes Ltd')];
  const fresh    = [row('reference_number', 'WS489770'),
                    row('date', '04-06-2026'),
                    row('supplier_name', 'Ashford Wholesale'),
                    row('customer', null)];               // empty new read of a SHARED key
  const flip = {
    newTypeKeys: new Set(['reference_number', 'date', 'supplier_name', 'customer']),
    refKey: 'reference_number',
    noteText: "Document type changed from 'Sales Order' to 'Worksheet' on reprocess — please check the fields.",
  };
  const traces = [];
  const out = merge(existing, fresh, flip, (f, d) => traces.push(`${d}:${f}`));
  const keys = new Set(out.map(r => r.field_key));
  check('stale sales_order_number dropped', !keys.has('sales_order_number'));
  check('stale order_date dropped', !keys.has('order_date'));
  check('stale customer_name dropped', !keys.has('customer_name'));
  check('drop decisions traced', traces.includes('dropped_stale_type:sales_order_number'));
  const by = Object.fromEntries(out.map(r => [r.field_key, r]));
  check('shared key still backfills across the flip', by.customer.display_value === 'Beaumont Care Homes Ltd');
  check('note planted on the NEW type ref field', String(by.reference_number.validation_note || '').includes('Document type changed'));
  check('note NOT sprayed on other fields', !by.date.validation_note && !by.supplier_name.validation_note);
}
{
  // Ref field missing from the merged rows → falls back to the first VALUED row.
  const out = merge([], [row('date', '04-06-2026')], {
    newTypeKeys: new Set(['date']), refKey: 'reference_number', noteText: 'FLIPNOTE',
  });
  check('fallback target: first valued row when ref field absent', out[0].validation_note === 'FLIPNOTE');
}
{
  // A pre-existing note on the target row is PRESERVED (flip note prepends).
  const out = merge([], [row('reference_number', 'X', { validation_note: 'engine note' })], {
    newTypeKeys: new Set(['reference_number']), refKey: 'reference_number', noteText: 'FLIPNOTE.',
  });
  check('existing note preserved behind the flip note', out[0].validation_note === 'FLIPNOTE. engine note');
}

// ── 3. The note is LOAD-BEARING: a flipped 100% doc would auto-file WITHOUT it ──
section('Auto-file gate — the flip note is what blocks a silent file:');
{
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE document_types (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT UNIQUE,
                                 ref_field_key TEXT, date_field_key TEXT);
    CREATE TABLE fields (id INTEGER PRIMARY KEY AUTOINCREMENT, document_type_id INTEGER, key TEXT,
                         label TEXT, type TEXT DEFAULT 'text', required INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1);
    CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_name TEXT, document_type_id INTEGER,
                            status TEXT, confirmed_at TEXT, template_id INTEGER, overall_confidence INTEGER);
    CREATE TABLE extractions (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT,
                              display_value TEXT, raw_value TEXT, confidence INTEGER, extraction_method TEXT,
                              validation_note TEXT, corrected_to TEXT);
    CREATE TABLE corrections (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT,
                              original_value TEXT, corrected_value TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
  `);
  const tid = db.prepare(
    "INSERT INTO document_types (name, slug, ref_field_key, date_field_key) VALUES ('Worksheet','worksheet','reference_number','date')"
  ).run().lastInsertRowid;
  for (const [k, t] of [['supplier_name', 'text'], ['reference_number', 'text'], ['date', 'date'], ['customer', 'text']]) {
    db.prepare('INSERT INTO fields (document_type_id, key, type, required) VALUES (?,?,?,1)').run(tid, k, t);
  }
  const docId = db.prepare(
    "INSERT INTO documents (supplier_name, document_type_id, status, template_id, overall_confidence) VALUES ('Ashford Wholesale', ?, 'needs_review', NULL, 100)"
  ).run(tid).lastInsertRowid;
  const doc = { id: docId, supplier_name: 'Ashford Wholesale', document_type_id: tid, overall_confidence: 100 };

  // The flipped doc's merged rows, exactly as mergeReprocessRows produces them.
  const flipped = merge([], [
    row('reference_number', 'WS489770', { confidence: 95 }),
    row('date', '04-06-2026', { confidence: 95 }),
    row('supplier_name', 'Ashford Wholesale', { confidence: 95 }),
  ], {
    newTypeKeys: new Set(['reference_number', 'date', 'supplier_name', 'customer']),
    refKey: 'reference_number',
    noteText: "Document type changed from 'Sales Order' to 'Worksheet' on reprocess — please check the fields.",
  });

  const withNote = trust.isAutoFileEligible(db, doc, { extractions: flipped });
  check('flipped doc WITH the note: auto-file REFUSED', withNote.eligible === false);
  check("... for the 'flagged' reason (the note is what blocked it)", withNote.reason === 'flagged');

  // Now simulate a future dev deleting the note-planting: same rows, note stripped.
  const stripped = flipped.map(r => ({ ...r, validation_note: null }));
  const noNote = trust.isAutoFileEligible(db, doc, { extractions: stripped });
  check('same doc WITHOUT the note: would AUTO-FILE (proves the note is load-bearing)',
        noNote.eligible === true);
  db.close();
}

// ── 4. Authority-polarity source pin (Oracle final-review condition 3) ─────────
// The Python tests pin doc_overrides' plumbing, but nothing pinned WHERE the handler
// decides 'machine': flipping the predicate to always-machine would let trusted titles
// silently re-type HUMAN-confirmed docs with every suite green. Pin the predicate's
// shape at both sites (single-doc + batch manifest): machine requires BOTH
// status !== 'confirmed' AND no confirmed_at.
section('Authority polarity — the never-confirmed predicate exists at both handler sites:');
{
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'modules', 'processing', 'handler.js'), 'utf8');
  const singleDoc = /dtRow\.status\s*!==\s*'confirmed'\s*&&\s*!dtRow\.confirmed_at/.test(src);
  const manifest  = /row\.status\s*!==\s*'confirmed'\s*&&\s*!row\.confirmed_at/.test(src);
  check('single-doc reprocess gates machine authority on never-confirmed', singleDoc);
  check('batch manifest gates machine authority on never-confirmed', manifest);
}

console.log(`\n${fails ? fails + ' FAILED' : 'All reprocess type-flip persistence checks passed.'}`);
process.exit(fails ? 1 : 0);
