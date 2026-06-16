#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_reset_fresh_install.js
 * --------------------------------------------
 * Covers learning.resetToFreshInstall — the dev "Erase all custom data / revert
 * to fresh install (keep the document corpus)" reset.
 *
 * Verifies, in one transaction, that it:
 *   - wipes every learning corpus + the managed template store,
 *   - deletes the CUSTOM schema (custom doc types + custom fields) and re-seeds
 *     the built-ins,
 *   - strips learned identity off the kept documents and requeues confirmed/
 *     deferred docs (without deleting any document rows or files),
 *   - keeps settings / licensing intact,
 *   - does NOT trip the documents→document_types FK (order: null the link before
 *     deleting custom types — proven here with foreign_keys = ON),
 *   - returns per-table counts and is idempotent.
 *
 * Usage: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_reset_fresh_install.js
 */

const Database = require('better-sqlite3');
const learning = require('./learning');

function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); return cond; }
const count = (db, t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;

const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE license_tokens (id INTEGER PRIMARY KEY, kind TEXT, token_blob TEXT);
  CREATE TABLE document_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE, slug TEXT NOT NULL UNIQUE,
    built_in INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1,
    ref_field_key TEXT, date_field_key TEXT,
    sort_order INTEGER NOT NULL DEFAULT 100,
    created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE fields (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_type_id INTEGER NOT NULL REFERENCES document_types(id) ON DELETE CASCADE,
    key TEXT NOT NULL, label TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'text',
    required INTEGER NOT NULL DEFAULT 0, built_in INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1, confidence_threshold INTEGER NOT NULL DEFAULT 70,
    sort_order INTEGER NOT NULL DEFAULT 100, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(document_type_id, key));
  CREATE TABLE template_groups (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE templates (id INTEGER PRIMARY KEY, name TEXT, group_id INTEGER REFERENCES template_groups(id));
  -- documents carries FKs to BOTH templates(id) and document_types(id) with no
  -- ON DELETE action, exactly as the real schema does — this is what makes the
  -- reset's ordering (null the links before deleting) load-bearing.
  CREATE TABLE documents (
    id INTEGER PRIMARY KEY, status TEXT,
    template_id INTEGER REFERENCES templates(id),
    document_type_id INTEGER REFERENCES document_types(id),
    logo_phash TEXT, keyword_fingerprint TEXT, supplier_name TEXT, ocr_text TEXT,
    confirmed_at TEXT, review_acknowledged_at TEXT, working_path TEXT);
  CREATE TABLE supplier_hints (id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_name TEXT, document_type TEXT, field_key TEXT, hint_value TEXT, usage_count INTEGER, last_seen TEXT);
  CREATE TABLE field_anchors (id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_name TEXT, document_type TEXT, field_key TEXT, last_seen TEXT);
  CREATE TABLE logo_fingerprints (id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_name TEXT, phash TEXT, last_seen TEXT);
  CREATE TABLE corrections (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT, corrected_value TEXT, supplier_name TEXT, document_type TEXT, corrected_at TEXT);
  CREATE TABLE template_fields (id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER REFERENCES templates(id) ON DELETE CASCADE, field_key TEXT);
  CREATE TABLE template_field_mappings (id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER REFERENCES templates(id) ON DELETE CASCADE, field_key TEXT);
`);

// Kept state
db.prepare(`INSERT INTO settings VALUES ('output_folder','C:/out'),('processing_mode','smart'),('license_enforcement_enabled','true')`).run();
db.prepare(`INSERT INTO license_tokens (id,kind,token_blob) VALUES (1,'seat','jws...')`).run();

// Built-in type (kept) + a custom type (erased), each with a field.
db.prepare(`INSERT INTO document_types (id,name,slug,built_in) VALUES (1,'Invoice','invoice',1),(10,'My Custom','my_custom',0)`).run();
db.prepare(`INSERT INTO fields (document_type_id,key,label,built_in) VALUES (1,'invoice_number','Invoice No',1),(10,'job_ref','Job Ref',0)`).run();
// A custom field hanging off a BUILT-IN type must also be erased (built_in = 0).
db.prepare(`INSERT INTO fields (document_type_id,key,label,built_in) VALUES (1,'my_extra','Extra',0)`).run();

// Templates first — documents below carry an FK to templates(id), so the
// referenced rows must exist (foreign_keys = ON, like the real DB).
db.prepare(`INSERT INTO template_groups (id,name) VALUES (5,'Group A')`).run();
db.prepare(`INSERT INTO templates (id,name,group_id) VALUES (7,'Acme Invoice',5)`).run();
db.prepare(`INSERT INTO template_fields (template_id,field_key) VALUES (7,'total')`).run();
db.prepare(`INSERT INTO template_field_mappings (template_id,field_key) VALUES (7,'invoice_date')`).run();

// Documents: one confirmed doc carrying learned identity + referencing BOTH the
// template and the custom type (proves the FK-safe ordering), one already in the
// queue, one pending.
db.prepare(`INSERT INTO documents (id,status,template_id,document_type_id,logo_phash,keyword_fingerprint,supplier_name,ocr_text,confirmed_at,working_path)
            VALUES (1,'confirmed',7,10,'phash','{"k":1}','Acme','raw text','2025-01-01','C:/inbox/1.pdf')`).run();
db.prepare(`INSERT INTO documents (id,status,working_path) VALUES (2,'needs_review','C:/inbox/2.pdf')`).run();
db.prepare(`INSERT INTO documents (id,status,working_path) VALUES (3,'pending','C:/inbox/3.pdf')`).run();

// Learning corpora
db.prepare(`INSERT INTO supplier_hints (supplier_name,document_type,field_key,hint_value,usage_count) VALUES ('Acme','invoice','supplier_name','Acme',3)`).run();
db.prepare(`INSERT INTO field_anchors (supplier_name,document_type,field_key) VALUES ('Acme','invoice','total')`).run();
db.prepare(`INSERT INTO logo_fingerprints (supplier_name,phash) VALUES ('Acme','abcd')`).run();
db.prepare(`INSERT INTO corrections (document_id,field_key,corrected_value,supplier_name,document_type) VALUES (1,'total','10','Acme','invoice')`).run();

let fail = 0;
const r = learning.resetToFreshInstall(db);
console.log('counts:', JSON.stringify(r));

// Learning + templates wiped
for (const t of ['supplier_hints','field_anchors','logo_fingerprints','corrections',
                 'templates','template_fields','template_field_mappings','template_groups']) {
  fail += !check(`${t} fully cleared`, count(db, t) === 0);
}

// Custom schema gone; built-ins re-seeded (Invoice/Sales Order/Purchase Order)
fail += !check('returned custom counts (fields=2, types=1)',
  r.custom_fields === 2 && r.custom_document_types === 1);
fail += !check('no custom document types remain', db.prepare('SELECT COUNT(*) c FROM document_types WHERE built_in=0').get().c === 0);
fail += !check('no custom fields remain', db.prepare('SELECT COUNT(*) c FROM fields WHERE built_in=0').get().c === 0);
fail += !check('built-ins re-seeded (>=3 built-in types)', db.prepare('SELECT COUNT(*) c FROM document_types WHERE built_in=1').get().c >= 3);
fail += !check('original built-in type kept', db.prepare(`SELECT COUNT(*) c FROM document_types WHERE slug='invoice'`).get().c === 1);

// Documents kept but reset to a clean slate
fail += !check('all 3 documents kept', count(db, 'documents') === 3);
fail += !check('documents_reset count = 1 (only the confirmed/identity-bearing doc needed it)', r.documents_reset === 1);
const d1 = db.prepare('SELECT * FROM documents WHERE id=1').get();
fail += !check('confirmed doc requeued to needs_review', d1.status === 'needs_review');
fail += !check('learned identity stripped',
  d1.template_id === null && d1.logo_phash === null && d1.keyword_fingerprint === null &&
  d1.supplier_name === null && d1.document_type_id === null && d1.ocr_text === null &&
  d1.confirmed_at === null);
fail += !check('the file reference (working_path) is preserved', d1.working_path === 'C:/inbox/1.pdf');
fail += !check('pending doc left pending', db.prepare('SELECT status FROM documents WHERE id=3').get().status === 'pending');

// Kept state intact
fail += !check('settings untouched (3 rows)', count(db, 'settings') === 3);
fail += !check('licensing enforcement flag intact', db.prepare(`SELECT value FROM settings WHERE key='license_enforcement_enabled'`).get().value === 'true');
fail += !check('license_tokens untouched', count(db, 'license_tokens') === 1);

// Idempotent — a second run finds nothing left to erase or reset
const r2 = learning.resetToFreshInstall(db);
fail += !check('idempotent: second run erases/resets nothing',
  r2.supplier_hints === 0 && r2.templates === 0 &&
  r2.custom_fields === 0 && r2.custom_document_types === 0 && r2.documents_reset === 0);

db.close();
console.log(fail ? `\n${fail} FAILED` : '\nAll reset-fresh-install checks passed');
process.exit(fail ? 1 : 0);
