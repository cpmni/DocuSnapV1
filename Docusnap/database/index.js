'use strict';

const path = require('path');
const fs   = require('fs');
const { app } = require('electron');

let _db = null;
let _encryptionCode = null;   // the NORMALISED recovery code (passphrase) | null

// Whole-DB-at-rest encryption (2026-08-31, code-as-passphrase). main unwraps the DPAPI-cached recovery
// code (src/lib/dbKey.js loadCode) — or the user types it at the Unlock window — and calls this BEFORE
// the first getDb()/open(). Until then the code is null and open() is byte-identical (plaintext), so the
// current install is untouched. The code is normalised + charset-validated here so a mis-typed/garbled
// value fails LOUD rather than silently opening plaintext or mis-keying.
function setEncryptionKey(code) {
  if (code == null) { _encryptionCode = null; return; }
  const dbKey = require('../src/lib/dbKey');
  const norm = dbKey.normaliseCode(code);
  if (!dbKey.isValidNormalised(norm)) throw new Error('setEncryptionKey: expected a valid recovery code');
  _encryptionCode = norm;
}

// True once the DB is opened encrypted — callers that COPY the DB (e.g. the merge backup) must then take
// a KEYED copy (db.backup() refuses a keyed source; VACUUM INTO from the keyed connection stays keyed),
// never a plaintext one.
function isEncryptionActive() { return !!_encryptionCode; }

// ── Open ──────────────────────────────────────────────────────────────────────

