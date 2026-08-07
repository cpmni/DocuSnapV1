#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_trust_shadow_row_skip.js
 * ----------------------------------------------
 * Pins TRUST_SHADOW_ROW_SKIP (gary design, 2026-08-07) — the SHADOW-ROW AUTO-FILE DEADLOCK.
 *
 * `_shadow_reconcile_components` writes extraction rows with extraction_method='shadow_reconcile'
 * only to back the "totals add up" check. Those rows are INVISIBLE in Review, EXCLUDED from
 * learning, DELETED at confirm, and are not filing inputs — yet docTrustGate judged filability on
 * them. For a shadow row on a field the type does not define there is never a format row, so the
 * gate returned `unverifiable-value:<field>`: the document could never auto-file and the operator
 * could never see, let alone clear, the row that blocked it. SEALED TWICE.
 *
 * The pins below cover the fix AND its three deliberate NON-skips, plus the harness-overlay trap
 * that would have made the corpus gate vacuously green.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_trust_shadow_row_skip.js
 */

const Database = require('better-sqlite3');
const trust = require('./trust');

let fails = 0;
function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; return cond; }
function section(t) { console.log(`\n${t}`); }

function makeDb() {
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
  const tid = db.prepare("INSERT INTO document_types (name, slug, ref_field_key, date_field_key) VALUES ('Invoice','invoice','invoice_number','invoice_date')").run().lastInsertRowid;
  const add = (k, t) => db.prepare('INSERT INTO fields (document_type_id, key, type) VALUES (?,?,?)').run(tid, k, t);
  add('supplier_name', 'text');
  add('invoice_date', 'date');
  add('invoice_number', 'text');
  add('total_amount', 'currency');
  return { db, tid };
}

// A GRADUATED scope: >= 10 clean confirms so every defined field has a learned format row and the
// only thing that can block the doc under test is the row we are actually pinning.
function seedHistory(db, tid) {
  for (let i = 1; i <= 12; i++) {
    const id = db.prepare('INSERT INTO documents (supplier_name, document_type_id, status, confirmed_at, template_id, overall_confidence) VALUES (?,?,?,?,?,?)')
      .run('Anconia Corp', tid, 'confirmed', `2026-0${1 + (i % 9)}-01`, 1, 100).lastInsertRowid;
    const vals = { supplier_name: 'Anconia Corp', invoice_date: `0${1 + (i % 9)}-01-2026`,
                   invoice_number: `INV-1000${i}`, total_amount: '120.00' };
    for (const [k, v] of Object.entries(vals)) {
      db.prepare('INSERT INTO extractions (document_id, field_key, display_value, confidence, extraction_method) VALUES (?,?,?,?,?)')
        .run(id, k, v, 97, 'keyword');
    }
  }
}

// The document under test: clean on every DEFINED field, plus ONE extra row we vary.
function seedSubject(db, tid, extra) {
  const id = db.prepare('INSERT INTO documents (supplier_name, document_type_id, status, template_id, overall_confidence) VALUES (?,?,?,?,?)')
    .run('Anconia Corp', tid, 'needs_review', 1, 97).lastInsertRowid;
  const vals = { supplier_name: 'Anconia Corp', invoice_date: '04-06-2026',
                 invoice_number: 'INV-10099', total_amount: '120.00' };
  for (const [k, v] of Object.entries(vals)) {
    db.prepare('INSERT INTO extractions (document_id, field_key, display_value, confidence, extraction_method) VALUES (?,?,?,?,?)')
      .run(id, k, v, 97, 'keyword');
  }
  if (extra) {
    db.prepare('INSERT INTO extractions (document_id, field_key, display_value, confidence, extraction_method, validation_note) VALUES (?,?,?,?,?,?)')
      .run(id, extra.key, extra.value, 97, extra.method, extra.note || null);
  }
  return id;
}

function gate(extra, armed) {
  if (armed) process.env.TRUST_SHADOW_ROW_SKIP = '1';
  else delete process.env.TRUST_SHADOW_ROW_SKIP;
  const { db, tid } = makeDb();
  seedHistory(db, tid);
  const id = seedSubject(db, tid, extra);
  const r = trust.docTrustGate(db, id, 'Anconia Corp', 'invoice');
  db.close();
  return r;
}

