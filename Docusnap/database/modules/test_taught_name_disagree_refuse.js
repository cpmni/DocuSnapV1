#!/usr/bin/env node
'use strict';
/**
 * test_taught_name_disagree_refuse.js — mig 214 `taught_name_disagree_refuse` (DARK; 2026-09-24, Chris 09-23 teach round
 * card 1; gary Slice 2 → Oracle SIGN-OFF-W/COND C1-C7 after the census). The page-family disagreement refusal, extended
 * to a TAUGHT optional NAME-like field whose page witness (nameQuality ≥ 0.6 AND ≥ 2 tokens) read a different value.
 * Model: test_role_disagree_refuse_at100.js (in-memory schema, the real predicate through isAutoFileEligible).
 *   A  overall 100 (the gate-free road; needs role_disagree_refuse_at100 + trust_role_disagreement_refuse)
 *   B  sub-100 (docTrustGate's full loop, driven directly with the overlay so the other legs cannot mask the reason)
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_taught_name_disagree_refuse.js
 */
const Database = require('better-sqlite3');
const trust = require('./trust');
let fails = 0;
function check(label, cond, extra) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? ' — ' + extra : ''}`); if (!cond) fails++; return cond; }
function section(t) { console.log(`\n${t}`); }
const rec = (winner, family, value, extra = {}) => JSON.stringify({ winner_family: winner, agree: [], disagree: [{ family, value }], independent_agree: false, ...extra });
const AGREE = JSON.stringify({ winner_family: 'mapping', agree: ['keyword'], disagree: [], independent_agree: true });

function makeDb({ customerRequired = 0, customerType = 'text', switches = {} } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE document_types (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT UNIQUE, ref_field_key TEXT, date_field_key TEXT);
    CREATE TABLE fields (id INTEGER PRIMARY KEY AUTOINCREMENT, document_type_id INTEGER, key TEXT, label TEXT, type TEXT DEFAULT 'text', required INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1);
    CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_name TEXT, document_type_id INTEGER, status TEXT, confirmed_at TEXT, template_id INTEGER, overall_confidence INTEGER);
    CREATE TABLE extractions (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT, display_value TEXT, raw_value TEXT, confidence INTEGER, extraction_method TEXT, validation_note TEXT, corrected_to TEXT, corroboration TEXT);
    CREATE TABLE corrections (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT, original_value TEXT, corrected_value TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
  `);
  const tid = db.prepare("INSERT INTO document_types (name, slug, ref_field_key, date_field_key) VALUES ('Sales Order','sales_order','sales_order_number','order_date')").run().lastInsertRowid;
  const add = (key, label, type, req) => db.prepare('INSERT INTO fields (document_type_id, key, label, type, required) VALUES (?,?,?,?,?)').run(tid, key, label, type, req);
  add('supplier_name', 'Document Issuer', 'text', 1);
  add('order_date', 'Order Date', 'date', 1);
  add('sales_order_number', 'Sales Order Number', 'text', 1);
  add('customer_name', 'Customer', customerType, customerRequired);
  add('delivery_address', 'Delivery Address', 'text', 0);   // the address branch of isNameLikeField — OUT of v1 (C2)
  add('item', 'Item', 'text', 0);
  const setS = (k, v) => db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);
  setS('auto_file_threshold', '90');
  setS('trust_role_disagreement_refuse', 'true');
  setS('role_disagree_refuse_at100', 'true');
  setS('taught_name_disagree_refuse', 'true');
  for (const [k, v] of Object.entries(switches)) setS(k, v);
  return { db, tid };
}
function seedDoc(db, tid, { conf = 100, rows = {}, first = false } = {}) {
  const id = db.prepare('INSERT INTO documents (supplier_name, document_type_id, status, confirmed_at, template_id, overall_confidence) VALUES (?,?,?,?,?,?)')
    .run('Copperfield Electrical', tid, 'needs_review', null, 1, conf).lastInsertRowid;
  // `first`: insert the case rows BEFORE the base rows — the sub-100 loop returns on the first refusing row, and this
  // hand-rolled schema has no confirmed history, so the issuer's verifiability leg would otherwise answer first.
  if (first) for (const [k, spec] of Object.entries(rows)) {
    db.prepare('INSERT INTO extractions (document_id, field_key, display_value, confidence, extraction_method, corroboration, validation_note) VALUES (?,?,?,?,?,?,?)')
      .run(id, k, spec.value, spec.conf ?? 92, spec.method ?? 'template_mapping', spec.rec === undefined ? null : spec.rec, spec.note ?? null);
  }
  const base = [
    ['supplier_name', 'Copperfield Electrical', 96, 'template_fixed', AGREE],
    ['order_date', '12-07-2026', 94, 'template_mapping', AGREE],
    ['sales_order_number', 'SO-19736', 95, 'template_mapping', AGREE],
    ['item', 'Widget', 90, 'template_mapping', null],
  ];
  for (const [k, v, c, m, r] of base) {
    db.prepare('INSERT INTO extractions (document_id, field_key, display_value, confidence, extraction_method, corroboration) VALUES (?,?,?,?,?,?)').run(id, k, v, c, m, r);
  }
  if (!first) for (const [k, spec] of Object.entries(rows)) {
    db.prepare('INSERT INTO extractions (document_id, field_key, display_value, confidence, extraction_method, corroboration, validation_note) VALUES (?,?,?,?,?,?,?)')
      .run(id, k, spec.value, spec.conf ?? 92, spec.method ?? 'template_mapping', spec.rec === undefined ? null : spec.rec, spec.note ?? null);
  }
  return id;
}
const docRow = (db, id) => db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
function elig(db, id, opts = {}) { return trust.isAutoFileEligible(db, docRow(db, id), opts); }
const held = (r, key = 'customer_name') => r.eligible === false && r.reason === `disagreeing-read:${key}`;

