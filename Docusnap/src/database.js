'use strict';

/**
 * database.js — all SQLite operations for DocuSnap
 *
 * Tables:
 *   fields          — built-in + custom field definitions
 *   documents       — every processed document + its status
 *   extractions     — per-field extracted values + confidence scores
 *   corrections     — every user correction (used for few-shot learning)
 *   supplier_hints  — accumulated hints per supplier for prompt injection
 */

const path    = require('path');
const fs      = require('fs');
const { app } = require('electron');

let db = null;

// ── Open / initialise ────────────────────────────────────────────────────────

function open() {
  if (db) return db;

  // Store DB in user data dir so it persists across app updates
  const dbDir  = app.getPath('userData');
  const dbPath = path.join(dbDir, 'docusnap.db');

  // better-sqlite3 must be required after app is ready (native module)
  const Database = require('better-sqlite3');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');  // better concurrent performance
  db.pragma('foreign_keys = ON');

  migrate(db);
  migrateFieldAnchors(db);
  seedDefaultFields(db);

  return db;
}


// ── Migration: fix field_anchors supplier_name nullable ───────────────────────
function migrateFieldAnchors(db) {
  try {
    // Check if supplier_name column is NOT NULL by trying to insert a null
    db.prepare(`INSERT OR IGNORE INTO field_anchors
      (supplier_name, field_key, anchor_label, direction, page_zone)
      VALUES (NULL, '__test__', '__test__', 'right', 'top')`).run();
    // Clean up test row
    db.prepare(`DELETE FROM field_anchors WHERE field_key = '__test__'`).run();
  } catch (e) {
    if (e.message && e.message.includes('NOT NULL')) {
      // Recreate table without NOT NULL on supplier_name
      db.exec(`
        CREATE TABLE IF NOT EXISTS field_anchors_new (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          supplier_name  TEXT,
          field_key      TEXT    NOT NULL,
          anchor_label   TEXT    NOT NULL,
          direction      TEXT    NOT NULL,
          page_zone      TEXT    NOT NULL,
          x_norm         REAL,
          y_norm         REAL,
          usage_count    INTEGER NOT NULL DEFAULT 1,
          confidence     REAL    NOT NULL DEFAULT 1.0,
          last_seen      TEXT    NOT NULL DEFAULT (datetime('now')),
          UNIQUE(supplier_name, field_key, anchor_label, direction)
        );
        INSERT OR IGNORE INTO field_anchors_new
          SELECT * FROM field_anchors;
        DROP TABLE field_anchors;
        ALTER TABLE field_anchors_new RENAME TO field_anchors;
      `);
      console.log('Migrated field_anchors: supplier_name now nullable');
    }
  }
}

