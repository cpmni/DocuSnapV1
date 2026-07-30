#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_learn_on_commit.js
 * ----------------------------------------
 * Slice 1 (learn-on-commit) — end-to-end behavioural pin over the WIRED hook
 * templates.learnTemplateOnCommit (the fn the three commit routes call).
 *
 * Pins:
 *   OFF  — kill switch default (no env, no setting) AND env=0 ⇒ NO-OP (byte-identical).
 *   ON   — env=1 forces the gate:
 *          · happy path        — same-type/same-supplier template: fingerprint INTERSECTS
 *                                (pollution stripped) + a drifted logo is APPENDED.
 *          · TYPE mismatch     — a foreign-type template is NOT touched.
 *          · SUPPLIER foreign  — a template whose other confirmed docs are a DIFFERENT company
 *                                is NOT touched.
 *          · C-B (Oracle)      — a graduation-C3 KEYWORD-ONLY template (logo withheld) keeps
 *                                logo_phash NULL + zero template_logo_hashes rows, even though the
 *                                committing doc carries a logo; its fingerprint still heals.
 *          · no template       — a doc with no template_id ⇒ NO-OP.
 *
 * Usage: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_learn_on_commit.js
 */

const Database  = require('better-sqlite3');
const templates = require('./templates');

function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); return cond; }

