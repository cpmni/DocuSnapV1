'use strict';
/*
 * test_fingerprint_hygiene.js — slice 3 (JS arm) of the distinctive-token train
 * (FINGERPRINT_HYGIENE, Oracle-signed 2026-07-20): customer-token subtraction at the persist seam.
 *
 * The live Vellum template froze its sample doc's CUSTOMER ("Ashcombe Care Homes") into its
 * permanent fingerprint because "Bill To" OCR'd as "Bi Te" and the harvest truncation missed the
 * recipient block. That leak diluted the template's own rival ratio below the naming bar exactly
 * when it was the true supplier of a misfiled doc. At confirm time the recipient is GROUND TRUTH,
 * so _upsertTemplate subtracts the confirmed customer_name tokens before persisting — EXCEPT any
 * token also present in the confirmed issuer (Oracle E: a company billing its own branch), and not
 * at all when the issuer identity itself CAME from the customer field. The UPDATE path's
 * stabiliseFingerprint intersect then HEALS an already-stored leak on the next confirm, no
 * migration needed — the unclaimed benefit the Oracle asked pinned.
 *
 *   ELECTRON_RUN_AS_NODE=1 <electron> database/modules/test_fingerprint_hygiene.js
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
      keyword_fingerprint TEXT, supplier_name TEXT
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fph-'));
const ctx = { path, fs, templatesDir: () => tmpDir };
const INV_DT = {
  id: 1, name: 'Invoice', slug: 'invoice', ref_field_key: 'invoice_number', date_field_key: 'invoice_date',
  fields: [{ key: 'supplier_name', is_variable: 0 }, { key: 'customer_name', is_variable: 1 },
           { key: 'invoice_number', is_variable: 1 }, { key: 'invoice_date', is_variable: 1 }],
};
const LEAKED_FP = ['Vellum', 'Crane', 'Stationers', 'Paternoster', 'Court', 'York', 'Ashcombe', 'Care', 'Homes'];
const mkDoc = (db, fp, templateId = null) => Number(db.prepare(
  "INSERT INTO documents (original_filename, status, document_type_id, template_id, logo_phash, keyword_fingerprint) " +
  "VALUES ('v.pdf', 'needs_review', 1, ?, 'bf46c0f1c03f4e43', ?)").run(templateId, JSON.stringify(fp)).lastInsertRowid);
const fpOf = (db, id) => templates.getById(db, id).keyword_fingerprint.map(w => w.toLowerCase());

(async () => {
  section('§1 CREATE: the confirmed customer\'s tokens never enter a new template\'s identity');
  let db = makeDb();
  const r1 = await _upsertTemplate(ctx, db, mkDoc(db, LEAKED_FP), {
    allValues: { supplier_name: 'Vellum & Crane Stationers', customer_name: 'Ashcombe Care Homes',
                 invoice_number: 'INV-1', invoice_date: '01-01-2026' },
    document_type_slug: 'invoice', supplier_name: 'Vellum & Crane Stationers', dtInfo: INV_DT });
  let fp1 = fpOf(db, r1.templateId);
  check('customer tokens subtracted (ashcombe/care/homes gone)',
    !fp1.includes('ashcombe') && !fp1.includes('care') && !fp1.includes('homes'));
  check('branding tokens kept (vellum/crane/stationers/paternoster)',
    ['vellum', 'crane', 'stationers', 'paternoster'].every(w => fp1.includes(w)));

  section('§2 Oracle E: a token shared with the ISSUER is never subtracted (own-branch billing)');
  db = makeDb();
  const r2 = await _upsertTemplate(ctx, db, mkDoc(db, ['Northgate', 'Supplies', 'Mill', 'Preston', 'Belfast']), {
    allValues: { supplier_name: 'Northgate Supplies Ltd', customer_name: 'Northgate Supplies Belfast',
                 invoice_number: 'INV-2', invoice_date: '01-01-2026' },
    document_type_slug: 'invoice', supplier_name: 'Northgate Supplies Ltd', dtInfo: INV_DT });
  const fp2 = fpOf(db, r2.templateId);
  check('issuer-shared tokens survive (northgate/supplies)', fp2.includes('northgate') && fp2.includes('supplies'));
  check('customer-only token subtracted (belfast)', !fp2.includes('belfast'));

  section('§3 HEALING PIN: an already-stored leak leaves on the next confirm (intersect, no migration)');
  db = makeDb();
  const leakedTpl = templates.create(db, {
    name: 'Vellum & Crane Stationers', document_type_slug: 'invoice', logo_phash: 'bf46c0f1c03f4e43',
    keyword_fingerprint: LEAKED_FP, fields: [],
  });
  // Same-supplier confirmed doc so Part E's identity check allows the reuse.
  db.prepare("INSERT INTO documents (original_filename, status, template_id, supplier_name) VALUES ('c.pdf','confirmed',?,?)")
    .run(leakedTpl, 'Vellum & Crane Stationers');
  await _upsertTemplate(ctx, db, mkDoc(db, LEAKED_FP, leakedTpl), {
    allValues: { supplier_name: 'Vellum & Crane Stationers', customer_name: 'Ashcombe Care Homes',
                 invoice_number: 'INV-3', invoice_date: '02-01-2026' },
    document_type_slug: 'invoice', supplier_name: 'Vellum & Crane Stationers', dtInfo: INV_DT });
  const fp3 = fpOf(db, leakedTpl);
  check("stored 'ashcombe' healed out of the template identity by the update intersect", !fp3.includes('ashcombe'));
  check('healed fingerprint keeps the branding core above the stabilise floor', fp3.length >= 3 && fp3.includes('vellum'));

  section('§4 fail-safes + kill switch');
  db = makeDb();
  const r4 = await _upsertTemplate(ctx, db, mkDoc(db, ['Ashcombe', 'Care', 'Homes', 'Portland', 'Row']), {
    allValues: { customer_name: 'Ashcombe Care Homes', invoice_number: 'INV-4', invoice_date: '03-01-2026' },
    document_type_slug: 'invoice', supplier_name: '', dtInfo: INV_DT });
  const fp4 = fpOf(db, r4.templateId);
  check('issuer identity CAME from the customer field ⇒ NO subtraction (would strip the issuer itself)',
    fp4.includes('ashcombe') && fp4.includes('care'));
  db = makeDb();
  process.env.FINGERPRINT_HYGIENE = '0';
  const r5 = await _upsertTemplate(ctx, db, mkDoc(db, LEAKED_FP), {
    allValues: { supplier_name: 'Vellum & Crane Stationers', customer_name: 'Ashcombe Care Homes',
                 invoice_number: 'INV-5', invoice_date: '04-01-2026' },
    document_type_slug: 'invoice', supplier_name: 'Vellum & Crane Stationers', dtInfo: INV_DT });
  delete process.env.FINGERPRINT_HYGIENE;
  check('kill switch =0 restores the legacy persist (customer tokens kept — the red proof/revert pin)',
    fpOf(db, r5.templateId).includes('ashcombe'));

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' check(s) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})();
