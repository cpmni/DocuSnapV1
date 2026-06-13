#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_format_rules_global_scope.js
 * --------------------------------------------------
 * Stage 7 Stage 3 — enforce field_format_rules as GLOBAL learned memory keyed by
 * (supplier_name, document_type, field_key), NOT template-only learning.
 *
 * Models the real Debug/ evidence set: "Document Solutions / Service Worksheet"
 * documents, every one with template_id = NULL, sharing one scope and a
 * recurring ticket_no shape ("2601-0195-1" -> alphanum_sep, sep '-').
 *
 * Proves:
 *   1. updateFormatRules LEARNS from confirmed docs that have NO template link
 *      (template_id NULL) — an existing template is not required to activate it.
 *   2. The learned rule is keyed by scope, so it is returned for the scope
 *      (visible to later/unseen docs in scope) regardless of template linkage —
 *      a doc linked to a DIFFERENT template in the same scope shares it.
 *   3. clearFieldFormatRulesForScope removes ONLY field_format_rules — anchors,
 *      hints, logos, templates and template OCR-auto settings are untouched.
 *
 * Usage (from project root):
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_format_rules_global_scope.js
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
    status TEXT, confirmed_at TEXT, template_id INTEGER          -- template link present, often NULL
  );
  CREATE TABLE extractions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT, display_value TEXT
  );
  CREATE TABLE corrections (
    id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT, corrected_value TEXT
  );
  CREATE TABLE field_format_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_name TEXT NOT NULL, document_type TEXT NOT NULL DEFAULT '',
    field_key TEXT NOT NULL, format_class TEXT NOT NULL,
    allowed_separators TEXT NOT NULL DEFAULT '', confirmed_count INTEGER NOT NULL DEFAULT 0,
    sample_values TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(supplier_name, document_type, field_key)
  );
  -- corpora that must NOT be touched by a format-rules clear
  CREATE TABLE field_anchors (id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_name TEXT, document_type TEXT, field_key TEXT, anchor_label TEXT, direction TEXT, x_norm REAL, y_norm REAL);
  CREATE TABLE supplier_hints (id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_name TEXT, document_type TEXT, field_key TEXT, hint_value TEXT);
  CREATE TABLE logo_fingerprints (id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_name TEXT, phash TEXT, ahash TEXT);
  CREATE TABLE templates (id INTEGER PRIMARY KEY, name TEXT, ocr_auto_enabled INTEGER DEFAULT 0, ocr_auto_params TEXT);
`);
db.prepare(`INSERT INTO document_types (id, slug) VALUES (1,'service_worksheet')`).run();

const doc = db.prepare(`INSERT INTO documents (id, supplier_name, document_type_id, status, confirmed_at, template_id) VALUES (?,?,?,?,?,?)`);
const ext = db.prepare(`INSERT INTO extractions (document_id, field_key, display_value) VALUES (?,?,?)`);

const SUP = 'Document Solutions';
const TICKETS = ['2601-0195-1', '2602-0926-1', '2602-0768-1', '2602-0527-1'];

// ── 1. Learn from confirmed docs that have NO template link ───────────────────
console.log('\n1. Learn from NON-template-linked documents (template_id NULL)');
let id = 0, t = 1;
for (const tk of TICKETS) {
  // template_id NULL on every learning document — no template exists/links here.
  doc.run(++id, SUP, 1, 'confirmed', `2026-06-${String(t++).padStart(2, '0')} 10:00:00`, null);
  ext.run(id, 'ticket_no', tk);
}
fail += !check('all learning docs are template_id NULL (no template link)',
  db.prepare(`SELECT COUNT(*) n FROM documents WHERE template_id IS NULL`).get().n === TICKETS.length);

const res = learning.updateFormatRules(db, { supplier_name: SUP, document_type: 'service_worksheet' });
fail += !check('updateFormatRules learned a rule despite NO template', res.upserted >= 1);
const rule = learning.getFieldFormatRules(db).find(r => r.field_key === 'ticket_no');
fail += !check('ticket_no learned as alphanum_sep with sep "-"',
  rule && rule.format_class === 'alphanum_sep' && rule.allowed_separators === '-');

// ── 2. Rule is keyed by scope → visible to later docs regardless of template ──
console.log('\n2. Rule is global within scope (not bound to a template or one doc)');
// A brand-new, unseen doc in the same scope linked to a DIFFERENT template (id 99).
doc.run(++id, SUP, 1, 'confirmed', `2026-06-20 10:00:00`, 99);
ext.run(id, 'ticket_no', '2606-1111-1');
const visible = learning.getFieldFormatRules(db).some(r =>
  r.supplier_name === SUP && r.document_type === 'service_worksheet' && r.field_key === 'ticket_no');
fail += !check('scope rule is present/returned for the pipeline (visible to any in-scope doc)', visible);
fail += !check('rule row is not duplicated per-template (single scope-keyed row)',
  db.prepare(`SELECT COUNT(*) n FROM field_format_rules WHERE field_key='ticket_no'`).get().n === 1);

// ── 3. Clear touches ONLY field_format_rules ──────────────────────────────────
console.log('\n3. Clear removes ONLY format rules (anchors/hints/logos/templates/OCR-auto safe)');
db.prepare(`INSERT INTO field_anchors (supplier_name, document_type, field_key, anchor_label, direction, x_norm, y_norm) VALUES (?, 'service_worksheet','ticket_no','Ticket No','right',0.4,0.3)`).run(SUP);
db.prepare(`INSERT INTO supplier_hints (supplier_name, document_type, field_key, hint_value) VALUES (?, 'service_worksheet','contract','EASTK686')`).run(SUP);
db.prepare(`INSERT INTO logo_fingerprints (supplier_name, phash, ahash) VALUES (?, 'bc98e7c3c7434c98','ef01')`).run(SUP);
db.prepare(`INSERT INTO templates (id, name, ocr_auto_enabled, ocr_auto_params) VALUES (99,'Document Solutions WS',1,'{"threshold":180}')`).run();

const cleared = learning.clearFieldFormatRulesForScope(db, { supplier_name: SUP, document_type: 'service_worksheet' });
fail += !check('format rule(s) cleared for scope', cleared.changes === 1);
fail += !check('field_format_rules now empty for scope', learning.getFieldFormatRules(db).length === 0);
fail += !check('field_anchors untouched', db.prepare(`SELECT COUNT(*) n FROM field_anchors`).get().n === 1);
fail += !check('supplier_hints untouched', db.prepare(`SELECT COUNT(*) n FROM supplier_hints`).get().n === 1);
fail += !check('logo_fingerprints untouched', db.prepare(`SELECT COUNT(*) n FROM logo_fingerprints`).get().n === 1);
fail += !check('templates row untouched', db.prepare(`SELECT COUNT(*) n FROM templates`).get().n === 1);
fail += !check('template OCR-auto settings untouched (ocr_auto_enabled still 1)',
  db.prepare(`SELECT ocr_auto_enabled e FROM templates WHERE id=99`).get().e === 1);

db.close();
console.log(fail ? `\n${fail} FAILED` : '\nAll global-scope / template-independence checks passed');
process.exit(fail ? 1 : 0);
