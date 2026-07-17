'use strict';
/*
 * test_template_reuse.js — M2: branding-fingerprint reuse in _upsertTemplate.
 *
 * ROOT CAUSE (measured, docs/designs/TEMPLATE_CONVERGENCE_2026-07-17.md): on scans the coarse logo
 * phash drifts past the accept band (measured up to 36 Hamming for the SAME supplier), so a taught
 * confirm whose logo drifted can't find its own same-supplier same-type template by logo and SPAWNS A
 * DUPLICATE (the fragmentation birth path). M2 adds a branding-fingerprint reuse branch so the drifted
 * doc REUSES its template instead. Kill switch env TEMPLATE_REUSE_BY_BRANDING (default OFF ⇒ byte-identical).
 *
 * CONTROL-TEST-FIRST: Section A (switch OFF) is the BASELINE — it must stay green both BEFORE M2 is
 * built and AFTER with the switch off (a duplicate is still born; nothing changed). Sections B–G are
 * capability-guarded on templates.findByBrandingFingerprint so this file runs cleanly pre-build too
 * (they print PENDING until M2 lands), then pin the fix + the Oracle trade-offs once M2 exists.
 *
 * Run with Electron-as-Node (better-sqlite3 native addon):
 *   ELECTRON_RUN_AS_NODE=1 <electron> database/modules/test_template_reuse.js
 */
const Database  = require('better-sqlite3');
const path      = require('path');
const fs        = require('fs');
const os        = require('os');
const templates = require('./templates');
const { _upsertTemplate } = require('../../src/modules/review/handler.js');

let failures = 0, pending = 0;
function check(label, cond) { console.log((cond ? '  OK  ' : '  BAD ') + label); if (!cond) failures++; return cond; }
function skip(label) { console.log('  --  (PENDING M2) ' + label); pending++; }
function section(t) { console.log('\n' + t); }