// ── Migrations ───────────────────────────────────────────────────────────────

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fields (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      key           TEXT    NOT NULL UNIQUE,   -- e.g. "invoice_number"
      label         TEXT    NOT NULL,          -- e.g. "Invoice Number"
      type          TEXT    NOT NULL DEFAULT 'text',  -- text | date | number | currency
      built_in      INTEGER NOT NULL DEFAULT 0,
      enabled       INTEGER NOT NULL DEFAULT 1,
      confidence_threshold INTEGER NOT NULL DEFAULT 70,
      sort_order    INTEGER NOT NULL DEFAULT 100,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS documents (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      original_filename TEXT    NOT NULL,
      new_filename      TEXT,
      folder_path       TEXT    NOT NULL,
      status            TEXT    NOT NULL DEFAULT 'pending',
        -- pending | needs_review | confirmed | error
      overall_confidence INTEGER,
      supplier_name     TEXT,
      processed_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      confirmed_at      TEXT,
      error_message     TEXT
    );

    CREATE TABLE IF NOT EXISTS extractions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id   INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      field_key     TEXT    NOT NULL,
      raw_value     TEXT,
      display_value TEXT,
      confidence    INTEGER,         -- 0-100, NULL = not scored
      was_corrected INTEGER NOT NULL DEFAULT 0,
      corrected_to  TEXT
    );

    CREATE TABLE IF NOT EXISTS corrections (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id   INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      field_key     TEXT    NOT NULL,
      original_value TEXT,
      corrected_value TEXT   NOT NULL,
      supplier_name  TEXT,
      corrected_at   TEXT   NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS supplier_hints (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_name TEXT    NOT NULL,
      field_key     TEXT    NOT NULL,
      hint_value    TEXT    NOT NULL,
      usage_count   INTEGER NOT NULL DEFAULT 1,
      last_seen     TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(supplier_name, field_key, hint_value)
    );

    CREATE TABLE IF NOT EXISTS logo_fingerprints (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_name  TEXT    NOT NULL,
      phash          TEXT    NOT NULL,   -- perceptual hash (64-bit hex)
      ahash          TEXT    NOT NULL,   -- average hash (backup)
      crop_zone      TEXT    NOT NULL DEFAULT 'top',
      match_count    INTEGER NOT NULL DEFAULT 1,
      last_seen      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS field_anchors (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_name  TEXT,
      field_key      TEXT    NOT NULL,
      anchor_label   TEXT    NOT NULL,   -- e.g. "Inv. No.", "Invoice Number:"
      direction      TEXT    NOT NULL,   -- 'right' | 'below' | 'above' | 'inline'
      page_zone      TEXT    NOT NULL,   -- 'top' | 'middle' | 'bottom'
      x_norm         REAL,              -- normalised x position (0-1)
      y_norm         REAL,              -- normalised y position (0-1)
      usage_count    INTEGER NOT NULL DEFAULT 1,
      confidence     REAL    NOT NULL DEFAULT 1.0,
      last_seen      TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(supplier_name, field_key, anchor_label, direction)
    );
  `);
}

// ── Seed built-in fields ──────────────────────────────────────────────────────

const BUILT_IN_FIELDS = [
  { key: 'invoice_number',       label: 'Invoice Number',        type: 'text',     sort_order: 10 },
  { key: 'invoice_date',         label: 'Invoice Date',          type: 'date',     sort_order: 20 },
  { key: 'due_date',             label: 'Due Date',              type: 'date',     sort_order: 30 },
  { key: 'supplier_name',        label: 'Supplier Name',         type: 'text',     sort_order: 40 },
  { key: 'supplier_address',     label: 'Supplier Address',      type: 'text',     sort_order: 50 },
  { key: 'customer_name',        label: 'Customer Name',         type: 'text',     sort_order: 60 },
  { key: 'customer_address',     label: 'Customer Address',      type: 'text',     sort_order: 70 },
  { key: 'purchase_order_number',label: 'PO Number',             type: 'text',     sort_order: 80 },
  { key: 'subtotal',             label: 'Subtotal',              type: 'currency', sort_order: 90 },
  { key: 'vat_tax',              label: 'VAT / Tax',             type: 'currency', sort_order: 100 },
  { key: 'total_amount',         label: 'Total Amount',          type: 'currency', sort_order: 110 },
  { key: 'currency',             label: 'Currency',              type: 'text',     sort_order: 120 },
  { key: 'payment_terms',        label: 'Payment Terms',         type: 'text',     sort_order: 130 },
  { key: 'line_items',           label: 'Line Items',            type: 'text',     sort_order: 140 },
  { key: 'notes',                label: 'Notes',                 type: 'text',     sort_order: 150 },
];

function seedDefaultFields(db) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO fields (key, label, type, built_in, sort_order)
    VALUES (@key, @label, @type, 1, @sort_order)
  `);
  const insertMany = db.transaction((fields) => {
    for (const f of fields) insert.run(f);
  });
  insertMany(BUILT_IN_FIELDS);
}

// ── Fields API ────────────────────────────────────────────────────────────────

