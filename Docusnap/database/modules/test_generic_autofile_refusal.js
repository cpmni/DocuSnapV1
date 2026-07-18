#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_generic_autofile_refusal.js
 * -------------------------------------------------
 * PIN 2 of the Generic Document design (docs/designs/GENERIC_DOCTYPE_2026-07-18.md §8,
 * Oracle C4): a General Document NEVER auto-files. With a generic TYPE assigned, the
 * 'no-type' refusal no longer covers these docs, and at overall confidence 100 the
 * structural gate is GATE-FREE by default (`strict_100_autofile` is opt-in) — so the
 * slug-keyed refusal in isAutoFileEligible is the ENTIRE wall. This battery asserts the
 * refusal at conf 100 with strict_100_autofile OFF (the shipped default), at slider 80
 * AND 100, and that it is slug-scoped (a non-generic doc in the same fixture still
 * passes the gate-free 100 path). A future dev who weakens or moves the refusal below
 * the floor logic turns this red.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_generic_autofile_refusal.js
 */

const Database = require('better-sqlite3');
const trust = require('./trust');

let fails = 0;
function check(label, cond, extra) {
  console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? `  [${JSON.stringify(extra)}]` : ''}`);
  if (!cond) fails++;
}

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
const gid = db.prepare("INSERT INTO document_types (name, slug) VALUES ('General Document','general_document')").run().lastInsertRowid;
const iid = db.prepare("INSERT INTO document_types (name, slug, ref_field_key, date_field_key) VALUES ('Invoice','invoice','invoice_number','invoice_date')").run().lastInsertRowid;

const genericDoc = { id: 1, document_type_id: gid, supplier_name: 'Acme', overall_confidence: 100 };
const typedDoc   = { id: 2, document_type_id: iid, supplier_name: 'Acme', overall_confidence: 100 };
const clean = { extractions: [] };   // un-flagged, no critical fields present

console.log('§1 the refusal — conf 100, strict_100_autofile OFF (shipped default)');
let r = trust.isAutoFileEligible(db, genericDoc, clean);
check("generic @100, slider default(100) ⇒ refused 'generic-type'", !r.eligible && r.reason === 'generic-type', r);

db.prepare("INSERT INTO settings (key, value) VALUES ('auto_file_threshold','80')").run();
r = trust.isAutoFileEligible(db, genericDoc, clean);
check('generic @100, slider 80 ⇒ still refused', !r.eligible && r.reason === 'generic-type', r);

db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('strict_100_autofile','false')").run();
r = trust.isAutoFileEligible(db, genericDoc, clean);
check('generic @100, strict_100_autofile explicitly off ⇒ still refused', !r.eligible && r.reason === 'generic-type', r);

console.log('§2 graduation cannot override');
r = trust.isAutoFileEligible(db, genericDoc, { ...clean, gradOn: true });
check('generic, graduation forced on ⇒ still refused', !r.eligible && r.reason === 'generic-type', r);
r = trust.isAutoFileEligible(db, { ...genericDoc, overall_confidence: 100 }, { ...clean, criticalFieldFloor: 0 });
check('generic, critical floor disabled ⇒ still refused', !r.eligible && r.reason === 'generic-type', r);

console.log('§3 slug-scoped — a typed doc in the same fixture is NOT hit by the refusal');
db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('auto_file_threshold','100')").run();
r = trust.isAutoFileEligible(db, typedDoc, clean);
check('invoice @100, un-flagged ⇒ eligible via the gate-free 100 path', r.eligible === true, r);
check("…and the generic refusal never fires for it", r.reason !== 'generic-type');

console.log('§4 the no-type refusal is untouched');
r = trust.isAutoFileEligible(db, { id: 3, document_type_id: null, overall_confidence: 100 }, clean);
check("null-type doc still refused 'no-type'", !r.eligible && r.reason === 'no-type', r);

console.log(`\n${fails ? 'FAIL' : 'PASS'} — ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
