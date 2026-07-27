'use strict';
/*
 * test_field_visibility_resolve.js — templates.findForSupplierType, the LIVE field-visibility resolver
 * (Review resolves a supplier's hidden-field layout by the ENTERED issuer even when no template matched).
 * mode 1 = name first + branding fingerprint backup; mode 2 = name only. Fail-safe: unresolved => null
 * (caller shows ALL fields). Run: ELECTRON_RUN_AS_NODE=1 <electron> database/modules/test_field_visibility_resolve.js
 */
const Database  = require('better-sqlite3');
const templates = require('./templates');

let failures = 0;
function check(label, cond) { console.log((cond ? '  OK  ' : '  BAD ') + label); if (!cond) failures++; }
function section(t) { console.log('\n' + t); }

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT UNIQUE,
    document_type_slug TEXT, keyword_fingerprint TEXT, confirmed_count INTEGER DEFAULT 0);`);
  return db;
}
let seq = 0;
function mkT(db, name, slug, fp, cc = 0) {
  return db.prepare("INSERT INTO templates (name, slug, document_type_slug, keyword_fingerprint, confirmed_count) VALUES (?,?,?,?,?)")
    .run(name, `${slug}_${++seq}`, slug, JSON.stringify(fp || []), cc).lastInsertRowid;
}
const FP = ['saltmarsh', 'seafoods', 'grimsby', 'harbour'];
const R = (db, o) => templates.findForSupplierType(db, o);

section('mode 1: entered NAME matches → resolves that template');
{
  const db = makeDb();
  const t = mkT(db, 'Saltmarsh Seafoods', 'service_worksheet', FP, 5);
  check('exact name → id', R(db, { supplier_name: 'Saltmarsh Seafoods', document_type_slug: 'service_worksheet', mode: 1 }) === t);
  check('case/spacing-insensitive name → id', R(db, { supplier_name: '  saltmarsh   seafoods ', document_type_slug: 'service_worksheet', mode: 1 }) === t);
}

section('mode 1: name MISS but branding fingerprint matches → branding backup resolves');
{
  const db = makeDb();
  const t = mkT(db, 'SS Ltd', 'service_worksheet', FP, 5);   // name won't match "Saltmarsh Seafoods"
  check('branding backup → id', R(db, { supplier_name: 'Saltmarsh Seafoods', document_type_slug: 'service_worksheet', keyword_fingerprint: FP, mode: 1 }) === t);
}

section('mode 2: name-only — matches by name, IGNORES branding');
{
  const db = makeDb();
  const t = mkT(db, 'SS Ltd', 'service_worksheet', FP, 5);
  check('name miss + would-match branding → null (mode 2 ignores branding)',
    R(db, { supplier_name: 'Saltmarsh Seafoods', document_type_slug: 'service_worksheet', keyword_fingerprint: FP, mode: 2 }) === null);
  check('name hit → id (mode 2)',
    R(db, { supplier_name: 'SS Ltd', document_type_slug: 'service_worksheet', keyword_fingerprint: FP, mode: 2 }) === t);
}

section('fail-safe: nothing to resolve → null (caller shows ALL fields)');
{
  const db = makeDb();
  mkT(db, 'Saltmarsh Seafoods', 'service_worksheet', FP, 5);
  check('empty supplier + no fp → null', R(db, { supplier_name: '', document_type_slug: 'service_worksheet', mode: 1 }) === null);
  check('no slug → null', R(db, { supplier_name: 'Saltmarsh Seafoods', document_type_slug: null, mode: 1 }) === null);
  check('1-2 char supplier → null (too short to match)', R(db, { supplier_name: 'SS', document_type_slug: 'service_worksheet', mode: 1 }) === null);
}

section('richest tie-break: two same-name templates → highest confirmed_count wins');
{
  const db = makeDb();
  const poor = mkT(db, 'Saltmarsh Seafoods', 'service_worksheet', FP, 2);
  const rich = mkT(db, 'Saltmarsh Seafoods', 'service_worksheet', FP, 9);
  check('richest wins', R(db, { supplier_name: 'Saltmarsh Seafoods', document_type_slug: 'service_worksheet', mode: 1 }) === rich);
}

section('slug scoping: same name, different type → not resolved');
{
  const db = makeDb();
  mkT(db, 'Saltmarsh Seafoods', 'invoice', FP, 5);
  check('different slug → null', R(db, { supplier_name: 'Saltmarsh Seafoods', document_type_slug: 'service_worksheet', mode: 1 }) === null);
}

section('getHiddenFieldsForSupplierType: UNION across duplicate same-name+type templates (2026-07-27)');
{
  const db = makeDb();
  db.exec("CREATE TABLE template_hidden_fields (template_id INTEGER, field_key TEXT, hidden_at TEXT DEFAULT '', UNIQUE(template_id, field_key));");
  const configd = mkT(db, 'Northgate Textiles', 'service_worksheet', FP, 0);   // the sibling the owner configured
  const empty   = mkT(db, 'Northgate Textiles', 'service_worksheet', FP, 0);   // the duplicate the logo matched
  db.prepare("INSERT INTO template_hidden_fields (template_id, field_key) VALUES (?, 'item'), (?, 'serial_no')").run(configd, configd);
  const H = (o) => templates.getHiddenFieldsForSupplierType(db, o);
  check('union across both Northgate worksheet siblings → {item, serial_no} (duplicate-proof)',
    JSON.stringify(H({ supplier_name: 'Northgate Textiles', document_type_slug: 'service_worksheet', mode: 1 })) === JSON.stringify(['item', 'serial_no']));
  check('the EMPTY-sibling case (the owner bug): getHiddenFields(matched)=[] but the union lifts it to 2',
    templates.getHiddenFields(db, empty).length === 0 &&
    H({ supplier_name: 'Northgate Textiles', document_type_slug: 'service_worksheet', mode: 1 }).length === 2);
  const inv = mkT(db, 'Northgate Textiles', 'invoice', FP, 0);
  db.prepare("INSERT INTO template_hidden_fields (template_id, field_key) VALUES (?, 'vat_no')").run(inv);
  check('slug-scoped: a same-NAME invoice sibling is NOT unioned into the worksheet set',
    !H({ supplier_name: 'Northgate Textiles', document_type_slug: 'service_worksheet', mode: 1 }).includes('vat_no'));
  check('fail-safe: unknown supplier → [] (show all)',
    H({ supplier_name: 'Totally Different Co', document_type_slug: 'service_worksheet', mode: 1 }).length === 0);
  check('fail-safe: 1-2 char supplier → [] (too short, no branding) ',
    H({ supplier_name: 'NT', document_type_slug: 'service_worksheet', mode: 1 }).length === 0);
  check('inert: no template_hidden_fields table → []',
    templates.getHiddenFieldsForSupplierType(makeDb(), { supplier_name: 'Northgate Textiles', document_type_slug: 'service_worksheet', mode: 1 }).length === 0);
}

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' check(s) FAILED'));
process.exit(failures === 0 ? 0 : 1);
