#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_format_rules.js
 * -------------------------------------
 * Stage 7 Stage 3 — persistent learned format model (field_format_rules),
 * JS write/read/clear side in learning.js.
 *
 * Verifies:
 *   1. classifyFormatClass mirrors the Python coarse classifier (spot checks).
 *   2. updateFormatRules persists rules derived from confirmed history.
 *   3. getFieldFormatRules reads them back; rows are stored + inspectable.
 *   4. Strict (supplier, document_type, field_key) scoping — no cross-leak,
 *      and clearing one scope leaves another scope's rules intact.
 *   5. clearFieldFormatRulesForScope removes ONLY format rules — anchors,
 *      hints and logo fingerprints for the same supplier are untouched.
 *   6. "Update in place": history that loses consensus relaxes (removes) a
 *      previously-learned rule rather than leaving a stale constraint.
 *
 * Usage (from project root):
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_format_rules.js
 */

const Database = require('better-sqlite3');
const learning = require('./learning');

function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); return cond; }
let fail = 0;

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE document_types (id INTEGER PRIMARY KEY, slug TEXT);
  CREATE TABLE documents (
    id INTEGER PRIMARY KEY, supplier_name TEXT, document_type_id INTEGER,
    status TEXT, confirmed_at TEXT
  );
  CREATE TABLE extractions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER,
    field_key TEXT, display_value TEXT
  );
  CREATE TABLE corrections (
    id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER,
    field_key TEXT, corrected_value TEXT
  );
  CREATE TABLE field_format_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_name TEXT NOT NULL, document_type TEXT NOT NULL DEFAULT '',
    field_key TEXT NOT NULL, format_class TEXT NOT NULL,
    allowed_separators TEXT NOT NULL DEFAULT '', confirmed_count INTEGER NOT NULL DEFAULT 0,
    sample_values TEXT, created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(supplier_name, document_type, field_key)
  );
  -- other corpora, present only to prove clear-isolation
  CREATE TABLE field_anchors (
    id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_name TEXT, document_type TEXT,
    field_key TEXT, anchor_label TEXT, direction TEXT, page_zone TEXT,
    x_norm REAL, y_norm REAL, w_norm REAL DEFAULT 0, h_norm REAL DEFAULT 0,
    usage_count INTEGER DEFAULT 1, confidence REAL DEFAULT 1.0, last_seen TEXT
  );
  CREATE TABLE supplier_hints (
    id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_name TEXT, document_type TEXT,
    field_key TEXT, hint_value TEXT, usage_count INTEGER DEFAULT 1, last_seen TEXT
  );
  CREATE TABLE logo_fingerprints (
    id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_name TEXT, phash TEXT, ahash TEXT,
    match_count INTEGER DEFAULT 1, last_seen TEXT
  );