// `subtotal` is NOT a field of this Invoice type — exactly the live exhibit
// (`unverifiable-value:subtotal` at conf 97 on a graduated scope).
const SHADOW = { key: 'subtotal', value: '100.00', method: 'shadow_reconcile' };

section('CONTROL — the document is otherwise filable');
check('no extra row -> gate OK (so any block below is caused by the extra row alone)',
      gate(null, false).ok === true);

section('OFF — the deadlock still reproduces (pinned: the change is dark)');
const off = gate(SHADOW, false);
check('OFF: switch reads disarmed', trust._shadowRowSkipEnabled() === false);
check(`OFF: invisible shadow row BLOCKS with unverifiable-value:subtotal (got ${off.reason})`,
      off.ok === false && off.reason === 'unverifiable-value:subtotal');

section('ARMED — the inert shadow row no longer decides filability');
const on = gate(SHADOW, true);
check('ARMED: switch reads armed', trust._shadowRowSkipEnabled() === true);
check(`ARMED: the document can auto-file (got ${on.ok ? 'ok' : on.reason})`, on.ok === true);

section('ARMED — the three deliberate NON-skips');
// 1. A flagged shadow row still blocks: the skip is placed AFTER the validation_note check, because
//    a note is real information about the page even when the row itself is invisible.
const flagged = gate({ ...SHADOW, note: 'the total does not add up — please verify' }, true);
check(`ARMED: a FLAGGED shadow row still BLOCKS (got ${flagged.reason})`,
      flagged.ok === false && flagged.reason === 'flagged:subtotal');
// 2. A shadow row on a DEFINED field of this type is visible-ish and stays judged.
const defined = gate({ key: 'invoice_number', value: 'Information', method: 'shadow_reconcile' }, true);
check(`ARMED: a shadow row on a DEFINED field is NOT skipped (got ${defined.ok ? 'ok' : defined.reason})`,
      defined.ok === false);
// 3. Oracle's foreignFields condition (2026-07-22): a VISIBLE foreign row must STILL block.
const visibleForeign = gate({ key: 'subtotal', value: '100.00', method: 'keyword' }, true);
check(`ARMED: a VISIBLE (non-shadow) foreign row still BLOCKS (got ${visibleForeign.ok ? 'ok' : visibleForeign.reason})`,
      visibleForeign.ok === false && visibleForeign.reason === 'unverifiable-value:subtotal');

section('THE HARNESS-OVERLAY TRAP — an overlay without extraction_method is a VACUOUS pass');
// gary found this before a line of the fix was written: realdoc_regression.js and sweepPredicate.js
// built their overlays WITHOUT extraction_method, so every row would reach the gate looking like a
// non-shadow row and the corpus gate would go green having tested nothing. Both now thread it.
{
  process.env.TRUST_SHADOW_ROW_SKIP = '1';
  const { db, tid } = makeDb();
  seedHistory(db, tid);
  const id = seedSubject(db, tid, null);
  const base = [
    { field_key: 'supplier_name', display_value: 'Anconia Corp', validation_note: null },
    { field_key: 'invoice_date', display_value: '04-06-2026', validation_note: null },
    { field_key: 'invoice_number', display_value: 'INV-10099', validation_note: null },
    { field_key: 'total_amount', display_value: '120.00', validation_note: null },
  ];
  const shadowRow = { field_key: 'subtotal', display_value: '100.00', validation_note: null };
  const without = trust.docTrustGate(db, id, 'Anconia Corp', 'invoice',
    { extractions: [...base, { ...shadowRow }] });
  const with_ = trust.docTrustGate(db, id, 'Anconia Corp', 'invoice',
    { extractions: [...base, { ...shadowRow, extraction_method: 'shadow_reconcile' }] });
  db.close();
  check(`overlay WITHOUT extraction_method: the skip cannot fire (got ${without.ok ? 'ok' : without.reason})`,
        without.ok === false && without.reason === 'unverifiable-value:subtotal');
  check('overlay WITH extraction_method threaded: the skip fires', with_.ok === true);
  delete process.env.TRUST_SHADOW_ROW_SKIP;
}

console.log();
if (fails) { console.log(`${fails} FAILED`); process.exit(1); }
console.log('ALL PASS');
