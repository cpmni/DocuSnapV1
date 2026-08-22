'use strict';
/*
 * test_type_split_gate.js — A3 of the type-split arc (2026-08-22; gary → Oracle SIGN-OFF-W/COND S2-js-a).
 *
 * The pure predicate `typeSplit.checkTypeSplit`: fires ONLY when the issuer's confirmed history is
 * ≥3 docs AND 100 % one type T AND the slug being confirmed ≠ T. Once a second type is confirmed
 * (acknowledged) the history is mixed and the ask never fires again for that issuer.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_type_split_gate.js
 */
const Database = require('better-sqlite3');
const { runMigrations } = require('../index');
const documents = require('./documents');
const { checkTypeSplit } = require('./typeSplit');

let fails = 0;
const check = (label, cond, extra) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? `  [${extra}]` : ''}`); if (!cond) fails++; };

const db = new Database(':memory:');
runMigrations(db);
db.prepare("INSERT INTO document_types (id, name, slug, built_in) VALUES (7, 'Quote', 'quote', 0)").run();
db.prepare("INSERT INTO document_types (id, name, slug, built_in) VALUES (3, 'Purchase Order', 'purchase_order', 1)").run();
const mk = (supplier, typeId, status = 'confirmed') => documents.insert(db, {
  original_filename: 'x.pdf', folder_path: '/in', status, supplier_name: supplier, document_type_id: typeId });

console.log('the predicate:');
for (let i = 0; i < 24; i++) mk('Nordwind Refrigeration Ltd', 7);
const r = checkTypeSplit(db, 'Nordwind Refrigeration Ltd', 'purchase_order');
check('24 quotes + a Purchase Order confirm → split, names the established type and count', r.split === true
      && r.established_slug === 'quote' && r.established_name === 'Quote' && r.count === 24 && r.typed_slug === 'purchase_order'
      && r.typed_name === 'Purchase Order', JSON.stringify(r));
check('…the message reads as a question a customer can answer', /Nordwind Refrigeration Ltd files as Quote \(24 so far\)\. File this one as Purchase Order\?/.test(r.message));
check('the same type → no ask', checkTypeSplit(db, 'Nordwind Refrigeration Ltd', 'quote').split === false);
check('issuer match is case/space-insensitive', checkTypeSplit(db, '  nordwind refrigeration ltd ', 'purchase_order').split === true);
for (let i = 0; i < 2; i++) mk('Harbour Glass Ltd', 7);
check('a thin history (2 confirms) → no ask (reason thin)', checkTypeSplit(db, 'Harbour Glass Ltd', 'purchase_order').reason === 'thin');
mk('Harbour Glass Ltd', 7);
check('…at 3 confirms it fires', checkTypeSplit(db, 'Harbour Glass Ltd', 'purchase_order').split === true);
mk('Nordwind Refrigeration Ltd', 3);   // the acknowledged second type lands
check('once a second type is confirmed the history is MIXED → never asks again for this issuer',
      checkTypeSplit(db, 'Nordwind Refrigeration Ltd', 'purchase_order').reason === 'mixed'
      && checkTypeSplit(db, 'Nordwind Refrigeration Ltd', 'invoice').reason === 'mixed');
for (let i = 0; i < 5; i++) mk('Pending Co', 7, 'needs_review');
check('held docs are not history', checkTypeSplit(db, 'Pending Co', 'purchase_order').reason === 'thin');
check('unknown issuer / empty inputs → no ask', checkTypeSplit(db, 'Nobody', 'quote').split === false
      && checkTypeSplit(db, '', 'quote').split === false && checkTypeSplit(db, 'Nordwind Refrigeration Ltd', '').split === false);
check('an unknown typed slug still asks (typed_name null, slug in the message)',
      (() => { const x = checkTypeSplit(db, 'Harbour Glass Ltd', 'remittance'); return x.split === true && x.typed_name === null && /as remittance\?/.test(x.message); })());

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
