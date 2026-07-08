#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_template_merge.js
 * ----------------------------------------
 * Covers templates.mergeInto — the Learning Recovery "Merge into…" consolidation
 * that folds a duplicate/fragment template into a canonical one and deletes the
 * source. Policy: TARGET WINS (keeps its own data, GAINS only what it lacks);
 * doc links move; confirmed_count sums; source row + its cascade rows vanish.
 *
 * In-memory better-sqlite3 with the real templates/fields/mappings/landmarks/
 * documents schema slice + FK ON (so cascade + the documents.template_id
 * null-out behave exactly as the app runs them).
 *
 * Usage: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_template_merge.js
 */

const Database  = require('better-sqlite3');
const templates = require('./templates');

function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); return cond; }

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
      document_type_slug TEXT, logo_phash TEXT, keyword_fingerprint TEXT,
      sample_document_id INTEGER REFERENCES documents(id), confirmed_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      group_id INTEGER, ocr_auto_enabled INTEGER DEFAULT 0, ocr_auto_params TEXT, supplier_name TEXT
    );
    CREATE TABLE template_fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      field_key TEXT NOT NULL, anchor_label TEXT, direction TEXT NOT NULL DEFAULT 'right',
      fixed_value TEXT, is_variable INTEGER NOT NULL DEFAULT 1,
      fixed_locked INTEGER NOT NULL DEFAULT 0,
      UNIQUE(template_id, field_key)
    );
    CREATE TABLE template_field_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      field_key TEXT NOT NULL, page_number INTEGER NOT NULL DEFAULT 0, anchor_text TEXT,
      anchor_x_norm REAL, anchor_y_norm REAL, anchor_w_norm REAL, anchor_h_norm REAL,
      target_x_norm REAL, target_y_norm REAL, target_w_norm REAL, target_h_norm REAL,
      offset_dx_norm REAL, offset_dy_norm REAL, ocr_type TEXT NOT NULL DEFAULT 'text',
      search_expansion REAL NOT NULL DEFAULT 0.04, region_hint TEXT, enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT, UNIQUE(template_id, field_key)
    );
    CREATE TABLE template_landmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      label_text TEXT, x_norm REAL, y_norm REAL, w_norm REAL, h_norm REAL, ocr_conf REAL,
      page_number INTEGER DEFAULT 0, source TEXT NOT NULL DEFAULT 'auto'
    );
    CREATE TABLE template_logo_hashes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      phash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(template_id, phash)
    );
    CREATE TABLE documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT, original_filename TEXT, stored_filename TEXT,
      stored_path TEXT, folder_path TEXT, status TEXT, supplier_name TEXT, doc_date TEXT,
      reference_number TEXT, template_id INTEGER REFERENCES templates(id)
    );
  `);
  return db;
}

const MAP = (fk, x, enabled = true) => ({
  field_key: fk, page_number: 0, anchor_text: fk,
  anchor_x_norm: x, anchor_y_norm: 0.2, anchor_w_norm: 0.1, anchor_h_norm: 0.04,
  target_x_norm: x + 0.15, target_y_norm: 0.2, target_w_norm: 0.15, target_h_norm: 0.04,
  ocr_type: 'text', enabled,
});
const LMS = n => Array.from({ length: n }, (_, i) =>
  ({ label_text: `L${i}`, x_norm: 0.1 * i, y_norm: 0.1 * i, w_norm: 0.05, h_norm: 0.02, ocr_conf: 90, page_number: 0 }));

function main() {
  let f = 0;
  const db = makeDb();
  const doc = db.prepare('INSERT INTO documents (original_filename, status) VALUES (?,?)');
  const sampleDocId = doc.run('sample.pdf', 'confirmed').lastInsertRowid;

  // Canonical A: identity + invoice_number mapping + 5 landmarks + count 5, NO sample, NO customer.
  const A = templates.create(db, { name: 'Wsheet A', document_type_slug: 'wsheet',
    logo_phash: 'aaaa1111', keyword_fingerprint: ['alpha'] });
  templates.saveMapping(db, A, MAP('invoice_number', 0.10));   // A's own — must survive
  templates.setLandmarks(db, A, LMS(5));
  db.prepare('UPDATE templates SET confirmed_count = 5 WHERE id = ?').run(A);

  // Fragment B: empty phash, customer mapping (DISABLED) + invoice_number (different coords) +
  // a po_number field + a sample + count 3 + 2 linked docs + 0 landmarks.
  const B = templates.create(db, { name: 'Wsheet B', document_type_slug: 'wsheet' });
  templates.saveMapping(db, B, MAP('customer', 0.50, false));  // disabled → must be preserved
  templates.saveMapping(db, B, MAP('invoice_number', 0.90));   // collides → must NOT overwrite A's
  db.prepare('INSERT INTO template_fields (template_id, field_key, anchor_label) VALUES (?,?,?)').run(B, 'po_number', 'PO No');
  db.prepare('UPDATE templates SET sample_document_id = ?, confirmed_count = 3 WHERE id = ?').run(sampleDocId, B);
  const d1 = doc.run('b1.pdf', 'confirmed').lastInsertRowid;
  const d2 = doc.run('b2.pdf', 'confirmed').lastInsertRowid;
  db.prepare('UPDATE documents SET template_id = ? WHERE id IN (?,?)').run(B, d1, d2);

  const r = templates.mergeInto(db, B, A);
  console.log('merge B->A:', JSON.stringify(r));
  const a = templates.getById(db, A);
  const aMaps = templates.getMappings(db, A);
  const invA = aMaps.find(m => m.field_key === 'invoice_number');
  const custA = aMaps.find(m => m.field_key === 'customer');

  f += !check('docLinksMove: B docs now point at A',
    db.prepare("SELECT COUNT(*) c FROM documents WHERE template_id = ?").get(A).c === 2);
  f += !check('targetGainsMissingMappings: A now has customer', !!custA);
  f += !check('targetKeepsOwn: A invoice_number unchanged (x 0.10, not B 0.90)',
    invA && Math.abs(invA.anchor_x_norm - 0.10) < 1e-9);
  f += !check('enabledFlagPreservedOnFold: folded customer stays DISABLED', custA && custA.enabled === 0);
  f += !check('fieldsFoldedDedupeByKey: A gains po_number field',
    templates.getFields(db, A).some(x => x.field_key === 'po_number'));
  f += !check('landmarksKeptFromTarget (target non-empty): A still has 5', templates.getLandmarks(db, A).length === 5);
  f += !check('sampleAdoptedOnlyIfTargetEmpty: A adopted B sample', a.sample_document_id === sampleDocId);
  f += !check('identityKeptFromTarget: A keeps its own phash', a.logo_phash === 'aaaa1111');
  f += !check('confirmedCountSummed: 5 + 3 = 8', a.confirmed_count === 8);
  f += !check('sourceRowGone: B deleted', !db.prepare('SELECT 1 FROM templates WHERE id = ?').get(B));
  f += !check('cascadeRowsGone: B mappings cascade-deleted',
    db.prepare('SELECT COUNT(*) c FROM template_field_mappings WHERE template_id = ?').get(B).c === 0);

  // Adopt-when-target-empty cases (A2 lacks landmarks + phash; B2 has both).
  const A2 = templates.create(db, { name: 'Empty A2', document_type_slug: 'wsheet' });   // no phash, no landmarks
  const B2 = templates.create(db, { name: 'Rich B2', document_type_slug: 'wsheet', logo_phash: 'bbbb2222' });
  templates.setLandmarks(db, B2, LMS(4));
  templates.mergeInto(db, B2, A2);
  const a2 = templates.getById(db, A2);
  f += !check('landmarksAdoptedWhenTargetEmpty: A2 gained 4', templates.getLandmarks(db, A2).length === 4);
  f += !check('phashAdoptedWhenTargetEmpty: A2 gained B2 phash', a2.logo_phash === 'bbbb2222');

  // Guards.
  f += !check('mergeIntoSelfNoOp', templates.mergeInto(db, A, A).ok === false);
  f += !check('sourceMissingReturnsError', templates.mergeInto(db, 99999, A).ok === false);
  f += !check('targetMissingReturnsError', templates.mergeInto(db, A, 99999).ok === false);
  f += !check('self/missing left A intact', !!db.prepare('SELECT 1 FROM templates WHERE id = ?').get(A));

  db.close();
  console.log(f ? `\n${f} FAILED` : '\nAll template-merge checks passed');
  process.exit(f ? 1 : 0);
}

main();