function open() {
  if (_db) return _db;
  const Database = require('better-sqlite3');
  const dbDir    = app.getPath('userData');
  const dbPath   = path.join(dbDir, 'docusnap.db');
  _db = new Database(dbPath);
  // The cipher scheme + KDF + passphrase MUST precede every other pragma/read (multiple-ciphers
  // contract). Issued ONLY when a code was set — a plaintext install never reaches this line, so it is
  // byte-identical. applyKey is the single choke point for the pragma order + normalisation + charset
  // validation (src/lib/dbKey.js). temp_store=MEMORY keeps SQLite's temp spills off disk in plaintext.
  if (_encryptionCode) {
    require('../src/lib/dbKey').applyKey(_db, _encryptionCode);
    _db.pragma('temp_store = MEMORY');
  }
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

// The switches migration 60 turns on. Kept beside the migration so the two cannot drift, and
// annotated so a future reader knows what each one BOUGHT rather than only what it is called.
const PROVEN_ON_DEFAULTS = [
  'template_reg_arbiter_anchor_evidence',      // issuer 120 ok/20 wrong -> 138/2 on 145 siblings
  'template_issuer_region_presence',           // closes the last 2 of those; issuer 140/0/0
  'template_identity_on_page',                 // the wrong-company misfile: wrong senders 18 -> 1
  'letterhead_issuer',                         // a brand-new supplier is no longer left blank
  'stage05_ref_code_gate',                     // a taught box can no longer commit its own caption
  'keyword_generic_caption_exclusive',         // one printed code can no longer fill three fields
  'type_title_owner_precedence',               // the document's own printed heading wins the type
  'filing_value_sanity_flags',                 // flag-only: a nonsense reference or year is queried
  'template_drift_row_pitch',                  // the VAT-row totals class; 30 healed, 0 regressed
  'template_currency_edge_grow',               // money is right-aligned, so a longer value overflows left
  'teach_angle_compose_scan',                  // +18 issuer / +36 customer on tilted siblings
  'template_fixed_issuer_repair',              // 42 of 135 documents read something that is not a company
  'template_inline_row_overlap',               // the caption-hijack class (5 healed / 0 regressed)
  'ref_role_digit_gate',                       // a reference with no digit is a caption, not a code
  'template_pad_window_read',                  // a clipped taught date is flagged, never silently expanded
  'template_date_clip_gate',                   // a date FRAGMENT can no longer pass as a date
  'template_date_future_yield',                // a future-dated read yields to a plausible one
  'template_date_invalid_yield',               // an impossible date yields
  'template_abs_edge_guard',                   // the jitter-crater arc: a cut taught box is grown to words
  'template_edge_cut_relocate',                // re-seat a value the horizontal grow cannot reach
  'template_clip_commit',                      // a clean clipped read commits instead of a false note
  'template_clip_commit_edge_slack',           // one cut trailing glyph does not false-flag the value
  'template_code_frag_clean',                  // strip a label-tail fragment ('o. DN-67428')
  'template_label_digit_exact',                // a digit-heavy needle cannot fuzzy-lock a different value
  'template_pad_window_code',                  // a padded re-read recovers a clipped code
  'template_pad_window_code_labelled',         // the labelled tier of the same
  'anchor_inline_taught_offset_veto',          // an inline read may not override a taught offset
  'heading_absent_reread',                     // a dropped title is recovered by a band re-read
  'credit_sign_coherence',                     // a credit note keeps its minus sign
  'vat_reg_not_amount',                        // a VAT registration number is not a tax amount
  'template_freeze_qualify',                   // a caption can no longer become a template's permanent value
  'template_fixed_near_match',                 // a one-glyph misread does not displace the confirmed name
  'template_fixed_fragment',                   // debris does not displace the confirmed name
  'template_target_word_snap',                 // derived reads snap to word geometry
  'template_code_edge_clean',                  // punctuation label-tail heal
  'trust_shadow_row_skip',                     // an invisible row can no longer deadlock filing
  'crosscheck_outlier_reconcile',              // restore a corroborated reference over a lone garble
  'universal_verify_restore',                  // post-merge verify for references and dates
  'struct_code_read',                          // structured code reading
  'prefix_garble_adopt',                       // adopt a corroborated prefix over a garble
  'anchor_label_left_clamp',                   // the label-tail crop clamp
  'anchor_value_right_grow',                   // grow a right-clipped value
  'name_unclip_reconcile',                     // a clipped company name is reconciled
  // NOT LISTED, and each for a reason that must not be re-litigated by adding it back:
  //   template_snap_union_witness          Oracle SENT IT BACK and it was reverted; default OFF is deliberate
  //   template_freetext_guard_parity       measured near-inert, and Oracle sent back part of it
  //   template_freetext_fallthrough_cap    the other half of that same slice
  //   reprocess_heading_geom               already armed by heading_absent_reread; a second row would imply a toggle that does not exist
  //   heading_title_gap_collapse           same - armed by heading_absent_reread
  //   template_money_snap_proof            already defaults ON in the extractor
  // A settings row for any of those would be a switch the customer can flip that changes
  // nothing - the exact dead-toggle failure test_settings_wiring.js exists to catch.
];

// ── The SECOND promotion round (migration 67, 2026-08-13) ────────────────────────────────────
// Migration 60 turned on the reading improvements. Everything measured SINCE then stayed dark, so
// the owner's own install files ~92% of a batch while a NEW CUSTOMER'S install files a fraction of
// it — Chris round 4 met exactly that ("188 need your review, 12 ready") and reported it as a
// product regression. It is not a regression; it is a settings gap. Same ritual as migration 60:
// settings ROWS (so the toggles render truthfully), INSERT OR IGNORE (so an existing choice is
// never overwritten), and every entry annotated with WHAT IT BOUGHT and WHERE THAT WAS MEASURED.
const PROVEN_ON_DEFAULTS_2 = [
  // The import arc, live-proven on a real 200-document import (2026-08-12 NIGHT2): corpus auto-file
  // 70/200 -> ~184/200. These five moved together there and are promoted together.
  ['autofile_gate_unify',        'true'],   // ONE auto-file predicate; the import pre-gate defers to it
  ['far_lowconf_valued_only',    'true'],   // an attempted-but-empty optional field no longer flags
  ['type_election_title_first',  'true'],   // an address caption stops outvoting the printed title
  ['reprocess_shadow_stale_drop','true'],   // stale shadow rows die on reprocess
  ['xcheck_corrob_note_demote',  'true'],   // corroboration STEP 3, DATES only; live re-verify 5/5 correct
  // Graduation window 10 -> 5 (owner-flipped live). MEASURED on this install by Census F
  // (2026-08-13): 919/1076 -> 999/1076, 85.4% -> 92.8%, every added document via the `graduated`
  // basis — i.e. scopes that had already proved themselves, waiting on an arbitrary count.
  ['graduation_window',          '5'],
  // Corroborated auto-file (Oracle-unlocked + owner-flipped 2026-08-11). STATED HONESTLY: Census F
  // measures it INERT on this install (919 -> 919), because its arm requires a scope that is clean
  // but short of VOLUME, and nearly every scope here has already graduated. Its population is a
  // YOUNG install — exactly the customer this migration exists for — which is also why this
  // install cannot measure it. Promoted on the Oracle sign-off + the owner running it live, not on
  // a number, and that distinction is the point of writing it down.
  ['corroboration_autofile',     'true'],
  // NOT LISTED, each for a reason that must not be re-litigated by adding it back:
  //   name_corrob_note_demote        B2 clause 1 is NOT met (the #259 shape is absent from the corpus)
  //   recon_total_note_demote        evidence complete but the owner has not taken the flip decision
  //   identity_scope_post_repair     no-regression proven, EFFICACY VACUOUS — its trigger is disabled
  //                                  by the name-lexicon defect; it is a precondition, not a fix
  //   teach_identity_near_match_keep owed: the round-4 teach replay in a fresh sandbox
  //   template_identity_hold_siblings / template_buyer_issued_type_scope   built 2026-08-13, no arm yet
  //   deskew_on_import               standing ruling; it silently disables teach_angle_compose_scan
];

// The switches migration 93 turns on (2026-08-30, owner: "default all the toggles apart from straighten
// to on, gate the ones the customer doesn't need behind SFDEV"). This COMPLETES the promotion ladder
// (mig 60/67/70/76/77/78): every arc BUILT AFTER mig 70 shipped dark, and its default-off sat only in the
// owner's hand-flipped live config — so a fresh customer install behaved like a 2025 default (e.g. the VM
// test showed batch_audit_enabled / Quick check off). This list IS the owner's validated production config
// (every switch they run true), MINUS the keys that must NEVER be blanket-defaulted for a customer:
//   deskew_on_import            standing wrong-layer ruling (stays off; it silently disables
//                               teach_angle_compose_scan, worth +18 issuer / +36 customer)
//   telemetry_enabled           privacy (stays off)
//   first_run_completed         INSTALL STATE — defaulting true would SKIP onboarding (no output folder set)
//   tray_hint_shown             UI state
//   dev_switches_unlocked       the SFDEV gate itself; customers stay locked
//   diagnostic_logging          customers keep this OFF (packaged reads the setting; default off)
//   detached_features_signed / client_api_enabled / detached_search_seats
//                               entitlement + LAN /v1; set by licensing, not a blanket default — the
//                               security review says hold the detached-client add-on back by default
// INSERT OR IGNORE (same ritual as mig 60/67): a fresh install with no row is seeded true; an EXISTING
// install's own choice — including a deliberate hand-disable — is NEVER overwritten. Idempotent, so it is
// harmless that some keys were already seeded by an earlier migration. NOTE for review: ocr_light_text_
// recovery ~triples scanned-page OCR time — it is the owner's shipped choice ("Also read faint small print
// on scans"); trust_company_key_own_scope and the buyer-issued scopes were memory-flagged but are on in the
// owner's live production config (they HOLD rather than misfile, so defaulting them is conservative).
// DELIBERATELY NOT HERE (Oracle 2026-08-30): name_dominant_snap and branding_strip_reg_boilerplate. mig 89
// (2026-08-26, index.js above) explicitly DEFERRED these two as a new-install default "until their
// held/misfiled reprocess gate is eyeballed on a NON-OWNER corpus". They are true only in the owner's live
// config (flipped on the owner's OWN corpus after the deferral), and both are inert on a fresh install
// (name_dominant_snap needs ≥5 confirms; branding only matters on a logo collision), so holding them off
// costs a fresh customer nothing. They ride their OWN promotion migration once that gate is checked.
const ALL_ON_DEFAULTS_93 = [
  'anchor_inline_taught_offset_veto', 'anchor_label_left_clamp', 'anchor_value_right_grow',
  'auto_rotate_enabled', 'auto_title_enabled', 'autofile_gate_unify', 'barcode_field', 'barcode_inventory',
  'batch_audit_enabled', 'code_separator_structure_guard',
  'confirm_persist_values', 'confirmed_dominant_adopt', 'corrob_note_recompute_fc',
  'corrob_verification_doubt_clear', 'corroboration_autofile', 'credit_sign_coherence',
  'critfield_corrob_floor_relax', 'crosscheck_outlier_reconcile', 'customer_po_labels',
  'far_lowconf_valued_only', 'filing_sanity_page_match_v2', 'filing_slips_enabled',
  'filing_value_sanity_flags', 'fingerprint_seed_support_prune', 'format_corrections_dedupe',
  'generic_fallback_enabled', 'graduation_freeze_issuer', 'heading_absent_reread', 'hint_band_ws_normalize',
  'identity_scope_post_repair', 'identity_suggest_canonical', 'issuer_near_match_confirm_guard',
  'issuer_sibling_fill', 'issuer_suggest_on_blank_confirm', 'keep_processed_originals',
  'keyword_generic_caption_exclusive', 'learning_exclude_docs', 'learning_exclude_machine_confirms',
  'learning_exclude_rewrite_markers', 'learning_repair_console', 'learning_repair_forget',
  'letterhead_depth_guard', 'letterhead_fragment_abstain', 'letterhead_issuer', 'letterhead_prefill',
  'letterhead_stack_abstain', 'list_field_scan', 'logo_detail_veto_single_supplier_immune',
  'money_sign_capture', 'name_corrob_note_demote', 'name_corrob_suggestion_adopt',
  'name_lexicon_low_distinct', 'name_unclip_reconcile', 'net_misread_total_flag', 'ocr_light_text_recovery',
  'ocr_parallel_reprocess_enabled', 'position_teach_nudge', 'prefix_garble_adopt', 'printing_enabled',
  'putback_refile_on_file_all', 'quiet_reread_enabled', 'quiet_reread_first_fill_reliability_hold',
  'quiet_reread_kw_select', 'quiet_reread_on_layout', 'quiet_reread_on_ready',
  'quiet_reread_on_ready_templated', 'raw_crop_witness_adopt', 'raw_crop_witness_flag',
  'raw_witness_vacuous_suppress', 'recon_shadow_attrib_note_demote', 'recon_total_note_demote',
  'reconcile_shadow_attribution', 'reextract_fast_enabled', 'ref_class_fix_enabled',
  'ref_dominant_format_note_demote', 'ref_prefix_confusable_adopt', 'ref_prefix_confusable_adopt_length_note',
  'ref_role_digit_gate', 'reprocess_holds_as_lane', 'reprocess_shadow_stale_drop', 'review_activity_strip',
  'review_group_by_letterhead', 'role_field_dominant_class', 'scope_sweep_auto_accept', 'scope_sweep_enabled',
  'snap_confusable_clean_autofile', 'stage05_ref_code_gate', 'struct_code_read', 'supplier_pin_self_discharge',
  'teach_angle_compose', 'teach_angle_compose_scan', 'teach_identity_near_match_keep',
  'teach_label_becomes_keyword', 'template_abs_edge_guard', 'template_buyer_issued_letterhead_scope',
  'template_buyer_issued_type_scope', 'template_clip_commit', 'template_clip_commit_edge_slack',
  'template_code_edge_clean', 'template_code_frag_clean', 'template_currency_edge_grow',
  'template_date_clip_gate', 'template_date_future_yield', 'template_date_invalid_yield',
  'template_drift_row_pitch', 'template_edge_cut_relocate', 'template_fixed_debris_wide',
  'template_fixed_fragment', 'template_fixed_issuer_repair', 'template_fixed_near_match',
  'template_fixed_seed_agreement_keep', 'template_fixed_seed_fragment_garble', 'template_fixed_seed_fragment_keep',
  'template_format_fail_yield', 'template_freeze_issuer_only', 'template_freeze_qualify',
  'template_hidden_field_drop', 'template_identity_corrob_note_shed', 'template_identity_geom_fragment_shed',
  'template_identity_geom_fuzzy_graduate', 'template_identity_hold_siblings', 'template_identity_on_page',
  'template_inline_row_overlap', 'template_issuer_region_presence', 'template_label_digit_exact',
  'template_name_edge_grow', 'template_pad_window_code', 'template_pad_window_code_labelled',
  'template_pad_window_read', 'template_reg_arbiter_anchor_evidence', 'template_target_word_snap',
  'tier_a_date_plausibility', 'trust_company_key_own_scope', 'trust_role_disagreement_refuse',
  'trust_shadow_row_skip', 'type_ambiguity_ripple', 'type_ambiguity_unsupported_waiver',
  'type_election_title_first', 'type_title_owner_precedence', 'universal_verify_flag',
  'universal_verify_numeric', 'universal_verify_restore', 'vacuous_corrected_to_ignore', 'vat_eu_formats',
  'vat_rate_at_skip', 'vat_reg_not_amount', 'vat_reg_symbol_confusable', 'xcheck_corrob_note_demote',
];

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

  // Stage 5b (unconditional heal): clear a stale audit-archive bypass flag left by a crash mid-archive,
  // so the audit_log DELETE trigger is never silently disarmed across a restart. Guarded — audit_ctl
  // exists only after migration 55. Idempotent, unstamped.
  if (tableExists(db, 'audit_ctl')) {
    try { db.prepare("UPDATE audit_ctl SET v = 0 WHERE k = 'archiving'").run(); } catch { /* best-effort */ }
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

  // Migration 53: documents.learning_retracted_at — the delete/restore LEARNING-SYMMETRY marker
  // (C6 of the repair un-plant, owner-ruled 2026-07-23). A Learning-Repair DELETE of a confirmed
  // doc retracts its confirm-planted hints (same inverse as send-back); a recycle-bin RESTORE
  // returns the doc to 'confirmed' and must RE-PLANT them — but ONLY when the delete actually
  // retracted (a doc deleted BEFORE this feature, or with the switch off, was never retracted;
  // a blind re-plant would DOUBLE-count its hints forever). This timestamp is that proof: set at
  // retract time, consumed + cleared at restore. NULL-inert — no reader changes behaviour on it.
  if (!applied.has(53)) {
    if (tableExists(db, 'documents') && !hasColumn(db, 'documents', 'learning_retracted_at')) {
      try {
        db.exec('ALTER TABLE documents ADD COLUMN learning_retracted_at TEXT');
      } catch (e) { console.warn(`  migration 53 documents.learning_retracted_at: ${e.message}`); }
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (53)').run();
    console.log('JS migration 53 applied: documents.learning_retracted_at column added (delete/restore learning symmetry; NULL-inert)');
  }

  // Migration 54: template_hidden_fields — per-template field HIDING (owner-approved 2026-07-24).
  // A DISPLAY/EXPECTATION mask: hide a field the TYPE has but THIS supplier's layout lacks (e.g.
  // ITEM/SERIAL on a worksheet that doesn't print them) so Review stops showing it as an empty
  // "not found" row and stops counting it as a missing-required blocker FOR THAT TEMPLATE. It is a
  // MASK, never a data delete — extraction still runs and stores whatever it reads; only the review
  // EXPECTATION for this template changes. HIDE-ONLY + superset-locked (you can only hide a field the
  // type already has; you can never ADD one) and structural roles (issuer/date/ref) can NEVER be
  // hidden — both enforced in templates.setHiddenField. Keyed by template_id → per-supplier-layout,
  // not per-type. ADDITIVE + INERT: with zero rows every consumer clause is a no-op ⇒ byte-identical.
  if (!applied.has(54)) {
    if (tableExists(db, 'templates') && !tableExists(db, 'template_hidden_fields')) {
      try {
        db.exec(`CREATE TABLE template_hidden_fields (
          template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
          field_key   TEXT    NOT NULL,
          hidden_at   TEXT    DEFAULT (datetime('now')),
          PRIMARY KEY (template_id, field_key)
        )`);
      } catch (e) { console.warn(`  migration 54 template_hidden_fields: ${e.message}`); }
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (54)').run();
    console.log('JS migration 54 applied: template_hidden_fields table added (per-template field-hiding mask; INERT with no rows)');
  }

  // Stage 5b — audit_log tamper-EVIDENCE. Two additive columns carry a per-row HMAC hash chain
  // (row_hmac keyed from a DPAPI-held secret kept OUTSIDE the DB — see src/lib/auditKey.js; the DB
  // module stays key-agnostic and only computes when auth.setAuditKey has been called). The chain
  // makes an EDIT / REORDER / middle-DELETE detectable via database/modules/auth.verifyAuditChain.
  // Two append-only triggers mirror route_decisions_noupd/_nodel: UPDATE is always blocked (the
  // archiver never updates); DELETE is blocked UNLESS the archiver's controlled bypass flag
  // (audit_ctl.archiving=1) is set — this stops the trivial `DELETE FROM audit_log` tail-erase (the
  // H5 attack) while still letting the sanctioned archive path move rows. HONEST LIMIT: a same-user
  // attacker who obtains the DPAPI-held key can forge a consistent chain; the chain detects tampering
  // by anything WITHOUT the key (bugs, partial compromise, a naive attacker), and Stage-3 signing +
  // Stage-6 DB encryption raise that bar. INERT until auth.setAuditKey is called (older rows: NULL hmac).
  // CONSTRAINT: audit_log rows are now immutable. The app DEACTIVATES users (never hard-deletes), so the
  // audit_log.user_id FK (ON DELETE SET NULL) never cascades; if a future feature hard-deletes a user
  // with foreign_keys=ON, that cascade is an UPDATE on audit_log → the append-only trigger blocks it (and
  // it would break the HMAC anyway). The actor is already snapshotted (actor_username/actor_role, mig 25),
  // so a hard delete is unnecessary — deactivate, or NULL the FK under the archiver bypass if ever needed.
  if (!applied.has(55)) {
    try {
      if (tableExists(db, 'audit_log')) {
        if (!hasColumn(db, 'audit_log', 'prev_hash')) db.exec('ALTER TABLE audit_log ADD COLUMN prev_hash TEXT');
        if (!hasColumn(db, 'audit_log', 'row_hmac'))  db.exec('ALTER TABLE audit_log ADD COLUMN row_hmac TEXT');
        // A pre-mig-55 audit write (the workflow-paid heal) may have cached the OLD column set; drop it
        // so post-migration writes see row_hmac and actually chain.
        try { require('./modules/auth').invalidateAuditColumns(db); } catch { /* best-effort */ }
        db.exec(`CREATE TABLE IF NOT EXISTS audit_ctl (k TEXT PRIMARY KEY, v INTEGER)`);
        db.exec(`INSERT OR IGNORE INTO audit_ctl (k, v) VALUES ('archiving', 0)`);
        db.exec(`CREATE TRIGGER IF NOT EXISTS audit_log_noupd BEFORE UPDATE ON audit_log
                 BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END`);
        db.exec(`CREATE TRIGGER IF NOT EXISTS audit_log_nodel BEFORE DELETE ON audit_log
                 WHEN COALESCE((SELECT v FROM audit_ctl WHERE k = 'archiving'), 0) = 0
                 BEGIN SELECT RAISE(ABORT, 'audit_log is append-only (archive via the maintenance path)'); END`);
      }
    } catch (e) { console.warn(`  migration 55 audit chain: ${e.message}`); }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (55)').run();
    console.log('JS migration 55 applied: audit_log tamper-evidence (prev_hash/row_hmac + append-only triggers)');
  }

  // Migration 56 (Stage 8 GROUNDWORK — INERT): doctype_grants scaffold for future per-doc-type /
  // per-user authorization. NO consumer reads it yet — accessService.doctypeGrantDecision is a no-op
  // seam — so this is purely additive and byte-identical (empty table ⇒ no behaviour change). Design +
  // activation semantics: docs/designs/STAGE8_DOCTYPE_AUTHZ_2026-07-27.md. Polarity in `access`
  // ('allow'|'deny') is reserved for that design; role NULL + user_id set = a per-user grant, role set
  // + user_id NULL = a per-role grant. FK cascades keep it clean when a type or user is removed.
  if (!applied.has(56)) {
    if (tableExists(db, 'document_types') && !tableExists(db, 'doctype_grants')) {
      try {
        db.exec(`CREATE TABLE doctype_grants (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          role              TEXT,
          user_id           INTEGER REFERENCES users(id) ON DELETE CASCADE,
          document_type_id  INTEGER NOT NULL REFERENCES document_types(id) ON DELETE CASCADE,
          access            TEXT NOT NULL DEFAULT 'allow',
          created_at        TEXT DEFAULT (datetime('now'))
        )`);
        db.exec('CREATE INDEX IF NOT EXISTS idx_doctype_grants_role ON doctype_grants(role, document_type_id)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_doctype_grants_user ON doctype_grants(user_id, document_type_id)');
      } catch (e) { console.warn(`  migration 56 doctype_grants: ${e.message}`); }
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (56)').run();
    console.log('JS migration 56 applied: doctype_grants scaffold (INERT — per-doc-type authorization groundwork, unused until Stage 8)');
  }

  // Migration 57 (Catch-up Filing slice 1 — docs/designs/CATCHUP_FILING_2026-07-31.md):
  // documents.confirmed_via — WHO/WHAT performed the confirm. TEXT, NULL = legacy/human (every
  // existing row). The scope-sweep accept path (slice 3, unbuilt) will set 'scope_sweep'
  // SERVER-SIDE from the call site — never client/payload-suppliable. Read-side consumer today:
  // trust.scopeTrust's graduation window EXCLUDES 'scope_sweep' rows (machine confirms must not
  // fill the human trust window) while its corrections SPAN still covers them (a correction on a
  // sweep-filed doc still revokes trust — the Oracle SEAM-1 ruling). Purely additive: with every
  // row NULL the trust computation is byte-identical (pinned in test_scope_trust.js).
  if (!applied.has(57)) {
    if (tableExists(db, 'documents') && !hasColumn(db, 'documents', 'confirmed_via')) {
      try { db.exec('ALTER TABLE documents ADD COLUMN confirmed_via TEXT'); }
      catch (e) { console.warn(`  migration 57 confirmed_via: ${e.message}`); }
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (57)').run();
    console.log('JS migration 57 applied: documents.confirmed_via (NULL = human/legacy; scope-sweep confirms excluded from trust graduation)');
  }

  // Migration 58 (TEACH_ANGLE_COMPOSE, Oracle SIGN-OFF-W/COND 2026-08-05 late — the canonical
  // level-frame pivot): templates.sample_deskew_angle — the pinned SAMPLE doc's detected skew
  // angle (degrees, detect_skew_angle's PIL-CCW convention). Stored teach coords live in the
  // sample's RAW frame with this tilt baked in; under Straighten-ON processing the engine
  // composes mapping/landmark COPIES to the level frame by rotating by -angle. NULL = never
  // detected (no composition — today's behaviour); 0.0 = detected level (so level samples
  // never re-spawn detection). Healed lazily at buildTrainingArgs when the kill switch is on.
  // NOTE: values are DETECTED, not ground truth — if detect_skew_angle's algorithm is re-tuned,
  // healed angles for old teaches drift with it (sub-floor concern; re-heal by NULLing).
  if (!applied.has(58)) {
    if (tableExists(db, 'templates') && !hasColumn(db, 'templates', 'sample_deskew_angle')) {
      try { db.exec('ALTER TABLE templates ADD COLUMN sample_deskew_angle REAL'); }
      catch (e) { console.warn(`  migration 58 sample_deskew_angle: ${e.message}`); }
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (58)').run();
    console.log('JS migration 58 applied: templates.sample_deskew_angle (teach-frame tilt for level-frame composition; NULL-inert)');
  }

  // Migration 59: delivery_number is a CODE, not free text — owner decision 2026-08-08.
  // The field shipped as type 'text', and `text` is the least-gated state in the system: there is
  // no `validation_patterns.text` at all, and `text` is not in trust.js STRICT_TYPES, so the field
  // had NO type-keyed format gate anywhere. That is how the caption 'Delivery' came to be stored as
  // a delivery number and auto-filed. Measured on the live install before changing anything: of 126
  // distinct delivery_number values, exactly ONE has no digit — 'Delivery', 5 occurrences, i.e. the
  // bug itself. Every other value (DN-98447, PD267010, …) carries digits, so `reference_code`
  // (which requires at least one digit) withholds precisely the defect class and nothing else.
  //
  // SCOPE — this deliberately does NOT change extraction, and that was verified rather than
  // assumed. Stage 1 keeps reading via the SHIPPED `field_patterns.delivery_number` entry, whose
  // `validation` stays `alphanumeric`; `engine._seed_field_patterns` skips any key already present
  // in the shipped config, so Stage 0.5/2 `val_type` is unchanged too. What moves is the
  // TYPE-keyed gate at the filing boundary: `reference_code` IS in trust.js STRICT_TYPES (pinned in
  // test_scope_trust.js), so a digit-free read now returns `invalid-type:delivery_number` and is
  // routed to review instead of auto-filed, and the Review on-blur validator warns on it.
  // `process_docs.py` coerces the ref-role field's type only when it is 'text'/empty, so this
  // stronger type survives that coercion rather than being overwritten by it.
  //
  // Applied as a MIGRATION rather than through updateField because delivery_number is the Delivery
  // Note's structural ref role, and structural fields are retype-blocked server-side by design.
  // The consequence is deliberate and worth knowing: the Settings UI will not let this be changed
  // back — reverting means another migration.
  if (!applied.has(59)) {
    if (tableExists(db, 'fields') && tableExists(db, 'document_types')) {
      try {
        const r = db.prepare(`
          UPDATE fields SET type = 'reference_code'
           WHERE key = 'delivery_number' AND LOWER(COALESCE(type,'text')) IN ('text','')
             AND document_type_id IN (SELECT id FROM document_types WHERE ref_field_key = 'delivery_number')
        `).run();
        if (r.changes) console.log(`  migration 59: retyped ${r.changes} delivery_number field(s) text -> reference_code`);
      } catch (e) { console.warn(`  migration 59 delivery_number retype: ${e.message}`); }
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (59)').run();
    console.log('JS migration 59 applied: delivery_number typed reference_code (a digit-free caption can no longer auto-file)');
  }


  // ── 60: the proven reading improvements ON by default (2026-08-10, owner-requested) ──────────
  // Every switch below shipped DEFAULT OFF and was gated green on the 200-document corpus before it
  // got here. Turning them on is the owner's decision, taken so a test install on another machine
  // behaves the way the measured configuration does rather than the way a 2025 default does.
  //
  // WRITTEN AS SETTINGS ROWS, NOT AS CODE DEFAULTS, on purpose: the Settings toggles read the
  // setting, so flipping only the code default would leave every switch RENDERING OFF while
  // BEHAVING as on — exactly the "Off by default beside a switch that is on" contradiction the
  // customer review called out. Rows make the screen truthful and every one of them stays flippable.
  //
  // `INSERT OR IGNORE`: an existing install's own choice is NEVER overwritten. Someone who
  // deliberately turned one of these off keeps it off; only keys with no row at all are seeded.
  //
  // TWO ARE DELIBERATELY EXCLUDED, and both are the owner's call rather than mine:
  //   * `deskew_on_import` — there is a standing ruling against it (Oracle: wrong layer), and
  //     turning it on silently DISABLES `teach_angle_compose_scan`, which is worth +18 issuer and
  //     +36 customer. Two of these switches fight; this is the one that loses.
  //   * `template_fixed_seed_agreement_keep` — correct in principle, but measured to lift 96
  //     documents into the auto-file band, 47 of which carry a wrong value in some OTHER field.
  //     It removes a confidence penalty that is accidentally acting as a safety net for the
  //     account-number defect. Fix that first.
  if (!applied.has(60)) {
    try {
      const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
      const seeded = [];
      for (const key of PROVEN_ON_DEFAULTS) {
        const r = ins.run(key, 'true');
        if (r.changes) seeded.push(key);
      }
      console.log(`  migration 60: turned on ${seeded.length} reading improvement(s)`
                  + (seeded.length ? ` (${seeded.length} newly seeded, existing choices untouched)` : ''));
    } catch (e) { console.warn(`  migration 60 defaults: ${e.message}`); }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (60)').run();
    console.log('JS migration 60 applied: proven reading improvements default ON');
  }

  // ── Migration 61: field_label_overrides.exclusive ────────────────────────────
  // OWNER DECISION 2026-08-11: "when we draw an anchor and set the label, set that confirmed label
  // as the ONLY keyword on that doc for that field." Today an override is ADDITIVE — it is consulted
  // FIRST and then falls through to the shipped caption bank, which is why a correct taught
  // po_number mapping coexists with a Stage 1 keyword still hunting the generic 'ref'.
  // This column marks an override as EXCLUSIVE: for that (doc type, field) the shipped labels are
  // not consulted at all. NULL/0 = today's additive behaviour, so every existing row is inert and
  // the admin Settings screen is unchanged.
  if (!applied.has(61)) {
    try {
      const cols = db.prepare('PRAGMA table_info(field_label_overrides)').all().map(c => c.name);
      if (!cols.includes('exclusive')) {
        db.exec('ALTER TABLE field_label_overrides ADD COLUMN exclusive INTEGER DEFAULT 0');
      }
    } catch (e) { console.warn(`  migration 61: ${e.message}`); }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (61)').run();
    console.log('JS migration 61 applied: field_label_overrides.exclusive (0/NULL-inert)');
  }

  // ── Migration 62: field_label_overrides.template_id — TEMPLATE-scoped taught labels ──────────
  // OWNER DECISION 2026-08-11 (same day, sharpening mig 61): "It needs to be per doc type for each
  // supplier, so set at the template level." A caption is usually a doc-type convention, but the
  // teach that donates it is performed on ONE supplier's layout — doc-type-wide scope made one
  // supplier's caption the keyword for EVERY supplier's documents of that type, which is why the
  // mig-61 flag stayed OFF. template_id = 0 keeps a row DOC-TYPE-WIDE (the admin Settings screen
  // and the preset seeder — their behaviour is unchanged); a teach now writes its template's id and
  // Python applies the row only when that template matched the document (a template IS the
  // supplier+doctype pairing — templates bind suppliers via their confirmed history, there is no
  // supplier column to key on).
  // TABLE REBUILD, not ALTER: the original UNIQUE(doc_type_slug, field_key, label) would forbid two
  // templates teaching the same caption for the same field, and SQLite cannot amend a table-level
  // UNIQUE in place. NOT NULL DEFAULT 0 (never NULL) so the 4-column UNIQUE actually dedupes —
  // NULLs are pairwise-distinct inside a SQLite UNIQUE and would let admin rows duplicate.
  if (!applied.has(62)) {
    // ORACLE C1 (2026-08-11): the rebuild must be ONE transaction and the stamp must depend on it.
    // `db.exec` of a four-statement script is per-statement autocommit in better-sqlite3 — a crash
    // between DROP and RENAME would leave the table GONE, and a catch-then-stamp would make that
    // state permanent (getForExtraction then throws on every processing run for ever). So: drop any
    // leftover `_new` from a previous failed attempt first, run the rebuild inside one transaction,
    // and let a genuine failure THROW rather than stamp.
    // ABSENT TABLE ≠ OLD SHAPE (2026-08-13). `PRAGMA table_info` on a MISSING table returns [], so
    // `.some(...)` is false and the rebuild below ran its `INSERT … FROM field_label_overrides`
    // against nothing — throwing `no such table` INSIDE runJsMigrations, which aborts open() and
    // stops the app from starting at all. Migration 19 creates this table, so a normally-migrated
    // install always has it; a DB stamped past 19 without it (restore, partial fixture, a hand-built
    // pre-feature DB) hit the fatal path instead of being healed. Create it in the FINAL shape and
    // skip the rebuild — the deliberate throw-rather-than-stamp below still governs a genuine
    // rebuild failure, which is what Oracle C1 was about.
    const _floExists = tableExists(db, 'field_label_overrides');
    const hasTpl = _floExists && db.prepare('PRAGMA table_info(field_label_overrides)').all()
      .some(c => c.name === 'template_id');
    if (!_floExists) {
      db.exec(`CREATE TABLE IF NOT EXISTS field_label_overrides (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_type_slug TEXT NOT NULL,
        field_key     TEXT NOT NULL,
        label         TEXT NOT NULL,
        created_at    TEXT DEFAULT (datetime('now')),
        exclusive     INTEGER DEFAULT 0,
        template_id   INTEGER NOT NULL DEFAULT 0,
        UNIQUE(doc_type_slug, field_key, label, template_id)
      )`);
    } else if (!hasTpl) {
      db.exec('DROP TABLE IF EXISTS field_label_overrides_new');
      db.transaction(() => {
        db.exec(`
          CREATE TABLE field_label_overrides_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            doc_type_slug TEXT NOT NULL,
            field_key TEXT NOT NULL,
            label TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            exclusive INTEGER DEFAULT 0,
            template_id INTEGER NOT NULL DEFAULT 0,
            UNIQUE(doc_type_slug, field_key, label, template_id)
          );
          INSERT INTO field_label_overrides_new (id, doc_type_slug, field_key, label, created_at, exclusive)
            SELECT id, doc_type_slug, field_key, label, created_at, COALESCE(exclusive, 0)
            FROM field_label_overrides;
          DROP TABLE field_label_overrides;
          ALTER TABLE field_label_overrides_new RENAME TO field_label_overrides;
        `);
      })();
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (62)').run();
    console.log('JS migration 62 applied: field_label_overrides.template_id (0 = doc-type-wide)');
  }

  // ── Migration 63: extractions.corroboration on EXISTING installs ─────────────────────────────
  // The safeAdd for this column sits inside addMissingColumns, which only runs in the
  // migration-2 block — stamped long ago on every real install, so the column landed on FRESH
  // databases only. EXACTLY the trap migration 43's comment documents, walked into again
  // (2026-08-11, caught live by the owner: `SqliteError: table extractions has no column named
  // corroboration` on the first reprocess after the corroboration-record feature). Idempotent
  // against the fresh-DB path having already added it.
  if (!applied.has(63)) {
    if (tableExists(db, 'extractions') && !hasColumn(db, 'extractions', 'corroboration')) {
      db.exec('ALTER TABLE extractions ADD COLUMN corroboration TEXT');
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (63)').run();
    console.log('JS migration 63 applied: extractions.corroboration (record-only)');
  }

  // ── Migration 64: template_fields provenance — how did this frozen value get here? ───────────
  // Chris round 4 took DB forensics to explain: a teach overwrote template 13's frozen identity
  // with a garbled read, the template stamped 20 siblings at 95, and NOTHING in the schema said
  // which write had done it or when. `template_fields` records what a value IS and has never
  // recorded where it came from, so every diagnosis of this class starts by guessing.
  // Two additive, nullable columns, written only when a fixed_value actually CHANGES:
  //   fixed_source — 'teach' | 'admin' | 'graduation' | 'rebuild' | 'merge'
  //   fixed_set_at — when
  // Nullable and unread by any decision: this is a record, not a gate. Every existing row keeps
  // NULL, which correctly means "written before provenance was kept".
  if (!applied.has(64)) {
    if (tableExists(db, 'template_fields')) {
      if (!hasColumn(db, 'template_fields', 'fixed_source')) {
        db.exec('ALTER TABLE template_fields ADD COLUMN fixed_source TEXT');
      }
      if (!hasColumn(db, 'template_fields', 'fixed_set_at')) {
        db.exec('ALTER TABLE template_fields ADD COLUMN fixed_set_at TEXT');
      }
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (64)').run();
    console.log('JS migration 64 applied: template_fields.fixed_source/fixed_set_at (record-only)');
  }

  // ── Migration 65: templates.identity_unconfirmed — hold the siblings ─────────────────────────
  // Owner decision 4 of the teach-poisoning arc: a teach that replaces a template's frozen identity
  // with a GENUINELY DIFFERENT company commits (it must — a wrong frozen name has to stay
  // correctable), but it must not immediately stamp every sibling document with the new name at 95
  // on the strength of one document. Round 4 is what that looks like when it does: 20 siblings
  // stamped, 12 filed, from a single draw.
  // A pending template is marked here; `identity_supported_count` counts the documents that have
  // since agreed. Inert until `template_identity_hold_siblings` is armed, and inert on every
  // template that never has its identity replaced.
  if (!applied.has(65)) {
    if (tableExists(db, 'templates')) {
      if (!hasColumn(db, 'templates', 'identity_unconfirmed')) {
        db.exec('ALTER TABLE templates ADD COLUMN identity_unconfirmed INTEGER DEFAULT 0');
      }
      if (!hasColumn(db, 'templates', 'identity_unconfirmed_at')) {
        db.exec('ALTER TABLE templates ADD COLUMN identity_unconfirmed_at TEXT');
      }
      if (!hasColumn(db, 'templates', 'identity_supported_count')) {
        db.exec('ALTER TABLE templates ADD COLUMN identity_supported_count INTEGER DEFAULT 0');
      }
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (65)').run();
    console.log('JS migration 65 applied: templates.identity_unconfirmed (hold-the-siblings, inert until armed)');
  }

  // ── Migration 66: templates.buyer_issued — the layout the OWNER issues ───────────────────────
  // Chris's round-4 card 1 and his 2026-08-11 report are the same class: a template taught on a
  // PURCHASE ORDER the business ISSUED carries the owner's own company as its frozen identity, and
  // the owner's name and address are printed on every document the business RECEIVES (as the
  // recipient) — so `template_identity_on_page` is satisfied and the template claims 40 inbound
  // delivery notes and quotes from two other suppliers, at 95, with the owner's VAT number.
  // The mark records "this layout came from a PO-shaped document"; the refusal it enables is narrow
  // (a marked template may not win a TEXT arm on a document whose own TRUSTED printed title says a
  // different type) and lives behind TEMPLATE_BUYER_ISSUED_TYPE_SCOPE, DEFAULT OFF. Go-forward-only:
  // existing templates stay 0 until a confirm re-derives them.
  if (!applied.has(66)) {
    if (tableExists(db, 'templates') && !hasColumn(db, 'templates', 'buyer_issued')) {
      db.exec('ALTER TABLE templates ADD COLUMN buyer_issued INTEGER DEFAULT 0');
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (66)').run();
    console.log('JS migration 66 applied: templates.buyer_issued (inert until armed)');
  }

  // ── Migration 67: the second promotion round (see PROVEN_ON_DEFAULTS_2 above) ────────────────
  // Everything measured since migration 60 shipped dark, so a NEW customer's install behaves like
  // a 2025 default while the measured configuration sits in one person's settings table.
  // INSERT OR IGNORE: an existing install's own choice is NEVER overwritten — someone who
  // deliberately turned one of these off keeps it off; only keys with no row at all are seeded.
  if (!applied.has(67)) {
    try {
      const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
      const seeded = [];
      for (const [key, val] of PROVEN_ON_DEFAULTS_2) {
        const r = ins.run(key, val);
        if (r.changes) seeded.push(key);
      }
      console.log(`  migration 67: ${seeded.length} measured improvement(s) newly seeded`
                  + (seeded.length ? ` (${seeded.join(', ')})` : '; existing choices untouched'));
    } catch (e) { console.warn(`  migration 67 defaults: ${e.message}`); }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (67)').run();
    console.log('JS migration 67 applied: the import arc + graduation window default ON');
  }

  // ── Migration 68: the near-match identity guards ship ON (owner flip 2026-08-14) ──────────────
  // Chris found a one-letter misspelling of the owner's own company filed silently into a second
  // folder. Two guards close it: teach_identity_near_match_keep (a near-miss teach keeps the
  // incumbent frozen identity) and issuer_near_match_confirm_guard (any near-miss issuer — drawn OR
  // typed — is held for a Use/Keep choice before filing). Both read a default of ON in code; this
  // seeds the row so the Settings toggle reads TRUE and renders ON (a code-only default would leave
  // the switch showing OFF while the guard runs — the exact "Off by default while on" contradiction
  // Chris reported). INSERT OR IGNORE: a hand-disabled 'false' is preserved.
  if (!applied.has(68)) {
    try {
      const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
      const seeded = [];
      for (const key of ['teach_identity_near_match_keep', 'issuer_near_match_confirm_guard']) {
        if (ins.run(key, 'true').changes) seeded.push(key);
      }
      console.log(`  migration 68: ${seeded.length} near-match guard(s) newly seeded`
                  + (seeded.length ? ` (${seeded.join(', ')})` : '; existing choices untouched'));
    } catch (e) { console.warn(`  migration 68 defaults: ${e.message}`); }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (68)').run();
    console.log('JS migration 68 applied: near-match identity guards default ON');
  }

  // ── Migration 69: corroboration-driven auto-file resolution — eight switches, ALL DEFAULT OFF ──
  // The 2026-08-15 held-queue arc (gary → Oracle SIGN-OFF-W/COND). Each switch lets the DB's own
  // recorded corroboration (the `extractions.corroboration` record + the scope's dominant confirmed
  // value/format) resolve a note/floor that today holds a document whose value is already known-good.
  // Seeded 'false' so every Settings → Processing toggle renders truthfully OFF and is greppable in
  // one place; INSERT OR IGNORE preserves any hand-set choice. NOTHING changes behaviour until the
  // owner flips a switch — OFF is byte-identical. Oracle owes a per-predicate ratification (B/D/E/G)
  // before any of these defaults to ON.
  if (!applied.has(69)) {
    try {
      const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
      const keys = [
        'critfield_corrob_floor_relax',      // G (gate)  — a licensed ref/date clears the 88 floor if it matches the learned shape
        'vacuous_corrected_to_ignore',       // B (gate)  — a corrected_to == display_value no longer flags
        'ref_dominant_format_note_demote',   // B (extraction)
        'template_identity_corrob_note_shed',// A (extraction)
        'recon_shadow_attrib_note_demote',   // C (extraction)
        'snap_confusable_clean_autofile',    // D (extraction)
        'name_corrob_suggestion_adopt',      // E (extraction)
        'corrob_note_recompute_fc',          // the linchpin — recompute the format penalty post-demote
      ];
      let n = 0;
      for (const key of keys) if (ins.run(key, 'false').changes) n++;
      console.log(`  migration 69: ${n} corroboration-resolve switch(es) newly seeded OFF`);
    } catch (e) { console.warn(`  migration 69 defaults: ${e.message}`); }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (69)').run();
    console.log('JS migration 69 applied: corroboration-resolve switches seeded (all OFF)');
  }

  // ── Migration 70: ship the owner's proven config as the NEW-INSTALL DEFAULT ────────────────────
  // Owner decision 2026-08-15: after validating the app on a mature install (200 imports auto-filing),
  // "I want the current settings that work well to be the default." Their live install runs every reading
  // switch ON except straighten-on-import. This seeds that same set for a FRESH install so a new customer
  // gets the tuned behaviour out of the box (the reading internals are hidden behind the SFDEV gate;
  // DEFAULT ON just means they work silently). `deskew_on_import` is DELIBERATELY EXCLUDED (standing ruling
  // — WRONG LAYER, and it silently disables teach_angle_compose_scan). INSERT OR IGNORE: an existing install
  // (incl. the owner's, already all-on) and any hand-disabled switch are untouched — this only fills the gaps
  // on a clean DB. The whole set stays reversible per-switch in Settings → Processing (+ the SFDEV pane).
  if (!applied.has(70)) {
    try {
      const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
      const ON_BY_DEFAULT = [
        'template_code_frag_clean','template_clip_commit','template_abs_edge_guard','template_date_clip_gate',
        'template_label_digit_exact','teach_angle_compose','template_edge_cut_relocate','template_clip_commit_edge_slack',
        'template_date_invalid_yield','template_date_future_yield','template_pad_window_read','heading_absent_reread',
        'type_election_title_first','xcheck_corrob_note_demote','recon_total_note_demote','name_corrob_note_demote',
        'learning_exclude_machine_confirms','credit_sign_coherence','template_inline_row_overlap','ref_role_digit_gate',
        'anchor_inline_taught_offset_veto','template_drift_row_pitch','template_currency_edge_grow','template_name_edge_grow',
        'teach_angle_compose_scan','template_fixed_issuer_repair','template_reg_arbiter_anchor_evidence',
        'template_issuer_region_presence','template_fixed_seed_agreement_keep','stage05_ref_code_gate',
        'keyword_generic_caption_exclusive','type_title_owner_precedence','filing_value_sanity_flags','letterhead_issuer',
        'template_identity_on_page','teach_label_becomes_keyword','list_field_scan','template_hidden_field_drop',
        'template_format_fail_yield','customer_po_labels','code_separator_structure_guard','vat_eu_formats',
        'trust_shadow_row_skip','autofile_gate_unify','far_lowconf_valued_only','reprocess_shadow_stale_drop',
        'reconcile_shadow_attribution','vat_rate_at_skip','supplier_pin_self_discharge','confirmed_dominant_adopt',
        'raw_crop_witness_flag','raw_crop_witness_adopt','graduation_freeze_issuer','identity_scope_post_repair',
        'teach_identity_near_match_keep','template_identity_hold_siblings','template_buyer_issued_type_scope',
        'name_lexicon_low_distinct','issuer_near_match_confirm_guard','template_identity_geom_fuzzy_graduate',
        'critfield_corrob_floor_relax','vacuous_corrected_to_ignore','ref_dominant_format_note_demote',
        'template_identity_corrob_note_shed','recon_shadow_attrib_note_demote','snap_confusable_clean_autofile',
        'name_corrob_suggestion_adopt','corrob_note_recompute_fc',
        // NOT included: deskew_on_import (standing ruling — stays OFF).
      ];
      // The 2026-08-15 corroboration arc's 8 switches were seeded OFF by migration 69 (for validation)
      // in this SAME unreleased release — so INSERT OR IGNORE can't flip them. UPSERT those to true
      // (no released install carries a user choice for them yet; the owner's already reads true). Every
      // OTHER key uses INSERT OR IGNORE so a real prior user choice (e.g. a hand-disabled switch on an
      // established install) is preserved.
      const ARC_KEYS = new Set(['critfield_corrob_floor_relax','vacuous_corrected_to_ignore',
        'ref_dominant_format_note_demote','template_identity_corrob_note_shed','recon_shadow_attrib_note_demote',
        'snap_confusable_clean_autofile','name_corrob_suggestion_adopt','corrob_note_recompute_fc']);
      const up = db.prepare("INSERT INTO settings (key, value) VALUES (?, 'true') ON CONFLICT(key) DO UPDATE SET value='true'");
      let n = 0;
      for (const key of ON_BY_DEFAULT) {
        if (ARC_KEYS.has(key)) { up.run(key); n++; }
        else if (ins.run(key, 'true').changes) n++;
      }
      console.log(`  migration 70: ${n} reading switch(es) defaulted ON (arc keys forced; other existing choices untouched)`);
    } catch (e) { console.warn(`  migration 70 defaults: ${e.message}`); }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (70)').run();
    console.log('JS migration 70 applied: new-install defaults = the owner\'s proven all-on-except-straighten config');
  }

  // ── Migration 71: fresh-install auto-file bar 90 + the two 2026-08-16 switches (OFF) ─────────
  // (1) `auto_file_threshold`: unset has always meant 100 — "only perfect docs auto-file" — which on
  // a FRESH install files NOTHING out of the box (Chris 2026-08-15: taught reads land 87–95, so
  // wave 1 auto-filed 0/200 while File-All-Ready then filed 154 in one click). Seed '90' ONLY when
  // the DB has never processed a document (documents count 0 — the Oracle-ruled predicate: a DB
  // with no documents has no filing behaviour to change). An ESTABLISHED install — including the
  // owner's live DB, where the key is deliberately unset — gets NOTHING written: changing a live
  // install's filing bar is the owner's slider decision, not a migration's. The 88 critical-field
  // floor + the sub-100 structural docTrustGate + the flagged-field refusal all still gate every
  // sub-100 auto-file (trust.js), so 90 is a bar change, not a safety change.
  // (2)+(3) the P adopt lane + the vacuous-witness suppression ship OFF (Oracle: live default-ON
  // only after the OFF==ON corpus arm + ratify; sandbox validation flips them per-instance).
  if (!applied.has(71)) {
    try {
      const ins71 = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
      let _docCount = 0;
      try {
        _docCount = tableExists(db, 'documents')
          ? db.prepare('SELECT COUNT(*) AS n FROM documents').get().n : 0;
      } catch { _docCount = 0; }
      if (_docCount === 0) ins71.run('auto_file_threshold', '90');
      ins71.run('ref_prefix_confusable_adopt', 'false');
      ins71.run('raw_witness_vacuous_suppress', 'false');
    } catch (e) { console.warn(`  migration 71: ${e.message}`); }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (71)').run();
    console.log('JS migration 71 applied: fresh-install auto-file bar 90; P-adopt + vacuous-suppress switches seeded OFF');
  }

  // ── Migration 72: the Chris round-7 card-1/card-3 switches, seeded OFF ───────────────────────
  // Gate-C page-match v2 (the false "doesn't appear on this page as written" on values the page
  // DOES carry, as a confusable glyph or a split token), the vat-reg '$'-mid-run carve-out, and
  // money sign capture. All three DEFAULT OFF (Oracle: live default-ON owes the OFF==ON corpus
  // arm + ratify; they must also stay OUT of any future force-ON/UPSERT sweep until then —
  // pinned in test_migration71_defaults.js).
  if (!applied.has(72)) {
    try {
      const ins72 = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
      ins72.run('filing_sanity_page_match_v2', 'false');
      ins72.run('vat_reg_symbol_confusable', 'false');
      ins72.run('money_sign_capture', 'false');
    } catch (e) { console.warn(`  migration 72: ${e.message}`); }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (72)').run();
    console.log('JS migration 72 applied: page-match v2 + vat-reg symfold + money-sign switches seeded OFF');
  }

  // ── Migration 73: the confirmed-value pair (gary → Oracle SIGN-OFF-W/COND, 2026-08-18) ───────
  // `confirm_persist_values` — a value the operator APPROVED but did not edit finally becomes an
  // extraction row, so a TAUGHT document stops being invisible to the learned-format corpus that
  // decides whether its sender can file itself (measured: 9/10 taught docs carried no issuer row).
  // `format_corrections_dedupe` — getFieldFormats' corrections join fanned out, so ONE document
  // corrected three times reached the >=3 solid-format bar by itself; keep the latest correction
  // per (document, field). Oracle's ruling: these two ship and FLIP TOGETHER — minting rows into a
  // counter that miscounts would green the promise for the wrong reason, and de-duplicating alone
  // can DE-graduate a scope. Both seeded OFF; default-ON owes the four-arm sandbox measurement
  // (base / mint-only / defan-only / both) reporting newly-graduated and newly-de-graduated scopes.
  if (!applied.has(73)) {
    try {
      const ins73 = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
      ins73.run('confirm_persist_values', 'false');
      ins73.run('format_corrections_dedupe', 'false');
    } catch (e) { console.warn(`  migration 73: ${e.message}`); }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (73)').run();
    console.log('JS migration 73 applied: confirm-persist-values + corrections-dedupe seeded OFF');
  }

  // ── Migration 74: the human-licensed class correction (reggie + gary → Oracle S-O-W/C) ───────
  // `ref_class_fix_enabled` — the operator corrects ONE reference by a single confusable glyph
  // inside its prefix ('P1/' → 'PI/'), and the same byte-exact substitution is applied to the
  // other QUEUED documents of that sender, reported afterwards with an undo. The owner's ask
  // verbatim: no dialog beforehand, and no second dialog after. Nothing is filed; every touched
  // document stays in Review, badged, for the same human to confirm.
  // Seeded OFF. Default-ON owes the confirm-path integration harness and the OFF==ON identity run
  // — the realdoc corpus arm is VACUOUS for this one, because it writes at CONFIRM, not extraction.
  if (!applied.has(74)) {
    try {
      db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
        .run('ref_class_fix_enabled', 'false');
    } catch (e) { console.warn(`  migration 74: ${e.message}`); }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (74)').run();
    console.log('JS migration 74 applied: ref-class-fix seeded OFF');
  }

  // ── Migration 75: a value a REWRITE created may not be evidence for that rewrite ──────────────
  // (gary → Oracle SIGN-OFF-WITH-CONDITIONS, 2026-08-19.) The engine writes SIX corpus-derived
  // rewrite markers; the learned-format query excluded THREE. `+snapped` — the Stage-2.5d dominant
  // snap, which rewrites a value to the confirmed dominant with NO page witness — plus
  // `+snap_corrob`, `+name_corrob_adopt` and `+prefix_confusable_adopt` had no clause at all, so a
  // value the corpus produced voted for the belief that produced it. That loop was ALREADY OPEN on
  // the HUMAN channel: confirming a snapped document without editing it writes no corrections row,
  // so the row counted, marker and all. The machine-confirm exclusion masked it rather than
  // preventing it. Applied to BOTH readers (Oracle S0-C1) — `getFieldFormats` and
  // `getPrefixModelForScope`, the latter being where the confirm-time prefix guard was grading its
  // own homework. Seeded OFF: unlike the three unconditional clauses this one SHRINKS live corpora
  // (`+snapped` rows date from July), which can make a field unverifiable and de-graduate a scope.
  // The shrink direction is fail-safe — a vanished group means the sub-100 gate refuses, i.e. MORE
  // review, never a wrong file — so the code ships now and the flip waits on the de-graduation
  // census (`TESTING/_measure/census_machine_pointer.js`).
  if (!applied.has(75)) {
    try {
      db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
        .run('learning_exclude_rewrite_markers', 'false');
    } catch (e) { console.warn(`  migration 75: ${e.message}`); }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (75)').run();
    console.log('JS migration 75 applied: rewrite-marker learning exclusion seeded OFF');
  }

  // ── Migration 76: ship the Chris round-11 PROVEN config ON for fresh installs (owner decision,
  // 2026-08-21) ─────────────────────────────────────────────────────────────────────────────────
  // Round 11 ran a fresh install on mig-70 defaults PLUS four validated fixes and recorded zero
  // misfiles / full recovery. Those four now default ON so a new install starts in that proven
  // "best working state" (mig 70 reading switches + mig 71 auto-file bar 90 already ship on):
  //   ref_class_fix_enabled              — the P1/PI class correction (mig 74 seeded it OFF, so this
  //                                        must UPSERT-force, not INSERT OR IGNORE)
  //   hint_band_ws_normalize             — lever E
  //   template_identity_geom_fragment_shed — lever D (re-joins a column-broken letterhead so the
  //                                        "Company inferred" geom-witness note can shed)
  //   template_date_invalid_yield        — lever Z (already forced ON by mig 70; re-affirmed here so
  //                                        the validated SET is one coherent unit)
  // UPSERT-forced (the mig-70 arc-key stance): these are unreleased/dark switches no established user
  // has a deliberate choice for. NOT included: letterhead_prefill (built 2026-08-21, DEFAULT OFF —
  // it is SIGN-OFF-WITH-CONDITIONS and owes its verification gate before any default-ON flip); the
  // mig-75 starvation switch and every SENT-BACK / gate-owing arm stay OFF.
  if (!applied.has(76)) {
    try {
      const up76 = db.prepare("INSERT INTO settings (key, value) VALUES (?, 'true') ON CONFLICT(key) DO UPDATE SET value='true'");
      for (const key of ['ref_class_fix_enabled', 'hint_band_ws_normalize',
                         'template_identity_geom_fragment_shed', 'template_date_invalid_yield']) {
        up76.run(key);
      }
    } catch (e) { console.warn(`  migration 76: ${e.message}`); }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (76)').run();
    console.log('JS migration 76 applied: Chris round-11 validated fixes defaulted ON (ref-class-fix, hint-band-ws, geom-fragment-shed, date-invalid-yield)');
  }

  // ── Migration 77: cold-start letterhead PREFILL defaults ON (owner decision, 2026-08-21) ────────
  // `letterhead_prefill` — when the cold-start reader (letterhead_issuer, on) reads a company off a
  // fresh install's letterhead, LAND it in the Document Issuer box (conf 69 + a note) instead of
  // leaving it blank behind a "Use 'X'" button, so a first batch is one Confirm per doc, not a click
  // then a Confirm (Chris r11 card #4 — the single biggest first-day grind). It is held in Review two
  // ways (confidence 69 < the 70 threshold AND the note), plants NO learning (needs_review rows are
  // invisible to every confirmed-gated reader), and can never auto-file. Its gary→Oracle
  // SIGN-OFF-WITH-CONDITIONS gate passed: the executable cold pass (test_letterhead_prefill.py) shows
  // OFF==today, ON fills @69 + note with no button, the reader abstains on two companies (no-fill-
  // ambiguous), and a single-company/recipient page is FILLED-BUT-HELD (the known misfile class fails
  // toward review). UPSERT-forced like the mig-76 set; requires letterhead_issuer ON (mig 70).
  if (!applied.has(77)) {
    try {
      db.prepare("INSERT INTO settings (key, value) VALUES ('letterhead_prefill', 'true') ON CONFLICT(key) DO UPDATE SET value='true'").run();
    } catch (e) { console.warn(`  migration 77: ${e.message}`); }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (77)').run();
    console.log('JS migration 77 applied: cold-start letterhead prefill defaulted ON');
  }

  // ── Migration 78: the taught document COUNTS — confirm_persist_values + format_corrections_dedupe
  // default ON, PAIRED (owner decision, 2026-08-21; gary+barry → Oracle SIGN-OFF-WITH-CONDITIONS) ──
  // These two MUST move together (mig 73 seeded both OFF for validation, warning at index.js:1719):
  // `confirm_persist_values` mints an approved-but-unedited value as an extraction row so a TAUGHT
  // document finally contributes to the 3-confirmed-doc format wall (the post-teach card then reads
  // "2 more", not "3"); `format_corrections_dedupe` collapses the corrections fan-out so one document
  // corrected N times can't self-reach the bar — minting into a miscounting counter would green
  // graduations for the wrong reason, and de-dup alone can DE-graduate a scope. Their owed gate PASSED:
  //   G1 four-arm census (census_confirm_persist_flip.js) on the live-backup + young DBs — M-neutral
  //     (the only wrong-flags are buyer-issued POs correctly filed under the issuer, a GT artifact
  //     present in base), +16 correct newly-eligible on the young corpus, ZERO de-graduations,
  //     scopeTrust invariant clean, and G3 empty-issuer-block = 0 (Refinement B did not bite).
  //   G2 realdoc_regression (RR_APP_ENV=1, both flags): 0 regressions, M=0, zero per-field accuracy
  //     drop, +3 more CORRECT auto-files through the real Python pipeline.
  // UPSERT-forced past the mig-73 OFF seed. Go-forward-only in effect (persist mints at confirm).
  if (!applied.has(78)) {
    try {
      const up78 = db.prepare("INSERT INTO settings (key, value) VALUES (?, 'true') ON CONFLICT(key) DO UPDATE SET value='true'");
      up78.run('confirm_persist_values');
      up78.run('format_corrections_dedupe');
    } catch (e) { console.warn(`  migration 78: ${e.message}`); }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (78)').run();
    console.log('JS migration 78 applied: confirm-persist-values + corrections-dedupe defaulted ON (paired)');
  }

  // ── Migration 79: the "teach 1 → import N → it files itself" arc (2026-08-21; barry+gary+eric →
  // Oracle per-slice SIGN-OFF-WITH-CONDITIONS, docs/oracle_log.md) — every switch seeded OFF ──
  // Settings ROWS only (so the toggles render truthfully), INSERT OR IGNORE (an existing choice is
  // never overwritten). Each is its own kill switch; flipping any one back to 'false' restores the
  // pre-arc behaviour byte-for-byte:
  //   scope_sweep_enabled       — the shipped (dark) post-confirm Tier-1 sweep + consent bar.
  //   scope_sweep_auto_accept   — Slice 1: after a HUMAN confirm, the server files THAT sender's
  //                               ready documents itself (scope-local; receipt + Put back). Requires
  //                               scope_sweep_enabled + learning_exclude_machine_confirms +
  //                               autofile_gate_unify, re-checked server-side at every pass.
  //   letterhead_fragment_abstain — Slice 0: the geometry letterhead pick abstains instead of
  //                               returning a lone word ("Cleaning") beside a name-shaped segment.
  //   quiet_reread_enabled      — Slice 3: after a teach, the taught sender's template-less held
  //                               siblings are re-read on a below-normal background lane (never
  //                               greys Review; killed at every foreground door; merge-gated).
  if (!applied.has(79)) {
    try {
      const ins79 = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
      ins79.run('scope_sweep_enabled',         'false');
      ins79.run('scope_sweep_auto_accept',     'false');
      ins79.run('letterhead_fragment_abstain', 'false');
      ins79.run('quiet_reread_enabled',        'false');
      ins79.run('role_field_dominant_class',   'false');   // 08-22 fix-run: a role field judged by its dominant shape when one confirmed outlier collapsed the strict class
    } catch (e) { console.warn(`  migration 79: ${e.message}`); }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (79)').run();
    console.log('JS migration 79 applied: teach→file arc switches seeded OFF (sweep, auto-accept, fragment-abstain, quiet re-read)');
  }

  // ── Migration 80: the teach→file arc defaults ON (owner decision, 2026-08-22 morning) ──────────
  // Chris rounds 13/13b on a fresh sandbox with these five ON: 87 documents filed, zero wrong
  // folders, zero wrong numbers/dates, undo worked every time; "two of the three paths are now
  // genuinely hands-off" (docs/CHRIS_FULL_APP_REVIEW_2026-08-22.md). The owner asked for the next
  // builds and `npm start`s to run in that configuration, so a fresh DB gets it out of the box.
  //   scope_sweep_enabled        — the post-confirm re-check + consent bar
  //   scope_sweep_auto_accept    — a sender files its own ready documents after your confirms
  //                                (scope-local; receipt + Put back) — needs the sweep above plus
  //                                learning_exclude_machine_confirms + autofile_gate_unify, both
  //                                already ON since mig 70 and re-checked at every pass
  //   letterhead_fragment_abstain — never "Cleaning"/"Security" as a company
  //   quiet_reread_enabled       — the background re-read after a teach / graduation
  //   role_field_dominant_class  — one odd confirmed value no longer bricks a sender
  // UPSERT-forced (the mig-76 stance: dark switches no established user has chosen). Revert = flip
  // the toggle (Settings → Processing, dev-gated) or set the row to 'false'; mig 79 seeded the rows.
  // The Oracle asked for the quiet lane to be vetted apart from the auto-accept; the owner accepted
  // the combined rounds (docs/oracle_log.md 2026-08-21/22) — recorded, not hidden.
  if (!applied.has(80)) {
    try {
      const up80 = db.prepare("INSERT INTO settings (key, value) VALUES (?, 'true') ON CONFLICT(key) DO UPDATE SET value='true'");
      for (const key of ['scope_sweep_enabled', 'scope_sweep_auto_accept', 'letterhead_fragment_abstain',
                         'quiet_reread_enabled', 'role_field_dominant_class']) up80.run(key);
    } catch (e) { console.warn(`  migration 80: ${e.message}`); }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (80)').run();
    console.log('JS migration 80 applied: teach→file arc defaulted ON (sweep, auto-accept, fragment-abstain, quiet re-read, role-dominant-class)');
  }

  // ── Migration 81: the round-7 reading switches default ON (owner decision, 2026-08-22) ──────────
  // mig 71/72 seeded these OFF because they "owed the corpus arm". The arm has now run (realdoc
  // RR_APP_ENV=1 OCR_RENDER_DPI=200 on a live-DB copy, all five OFF vs all five ON: identical tables,
  // M delta 0, zero per-field drop — docs/oracle_log.md 2026-08-22) and every Chris round since round 10
  // ran them ON with zero misfiles; the owner's live DB has run them ON since 08-16. The owner asked
  // that a fresh DB match that configuration:
  //   ref_prefix_confusable_adopt   — restore a confirmed reference start over one look-alike glyph (P1/→PI/)
  //   raw_witness_vacuous_suppress  — don't ask the operator to compare a value with itself
  //   filing_sanity_page_match_v2   — Gate-C page-match v2 (split / joined / one-confusable reads)
  //   vat_reg_symbol_confusable     — a misread '$' never turns a VAT registration into an amount
  //   money_sign_capture            — keep the minus on a credit-note amount
  //   net_misread_total_flag        — PAIRED with vat_reg_not_amount on one Settings toggle (already ON
  //                                   since mig 70); seeding it keeps the pair together on a fresh DB
  // UPSERT-forced (the mig-76 stance). Revert = the toggle or the settings row.
  if (!applied.has(81)) {
    try {
      const up81 = db.prepare("INSERT INTO settings (key, value) VALUES (?, 'true') ON CONFLICT(key) DO UPDATE SET value='true'");
      for (const key of ['ref_prefix_confusable_adopt', 'raw_witness_vacuous_suppress', 'filing_sanity_page_match_v2',
                         'vat_reg_symbol_confusable', 'money_sign_capture', 'net_misread_total_flag']) up81.run(key);
    } catch (e) { console.warn(`  migration 81: ${e.message}`); }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (81)').run();
    console.log('JS migration 81 applied: round-7 reading switches defaulted ON (prefix-adopt, vacuous-suppress, page-match v2, vat-reg $, money sign, net-misread pair)');
  }

  // ── Migration 82: the two-line wordmark slice defaults ON (owner decision 2026-08-22; gary →
  // Oracle per-part SIGN-OFF-W/COND, docs/oracle_log.md) ──────────────────────────────────────
  // The owner's real scans (a STACKED logotype, "DOCUMENT" over "SOLUTIONS") exposed four sinks of
  // one source. All five switches below are their own revert (the dev-gated toggles in Settings →
  // Processing, or the settings row):
  //   letterhead_stack_abstain          — the cold issuer pick abstains on one line of a stacked
  //                                       wordmark ("TIONS" under "DOCUMENT") instead of prefilling it
  //   letterhead_depth_guard            — a single word deeper than the band cap ("Patrick", an
  //                                       address tail) is never a candidate
  //   template_fixed_seed_fragment_keep — a taught issuer box that reads ONE line of the stack keeps the
  //                                       curated template_fixed identity (the displacement that produced
  //                                       the un-sheddable "please confirm" note)
  //   quiet_reread_kw_select            — the quiet lane also re-reads held docs the matcher's keyword
  //                                       arm would bind to the taught layout (the 8 "not identified")
  //   quiet_reread_on_ready             — the confirm that makes a sender READY re-reads its siblings
  // UPSERT-forced (the mig-76 stance); gates: P1 census 0 correct lost / 0 new wrong, realdoc OFF==ON,
  // fired-path on the owner's parked run (the 9 held docs → template_fixed@95, overall 100).
  if (!applied.has(82)) {
    try {
      const up82 = db.prepare("INSERT INTO settings (key, value) VALUES (?, 'true') ON CONFLICT(key) DO UPDATE SET value='true'");
      for (const key of ['letterhead_stack_abstain', 'letterhead_depth_guard', 'template_fixed_seed_fragment_keep',
                         'quiet_reread_kw_select', 'quiet_reread_on_ready']) up82.run(key);
    } catch (e) { console.warn(`  migration 82: ${e.message}`); }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (82)').run();
    console.log('JS migration 82 applied: two-line wordmark slice defaulted ON (stack abstain, depth guard, fragment keep, kw select, ready re-read)');
  }

  // ── Migration 83: KEEP THE PROCESSED ORIGINAL (Chris round 14 card 1, gary (a′) → Oracle SIGN-OFF-
  // W/COND C1.1–C1.7, 2026-08-22) ────────────────────────────────────────────────────────────────
  // Import MOVES each original into `<source>/Processed` (or `processed_folder`) and the wizard
  // promises "your original scans are never deleted". But confirm-time `removeSourceFile` predates
  // that drain: it was "delete the intake file after filing" and now deletes the PROCESSED file —
  // so after filing the Output copy is the ONLY copy, and Put back → Delete → Empty bin destroys the
  // scan. Two parts:
  //   documents.drained_at — stamped by both drain success paths (inline + deferred flush); NULL
  //     = the original was never moved (drain off, or the file stayed locked). BACKFILL (one-time,
  //     never consulted at runtime): rows already drained before this migration carry a
  //     `folder_path` that IS the Processed dir (basename `Processed`, or the processed_folder
  //     setting) — stamp them so the new gate keeps their originals too.
  //   keep_processed_originals — UPSERT-forced 'true' for ALL installs (Oracle C1.4: the promise
  //     was shown to every install; keeping data is the safe direction). Under ON the confirm never
  //     unlinks a drained original (reviewService: one gate, covers human / sweep / offer / v1);
  //     an un-drained one is drained now instead. OFF = today's byte-identical removal. Revert =
  //     the Files & filing toggle (disk cost stated there).
  if (!applied.has(83)) {
    if (tableExists(db, 'documents') && !hasColumn(db, 'documents', 'drained_at')) {
      try { db.exec('ALTER TABLE documents ADD COLUMN drained_at TEXT'); }
      catch (e) { console.warn(`  migration 83 drained_at: ${e.message}`); }
    }
    try {
      let pf = null;
      try { pf = (db.prepare("SELECT value FROM settings WHERE key = 'processed_folder'").get() || {}).value || null; } catch {}
      const stamp = "COALESCE(processed_at, datetime('now'))";
      db.prepare(`UPDATE documents SET drained_at = ${stamp}
                   WHERE drained_at IS NULL AND folder_path IS NOT NULL
                     AND (LOWER(folder_path) LIKE '%\processed' OR LOWER(folder_path) LIKE '%/processed'
                          OR (? IS NOT NULL AND LOWER(TRIM(folder_path)) = LOWER(TRIM(?))))`).run(pf, pf);
      db.prepare("INSERT INTO settings (key, value) VALUES ('keep_processed_originals', 'true') ON CONFLICT(key) DO UPDATE SET value='true'").run();
    } catch (e) { console.warn(`  migration 83: ${e.message}`); }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (83)').run();
    console.log('JS migration 83 applied: documents.drained_at (+backfill) · keep_processed_originals ON (a filed document keeps its Processed original)');
  }

  // ── Migration 84: the one-sample seed SUPPORT PRUNE defaults ON for NEW installs only (Oracle
  // Q2 RE-RULE C9, 2026-08-22: after the final-rule census — recall 98.9%→100%, cross-supplier hits
  // unchanged — and Chris 15 — teach from the worst scan: `fingerprint_seed_pruned kept 7 recovered
  // 20` → the teach-time re-read did 19/19, round 14: 0). INSERT OR IGNORE: an existing install
  // keeps whatever it has (never UPSERT-forced; the intersection already heals a frozen garble on
  // the next confirm). Revert = the dev-gated toggle / env FINGERPRINT_SEED_SUPPORT=0.
  if (!applied.has(84)) {
    try { db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('fingerprint_seed_support_prune', 'true')").run(); }
    catch (e) { console.warn(`  migration 84: ${e.message}`); }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (84)').run();
    console.log('JS migration 84 applied: fingerprint_seed_support_prune ON for new installs (one-sample seed support prune)');
  }

  // ── Migration 85: catalog title aliases for EXISTING installs (A4 of the type-split arc, 2026-08-22;
  // gary → Oracle SIGN-OFF-W/COND S3). The printed heading of a Quote is "QUOTATION" (Remittance
  // Advice → "Remittance", Statement → "Statement of Account", Service Worksheet → "Worksheet"/"Job
  // Sheet"); the type NAME folded in as a heading phrase but its alias never did, so on the owner's
  // install no Quote could carry a trusted title and ONE mis-confirmed sibling held 17 quotes. Fills
  // title_aliases ONLY where the type carries none (an operator's own aliases are never touched) and
  // only through normaliseTitleAliases (alias == another type's name is refused). Idempotent.
  if (!applied.has(85)) {
    try {
      const seeded = require('./modules/document_types').seedPresetTitleAliases(db);
      console.log(`JS migration 85 applied: catalog title aliases seeded on ${seeded.length} type(s)${seeded.length ? ' (' + seeded.join(', ') + ')' : ''}`);
    } catch (e) { console.warn(`  migration 85: ${e.message}`); }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (85)').run();
  }

  // ── Migration 86: PUT BACK MUST STICK (Chris round 18 card A3, 2026-08-23). "Put back" on an
  // activity chip de-confirmed the swept documents — and the scope auto-accept re-filed them 1.5 s
  // after the user's NEXT confirm on that sender (the undo was illusory; the records then said the
  // user confirmed them). `documents.put_back_at` is stamped by both undo doors and read by THE ONE
  // auto-file predicate (trust.isAutoFileEligible → reason 'put-back'), so every machine door (the
  // scope sweep, the reprocess accept, the class fix's siblings) refuses the document until a HUMAN
  // confirm clears the stamp at claim time. NULL-inert: nothing changes for an un-stamped row.
  if (!applied.has(86)) {
    if (tableExists(db, 'documents') && !hasColumn(db, 'documents', 'put_back_at')) {
      try { db.exec('ALTER TABLE documents ADD COLUMN put_back_at TEXT'); }
      catch (e) { console.warn(`  migration 86: ${e.message}`); }
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (86)').run();
    console.log('JS migration 86 applied: documents.put_back_at (a put-back document never files itself until a human confirms it)');
  }

  // ── Migration 87: PUT-BACK RE-FILE via File All Ready (2026-08-23, Oracle SIGN-OFF-W/COND). The
  // owner's rule: a doc the system ALREADY auto-filed and the user merely put back to GLANCE at should
  // re-file on an explicit File All click without a per-doc re-confirm — it still clears the strictest
  // auto-file predicate today (bypassing only the put-back stamp). Two support columns, both NULL-inert:
  //   • refile_declined_at — HARD-HELD marker: set when a user pulls a re-filed-from-put-back doc BACK
  //     again (the undo-loop closure, Oracle blocking cond 2). isAutoFileEligible refuses it
  //     UNCONDITIONALLY (never bypassable); only a per-doc human confirm clears it. Prevents File All
  //     from silently re-burying a doc the user keeps reversing (the illusory-undo class A3 guarded).
  //   • putback_refiled_at — history: stamped when a human confirm clears a put_back_at (the doc was
  //     confirmed OUT of a put-back state). deconfirm reads it to know a later put-back is a REVERSAL.
  // The whole behaviour is DARK behind the setting `putback_refile_on_file_all`; OFF = a put-back doc is
  // held exactly as mig 86 left it (both columns unread), so OFF is byte-identical.
  if (!applied.has(87)) {
    if (tableExists(db, 'documents')) {
      for (const col of ['refile_declined_at', 'putback_refiled_at']) {
        if (!hasColumn(db, 'documents', col)) {
          try { db.exec(`ALTER TABLE documents ADD COLUMN ${col} TEXT`); }
          catch (e) { console.warn(`  migration 87 (${col}): ${e.message}`); }
        }
      }
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (87)').run();
    console.log('JS migration 87 applied: documents.refile_declined_at + putback_refiled_at (put-back re-file via File All, DARK)');
  }

  // supplier_identifiers (slice 1a of the identifier-registry arc; reggie+gary → Oracle SIGN-OFF-W/COND
  // 2026-08-26). A per-supplier registry of STABLE HARD IDENTIFIERS (VAT number, company registration
  // number, phone) learned at confirm from the ISSUER region — used LATER (slice 1b) to corroborate who
  // a future document is from. Additive + INERT: no rows unless the DARK `identifier_registry` switch is
  // armed AND a human confirm learns one, so an un-armed install is byte-identical. UNIQUE(supplier,kind,
  // value_norm) dedups; the (kind,value_norm) index is the reverse-lookup the match path will use.
  if (!applied.has(88)) {
    if (!tableExists(db, 'supplier_identifiers')) {
      db.exec(`CREATE TABLE supplier_identifiers (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier_name TEXT    NOT NULL,
        kind          TEXT    NOT NULL,          -- 'vat' | 'company_no' | 'phone'
        value_norm    TEXT    NOT NULL,          -- canonical compare key (identifierExtract normalisation)
        source_doc_id INTEGER,
        issuer_region TEXT,                      -- 'header' | 'footer' (audit; never 'body')
        first_seen    TEXT    NOT NULL DEFAULT (datetime('now')),
        last_seen     TEXT    NOT NULL DEFAULT (datetime('now')),
        times_seen    INTEGER NOT NULL DEFAULT 1,
        UNIQUE(supplier_name, kind, value_norm)
      )`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_supplier_identifiers_lookup ON supplier_identifiers(kind, value_norm)`);
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (88)').run();
    console.log('JS migration 88 applied: supplier_identifiers (hard-identifier registry, DARK/inert)');
  }

  // New-install DEFAULT-ON for the three VERIFIED 2026-08-26 review switches (owner decision + their
  // gates met): position_teach_nudge (Chris-verified), issuer_sibling_fill (census 0/1.25M + zero
  // misfile), issuer_suggest_on_blank_confirm (wiring verified end-to-end + persisted census clean).
  // INSERT OR IGNORE so an existing owner choice is never overwritten (seeds 'true' only on a fresh
  // DB). DELIBERATELY EXCLUDES `identifier_registry` (Oracle SIGN-OFF-WITH-CONDITIONS — needs the
  // realdoc M=0 + real-customer-VAT census + Oracle ratify before it may default) and the per-DB-only
  // detection arcs whose new-install default was ruled DEFERRED (name_dominant_snap, branding_strip_
  // reg_boilerplate) — those stay off-by-default for new installs until their held/misfiled reprocess
  // gate is eyeballed. Mirrors the mig-70/80/81/82 default-flip pattern.
  if (!applied.has(89)) {
    const _seed = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, 'true')");
    for (const k of ['position_teach_nudge', 'issuer_sibling_fill', 'issuer_suggest_on_blank_confirm']) {
      try { _seed.run(k); } catch (e) { console.warn(`  migration 89 (${k}): ${e.message}`); }
    }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (89)').run();
    console.log('JS migration 89 applied: default-ON position_teach_nudge + issuer_sibling_fill + issuer_suggest_on_blank_confirm (identifier_registry stays DARK)');
  }

  // Migration 90 (2026-08-26, Learning Repair "start fresh" — gary design → Oracle SIGN-OFF-W/COND):
  // documents.learning_excluded_at. A confirmed document carrying this stamp stays FILED and
  // SEARCHABLE but STOPS TEACHING — every learning-feeding reader appends the ONE shared predicate
  // (machine_vias.learningExcludedSql), so a forgotten sender×type is genuinely cold on its next
  // import without un-filing anything. Nullable, no default, nothing stamps it until the DARK
  // `learning_repair_forget` door is armed ⇒ inert by construction on every existing install.
  if (!applied.has(90)) {
    try {
      if (tableExists(db, 'documents') && !hasColumn(db, 'documents', 'learning_excluded_at')) {
        db.exec('ALTER TABLE documents ADD COLUMN learning_excluded_at TEXT');
      }
    } catch (e) { console.warn(`  migration 90 (learning_excluded_at): ${e.message}`); }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (90)').run();
    console.log('JS migration 90 applied: documents.learning_excluded_at (Learning Repair start-fresh stamp; inert until stamped)');
  }

  // Migration 91 (2026-08-26, barcode inventory — barry → gary design, DARK `barcode_inventory`):
  // document_barcodes = every 1D/2D symbol decoded on a document's pages at import/reprocess
  // (ocr/barcodes.py over the OCR-rendered pages; separator-sheet SFSEP payloads excluded). One row
  // per (page, symbology, value) with its normalised box. Feeds full-text search (a bar-only value
  // finds its document) and, later, the barcode field's teach pills. Cascade on document delete.
  // A TABLE, not a JSON column: indexable by value, per-row box, and a JSON LIKE would false-hit
  // on keys. Nothing writes it until the switch is on ⇒ inert on every existing install.
  if (!applied.has(91)) {
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS document_barcodes (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id  INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        page         INTEGER NOT NULL DEFAULT 0,
        symbology    TEXT    NOT NULL,
        value        TEXT    NOT NULL,
        x_norm       REAL, y_norm REAL, w_norm REAL, h_norm REAL,
        orientation  INTEGER,
        content_type TEXT,
        created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_document_barcodes_doc ON document_barcodes(document_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_document_barcodes_value ON document_barcodes(value)');
    } catch (e) { console.warn(`  migration 91 (document_barcodes): ${e.message}`); }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (91)').run();
    console.log('JS migration 91 applied: document_barcodes (barcode inventory; inert until barcode_inventory is on)');
  }

  // Migration 92 (2026-08-27, owner: "surely the main fields ref, date and supplier must be required by
  // nature"): STRUCTURAL ROLES ARE REQUIRED BY NATURE. The shared doc-type editor's create road never set
  // `fields.required` on the identity / ref-role / date-role fields it supplied (every SEEDED type has it),
  // and the edit-mode toggle is locked + updateField refuses the change — so a wizard-made type carried
  // required=0 on all three roles, the scorer (validator.overall_confidence: required fields, else EVERY
  // field) fell to every field, and one unread optional field held a whole graduated scope (Castellan
  // worksheets at overall 81 < 95, 2026-08-27; the Northgate "72% cap" of 07-27 was the same class). The
  // writers now assert the flag (document_types.assertStructuralRequired at every create / role re-point /
  // backup-restore road); this heals the rows that already exist. Only ever 0→1 on a ROLE field; idempotent.
  if (!applied.has(92)) {
    let n = 0;
    try { n = require('./modules/document_types').assertStructuralRequired(db) || 0; }
    catch (e) { console.warn(`  migration 92 (structural roles required): ${e.message}`); }
    db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (92)').run();
    console.log(`JS migration 92 applied: structural roles required by nature (${n} role field(s) healed)`);
  }

  // ── Migration 93: complete the all-on-except-straighten new-install defaults (see ALL_ON_DEFAULTS_93) ──
  if (!applied.has(93)) {
    try {
      const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
      let n = 0;
      for (const key of ALL_ON_DEFAULTS_93) { if (ins.run(key, 'true').changes) n++; }
      // learning_exclude_rewrite_markers was seeded 'false' by mig 75 and never promoted, so the
      // INSERT OR IGNORE above no-ops on it (the row already exists). It is a DARK internal switch with no
      // Settings UI — a 'false' there is never a deliberate user choice, only the mig-75 seed — and the
      // rest of its learning-exclusion family is already on, so force it true. (This is the ONLY key the
      // fresh-DB verify found seeded-off-and-unpromoted; UPDATE touches only its existing row.)
      db.prepare("UPDATE settings SET value = 'true' WHERE key = 'learning_exclude_rewrite_markers' AND value != 'true'").run();
      db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (93)').run();
      console.log(`JS migration 93 applied: ${n} feature switch(es) defaulted ON for fresh installs (all-on-except-straighten; existing choices + hand-disables untouched)`);
    } catch (e) { console.warn(`  migration 93 defaults: ${e.message}`); }
  }

  // ── Migration 94: seed the 2026-08-30 re-slice witness arc switches OFF (DARK until their census + Oracle
  // ratify). INSERT OR IGNORE: an existing choice is never overwritten. reslice_witness_sweep = the taught
  // total-box re-read witness (engine stage 4.7); corrob_discount_invalid_witness = the record's format-invalid
  // witness discount; template_format_fail_yield_strict_money = the strict currency leg of the format-fail yield.
  if (!applied.has(94)) {
    try {
      const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
      let n = 0;
      for (const key of ['reslice_witness_sweep', 'corrob_discount_invalid_witness', 'template_format_fail_yield_strict_money']) {
        if (ins.run(key, 'false').changes) n++;
      }
      db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (94)').run();
      console.log(`JS migration 94 applied: ${n} re-slice witness arc switch(es) seeded OFF (DARK)`);
    } catch (e) { console.warn(`  migration 94 (re-slice witness switches): ${e.message}`); }
  }

  // ── migration 95: the cell-below keyword association seeded OFF (DARK — oscar design
  //    2026-08-31, the Hard Set boxed meta_row cold fill gap; flip only after the Oracle vet +
  //    the Hard Set + realdoc-605 gates) ──
  if (!applied.has(95)) {
    try {
      const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
      const n = ins.run('keyword_cell_below', 'false').changes;
      db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (95)').run();
      console.log(`JS migration 95 applied: cell-below keyword association seeded OFF (DARK, ${n} row)`);
    } catch (e) { console.warn(`  migration 95 (keyword_cell_below): ${e.message}`); }
  }

  // ── migration 96: the accounting-negative money captures seeded OFF (DARK — reggie design
  //    2026-08-31: whole-segment "(£908.16)" / "£908.16 CR" keep their sign at both mints;
  //    trailing/leading bare minus stays note-only) ──
  if (!applied.has(96)) {
    try {
      const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
      let n = 0;
      for (const key of ['money_sign_parens', 'money_sign_cr']) {
        if (ins.run(key, 'false').changes) n++;
      }
      db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (96)').run();
      console.log(`JS migration 96 applied: ${n} accounting-negative capture switch(es) seeded OFF (DARK)`);
    } catch (e) { console.warn(`  migration 96 (money sign parens/cr): ${e.message}`); }
  }

  // ── migration 97: the buyer-issued convention note seeded OFF (DARK — gary lever 1,
  //    2026-08-31: a learned-path buyer fill on a buyer-issued PO stays silent only with
  //    same-type convention evidence; else a both-parties note, review-bound) ──
  if (!applied.has(97)) {
    try {
      const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
      const n = ins.run('buyer_issued_convention_note', 'false').changes;
      db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (97)').run();
      console.log(`JS migration 97 applied: buyer-issued convention note seeded OFF (DARK, ${n} row)`);
    } catch (e) { console.warn(`  migration 97 (buyer_issued_convention_note): ${e.message}`); }
  }

  // ── migration 98: the 2026-08-31 gated arcs default ON (owner: "make sure all the switches are
  //    on that need to be", after each passed its Oracle cycle + Hard Set + realdoc-605 gates —
  //    docs/designs/DARK_ARCS_GATES_2026-08-31.md — and a live import demo). UPSERT-FORCED like the
  //    mig-70/80/81 arc promotions, so the 95-97 'false' seeds and any pre-rename copy heal too.
  //    template_format_fail_yield_strict_money is DELIBERATELY absent: Oracle C10/C11 — it pre-empts
  //    the re-slice sweep's release path and is NEVER flipped in this arc. ──
  if (!applied.has(98)) {
    try {
      const up = db.prepare(`INSERT INTO settings (key, value) VALUES (?, 'true')
                             ON CONFLICT(key) DO UPDATE SET value='true'`);
      const keys = ['keyword_cell_below', 'money_sign_parens', 'money_sign_cr',
                    'buyer_issued_convention_note', 'reslice_witness_sweep',
                    'corrob_discount_invalid_witness'];
      for (const key of keys) up.run(key);
      db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (98)').run();
      console.log(`JS migration 98 applied: ${keys.length} gated 08-31 arc switch(es) defaulted ON`);
    } catch (e) { console.warn(`  migration 98 (08-31 arcs ON): ${e.message}`); }
  }

  // ── migration 99: the taught-total occurrence-selection fix seeded OFF (DARK — reggie stop-vocabulary
  //    + 007 placement → Oracle SIGN-OFF-W/COND 2026-08-31; the Net-Total locate steal, owner exhibit
  //    Castellan credit_note_0008. Flip only AFTER the sweep/discount arcs and its own gates: the
  //    Castellan/divergence/carriers/twin/vocab pins, Hard Set dual-rendition classes, and realdoc-605
  //    OFF==ON. Never justified by flipping strict-money.) ──
  if (!applied.has(99)) {
    try {
      const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
      const n = ins.run('template_locate_role_qualifier', 'false').changes;
      db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (99)').run();
      console.log(`JS migration 99 applied: taught-total role-qualifier locate seeded OFF (DARK, ${n} row)`);
    } catch (e) { console.warn(`  migration 99 (template_locate_role_qualifier): ${e.message}`); }
  }

  // ── migration 100: the fragment-containment yield seeded OFF (DARK — the CAD8 ⊂ CAD832694 exhibit,
  //    Castellan delivery_note_0005; Oracle SIGN-OFF-W/COND 2026-08-31, the sanctioned successor to the
  //    08-09 Q2 rejection. Flip only after its own pins + realdoc-605 OFF byte-identical / ON M=7 unchanged
  //    + the Castellan five fixtures + the clipped-code Hard Set class.) ──
  if (!applied.has(100)) {
    try {
      const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
      const n = ins.run('template_fragment_containment_yield', 'false').changes;
      db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (100)').run();
      console.log(`JS migration 100 applied: fragment-containment yield seeded OFF (DARK, ${n} row)`);
    } catch (e) { console.warn(`  migration 100 (template_fragment_containment_yield): ${e.message}`); }
  }

  // ── migration 101: PROMOTE the review-bound straighten retry to a fresh-install DEFAULT (2026-08-31,
  //    owner-approved on the Silverbeck tilted-scan evidence: on held docs the whole-page straighten retry
  //    recovers otherwise-EMPTY ref/date at ~98%, held for a one-click "confirm once" — it NEVER auto-files
  //    (forces needs_review) and adopts the straightened read only when overall confidence is strictly
  //    higher, so it is safe to default. The switch shipped DARK (4607cc6); this is its promotion migration,
  //    the same ride the other DARK switches take once their gate is met (pin test_deskew_review_retry.py).
  //    INSERT OR IGNORE: a fresh install (no row) gets 'true'; ANY existing install's own choice — including
  //    a deliberate hand-disable — is untouched. `deskew_on_import` stays OFF (the standing wrong-layer
  //    ruling — that one can auto-file a bad straighten; this review-bound retry cannot). ──
  if (!applied.has(101)) {
    try {
      const n = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
        .run('deskew_review_retry_enabled', 'true').changes;
      db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (101)').run();
      console.log(`JS migration 101 applied: review-bound straighten retry defaulted ON for fresh installs (${n} row)`);
    } catch (e) { console.warn(`  migration 101 (deskew_review_retry_enabled default): ${e.message}`); }
  }

  // ── migration 102: THREE DARK rollout features (2026-09-01, owner ask; gary+reggie+eric →
  //    Oracle SIGN-OFF-WITH-CONDITIONS). All default OFF — byte-identical until an owner flip.
  //    (1) quiet_reread_silent — hide the background re-read chatter + defer the queue refresh while
  //        the user is actively viewing a doc (the lane's priority is unchanged; it is already
  //        foreground-preempted). See src/windows/review/renderer.js.
  //    (2) sweep_inview_countdown — replace the hard "being viewed" auto-file block, FOR THE LOCAL
  //        desktop viewer ONLY, with a 5→1 countdown + Stop on the preview. Remote/second viewers keep
  //        the verbatim block. See src/modules/processing/handler.js _evaluateSweepDoc.
  //    (3) accept_field_chars_enabled — the "these characters are fine" charset allowlist (per field
  //        TYPE) + live sibling note-clear + confidence restore + auto-file, no reprocess. The new
  //        column extractions.charset_flag_meta carries {chars, precap} so the confidence restore is
  //        faithful (the note caps confidence at 70 and the pre-cap value is otherwise lost — the
  //        08-15 fc_delta lesson). Additive/nullable; never compared by the OFF corpus arm. ──
  if (!applied.has(102)) {
    try {
      try { db.exec('ALTER TABLE extractions ADD COLUMN charset_flag_meta TEXT'); }
      catch (e) { if (!/duplicate column/i.test(e.message)) throw e; }   // idempotent re-run
      const seed = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
      let n = 0;
      for (const k of ['quiet_reread_silent', 'sweep_inview_countdown', 'accept_field_chars_enabled'])
        n += seed.run(k, 'false').changes;
      db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (102)').run();
      console.log(`JS migration 102 applied: 3 DARK rollout features seeded OFF (${n} setting rows) + extractions.charset_flag_meta`);
    } catch (e) { console.warn(`  migration 102 (dark rollout features): ${e.message}`); }
  }

  // ── migration 103: the three 2026-09-01 rollout features default ON (owner: "flip them on, they need
  //    to be defaults"). Each is built + pinned + OFF-byte-identical, and deskew_corrob's sibling census
  //    is met (docs/DESKEW_CORROB_CENSUS_2026-09-01.md). UPSERT-FORCED past mig 102's 'false' seed (the
  //    mig-96→98 seed-OFF-then-force-ON pattern) so existing installs + fresh installs both get them.
  //    They stay SFDEV-gated (DEV_SWITCH_IDS) — customer-invisible defaults with a dev escape hatch, not
  //    new customer switches. ──
  if (!applied.has(103)) {
    try {
      const up = db.prepare(`INSERT INTO settings (key, value) VALUES (?, 'true')
                             ON CONFLICT(key) DO UPDATE SET value='true'`);
      const keys = ['quiet_reread_silent', 'sweep_inview_countdown', 'accept_field_chars_enabled'];
      for (const key of keys) up.run(key);
      db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (103)').run();
      console.log(`JS migration 103 applied: ${keys.length} rollout feature(s) defaulted ON`);
    } catch (e) { console.warn(`  migration 103 (rollout features ON): ${e.message}`); }
  }

  // ── migration 104: QUICK REPROCESS (2026-09-01, owner ask; gary → Oracle SIGN-OFF-W/COND C1-C7). ──
  //    documents.ocr_recipe stamps HOW the stored full-page text was produced (dpi / light levels / born-
  //    digital / pipeline rev / tesseract version) so a later "Quick" reprocess can prove the cached OCR
  //    is still valid and skip the render+crop pass. GO-FORWARD only: NULL = legacy (never stamped) and
  //    ocrCacheUsable treats NULL as "not reusable", so no backfill is needed. The feature ships DARK —
  //    `quick_reprocess_enabled` seeded 'false' (absent OR 'false' == OFF for every reader); the Quick/Full
  //    dialog and the imageless partition are inert until the owner flips it. SFDEV-gated toggle.
  if (!applied.has(104)) {
    try {
      try { db.exec('ALTER TABLE documents ADD COLUMN ocr_recipe TEXT'); }
      catch (e) { if (!/duplicate column/i.test(e.message)) throw e; }
      db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('quick_reprocess_enabled', 'false')`).run();
      db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (104)').run();
      console.log('JS migration 104 applied: documents.ocr_recipe + quick_reprocess_enabled (DARK)');
    } catch (e) { console.warn(`  migration 104 (quick reprocess): ${e.message}`); }
  }

  // ── migration 105: high-variance format-flag suppression seeded OFF (DARK — the Print Tracker
  //    make/model/serial noise; reggie + gary → Oracle SIGN-OFF-W/COND 2026-09-02. Suppresses the
  //    Stage-4.5 "format differs from the usual" flag on the engine's own text reads of a field whose
  //    confirmed history has no usual format; keeps the single letter<->digit slip-catch. Flip only
  //    after the 605-corpus OFF-vs-ON gate (M=0, zero accuracy drop, two-sided non-vacuity).) ──
  if (!applied.has(105)) {
    try {
      const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
      const n = ins.run('format_variance_relax', 'false').changes;
      db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (105)').run();
      console.log(`JS migration 105 applied: format-variance relax seeded OFF (DARK, ${n} row)`);
    } catch (e) { console.warn(`  migration 105 (format_variance_relax): ${e.message}`); }
  }

  // ── migration 106: TEST-BUILD toggle enablement (2026-09-03, owner ask — "turn on the safe recent
  //    arcs so I can test; not going to a customer until I know it works"). Unlike every DARK-seed
  //    migration above, this FORCE-flips (UPSERT, overwriting any prior value) the six SAFE-by-
  //    construction recent arcs ON, so the owner's EXISTING %APPDATA% test DB picks them up on the
  //    next launch (an INSERT OR IGNORE seed would leave an already-present 'false' untouched). Each
  //    is review-bound / flag-only / byte-identical-off, so a wrong read is HELD, never mis-filed.
  //    ⚠ TEST-ONLY / REVERSIBLE: this bumps DARK switches past their individual flip gates for the
  //    owner's own testing. Before ANY customer build, REVERT this migration (or gate the flip) and
  //    re-confirm each arc against its own gate (the 605-corpus census for format-variance, the
  //    WARM-DB confirm for fragment-containment, the soak for watch-separate, etc.). DELIBERATELY
  //    EXCLUDES the three NEVER-flip seams (template_format_fail_yield_strict_money — pre-empts the
  //    sweep release path; trust_company_key_own_scope — holds 45 docs; deskew_on_import — WRONG
  //    LAYER, toggle removed this session) and the corpus/Oracle-gated riskier switches. ──
  if (!applied.has(106)) {
    try {
      const up = db.prepare(`INSERT INTO settings (key, value) VALUES (?, 'true')
                             ON CONFLICT(key) DO UPDATE SET value = 'true'`);
      const TEST_ON = [
        'format_variance_relax',              // mig 105 (2026-09-02) — high-variance format-flag suppression
        'template_fragment_containment_yield',// mig 100 (Fix B) — clipped-code yields to the fuller keyword read
        'template_locate_role_qualifier',     // mig 99 — taught "Total" prefers the grand total
        'deskew_corrob_autofile',             // 2026-09-01 — corroborated straighten auto-file (census MET)
        'quick_reprocess_enabled',            // mig 104 — reuse cached page OCR at "Reprocess all"
        'watch_separate_enabled',             // 2026-09-02 — split multi-doc PDFs on the watch path too
      ];
      for (const k of TEST_ON) up.run(k);
      db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (106)').run();
      console.log(`JS migration 106 applied: TEST-BUILD enabled ${TEST_ON.length} safe recent arcs (FORCE ON — revert before customer build)`);
    } catch (e) { console.warn(`  migration 106 (test-build toggle enablement): ${e.message}`); }
  }

  // ── migration 107: FORMAT_VARIANCE_RELAX_REF seeded OFF (DARK — the Print Tracker reference_number
  //    re-import noise; gary + Oracle C1a 2026-09-03). The mapper DERIVED-rung "manually mapped value
  //    differs from the usual format" warn is noise on a HIGH-VARIANCE ref/serial when the read is an
  //    EXACT confirmed in-scope literal (a value a human already accepted for this field). When ON, the
  //    warn is suppressed for that exact-literal case ONLY; a never-confirmed value keeps the flag +
  //    review (the ref is the filename token — fail-toward-review). DELIBERATELY NOT in mig 106's
  //    TEST_ON force-ON list: clearing the warn drops the cap+note (the value may auto-file) and
  //    docTrustGate's coarse _codeish does NOT re-catch a code-class ref bleed, so this removes a
  //    ref-shape veto path and stays dark until its OWN census (value diffs 0 + no held->auto-file on a
  //    NON-confirmed shape-mismatch; an exact-confirmed-literal held->auto-file is the allowed win). ──
  if (!applied.has(107)) {
    try {
      const n = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('format_variance_relax_ref', 'false')`).run().changes;
      db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (107)').run();
      console.log(`JS migration 107 applied: format-variance relax (ref) seeded OFF (DARK, ${n} row)`);
    } catch (e) { console.warn(`  migration 107 (format_variance_relax_ref): ${e.message}`); }
  }

  // ── migration 108: TEST-BUILD force-ON of format_variance_relax_ref (2026-09-03, owner ask — "flip
  //    it on and start"; same pattern + caveat as mig 106). FORCE-flips (UPSERT) the ref-shape-warn
  //    suppression ON so the owner's existing test DB picks it up. It is exact-confirmed-literal ONLY
  //    (a value a human already accepted), so a wrong/never-confirmed read is still HELD, never auto-
  //    filed — but this arc removes a ref-shape veto path, so it is a SEPARATE migration from mig 106
  //    and its own census is still OWED. ⚠ TEST-ONLY / REVERSIBLE: revert (or gate) before ANY customer
  //    build and run the census (value diffs 0 + no held->auto-file on a NON-confirmed shape-mismatch). ──
  if (!applied.has(108)) {
    try {
      db.prepare(`INSERT INTO settings (key, value) VALUES ('format_variance_relax_ref', 'true')
                  ON CONFLICT(key) DO UPDATE SET value = 'true'`).run();
      db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (108)').run();
      console.log('JS migration 108 applied: TEST-BUILD force-ON format_variance_relax_ref (revert + census before customer build)');
    } catch (e) { console.warn(`  migration 108 (format_variance_relax_ref force-ON): ${e.message}`); }
  }

  // ── migration 109: format_variance_relax_ref_INLINE seeded OFF (2026-09-03, gary + Oracle SIGN-OFF-
  //    W/COND). SIBLING of mig 107 (independent flag): the SAME exact-confirmed-literal suppression at a
  //    SECOND choke point that bypasses _gate_value — _pick_fuller_code's box-drift disagreement flag
  //    (rigid drawn-box read garbage, label-anchored INLINE read RECOVERED the value). Heals the
  //    Print-Tracker exhibit doc121 (rigid '10RARNNNAD'@44, inline '1984800049'@96) that mig 107 could
  //    NOT reach. Oracle R2 guard (in Python) keeps a CREDIBLE competing rigid read flagged. DARK; its
  //    OWN WARM-DB census is OWED (each clean-commit == that DOC's own prior-confirmed value; realdoc
  //    M=0). Clearing the flag drops cap+note (may auto-file) — exact-literal + non-credible-rigid are
  //    the sole barriers. ──
  if (!applied.has(109)) {
    try {
      const n = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('format_variance_relax_ref_inline', 'false')`).run().changes;
      db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (109)').run();
      console.log(`JS migration 109 applied: format-variance relax (ref INLINE / box-drift disagreement) seeded OFF (DARK, ${n} row)`);
    } catch (e) { console.warn(`  migration 109 (format_variance_relax_ref_inline): ${e.message}`); }
  }

  // ── migration 110: TEST-BUILD force-ON of format_variance_relax_ref_inline (2026-09-03; same pattern +
  //    caveat as mig 108). FORCE-flips (UPSERT) the box-drift disagreement suppression ON so the owner's
  //    test DB heals doc121 on reprocess. Exact-confirmed-literal + non-credible-rigid ONLY, so a wrong/
  //    never-confirmed read or a credible competing read is still HELD, never auto-filed. ⚠ TEST-ONLY /
  //    REVERSIBLE: revert (or gate) before ANY customer build and run the WARM-DB census (each clean-
  //    commit equals that document's OWN prior-confirmed value; realdoc M=0 + zero accuracy drop). ──
  if (!applied.has(110)) {
    try {
      db.prepare(`INSERT INTO settings (key, value) VALUES ('format_variance_relax_ref_inline', 'true')
                  ON CONFLICT(key) DO UPDATE SET value = 'true'`).run();
      db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (110)').run();
      console.log('JS migration 110 applied: TEST-BUILD force-ON format_variance_relax_ref_inline (revert + WARM-DB census before customer build)');
    } catch (e) { console.warn(`  migration 110 (format_variance_relax_ref_inline force-ON): ${e.message}`); }
  }

  // ── migration 111: filing_sanity_ref_corrob_soften seeded OFF (2026-09-03; reggie+gary → Oracle
  //    SIGN-OFF-W/COND, C1 review-bound). Gate C's "'X' doesn't appear on this page as written" note is
  //    FALSE + alarming when the reference is a corroborated (>=2 independent read families) EXACT confirmed
  //    literal whose only page disagreement is a same-length ONE-GLYPH full-page slip (not a clip) — the
  //    value IS on the page, the full-page OCR just misread a glyph (doc196: crop+mapping '752923124N3M2',
  //    full-page '782923124N3M2', 5<->8 unbacked so v2 can't heal). This arc swaps that note for a TRUTHFUL
  //    one naming both readings; it STAYS a validation_note, so the doc is REVIEW-BOUND (auto-file byte-
  //    identical — the mirror is HELD for a human, never silently filed). Separate kill switch from the
  //    variance-relax arcs. DARK; its OWN gate is OWED (RED-first mirror pin + realdoc M=0 + WARM-DB census
  //    scored against INDEPENDENT GT, prod flags asserted). ──
  if (!applied.has(111)) {
    try {
      const n = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('filing_sanity_ref_corrob_soften', 'false')`).run().changes;
      db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (111)').run();
      console.log(`JS migration 111 applied: filing_sanity_ref_corrob_soften (Gate-C truthful soft note) seeded OFF (DARK, ${n} row)`);
    } catch (e) { console.warn(`  migration 111 (filing_sanity_ref_corrob_soften): ${e.message}`); }
  }

  // ── migration 112: TEST-BUILD force-ON of filing_sanity_ref_corrob_soften (2026-09-03; same pattern +
  //    caveat as mig 108/110). FORCE-flips (UPSERT) the truthful-soft-note ON so the owner's test DB shows
  //    doc196 the honest note on reprocess. It only REWORDS a note the doc already carries (auto-file
  //    unchanged), so this is the safest of the three test force-ONs — but ⚠ TEST-ONLY / REVERSIBLE: revert
  //    (or gate) before ANY customer build and run its gate (RED-first mirror pin + realdoc M=0 + WARM-DB
  //    census against INDEPENDENT GT). Requires filing_value_sanity_flags ON to have any effect. ──
  if (!applied.has(112)) {
    try {
      db.prepare(`INSERT INTO settings (key, value) VALUES ('filing_sanity_ref_corrob_soften', 'true')
                  ON CONFLICT(key) DO UPDATE SET value = 'true'`).run();
      db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (112)').run();
      console.log('JS migration 112 applied: TEST-BUILD force-ON filing_sanity_ref_corrob_soften (revert + gate before customer build)');
    } catch (e) { console.warn(`  migration 112 (filing_sanity_ref_corrob_soften force-ON): ${e.message}`); }
  }

  // ── migration 113: resolve_ref_near_miss seeded OFF (2026-09-04; reggie+gary → Oracle SIGN-OFF-W/COND,
  //    v1 REVIEW-BOUND). Leg-b of the single-glyph reference resolver: when a reference read is one BACKED
  //    OCR-confusable character off EXACTLY ONE confirmed in-scope literal (unambiguous ball, len>=10),
  //    PRE-FILL that confirmed value instead of only suggesting it — but keep a dedicated note + a <=70
  //    confidence cap, so the doc stays REVIEW-BOUND (trust.js refuses auto-file on any note AND the cap
  //    holds it below the 88 critical floor). The ambiguous case (two confirmed serials one glyph apart,
  //    e.g. 752/782) and any unbacked slip REFUSE and fall through to the existing suggestion — doc196 is
  //    never touched. DARK; leg-a per-position majority + the re-slice witness + ANY auto-file are DEFERRED
  //    to a census-gated Phase 2 (constructed adversarial GT). ──
  if (!applied.has(113)) {
    try {
      const n = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('resolve_ref_near_miss', 'false')`).run().changes;
      db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (113)').run();
      console.log(`JS migration 113 applied: resolve_ref_near_miss (unambiguous confirmed-literal pre-fill) seeded OFF (DARK, ${n} row)`);
    } catch (e) { console.warn(`  migration 113 (resolve_ref_near_miss): ${e.message}`); }
  }

  // ── migration 114: TEST-BUILD force-ON of resolve_ref_near_miss (2026-09-04; same pattern + caveat as
  //    mig 108/110/112). FORCE-flips (UPSERT) leg-b ON so the owner's test DB pre-fills the confirmed
  //    reference on the unambiguous backed-slip case. It stays review-bound (note + <=70 cap), so it never
  //    silently files. ⚠ TEST-ONLY / REVERSIBLE: revert (or gate) before ANY customer build; and the leg-a
  //    / re-slice / auto-file relaxation needs its OWN constructed-adversarial census first. Requires
  //    format_variance_relax ON (this is the high-variance ref branch). ──
  if (!applied.has(114)) {
    try {
      db.prepare(`INSERT INTO settings (key, value) VALUES ('resolve_ref_near_miss', 'true')
                  ON CONFLICT(key) DO UPDATE SET value = 'true'`).run();
      db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (114)').run();
      console.log('JS migration 114 applied: TEST-BUILD force-ON resolve_ref_near_miss (revert + census before customer build)');
    } catch (e) { console.warn(`  migration 114 (resolve_ref_near_miss force-ON): ${e.message}`); }
  }

  // ── migration 115: resolve_ref_positional seeded OFF (2026-09-04; gary integration → Oracle Phase 2,
  //    REVIEW-BOUND). Leg-a of the single-glyph reference resolver: on a same-length one-position
  //    disagreement between a reference's distinct PIXEL sources, re-read the taught box under a DIFFERENT
  //    BINARISATION (Otsu/adaptive — an independent recipe; the engine has no higher-DPI render) and take
  //    a per-position majority across >=3 distinct pixel sources; PRE-FILL the consensus. Edits the value
  //    but keeps a dedicated <=70-capped note -> REVIEW-BOUND (never auto-files; the witnesses stay OUT of
  //    the corroboration record so it is byte-identical — Oracle Q3). DARK; auto-file is a separate
  //    census-gated step (constructed adversarial GT; the auto-file bar additionally needs >=2 distinct
  //    crop-rects + the unique-confirmed-literal exclusion — same-box binarisations are common-mode). ──
  if (!applied.has(115)) {
    try {
      const n = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('resolve_ref_positional', 'false')`).run().changes;
      db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (115)').run();
      console.log(`JS migration 115 applied: resolve_ref_positional (binarisation re-slice + positional consensus) seeded OFF (DARK, ${n} row)`);
    } catch (e) { console.warn(`  migration 115 (resolve_ref_positional): ${e.message}`); }
  }

  // ── migration 116: TEST-BUILD force-ON of resolve_ref_positional (2026-09-04; same pattern + caveat as
  //    mig 108/110/112/114). FORCE-flips (UPSERT) leg-a ON so the owner's test DB pre-fills the pixel
  //    consensus on a disagreeing reference. Review-bound (note + <=70 cap), never silently files. Requires
  //    format_variance_relax ON (high-variance ref branch). ⚠ TEST-ONLY / REVERSIBLE: revert (or gate)
  //    before ANY customer build; auto-file relaxation needs its own constructed-adversarial census. ──
  if (!applied.has(116)) {
    try {
      db.prepare(`INSERT INTO settings (key, value) VALUES ('resolve_ref_positional', 'true')
                  ON CONFLICT(key) DO UPDATE SET value = 'true'`).run();
      db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (116)').run();
      console.log('JS migration 116 applied: TEST-BUILD force-ON resolve_ref_positional (revert + census before customer build)');
    } catch (e) { console.warn(`  migration 116 (resolve_ref_positional force-ON): ${e.message}`); }
  }

  // ── migration 117: filing_sanity_ref_history_soften seeded OFF (2026-09-04; Oracle SIGN-OFF-W/COND).
  //    Extends the mig-111 soften to the HISTORY path: when the live soften can't fire (no >=2 live page
  //    families agree — the correct value came from a +corrected adopt) but the committed reference is an
  //    EXACT confirmed literal whose ONLY page form is a BACKED one-glyph confusable (O<->0, S<->5…), that
  //    form is not itself confirmed, and the literal is the UNIQUE confirmed value one backed-glyph from it
  //    (C1 unambiguity), swap the scary "doesn't appear on this page" note for the truthful soft one.
  //    Auto-file-NEUTRAL (a note either way -> review-bound); note-text-only. Separate kill switch. ──
  if (!applied.has(117)) {
    try {
      const n = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('filing_sanity_ref_history_soften', 'false')`).run().changes;
      db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (117)').run();
      console.log(`JS migration 117 applied: filing_sanity_ref_history_soften (Gate-C soft note on confirmed-literal + backed page slip) seeded OFF (DARK, ${n} row)`);
    } catch (e) { console.warn(`  migration 117 (filing_sanity_ref_history_soften): ${e.message}`); }
  }

  // ── migration 118: TEST-BUILD force-ON of filing_sanity_ref_history_soften (2026-09-04; same pattern +
  //    caveat as mig 108/…/116). FORCE-flips (UPSERT) the history soften ON so the owner's test DB shows
  //    doc238 (RFH0738865 vs page RFHO738865) the honest note. Note-text-only, review-bound — never files.
  //    Requires filing_value_sanity_flags ON. ⚠ TEST-ONLY / REVERSIBLE: revert (or gate) before ANY
  //    customer build; run its WARM-DB census (softened value == the on-page-labelled value, 0 new
  //    auto-files) + realdoc M=0. ──
  if (!applied.has(118)) {
    try {
      db.prepare(`INSERT INTO settings (key, value) VALUES ('filing_sanity_ref_history_soften', 'true')
                  ON CONFLICT(key) DO UPDATE SET value = 'true'`).run();
      db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (118)').run();
      console.log('JS migration 118 applied: TEST-BUILD force-ON filing_sanity_ref_history_soften (revert + census before customer build)');
    } catch (e) { console.warn(`  migration 118 (filing_sanity_ref_history_soften force-ON): ${e.message}`); }
  }

  // ── migration 119: confusion_precedence seeded OFF (2026-09-04; reggie+gary → Oracle SIGN-OFF-W/COND A1-A4).
  //    CONFUSION PRECEDENCE 2a: mine this sender's own HUMAN `corrections` into per-scope OCR-confusion facts
  //    ("at position 3 of a 10-char serial, 'O' was corrected to '0' on >=3 documents / >=2 distinct values, no
  //    counter-correction") and correct a NEVER-SEEN serial toward the human-attested form — REVIEW-BOUND
  //    (<=70 cap + a both-forms note + corrected_to; never auto-files; the HIGH auto-file tier is a separate
  //    census-gated design). Supplier-scoped facts only; an accepted pre-fill writes NO corrections row (A4), a
  //    human counter-edit is the self-heal. DARK: seed OFF, byte-identical until flipped. ──
  if (!applied.has(119)) {
    try {
      const n = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('confusion_precedence', 'false')`).run().changes;
      db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (119)').run();
      console.log(`JS migration 119 applied: confusion_precedence (2a review-bound human-confusion correction) seeded OFF (DARK, ${n} row)`);
    } catch (e) { console.warn(`  migration 119 (confusion_precedence): ${e.message}`); }
  }


  // …and the SAME heal UNCONDITIONALLY at every start (Oracle C1, the document_routes pattern below): a
  // road the stamped migration cannot see — a verbatim row copy (`scripts/seed-taught-state.js`), hand
  // SQL, a restore on a fixture without the hook — must not leave a role at required=0 until the next
  // migration. One UPDATE, no-op when nothing needs healing; logs only when it changed something.
  try {
    const nh = require('./modules/document_types').assertStructuralRequired(db) || 0;
    if (nh > 0) console.log(`  structural roles: ${nh} role field(s) re-asserted required at startup`);
  } catch (e) { console.warn(`  structural roles startup heal: ${e.message}`); }

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

  // Stamping (Workflow+Stamping redesign 2026-08-28 — docs/designs/WORKFLOW_STAMPING_REDESIGN_2026-08-28.md).
  // DARK spine (slice 0): tables only; no live path reads them yet, so OFF == byte-identical. Same
  // unconditional/idempotent ensure pattern as document_routes/route_decisions above (NOT version-stamped —
  // a worktree-shared DB stamped past this version would otherwise skip creation). stamp_events is the
  // APPEND-ONLY record-of-truth for an immutable, attributable stamp; its tamper anchor is a cross-linked
  // audit_log row (audit_ref), NOT an internal chain (Oracle: the self-chain is over-built). stamp_types is
  // the mutable catalog; a placed stamp SNAPSHOTS its label/colour so a later rename/delete can't rewrite
  // history (same principle as workflow.summarizeRule).
  if (!tableExists(db, 'stamp_types')) {
    db.exec(`CREATE TABLE stamp_types (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      key        TEXT NOT NULL UNIQUE,          -- stable machine key ('paid')
      label      TEXT NOT NULL,                 -- display word ('PAID')
      color      TEXT NOT NULL,                 -- hex ('#2E7D32')
      category   TEXT,                          -- optional group ('Payment')
      built_in   INTEGER NOT NULL DEFAULT 0,
      active     INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER,                       -- user id (NO FK by design)
      created_at TEXT
    )`);
    const insStampType = db.prepare(`INSERT INTO stamp_types (key,label,color,category,built_in,active,created_at)
                                     VALUES (@key,@label,@color,@category,1,1,datetime('now'))`);
    // The 6 shipped defaults (barry's set). Colour language: green=done/positive, red=stop/negative,
    // amber=pending, blue=process/info. The rest arrive via "Add from catalog…" (slice 3).
    for (const t of [
      { key: 'paid',     label: 'PAID',     color: '#2E7D32', category: 'Payment'  },
      { key: 'approved', label: 'APPROVED', color: '#2E7D32', category: 'Decision' },
      { key: 'rejected', label: 'REJECTED', color: '#C62828', category: 'Decision' },
      { key: 'received', label: 'RECEIVED', color: '#1565C0', category: 'Delivery' },
      { key: 'on_hold',  label: 'ON HOLD',  color: '#B07816', category: 'Status'   },
      { key: 'void',     label: 'VOID',     color: '#C62828', category: 'Status'   },
    ]) insStampType.run(t);
    console.log('Stamp schema: created stamp_types (+6 defaults)');
  }
  if (!tableExists(db, 'stamp_events')) {
    db.exec(`CREATE TABLE stamp_events (
      id                          INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id                 INTEGER,      -- denormalised (survives the doc/route delete cascade)
      stamp_type_id               INTEGER,      -- soft-ref to stamp_types.id (NO FK)
      type_key_snapshot           TEXT,         -- snapshot: a later rename/delete can't rewrite history
      type_label_snapshot         TEXT,
      type_color_snapshot         TEXT,
      placed_by_user_id           INTEGER,
      placed_by_username_snapshot TEXT,
      placed_at                   TEXT,
      placement_json              TEXT,         -- {x,y,w,page} normalised, top-left origin
      note                        TEXT,
      source_sha256               TEXT,         -- hash of the file stamped (detects out-of-band byte edits)
      artifact_path               TEXT,         -- app-managed, doc-id-keyed (slice 1; NOT a filing sidecar)
      artifact_sha256             TEXT,
      route_id                    INTEGER,      -- set for an approve/reject-derived stamp; else NULL
      content_sha256              TEXT,         -- hash of the canonical record; anchored by the audit row
      audit_ref                   TEXT,         -- row_hmac of the cross-linked audit_log row (tamper anchor)
      created_at                  TEXT
    )`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_stamp_events_doc   ON stamp_events(document_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_stamp_events_route ON stamp_events(route_id)`);
    // Append-only STRUCTURAL (mirrors route_decisions): a row-level UPDATE/DELETE is blocked; a whole-table
    // DROP+recreate is still DDL and this ensure-block rebuilds the triggers afterwards.
    db.exec(`CREATE TRIGGER IF NOT EXISTS stamp_events_noupd BEFORE UPDATE ON stamp_events
             BEGIN SELECT RAISE(ABORT, 'stamp_events is append-only'); END`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS stamp_events_nodel BEFORE DELETE ON stamp_events
             BEGIN SELECT RAISE(ABORT, 'stamp_events is append-only'); END`);
    console.log('Stamp schema: created stamp_events (append-only)');
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
  // Corroboration record (owner principle 2026-08-11: "the rungs should corroborate, not merely
  // compete"). JSON {winner_family, agree[], disagree[], independent_agree} — which independent
  // METHOD FAMILIES read the same value. Record-only; nothing gates on it yet by design.
  safeAdd('extractions', 'corroboration', 'TEXT');
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

module.exports = { open, runMigrations, setEncryptionKey, isEncryptionActive };