function getFields() {
  return open().prepare(
    `SELECT * FROM fields WHERE enabled = 1 ORDER BY sort_order, id`
  ).all();
}

function getAllFields() {
  return open().prepare(
    `SELECT * FROM fields ORDER BY sort_order, id`
  ).all();
}

function addCustomField({ key, label, type = 'text', confidence_threshold = 70 }) {
  // Sanitise key via the shared canonical rule (collapse/trim/fallback) so a
  // malformed key can't reach filing (buildXml crash).
  const { safeSlug } = require('../database/modules/slug');
  const safeKey = safeSlug(key, { fallback: 'field' });
  const maxOrder = open().prepare(
    `SELECT COALESCE(MAX(sort_order), 100) as m FROM fields`
  ).get().m;
  return open().prepare(`
    INSERT INTO fields (key, label, type, built_in, confidence_threshold, sort_order)
    VALUES (?, ?, ?, 0, ?, ?)
  `).run(safeKey, label, type, confidence_threshold, maxOrder + 10);
}

function updateField(id, changes) {
  const allowed = ['label', 'type', 'enabled', 'confidence_threshold', 'sort_order'];
  const sets    = Object.keys(changes)
    .filter(k => allowed.includes(k))
    .map(k => `${k} = @${k}`)
    .join(', ');
  if (!sets) return;
  return open().prepare(
    `UPDATE fields SET ${sets} WHERE id = @id`
  ).run({ ...changes, id });
}

function deleteCustomField(id) {
  // Only allow deleting non-built-in fields
  return open().prepare(
    `DELETE FROM fields WHERE id = ? AND built_in = 0`
  ).run(id);
}

// ── Documents API ─────────────────────────────────────────────────────────────

function insertDocument({ original_filename, folder_path, supplier_name, overall_confidence, status }) {
  return open().prepare(`
    INSERT INTO documents (original_filename, folder_path, supplier_name, overall_confidence, status)
    VALUES (@original_filename, @folder_path, @supplier_name, @overall_confidence, @status)
  `).run({ original_filename, folder_path, supplier_name, overall_confidence, status });
}

function updateDocument(id, changes) {
  const allowed = ['new_filename', 'status', 'overall_confidence', 'confirmed_at', 'error_message'];
  const sets    = Object.keys(changes)
    .filter(k => allowed.includes(k))
    .map(k => `${k} = @${k}`)
    .join(', ');
  if (!sets) return;
  return open().prepare(
    `UPDATE documents SET ${sets} WHERE id = @id`
  ).run({ ...changes, id });
}

function getReviewQueue() {
  return open().prepare(`
    SELECT d.*, GROUP_CONCAT(e.field_key || ':' || COALESCE(e.confidence,'?'), '|') as field_confidences
    FROM documents d
    LEFT JOIN extractions e ON e.document_id = d.id
    WHERE d.status = 'needs_review'
    GROUP BY d.id
    ORDER BY d.processed_at DESC
  `).all();
}

function restoreDeferred(id) {
  return open().prepare(
    `UPDATE documents SET status = 'needs_review' WHERE id = ?`
  ).run(id);
}

function getDeferredQueue() {
  return open().prepare(`
    SELECT * FROM documents WHERE status = 'deferred' ORDER BY processed_at DESC
  `).all();
}

function getDocument(id) {
  return open().prepare(`SELECT * FROM documents WHERE id = ?`).get(id);
}

function getDocumentWithExtractions(id) {
  const doc  = open().prepare(`SELECT * FROM documents WHERE id = ?`).get(id);
  if (!doc) return null;
  const exts = open().prepare(
    `SELECT * FROM extractions WHERE document_id = ? ORDER BY rowid`
  ).all(id);
  doc.extractions = exts;
  return doc;
}

// ── Extractions API ───────────────────────────────────────────────────────────

