'use strict';
/*
 * test_upsert_type_link.js — Part D (TYPE-heading authority, Oracle C4).
 *
 * _upsertTemplate (review/handler.js) now DETACHES a WRONG-TYPE Stage-0 link at confirm, so a
 * worksheet mis-matched to the delivery-note/sales-order template by the shared logo re-points to
 * a CORRECT-type template instead of reinforcing the wrong-type sibling (root cause #3). Exercises
 * the REAL exported _upsertTemplate against a real in-memory DB (schema = test_templates.js's
 * templates slice + a minimal documents/extractions/corrections set).
 *
 * Run with Electron-as-Node (better-sqlite3 native addon):
 *   ELECTRON_RUN_AS_NODE=1 <electron> database/modules/test_upsert_type_link.js
 */
const Database  = require('better-sqlite3');
const path      = require('path');
const fs        = require('fs');
const os        = require('os');
const templates = require('./templates');
const { _upsertTemplate } = require('../../src/modules/review/handler.js');

let failures = 0;
function check(label, cond) { console.log((cond ? '  OK  ' : '  BAD ') + label); if (!cond) failures++; return cond; }
function section(t) { console.log('\n' + t); }

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
      label_text TEXT, x_norm REAL, y_norm REAL, w_norm REAL, h_norm REAL,
      ocr_conf REAL, page_number INTEGER
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dte-partd-'));
const ctx = { path, fs, templatesDir: () => tmpDir };
const LOGO = 'be9ec161c23d1ec2';

const WS_DT = {
  id: 13, name: 'WSht', slug: 'wsht', ref_field_key: 'reference_number', date_field_key: 'date',
  fields: [{ key: 'supplier_name', is_variable: 0 }, { key: 'reference_number', is_variable: 1 }, { key: 'date', is_variable: 1 }],
};
const allValues = { supplier_name: 'Copperfield Electrical', reference_number: 'WS-65750', date: '28-04-2026' };

function mkTemplate(db, name, slug, logo) {
  return templates.create(db, { name, document_type_slug: slug, logo_phash: logo, keyword_fingerprint: [], fields: [] });
}
function mkDoc(db, templateId, logo) {
  return db.prepare(
    "INSERT INTO documents (status, document_type_id, template_id, logo_phash, logo_detail_hash, keyword_fingerprint) " +
    "VALUES ('confirmed', 13, ?, ?, NULL, '[]')"
  ).run(templateId, logo).lastInsertRowid;
}
const linkedSlugOf = (db, docId) => {
  const d = db.prepare('SELECT template_id FROM documents WHERE id=?').get(docId);
  const t = d && d.template_id != null ? templates.getById(db, d.template_id) : null;
  return t && t.document_type_slug;
};

(async () => {
  // ── C4a/C4c: doc mis-linked to a SALES_ORDER template, confirmed as WSHT → detach + relink ──
  section('Part D: worksheet confirm of a doc mis-linked to a sales_order template');
  let db = makeDb();
  const soId  = mkTemplate(db, 'Copperfield SO', 'sales_order', LOGO);   // wrong-type sibling carrying the logo
  const docId = mkDoc(db, soId, LOGO);
  const res   = await _upsertTemplate(ctx, db, docId, {
    allValues, document_type_slug: 'wsht', supplier_name: 'Copperfield Electrical', dtInfo: WS_DT });
  check('doc re-points to a WSHT-type template (not the sales_order one)', linkedSlugOf(db, docId) === 'wsht');
  check('a NEW wsht template was born (created:true)', !!res && res.created === true);
  const so = templates.getById(db, soId);
  check('the sales_order template is UNCHANGED (still sales_order)', !!so && so.document_type_slug === 'sales_order');
  const soFieldCount = db.prepare('SELECT COUNT(*) n FROM template_fields WHERE template_id=?').get(soId).n;
  check('the sales_order template gained NO fields from this worksheet confirm (not reinforced)', soFieldCount === 0);

  // ── C4b: linked to a SAME-type template → NO detach (reuse it) ──
  section('Part D: same-type link is reused, not detached');
  db = makeDb();
  const wsId   = mkTemplate(db, 'Copperfield WSht', 'wsht', LOGO);
  const docId2 = mkDoc(db, wsId, LOGO);
  const res2   = await _upsertTemplate(ctx, db, docId2, {
    allValues, document_type_slug: 'wsht', supplier_name: 'X', dtInfo: WS_DT });
  check('same-type link REUSED (created:false)', !!res2 && res2.created === false);
  check('doc still linked to the same wsht template',
    db.prepare('SELECT template_id FROM documents WHERE id=?').get(docId2).template_id === wsId);

  // ── C4b: linked to a NULL-slug LEGACY template → NOT detached ──
  section('Part D: legacy null-slug link is NOT detached (Oracle C4b)');
  db = makeDb();
  const legacyId = mkTemplate(db, 'Legacy Copperfield', null, LOGO);
  const docId3   = mkDoc(db, legacyId, LOGO);
  const res3     = await _upsertTemplate(ctx, db, docId3, {
    allValues, document_type_slug: 'wsht', supplier_name: 'X', dtInfo: WS_DT });
  check('null-slug legacy link REUSED, not detached (created:false)', !!res3 && res3.created === false);
  check('doc still linked to the legacy template',
    db.prepare('SELECT template_id FROM documents WHERE id=?').get(docId3).template_id === legacyId);

  // ── Kill switch: TEMPLATE_TYPE_LINK_GUARD=0 → wrong-type link NOT detached (pre-D behaviour) ──
  section('Part D: TEMPLATE_TYPE_LINK_GUARD=0 → wrong-type link is NOT detached');
  db = makeDb();
  process.env.TEMPLATE_TYPE_LINK_GUARD = '0';
  const soId4  = mkTemplate(db, 'Copperfield SO', 'sales_order', LOGO);
  const docId4 = mkDoc(db, soId4, LOGO);
  const res4   = await _upsertTemplate(ctx, db, docId4, {
    allValues, document_type_slug: 'wsht', supplier_name: 'X', dtInfo: WS_DT });
  delete process.env.TEMPLATE_TYPE_LINK_GUARD;
  check('kill switch off → wrong-type template REUSED (created:false, pre-D behaviour)', !!res4 && res4.created === false);
  check('kill switch off → doc still linked to the sales_order template',
    db.prepare('SELECT template_id FROM documents WHERE id=?').get(docId4).template_id === soId4);

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' check(s) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})();
