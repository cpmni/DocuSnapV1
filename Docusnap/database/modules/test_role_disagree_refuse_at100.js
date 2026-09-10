#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_role_disagree_refuse_at100.js
 * ---------------------------------------------------
 * Pins the M=2 belt (mig 152, role_disagree_refuse_at100 — the DATE_LEFT_CLIP_M2 recommended fix,
 * Oracle C6/C7). The silent wrong-date auto-file (Copperfield sales_order #77/#78): a leading-day-digit
 * CLIP emits overall_confidence==100 despite a 94 order_date and NO note, so it rides the gate-free 100%
 * path — the trust_role_disagreement_refuse page-family leg that would catch it only runs sub-100.
 *
 * When ON, isAutoFileEligible runs THAT leg alone (roleDisagreeOnly) at overall==100 too: a ref/date role
 * whose value an independent PAGE family (keyword/crop/mapping) read DIFFERENTLY is refused. NOT the
 * over-blocking full at100 gate. HARD dep trust_role_disagreement_refuse ON. Byte-identical OFF.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_role_disagree_refuse_at100.js
 */

const Database = require('better-sqlite3');
const trust    = require('./trust');

let fails = 0;
function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; return cond; }
function section(t) { console.log(`\n${t}`); }

// A disagree record: an independent PAGE family read a DIFFERENT value on this role.
const DISAGREE_KW = JSON.stringify({ disagree: [{ family: 'keyword', value: '19-03-2026' }] });
// An agree record: independent agreement, no disagreement.
const AGREE = JSON.stringify({ independent_agree: true, winner_family: 'mapping', agree: ['keyword'] });

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE document_types (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT UNIQUE,
                                 ref_field_key TEXT, date_field_key TEXT);
    CREATE TABLE fields (id INTEGER PRIMARY KEY AUTOINCREMENT, document_type_id INTEGER, key TEXT,
                         label TEXT, type TEXT DEFAULT 'text', required INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1);
    CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_name TEXT, document_type_id INTEGER,
                            status TEXT, confirmed_at TEXT, template_id INTEGER, overall_confidence INTEGER);
    CREATE TABLE extractions (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT,
                              display_value TEXT, raw_value TEXT, confidence INTEGER, extraction_method TEXT,
                              validation_note TEXT, corrected_to TEXT, corroboration TEXT);
    CREATE TABLE corrections (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT,
                              original_value TEXT, corrected_value TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
  `);
  const tid = db.prepare("INSERT INTO document_types (name, slug, ref_field_key, date_field_key) VALUES ('Sales Order','sales_order','sales_order_number','order_date')").run().lastInsertRowid;
  const add = (key, type, req) => db.prepare('INSERT INTO fields (document_type_id, key, type, required) VALUES (?,?,?,?)').run(tid, key, type, req ? 1 : 0);
  add('supplier_name', 'text', 1);
  add('order_date', 'date', 1);
  add('sales_order_number', 'text', 1);
  add('item', 'text', 0);   // optional non-role field
  db.prepare("INSERT INTO settings (key,value) VALUES ('auto_file_threshold','90')").run();
  return { db, tid };
}

/** A clean 100%-confidence sales_order with every required role filled; `corr` maps field_key -> corroboration JSON. */
function seedDoc(db, tid, { conf = 100, template = 1, corr = {}, dateVal = '09-03-2026' } = {}) {
  const id = db.prepare('INSERT INTO documents (supplier_name, document_type_id, status, confirmed_at, template_id, overall_confidence) VALUES (?,?,?,?,?,?)')
    .run('Copperfield Ltd', tid, 'needs_review', null, template, conf).lastInsertRowid;
  const rows = [
    ['supplier_name', 'Copperfield Ltd', 96],
    ['order_date', dateVal, 94],                 // the clipped date reads confidently (94) but WRONG
    ['sales_order_number', 'SO-4021', 95],
    ['item', 'Widget', 90],
  ];
  for (const [k, v, c] of rows) {
    db.prepare('INSERT INTO extractions (document_id, field_key, display_value, confidence, extraction_method, corroboration) VALUES (?,?,?,?,?,?)')
      .run(id, k, v, c, 'template_mapping', corr[k] || null);
  }
  return id;
}

function elig(db, id, opts = {}) {
  return trust.isAutoFileEligible(db, db.prepare('SELECT * FROM documents WHERE id = ?').get(id), opts);
}

// ── 1. the core: the belt refuses a role-disagreement at overall==100; OFF it files (byte-identical) ──
section('1. role disagreement on the date role at overall==100');
{
  const { db, tid } = makeDb();
  db.prepare("INSERT INTO settings (key,value) VALUES ('trust_role_disagreement_refuse','true')").run();  // HARD dep
  const id = seedDoc(db, tid, { corr: { order_date: DISAGREE_KW } });

  // OFF (default) — the gate-free 100% path files it today (the silent misfile).
  const off = elig(db, id, { roleDisagreeAt100: false });
  check('belt OFF: a disagreeing date at 100 still auto-files (documents today\'s silent misfile)', off.eligible === true);

  // ON — refused, high-precision, reason names the role.
  const on = elig(db, id, { roleDisagreeAt100: true });
  check('belt ON: refused', on.eligible === false);
  check('belt ON: reason is disagreeing-read:order_date', on.reason === 'disagreeing-read:order_date');
}

// ── 2. HARD dep: trust_role_disagreement_refuse OFF → the belt is inert (corroboration not even read) ──
section('2. HARD dep — trust_role_disagreement_refuse OFF');
{
  const { db, tid } = makeDb();
  db.prepare("INSERT INTO settings (key,value) VALUES ('trust_role_disagreement_refuse','false')").run();
  const id = seedDoc(db, tid, { corr: { order_date: DISAGREE_KW } });
  check('belt ON but role-refuse OFF: inert → files', elig(db, id, { roleDisagreeAt100: true }).eligible === true);
}

// ── 3. precision: agree, absent-corroboration, and a NON-role disagreement all still file ─────────────
section('3. precision — only a ref/date-role page-family disagreement refuses');
{
  const { db, tid } = makeDb();
  db.prepare("INSERT INTO settings (key,value) VALUES ('trust_role_disagreement_refuse','true')").run();
  const agree = seedDoc(db, tid, { corr: { order_date: AGREE } });
  check('agree record on the date role → files', elig(db, agree, { roleDisagreeAt100: true }).eligible === true);

  const bare = seedDoc(db, tid, { corr: {} });                       // no corroboration on any role
  check('no corroboration record → files', elig(db, bare, { roleDisagreeAt100: true }).eligible === true);

  const nonRole = seedDoc(db, tid, { corr: { item: DISAGREE_KW } }); // disagreement on an OPTIONAL non-role field
  check('a disagreement on a NON-role field → files (only ref/date roles are gated)',
        elig(db, nonRole, { roleDisagreeAt100: true }).eligible === true);
}

// ── 4. the belt is the overall==100 case specifically; sub-100 is already covered by the full gate ────
section('4. scope — the belt changes the 100% path; the ref role too');
{
  const { db, tid } = makeDb();
  db.prepare("INSERT INTO settings (key,value) VALUES ('trust_role_disagreement_refuse','true')").run();
  const refDis = seedDoc(db, tid, { corr: { sales_order_number: DISAGREE_KW } });
  check('a disagreeing REF role at 100 is also refused', elig(db, refDis, { roleDisagreeAt100: true }).reason === 'disagreeing-read:sales_order_number');

  // no-template at 100: the belt must NOT introduce a 'no-template' refusal (gate-free path files logo-only
  // 100% suppliers). A clean no-template doc files; a disagreeing one is held for the RIGHT reason.
  const noTplClean = seedDoc(db, tid, { template: null, corr: {} });
  check('no-template + clean at 100 → still files (belt did not add no-template)',
        elig(db, noTplClean, { roleDisagreeAt100: true }).eligible === true);
  const noTplDis = seedDoc(db, tid, { template: null, corr: { order_date: DISAGREE_KW } });
  check('no-template + disagreeing at 100 → held for disagreeing-read, not no-template',
        elig(db, noTplDis, { roleDisagreeAt100: true }).reason === 'disagreeing-read:order_date');
}

// ── 5. strict_100_autofile precedence — when the full at100 gate is ON it takes the branch (still holds) ──
section('5. strict_100_autofile takes precedence and still holds the disagreement');
{
  const { db, tid } = makeDb();
  db.prepare("INSERT INTO settings (key,value) VALUES ('trust_role_disagreement_refuse','true')").run();
  db.prepare("INSERT INTO settings (key,value) VALUES ('strict_100_autofile','true')").run();
  const id = seedDoc(db, tid, { corr: { order_date: DISAGREE_KW } });
  check('strict100 ON: the full at100 gate holds the disagreement (belt not reached, still safe)',
        elig(db, id, { strict100: true, roleDisagreeAt100: true }).eligible === false);
}

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}`);
process.exit(fails ? 1 : 0);
