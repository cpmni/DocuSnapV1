-- Migration 001: Initial schema
-- Creates all base tables for DocuSnap v2

CREATE TABLE IF NOT EXISTS migrations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  version    INTEGER NOT NULL UNIQUE,
  applied_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Document type definitions
CREATE TABLE IF NOT EXISTS document_types (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL UNIQUE,  -- e.g. "Invoice"
  slug            TEXT    NOT NULL UNIQUE,  -- e.g. "invoice"
  built_in        INTEGER NOT NULL DEFAULT 0,
  enabled         INTEGER NOT NULL DEFAULT 1,
  ref_field_key   TEXT,                     -- which field is the filename reference
  date_field_key  TEXT,                     -- which field is the filename date
  sort_order      INTEGER NOT NULL DEFAULT 100,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Fields per document type
CREATE TABLE IF NOT EXISTS fields (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  document_type_id     INTEGER NOT NULL REFERENCES document_types(id) ON DELETE CASCADE,
  key                  TEXT    NOT NULL,
  label                TEXT    NOT NULL,
  type                 TEXT    NOT NULL DEFAULT 'text',  -- text|date|number|currency|dropdown
  required             INTEGER NOT NULL DEFAULT 0,
  built_in             INTEGER NOT NULL DEFAULT 0,
  enabled              INTEGER NOT NULL DEFAULT 1,
  confidence_threshold INTEGER NOT NULL DEFAULT 70,
  sort_order           INTEGER NOT NULL DEFAULT 100,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(document_type_id, key)
);

-- Processed documents
CREATE TABLE IF NOT EXISTS documents (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  document_type_id    INTEGER REFERENCES document_types(id),
  original_filename   TEXT    NOT NULL,
  stored_filename     TEXT,
  stored_path         TEXT,
  folder_path         TEXT    NOT NULL,
  status              TEXT    NOT NULL DEFAULT 'pending',
    -- pending | needs_review | deferred | confirmed | deleted | error
  overall_confidence  INTEGER,
  supplier_name       TEXT,
  doc_date            TEXT,
  reference_number    TEXT,
  processed_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  confirmed_at        TEXT,
  error_message       TEXT
);

-- Per-field extracted values
CREATE TABLE IF NOT EXISTS extractions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id   INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  field_key     TEXT    NOT NULL,
  raw_value     TEXT,
  display_value TEXT,
  confidence    INTEGER,
  was_corrected INTEGER NOT NULL DEFAULT 0,
  corrected_to  TEXT,
  extraction_method TEXT  -- 'keyword'|'anchor'|'llm'|'manual'
);

-- User corrections (learning source)
CREATE TABLE IF NOT EXISTS corrections (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id      INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  field_key        TEXT    NOT NULL,
  original_value   TEXT,
  corrected_value  TEXT    NOT NULL,
  supplier_name    TEXT,
  document_type    TEXT,
  corrected_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Supplier + doc type hints (few-shot learning)
CREATE TABLE IF NOT EXISTS supplier_hints (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_name TEXT    NOT NULL,
  document_type TEXT,
  field_key     TEXT    NOT NULL,
  hint_value    TEXT    NOT NULL,
  usage_count   INTEGER NOT NULL DEFAULT 1,
  last_seen     TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(supplier_name, document_type, field_key, hint_value)
);

-- Structural field anchors (spatial learning)
CREATE TABLE IF NOT EXISTS field_anchors (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_name  TEXT,
  document_type  TEXT,
  field_key      TEXT    NOT NULL,
  anchor_label   TEXT    NOT NULL,
  direction      TEXT    NOT NULL,  -- right|below|above|inline
  page_zone      TEXT    NOT NULL,  -- top|middle|bottom
  x_norm         REAL,
  y_norm         REAL,
  usage_count    INTEGER NOT NULL DEFAULT 1,
  confidence     REAL    NOT NULL DEFAULT 1.0,
  last_seen      TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(supplier_name, document_type, field_key, anchor_label, direction)
);

-- Logo perceptual hash fingerprints
CREATE TABLE IF NOT EXISTS logo_fingerprints (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_name  TEXT    NOT NULL,
  phash          TEXT    NOT NULL,
  ahash          TEXT    NOT NULL,
  crop_zone      TEXT    NOT NULL DEFAULT 'top_left',
  match_count    INTEGER NOT NULL DEFAULT 1,
  last_seen      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- App settings (key-value store)
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
