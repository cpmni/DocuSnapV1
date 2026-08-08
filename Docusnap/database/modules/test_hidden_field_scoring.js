'use strict';
/*
 * test_hidden_field_scoring.js — JS side of the HIDDEN_FIELD_SCORING parity pin (2026-07-27).
 *
 * The Python engine excludes operator-declared-absent EMPTY fields from the document score via
 * template_matcher.hidden_fields_for_scope — a byte-mirror of THIS module's display resolver
 * (getHiddenFieldsForSupplierType, name+group arms). Both suites consume the SAME vector file
 * (python_backend/tests/data/vis_norm_vectors.json): edit one resolver and the other side's
 * suite goes red. Also pins the getAll enrichment (t.hidden_fields rides the templates JSON to
 * Python) and its older-DB fail-safe.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 <electron> database/modules/test_hidden_field_scoring.js
 */
const path      = require('path');
const fs        = require('fs');
const Database  = require('better-sqlite3');
const templates = require('./templates');

let failures = 0;
function check(label, cond) { console.log((cond ? '  OK  ' : '  BAD ') + label); if (!cond) failures++; }
function section(t) { console.log('\n' + t); }

const VEC = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', '..', 'python_backend', 'tests', 'data', 'vis_norm_vectors.json'), 'utf8'));

function makeDb({ hiddenTable = true } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE templates (
      id INTEGER PRIMARY KEY, name TEXT, slug TEXT UNIQUE, document_type_slug TEXT,
      group_id INTEGER, logo_phash TEXT, keyword_fingerprint TEXT, sample_document_id INTEGER,
      confirmed_count INTEGER NOT NULL DEFAULT 0, ocr_auto_params TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE template_fields (id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER, field_key TEXT, anchor_label TEXT, direction TEXT, fixed_value TEXT, is_variable INTEGER, fixed_locked INTEGER DEFAULT 0);
    CREATE TABLE template_field_mappings (id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER, field_key TEXT);
    CREATE TABLE template_landmarks (id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER, label_text TEXT, page_number INTEGER);
    CREATE TABLE template_logo_hashes (id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER, phash TEXT, detail_hash TEXT, UNIQUE(template_id, phash));
    CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT, template_id INTEGER, supplier_name TEXT);
    CREATE TABLE extractions (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT, display_value TEXT);
  `);
  if (hiddenTable) {
    db.exec('CREATE TABLE template_hidden_fields (template_id INTEGER NOT NULL, field_key TEXT NOT NULL, hidden_at TEXT NOT NULL DEFAULT (datetime(\'now\')), PRIMARY KEY (template_id, field_key));');
  }
  return db;
}

function loadVectorDb(v) {
  const db = makeDb();
  for (const t of v.templates) {
    db.prepare('INSERT INTO templates (id, name, slug, document_type_slug, group_id, keyword_fingerprint) VALUES (?,?,?,?,?,?)')
      .run(t.id, t.name, `slug_${t.id}`, t.document_type_slug, t.group_id,
           JSON.stringify(t.keyword_fingerprint || []));
    for (const k of (t.hidden_fields || [])) {
      db.prepare('INSERT INTO template_hidden_fields (template_id, field_key) VALUES (?, ?)').run(t.id, k);
    }
  }
  return db;
}

section('norm parity: _normNameForVis matches the shared vectors (Python mirrors these exactly)');
for (const c of VEC.norm) {
  const got = templates._normNameForVis(c.in);
  check(`norm(${JSON.stringify(c.in)}) -> ${JSON.stringify(got)} (expect ${JSON.stringify(c.out)})`, got === c.out);
}

section('resolution parity: getHiddenFieldsForSupplierType (name+group arms, no fingerprint) matches the shared vectors');
for (const v of VEC.resolution) {
  const db = loadVectorDb(v);
  const got = templates.getHiddenFieldsForSupplierType(db, { supplier_name: v.supplier, document_type_slug: v.slug, mode: 1 });
  check(`resolve[${v.name}] -> ${JSON.stringify(got)} (expect ${JSON.stringify(v.expect)})`,
        JSON.stringify(got) === JSON.stringify(v.expect));
  db.close();
}

section('getAll enrichment: hidden_fields rides the templates JSON to the Python engine');
{
  const db = makeDb();
  db.prepare("INSERT INTO templates (id, name, slug, document_type_slug) VALUES (33, 'Northgate Textiles', 's33', 'service_worksheet')").run();
  db.prepare("INSERT INTO templates (id, name, slug, document_type_slug) VALUES (34, 'Northgate Textiles', 's34', 'service_worksheet')").run();
  db.prepare("INSERT INTO template_hidden_fields (template_id, field_key) VALUES (33, 'serial_no'), (33, 'item')").run();
  const rows = templates.getAll(db);
  const t33 = rows.find(t => t.id === 33), t34 = rows.find(t => t.id === 34);
  check('configured template carries its hidden_fields (sorted by key)',
        JSON.stringify(t33.hidden_fields) === JSON.stringify(['item', 'serial_no']));
  check('unconfigured sibling carries []', JSON.stringify(t34.hidden_fields) === JSON.stringify([]));
  db.close();
}
{
  const db = makeDb({ hiddenTable: false });   // older DB without migration 54
  db.prepare("INSERT INTO templates (id, name, slug, document_type_slug) VALUES (1, 'X Co', 's1', 'invoice')").run();
  const rows = templates.getAll(db);
  check('no template_hidden_fields table -> hidden_fields [] (older-DB fail-safe)',
        JSON.stringify(rows[0].hidden_fields) === JSON.stringify([]));
  db.close();
}

console.log('');
if (failures) { console.log(`FAILED: ${failures} check(s)`); process.exit(1); }
console.log('All hidden-field scoring parity checks passed.');