const H0 = '0000000000000000';
const H9 = '0000000000000777';   // dist(H0)=9 (append band 3-13)
const POLLUTED = ['copperfield', 'electrical', 'purchase', 'order', 'sandpiper', 'hotels'];
const CLEANDOC = ['copperfield', 'electrical', 'purchase', 'order', 'widgets'];
const HEALED   = ['copperfield', 'electrical', 'purchase', 'order'];

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
      document_type_slug TEXT, logo_phash TEXT, keyword_fingerprint TEXT,
      sample_document_id INTEGER, confirmed_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      group_id INTEGER, ocr_auto_enabled INTEGER DEFAULT 0, ocr_auto_params TEXT, supplier_name TEXT
    );
    CREATE TABLE template_fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      field_key TEXT NOT NULL, anchor_label TEXT, direction TEXT DEFAULT 'right',
      fixed_value TEXT, is_variable INTEGER DEFAULT 1, UNIQUE(template_id, field_key)
    );
    CREATE TABLE template_logo_hashes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      phash TEXT NOT NULL, detail_hash TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(template_id, phash)
    );
    CREATE TABLE documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER, status TEXT,
      supplier_name TEXT, logo_phash TEXT, logo_detail_hash TEXT, keyword_fingerprint TEXT
    );
    CREATE TABLE settings ( key TEXT PRIMARY KEY, value TEXT, updated_at TEXT );
  `);
  return db;
}

// The document being committed (status irrelevant — establishedIdentity excludes it by id).
function commitDoc(db, { tid, supplier, logo, fp }) {
  return db.prepare(
    'INSERT INTO documents (template_id, status, supplier_name, logo_phash, keyword_fingerprint) VALUES (?, ?, ?, ?, ?)'
  ).run(tid, 'confirmed', supplier, logo || null, JSON.stringify(fp)).lastInsertRowid;
}
// A prior confirmed sample that DEFINES the template's established identity.
function priorDoc(db, tid, supplier) {
  db.prepare("INSERT INTO documents (template_id, status, supplier_name) VALUES (?, 'confirmed', ?)").run(tid, supplier);
}
function fpOf(db, id)   { return JSON.parse(db.prepare('SELECT keyword_fingerprint AS f FROM templates WHERE id = ?').get(id).f || '[]'); }
function phashOf(db, id){ return db.prepare('SELECT logo_phash AS p FROM templates WHERE id = ?').get(id).p; }
const setEnv = (v) => { if (v == null) delete process.env.TEMPLATE_LEARN_ON_CONFIRM; else process.env.TEMPLATE_LEARN_ON_CONFIRM = v; };

function main() {
  let f = 0;
  const db = makeDb();

  // ── DEFAULT (no env, no setting) ⇒ ON since the flip: enriches ───────────────
  setEnv(null);
  const Tdef = templates.create(db, { name: 'PO-def', document_type_slug: 'purchase_order', logo_phash: H0, keyword_fingerprint: POLLUTED });
  const dDef = commitDoc(db, { tid: Tdef, supplier: 'Copperfield Electrical Ltd', logo: H9, fp: CLEANDOC });
  templates.learnTemplateOnCommit(db, dDef, { document_type_slug: 'purchase_order', supplier_name: 'Copperfield Electrical Ltd' });
  f += !check('DEFAULT (no env/setting): fix ON — fingerprint intersects', JSON.stringify(fpOf(db, Tdef)) === JSON.stringify(HEALED));

  // ── OFF: kill switch (env=0, or setting=false) ⇒ NO-OP (byte-identical) ───────
  setEnv('0');
  const T = templates.create(db, { name: 'PO', document_type_slug: 'purchase_order', logo_phash: H0, keyword_fingerprint: POLLUTED });
  const d0 = commitDoc(db, { tid: T, supplier: 'Copperfield Electrical Ltd', logo: H9, fp: CLEANDOC });
  templates.learnTemplateOnCommit(db, d0, { document_type_slug: 'purchase_order', supplier_name: 'Copperfield Electrical Ltd' });
  f += !check('OFF (env=0): fingerprint untouched', JSON.stringify(fpOf(db, T)) === JSON.stringify(POLLUTED));
  f += !check('OFF (env=0): logo set still just the primary', templates.getLogoHashes(db, T).length === 1);

  // ── ON: happy path — intersect + append ──────────────────────────────────────
  setEnv('1');
  templates.learnTemplateOnCommit(db, d0, { document_type_slug: 'purchase_order', supplier_name: 'Copperfield Electrical Ltd' });
  f += !check('ON happy: fingerprint INTERSECTS (pollution stripped)', JSON.stringify(fpOf(db, T)) === JSON.stringify(HEALED));
  const set = templates.getLogoHashes(db, T);
  f += !check('ON happy: drifted logo APPENDED', set.length === 2 && set.includes(H9));
  f += !check('ON happy: primary logo unchanged',  phashOf(db, T) === H0);

  // ── ON: TYPE mismatch — foreign-type template NOT touched ────────────────────
  const INV = templates.create(db, { name: 'Inv', document_type_slug: 'invoice', logo_phash: H0, keyword_fingerprint: POLLUTED });
  const d1  = commitDoc(db, { tid: INV, supplier: 'Copperfield Electrical Ltd', logo: H9, fp: CLEANDOC });
  templates.learnTemplateOnCommit(db, d1, { document_type_slug: 'purchase_order', supplier_name: 'Copperfield Electrical Ltd' });
  f += !check('ON type-mismatch: foreign-type template untouched', JSON.stringify(fpOf(db, INV)) === JSON.stringify(POLLUTED));

  // ── ON: SUPPLIER foreign — established identity is a DIFFERENT company ────────
  const FGN = templates.create(db, { name: 'PO2', document_type_slug: 'purchase_order', logo_phash: H0, keyword_fingerprint: POLLUTED });
  priorDoc(db, FGN, 'Zephyr Trading Company');    // the template's established identity
  const d2 = commitDoc(db, { tid: FGN, supplier: 'Copperfield Electrical', logo: H9, fp: CLEANDOC });
  templates.learnTemplateOnCommit(db, d2, { document_type_slug: 'purchase_order', supplier_name: 'Copperfield Electrical' });
  f += !check('ON supplier-foreign: mislinked doc donates NOTHING', JSON.stringify(fpOf(db, FGN)) === JSON.stringify(POLLUTED));

  // ── ON: C-B — keyword-only C3 template keeps its logo WITHHELD ───────────────
  const KW = templates.create(db, { name: 'KW PO', document_type_slug: 'purchase_order', keyword_fingerprint: POLLUTED });   // no logo
  const d3 = commitDoc(db, { tid: KW, supplier: 'Copperfield Electrical Ltd', logo: H0, fp: CLEANDOC });
  templates.learnTemplateOnCommit(db, d3, { document_type_slug: 'purchase_order', supplier_name: 'Copperfield Electrical Ltd' });
  f += !check('C-B: keyword-only template logo_phash stays NULL', phashOf(db, KW) == null);
  f += !check('C-B: zero template_logo_hashes rows (withheld logo not re-planted)', templates.getLogoHashes(db, KW).length === 0);
  f += !check('C-B: fingerprint STILL heals (intersect runs)', JSON.stringify(fpOf(db, KW)) === JSON.stringify(HEALED));

  // ── ON: no template_id ⇒ NO-OP ───────────────────────────────────────────────
  const orphan = commitDoc(db, { tid: null, supplier: 'Copperfield Electrical Ltd', logo: H0, fp: CLEANDOC });
  templates.learnTemplateOnCommit(db, orphan, { document_type_slug: 'purchase_order', supplier_name: 'Copperfield Electrical Ltd' });
  f += !check('ON no-template: no throw, no-op', true);

  setEnv(null);
  db.close();
  console.log(f ? `\n${f} FAILED` : '\nAll learn-on-commit route checks passed');
  process.exit(f ? 1 : 0);
}

main();
