#!/usr/bin/env node
'use strict';
/*
 * test_upsert_issuer_precedence.js — A1 of the type-split arc (2026-08-22; gary → Oracle SIGN OFF,
 * no switch: a bug).
 *
 * THE INCIDENT: the owner confirmed a Nordwind quote (issuer field 'Nordwind Refrigeration Ltd') and
 * the template born from that confirm was NAMED '1 Refrigeration Ltd' — because `_upsertTemplate`
 * read the `supplier_name` PARAM first, and the Review renderer sends that param as
 * `currentDoc.supplier_name` = the MACHINE's pre-confirm read. `reviewService.confirm` itself already
 * uses allValues-first for documents.supplier_name (:426); the birth now mirrors it. The confirmed
 * value also feeds _supplierLinkOk, the established-name reuse, the hygiene and the seed prune.
 *
 * Pins: (1) param 'garble' + allValues 'Real Name' ⇒ template named 'Real Name'; (2) legacy caller
 * (param only, no allValues issuer) unchanged; (3) reviewService passes the CONFIRMED value to
 * learnTemplateOnCommit on both the single and bulk paths (source contract).
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/review/test_upsert_issuer_precedence.js
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');
const { runMigrations } = require('../../../database/index');
const documents = require('../../../database/modules/documents');
const templates = require('../../../database/modules/templates');
const { _upsertTemplate } = require('./handler');

let fails = 0;
const check = (label, cond, extra) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? `  [${extra}]` : ''}`); if (!cond) fails++; };

const db = new Database(':memory:');
runMigrations(db);
db.prepare("INSERT INTO document_types (id, name, slug, built_in, ref_field_key, date_field_key) VALUES (7, 'Quote', 'quote', 0, 'quote_number', 'quote_date')").run();
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a1-'));
const ctx = { path, fs, templatesDir: () => tmpDir };
const QUOTE_DT = {
  id: 7, name: 'Quote', slug: 'quote', ref_field_key: 'quote_number', date_field_key: 'quote_date',
  fields: [{ key: 'supplier_name', is_variable: 0 }, { key: 'quote_number', is_variable: 1 }, { key: 'quote_date', is_variable: 1 }],
};
const FP = ['Nordwind', 'Refrigeration', 'Ltd', 'Frostfield', 'Estate', 'Colderton', 'VAT', 'Reg', 'Quotation'];
const mkDoc = (phash) => Number(documents.insert(db, {
  original_filename: 'q.pdf', folder_path: '/in', status: 'needs_review', document_type_id: 7,
  logo_phash: phash, keyword_fingerprint: JSON.stringify(FP),
}).lastInsertRowid);

(async () => {
  console.log('A1 — the template is named after the CONFIRMED issuer, never the machine read:');
  const d1 = mkDoc('bec1c491916c6b3e');
  const r1 = await _upsertTemplate(ctx, db, d1, {
    allValues: { supplier_name: 'Nordwind Refrigeration Ltd', quote_number: 'NRQ-2551', quote_date: '01-01-2026' },
    document_type_slug: 'quote', supplier_name: '1 Refrigeration Ltd', dtInfo: QUOTE_DT,
  });
  const t1 = r1 && r1.templateId ? templates.getById(db, r1.templateId) : null;
  check("param '1 Refrigeration Ltd' + confirmed 'Nordwind Refrigeration Ltd' ⇒ template named 'Nordwind Refrigeration Ltd'",
        !!t1 && t1.name === 'Nordwind Refrigeration Ltd', JSON.stringify({ r1, name: t1 && t1.name }));
  const f1 = t1 ? db.prepare("SELECT fixed_value FROM template_fields WHERE template_id = ? AND field_key = 'supplier_name'").get(t1.id) : null;
  check('  → the frozen supplier_name is the confirmed value too', !!f1 && f1.fixed_value === 'Nordwind Refrigeration Ltd');

  console.log('\nlegacy caller (param only, no issuer in allValues) unchanged:');
  const d2 = mkDoc('0f0f0f0f0f0f0f0f');
  const r2 = await _upsertTemplate(ctx, db, d2, {
    allValues: { quote_number: 'Q-1', quote_date: '02-02-2026' },
    document_type_slug: 'quote', supplier_name: 'Harbour Glass Ltd', dtInfo: QUOTE_DT,
  });
  const t2 = r2 && r2.templateId ? templates.getById(db, r2.templateId) : null;
  check("param-only issuer still names the template ('Harbour Glass Ltd')", !!t2 && t2.name === 'Harbour Glass Ltd', JSON.stringify(r2));

  console.log('\nsource contract — reviewService hands learning the CONFIRMED issuer:');
  const svc = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'reviewService.js'), 'utf8');
  check('confirmedSupplier defined allValues-first',
        /const confirmedSupplier = String\(\(allValues && allValues\.supplier_name\) \|\| supplier_name \|\| ''\)\.trim\(\) \|\| null;/.test(svc));
  check('…and passed to learnTemplateOnCommit on the single path AND the bulk path',
        (svc.match(/learnTemplateOnCommit\(db, document_id, \{ document_type_slug, supplier_name: confirmedSupplier \}\)/g) || []).length === 2);
  const h = fs.readFileSync(path.join(__dirname, 'handler.js'), 'utf8');
  check('_upsertTemplate reads allValues.supplier_name BEFORE the param',
        /const confirmedIssuer = String\(\s*\n\s*\(allValues && allValues\.supplier_name && String\(allValues\.supplier_name\)\.trim\(\)\)\s*\n\s*\|\| \(supplier_name && supplier_name\.trim\(\)\)/.test(h));

  console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
