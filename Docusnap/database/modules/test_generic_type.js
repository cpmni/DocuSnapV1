#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_generic_type.js
 * -------------------------------------
 * Generic Document type slice 1 (docs/designs/GENERIC_DOCTYPE_2026-07-18.md §7):
 * the "General Document" preset creates with the right shape (NO ref role — first-class;
 * date role present; a `title` field; NO label seeds — Oracle C2's caption hazard),
 * addPresetTypes stays idempotent, the slug convention is PINNED, and getGenericType
 * honours existence + enabled.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_generic_type.js
 */

const Database = require('better-sqlite3');
const doctypes = require('./document_types');

let fails = 0;
function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; return cond; }

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE document_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT UNIQUE, built_in INTEGER DEFAULT 0,
      ref_field_key TEXT, date_field_key TEXT, sort_order INTEGER DEFAULT 100, enabled INTEGER DEFAULT 1
    );
    CREATE TABLE fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT, document_type_id INTEGER, key TEXT, label TEXT,
      type TEXT DEFAULT 'text', required INTEGER DEFAULT 0, built_in INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1, confidence_threshold REAL, sort_order INTEGER DEFAULT 100,
      UNIQUE(document_type_id, key)
    );
    CREATE TABLE field_label_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_type_slug TEXT NOT NULL, field_key TEXT NOT NULL, label TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(doc_type_slug, field_key, label)
    );
  `);
  return db;
}

console.log('§1 slug convention (PIN — main process + renderer both rely on the frozen literal)');
check("GENERIC_SLUG === 'general_document'", doctypes.GENERIC_SLUG === 'general_document');
check("presetSlug('General Document') === GENERIC_SLUG", doctypes.presetSlug('General Document') === doctypes.GENERIC_SLUG);

console.log('§2 catalog entry shape');
const entry = doctypes.PRESET_CATALOG.find(p => p.name === 'General Document');
check('catalog carries General Document', !!entry);
check('NO reference role (first-class ref-less — a forced ref trains junk-typing)', entry && entry.ref_field_key === null);
check("date role = 'date'", entry && entry.date_field_key === 'date');
check("company role = supplier_name", entry && entry.company_key === 'supplier_name');
check('ships a title field', entry && entry.fields.some(f => f.key === 'title' && f.type === 'text'));
check('Oracle C2: NO label seeds on ANY field (a "Title:" caption must never bind)',
  entry && entry.fields.every(f => !f.labels || !f.labels.length));

console.log('§3 addPresetTypes creates the type correctly');
const db = makeDb();
let res = doctypes.addPresetTypes(db, ['general_document']);
check('added', res.length === 1 && res[0].status === 'added' && res[0].slug === 'general_document');
const row = db.prepare("SELECT * FROM document_types WHERE slug = 'general_document'").get();
check('row exists, enabled', !!row && row.enabled === 1);
check('ref_field_key stays NULL after ensureStructuralRoles (ref deliberately not forced)', row && row.ref_field_key == null);
check('date_field_key set', row && row.date_field_key === 'date');
const fieldRows = db.prepare('SELECT key, type, required FROM fields WHERE document_type_id = ? ORDER BY sort_order').all(row.id);
check('fields = issuer + title + date', JSON.stringify(fieldRows.map(f => f.key).sort()) === JSON.stringify(['date', 'supplier_name', 'title']));
check('zero label overrides seeded', db.prepare('SELECT COUNT(*) c FROM field_label_overrides').get().c === 0);

console.log('§4 idempotent');
res = doctypes.addPresetTypes(db, ['general_document']);
check('re-add is a no-op', res.length === 1 && res[0].status === 'already_present');
check('no duplicate fields', db.prepare('SELECT COUNT(*) c FROM fields WHERE document_type_id = ?').get(row.id).c === fieldRows.length);

console.log('§5 getGenericType honours existence + enabled');
check('returns the row when enabled', doctypes.getGenericType(db) && doctypes.getGenericType(db).id === row.id);
db.prepare("UPDATE document_types SET enabled = 0 WHERE id = ?").run(row.id);
check('returns null when disabled', doctypes.getGenericType(db) === null);
db.prepare("UPDATE document_types SET enabled = 1 WHERE id = ?").run(row.id);
const empty = makeDb();
check('returns null when absent', doctypes.getGenericType(empty) === null);

console.log(`\n${fails ? 'FAIL' : 'PASS'} — ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
