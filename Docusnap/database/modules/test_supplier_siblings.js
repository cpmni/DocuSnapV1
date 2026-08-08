#!/usr/bin/env node
'use strict';
/**
 * database/modules/test_supplier_siblings.js — the CORRECTION RIPPLE query (identity slice 2).
 *
 * The Larkspur incident's second half: the owner corrected ONE docket and the other 19 stayed
 * misassigned, because nearest-neighbour keeps favouring the bigger WRONG logo pool (and the hint
 * path needs three confirms before it upgrades). Siblings must therefore be found BY TEXT.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_supplier_siblings.js
 */
const Database = require('better-sqlite3');
const { findSiblings, RIPPLE_BAR } = require('./supplierSiblings');

let fail = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fail++; };

const LARKSPUR = ['larkspur', 'interiors', 'design', 'rooms', 'chapel', 'harrogate'];
const RIDGEWAY = ['ridgeway', 'plant', 'hire', 'quarry', 'aggregates', 'road'];

function db_() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE documents (
    id INTEGER PRIMARY KEY, original_filename TEXT, stored_filename TEXT, supplier_name TEXT,
    status TEXT, supplier_pin TEXT, keyword_fingerprint TEXT, ocr_text TEXT)`);
  const ins = db.prepare(`INSERT INTO documents
    (id, original_filename, supplier_name, status, supplier_pin, keyword_fingerprint, ocr_text)
    VALUES (?,?,?,?,?,?,?)`);
  const J = (a) => JSON.stringify(a);
  // 1 = the corrected source. 2,3 = unfiled Larkspur siblings (the ones that must ripple).
  ins.run(1, 'lark_01.pdf', 'Larkspur Interiors', 'needs_review', 'Larkspur Interiors', J(LARKSPUR), null);
  ins.run(2, 'lark_02.pdf', 'Ridgeway Plant Hire', 'needs_review', null, J(LARKSPUR), null);
  ins.run(3, 'lark_03.pdf', null, 'deferred', null, J(LARKSPUR), null);
  ins.run(4, 'ridge_01.pdf', 'Ridgeway Plant Hire', 'needs_review', null, J(RIDGEWAY), null);   // different sender
  ins.run(5, 'lark_confirmed.pdf', 'Larkspur Interiors', 'confirmed', null, J(LARKSPUR), null); // already filed
  ins.run(6, 'lark_pinned.pdf', null, 'needs_review', 'Someone Else', J(LARKSPUR), null);       // already pinned
  ins.run(7, 'lark_same.pdf', 'Larkspur Interiors', 'needs_review', null, J(LARKSPUR), null);   // already correct
  ins.run(8, 'nofp.pdf', null, 'needs_review', null, null, null);                               // no fingerprint
  return db;
}

const db = db_();
const sib = findSiblings(db, 1, 'Larkspur Interiors');
const ids = sib.map(s => s.id).sort();

console.log('§1 the incident — siblings found by TEXT, not by the logo');
check('finds the two unfiled Larkspur siblings (#2 needs_review, #3 deferred)',
  ids.length === 2 && ids[0] === 2 && ids[1] === 3);
check('a sibling wrongly assigned to another supplier is INCLUDED (that is the whole point)',
  sib.some(s => s.id === 2 && s.current_supplier === 'Ridgeway Plant Hire'));
check('every hit reports its overlap ratio at/above the bar',
  sib.every(s => s.ratio >= RIPPLE_BAR));

console.log('\n§2 exclusions (each one is a way a ripple could do harm)');
check('a DIFFERENT sender is never swept in', !ids.includes(4));
check('CONFIRMED/filed documents are never touched', !ids.includes(5));
check('an already-PINNED document is left alone (someone decided about it)', !ids.includes(6));
check('a document already carrying the target supplier is skipped (nothing to do)', !ids.includes(7));
check('the source document never returns itself', !ids.includes(1));
check('a document with no usable fingerprint is skipped, never guessed at', !ids.includes(8));

console.log('\n§3 fail-safe + bounds');
check('a SOURCE with no fingerprint returns [] rather than rippling blindly',
  findSiblings(db, 8, 'Larkspur Interiors').length === 0);
check('an unknown source id returns []', findSiblings(db, 999, 'X').length === 0);
check('the cap is honoured', findSiblings(db, 1, 'Larkspur Interiors', { cap: 1 }).length === 1);
check('raising the bar to 1.0 still matches identical fingerprints',
  findSiblings(db, 1, 'Larkspur Interiors', { bar: 1.0 }).length === 2);

console.log('\n§4 PINNED: the query is READ-ONLY (the apply path is the caller\'s pin write)');
const before = db.prepare('SELECT COUNT(*) c FROM documents WHERE supplier_pin IS NOT NULL').get().c;
findSiblings(db, 1, 'Larkspur Interiors');
check('finding siblings writes nothing',
  db.prepare('SELECT COUNT(*) c FROM documents WHERE supplier_pin IS NOT NULL').get().c === before);

db.close();
console.log(fail ? `\n${fail} check(s) FAILED` : '\nAll supplier-sibling checks passed.');
process.exit(fail ? 1 : 0);
