#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_promote_custom_doctype.js
 * -----------------------------------------------
 * Covers the custom-document-type fixes for "Add to Template Manager":
 *  - getWithFields loads a CUSTOM type's fields exactly like a built-in
 *    (variable/constant annotation from the type's own ref/date keys),
 *  - promote-to-template is GATED: a missing or unknown document type is
 *    rejected (the bug that produced a null-typed, field-less template whose
 *    fields then showed empty in the Template Manager),
 *  - a valid custom type produces a template carrying that document_type_slug
 *    AND the custom fields (constants as fixed_value, ref/date as variable).
 *
 * Exercises the real review handler + real document_types/templates modules over
 * an in-memory DB, with a fake admin auth module injected via require.cache.
 *
 * Usage: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_promote_custom_doctype.js
 */

const Database = require('better-sqlite3');
const os = require('os');
const path = require('path');
const fs = require('fs');

// ── Fake admin auth, injected before the review handler resolves it ───────────
let _session = { role: 'admin' };
const fakeAuth = {
  requireLogin() { if (!_session) throw new Error('login'); return _session; },
  hasRole(...r) { return !!_session && r.includes(_session.role); },
  requireRole(...r) { if (!_session || !r.includes(_session.role)) throw new Error('forbidden'); return _session; },
  getCurrentUser() { return _session; },
};
const authPath = require.resolve('../../src/modules/auth/handler');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: fakeAuth };

const reviewHandler = require('../../src/modules/review/handler');
const doctypes = require('./document_types');

function check(l, c) { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}`); return c; }

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE document_types (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, built_in INTEGER DEFAULT 0,
      ref_field_key TEXT, date_field_key TEXT, sort_order INTEGER DEFAULT 100, enabled INTEGER DEFAULT 1);
    CREATE TABLE fields (id INTEGER PRIMARY KEY AUTOINCREMENT, document_type_id INTEGER, key TEXT, label TEXT,
      type TEXT, required INTEGER DEFAULT 0, built_in INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 100, enabled INTEGER DEFAULT 1);
    CREATE TABLE documents (id INTEGER PRIMARY KEY, supplier_name TEXT, status TEXT, template_id INTEGER,
      logo_phash TEXT, keyword_fingerprint TEXT, document_type_id INTEGER);
    CREATE TABLE templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT, document_type_slug TEXT,
      logo_phash TEXT, keyword_fingerprint TEXT, confirmed_count INTEGER DEFAULT 0, sample_document_id INTEGER,
      group_id INTEGER, ocr_auto_enabled INTEGER DEFAULT 0, ocr_auto_params TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT);
    CREATE TABLE template_fields (id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER REFERENCES templates(id) ON DELETE CASCADE, field_key TEXT, anchor_label TEXT,
      direction TEXT, fixed_value TEXT, is_variable INTEGER,
      fixed_locked INTEGER NOT NULL DEFAULT 0,   -- migration 31 (admin-locked fixed value)
      UNIQUE(template_id, field_key));
    CREATE TABLE template_field_mappings (id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER REFERENCES templates(id) ON DELETE CASCADE, field_key TEXT, region_hint TEXT, enabled INTEGER DEFAULT 1);
    CREATE TABLE template_logo_hashes (id INTEGER PRIMARY KEY AUTOINCREMENT,   -- migration 26 (multi-ref logo set)
      template_id INTEGER REFERENCES templates(id) ON DELETE CASCADE, phash TEXT, UNIQUE(template_id, phash));
    CREATE TABLE template_landmarks (id INTEGER PRIMARY KEY AUTOINCREMENT,     -- migration 22 (registration landmarks)
      template_id INTEGER REFERENCES templates(id) ON DELETE CASCADE, label_text TEXT,
      x_norm REAL, y_norm REAL, w_norm REAL, h_norm REAL, ocr_conf REAL, page_number INTEGER);
  `);
  // A CUSTOM doc type with its own ref/date keys + fields.
  db.prepare(`INSERT INTO document_types (id,name,slug,built_in,ref_field_key,date_field_key)
              VALUES (1,'Delivery Note','delivery_note',0,'delivery_no','delivery_date')`).run();
  const f = db.prepare(`INSERT INTO fields (document_type_id,key,label,type,sort_order) VALUES (1,?,?,?,?)`);
  f.run('supplier_name', 'Supplier',      'text', 1);
  f.run('delivery_no',   'Delivery No',   'text', 2);
  f.run('delivery_date', 'Delivery Date', 'date', 3);
  f.run('customer',      'Customer',      'text', 4);
  return db;
}