function insertExtractions(document_id, extractionsArr) {
  const insert = open().prepare(`
    INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence)
    VALUES (@document_id, @field_key, @raw_value, @display_value, @confidence)
  `);
  const insertMany = open().transaction((rows) => {
    for (const row of rows) insert.run({ document_id, ...row });
  });
  insertMany(extractionsArr);
}

// ── Corrections API ───────────────────────────────────────────────────────────

function saveCorrections(document_id, corrections, supplier_name, allValues) {
  const db_ = open();

  // Use supplier from allValues if not explicitly provided
  const effectiveSupplier = supplier_name
    || (allValues && allValues.supplier_name)
    || '__global__';

  const insertCorr = db_.prepare(`
    INSERT INTO corrections (document_id, field_key, original_value, corrected_value, supplier_name)
    VALUES (@document_id, @field_key, @original_value, @corrected_value, @supplier_name)
  `);

  const updateExt = db_.prepare(`
    UPDATE extractions SET was_corrected = 1, corrected_to = @corrected_to
    WHERE document_id = @document_id AND field_key = @field_key
  `);

  const upsertHint = db_.prepare(`
    INSERT INTO supplier_hints (supplier_name, field_key, hint_value, usage_count, last_seen)
    VALUES (@supplier_name, @field_key, @hint_value, 1, datetime('now'))
    ON CONFLICT(supplier_name, field_key, hint_value) DO UPDATE SET
      usage_count = usage_count + 1,
      last_seen   = datetime('now')
  `);

  db_.transaction(() => {
    // Save explicit corrections (user changed a value)
    for (const [field_key, { original_value, corrected_value }] of Object.entries(corrections)) {
      insertCorr.run({ document_id, field_key, original_value, corrected_value,
                       supplier_name: effectiveSupplier });
      updateExt.run({ document_id, field_key, corrected_to: corrected_value });
      if (corrected_value) {
        // Save with supplier for targeted learning
        upsertHint.run({ supplier_name: effectiveSupplier, field_key,
                         hint_value: corrected_value });
        // Also save as global hint if we have a real supplier
        if (effectiveSupplier !== '__global__') {
          upsertHint.run({ supplier_name: '__global__', field_key,
                           hint_value: corrected_value });
        }
      }
    }

    // Save ALL confirmed values as hints (even ones the user didn't change)
    // This reinforces correct extractions and builds the knowledge base faster
    if (allValues) {
      const key_fields = ['invoice_number', 'invoice_date', 'supplier_name',
                          'total_amount', 'currency', 'payment_terms',
                          'purchase_order_number'];
      for (const field_key of key_fields) {
        const val = allValues[field_key];
        if (val && val.trim() && !corrections[field_key]) {
          // Only save if not already saved as a correction above
          upsertHint.run({ supplier_name: effectiveSupplier, field_key,
                           hint_value: val.trim() });
        }
      }
    }
  })();
}

// ── Supplier hints (few-shot learning) ───────────────────────────────────────

function getSupplierHints(supplier_name) {
  if (!supplier_name) return [];
  return open().prepare(`
    SELECT field_key, hint_value, usage_count
    FROM supplier_hints
    WHERE supplier_name = ?
    ORDER BY field_key, usage_count DESC
  `).all(supplier_name);
}

// ── Review queue count (for badge) ───────────────────────────────────────────

function getReviewCount() {
  return open().prepare(
    `SELECT COUNT(*) as n FROM documents WHERE status = 'needs_review'`
  ).get().n;
}

// ── Confirm a reviewed document ───────────────────────────────────────────────

function confirmDocument(id, new_filename) {
  updateDocument(id, {
    status:       'confirmed',
    new_filename,
    confirmed_at: new Date().toISOString(),
  });
}


// ── Logo fingerprint API ──────────────────────────────────────────────────────

