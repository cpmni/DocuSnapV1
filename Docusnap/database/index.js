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
  // Audit M1 — "deletion isn't erasure". Without secure_delete, a deleted row's pages
  // (including the up-to-50k-char ocr_text) go to the SQLite freelist INTACT and are
  // recoverable with `strings docusnap.db`. secure_delete=ON zeroes freed pages on every
  // delete, so purge/recycle-bin/reset actually remove content. Per-connection pragma, set
  // at open. (Disk-theft of LIVE docs is a separate concern — BitLocker is the control there.)
  _db.pragma('secure_delete = ON');
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
  // ── Workflow 'paid' heal — MUST run BEFORE any stamped block (Workflow Slice 1, Oracle
  // condition 1). The half-wired 'paid' route state was removed for v1: it sat in neither
  // OPEN_STATES nor CLOSED_STATES, so a paid route was invisible in inbox/assigned/completed.
  // Heal any dark-era rows to 'approved' (their true semantics: an approve-type route resolved
  // by its recipient — healing RESTORES their visibility in Completed). UNSTAMPED + idempotent:
  // re-running is free and self-heals restored/worktree DBs every boot. Placed at the TOP of
  // this function so a FUTURE stamped table-rebuild that adds a CHECK constraint (Workflow
  // Slice 4) can never see a nonconforming 'paid' row, even on the first boot of a dark-era
  // DB. Do NOT move this below the stamped blocks — pinned by
  // database/modules/test_workflow_paid_heal.js. `version` is deliberately NOT bumped ('paid'
  // is terminal; no CAS can act on it — also pinned).
  if (tableExists(db, 'document_routes')) {
    try {
      const routesHealed = db.prepare(`UPDATE document_routes SET state='approved' WHERE state='paid'`).run().changes;
      const docsHealed = (tableExists(db, 'documents') && hasColumn(db, 'documents', 'workflow_status'))
        ? db.prepare(`UPDATE documents SET workflow_status='approved' WHERE workflow_status='paid'`).run().changes
        : 0;
      if (routesHealed || docsHealed) {
        console.log(`Workflow heal: 'paid' -> 'approved' (${routesHealed} route(s), ${docsHealed} doc(s))`);
        try {
          require('./modules/auth').addAuditEntry(db, {
            user_id: null, action: 'workflow_paid_migrated', action_category: 'workflow',
            outcome: 'success', metadata: { routes: routesHealed, docs: docsHealed },
          });
        } catch { /* audit is best-effort — must never abort migrations */ }
      }
    } catch (e) { console.warn(`  workflow paid heal: ${e.message}`); }
  }

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

  // Migration 12: template-level OCR auto-processing — a learned, template-tied
  // preprocessing rule (skew/threshold/noise params) that can be applied
  // automatically on reprocess for documents matched to this template, even
  // when manual OCR Preview is off. Additive/nullable; existing templates are
  // unaffected until a rule is created (see processing/handler.js reprocess-document
  // and templates.setOcrAutoParams).
  if (!applied.has(12)) {
    if (tableExists(db, 'templates') && !hasColumn(db, 'templates', 'ocr_auto_enabled')) {
      try { db.exec(`ALTER TABLE templates ADD COLUMN ocr_auto_enabled INTEGER NOT NULL DEFAULT 0`); } catch {}
    }
    if (tableExists(db, 'templates') && !hasColumn(db, 'templates', 'ocr_auto_params')) {
      try { db.exec(`ALTER TABLE templates ADD COLUMN ocr_auto_params TEXT`); } catch {}
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (12)').run();
    console.log('JS migration 12 applied: templates.ocr_auto_enabled / ocr_auto_params');
  }

  // Migration 14: add anchor_label to extractions — stores the anchor label used
  // so the review UI can show a "From anchor: xxxxxx" note. Additive/nullable;
  // existing rows stay null (no note) until the next (re)process repopulates them.
  if (!applied.has(14)) {
    if (tableExists(db, 'extractions') && !hasColumn(db, 'extractions', 'anchor_label')) {
      try { db.exec(`ALTER TABLE extractions ADD COLUMN anchor_label TEXT`); } catch {}
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (14)').run();
    console.log('JS migration 14 applied: extractions.anchor_label');
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

  // Migration 16: licensing scaffolding (Loop 4 / Phase 0). Creates the two
  // CLIENT-side local tables. Additive and inert: nothing reads or writes them
  // in Phase 0, and enforcement stays OFF, so app behavior is unchanged until
  // later phases wire them up. Idempotent — guarded by applied.has(16) and
  // tableExists, so a re-run is a no-op.
  //   device_registrations: local MIRROR of the fingerprint (fp_hash). The
  //     authoritative trial clock lives server-side; deleting this row can never
  //     mint or reset a trial.
  //   license_tokens: read-only cache of the latest signed JWS + parsed columns;
  //     a missing/deleted cache simply forces an online check.
  if (!applied.has(16)) {
    if (!tableExists(db, 'device_registrations')) {
      db.exec(`CREATE TABLE device_registrations (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        fp_hash    TEXT    NOT NULL UNIQUE,
        created_at TEXT    NOT NULL DEFAULT (datetime('now'))
      )`);
    }
    if (!tableExists(db, 'license_tokens')) {
      db.exec(`CREATE TABLE license_tokens (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        kind              TEXT    NOT NULL,
        subject           TEXT    NOT NULL,
        token_blob        TEXT    NOT NULL,
        state             TEXT    NOT NULL,
        not_after         TEXT,
        grace_until       TEXT,
        last_validated_at TEXT,
        kid               TEXT,
        created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
        UNIQUE(kind, subject)
      )`);
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (16)').run();
    console.log('JS migration 16 applied: licensing scaffolding (device_registrations, license_tokens)');
  }

  // Migration 17: app-managed working copy of each imported document, so
  // preview / reprocess / confirm never depend on the user's source folder
  // continuing to exist. Old rows keep working_path NULL and fall back to
  // stored_path / folder_path as before (no backfill).
  if (!applied.has(17)) {
    if (tableExists(db, 'documents') && !hasColumn(db, 'documents', 'working_path')) {
      try { db.exec(`ALTER TABLE documents ADD COLUMN working_path TEXT`); } catch {}
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (17)').run();
    console.log('JS migration 17 applied: documents.working_path (managed working copy)');
  }

  // Migration 18: explicit "review acknowledged" timestamp. A flagged document
  // (validation note / correction candidate / below-threshold field) is held
  // back from bulk "File All Ready" until a human deliberately acknowledges it
  // via the Mark Reviewed button, which stamps this column. Cleared on reprocess
  // so stale approval is never reused. NULL = not acknowledged (default; no
  // backfill — pre-existing flagged rows stay held back until reviewed).
  if (!applied.has(18)) {
    if (tableExists(db, 'documents') && !hasColumn(db, 'documents', 'review_acknowledged_at')) {
      try { db.exec(`ALTER TABLE documents ADD COLUMN review_acknowledged_at TEXT`); } catch {}
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (18)').run();
    console.log('JS migration 18 applied: documents.review_acknowledged_at (explicit review ack)');
  }

  // Migration 19: admin-managed keyword label overrides. Lets an admin add extra
  // label words for a (doc-type, field) so the cheap keyword stage (Stage 1)
  // catches the field without per-document anchor teaching. CUSTOMER-SPECIFIC and
  // per-installation: this table lives in userData and is NEVER packaged — only
  // the shipped config/keyword_patterns.json carries default labels. Rows are
  // merged onto those defaults at processing time, scoped to the doc-type slug.
  if (!applied.has(19)) {
    db.exec(`CREATE TABLE IF NOT EXISTS field_label_overrides (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_type_slug TEXT NOT NULL,
      field_key     TEXT NOT NULL,
      label         TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(doc_type_slug, field_key, label)
    )`);
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (19)').run();
    console.log('JS migration 19 applied: field_label_overrides (admin keyword label overrides)');
  }

  // Migration 20: field_anchors.last_authoritative_at — set when an operator
  // EXPLICITLY (re)draws a field's box via the ⊕ tool. An explicit re-teach is
  // the highest-quality signal the system gets; this timestamp lets extraction
  // prefer the most recently human-corrected anchor over one that merely
  // accumulated a high passive usage_count, so a correction takes effect
  // immediately instead of being out-voted/blended away. NULL for passively
  // auto-learned anchors (the existing confirm-time corpus).
  if (!applied.has(20)) {
    if (tableExists(db, 'field_anchors') && !hasColumn(db, 'field_anchors', 'last_authoritative_at')) {
      try { db.exec(`ALTER TABLE field_anchors ADD COLUMN last_authoritative_at TEXT`); } catch {}
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (20)').run();
    console.log('JS migration 20 applied: field_anchors.last_authoritative_at (explicit re-teach precedence)');
  }

  // Migration 21: field_anchors.offset_dx_norm / offset_dy_norm — the DRIFT-
  // INVARIANT label→value vector captured at ⊕ teach time (value-centre minus the
  // located label's top-left, page-normalised). Lets anchor.py relocate the value
  // from where the label ACTUALLY sits + this offset, so a correction taught on a
  // clipped/shifted scan yields the same relationship as one taught on a clean
  // page (no longer poisons normal-page extraction). NULL on legacy anchors →
  // anchor.py falls back to its geometric guess; non-destructive.
  if (!applied.has(21)) {
    for (const col of ['offset_dx_norm', 'offset_dy_norm']) {
      if (tableExists(db, 'field_anchors') && !hasColumn(db, 'field_anchors', col)) {
        try { db.exec(`ALTER TABLE field_anchors ADD COLUMN ${col} REAL`); } catch {}
      }
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (21)').run();
    console.log('JS migration 21 applied: field_anchors.offset_dx_norm/offset_dy_norm (drift-invariant teach offset)');
  }

  // Migration 22: registration-invariant anchoring groundwork ("register, then
  // read"). ADDITIVE and inert — nothing reads it until the Stage 0.5 registration
  // rung (registration_enabled) is wired up, so existing templates and extraction
  // behaviour are unchanged.
  //   template_landmarks — 3-5 stable, well-separated, high-confidence text words
  //     captured per template at teach time (or backfilled by re-OCRing the pinned
  //     sample_document_id). At run time these are RE-located and matched
  //     taught→found to fit a robust similarity/affine transform, so a shifted/
  //     skewed/scaled scan still maps the taught target boxes onto the page. Many
  //     rows per template → its own table, ON DELETE CASCADE with the template.
  // (No teach_render_scale column: the fit is in normalised 0-1 coords, so the
  // teach→run render-scale difference cancels in the transform — storing it would
  // be dead weight.)
  if (!applied.has(22)) {
    if (!tableExists(db, 'template_landmarks')) {
      db.exec(`CREATE TABLE template_landmarks (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id  INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
        label_text   TEXT    NOT NULL,
        x_norm       REAL    NOT NULL,
        y_norm       REAL    NOT NULL,
        w_norm       REAL    NOT NULL,
        h_norm       REAL    NOT NULL,
        ocr_conf     REAL,
        page_number  INTEGER NOT NULL DEFAULT 0,
        source       TEXT    NOT NULL DEFAULT 'auto',
        created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
      )`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_template_landmarks_template
               ON template_landmarks(template_id)`);
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (22)').run();
    console.log('JS migration 22 applied: registration groundwork (template_landmarks)');
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

  // Migration 23: sanitise document-specific tokens out of learned anchor labels.
  // An auto-detected ⊕ label could absorb a document's own reference/date
  // ("2605-0769-1 Work Address"), so the anchor could never be re-located on a
  // document with a different reference — the customer-field "won't drift" bug.
  // Clean every stored label to its stable caption; when the label changes its
  // drift-invariant offset was measured against the polluted position, so NULL it
  // (extraction falls back to the geometric guess). Delete an anchor whose label
  // is ENTIRELY document-specific (no caption survives) — it can never reliably
  // match. Safe + reusable: learned positions are re-learnable and a clean anchor
  // strictly generalises better than a poisoned one. Mirrors migration 5's purge.
  if (!applied.has(23)) {
    try {
      const { sanitizeAnchorLabel } = require('./modules/learning');
      if (tableExists(db, 'field_anchors')) {
        const rows = db.prepare('SELECT id, anchor_label FROM field_anchors').all();
        const upd = db.prepare('UPDATE field_anchors SET anchor_label = ?, offset_dx_norm = NULL, offset_dy_norm = NULL WHERE id = ?');
        const del = db.prepare('DELETE FROM field_anchors WHERE id = ?');
        let cleaned = 0, deleted = 0;
        for (const r of rows) {
          const clean = sanitizeAnchorLabel(r.anchor_label);
          if (clean === (r.anchor_label || '').trim()) continue; // already a clean caption
          if (clean) { upd.run(clean, r.id); cleaned++; }
          else { del.run(r.id); deleted++; }
        }
        console.log(`JS migration 23 applied: sanitised anchor labels (cleaned ${cleaned}, deleted ${deleted})`);
      }
    } catch (e) {
      console.warn('JS migration 23 skipped: ' + (e && e.message));
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (23)').run();
  }

  // Migration 24: don't re-onboard EXISTING installs. The first-run setup wizard
  // shows when `first_run_completed` !== 'true'; stamp the flag on any DB that is
  // already configured (has an output_folder), so ONLY a genuinely clean install
  // sees the wizard. A fresh DB has no output_folder -> flag stays unset -> wizard.
  if (!applied.has(24)) {
    try {
      if (tableExists(db, 'settings')) {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'output_folder'").get();
        if (row && String(row.value || '').trim()) {
          db.prepare(`INSERT INTO settings (key, value) VALUES ('first_run_completed', 'true')
                      ON CONFLICT(key) DO UPDATE SET value = 'true'`).run();
          console.log('JS migration 24 applied: marked existing configured install as onboarded');
        } else {
          console.log('JS migration 24 applied: clean install — first-run wizard will show');
        }
      }
    } catch (e) {
      console.warn('JS migration 24 skipped: ' + (e && e.message));
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (24)').run();
  }

  // Migration 25: extend audit_log into a structured, GDPR-aware audit trail.
  // Additive + nullable columns only (existing rows keep working). Snapshots the
  // actor (username/role) so a record survives a user rename/deletion (user_id is
  // SET NULL on delete). action_category/outcome/document_id/customer_id/
  // session_id/source/metadata_json give searchable, sanitised structure. Indexes
  // back the admin search. NEVER stores secrets/contents — see auth.sanitiseAuditMeta.
  if (!applied.has(25)) {
    if (tableExists(db, 'audit_log')) {
      const addCol = (name, def) => {
        if (!hasColumn(db, 'audit_log', name)) {
          try { db.exec(`ALTER TABLE audit_log ADD COLUMN ${name} ${def}`); }
          catch (e) { console.warn(`  audit_log.${name}: ${e.message}`); }
        }
      };
      addCol('action_category', 'TEXT');
      addCol('outcome',         "TEXT");      // success | failure | denied
      addCol('document_id',     'INTEGER');
      addCol('customer_id',     'TEXT');
      addCol('session_id',      'TEXT');
      addCol('source',          "TEXT DEFAULT 'desktop'");
      addCol('metadata_json',   'TEXT');
      addCol('actor_username',  'TEXT');      // snapshot at write time
      addCol('actor_role',      'TEXT');      // snapshot at write time
      try { db.exec('CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at)'); } catch {}
      try { db.exec('CREATE INDEX IF NOT EXISTS idx_audit_user    ON audit_log(user_id)'); } catch {}
      try { db.exec('CREATE INDEX IF NOT EXISTS idx_audit_cat     ON audit_log(action_category)'); } catch {}
      try { db.exec('CREATE INDEX IF NOT EXISTS idx_audit_doc     ON audit_log(document_id)'); } catch {}
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (25)').run();
    console.log('JS migration 25 applied: structured audit_log (category/outcome/actor snapshot/metadata + indexes)');
  }

  // Migration 26: MULTI-REFERENCE logo phash. A template's identity drifts by
  // double-digit Hamming across scans (DPI/enhance), so a single frozen logo_phash
  // makes a later same-supplier scan fail the reuse gate and spawn a duplicate. A
  // template now carries a SET of logo hashes (match against the closest; confirms
  // append drifted-but-related ones) so the reference set converges to span the
  // drift. templates.logo_phash stays as the seed/primary (non-destructive);
  // backfill one child row per existing non-null value. Mirrors template_landmarks.
  if (!applied.has(26)) {
    if (!tableExists(db, 'template_logo_hashes')) {
      db.exec(`CREATE TABLE template_logo_hashes (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id  INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
        phash        TEXT    NOT NULL,
        created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
        UNIQUE(template_id, phash)
      )`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_template_logo_hashes_template
               ON template_logo_hashes(template_id)`);
      if (tableExists(db, 'templates')) {
        try {
          db.exec(`INSERT OR IGNORE INTO template_logo_hashes (template_id, phash)
                   SELECT id, logo_phash FROM templates
                   WHERE logo_phash IS NOT NULL AND logo_phash != ''`);
        } catch (e) { console.warn('  template_logo_hashes backfill:', e.message); }
      }
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (26)').run();
    console.log('JS migration 26 applied: multi-reference logo phash (template_logo_hashes)');
  }

  // Migration 27: STRUCTURAL fields (Company / Date / Reference) are permanent.
  // (1) Relabel the company/identity field to "Company" (the value's internal key
  // stays supplier_name/customer_name — only the display label changes — so the
  // learning schema is untouched). (2) RE-ENABLE any structural field a user had
  // toggled off before this protection existed (they drive filing + learning and
  // must always be present). Idempotent.
  if (!applied.has(27)) {
    if (tableExists(db, 'fields')) {
      try {
        db.exec(`UPDATE fields SET label = 'Company'
                 WHERE key IN ('supplier_name','customer_name')
                   AND label IN ('Supplier Name','Customer Name')`);
        db.exec(`UPDATE fields SET enabled = 1 WHERE enabled = 0 AND (
                   key IN ('supplier_name','customer_name')
                   OR id IN (SELECT f.id FROM fields f
                             JOIN document_types dt ON dt.id = f.document_type_id
                             WHERE f.key = dt.ref_field_key OR f.key = dt.date_field_key))`);
      } catch (e) { console.warn('  migration 27 (structural fields):', e.message); }
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (27)').run();
    console.log('JS migration 27 applied: structural fields permanent + relabel Company');
  }

  // Migration 28: TOTP second factor for the detached-client auth boundary.
  // (Renumbered 26 → 28 on merge — migrations 26/27 are owned by the logo/structural
  // work on main; this stays a distinct, stamped migration.)
  // Additive + nullable: totp_secret (base32, NULL until enrolled) and
  // totp_enabled (0/1, only set once a code is confirmed). Inert for the desktop
  // app — the in-process login path never reads these; only the detached-client
  // API enforces MFA when totp_enabled = 1. Existing users keep working (MFA off).
  if (!applied.has(28)) {
    if (tableExists(db, 'users')) {
      if (!hasColumn(db, 'users', 'totp_secret')) {
        try { db.exec(`ALTER TABLE users ADD COLUMN totp_secret TEXT`); } catch (e) { console.warn(`  users.totp_secret: ${e.message}`); }
      }
      if (!hasColumn(db, 'users', 'totp_enabled')) {
        try { db.exec(`ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0`); } catch (e) { console.warn(`  users.totp_enabled: ${e.message}`); }
      }
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (28)').run();
    console.log('JS migration 28 applied: users.totp_secret/totp_enabled (detached-client MFA)');
  }

  // Migration 29: index audit_log for the two filtered-search paths that were full
  // scans. Migration 25 already covered the default list (reverse-PK LIMIT) and the
  // created_at/user/category/document filters; these add the `outcome` filter and the
  // (action_category, created_at) composite the admin search uses. Additive +
  // idempotent (CREATE INDEX IF NOT EXISTS); guarded so a pre-migration-25 table is skipped.
  if (!applied.has(29)) {
    if (tableExists(db, 'audit_log')) {
      if (hasColumn(db, 'audit_log', 'outcome')) {
        try { db.exec('CREATE INDEX IF NOT EXISTS idx_audit_outcome ON audit_log(outcome)'); }
        catch (e) { console.warn(`  idx_audit_outcome: ${e.message}`); }
      }
      if (hasColumn(db, 'audit_log', 'action_category')) {
        try { db.exec('CREATE INDEX IF NOT EXISTS idx_audit_cat_created ON audit_log(action_category, created_at)'); }
        catch (e) { console.warn(`  idx_audit_cat_created: ${e.message}`); }
      }
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (29)').run();
    console.log('JS migration 29 applied: audit_log search indexes (outcome, action_category+created_at)');
  }

  // Migration 30: concurrent client-seat leases for the detached search clients. One
  // row per ACTIVE sticky seat — claimed by a stable client_key, freed ONLY by an
  // admin (no auto-expiry; release deletes the row, the audit_log keeps the history).
  // Persisted so seat assignments survive a core-app restart. Additive + idempotent.
  if (!applied.has(30)) {
    db.exec(`CREATE TABLE IF NOT EXISTS client_seats (
      id          TEXT    NOT NULL PRIMARY KEY,
      client_key  TEXT    NOT NULL UNIQUE,
      username    TEXT,
      role        TEXT,
      hostname    TEXT,
      ip          TEXT,
      first_seen  INTEGER NOT NULL,
      last_seen   INTEGER NOT NULL
    )`);
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (30)').run();
    console.log('JS migration 30 applied: client_seats (concurrent sticky seat leases)');
  }

  // Migration 31: admin-LOCKED fixed values. A fixed value an admin explicitly set in
  // the Template Wizard (template_fields.fixed_locked = 1) is a deliberate, protected
  // override — distinct from an auto-derived non-variable seed (fixed_locked = 0). It is
  // preserved across confirmed-history rebuilds (templates._upsertFields) and emitted by
  // Stage 0 as method 'template_fixed_locked' so the engine protects it from ordinary
  // OCR/keyword/anchor overrides (ordinary 'template_fixed' stays overridable). Additive +
  // idempotent.
  if (!applied.has(31)) {
    if (tableExists(db, 'template_fields') && !hasColumn(db, 'template_fields', 'fixed_locked')) {
      try { db.exec(`ALTER TABLE template_fields ADD COLUMN fixed_locked INTEGER NOT NULL DEFAULT 0`); }
      catch (e) { console.warn(`  template_fields.fixed_locked: ${e.message}`); }
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (31)').run();
    console.log('JS migration 31 applied: template_fields.fixed_locked (admin-locked fixed values)');
  }

  // Migration 32: workflow add-on flag on a client seat. Workflow is an upgrade ON a held
  // search seat (workflow ≤ search), capped independently; this records which seats hold it
  // so the pool can count workflow occupancy. Display/enforcement only — never an identity.
  // Additive + idempotent.
  if (!applied.has(32)) {
    if (tableExists(db, 'client_seats') && !hasColumn(db, 'client_seats', 'workflow_enabled')) {
      try { db.exec(`ALTER TABLE client_seats ADD COLUMN workflow_enabled INTEGER NOT NULL DEFAULT 0`); }
      catch (e) { console.warn(`  client_seats.workflow_enabled: ${e.message}`); }
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (32)').run();
    console.log('JS migration 32 applied: client_seats.workflow_enabled (workflow add-on)');
  }

  // Migration 33: manual registration landmarks ("Enhance detection" in the Template
  // Manager). source = 'auto' (derived by ocr/landmarks.py) | 'manual' (admin-drawn).
  // Auto-derivation can latch onto document-VARIABLE text; a manual set lets an admin
  // pin guaranteed-stable chrome and is PROTECTED from auto-regeneration. Additive +
  // idempotent; existing rows default to 'auto', so behaviour is unchanged.
  if (!applied.has(33)) {
    if (tableExists(db, 'template_landmarks') && !hasColumn(db, 'template_landmarks', 'source')) {
      try { db.exec(`ALTER TABLE template_landmarks ADD COLUMN source TEXT NOT NULL DEFAULT 'auto'`); }
      catch (e) { console.warn(`  template_landmarks.source: ${e.message}`); }
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (33)').run();
    console.log('JS migration 33 applied: template_landmarks.source (manual landmarks)');
  }

  // Migration 34: cross-sample landmark corpus. Per-confirmed-document word lists
  // (high-conf, alphabetic, normalised boxes) accumulate here; once >=3 docs exist a
  // template's registration landmarks are auto-derived from words that RECUR at a
  // STABLE position across docs (ocr/landmarks.select_cross_sample) — the automatic,
  // no-human-picking path. Additive; cascade-deletes with the template.
  if (!applied.has(34)) {
    if (!tableExists(db, 'template_sample_words')) {
      db.exec(`CREATE TABLE template_sample_words (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id  INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
        doc_id       INTEGER,
        label_text   TEXT    NOT NULL,
        x_norm       REAL    NOT NULL,
        y_norm       REAL    NOT NULL,
        w_norm       REAL    NOT NULL,
        h_norm       REAL    NOT NULL,
        ocr_conf     REAL,
        created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
      )`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_tpl_sample_words_tpl ON template_sample_words(template_id)`);
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (34)').run();
    console.log('JS migration 34 applied: template_sample_words (cross-sample landmark corpus)');
  }

  // Migration 35: clearer company-role labels (reverses migration 27's "Company"
  // unification). The single "Company" label proved ambiguous on issuer-style docs —
  // it reads as either the issuer or the recipient. Relabel the company/identity field
  // to MATCH its internal KEY so the label tells the operator exactly what belongs
  // there: supplier_name → "Supplier Name", customer_name → "Customer Name". The KEY
  // (the per-company learning scope: logo/hints/anchors/templates) is unchanged, so the
  // learning schema is untouched. Scoped to rows still labelled "Company" so a
  // hand-edited label is left alone. Idempotent.
  if (!applied.has(35)) {
    if (tableExists(db, 'fields')) {
      try {
        db.exec(`UPDATE fields SET label = 'Supplier Name'
                 WHERE key = 'supplier_name' AND label = 'Company'`);
        db.exec(`UPDATE fields SET label = 'Customer Name'
                 WHERE key = 'customer_name' AND label = 'Company'`);
      } catch (e) { console.warn('  migration 35 (company-role relabel):', e.message); }
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (35)').run();
    console.log('JS migration 35 applied: relabel company-role field by key (Supplier/Customer Name)');
  }

  // Migration 36: operator-taught field CLEANUP rules (Review right-click toolkit) —
  // remove a learned leaked caption ('remove_text') or keep the single pattern-matching
  // block ('keep_block') for a field, applied at extraction time to strip an adjacent
  // heading/column OCR bled in. Scoped like the other learning corpora (supplier_name /
  // document_type / field_key, with '__global__' supplier). token_norm is the normalised
  // match key for remove_text (NULL for keep_block). Additive + idempotent.
  if (!applied.has(36)) {
    if (!tableExists(db, 'field_rules')) {
      db.exec(`CREATE TABLE field_rules (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier_name TEXT,
        document_type TEXT,
        field_key     TEXT    NOT NULL,
        rule_type     TEXT    NOT NULL,   -- 'remove_text' | 'keep_block'
        token_norm    TEXT,               -- remove_text: normalised literal; keep_block: NULL
        created_from  TEXT,               -- remove_text: the raw highlighted text (display)
        side          TEXT    NOT NULL DEFAULT 'trailing',  -- 'leading' | 'trailing'
        min_prefix    INTEGER NOT NULL DEFAULT 3,
        usage_count   INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
      )`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_field_rules_scope
               ON field_rules(supplier_name, document_type, field_key)`);
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (36)').run();
    console.log('JS migration 36 applied: field_rules (operator field-cleanup toolkit)');
  }

  // Migration 37: documents.page_count — captured at import so the Review list can flag
  // multi-page documents. Additive; NULL for pre-existing rows (no icon until reprocessed).
  if (!applied.has(37)) {
    try { db.exec(`ALTER TABLE documents ADD COLUMN page_count INTEGER`); }
    catch (e) { console.warn(`  documents.page_count: ${e.message}`); }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (37)').run();
    console.log('JS migration 37 applied: documents.page_count');
  }

  // Migration 38: relabel the company/identity field to "Document Issuer" for BOTH
  // company roles — one unambiguous label so an operator never enters variable data
  // (e.g. a customer name) in the identity field. Label-only; the internal keys
  // (supplier_name/customer_name) and the learning scope are untouched. Scoped to the
  // prior auto-set labels so a hand-edited label is left alone. Idempotent.
  if (!applied.has(38)) {
    try {
      db.exec(`UPDATE fields SET label = 'Document Issuer'
               WHERE key IN ('supplier_name','customer_name')
                 AND label IN ('Supplier Name','Customer Name','Company')`);
    } catch (e) { console.warn('  migration 38 (Document Issuer relabel):', e.message); }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (38)').run();
    console.log('JS migration 38 applied: company field → "Document Issuer"');
  }

  // Migration 39: performance indexes on the hot user-data tables. Until now only the
  // PRIMARY KEYs were indexed, so as the corpus grows into six figures these paths
  // degraded to full scans: the engine's per-doc learning lookups (corrections / hints /
  // anchors by supplier+type+field, run on every processed document), the Review queue's
  // per-row extraction subqueries (extractions had no document_id index), and Search /
  // dashboard filtering+ordering of documents by status/date. All CREATE INDEX IF NOT
  // EXISTS — idempotent, safe to re-run, and transparent to every code path (the query
  // planner just starts using them). Pure read-path speedup; no behaviour change.
  if (!applied.has(39)) {
    try {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_extractions_doc       ON extractions(document_id);
        CREATE INDEX IF NOT EXISTS idx_documents_status_proc ON documents(status, processed_at);
        CREATE INDEX IF NOT EXISTS idx_documents_status_conf ON documents(status, confirmed_at);
        CREATE INDEX IF NOT EXISTS idx_documents_supplier    ON documents(supplier_name);
        CREATE INDEX IF NOT EXISTS idx_documents_type        ON documents(document_type_id);
        CREATE INDEX IF NOT EXISTS idx_corrections_scope     ON corrections(supplier_name, document_type, field_key);
        CREATE INDEX IF NOT EXISTS idx_hints_scope           ON supplier_hints(supplier_name, document_type, field_key);
        CREATE INDEX IF NOT EXISTS idx_anchors_scope         ON field_anchors(supplier_name, document_type, field_key);
      `);
    } catch (e) { console.warn('  migration 39 (performance indexes):', e.message); }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (39)').run();
    console.log('JS migration 39 applied: performance indexes (documents/extractions/learning)');
  }

  // Migration 40: documents.deleted_at — drives the RECYCLE BIN. Delete is now a SOFT
  // delete (status='deleted', deleted_at=now, files kept) so it's recoverable; the bin
  // lists deleted docs to restore or permanently remove. NULL for every existing row.
  if (!applied.has(40)) {
    try { db.exec(`ALTER TABLE documents ADD COLUMN deleted_at TEXT`); }
    catch (e) { console.warn(`  documents.deleted_at: ${e.message}`); }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (40)').run();
    console.log('JS migration 40 applied: documents.deleted_at (recycle bin)');
  }

  // Migration 41: documents.confirmed_by_username — WHO filed the document (a real username,
  // or the sentinel 'Auto-filed (100%)' for the backend 100%-confidence auto-file). Captured
  // at confirm time. It CANNOT be backfilled once multi-user (client) review can file, so it
  // is added now: it answers "already filed by <name>" in the concurrency guard and doubles
  // as a "filed by" label. NULL for every existing row.
  if (!applied.has(41)) {
    try { db.exec(`ALTER TABLE documents ADD COLUMN confirmed_by_username TEXT`); }
    catch (e) { console.warn(`  documents.confirmed_by_username: ${e.message}`); }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (41)').run();
    console.log('JS migration 41 applied: documents.confirmed_by_username');
  }

  // Migration 42: opt-in diagnostics buffer (see DIAGNOSTICS_PLAN.md / src/modules/telemetry.js).
  // Local offline queue for document-data-FREE diagnostic events; `sent` flag is the
  // send-idempotency key. Inert until the `telemetry_enabled` setting is turned on.
  if (!applied.has(42)) {
    db.exec(`CREATE TABLE IF NOT EXISTS telemetry_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ts          TEXT    NOT NULL,
      name        TEXT    NOT NULL,
      props_json  TEXT,
      event_uid   TEXT,
      sent        INTEGER NOT NULL DEFAULT 0
    )`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_telemetry_unsent ON telemetry_events (sent, id)`);
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (42)').run();
    console.log('JS migration 42 applied: telemetry_events');
  }

  // Migration 43: document_types.title_aliases — extra printed-title phrases that ALSO
  // detect the type (document_types.normaliseTitleAliases / keyword.detect_document_type).
  // The safeAdd for this column in addMissingColumns sits inside the migration-2 block,
  // which every existing install stamped long ago — so the column only ever landed on a
  // FRESH database (which is why the fresh-DB unit test passed while real installs stayed
  // without it). Stamped here so existing DBs gain it; hasColumn keeps it idempotent
  // against the fresh-DB path having already added it.
  if (!applied.has(43)) {
    if (tableExists(db, 'document_types') && !hasColumn(db, 'document_types', 'title_aliases')) {
      try { db.exec(`ALTER TABLE document_types ADD COLUMN title_aliases TEXT`); }
      catch (e) { console.warn(`  document_types.title_aliases: ${e.message}`); }
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (43)').run();
    console.log('JS migration 43 applied: document_types.title_aliases');
  }

  // Migration 44 (2026-07-10): UNLINK customer_name from the identity. supplier_name is now the
  // SOLE "Document Issuer" identity/scope key (COMPANY_KEYS = ['supplier_name']); customer_name is
  // an ordinary optional field. For every EXISTING type that used customer_name as its identity,
  // ensure a supplier_name identity field exists and demote the customer_name field to an optional
  // "Customer" field. SCHEMA-ONLY by owner decision (2026-07-10): NO documents / filing / learning
  // data is touched — existing filed docs keep their (mostly logo-derived) supplier_name scope; the
  // few with an empty scope re-fill from the logo on their next reprocess/confirm (no ambiguous
  // customer_name back-fill → no risk of misfiling a doc under the buyer). Only fields labelled the
  // OLD identity label "Document Issuer" are demoted, so a customer_name already used as a secondary
  // ("Deliver To"/"Customer") field is left untouched.
  if (!applied.has(44)) {
    if (tableExists(db, 'document_types') && tableExists(db, 'fields')) {
      try {
        const n = require('./modules/document_types').reshapeCustomerIdentityTypes(db);
        console.log(`  migration 44: reshaped ${n} customer_name-identity type(s)`);
      } catch (e) { console.warn(`  migration 44 (customer_name unlink): ${e.message}`); }
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (44)').run();
    console.log('JS migration 44 applied: customer_name unlinked from identity (supplier_name is sole issuer)');
  }

  // Migration 45 (2026-07-10): clean STALE customer_name LEARNING left by the pre-RC2 model where
  // customer_name WAS the identity — so the now-recipient field stops mirroring the issuer on reprocess
  // (the live symptom: a sales-order Customer read the supplier's own name). Deletes ONLY customer_name
  // hints whose value is the issuer (self-equal scope, or a known logo/scope issuer) + customer_name
  // anchors labelled "Document Issuer"; keeps legit recipient learning ("Greenfield Nurseries"). Ordered
  // after 44 (relies on the relabel so it can't regenerate). gary-designed, Oracle-aligned; data-safe.
  if (!applied.has(45)) {
    if (tableExists(db, 'supplier_hints') || tableExists(db, 'field_anchors')) {
      try {
        const r = require('./modules/document_types').cleanupStaleCustomerLearning(db);
        console.log(`  migration 45: deleted customer_name learning — hints self-equal=${r.hintsSelfEqual} known-issuer=${r.hintsKnownIssuer}, anchors=${r.anchors}`);
      } catch (e) { console.warn(`  migration 45 (stale customer learning): ${e.message}`); }
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (45)').run();
    console.log('JS migration 45 applied: stale customer_name learning cleaned (RC2)');
  }

  // Migration 46 (2026-07-13): UNFREEZE auto-frozen RECIPIENT-name template fields. The old
  // _buildTemplateFields froze a per-doc customer/recipient name as a template fixed_value, which then
  // stamped that ONE name onto every matching doc (template_fixed @95 — the "Primrose Childcare" /
  // "Aldermoor Engineering" class). The go-forward guard (never-freeze-a-recipient-name) stops NEW
  // freezes, but the AUTO-FILE path never re-runs _buildTemplateFields, so an already-poisoned template
  // would keep auto-filing the wrong recipient forever — this sweep is the only thing that heals it
  // (Oracle: mandatory in this slice). Label-aware; preserves admin locks (fixed_locked) + the issuer
  // (COMPANY_KEYS); template DEFINITIONS only (never touches filed docs → future docs re-extract).
  // gary-designed, Oracle SIGN-OFF-WITH-CONDITIONS. Idempotent.
  if (!applied.has(46)) {
    if (tableExists(db, 'template_fields') && tableExists(db, 'templates')) {
      try {
        const r = require('./modules/templates').unfreezeAutoFrozenRecipientNames(db);
        console.log(`  migration 46: unfroze ${r.unfrozen} auto-frozen recipient-name template field(s) (scanned ${r.scanned})`);
      } catch (e) { console.warn(`  migration 46 (unfreeze recipient names): ${e.message}`); }
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (46)').run();
    console.log('JS migration 46 applied: auto-frozen recipient names unfrozen');
  }

  // Migration 47 (2026-07-14): the ISOLATED-MARK 256-bit detail hash (logo_detail.detail_hash), stored
  // ALONGSIDE each logo phash — the logo-collision discriminator. documents.logo_detail_hash carries a
  // scanned doc's detail hash from processing to confirm; logo_fingerprints.detail_hash +
  // template_logo_hashes.detail_hash are the enrolled per-supplier / per-template sets (paired 1:1 with
  // the phash of the same print). All NULLABLE → NULL-INERT: a pre-migration print has no detail hash,
  // and the Slice-C disambiguator treats a missing hash as "skip", never a false abstain. This slice is
  // ENROLMENT ONLY — nothing reads these yet (zero behaviour change); the abstain-only disambiguator that
  // consumes them is Slice C. Idempotent.
  if (!applied.has(47)) {
    const addCol = (t, c, def) => {
      if (tableExists(db, t) && !hasColumn(db, t, c)) {
        try { db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`); }
        catch (e) { console.warn(`  migration 47 ${t}.${c}: ${e.message}`); }
      }
    };
    addCol('documents',           'logo_detail_hash', 'TEXT');
    addCol('logo_fingerprints',   'detail_hash',      'TEXT');
    addCol('template_logo_hashes', 'detail_hash',     'TEXT');
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (47)').run();
    console.log('JS migration 47 applied: logo detail-hash columns added (NULL-inert)');
  }

  // Migration 48 (2026-07-14): the DISAMBIGUATION-PICKER candidate store. extractions.candidates
  // holds a JSON array [{value, box:{x_norm,y_norm,w_norm,h_norm}|null, source_label, method,
  // confidence}] for a flagged NAME field with >=2 distinct reads — so the Review "⑂ Resolve" popup
  // survives a queued doc being reopened from the DB (the live engine ledger is ephemeral). NULLABLE
  // → NULL-INERT: a pre-migration / non-flagged row has no candidates and the renderer shows today's
  // behaviour. Written by insertExtractions/applyReprocessResult; read via getWithExtractions. Idempotent.
  if (!applied.has(48)) {
    if (tableExists(db, 'extractions') && !hasColumn(db, 'extractions', 'candidates')) {
      try { db.exec('ALTER TABLE extractions ADD COLUMN candidates TEXT'); }
      catch (e) { console.warn(`  migration 48 extractions.candidates: ${e.message}`); }
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (48)').run();
    console.log('JS migration 48 applied: extractions.candidates column added (NULL-inert)');
  }

  // Migration 49 (2026-07-16): extractions.suggested_supplier — the branding cross-check's fuzzy
  // DETECTED supplier name (engine _flag_branding_conflict), for the "Use '<name>'" resolve button on
  // a branding-conflict issuer. NULLABLE / NULL-inert: a non-conflict row has none and the renderer
  // shows today's behaviour. Written by insertExtractions/applyReprocessResult; read via SELECT *. Idempotent.
  if (!applied.has(49)) {
    if (tableExists(db, 'extractions') && !hasColumn(db, 'extractions', 'suggested_supplier')) {
      try { db.exec('ALTER TABLE extractions ADD COLUMN suggested_supplier TEXT'); }
      catch (e) { console.warn(`  migration 49 extractions.suggested_supplier: ${e.message}`); }
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (49)').run();
    console.log('JS migration 49 applied: extractions.suggested_supplier column added (NULL-inert)');
  }

  // Migration 50 (2026-07-16): documents.supplier_pin — the operator "Resolve" supplier PIN (Part B).
  // Written when the operator clicks "Use '<name>'" on a branding-conflict issuer; a REPROCESS reads it
  // and forces that supplier (--known-supplier) so a colliding-logo doc stops reverting to the wrong
  // one. Local to the doc (writes NO logo/hint learning). NULLABLE / NULL-inert; CLEARED on confirm
  // (once the name is learned, a stale pin must never override a later legit resolution). Idempotent.
  if (!applied.has(50)) {
    if (tableExists(db, 'documents') && !hasColumn(db, 'documents', 'supplier_pin')) {
      try { db.exec('ALTER TABLE documents ADD COLUMN supplier_pin TEXT'); }
      catch (e) { console.warn(`  migration 50 documents.supplier_pin: ${e.message}`); }
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (50)').run();
    console.log('JS migration 50 applied: documents.supplier_pin column added (NULL-inert)');
  }

  // Migration 51: the type the pipeline DETECTED when this install doesn't HAVE it.
  // Detection scores types from the SHIPPED config/keyword_patterns.json document_type_keywords
  // buckets, which exist independently of the types an install actually has (Delivery Note is a
  // PRESET, not a built-in). A confident "Delivery Note" that maps to no installed type used to be
  // discarded, leaving the doc untyped with the name nowhere on record. Stored so Review can offer
  // to ADD the type. NULL-inert: NULL means "nothing to suggest", which is the normal case.
  // Deliberately name-only — no confidence column. The emitted type_confidence is a keyword-bucket
  // heading score, not OCR character accuracy, and document_type can be overridden by a matched
  // template while type_confidence never is, so the pair is not reliably about the same thing
  // (Oracle C2). Showing it as a "%" would invite exactly the wrong reading.
  if (!applied.has(51)) {
    if (tableExists(db, 'documents') && !hasColumn(db, 'documents', 'detected_type_name')) {
      try { db.exec('ALTER TABLE documents ADD COLUMN detected_type_name TEXT'); }
      catch (e) { console.warn(`  migration 51 documents.detected_type_name: ${e.message}`); }
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (51)').run();
    console.log('JS migration 51 applied: documents.detected_type_name column added (NULL-inert)');
  }

  // Migration 52: field_anchors.max_w_norm — the MONOTONIC high-water crop width for a
  // taught field (box-width learning). A ⊕ teach stores its drawn box width in w_norm, but
  // w_norm is NOT monotonic (an authoritative re-teach REPLACES it; the passive within-spot
  // path BLENDS toward narrower samples), so teaching a short value ("Tesco") then a longer
  // one ("Billies Hardware Store") truncates the long value at the short box. max_w_norm
  // records the widest width ever drawn for the anchor's scope so the crop can extend RIGHT up
  // to it. INERT until the Python reader is switched on (ANCHOR_MAX_CROP_WIDTH) — this column
  // alone changes no extraction behaviour. Backfilled to w_norm so every legacy anchor's
  // effective width == its current width (byte-identical) until it is re-taught. (Oracle
  // SIGN-OFF-WITH-CONDITIONS 2026-07-21; write-the-column-unconditionally, gate-only-the-crop.)
  if (!applied.has(52)) {
    if (tableExists(db, 'field_anchors') && !hasColumn(db, 'field_anchors', 'max_w_norm')) {
      try {
        db.exec('ALTER TABLE field_anchors ADD COLUMN max_w_norm REAL NOT NULL DEFAULT 0');
        db.exec('UPDATE field_anchors SET max_w_norm = w_norm');   // backfill: high-water = current width
      } catch (e) { console.warn(`  migration 52 field_anchors.max_w_norm: ${e.message}`); }
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (52)').run();
    console.log('JS migration 52 applied: field_anchors.max_w_norm column added (box-width; NULL-inert)');
  }

  // Mailbox / approval workflow (Stage 5a): document_routes + documents.workflow_status.
  // A SEPARATE workflow state machine that never rewrites a document's filing status.
  // Ensured UNCONDITIONALLY + idempotently — NOT version-gated and NOT stamped in the
  // migrations table — because a dev DB shared across worktrees can be stamped at a
  // version WITHOUT these objects (the gated form would then skip creation and the
  // review confirm path breaks: editGuard → workflow.hasActiveRoute → "no such table").
  // CREATE-IF-MISSING self-heals and is a no-op once the objects exist.
  if (!tableExists(db, 'document_routes')) {
    db.exec(`CREATE TABLE document_routes (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id         INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      from_user_id        INTEGER,
      from_username       TEXT,
      to_user_id          INTEGER,
      to_username         TEXT,
      action_required     TEXT NOT NULL,            -- approve | acknowledge
      state               TEXT NOT NULL DEFAULT 'pending', -- pending|claimed|approved|rejected|acknowledged|recalled
      comment             TEXT,                      -- sender's note
      resolution_comment  TEXT,                      -- resolver's reason (required on reject)
      claimed_by_id       INTEGER,
      claimed_by_username TEXT,
      claimed_at          TEXT,
      resolved_at         TEXT,
      stamped_path        TEXT,                      -- filed stamped-PDF copy of the decision (server-local)
      version             INTEGER NOT NULL DEFAULT 1,
      created_at          TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_routes_to    ON document_routes(to_user_id, state)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_routes_from  ON document_routes(from_user_id, state)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_routes_doc   ON document_routes(document_id)`);
    console.log('Workflow schema: created document_routes');
  }
  if (tableExists(db, 'documents') && !hasColumn(db, 'documents', 'workflow_status')) {
    try { db.exec(`ALTER TABLE documents ADD COLUMN workflow_status TEXT`); console.log('Workflow schema: added documents.workflow_status'); }
    catch (e) { console.warn(`  documents.workflow_status: ${e.message}`); }
  }
  // Stamped-PDF copy of a decision (server-local path). Idempotent, like the table itself.
  if (tableExists(db, 'document_routes') && !hasColumn(db, 'document_routes', 'stamped_path')) {
    try { db.exec(`ALTER TABLE document_routes ADD COLUMN stamped_path TEXT`); console.log('Workflow schema: added document_routes.stamped_path'); }
    catch (e) { console.warn(`  document_routes.stamped_path: ${e.message}`); }
  }
  // Routing slice: the immutable "why it routed" rule-sentence snapshot on the route (Oracle C6).
  if (tableExists(db, 'document_routes') && !hasColumn(db, 'document_routes', 'matched_rule_summary')) {
    try { db.exec(`ALTER TABLE document_routes ADD COLUMN matched_rule_summary TEXT`); console.log('Workflow schema: added document_routes.matched_rule_summary'); }
    catch (e) { console.warn(`  document_routes.matched_rule_summary: ${e.message}`); }
  }

  // Decision snapshot (Workflow Slice 2): an APPEND-ONLY record of each approve/reject/acknowledge,
  // capturing the extracted fields AT THE INSTANT OF RESOLVE (supplier/ref/date/total/confidence) so a
  // later reprocess can never rewrite what was decided. Its OWN idempotent guard — NOT nested inside the
  // document_routes block above (a DB that already has document_routes must still get this table). NO FK on
  // route_id/document_id BY DESIGN: document_routes.document_id AND extractions.document_id both cascade on
  // doc-delete, so this denormalised row is the ONLY surviving audit — an FK would cascade-destroy it.
  // (Slice-4's document_routes stamped rebuild MUST preserve document_routes.id so route_id soft-refs stay
  // valid — see docs/designs/WORKFLOW_SUITE_2026-07-18.md §5.) Two triggers make append-only STRUCTURAL: a
  // row-level UPDATE/DELETE is blocked; a whole-table DROP+recreate migration is still allowed (DROP is DDL
  // and does not fire these), and this ensure-block recreates the triggers afterward.
  if (!tableExists(db, 'route_decisions')) {
    db.exec(`CREATE TABLE route_decisions (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id              INTEGER,   -- soft-ref to document_routes.id (NO FK by design; Slice-4 rebuild MUST preserve the id)
      document_id           INTEGER,   -- denormalised so the record survives the route/doc delete cascade
      actor_user_id         INTEGER,
      actor_username        TEXT,
      decision              TEXT,       -- approved | rejected | acknowledged (the committed resulting state)
      comment               TEXT,
      snapshot_json         TEXT,       -- extracted fields at the instant of resolve (self-describing JSON)
      snapshot_total_amount TEXT,       -- the extracted total DISPLAY STRING at resolve (may be NULL)
      chain_position        INTEGER NOT NULL DEFAULT 1,   -- Slice-4 multi-step fills; 1 for single-hop
      on_behalf_of_user_id  INTEGER,    -- Slice-5 delegation; NULL in v1
      on_behalf_of_username TEXT,
      decided_at            TEXT
    )`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_route_decisions_doc   ON route_decisions(document_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_route_decisions_route ON route_decisions(route_id)`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS route_decisions_noupd BEFORE UPDATE ON route_decisions
             BEGIN SELECT RAISE(ABORT, 'route_decisions is append-only'); END`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS route_decisions_nodel BEFORE DELETE ON route_decisions
             BEGIN SELECT RAISE(ABORT, 'route_decisions is append-only'); END`);
    console.log('Workflow schema: created route_decisions');
  }

  // Amount-threshold routing rules (Workflow Slice 3): "documents of type T with a total in
  // [min,max) -> route to <role|user> for <approve|acknowledge>". Own idempotent guard, additive.
  // NO FK on target_user_id BY DESIGN: a deleted target user must make a rule resolve-to-missing
  // (the engine HOLDS + audits), never cascade-delete the rule. Amounts are INTEGER PENNIES so a
  // banding decision is exact (never float). Dev/test-seeded in v1 (no rules-management UI yet).
  if (!tableExists(db, 'workflow_route_rules')) {
    db.exec(`CREATE TABLE workflow_route_rules (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      document_type_id   INTEGER,                       -- NULL = any type
      min_amount_pennies INTEGER NOT NULL,              -- inclusive lower bound
      max_amount_pennies INTEGER,                       -- exclusive upper bound; NULL = unbounded
      target_role        TEXT,                          -- prefer role; resolves to the single active member
      target_user_id     INTEGER,                       -- NO FK by design (see above)
      action_required    TEXT NOT NULL DEFAULT 'approve', -- approve | acknowledge
      step_order         INTEGER NOT NULL DEFAULT 1,    -- present but unused in v1 (single-hop)
      active             INTEGER NOT NULL DEFAULT 1,
      created_at         TEXT,
      CHECK (target_role IS NOT NULL OR target_user_id IS NOT NULL)
    )`);
    console.log('Workflow schema: created workflow_route_rules');
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
  // Title aliases: extra printed-title phrases that also DETECT this type (JSON array of
  // strings). NULL/absent = no aliases = byte-identical detection. Folded into the type's
  // keyword bucket at detection time (keyed by the type NAME, so the detected type is
  // unchanged). See document_types.normaliseTitleAliases + keyword.detect_document_type.
  safeAdd('document_types', 'title_aliases', 'TEXT');
  if (!tableExists(db, 'field_anchors')) {
    db.exec(`CREATE TABLE field_anchors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_name TEXT, document_type TEXT, field_key TEXT NOT NULL,
      anchor_label TEXT NOT NULL, direction TEXT NOT NULL,
      page_zone TEXT NOT NULL, x_norm REAL, y_norm REAL,
      usage_count INTEGER NOT NULL DEFAULT 1,
      confidence REAL NOT NULL DEFAULT 1.0,
      last_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_authoritative_at TEXT,
      offset_dx_norm REAL,
      offset_dy_norm REAL,
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

module.exports = { open, runMigrations };
