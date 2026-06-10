#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_supplier_identity_persistence.js
 * ------------------------------------------------------
 * Focused test for the supplier-identity persistence guard in
 * database/modules/learning.js (saveCorrections + isPlausibleSupplierName).
 *
 * Verifies that a PASSED-THROUGH, un-corrected supplier name that is an
 * implausible short fragment ("IN") is NOT written back as a reusable
 * supplier_name hint (the row engine.py's Stage 2.5a text-scan reads to
 * re-identify suppliers — persisting it re-poisons future runs), while a
 * plausible passed-through name persists normally AND an explicit user
 * correction persists even when short ("unless uniquely supported").
 *
 * Scoped to supplier identity only: other fields' hints are unaffected.
 *
 * Why Electron-as-Node: better-sqlite3 here is a native addon rebuilt against
 * Electron's bundled Node ABI (see test_templates.js).
 *
 * Usage (from the project root):
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_supplier_identity_persistence.js
 *
 * Exit code 0 = behaves as expected. Exit code 1 = regression.
 */

const Database = require('better-sqlite3');
const learning = require('./learning');

function check(label, condition) {
  console.log(`  ${condition ? 'OK ' : 'BAD'} ${label}`);
  return condition;
}
function section(title) { console.log(`\n${title}`); }

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE corrections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER, field_key TEXT,
      original_value TEXT, corrected_value TEXT,
      supplier_name TEXT, document_type TEXT,
      corrected_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE supplier_hints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_name TEXT, document_type TEXT, field_key TEXT, hint_value TEXT,
      usage_count INTEGER DEFAULT 1, last_seen TEXT,
      UNIQUE(supplier_name, document_type, field_key, hint_value)
    );
    CREATE TABLE field_anchors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_name TEXT, document_type TEXT, field_key TEXT,
      anchor_label TEXT, direction TEXT, page_zone TEXT,
      x_norm REAL, y_norm REAL, w_norm REAL, h_norm REAL,
      usage_count INTEGER DEFAULT 1, confidence REAL, last_seen TEXT
    );
  `);
  return db;
}

function supplierHint(db, value) {
  return db.prepare(
    `SELECT * FROM supplier_hints WHERE field_key = 'supplier_name' AND hint_value = ?`
  ).get(value);
}

function main() {
  let failures = 0;

  // ── 1: implausible passed-through identity is NOT persisted ──────────────
  section('a passed-through, un-corrected implausible "IN" supplier_name is not written as a reusable identity hint');
  let db = freshDb();
  learning.saveCorrections(
    db, 1, /* corrections */ {},
    /* supplier_name */ 'IN', /* document_type */ 'Invoice',
    /* allValues */ { supplier_name: 'IN', invoice_number: 'INV-1' },
  );
  if (!check('no supplier_name hint with value "IN" was persisted', !supplierHint(db, 'IN'))) failures++;
  if (!check('an unrelated field (invoice_number) still learned normally — guard is scoped to supplier identity',
             !!db.prepare(`SELECT 1 FROM supplier_hints WHERE field_key='invoice_number' AND hint_value='INV-1'`).get())) failures++;
  db.close();

  // ── 2: plausible passed-through identity IS persisted ────────────────────
  section('a passed-through plausible "SuperStore" supplier_name persists normally');
  db = freshDb();
  learning.saveCorrections(
    db, 2, {},
    'SuperStore', 'Invoice',
    { supplier_name: 'SuperStore', invoice_number: 'INV-2' },
  );
  if (!check('supplier_name hint "SuperStore" was persisted', !!supplierHint(db, 'SuperStore'))) failures++;
  db.close();

  // ── 3: an explicit user correction persists even when short ─────────────
  // "unless uniquely supported" — the user actively typed it, so it is trusted
  // even though its shape would be flagged implausible. Preserves legitimate
  // short brands the user confirms by correcting.
  section('an explicit user correction to a short name still persists (the corrections path is never blocked)');
  db = freshDb();
  learning.saveCorrections(
    db, 3, /* corrections */ { supplier_name: { original_value: 'IN', corrected_value: 'GE' } },
    'IN', 'Invoice',
    { supplier_name: 'GE', invoice_number: 'INV-3' },
  );
  if (!check('explicitly-corrected short supplier_name "GE" was persisted', !!supplierHint(db, 'GE'))) failures++;
  db.close();

  // ── 4: the helper itself ────────────────────────────────────────────────
  section('isPlausibleSupplierName helper: rejects short fragments, accepts real names');
  const f = learning.isPlausibleSupplierName;
  for (const bad of ['IN', 'INV', 'PO', '', '   ', null]) {
    if (!check(`${JSON.stringify(bad)} rejected`, !f(bad))) failures++;
  }
  for (const good of ['SuperStore', 'ACME LIMITED', 'Polychemtex Inc.', 'INV-2024']) {
    if (!check(`${JSON.stringify(good)} accepted`, f(good))) failures++;
  }

  // ── 5: supplier-name normalisation unifies the learning corpus ───────────
  section('normalizeSupplierName collapses edge quote noise so corrections key to ONE bucket');
  const n = learning.normalizeSupplierName;
  if (!check('smart-quote "‘Cloud VPS" normalises to "Cloud VPS"', n('‘Cloud VPS') === 'Cloud VPS')) failures++;
  if (!check('replacement-char "�Cloud VPS" normalises to "Cloud VPS"', n('�Cloud VPS') === 'Cloud VPS')) failures++;
  if (!check('trailing "." preserved ("Polychemtex Inc.")', n('Polychemtex Inc.') === 'Polychemtex Inc.')) failures++;
  // A correction confirmed under the smart-quote spelling must persist under the
  // canonical key, so it merges with the rest of the supplier's corpus.
  db = freshDb();
  learning.saveCorrections(
    db, 5, { invoice_number: { original_value: 'x', corrected_value: 'INV-9' } },
    '‘Cloud VPS', 'Invoice', { supplier_name: '‘Cloud VPS', invoice_number: 'INV-9' });
  const keyed = db.prepare(`SELECT DISTINCT supplier_name FROM supplier_hints`).all().map(r => r.supplier_name);
  if (!check(`hints keyed under canonical "Cloud VPS" (got ${JSON.stringify(keyed)})`,
             keyed.includes('Cloud VPS') && !keyed.includes('‘Cloud VPS'))) failures++;
  db.close();
  console.log();
  if (failures) {
    console.log(`${failures} check(s) failed — supplier identity persistence guard regressed.`);
    return 1;
  }
  console.log('All checks passed — implausible passed-through supplier identities are no longer persisted,');
  console.log('while plausible names and explicit user corrections are preserved.');
  return 0;
}

process.exit(main());