function saveLogoFingerprint({ supplier_name, phash, ahash, crop_zone = 'top' }) {
  // Check if a similar hash already exists for this supplier
  const existing = open().prepare(`
    SELECT id, phash FROM logo_fingerprints WHERE supplier_name = ?
  `).all(supplier_name);

  for (const row of existing) {
    const dist = hammingDistance(row.phash, phash);
    if (dist <= 10) {
      // Close enough — just increment match count
      open().prepare(`
        UPDATE logo_fingerprints SET match_count = match_count + 1, last_seen = datetime('now')
        WHERE id = ?
      `).run(row.id);
      return;
    }
  }

  // New fingerprint for this supplier
  open().prepare(`
    INSERT INTO logo_fingerprints (supplier_name, phash, ahash, crop_zone)
    VALUES (@supplier_name, @phash, @ahash, @crop_zone)
  `).run({ supplier_name, phash, ahash, crop_zone });
}

function getAllLogoFingerprints() {
  return open().prepare(`
    SELECT * FROM logo_fingerprints ORDER BY match_count DESC
  `).all();
}

function hammingDistance(hash1, hash2) {
  // Count differing bits between two hex hashes
  if (!hash1 || !hash2 || hash1.length !== hash2.length) return 64;
  let dist = 0;
  for (let i = 0; i < hash1.length; i++) {
    const xor = parseInt(hash1[i], 16) ^ parseInt(hash2[i], 16);
    dist += xor.toString(2).split('1').length - 1;
  }
  return dist;
}

function findLogoMatch(phash, threshold = 12) {
  // Find the closest matching supplier for a given perceptual hash
  const all = getAllLogoFingerprints();
  let best = null;
  let bestDist = threshold + 1;

  for (const row of all) {
    const dist = hammingDistance(row.phash, phash);
    if (dist < bestDist) {
      bestDist = dist;
      best = { ...row, distance: dist };
    }
  }
  return best; // null if no match within threshold
}

// ── Field anchors API ─────────────────────────────────────────────────────────

function saveFieldAnchor({ supplier_name, field_key, anchor_label,
                           direction, page_zone, x_norm, y_norm }) {
  // Use empty string if supplier unknown — avoids NOT NULL constraint
  const sup = supplier_name || '__unknown__';
  supplier_name = sup;
  return open().prepare(`
    INSERT INTO field_anchors
      (supplier_name, field_key, anchor_label, direction, page_zone, x_norm, y_norm)
    VALUES (@supplier_name, @field_key, @anchor_label, @direction, @page_zone, @x_norm, @y_norm)
    ON CONFLICT(supplier_name, field_key, anchor_label, direction) DO UPDATE SET
      usage_count = usage_count + 1,
      confidence  = MIN(1.0, confidence + 0.1),
      x_norm      = (@x_norm + x_norm) / 2.0,
      y_norm      = (@y_norm + y_norm) / 2.0,
      last_seen   = datetime('now')
  `).run({ supplier_name, field_key, anchor_label, direction, page_zone,
           x_norm: x_norm || 0, y_norm: y_norm || 0 });
}

function getFieldAnchors(supplier_name) {
  if (!supplier_name) return [];
  return open().prepare(`
    SELECT * FROM field_anchors
    WHERE supplier_name = ?
    ORDER BY usage_count DESC, confidence DESC
  `).all(supplier_name);
}

function getAllFieldAnchors() {
  return open().prepare(`
    SELECT * FROM field_anchors
    ORDER BY supplier_name, field_key, usage_count DESC
  `).all();
}


module.exports = {
  open,
  // Fields
  getFields, getAllFields, addCustomField, updateField, deleteCustomField,
  // Documents
  insertDocument, updateDocument, getReviewQueue, getDocument,
  getDocumentWithExtractions, confirmDocument,
  // Extractions
  insertExtractions,
  // Corrections & learning
  saveCorrections, getSupplierHints,
  // Anchors
  saveFieldAnchor, getFieldAnchors, getAllFieldAnchors,
  // Logo fingerprints
  saveLogoFingerprint, getAllLogoFingerprints, findLogoMatch,
  // UI helpers
  getReviewCount, getDeferredQueue, restoreDeferred,
};
