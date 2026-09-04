'use strict';
/*
 * test_field_confusions.js — PINs for `learning.getFieldConfusions(db)`, the CONFUSION_PRECEDENCE 2a
 * reducer (reggie+gary → Oracle SIGN-OFF-W/COND 2026-09-04, conditions A1-A4; DARK, mig 119).
 *
 * It mines the HUMAN `corrections` table (a correction row is a human act — machine confirms never write
 * one, reviewService.js `if (!_via)`) into per-scope OCR-confusion FACTS:
 *   {len, pos, from, to, support_docs, support_values, counter}
 * from same-length corrections that differ at EXACTLY ONE position, latest correction per (document,
 * field) (MAX(c.id) — the getFieldFormats "last confirm wins" rule), confirmed documents only, the
 * learning-exclusion respected, SUPPLIER-SCOPED GROUPS ONLY (A1: never a '' doc-type twin — a global
 * O<->0 fact is trivially true and would license cross-supplier bleed). `support_docs` = DISTINCT
 * documents, `support_values` = DISTINCT corrected values (A2 is applied in Python; the reducer emits
 * RAW facts), `counter` = documents holding the OPPOSITE fact (len,pos,to,from) in the same scope — a
 * human counter-edit is the self-heal (A4: no method-exclusion; an accepted pre-fill writes NO row).
 *
 * RED-first: `getFieldConfusions` is not exported on pre-change code.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe database/modules/test_field_confusions.js
 */
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const { runMigrations } = require('../index');
const learning = require('./learning');

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  db.prepare("INSERT INTO document_types (id, name, slug, built_in, ref_field_key, date_field_key) VALUES (1,'Print Tracker','print_tracker',0,'reference_number','date')").run();
  for (const [k, t] of [['supplier_name', 'text'], ['reference_number', 'reference'], ['date', 'date']])
    db.prepare('INSERT INTO fields (document_type_id, key, label, type, required, built_in) VALUES (1,?,?,?,1,1)').run(k, k, t);
  return db;
}
let _n = 0;
function doc(db, supplier, status = 'confirmed') {
  return Number(db.prepare(
    `INSERT INTO documents (document_type_id, original_filename, folder_path, status, supplier_name, overall_confidence, confirmed_at)
     VALUES (1, ?, '/in', ?, ?, 90, datetime('now'))`).run(`d${++_n}.pdf`, status, supplier).lastInsertRowid);
}
function corr(db, id, orig, corrected, supplier = 'Print Tracker', field = 'reference_number') {
  db.prepare(`INSERT INTO corrections (document_id, field_key, original_value, corrected_value, supplier_name, document_type)
              VALUES (?,?,?,?,?, 'print_tracker')`).run(id, field, orig, corrected, supplier);
}
const scope = (rows, sup = 'Print Tracker', field = 'reference_number') =>
  rows.find(g => g.supplier_name === sup && g.document_type === 'print_tracker' && g.field_key === field);
const factOf = (g, len, pos, from, to) => (g && g.confusions || []).find(f => f.len === len && f.pos === pos && f.from === from && f.to === to);

console.log('0. RED-first — the reducer exists and is exported');
check('learning.getFieldConfusions is a function', typeof learning.getFieldConfusions === 'function');

console.log('\n1. THE FACT — three human O->0 corrections at pos 3 of 10-char serials, two distinct values');
{
  const db = freshDb();
  corr(db, doc(db, 'Print Tracker'), 'RFHO738865', 'RFH0738865');
  corr(db, doc(db, 'Print Tracker'), 'RFCO508317', 'RFC0508317');
  corr(db, doc(db, 'Print Tracker'), 'RFHO738865', 'RFH0738865');   // a second doc, same value
  const rows = learning.getFieldConfusions(db);
  const g = scope(rows);
  const f = factOf(g, 10, 3, 'O', '0');
  check('one supplier-scoped group for (Print Tracker, print_tracker, reference_number)', !!g && rows.length === 1);
  check('fact (10,3,O->0) support_docs = 3 DISTINCT documents', !!f && f.support_docs === 3);
  check('fact support_values = 2 DISTINCT corrected values', !!f && f.support_values === 2);
  check('counter = 0 (no opposite correction)', !!f && f.counter === 0);
  check("A1: NO '' doc-type-scoped twin group is emitted", !rows.some(r => (r.supplier_name || '') === ''));
  db.close();
}

console.log('\n2. Counter — an opposite human correction in the same scope is recorded as the counter');
{
  const db = freshDb();
  corr(db, doc(db, 'Print Tracker'), 'RFHO738865', 'RFH0738865');
  corr(db, doc(db, 'Print Tracker'), 'RFCO508317', 'RFC0508317');
  corr(db, doc(db, 'Print Tracker'), 'RFX0111222', 'RFXO111222');   // the OPPOSITE: 0 -> O at pos 3
  const g = scope(learning.getFieldConfusions(db));
  const f = factOf(g, 10, 3, 'O', '0'), r = factOf(g, 10, 3, '0', 'O');
  check('the O->0 fact carries counter = 1 (one opposing document)', !!f && f.counter === 1 && f.support_docs === 2);
  check('the reverse 0->O fact exists with counter = 2', !!r && r.counter === 2 && r.support_docs === 1);
  db.close();
}

