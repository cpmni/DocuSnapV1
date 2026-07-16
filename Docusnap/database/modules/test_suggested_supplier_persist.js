'use strict';
/*
 * test_suggested_supplier_persist.js — branding "Use '<name>'" resolve PERSISTENCE (Stage A1).
 * Migration 49 adds extractions.suggested_supplier; insertExtractions persists it (plain string);
 * getWithExtractions returns it via SELECT *; a field with none round-trips as null (null-inert, no
 * throw on the null-default spread). This is the gate that proves the detected name survives a queued
 * doc being reopened from the DB, so the "Use '<name>'" button can offer it.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron database/modules/test_suggested_supplier_persist.js
 */
const path = require('path');
const Database = require('better-sqlite3');
const REPO = 'c:/GIT Projects/Docusnap';
const { runMigrations } = require(path.join(REPO, 'database', 'index.js'));
const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const documents = require(path.join(REPO, 'database', 'modules', 'documents.js'));

let fails = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'BAD ') + label); if (!cond) fails++; };

const db = new Database(':memory:');
runMigrations(db);

const cols = db.prepare('PRAGMA table_info(extractions)').all().map(c => c.name);
check('migration 49: extractions.suggested_supplier column exists', cols.includes('suggested_supplier'));

const dt = db.prepare("INSERT INTO document_types (name, slug) VALUES ('Invoice','invoice')").run();
const doc = db.prepare("INSERT INTO documents (document_type_id, original_filename, stored_filename, folder_path, status) VALUES (?, 'MarloweMedicalSupplies_invoice_11.pdf', 'd.pdf', '', 'needs_review')")
              .run(dt.lastInsertRowid);
const docId = doc.lastInsertRowid;

// The real Marlowe→Ridgeway shape: issuer read as the colliding-logo supplier, branding note + the
// fuzzy-detected true name in suggested_supplier; plus an ordinary field that carries none.
learning.insertExtractions(db, docId, [
  { field_key: 'supplier_name', raw_value: 'Ridgeway Plant Hire', display_value: 'Ridgeway Plant Hire',
    confidence: 69, extraction_method: 'logo',
    validation_note: "The page branding reads 'Marlowe Medical Supplies', but this was filed under 'Ridgeway Plant Hire'. Please confirm the correct company.",
    suggested_supplier: 'Marlowe Medical Supplies' },
  { field_key: 'invoice_number', raw_value: 'INV-71567', display_value: 'INV-71567',
    confidence: 98, extraction_method: 'keyword', validation_note: null },   // no suggested_supplier key → default-null spread, must not throw
]);

const got = documents.getWithExtractions(db, docId);
const sup = got.extractions.find(e => e.field_key === 'supplier_name');
const inv = got.extractions.find(e => e.field_key === 'invoice_number');
check('round-trip: supplier_name.suggested_supplier == the detected name', sup.suggested_supplier === 'Marlowe Medical Supplies');
check('the branding note round-trips alongside it', /page branding reads/.test(sup.validation_note || ''));
check('field WITHOUT suggested_supplier → null (no throw on the null-default spread)', inv.suggested_supplier == null);

// A confirm-time carry-over row (candidates path also present) must not clobber suggested_supplier.
learning.insertExtractions(db, docId, [
  { field_key: 'date', raw_value: '03-12-2026', display_value: '03-12-2026', confidence: 98, extraction_method: 'keyword',
    validation_note: null, candidates: null, suggested_supplier: null },
]);
check('candidates + suggested_supplier coexist (both null on a plain field)',
  documents.getWithExtractions(db, docId).extractions.find(e => e.field_key === 'date').suggested_supplier == null);

console.log('\n' + (fails === 0 ? 'ALL PASS' : `${fails} FAILED`));
process.exit(fails ? 1 : 0);
