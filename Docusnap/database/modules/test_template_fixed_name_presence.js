'use strict';
/*
 * test_template_fixed_name_presence.js — JS side of TEMPLATE_FIXED_NAME_PRESENCE_VETO
 * (2026-07-31; gary + Oracle signed). Pins the getAll enrichment: each template whose
 * supplier_name field carries a FIXED value (the value template_matcher / _doctype_fixed_supplier
 * would STAMP as method 'template_fixed') rides supplier_prints_name = {supplier, ratio, count}
 * (namePresence.supplierNamePresenceRatio) to the Python engine, which uses it to BLANK an
 * un-named branding-conflict stamp whose name-printing supplier is absent from the page.
 * Python twin: python_backend/tests/test_template_fixed_name_presence.py.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 <electron> database/modules/test_template_fixed_name_presence.js
 */
const Database  = require('better-sqlite3');
const templates = require('./templates');

let failures = 0;
function check(label, cond) { console.log((cond ? '  OK  ' : '  BAD ') + label); if (!cond) failures++; }

function makeDb({ ocrTextCol = true } = {}) {
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
    CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT, template_id INTEGER, supplier_name TEXT${ocrTextCol ? ', ocr_text TEXT' : ''});
    CREATE TABLE extractions (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT, display_value TEXT);
  `);
  return db;
}

console.log('=== getAll enrichment: supplier_prints_name rides the templates JSON ===');
{
  const db = makeDb();
  const insT = db.prepare("INSERT INTO templates (id, name, slug, document_type_slug) VALUES (?,?,?,?)");
  const insF = db.prepare("INSERT INTO template_fields (template_id, field_key, fixed_value, is_variable) VALUES (?,?,?,?)");
  const insD = db.prepare("INSERT INTO documents (status, supplier_name, ocr_text) VALUES (?,?,?)");
  insT.run(1, 'Larkspur Interiors', 's1', 'purchase_order');
  insF.run(1, 'supplier_name', 'Larkspur Interiors', 0);         // fixed supplier → stampable
  insT.run(2, 'No Fixed Co', 's2', 'invoice');
  insF.run(2, 'supplier_name', null, 1);                          // variable → no stamp value
  insT.run(3, 'Larkspur Interiors SO', 's3', 'sales_order');
  insF.run(3, 'supplier_name', 'Larkspur Interiors', 0);         // same supplier → memoized path
  insT.run(4, 'Blank Fixed', 's4', 'invoice');
  insF.run(4, 'supplier_name', '   ', 0);                         // whitespace fixed → no entry
  // Larkspur: 4 confirmed docs, name in every ocr_text → ratio 1.0, count 4
  for (let i = 0; i < 4; i++) insD.run('confirmed', 'Larkspur Interiors', 'delivery from Larkspur Interiors Ltd invoice');
  const rows = templates.getAll(db);
  const t1 = rows.find(t => t.id === 1), t2 = rows.find(t => t.id === 2);
  const t3 = rows.find(t => t.id === 3), t4 = rows.find(t => t.id === 4);
  check('fixed-supplier template carries supplier_prints_name {supplier, ratio 1, count 4}',
        t1 && t1.supplier_prints_name && t1.supplier_prints_name.supplier === 'Larkspur Interiors'
        && t1.supplier_prints_name.ratio === 1 && t1.supplier_prints_name.count === 4);
  check('variable-supplier template carries NO supplier_prints_name key',
        t2 && !('supplier_prints_name' in t2));
  check('same fixed supplier on a sibling → identical stats (memoized per getAll pass)',
        t3 && t3.supplier_prints_name
        && JSON.stringify(t3.supplier_prints_name) === JSON.stringify(t1.supplier_prints_name));
  check('whitespace-only fixed_value → no entry (nothing stampable)',
        t4 && !('supplier_prints_name' in t4));
  db.close();
}

console.log('\n=== fail-safe: getAll never throws when the ratio query cannot run ===');
{
  const db = makeDb({ ocrTextCol: false });   // legacy documents table without ocr_text
  db.prepare("INSERT INTO templates (id, name, slug, document_type_slug) VALUES (9, 'X Co', 's9', 'invoice')").run();
  db.prepare("INSERT INTO template_fields (template_id, field_key, fixed_value, is_variable) VALUES (9, 'supplier_name', 'X Co', 0)").run();
  let rows = null, threw = false;
  try { rows = templates.getAll(db); } catch { threw = true; }
  check('getAll survives (pipeline reader must never throw)', !threw && Array.isArray(rows));
  const t9 = rows && rows.find(t => t.id === 9);
  check('degrades to {ratio 0, count 0} → the Python veto abstains (count < 3)',
        t9 && t9.supplier_prints_name && t9.supplier_prints_name.ratio === 0
        && t9.supplier_prints_name.count === 0);
  db.close();
}

console.log('');
if (failures) { console.log(`FAILED: ${failures} check(s)`); process.exit(1); }
console.log('ALL PASS');
