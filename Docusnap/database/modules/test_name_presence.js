'use strict';
// Pins for the per-supplier NAME-PRESENCE veto (namePresence.js) — Oracle SIGN-OFF-WITH-CONDITIONS
// 2026-07-24. C2 (exact parity with engine._template_identity_corroborated), C3 (the load-bearing
// trade-off + every abstain arm), the identifyByFingerprint wiring, and the kill switch.
// Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_name_presence.js
const assert = require('assert');
const Database = require('better-sqlite3');
const np = require('./namePresence');
const templates = require('./templates');   // primes the lazy require + fails fast if it can't load

let pass = 0, fail = 0;
function check(label, cond) { if (cond) { pass++; console.log('  OK  ' + label); } else { fail++; console.log('  BAD ' + label); } }

// ── C2: EXACT parity with engine._template_identity_corroborated (engine.py:745-766) ──────────────
// Pin the generic set VERBATIM against the Python source (engine.py:759-760) so a JS edit goes red.
const PY_GENERIC = ['ltd', 'limited', 'plc', 'llp', 'inc', 'incorporated', 'co', 'company', 'corp',
                    'group', 'holdings', 'services', 'service', 'the', 'and'];
console.log('=== C2 parity ===');
check('generic set == Python engine.py:759-760 verbatim',
      JSON.stringify([...np.GENERIC_NAME_TOKENS].sort()) === JSON.stringify([...PY_GENERIC].sort()));
check('full name present -> corroborated', np.nameCorroborated('Larkspur Interiors', 'from Larkspur Interiors Ltd') === true);
check('generic-only name -> false (no distinctive tokens)', np.nameCorroborated('The Company Ltd', 'the company ltd here') === false);
check('1/3 present (<0.6) -> false', np.nameCorroborated('Alpha Beta Gamma', 'only alpha here') === false);
check('2/3 present (>=0.6) -> true', np.nameCorroborated('Alpha Beta Gamma', 'alpha beta here') === true);
check('whole-word only: "saltmarshes" does NOT match "saltmarsh"', np.nameCorroborated('Saltmarsh', 'the saltmarshes pond') === false);
check('len<3 token ignored (only "xy" -> no tokens -> false)', np.nameCorroborated('Xy', 'xy xy xy') === false);
check('generic suffix ignored, distinctive counts ("Larkspur Ltd" needs Larkspur)',
      np.nameCorroborated('Larkspur Ltd', 'invoice from larkspur') === true);

// ── Fixture DB: name-bearing / name-less / young suppliers ────────────────────────────────────────
const db = new Database(':memory:');
db.exec(`
  CREATE TABLE templates (id INTEGER PRIMARY KEY, name TEXT, logo_phash TEXT, keyword_fingerprint TEXT, document_type_slug TEXT);
  CREATE TABLE template_fields (template_id INTEGER, field_key TEXT, is_variable INTEGER, fixed_value TEXT);
  CREATE TABLE documents (id INTEGER PRIMARY KEY, template_id INTEGER, status TEXT, supplier_name TEXT, ocr_text TEXT);
`);
const insT = db.prepare("INSERT INTO templates (id,name,logo_phash,keyword_fingerprint,document_type_slug) VALUES (?,?,?,?,?)");
const insD = db.prepare("INSERT INTO documents (template_id,status,supplier_name,ocr_text) VALUES (?,?,?,?)");
// candidate pages (>=50 tokens so the thin-scan floor passes)
const SALT = 'Saltmarsh Seafoods The Harbour Fisher Quay Grimsby SALES ORDER Sales Order No SO 61010 Order Date 02 06 2026 Customer Redwood Construction Site Office Foundry Lane Wakefield Description Unit Qty Amount Extended warranty Monthly rental Premium unit Fitting kit Consumables pack Standard unit Net Total VAT Order Total nothing here belongs to that other supplier';
const LARK = 'Larkspur Interiors ' + SALT;   // same page but WITH the Larkspur name
const THIN = 'SO 61010 Order Date';           // < 50 tokens
insT.run(1, 'Larkspur Interiors', null, null, 'sales_order');
insT.run(3, 'Zephyr Ironworks', null, null, 'sales_order');
insT.run(4, 'Young Co', null, null, 'sales_order');
insT.run(5, 'Widgetco', null, JSON.stringify(['acme', 'depot']), 'sales_order');  // keyword-arm fixture
// Larkspur: 4 confirmed, name present in all -> ratio 1.0, count 4 (NAME-BEARING)
for (let i = 0; i < 4; i++) insD.run(1, 'confirmed', 'Larkspur Interiors', 'delivery from Larkspur Interiors Ltd invoice');
// Zephyr Ironworks: 4 confirmed, name NEVER in text -> ratio 0 (NAME-LESS / logo-only letterhead)
for (let i = 0; i < 4; i++) insD.run(3, 'confirmed', 'Zephyr Ironworks', 'a plain delivery docket with item lines and totals and a letterhead image');
// Young Co: 2 confirmed with name -> count 2 < MIN_SAMPLE
for (let i = 0; i < 2; i++) insD.run(4, 'confirmed', 'Young Co', 'invoice from Young Co Ltd');
// Widgetco: 4 confirmed, name present -> ratio 1.0 (NAME-BEARING); candidate below matches its
// keyword fingerprint (acme/depot) but does NOT carry "widgetco"
for (let i = 0; i < 4; i++) insD.run(5, 'confirmed', 'Widgetco', 'purchase order from Widgetco acme depot goods');

