'use strict';

const path = require('path');
const fs   = require('fs');
const { app } = require('electron');

let _db = null;

// ── Open ──────────────────────────────────────────────────────────────────────

function open() {
  if (_db) return _db;
  const Database = require('better-sqlite3');
  const dbDir    = app.getPath('userData');
  const dbPath   = path.join(dbDir, 'docusnap.db');
  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  runMigrations(_db);
  seedDefaults(_db);
  return _db;
}

// ── Migrations ────────────────────────────────────────────────────────────────

function runMigrations(db) {
  // Ensure migrations table exists
  db.exec(`CREATE TABLE IF NOT EXISTS migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version INTEGER NOT NULL UNIQUE,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  const applied = new Set(
    db.prepare('SELECT version FROM migrations').all().map(r => r.version)
  );

  // Run SQL migration files
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const version = parseInt(file.split('_')[0]);
    if (applied.has(version)) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    db.exec(sql);
    db.prepare('INSERT INTO migrations (version) VALUES (?)').run(version);
    console.log(`Migration applied: ${file}`);
  }

  // Run JS migrations (for complex schema changes that SQL can't handle safely)
  runJsMigrations(db, applied);
}

function runJsMigrations(db, applied) {
  // Migration 2: upgrade v1 fields table to v2 (adds document_type_id)
  if (!applied.has(2)) {
    upgradeFieldsTable(db);
    addMissingColumns(db);
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (2)').run();
    console.log('JS migration 2 applied: v1 → v2 schema upgrade');
  }
}

function hasColumn(db, table, column) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    return cols.some(c => c.name === column);
  } catch { return false; }
}

function tableExists(db, table) {
  return !!db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
  ).get(table);
}

function upgradeFieldsTable(db) {
  // If fields table exists but lacks document_type_id, we need to recreate it
  if (!tableExists(db, 'fields')) return;
  if (hasColumn(db, 'fields', 'document_type_id')) return; // already upgraded

  console.log('Upgrading fields table from v1 to v2...');

  // Ensure document_types table exists first
  db.exec(`CREATE TABLE IF NOT EXISTS document_types (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL UNIQUE,
    slug            TEXT    NOT NULL UNIQUE,
    built_in        INTEGER NOT NULL DEFAULT 0,
    enabled         INTEGER NOT NULL DEFAULT 1,
    ref_field_key   TEXT,
    date_field_key  TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 100,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  )`);

  // Back up old fields, recreate with new schema
  db.exec(`ALTER TABLE fields RENAME TO fields_v1_backup`);
  db.exec(`CREATE TABLE fields (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    document_type_id     INTEGER NOT NULL REFERENCES document_types(id) ON DELETE CASCADE,
    key                  TEXT    NOT NULL,
    label                TEXT    NOT NULL,
    type                 TEXT    NOT NULL DEFAULT 'text',
    required             INTEGER NOT NULL DEFAULT 0,
    built_in             INTEGER NOT NULL DEFAULT 0,
    enabled              INTEGER NOT NULL DEFAULT 1,
    confidence_threshold INTEGER NOT NULL DEFAULT 70,
    sort_order           INTEGER NOT NULL DEFAULT 100,
    created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(document_type_id, key)
  )`);
  // Old fields_v1_backup left in place as safety net — can be dropped manually later
}

function addMissingColumns(db) {
  const safeAdd = (table, column, definition) => {
    if (tableExists(db, table) && !hasColumn(db, table, column)) {
      try {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        console.log(`  Added column ${table}.${column}`);
      } catch (e) {
        console.warn(`  Could not add ${table}.${column}: ${e.message}`);
      }
    }
  };

  safeAdd('documents', 'document_type_id', 'INTEGER REFERENCES document_types(id)');
  safeAdd('documents', 'stored_filename',  'TEXT');
  safeAdd('documents', 'stored_path',      'TEXT');
  safeAdd('documents', 'doc_date',         'TEXT');
  safeAdd('documents', 'reference_number', 'TEXT');
  safeAdd('extractions', 'extraction_method', 'TEXT');
  safeAdd('corrections', 'document_type',  'TEXT');
  safeAdd('supplier_hints', 'document_type', 'TEXT');

  // Create new tables if missing
  if (!tableExists(db, 'settings')) {
    db.exec(`CREATE TABLE settings (
      key        TEXT PRIMARY KEY,
      value      TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  }
  if (!tableExists(db, 'document_types')) {
    db.exec(`CREATE TABLE document_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE, slug TEXT NOT NULL UNIQUE,
      built_in INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1,
      ref_field_key TEXT, date_field_key TEXT,
      sort_order INTEGER NOT NULL DEFAULT 100,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  }
  if (!tableExists(db, 'field_anchors')) {
    db.exec(`CREATE TABLE field_anchors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_name TEXT, document_type TEXT, field_key TEXT NOT NULL,
      anchor_label TEXT NOT NULL, direction TEXT NOT NULL,
      page_zone TEXT NOT NULL, x_norm REAL, y_norm REAL,
      usage_count INTEGER NOT NULL DEFAULT 1,
      confidence REAL NOT NULL DEFAULT 1.0,
      last_seen TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(supplier_name, document_type, field_key, anchor_label, direction)
    )`);
  }
  if (!tableExists(db, 'logo_fingerprints')) {
    db.exec(`CREATE TABLE logo_fingerprints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_name TEXT NOT NULL, phash TEXT NOT NULL, ahash TEXT NOT NULL,
      crop_zone TEXT NOT NULL DEFAULT 'top_left',
      match_count INTEGER NOT NULL DEFAULT 1,
      last_seen TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  }
}

// ── Seed default data ─────────────────────────────────────────────────────────

function seedDefaults(db) {
  const docTypes = require('./modules/document_types');
  docTypes.seedBuiltInTypes(db);
}

module.exports = { open };
