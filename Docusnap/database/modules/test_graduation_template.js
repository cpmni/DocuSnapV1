#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_graduation_template.js
 * --------------------------------------------
 * Guards graduationTemplate.js — auto-create a template when a (supplier, doc-type) scope
 * GRADUATES with no template yet, so its sub-100 docs can auto-file. Pins EVERY Oracle
 * SIGN-OFF-WITH-CONDITIONS condition so a future dev can't silently regress the safety:
 *   C1  existence MATCH → pure LINK, never update-fold a foreign template (byte-identical pin).
 *   C2  auto-create only with >=K=3 distinctive tokens (thin-identity → skip).
 *   C3  seed logo only after a cross-supplier collision pre-check (else keyword-only).
 *   C4  null doc-type slug → skip.
 *   C6  seed fields VARIABLE-ONLY (no fixed_value).
 * Plus: not-graduated → skip; blank/implausible name → skip; kill switch; already-linked
 * (taught-confirm ran first) → skip; idempotency (second sibling → link, count stays 1).
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_graduation_template.js
 */

const Database = require('better-sqlite3');
const gt        = require('./graduationTemplate');
const templates = require('./templates');

let fails = 0;
function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; return cond; }
function section(t) { console.log(`\n${t}`); }

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE document_types (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT UNIQUE,
                                 ref_field_key TEXT, date_field_key TEXT);
    CREATE TABLE fields (id INTEGER PRIMARY KEY AUTOINCREMENT, document_type_id INTEGER, key TEXT,
                         label TEXT, type TEXT DEFAULT 'text', required INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1);
    CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_name TEXT, document_type_id INTEGER,
                            status TEXT, confirmed_at TEXT, template_id INTEGER, overall_confidence INTEGER,
                            logo_phash TEXT, keyword_fingerprint TEXT, ocr_text TEXT);
    CREATE TABLE extractions (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT,
                              display_value TEXT, raw_value TEXT, confidence INTEGER, extraction_method TEXT,
                              validation_note TEXT, corrected_to TEXT);
    CREATE TABLE corrections (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT,
                              original_value TEXT, corrected_value TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
    CREATE TABLE templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
      document_type_slug TEXT, logo_phash TEXT, keyword_fingerprint TEXT, sample_document_id INTEGER,
      confirmed_count INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')), group_id INTEGER, ocr_auto_enabled INTEGER DEFAULT 0,
      ocr_auto_params TEXT, supplier_name TEXT);
    CREATE TABLE template_fields (id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      field_key TEXT NOT NULL, anchor_label TEXT, direction TEXT DEFAULT 'right',
      fixed_value TEXT, is_variable INTEGER DEFAULT 1, fixed_locked INTEGER DEFAULT 0,
      UNIQUE(template_id, field_key));
    CREATE TABLE template_logo_hashes (id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      phash TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')), UNIQUE(template_id, phash));
    CREATE TABLE template_field_mappings (id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER REFERENCES templates(id) ON DELETE CASCADE, field_key TEXT, region_hint TEXT, enabled INTEGER DEFAULT 1);
    CREATE TABLE template_landmarks (id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER REFERENCES templates(id) ON DELETE CASCADE, label_text TEXT,
      x_norm REAL, y_norm REAL, w_norm REAL, h_norm REAL, ocr_conf REAL, page_number INTEGER);
  `);
  const tid = db.prepare("INSERT INTO document_types (name, slug, ref_field_key, date_field_key) VALUES ('Invoice','invoice','invoice_number','invoice_date')").run().lastInsertRowid;
  const add = (key, type, req) => db.prepare('INSERT INTO fields (document_type_id, key, type, required) VALUES (?,?,?,?)').run(tid, key, type, req ? 1 : 0);
  add('supplier_name', 'text', 1); add('invoice_date', 'date', 1); add('invoice_number', 'text', 1);
  return { db, tid };
}

// Seed N clean confirmed invoices for a scope; set identity fields on the NEWEST (returned last).
function seedScope(db, tid, { n = 10, supplier = 'Cascade Water Systems',
                             logo = null, kf = null, ocr = 'cascade water systems' } = {}) {
  let last = null;
  for (let i = 1; i <= n; i++) {
    const isNewest = i === n;
    last = db.prepare(
      'INSERT INTO documents (supplier_name, document_type_id, status, confirmed_at, overall_confidence, logo_phash, keyword_fingerprint, ocr_text) VALUES (?,?,?,?,?,?,?,?)'
    ).run(supplier, tid, 'confirmed', `2026-06-01T10:00:${String(i).padStart(2, '0')}Z`, 98,
          isNewest ? logo : null, isNewest ? JSON.stringify(kf || []) : null, isNewest ? ocr : null).lastInsertRowid;
    const ex = (k, v) => db.prepare('INSERT INTO extractions (document_id, field_key, display_value, confidence, extraction_method) VALUES (?,?,?,?,?)').run(last, k, v, 98, 'keyword');
    ex('supplier_name', supplier); ex('invoice_date', `0${(i % 9) + 1}-06-2026`); ex('invoice_number', `INV-${1000 + i}`);
  }
  return last;
}

const KF   = ['cascade', 'water', 'systems', 'reservoir'];   // 4 distinctive tokens
const OCR  = 'cascade water systems springfield works reservoir rd invoice';
const P_A  = '0000000000000000';
const P_A6 = '000000000000003f';   // dist 6 from P_A (nibble '3'=2 + 'f'=4)  → identifyByFingerprint LOGO match (conf>=60)
const P_A8 = '00000000000000ff';   // dist 8 from P_A (two 'f' nibbles)       → past accept gate, inside collision band
const allValues = { supplier_name: 'Cascade Water Systems', invoice_number: 'INV-1010', invoice_date: '07-06-2026' };
const info = { document_type_slug: 'invoice', supplier_name: 'Cascade Water Systems', allValues, dtInfo: null };

function main() {
  section('0. distinctiveTokens (mirror of engine _flag_branding_conflict)');
  check('strips doc-type stopwords + short tokens, de-dups',
    JSON.stringify(gt.distinctiveTokens(['Cascade', 'cascade', 'Invoice', 'no', 'Water'])) === JSON.stringify(['cascade', 'water']));
  check('fixture dist(P_A,P_A6)=6', templates.hammingDistance(P_A, P_A6) === 6);
  check('fixture dist(P_A,P_A8)=8', templates.hammingDistance(P_A, P_A8) === 8);

  section('1. CREATE — graduated, no template, rich identity, no collision');
  {
    const { db, tid } = makeDb();
    const docId = seedScope(db, tid, { logo: P_A, kf: KF, ocr: OCR });
    const d = gt.decide(db, docId, info);
    check('decide → create', d.action === 'create' && d.reason === 'create');
    check('seed carries the logo (no collision)', d.seed.logo_phash === P_A && d.seed.keywordOnly === false);
    const res = gt.apply(db, docId, d);
    check('apply created a template + linked the doc', res.created && res.templateId &&
      db.prepare('SELECT template_id FROM documents WHERE id=?').get(docId).template_id === res.templateId);
    check('exactly one template row now', db.prepare('SELECT COUNT(*) c FROM templates').get().c === 1);
    check('template is same-type (invoice), named after the issuer',
      (() => { const t = templates.getById(db, res.templateId); return t.document_type_slug === 'invoice' && t.name === 'Cascade Water Systems'; })());
    check('C6: every seeded field is VARIABLE-only (fixed_value null)',
      db.prepare('SELECT COUNT(*) c FROM template_fields WHERE template_id=? AND (is_variable=0 OR fixed_value IS NOT NULL)').get(res.templateId).c === 0 &&
      db.prepare('SELECT COUNT(*) c FROM template_fields WHERE template_id=?').get(res.templateId).c > 0);
    check('logo hash was seeded into the set', templates.getLogoHashes(db, res.templateId).includes(P_A));

    // Idempotency: a SECOND graduated sibling with the same logo → existence MATCH → link, no new template.
    const doc2 = seedScope(db, tid, { logo: P_A, kf: KF, ocr: OCR });
    const d2 = gt.decide(db, doc2, info);
    check('idempotency: second sibling → link (exists)', d2.action === 'link' && d2.templateId === res.templateId);
    gt.apply(db, doc2, d2);
    check('idempotency: still exactly one template', db.prepare('SELECT COUNT(*) c FROM templates').get().c === 1);
  }

  section('2. NOT-GRADUATED — 9 clean confirms → skip');
  {
    const { db, tid } = makeDb();
    const docId = seedScope(db, tid, { n: 9, logo: P_A, kf: KF, ocr: OCR });
    check('W-1 confirms → not-graduated (PINS first-W-manual)', gt.decide(db, docId, info).reason === 'not-graduated');
  }

  section('3. C1 — existence MATCH links, and NEVER update-folds the matched template');
  {
    const { db, tid } = makeDb();
    // A pre-existing same-type template for the scope, matched by logo (dist 0). Seed its identity so we
    // can prove it stays byte-identical after a graduating confirm links to it.
    const foreignKf = ['acme', 'plumbing', 'depot'];
    const tId = templates.create(db, { name: 'Cascade Water Systems', document_type_slug: 'invoice', logo_phash: P_A, keyword_fingerprint: foreignKf, fields: [] });
    const rawKf = (id) => db.prepare('SELECT keyword_fingerprint FROM templates WHERE id=?').get(id).keyword_fingerprint;
    const beforeHashes = JSON.stringify(templates.getLogoHashes(db, tId));
    const beforeKf     = rawKf(tId);

    const docId = seedScope(db, tid, { logo: P_A, kf: KF, ocr: OCR });
    const d = gt.decide(db, docId, info);
    check('decide → link (existing same-type template matched)', d.action === 'link' && d.templateId === tId);
    gt.apply(db, docId, d);
    check('doc linked to the existing template', db.prepare('SELECT template_id FROM documents WHERE id=?').get(docId).template_id === tId);
    check('no second template created', db.prepare('SELECT COUNT(*) c FROM templates').get().c === 1);
    check('C1: matched template logo-hash SET is byte-identical (no addLogoHash fold)',
      JSON.stringify(templates.getLogoHashes(db, tId)) === beforeHashes);
    check('C1: matched template keyword_fingerprint is byte-identical (no stabilise fold)',
      rawKf(tId) === beforeKf);
  }

  section('4. C2 — thin identity (<3 distinctive tokens) → skip (do not create)');
  {
    const { db, tid } = makeDb();
    const docId = seedScope(db, tid, { logo: P_A, kf: ['invoice', 'delivery', 'po'], ocr: 'invoice delivery po' });
    const d = gt.decide(db, docId, info);
    check('decide → thin-identity skip', d.action === 'skip' && d.reason === 'thin-identity');
    check('no template created for a thin-identity scope', db.prepare('SELECT COUNT(*) c FROM templates').get().c === 0);
  }

  section('5. C3 — seed logo collides with a DIFFERENT-supplier same-type template → keyword-only');
  {
    const { db, tid } = makeDb();
    // A different supplier's invoice template whose logo is 8 Hamming from our seed (past the >=60
    // accept gate so it is NOT matched, but inside the <=10 collision band) and a NON-overlapping
    // fingerprint (so the keyword arm doesn't match it either).
    const otherId = templates.create(db, { name: 'Thornbury Ltd', document_type_slug: 'invoice', logo_phash: P_A8, keyword_fingerprint: ['thornbury', 'joinery', 'timber'], fields: [] });
    const otherHashesBefore = JSON.stringify(templates.getLogoHashes(db, otherId));

    const docId = seedScope(db, tid, { logo: P_A, kf: KF, ocr: OCR });
    const d = gt.decide(db, docId, info);
    check('decide → create but KEYWORD-ONLY (logo suppressed by collision)',
      d.action === 'create' && d.seed.logo_phash === null && d.seed.keywordOnly === true);
    const res = gt.apply(db, docId, d);
    check('created template stores NO logo_phash (keyword-only)', templates.getById(db, res.templateId).logo_phash == null);
    check('created template has an empty logo-hash set', templates.getLogoHashes(db, res.templateId).length === 0);
    check('C3: the colliding foreign template was NOT touched', JSON.stringify(templates.getLogoHashes(db, otherId)) === otherHashesBefore);
  }

  section('5b. C3 boundary — a same-type logo just OUTSIDE the band (dist>10) does not suppress');
  {
    const { db, tid } = makeDb();
    // dist 12 (three 'f' nibbles = 12) → outside COLLISION_DIST(10) → seed keeps its logo.
    templates.create(db, { name: 'Far Supplier', document_type_slug: 'invoice', logo_phash: '0000000000000fff', keyword_fingerprint: ['far', 'away', 'co'], fields: [] });
    const docId = seedScope(db, tid, { logo: P_A, kf: KF, ocr: OCR });
    const d = gt.decide(db, docId, info);
    check('dist>10 → no collision, logo kept', d.action === 'create' && d.seed.logo_phash === P_A);
  }

  section('6. C4 / guards — null slug, blank name, implausible name, disabled, already-linked');
  {
    const { db, tid } = makeDb();
    const docId = seedScope(db, tid, { logo: P_A, kf: KF, ocr: OCR });
    check('C4: no doc-type slug → skip', gt.decide(db, docId, { ...info, document_type_slug: null, dtInfo: null }).reason === 'no-doctype');

    const { db: db2, tid: tid2 } = makeDb();
    const blankDoc = seedScope(db2, tid2, { supplier: '   ', logo: P_A, kf: KF, ocr: OCR });
    check('blank issuer → skip', gt.decide(db2, blankDoc, { ...info, supplier_name: '', allValues: {} }).reason === 'blank-name');

    const { db: db3, tid: tid3 } = makeDb();
    const junkDoc = seedScope(db3, tid3, { supplier: 'IN', logo: P_A, kf: KF, ocr: OCR });
    check('implausible issuer ("IN") → skip', gt.decide(db3, junkDoc, { ...info, supplier_name: 'IN' }).reason === 'implausible-name');

    const { db: db4, tid: tid4 } = makeDb();
    const offDoc = seedScope(db4, tid4, { logo: P_A, kf: KF, ocr: OCR });
    db4.prepare("INSERT INTO settings (key,value) VALUES ('graduation_autotemplate_enabled','false')").run();
    check('kill switch off → disabled', gt.decide(db4, offDoc, info).reason === 'disabled');
    db4.prepare("UPDATE settings SET value='true' WHERE key='graduation_autotemplate_enabled'").run();
    db4.prepare("INSERT INTO settings (key,value) VALUES ('supplier_graduation_enabled','false')").run();
    check('master graduation switch off → disabled', gt.decide(db4, offDoc, info).reason === 'disabled');

    const { db: db5, tid: tid5 } = makeDb();
    const linkedDoc = seedScope(db5, tid5, { logo: P_A, kf: KF, ocr: OCR });
    db5.prepare('UPDATE documents SET template_id = 99 WHERE id = ?').run(linkedDoc);
    check('already-linked (taught-confirm ran first) → skip', gt.decide(db5, linkedDoc, info).reason === 'already-linked');
  }

  console.log('\n' + (fails === 0 ? 'ALL PASS' : `${fails} FAILED`));
  process.exit(fails ? 1 : 0);
}

main();