console.log('\n=== supplierNamePresenceRatio ===');
check('Larkspur ratio 1.0 count 4', (() => { const r = np.supplierNamePresenceRatio(db, 'Larkspur Interiors'); return r.count === 4 && r.ratio === 1; })());
check('Zephyr ratio 0 count 4 (name-less)', (() => { const r = np.supplierNamePresenceRatio(db, 'Zephyr Ironworks'); return r.count === 4 && r.ratio === 0; })());

console.log('\n=== C3: nameBearingButAbsent (trade-off + abstains) ===');
check('THE INCIDENT: name-bearing Larkspur, candidate lacks name -> VETO (true)', np.nameBearingButAbsent(db, 1, SALT) === true);
check('abstain: name IS present on candidate -> false', np.nameBearingButAbsent(db, 1, LARK) === false);
check('abstain: name-LESS supplier (ratio<0.80) -> false', np.nameBearingButAbsent(db, 3, SALT) === false);
check('abstain: young supplier (count<3) -> false', np.nameBearingButAbsent(db, 4, SALT) === false);
check('abstain: thin candidate (<50 tokens) -> false', np.nameBearingButAbsent(db, 1, THIN) === false);
check('abstain: unjudgeable identity (unknown template) -> false', np.nameBearingButAbsent(db, 999, SALT) === false);

console.log('\n=== kill switch ===');
process.env.TEMPLATE_NAME_PRESENCE_VETO = '0';
check('OFF -> false (byte-identical) even on the incident', np.nameBearingButAbsent(db, 1, SALT) === false);
delete process.env.TEMPLATE_NAME_PRESENCE_VETO;
check('back ON -> incident vetoes again', np.nameBearingButAbsent(db, 1, SALT) === true);

console.log('\n=== identifyByFingerprint wiring (keyword arm gated) ===');
// candidate matches Widgetco's keyword fingerprint (acme/depot present) but lacks "widgetco":
const kwCand = 'acme depot ' + SALT;
check('keyword arm: name-bearing supplier, name absent -> identifyByFingerprint returns null (vetoed)',
      templates.identifyByFingerprint(db, { logo_phash: null, ocr_text: kwCand, document_type_slug: 'sales_order' }) === null);
process.env.TEMPLATE_NAME_PRESENCE_VETO = '0';
check('kill OFF: same keyword match is returned (byte-identical)',
      (() => { const m = templates.identifyByFingerprint(db, { logo_phash: null, ocr_text: kwCand, document_type_slug: 'sales_order' }); return m && m.template && m.template.id === 5; })());
delete process.env.TEMPLATE_NAME_PRESENCE_VETO;
// C4 note: the logo-arm × detail-veto composition (both AND into accept, monotonic) is exercised
// live in stress_test/template_name_presence_probe.js with the detail veto held ON in both arms.

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
console.log('ALL PASS');