section('A. overall 100 — the taught optional name field (the census population)');
{
  const { db, tid } = makeDb();
  // A1 the six sandbox pairs (box → page witness)
  const pairs = [
    ['Customer', 'Sandpiper Hotels'], ['Customer', 'Ashcombe Care Homes Ltd'],
    ['Larch & Hollaw cat. -.', 'Larch & Hollow Cafe Co'], ['Ashcombe Care Homec', 'Ashcombe Care Homes Ltd'],
    ['Larch & Hollow Cafe C', 'Larch & Hollow Cafe Co'], ['Ashcombe Care Homes', 'Ashcombe Care Homes Ltd'],
  ];
  for (const [box, wit] of pairs) {
    const id = seedDoc(db, tid, { rows: { customer_name: { value: box, rec: rec('mapping', 'keyword', wit) } } });
    check(`A1 box ${JSON.stringify(box)} vs page ${JSON.stringify(wit)} → disagreeing-read:customer_name`, held(elig(db, id)), JSON.stringify(elig(db, id)));
  }
  // A2 the human-corrected shapes + containment (no containment exemption)
  for (const [box, wit] of [['Cus', 'Ashcombe Care Homes Ltd'], ['Stonegate Property', 'Stonegate Property Mgmt'], ['Bluefin', 'Bluefin Marine Ltd'],
                            ['Workforce Training Springf', 'Workforce Training Springfield Rd'], ['Harvey', 'Harvey & Company Accountancy']]) {
    const id = seedDoc(db, tid, { rows: { customer_name: { value: box, rec: rec('mapping', 'keyword', wit) } } });
    check(`A2 clipped/garbled box ${JSON.stringify(box)} vs ${JSON.stringify(wit)} → held (containment is a catch, never exempt)`, held(elig(db, id)));
  }
  // DOCUMENTED PARITY GAP (JS-twin census, 2026-09-24): JS nameQuality has no COMMON_WORDS whitelist (Python's
  // value_quality.py:263 has one), so a witness token with a 4-consonant run ("Construction" → "nstr") scores 0 in JS
  // and the witness "Redwood Construction" falls below 0.6 → NOT held here although the Python census counted it a
  // catch. The divergence only ever LOSES a hold (JS holds ⊆ Python-30), never files a wrong value — an accepted v1
  // miss; closing it means a JS COMMON_WORDS twin in learning.nameQuality (own census, wider consumers).
  { const id = seedDoc(db, tid, { rows: { customer_name: { value: 'edwood Co', rec: rec('mapping', 'keyword', 'Redwood Construction') } } });
    check('A2′ parity gap pinned: "Redwood Construction" witness scores < 0.6 in JS → NOT held (a missed catch, never a wrong file)', elig(db, id).eligible === true); }
  // A3 the PINNED trade-off: an OCR-misread witness holds a correct box (do not fuzzy-fold rn→m)
  { const id = seedDoc(db, tid, { rows: { customer_name: { value: 'Fernbank Veterinary Clinic', rec: rec('mapping', 'keyword', 'Fembank Veterinary Clinic') } } });
    check('A3 TRADE-OFF pinned: correct box vs an OCR-misread witness (Fernbank/Fembank) → HELD (1 in 727, review-bound)', held(elig(db, id))); }
  // A4 NOT held: a lone-word witness (the census's 5 false holds)
  for (const [box, wit] of [['GAELCHURSAI', 'Make'], ['Kingfisher Print Studio', 'Studio'], ['Kingfisher Print Studio', 'Studio.'], ['Kingfisher Print Studio', '& Co']]) {
    const id = seedDoc(db, tid, { rows: { customer_name: { value: box, rec: rec('mapping', 'keyword', wit) } } });
    check(`A4 lone-word witness ${JSON.stringify(wit)} → NOT held (the ≥2-token guard)`, elig(db, id).eligible === true, JSON.stringify(elig(db, id)));
  }
  // C6 a legit single-token name misread stays an accepted miss (status quo)
  { const id = seedDoc(db, tid, { rows: { customer_name: { value: 'Siemans', rec: rec('mapping', 'keyword', 'Siemens') } } });
    check('C6 single-token witness Siemens vs box Siemans → NOT held (accepted miss; a char floor would re-admit the label class)', elig(db, id).eligible === true); }
  // A5 witness quality < 0.6
  { const id = seedDoc(db, tid, { rows: { customer_name: { value: 'Sandpiper Hotels', rec: rec('mapping', 'keyword', 'Cust0mer: Sandp 12 34') } } });
    check('A5 a junk witness (nameQuality < 0.6) → NOT held', elig(db, id).eligible === true, JSON.stringify(elig(db, id))); }
  // A6 unchanged classes
  { const id = seedDoc(db, tid, { rows: { customer_name: { value: 'Customer', rec: rec('keyword', 'mapping', 'Sandpiper Hotels') } } });
    check('A6 winner family keyword (not a taught box) → NOT held', elig(db, id).eligible === true); }
  { const id = seedDoc(db, tid, { rows: { customer_name: { value: 'Customer', rec: rec('mapping', 'memory', 'Sandpiper Hotels') } } });
    check('A6 witness family memory (near-circular) → NOT held', elig(db, id).eligible === true); }
  { const id = seedDoc(db, tid, { rows: { customer_name: { value: 'Customer', rec: rec('mapping', 'hint', 'Sandpiper Hotels') } } });
    check('A6 witness family hint → NOT held', elig(db, id).eligible === true); }
  { const id = seedDoc(db, tid, { rows: { item: { value: 'Customer', rec: rec('mapping', 'keyword', 'Sandpiper Hotels') } } });
    check('A6 a non-name key (item) → NOT held', elig(db, id).eligible === true); }
  { const id = seedDoc(db, tid, { rows: { delivery_address: { value: '12 High St, Leeds', rec: rec('mapping', 'keyword', '12 High Street Leeds LS1') } } });
    check('C2 the address branch is OUT of v1 (delivery_address) → NOT held', elig(db, id).eligible === true); }
  { const id = seedDoc(db, tid, { rows: { ghost_name: { value: 'Customer', rec: rec('mapping', 'keyword', 'Sandpiper Hotels') } } });
    const r = elig(db, id);
    check('C1 a shadow row (key not in fields) is never in scope → not disagreeing-read', r.reason !== 'disagreeing-read:ghost_name', JSON.stringify(r)); }
  // A9 mig-213 order: a +nonname_flag note hits flagged:<key> first
  { const id = seedDoc(db, tid, { rows: { customer_name: { value: 'Customer', method: 'template_mapping+nonname_flag', note: 'This reads as the label ‘Customer’, not a name — please check the value.', rec: rec('mapping', 'keyword', 'Sandpiper Hotels') } } });
    const r = elig(db, id);
    check('A9 a mig-213 noted row → flagged:<key> (isFlaggedReason), never disagreeing-read', trust.isFlaggedReason(r) && r.reason === 'flagged:customer_name', JSON.stringify(r)); }
  // A8 no record / malformed
  { const id = seedDoc(db, tid, { rows: { customer_name: { value: 'Customer' } } });
    check('A8 no corroboration record → eligible (fail-open)', elig(db, id).eligible === true); }
  { const id = seedDoc(db, tid, { rows: { customer_name: { value: 'Customer', rec: '{not json' } } });
    check('A8 malformed record → eligible', elig(db, id).eligible === true); }
  // A7 switches
  { const id = seedDoc(db, tid, { rows: { customer_name: { value: 'Customer', rec: rec('mapping', 'keyword', 'Sandpiper Hotels') } } });
    check('A7 opts.taughtNameDisagreeRefuse:false → eligible (byte-identical branch)', elig(db, id, { taughtNameDisagreeRefuse: false }).eligible === true);
    db.prepare("UPDATE settings SET value='false' WHERE key='taught_name_disagree_refuse'").run();
    check('A7 setting OFF → eligible', elig(db, id).eligible === true);
    db.prepare("UPDATE settings SET value='true' WHERE key='taught_name_disagree_refuse'").run();
    process.env.TAUGHT_NAME_DISAGREE_REFUSE = '0';
    check("A7 env '0' beats a 'true' setting → eligible", elig(db, id).eligible === true);
    delete process.env.TAUGHT_NAME_DISAGREE_REFUSE;
    check('A7 env cleared → held again', held(elig(db, id)));
    check('A7 role_disagree_refuse_at100 OFF at overall 100 → eligible (HARD dep)', elig(db, id, { roleDisagreeAt100: false }).eligible === true);
    check('A7 trust_role_disagreement_refuse OFF → eligible (HARD dep: no record is selected)', elig(db, id, { roleDisagreementRefuse: false }).eligible === true);
    // A10 the batch hoist
    const ids = trust.autoFileEligibleIds(db, [docRow(db, id)]);
    check('A10 autoFileEligibleIds drops it', !ids.includes(id), JSON.stringify(ids));
  }
  // the role leg is untouched: a date disagreement still refuses, an agreeing record files
  { const id = seedDoc(db, tid, { rows: { order_date: { value: '18-01-2026', conf: 96, rec: rec('mapping', 'keyword', '08/01/2026') } } });
    const r = elig(db, id);
    check('role leg untouched: order_date disagreement → disagreeing-read:order_date', r.reason === 'disagreeing-read:order_date' || r.reason === 'disagreeing-read:customer_name', r.reason); }
}