const HAS_M2 = typeof templates.findByBrandingFingerprint === 'function';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
      document_type_slug TEXT, logo_phash TEXT, keyword_fingerprint TEXT,
      sample_document_id INTEGER, confirmed_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE template_fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      field_key TEXT NOT NULL, anchor_label TEXT, direction TEXT NOT NULL DEFAULT 'right',
      fixed_value TEXT, is_variable INTEGER NOT NULL DEFAULT 1, fixed_locked INTEGER NOT NULL DEFAULT 0,
      UNIQUE(template_id, field_key)
    );
    CREATE TABLE documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT, original_filename TEXT, status TEXT,
      document_type_id INTEGER, template_id INTEGER, logo_phash TEXT, logo_detail_hash TEXT,
      keyword_fingerprint TEXT
    );
    CREATE TABLE template_field_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      field_key TEXT NOT NULL, page_number INTEGER NOT NULL DEFAULT 0, anchor_text TEXT,
      anchor_x_norm REAL, anchor_y_norm REAL, anchor_w_norm REAL, anchor_h_norm REAL,
      target_x_norm REAL, target_y_norm REAL, target_w_norm REAL, target_h_norm REAL,
      offset_dx_norm REAL, offset_dy_norm REAL, ocr_type TEXT NOT NULL DEFAULT 'text',
      search_expansion REAL NOT NULL DEFAULT 0.04, region_hint TEXT, enabled INTEGER NOT NULL DEFAULT 1,
      UNIQUE(template_id, field_key)
    );
    CREATE TABLE template_landmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      label_text TEXT, x_norm REAL, y_norm REAL, w_norm REAL, h_norm REAL, ocr_conf REAL, page_number INTEGER
    );
    CREATE TABLE template_logo_hashes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      phash TEXT, detail_hash TEXT, UNIQUE(template_id, phash)
    );
    CREATE TABLE extractions (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT, display_value TEXT);
    CREATE TABLE corrections (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT, corrected_value TEXT);
  `);
  return db;
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm2-reuse-'));
const ctx = { path, fs, templatesDir: () => tmpDir };

// A = an established template's logo; B = the SAME supplier's logo drifted FAR past the accept band
// (bitwise complement → dist 64 > 13; the measured sales_order_05 drifted to 22 — any >13 triggers
// the birth path because findByLogoHash(...,13,...) rejects it).
const A = 'be9ec161c23d1ec2';
const B = A.split('').map(c => (15 - parseInt(c, 16)).toString(16)).join('');

const WS_DT = {
  id: 13, name: 'WSht', slug: 'wsht', ref_field_key: 'reference_number', date_field_key: 'date',
  fields: [{ key: 'supplier_name', is_variable: 0 }, { key: 'reference_number', is_variable: 1 }, { key: 'date', is_variable: 1 }],
};
const allValues = { supplier_name: 'Copperfield Electrical', reference_number: 'WS-65750', date: '28-04-2026' };

// Distinctive branding words (none are doc-type stopwords; all len>=3).
const FP_FULL  = ['copperfield', 'electrical', 'ballymena', 'mill'];        // template + a matching drifted doc
const FP_OTHER = ['northgate', 'textiles', 'antrim', 'road'];               // a DIFFERENT supplier (0 shared)
const FP_MIN3  = ['copperfield', 'electrical', 'ballymena'];                // a minimal 3-token template
const FP_BLOAT = ['copperfield', 'electrical', 'ballymena', 'northgate', 'antrim', 'castle', 'industrial', 'belfast']; // 8-token different-supplier doc that CONTAINS the minimal template's 3 tokens
const FP_TWO   = ['acme', 'widgets'];                                       // only 2 distinctive tokens

function mkTemplate(db, name, slug, logo, fp) {
  return templates.create(db, { name, document_type_slug: slug, logo_phash: logo, keyword_fingerprint: fp, fields: [] });
}
function mkDoc(db, logo, fp) {
  return db.prepare(
    "INSERT INTO documents (status, document_type_id, template_id, logo_phash, logo_detail_hash, keyword_fingerprint) " +
    "VALUES ('confirmed', 13, NULL, ?, NULL, ?)"
  ).run(logo, JSON.stringify(fp)).lastInsertRowid;
}
const tmplCount = (db) => db.prepare('SELECT COUNT(*) n FROM templates').get().n;
const linkOf    = (db, docId) => db.prepare('SELECT template_id FROM documents WHERE id=?').get(docId).template_id;

async function upsert(db, docId) {
  return _upsertTemplate(ctx, db, docId, {
    allValues, document_type_slug: 'wsht', supplier_name: 'Copperfield Electrical', dtInfo: WS_DT });
}

(async () => {
  section(`Fixture: logo drift dist(A,B) = ${templates.hammingDistance(A, B)} (must be > 13 to defeat the logo path)`);
  check('drifted logo is past the accept band', templates.hammingDistance(A, B) > 13);
  console.log(HAS_M2 ? '  (M2 present — running the full battery)' : '  (M2 NOT built — baseline only; B–G pend)');

  // ── A — BASELINE / kill-switch OFF: drifted-logo branding-match confirm STILL spawns a duplicate ──
  section('A. Baseline (TEMPLATE_REUSE_BY_BRANDING off): drifted logo → DUPLICATE born (byte-identical)');
  delete process.env.TEMPLATE_REUSE_BY_BRANDING;
  {
    const db = makeDb();
    const tId = mkTemplate(db, 'Copperfield Electrical', 'wsht', A, FP_FULL);
    const doc = mkDoc(db, B, FP_FULL);
    const res = await upsert(db, doc);
    check('a DUPLICATE template is created (created:true)', !!res && res.created === true);
    check('two templates now exist', tmplCount(db) === 2);
    check('doc links to the NEW (duplicate) template, not the original', linkOf(db, doc) !== tId);
  }

  // ── B — M2 ON: the drifted-logo branding match REUSES its own template ──
  section('B. M2 on: drifted logo + branding 1.00 → REUSE (no duplicate)');
  if (!HAS_M2) skip('reuse-not-duplicate + confirmed_count bumped');
  else {
    process.env.TEMPLATE_REUSE_BY_BRANDING = '1';
    const db = makeDb();
    const tId = mkTemplate(db, 'Copperfield Electrical', 'wsht', A, FP_FULL);
    const doc = mkDoc(db, B, FP_FULL);
    const res = await upsert(db, doc);
    check('the existing template is REUSED (created:false)', !!res && res.created === false);
    check('still ONE template (no duplicate born)', tmplCount(db) === 1);
    check('doc links to the original template', linkOf(db, doc) === tId);
    check('confirmed_count bumped on reuse', templates.getById(db, tId).confirmed_count === 1);

    // E — the FAR-drifted logo must NOT be folded into the reused template's logo set (band bound).
    section('E. M2 on: the >13 drifted logo is NOT appended to the reused template (Oracle cond 3)');
    const hashes = templates.getLogoHashes(db, tId);
    check('logo set still contains the established primary A', hashes.includes(A));
    check('logo set does NOT absorb the far-drifted B', !hashes.includes(B));
    check('primary phash unchanged (still A)', templates.getById(db, tId).logo_phash === A);
    delete process.env.TEMPLATE_REUSE_BY_BRANDING;
  }

  // ── C — isolation: a DIFFERENT supplier of the same type does NOT reuse ──
  section('C. M2 on: a different-supplier same-type doc does NOT reuse (isolation)');
  if (!HAS_M2) skip('different supplier → new template');
  else {
    process.env.TEMPLATE_REUSE_BY_BRANDING = '1';
    const db = makeDb();
    mkTemplate(db, 'Copperfield Electrical', 'wsht', A, FP_FULL);
    const doc = mkDoc(db, B, FP_OTHER);
    const res = await upsert(db, doc);
    check('a NEW template is created for the different supplier (created:true)', !!res && res.created === true);
    check('two templates (isolation preserved)', tmplCount(db) === 2);
    delete process.env.TEMPLATE_REUSE_BY_BRANDING;
  }

  // ── D — SEAM-2: symmetric ratio rejects a bloated different-supplier doc that CONTAINS a minimal
  //        template's 3 tokens. Directional (denom = 3-token template) would score 3/3 = 1.0 and
  //        WRONGLY reuse; symmetric (denom = 8) scores 3/8 = 0.375 < 0.80 and correctly makes a new one.
  section('D. M2 on: symmetric ratio rejects a bloated superset doc (directional would mis-reuse)');
  if (!HAS_M2) skip('symmetric rejects 3-of-8 superset');
  else {
    process.env.TEMPLATE_REUSE_BY_BRANDING = '1';
    const db = makeDb();
    mkTemplate(db, 'Minimal Co', 'wsht', A, FP_MIN3);
    const doc = mkDoc(db, B, FP_BLOAT);
    const res = await upsert(db, doc);
    check('bloated superset does NOT reuse the minimal template (created:true)', !!res && res.created === true);
    delete process.env.TEMPLATE_REUSE_BY_BRANDING;
  }

  // ── F — the >=3 shared-distinctive-token absolute floor ──
  section('F. M2 on: <3 shared distinctive tokens never reuse, even at ratio 1.0');
  if (!HAS_M2) skip('2-token match blocked by the >=3 floor');
  else {
    process.env.TEMPLATE_REUSE_BY_BRANDING = '1';
    const db = makeDb();
    mkTemplate(db, 'Two Token Co', 'wsht', A, FP_TWO);
    const doc = mkDoc(db, B, FP_TWO);        // ratio 2/2 = 1.0 but only 2 shared distinctive tokens
    const res = await upsert(db, doc);
    check('2 shared tokens does NOT reuse (created:true) — the >=3 floor holds', !!res && res.created === true);
    delete process.env.TEMPLATE_REUSE_BY_BRANDING;
  }

  // ── G — type scoping: a branding-matching template of a DIFFERENT type is not reused ──
  section('G. M2 on: a same-branding template of a different type is NOT reused (slug-scoped)');
  if (!HAS_M2) skip('cross-type not reused');
  else {
    process.env.TEMPLATE_REUSE_BY_BRANDING = '1';
    const db = makeDb();
    mkTemplate(db, 'Copperfield Electrical', 'invoice', A, FP_FULL);   // same branding, WRONG type
    const doc = mkDoc(db, B, FP_FULL);                                 // confirmed as wsht
    const res = await upsert(db, doc);
    check('cross-type branding match does NOT reuse (created:true)', !!res && res.created === true);
    delete process.env.TEMPLATE_REUSE_BY_BRANDING;
  }

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  console.log('\n' + (failures === 0 ? `ALL PASS${pending ? ` (${pending} pending M2)` : ''}` : failures + ' check(s) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})();
