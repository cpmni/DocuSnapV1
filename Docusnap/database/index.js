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

  // Migration 4: add templates and template_fields tables; extend documents table
  if (!applied.has(4)) {
    if (!tableExists(db, 'templates')) {
      db.exec(`CREATE TABLE templates (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        name                 TEXT    NOT NULL,
        slug                 TEXT    NOT NULL UNIQUE,
        document_type_slug   TEXT,
        logo_phash           TEXT,
        keyword_fingerprint  TEXT,
        confirmed_count      INTEGER NOT NULL DEFAULT 0,
        created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
      )`);
    }
    if (!tableExists(db, 'template_fields')) {
      db.exec(`CREATE TABLE template_fields (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id  INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
        field_key    TEXT    NOT NULL,
        anchor_label TEXT,
        direction    TEXT    NOT NULL DEFAULT 'right',
        fixed_value  TEXT,
        is_variable  INTEGER NOT NULL DEFAULT 1,
        UNIQUE(template_id, field_key)
      )`);
    }
    const safeAdd = (col, def) => {
      if (tableExists(db, 'documents') && !hasColumn(db, 'documents', col)) {
        try { db.exec(`ALTER TABLE documents ADD COLUMN ${col} ${def}`); } catch {}
      }
    };
    safeAdd('template_id',          'INTEGER REFERENCES templates(id)');
    safeAdd('logo_phash',           'TEXT');
    safeAdd('keyword_fingerprint',  'TEXT');
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (4)').run();
    console.log('JS migration 4 applied: templates system');
  }

  // Migration 5: purge bad customer_name anchors (they were saved before supplier
  // identification, so clearAnchors never matched them by supplier)
  if (!applied.has(5)) {
    if (tableExists(db, 'field_anchors')) {
      db.exec(`DELETE FROM field_anchors WHERE field_key = 'customer_name'`);
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (5)').run();
    console.log('JS migration 5 applied: cleared bad customer_name anchors');
  }

  // Migration 6: add w_norm / h_norm to field_anchors (stores selection dimensions
  // so crop-and-OCR uses exactly the region the user dragged, not a fixed size)
  if (!applied.has(6)) {
    const safeAdd6 = (col) => {
      if (tableExists(db, 'field_anchors') && !hasColumn(db, 'field_anchors', col)) {
        try { db.exec(`ALTER TABLE field_anchors ADD COLUMN ${col} REAL NOT NULL DEFAULT 0`); } catch {}
      }
    };
    safeAdd6('w_norm');
    safeAdd6('h_norm');
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (6)').run();
    console.log('JS migration 6 applied: field_anchors w_norm/h_norm columns');
  }

  // Migration 8: Template Viewer / Anchor Mapping — pin a representative
  // sample document per template, and store admin-defined per-field
  // anchor → target zone mappings (additive: new nullable column + new
  // table; existing templates/extraction behaviour is untouched until an
  // admin actively maps a field — see template_mapper.py).
  if (!applied.has(8)) {
    if (tableExists(db, 'templates') && !hasColumn(db, 'templates', 'sample_document_id')) {
      try { db.exec(`ALTER TABLE templates ADD COLUMN sample_document_id INTEGER REFERENCES documents(id)`); } catch {}
    }
    if (!tableExists(db, 'template_field_mappings')) {
      db.exec(`CREATE TABLE template_field_mappings (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id      INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
        field_key        TEXT    NOT NULL,
        page_number      INTEGER NOT NULL DEFAULT 0,
        anchor_text      TEXT,
        anchor_x_norm    REAL, anchor_y_norm REAL, anchor_w_norm REAL, anchor_h_norm REAL,
        target_x_norm    REAL, target_y_norm REAL, target_w_norm REAL, target_h_norm REAL,
        offset_dx_norm   REAL, offset_dy_norm REAL,
        ocr_type         TEXT    NOT NULL DEFAULT 'text',
        search_expansion REAL    NOT NULL DEFAULT 0.04,
        region_hint      TEXT,
        enabled          INTEGER NOT NULL DEFAULT 1,
        last_test_value      TEXT,
        last_test_confidence REAL,
        last_test_status     TEXT,
        last_test_at         TEXT,
        created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),
        UNIQUE(template_id, field_key)
      )`);
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (8)').run();
    console.log('JS migration 8 applied: template viewer / anchor mapping (sample_document_id, template_field_mappings)');
  }

  // Migration 7: local authentication — users, recovery_codes, audit_log
  if (!applied.has(7)) {
    if (!tableExists(db, 'users')) {
      db.exec(`CREATE TABLE users (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        username             TEXT    NOT NULL UNIQUE COLLATE NOCASE,
        display_name         TEXT    NOT NULL,
        password_hash        TEXT    NOT NULL,
        role                 TEXT    NOT NULL CHECK(role IN ('admin','edit','readonly')),
        is_active            INTEGER NOT NULL DEFAULT 1,
        must_change_password INTEGER NOT NULL DEFAULT 0,
        last_login_at        TEXT,
        created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
      )`);
    }
    if (!tableExists(db, 'recovery_codes')) {
      db.exec(`CREATE TABLE recovery_codes (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code_hash   TEXT    NOT NULL,
        is_used     INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
        used_at     TEXT
      )`);
    }
    if (!tableExists(db, 'audit_log')) {
      db.exec(`CREATE TABLE audit_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
        action      TEXT    NOT NULL,
        target_type TEXT,
        target_id   TEXT,
        details     TEXT,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
      )`);
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (7)').run();
    console.log('JS migration 7 applied: local authentication (users, recovery_codes, audit_log)');
  }

  // Migration 10: store OCR full text per document for full-text search.
  // Stored in %APPDATA%\DocuSnap\docusnap.db — private app-data, not user-visible.
  // Truncated to 50,000 chars at the Python layer before insertion.
  if (!applied.has(10)) {
    if (tableExists(db, 'documents') && !hasColumn(db, 'documents', 'ocr_text')) {
      try { db.exec(`ALTER TABLE documents ADD COLUMN ocr_text TEXT`); } catch {}
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (10)').run();
    console.log('JS migration 10 applied: documents.ocr_text for full-text search');
  }

  // Migration 11: validation_note on extractions — stores Stage 4.5 anomaly reason.
  if (!applied.has(11)) {
    if (tableExists(db, 'extractions') && !hasColumn(db, 'extractions', 'validation_note')) {
      try { db.exec(`ALTER TABLE extractions ADD COLUMN validation_note TEXT`); } catch {}
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (11)').run();
    console.log('JS migration 11 applied: extractions.validation_note for format anomaly notes');
  }

  // Migration 9: template groups — organisational grouping for related templates
  // (same supplier family, layout variants). Grouping is v1 metadata only; no
  // shared-anchor behaviour is added here. Existing ungrouped templates continue
  // to match and extract identically — the new columns are nullable.
  if (!applied.has(9)) {
    if (!tableExists(db, 'template_groups')) {
      db.exec(`CREATE TABLE template_groups (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL UNIQUE,
        created_at TEXT    NOT NULL DEFAULT (datetime('now'))
      )`);
    }
    if (tableExists(db, 'templates') && !hasColumn(db, 'templates', 'group_id')) {
      try { db.exec(`ALTER TABLE templates ADD COLUMN group_id INTEGER REFERENCES template_groups(id)`); } catch {}
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (9)').run();
    console.log('JS migration 9 applied: template groups');
  }

  // Migration 3: remove extra built-in fields, keep only name/date/ref per type
  if (!applied.has(3)) {
    const keepBySlug = {
      invoice:        ['supplier_name', 'invoice_date',  'invoice_number'],
      sales_order:    ['customer_name', 'order_date',    'sales_order_number'],
      purchase_order: ['supplier_name', 'po_date',       'po_number'],
    };
    if (tableExists(db, 'document_types') && tableExists(db, 'fields')) {
      for (const [slug, keep] of Object.entries(keepBySlug)) {
        const dt = db.prepare('SELECT id FROM document_types WHERE slug = ?').get(slug);
        if (!dt) continue;
        const placeholders = keep.map(() => '?').join(',');
        db.prepare(
          `DELETE FROM fields WHERE document_type_id = ? AND built_in = 1 AND key NOT IN (${placeholders})`
        ).run(dt.id, ...keep);
      }
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (3)').run();
    console.log('JS migration 3 applied: trimmed built-in fields to name/date/ref');
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