section('A′. a REQUIRED non-role name field is OUT of v1 (census scope — Oracle C1), a multiline name is OUT');
{
  const { db, tid } = makeDb({ customerRequired: 1 });
  const id = seedDoc(db, tid, { rows: { customer_name: { value: 'Customer', rec: rec('mapping', 'keyword', 'Sandpiper Hotels') } } });
  check('required=1 customer_name → not disagreeing-read (un-censused class, v1 out)', elig(db, id).reason !== 'disagreeing-read:customer_name');
}
{
  const { db, tid } = makeDb({ customerType: 'multiline_text' });
  const id = seedDoc(db, tid, { rows: { customer_name: { value: 'Customer', rec: rec('mapping', 'keyword', 'Sandpiper Hotels') } } });
  check('type multiline_text → not disagreeing-read (v1 = text only)', elig(db, id).reason !== 'disagreeing-read:customer_name');
}

section('B. sub-100 — the same predicate in docTrustGate\'s full loop (driven directly with the overlay)');
{
  const { db, tid } = makeDb();
  const id = seedDoc(db, tid, { conf: 96, first: true, rows: { customer_name: { value: 'Customer', rec: rec('mapping', 'keyword', 'Sandpiper Hotels') } } });
  const rows = db.prepare('SELECT field_key, display_value, raw_value, validation_note, extraction_method, corroboration FROM extractions WHERE document_id = ?').all(id);
  const g = trust.docTrustGate(db, id, 'Copperfield Electrical', 'sales_order', { extractions: rows, roleDisagreementRefuse: true, taughtNameDisagreeRefuse: true });
  check('B sub-100 road: docTrustGate refuses disagreeing-read:customer_name', g.ok === false && g.reason === 'disagreeing-read:customer_name', JSON.stringify(g));
  const g2 = trust.docTrustGate(db, id, 'Copperfield Electrical', 'sales_order', { extractions: rows, roleDisagreementRefuse: true, taughtNameDisagreeRefuse: false });
  check('B switch OFF → not that reason', g2.reason !== 'disagreeing-read:customer_name', JSON.stringify(g2));
}

section('C. the helpers');
check('_nameWitnessTokens: "Larch & Hollow Cafe" = 3, "& Co" = 1, "Studio." = 1, "" = 0',
      trust._nameWitnessTokens('Larch & Hollow Cafe') === 3 && trust._nameWitnessTokens('& Co') === 1 && trust._nameWitnessTokens('Studio.') === 1 && trust._nameWitnessTokens('') === 0);
check('_isNameOnlyKey: customer_name yes, delivery_address NO, item no, contact_person yes',
      trust._isNameOnlyKey('customer_name', 'Customer') && !trust._isNameOnlyKey('delivery_address', 'Delivery Address') && !trust._isNameOnlyKey('item', 'Item') && trust._isNameOnlyKey('contact_person', 'Contact'));
const fs = require('fs'), path = require('path');
const rend = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'windows', 'review', 'renderer.js'), 'utf8');
check("A11 Review has the 'disagreeing-read' copy with the action cue (Oracle C5)", /'disagreeing-read': fieldName/.test(rend) && /re-teach a wider box; if the box is right, just confirm\./.test(rend));

console.log(`\n${fails === 0 ? 'ALL OK' : 'FAILURES: ' + fails} (${fails} bad)`);
process.exit(fails ? 1 : 0);
