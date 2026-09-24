#!/usr/bin/env node
'use strict';
/*
 * test_reread_holds_blank_supplier_scope.js — Oracle C3 of the QUIET REDETECT vet (2026-09-24): the reliability
 * witness bucket is keyed `<supplier>|<slug>|<key>`; every BLANK-supplier doc of a type used to share ONE bucket, so a
 * single disagreement on an unrelated unrecognised sender would hold every other unrecognised doc's first-fill of that
 * field. `_scopeOf` now keys a blank-supplier doc per document (`doc:<id>|<slug>`). Pins:
 *   1. two blank-supplier docs, same type: a disagreement witness on doc A leaves doc B's provisional hold RELEASED;
 *   2. control — two docs of the SAME named supplier still share the bucket (A's disagreement holds B), unchanged;
 *   3. holdFirstFills honours opts.onlyKeys (Oracle C5) and is unchanged without it.
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe src/modules/processing/test_reread_holds_blank_supplier_scope.js
 */
const path = require('path');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..', '..');
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
const documents = require(path.join(ROOT, 'database', 'modules', 'documents'));
const holdsMod = require('./rereadHolds');
let fails = 0;
const check = (label, cond, extra) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? ' — ' + extra : ''}`); if (!cond) fails++; };
const quiet = (fn) => { const o = console.log; console.log = () => {}; try { return fn(); } finally { console.log = o; } };

const db = new Database(':memory:');
quiet(() => runMigrations(db));
db.prepare("INSERT INTO document_types (id, name, slug, built_in, ref_field_key, date_field_key) VALUES (4, 'Quote', 'quote', 0, 'quote_number', 'quote_date')").run();
for (const [k, ty] of [['supplier_name', 'text'], ['quote_number', 'text'], ['quote_date', 'date']])
  db.prepare('INSERT INTO fields (document_type_id, key, label, type, required, enabled) VALUES (4, ?, ?, ?, 1, 1)').run(k, k, ty);
const ins = db.prepare('INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method) VALUES (?, ?, ?, ?, 90, ?)');
const mk = (supplier, rows) => {
  const id = Number(documents.insert(db, { original_filename: `q${Math.random().toString(36).slice(2, 7)}.pdf`, folder_path: '/in', status: 'needs_review', supplier_name: supplier, document_type_id: 4 }).lastInsertRowid);
  for (const r of rows) ins.run(id, r.key, r.value, r.value, 'keyword');
  return id;
};
const rows = (id) => db.prepare('SELECT * FROM extractions WHERE document_id = ?').all(id);
const setRows = (id, list) => { db.prepare('DELETE FROM extractions WHERE document_id = ?').run(id); for (const r of list) ins.run(id, r.key, r.value, r.value, 'keyword'); };
const noteOf = (id, key) => String((db.prepare('SELECT validation_note FROM extractions WHERE document_id = ? AND field_key = ?').get(id, key) || {}).validation_note || '');
const holds = holdsMod.create({ corroborated: () => false, k: 1 });

function scenario(supA, supB) {
  // A: quote_date VALUED before, reads DIFFERENTLY after (an S3-C5 disagreement = an unreliable witness on quote_date)
  // B: quote_date EMPTY before, first-filled after (a provisional reliability hold on quote_date)
  const A = mk(supA, [{ key: 'quote_number', value: 'Q-1' }, { key: 'quote_date', value: '01-02-2026' }]);
  const B = mk(supB, [{ key: 'quote_number', value: 'Q-2' }]);
  const beforeA = rows(A), beforeB = rows(B);
  setRows(A, [{ key: 'quote_number', value: 'Q-1' }, { key: 'quote_date', value: '09-02-2026' }]);
  setRows(B, [{ key: 'quote_number', value: 'Q-2' }, { key: 'quote_date', value: '03-03-2026' }]);
  const batch = holds.newBatch();
  holds.onDocMerged(db, batch, { docId: A, existing: beforeA, via: 'teach', reliability: true });
  holds.onDocMerged(db, batch, { docId: B, existing: beforeB, via: 'teach', reliability: true });
  const heldBefore = /confirm once/.test(noteOf(B, 'quote_date'));
  const rel = holds.release(db, batch);
  return { A, B, heldBefore, releasedB: rel.released.some(h => h.docId === B), heldB: rel.held.some(h => h.docId === B), noteB: noteOf(B, 'quote_date') };
}

console.log('1. two BLANK-supplier docs of the same type do NOT share a witness bucket (Oracle C3)');
{
  const r = scenario(null, null);
  check('B was provisionally held at merge (first-fill)', r.heldBefore);
  check('A\'s disagreement does NOT hold B: B\'s hold is RELEASED at batch end', r.releasedB && !r.heldB && !/confirm once/.test(r.noteB), r.noteB);
}
console.log('\n2. control — the SAME named supplier still shares the bucket (unchanged)');
{
  const r = scenario('Nordwind Refrigeration Ltd', 'Nordwind Refrigeration Ltd');
  check('B was provisionally held at merge', r.heldBefore);
  check('A\'s disagreement HOLDS B (same sender, same field): B stays held', r.heldB && !r.releasedB && /confirm once/.test(r.noteB), r.noteB);
}
console.log('\n3. holdFirstFills opts.onlyKeys (Oracle C5) — restricts the hold to the named keys; no opts = unchanged');
{
  const C = mk(null, [{ key: 'quote_number', value: 'Q-9' }]);
  const before = rows(C);
  setRows(C, [{ key: 'supplier_name', value: 'Frostline Ltd' }, { key: 'quote_number', value: 'Q-9' }, { key: 'quote_date', value: '04-04-2026' }]);
  const only = holds.holdFirstFills(db, C, before, 'Read from the label you added — confirm once.', { onlyKeys: new Set(['supplier_name']) });
  check('only the named key is held', only.length === 1 && only[0].key === 'supplier_name' && /label you added/.test(noteOf(C, 'supplier_name')) && !/confirm once/.test(noteOf(C, 'quote_date')), JSON.stringify(only));
  const D = mk(null, [{ key: 'quote_number', value: 'Q-10' }]);
  const beforeD = rows(D);
  setRows(D, [{ key: 'supplier_name', value: 'Frostline Ltd' }, { key: 'quote_number', value: 'Q-10' }, { key: 'quote_date', value: '05-04-2026' }]);
  const all = holds.holdFirstFills(db, D, beforeD, 'Read from your new box — confirm once.');
  check('without opts every required ROLE first-fill is held as before (supplier + date; the ref was valued)', all.map(h => h.key).sort().join() === 'quote_date,supplier_name', JSON.stringify(all));
}

db.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL OK');
process.exit(fails ? 1 : 0);