console.log('\n3. What is NOT a fact');
{
  const db = freshDb();
  corr(db, doc(db, 'Print Tracker'), 'RFHO738865', 'RFH073886');      // different length
  corr(db, doc(db, 'Print Tracker'), 'RFHO73886S', 'RFH0738865');     // TWO positions differ
  corr(db, doc(db, 'Print Tracker'), 'RFH0738865', 'RFH0738865');     // no-op (equal)
  corr(db, doc(db, 'Print Tracker'), '', 'RFH0738865');               // empty original (typed from blank)
  corr(db, doc(db, 'Print Tracker'), null, 'RFH0738865');             // NULL original
  const rows = learning.getFieldConfusions(db);
  check('no fact from a length-changing, multi-position, no-op, empty or NULL-original correction',
        !rows.some(g => (g.confusions || []).length));
  db.close();
}

console.log('\n4. Latest correction per (document, field) wins — a re-correction replaces, never stacks');
{
  const db = freshDb();
  const id = doc(db, 'Print Tracker');
  corr(db, id, 'RFHO738865', 'RFH0738865');   // first pass: O->0
  corr(db, id, 'RFH0738865', 'RFH9738865');   // second pass on the SAME doc: 0->9 (a different serial after all)
  corr(db, doc(db, 'Print Tracker'), 'RFCO508317', 'RFC0508317');
  const g = scope(learning.getFieldConfusions(db));
  check('the superseded O->0 row of the re-corrected doc does not count (support_docs 1, not 2)',
        !!factOf(g, 10, 3, 'O', '0') && factOf(g, 10, 3, 'O', '0').support_docs === 1);
  check('the latest row (unbacked 0->9) is emitted RAW — Python owns the backed check',
        !!factOf(g, 10, 3, '0', '9'));
  db.close();
}

console.log('\n5. Scope hygiene — status, learning exclusion, supplier separation');
{
  const db = freshDb();
  corr(db, doc(db, 'Print Tracker'), 'RFHO738865', 'RFH0738865');
  corr(db, doc(db, 'Print Tracker', 'needs_review'), 'RFCO508317', 'RFC0508317');   // not confirmed
  corr(db, doc(db, 'Other Supplier'), 'RFZO999888', 'RFZ0999888');                  // another supplier
  const rows = learning.getFieldConfusions(db);
  const g = scope(rows), o = scope(rows, 'Other Supplier');
  check('only CONFIRMED documents count (support_docs 1)', !!g && factOf(g, 10, 3, 'O', '0').support_docs === 1);
  check('another supplier gets its OWN group — facts never pool across suppliers',
        !!o && factOf(o, 10, 3, 'O', '0').support_docs === 1);
  // learning exclusion (mig 90 column) — respected when the switch is on
  const hasCol = db.prepare("SELECT 1 FROM pragma_table_info('documents') WHERE name='learning_excluded_at'").get();
  if (hasCol) {
    const ex = doc(db, 'Print Tracker');
    corr(db, ex, 'RFQO123456', 'RFQ0123456');
    db.prepare("UPDATE documents SET learning_excluded_at = datetime('now') WHERE id = ?").run(ex);
    try { learning.setSetting(db, 'learning_exclude_docs', 'true'); } catch {}
    const g2 = scope(learning.getFieldConfusions(db));
    check('a learning-EXCLUDED document contributes nothing (support_docs stays 1)',
          !!g2 && factOf(g2, 10, 3, 'O', '0').support_docs === 1);
  }
  db.close();
}

console.log('\n6. Shape of the emit (what buildTrainingArgs merges onto the format groups)');
{
  const db = freshDb();
  corr(db, doc(db, 'Print Tracker'), 'RFHO738865', 'RFH0738865');
  const g = scope(learning.getFieldConfusions(db));
  const f = g && g.confusions[0];
  check('group keys mirror getFieldFormats: supplier_name / document_type / field_key + confusions[]',
        !!g && typeof g.supplier_name === 'string' && g.document_type === 'print_tracker' && Array.isArray(g.confusions));
  check('fact keys: len,pos,from,to,support_docs,support_values,counter (all present, integers where numeric)',
        !!f && f.len === 10 && f.pos === 3 && f.from === 'O' && f.to === '0'
        && Number.isInteger(f.support_docs) && Number.isInteger(f.support_values) && Number.isInteger(f.counter));
  check('an empty install yields []', Array.isArray(learning.getFieldConfusions(freshDb())) && learning.getFieldConfusions(freshDb()).length === 0);
  db.close();
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} ok)`);
process.exit(fail ? 1 : 0);