`);
db.prepare(`INSERT INTO document_types (id, slug) VALUES (1,'invoice'),(2,'purchase_order')`).run();

const doc = db.prepare(`INSERT INTO documents (id, supplier_name, document_type_id, status, confirmed_at) VALUES (?,?,?,?,?)`);
const ext = db.prepare(`INSERT INTO extractions (document_id, field_key, display_value) VALUES (?,?,?)`);

// ── Seed confirmed history ────────────────────────────────────────────────────
// Acme/invoice: invoice_number = pure digits (digits_only),
//               ref_code       = "AB-1" style (alphanum_sep, sep '-')
let id = 0, t = 1;
for (const [inv, ref] of [['1001', 'AB-1'], ['1002', 'AB-2'], ['1003', 'AB-3'], ['1004', 'AB-4']]) {
  doc.run(++id, 'Acme', 1, 'confirmed', `2026-06-${String(t++).padStart(2, '0')} 10:00:00`);
  ext.run(id, 'invoice_number', inv);
  ext.run(id, 'ref_code', ref);
}
// Beta/purchase_order: po_number = pure digits
for (const po of ['7001', '7002', '7003']) {
  doc.run(++id, 'Beta', 2, 'confirmed', `2026-06-${String(t++).padStart(2, '0')} 10:00:00`);
  ext.run(id, 'po_number', po);
}

// ── 1. classifyFormatClass spot checks ───────────────────────────────────────
console.log('\n1. classifyFormatClass mirror');
fail += !check('pure digits -> digits_only', learning.classifyFormatClass(['1001', '1002', '1003']).format_class === 'digits_only');
const sep = learning.classifyFormatClass(['AB-1', 'AB-2', 'AB-3']);
fail += !check('"AB-1" style -> alphanum_sep with sep "-"', sep.format_class === 'alphanum_sep' && sep.separators === '-');
fail += !check('disagreement -> freetext', learning.classifyFormatClass(['1001', 'AB-2', 'XY']).format_class === 'freetext');
fail += !check('<3 distinct -> freetext (no constraint)', learning.classifyFormatClass(['1', '1', '1']).format_class === 'freetext');

// ── 2-3. Persist + read back ──────────────────────────────────────────────────
console.log('\n2-3. updateFormatRules persists, getFieldFormatRules reads back');
const res = learning.updateFormatRules(db, { supplier_name: 'Acme', document_type: 'invoice' });
fail += !check('updateFormatRules reports upserts', res.upserted >= 2);
const rules = learning.getFieldFormatRules(db);
const ruleFor = (s, d, f) => rules.find(r => r.supplier_name === s && r.document_type === d && r.field_key === f);
fail += !check('invoice_number persisted as digits_only', (ruleFor('Acme', 'invoice', 'invoice_number') || {}).format_class === 'digits_only');
const rc = ruleFor('Acme', 'invoice', 'ref_code');
fail += !check('ref_code persisted as alphanum_sep with separators "-"', rc && rc.format_class === 'alphanum_sep' && rc.allowed_separators === '-');
fail += !check('rule carries confirmed_count (inspectable)', (ruleFor('Acme', 'invoice', 'invoice_number') || {}).confirmed_count >= 3);
const stored = db.prepare(`SELECT sample_values FROM field_format_rules WHERE field_key='invoice_number'`).get();
fail += !check('rule stores sample_values JSON (inspectable)', !!stored && JSON.parse(stored.sample_values).length >= 3);

// ── 4. Scoping isolation ──────────────────────────────────────────────────────
console.log('\n4. Strict scoping isolation');
learning.updateFormatRules(db, { supplier_name: 'Beta', document_type: 'purchase_order' });
fail += !check('Beta/purchase_order gets its own rule', (ruleFor2(db, 'Beta', 'purchase_order', 'po_number')) === 'digits_only');
fail += !check('Acme rules unaffected by Beta update', (learning.getFieldFormatRules(db).filter(r => r.supplier_name === 'Acme').length) === 2);

const cleared = learning.clearFieldFormatRulesForScope(db, { supplier_name: 'Acme', document_type: 'invoice' });
fail += !check('clearing Acme/invoice removes exactly its 2 rules', cleared.changes === 2);
fail += !check('Beta rule survives clearing Acme', ruleFor2(db, 'Beta', 'purchase_order', 'po_number') === 'digits_only');

// ── 5. Clear isolation from other corpora ─────────────────────────────────────
console.log('\n5. Clear touches ONLY format rules');
db.prepare(`INSERT INTO field_anchors (supplier_name, document_type, field_key, anchor_label, direction, x_norm, y_norm) VALUES ('Beta','purchase_order','po_number','PO No','right',0.5,0.5)`).run();
db.prepare(`INSERT INTO supplier_hints (supplier_name, document_type, field_key, hint_value) VALUES ('Beta','purchase_order','po_number','7001')`).run();
db.prepare(`INSERT INTO logo_fingerprints (supplier_name, phash, ahash) VALUES ('Beta','abcd','ef01')`).run();
learning.clearFieldFormatRulesForScope(db, { supplier_name: 'Beta', document_type: 'purchase_order' });
fail += !check('Beta format rule removed', learning.getFieldFormatRules(db).filter(r => r.supplier_name === 'Beta').length === 0);
fail += !check('Beta anchor untouched by format-rule clear', db.prepare(`SELECT COUNT(*) n FROM field_anchors WHERE supplier_name='Beta'`).get().n === 1);
fail += !check('Beta hint untouched by format-rule clear', db.prepare(`SELECT COUNT(*) n FROM supplier_hints WHERE supplier_name='Beta'`).get().n === 1);
fail += !check('Beta logo untouched by format-rule clear', db.prepare(`SELECT COUNT(*) n FROM logo_fingerprints WHERE supplier_name='Beta'`).get().n === 1);

// ── 6. Update-in-place: losing consensus relaxes the rule ─────────────────────
console.log('\n6. Update in place — relaxation when history loses consensus');
learning.updateFormatRules(db, { supplier_name: 'Acme', document_type: 'invoice' });   // re-learn digits_only
fail += !check('invoice_number rule re-learned as digits_only', ruleFor2(db, 'Acme', 'invoice', 'invoice_number') === 'digits_only');
// Two newer confirmed docs make the 3 most-recent values disagree -> freetext.
for (const v of ['ZZ99', 'YY88']) {
  doc.run(++id, 'Acme', 1, 'confirmed', `2026-07-${String(t++).padStart(2, '0')} 10:00:00`);
  ext.run(id, 'invoice_number', v);
}
learning.updateFormatRules(db, { supplier_name: 'Acme', document_type: 'invoice' });
fail += !check('stale digits_only rule removed when newest values disagree', ruleFor2(db, 'Acme', 'invoice', 'invoice_number') === null);

db.close();
console.log(fail ? `\n${fail} FAILED` : '\nAll field_format_rules checks passed');
process.exit(fail ? 1 : 0);

// helper: current persisted class for a key, or null
function ruleFor2(db, s, d, f) {
  const r = db.prepare(`SELECT format_class FROM field_format_rules WHERE supplier_name=? AND document_type=? AND field_key=?`).get(s, d, f);
  return r ? r.format_class : null;
}
