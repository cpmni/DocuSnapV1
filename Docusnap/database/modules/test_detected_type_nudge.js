'use strict';
/*
 * test_detected_type_nudge.js — migration 51 + the detected-but-not-installed type stamp.
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron database/modules/test_detected_type_nudge.js
 *
 * THE HOLE. Detection scores document types from the SHIPPED config/keyword_patterns.json
 * document_type_keywords buckets, which exist INDEPENDENTLY of the types an install actually has
 * (Delivery Note is a PRESET, not a built-in). On a fresh install that never added it, a confident
 * "Delivery Note" mapped to no installed type, and processing/handler.js treated name->id as a
 * TOTAL function: the id stayed null and the NAME was discarded, so the document landed untyped
 * with nothing on record to explain it or to offer. (2026-07-20 delivery-docket report.)
 *
 * Pinned here: the column exists and is NULL-inert, insert() and update() BOTH carry it, and the
 * value can be CLEARED as well as set. The clear is the one that bites: documents.update() filters
 * against an `allowed` whitelist and SILENTLY DROPS anything missing from it, so a column wired
 * into insert() but not update() writes once and can never be un-written — the suggestion would
 * then survive the very act of adding the type it suggests.
 */
const path = require('path');
const Database = require(path.join(__dirname, '..', '..', 'node_modules', 'better-sqlite3'));
const documents = require('./documents');

let fails = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'BAD ') + label); if (!cond) fails++; };

// Minimal fixture mirroring the post-migration shape.
const db = new Database(':memory:');
db.exec(`
  CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, original_filename TEXT, folder_path TEXT,
    document_type_id INTEGER, supplier_name TEXT, overall_confidence INTEGER, status TEXT,
    template_id INTEGER, logo_phash TEXT, logo_detail_hash TEXT, keyword_fingerprint TEXT,
    ocr_text TEXT, page_count INTEGER, detected_type_name TEXT,
    stored_filename TEXT, stored_path TEXT, doc_date TEXT, reference_number TEXT, confirmed_at TEXT,
    error_message TEXT, working_path TEXT, review_acknowledged_at TEXT, confirmed_by_username TEXT,
    supplier_pin TEXT);
`);

console.log('insert() — the stamp:');
const idA = documents.insert(db, { original_filename: 'docket.pdf', folder_path: 'C:/in',
  status: 'needs_review', detected_type_name: 'Delivery Note' }).lastInsertRowid;
const rowA = () => db.prepare('SELECT * FROM documents WHERE id = ?').get(idA);
check('the detected name is persisted', rowA().detected_type_name === 'Delivery Note');
check('the doc stays UNTYPED — the stamp is a suggestion, never a type assignment',
      rowA().document_type_id === null);

console.log('\ninsert() — NULL-inert for every ordinary document:');
const idB = documents.insert(db, { original_filename: 'inv.pdf', folder_path: 'C:/in',
  status: 'needs_review', document_type_id: 7 }).lastInsertRowid;
check('a doc whose type resolved carries no suggestion',
      db.prepare('SELECT detected_type_name FROM documents WHERE id = ?').get(idB).detected_type_name === null);

console.log('\nupdate() — the CLEAR (the silent-drop whitelist trap):');
documents.update(db, idA, { detected_type_name: null, document_type_id: 42 });
check('the stamp CLEARS once the type is assigned (column IS in the allowed whitelist)',
      rowA().detected_type_name === null);
check('... and the type actually landed', rowA().document_type_id === 42);

// Re-stamping must work too — a reprocess can newly detect an uninstalled type on a doc that had none.
documents.update(db, idB, { detected_type_name: 'Remittance Advice' });
check('update() can SET the stamp as well as clear it',
      db.prepare('SELECT detected_type_name FROM documents WHERE id = ?').get(idB).detected_type_name === 'Remittance Advice');

console.log('\nhandler seam — _resolveDetectedType:');
// The helper is pure w.r.t. the db handle it is given; stub the doc-types module it requires.
const dtPath = require.resolve('./document_types');
const realDt = require.cache[dtPath];
require.cache[dtPath] = { id: dtPath, filename: dtPath, loaded: true,
  exports: { ...require('./document_types'),
             getAllWithFields: () => [{ id: 3, name: 'Invoice', slug: 'invoice' }] } };
delete require.cache[require.resolve('../../src/modules/processing/handler')];
const handler = require('../../src/modules/processing/handler');
const resolve = handler._resolveDetectedType;

check('helper is exported for the seam pins', typeof resolve === 'function');
if (typeof resolve === 'function') {
  check('an INSTALLED type resolves to its id and offers nothing',
        resolve(db, 'Invoice').id === 3 && resolve(db, 'Invoice').unmatchedName === null);
  check('match is case-insensitive', resolve(db, 'invoice').id === 3);
  check('an UNINSTALLED type yields no id but keeps the name',
        resolve(db, 'Delivery Note').id === null && resolve(db, 'Delivery Note').unmatchedName === 'Delivery Note');
  check('detection returning NOTHING offers nothing — there is no name to suggest',
        resolve(db, null).unmatchedName === null && resolve(db, '').unmatchedName === null
        && resolve(db, '   ').unmatchedName === null);

  // NO SLUG FALLBACK, deliberately. A slug-level match would newly RESOLVE types that exact-name
  // matching misses today — a live change to document_type_id on real installs, inside a slice
  // whose kill switch is meant to make OFF byte-identical. If it is worth having, it gets measured
  // on its own. Do not "improve" the helper by adding it here.
  check('no slug-level fallback: a near-miss name does NOT resolve to the installed type',
        resolve(db, 'Invoices').id === null && resolve(db, 'Invoices').unmatchedName === 'Invoices');

  // PIN A (the accepted trade-off). A NAMED-but-uninstalled detection must NOT adopt the Generic
  // Document type, even with generic_fallback_enabled on. Generic is equally unfilable (trust.js
  // refuses 'generic-type' as flatly as 'no-type'), so this is not about safety — it is that
  // generic OVERWRITES the type with one we know is wrong when a better answer is one admin click
  // away, and drags the filing {docType} token and the learning scope onto general_document.
  // Generic stays the answer for detection == None only. Do not move the fallback out of the else.
  check('PIN A: a named detection never adopts the generic type, whatever the setting',
        handler._genericFallbackId(db, 'Delivery Note') === null);

  console.log('\nkill switch DETECTED_TYPE_NUDGE=0:');
  process.env.DETECTED_TYPE_NUDGE = '0';
  check('OFF ⇒ no suggestion is ever produced (column stays NULL ⇒ inert)',
        resolve(db, 'Delivery Note').unmatchedName === null);
  check('OFF ⇒ real type resolution is UNAFFECTED (this is a suggestion switch, not a typing switch)',
        resolve(db, 'Invoice').id === 3);
  delete process.env.DETECTED_TYPE_NUDGE;
}

if (realDt) require.cache[dtPath] = realDt; else delete require.cache[dtPath];
db.close();
console.log(fails ? `\n${fails} FAILED` : '\nAll detected-type-nudge checks passed');
process.exit(fails ? 1 : 0);