function bind(db) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-tpltest-'));
  const handlers = {};
  reviewHandler.register({
    ipcMain: { handle: (n, fn) => { handlers[n] = fn; }, on: () => {} },
    getDb: () => db, notifyMainWindow: () => {}, path, fs,
    templatesDir: () => tmpDir, logger: { log() {}, warn() {}, err() {} }, spawn: () => {},
  });
  return (p) => handlers['promote-to-template']({}, p);
}

async function main() {
  let fail = 0;
  const db = freshDb();

  // ── 1. Custom type fields load like a built-in ──────────────────────────────
  const dt = doctypes.getWithFields(db, 'delivery_note');
  fail += !check('getWithFields loads the custom type with all 4 fields', dt && dt.fields.length === 4);
  const byKey = Object.fromEntries((dt.fields || []).map(f => [f.key, f]));
  fail += !check('ref/date keys flagged variable, others constant (custom schema honoured)',
    byKey.delivery_no.is_variable === 1 && byKey.delivery_date.is_variable === 1 &&
    byKey.customer.is_variable === 0 && byKey.supplier_name.is_variable === 0);

  // ── 2. Gate: missing / unknown doc type is rejected ─────────────────────────
  db.prepare(`INSERT INTO documents (id,status,logo_phash,keyword_fingerprint) VALUES (1,'confirmed','abcd','[]')`).run();
  const promote = bind(db);
  const allValues = { supplier_name: 'Acme Logistics', delivery_no: 'DN-1', delivery_date: '01-01-2026', customer: 'Big Co' };

  const noType = await promote({ document_id: 1, allValues });
  fail += !check('promote rejected when no document type is selected', noType && noType.success === false);
  const badType = await promote({ document_id: 1, allValues, document_type_slug: 'does_not_exist' });
  fail += !check('promote rejected when the document type is unknown', badType && badType.success === false);

  // ── 3. Valid custom type -> template carries the type AND the custom fields ──
  const ok = await promote({ document_id: 1, allValues, document_type_slug: 'delivery_note', supplier_name: 'Acme Logistics' });
  fail += !check('promote succeeds with a valid custom document type', ok && ok.success === true && ok.templateId);

  const tmpl = db.prepare('SELECT * FROM templates WHERE id = ?').get(ok.templateId);
  fail += !check('template stores the custom document_type_slug', tmpl && tmpl.document_type_slug === 'delivery_note');

  const tf = Object.fromEntries(
    db.prepare('SELECT field_key, fixed_value, is_variable FROM template_fields WHERE template_id = ?').all(ok.templateId)
      .map(r => [r.field_key, r]));
  fail += !check('template includes the custom fields (not empty)', !!tf.delivery_no && !!tf.customer && !!tf.supplier_name);
  fail += !check('constant custom field stored as fixed_value', tf.customer.fixed_value === 'Big Co' && tf.customer.is_variable === 0);
  fail += !check('variable (ref) custom field stored without a fixed_value', tf.delivery_no.is_variable === 1 && !tf.delivery_no.fixed_value);

  db.close();
  console.log(fail ? `\n${fail} FAILED` : '\nAll promote-custom-doctype checks passed');
  return fail ? 1 : 0;
}

main().then(c => process.exit(c));
