#!/usr/bin/env node
'use strict';
// saveAnchor must not persist a PHANTOM label synthesised from the field's DISPLAY
// LABEL (Fix B, Oracle-signed 2026-07-10). Migration 38 renamed the identity display
// to "Document Issuer" while the KEYS stayed supplier_name/customer_name, so the
// existing field-KEY phantom check never caught it — "Document Issuer" anchors reached
// the DB and the anchor engine silently dropped their reads on every doc (the "my
// issuer teach never sticks" loop, doc 1878). A label OCR'd FROM THE PAGE
// (label_detected) that merely equals the display label is a REAL caption and is KEPT.
// Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_anchor_phantom_display_label.js

const Database = require('better-sqlite3');
const { runMigrations } = require('../index');
const doctypes = require('./document_types');
const learning = require('./learning');

let fails = 0;
const check = (l, c) => { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}`); if (!c) fails++; };

const db = new Database(':memory:');
runMigrations(db);
doctypes.seedBuiltInTypes(db);   // supplier_name carries the "Document Issuer" display label
// (2026-07-10: migration 44 made customer_name an ordinary "Customer"-labelled recipient
// field, so the display-label phantom premise moved from customer_name to supplier_name —
// the mechanism under test is unchanged.)

const anchorRow = (field) => db.prepare(
  'SELECT anchor_label, offset_dx_norm, offset_dy_norm FROM field_anchors WHERE field_key = ? ORDER BY id DESC LIMIT 1'
).get(field);
const base = {
  supplier_name: 'Bramble & Finch Ltd', document_type: 'sales_order',
  direction: 'below', page_zone: 'top', x_norm: 0.85, y_norm: 0.05, w_norm: 0.2, h_norm: 0.02,
  authoritative: true, offset_dx_norm: 0.1, offset_dy_norm: 0.02,
};

// 1. THE BUG: a synthesised "Document Issuer" label (label_detected false) must be
//    stored as '' (position-only) with the label-relative offsets cleared.
learning.saveAnchor(db, { ...base, field_key: 'supplier_name', anchor_label: 'Document Issuer', label_detected: false });
let r = anchorRow('supplier_name');
check("synthesised display label 'Document Issuer' -> stored '' (position-only)", r && r.anchor_label === '');
check('... label-relative offsets cleared', r && r.offset_dx_norm === null && r.offset_dy_norm === null);

// 2. A caption OCR'd FROM THE PAGE that happens to equal the display label is REAL — kept.
learning.saveAnchor(db, { ...base, field_key: 'supplier_name', direction: 'right', anchor_label: 'Document Issuer', label_detected: true });
r = db.prepare("SELECT anchor_label FROM field_anchors WHERE field_key='supplier_name' AND direction='right'").get();
check('label_detected=true identical caption -> KEPT (a real printed caption)', r && r.anchor_label === 'Document Issuer');

// 2b. MIRROR-TWIN PIN (reggie, 2026-07-10): a '#'-bearing short caption ("SO #") must
//     survive saveAnchor UNCHANGED with its drift offsets INTACT. If learning.js's
//     sanitizeAnchorLabel ever diverges from the shared anchorLabel.js copy (e.g. one
//     re-strips the '#'), the `_clean !== anchor_label` branch fires and NULLS the
//     offsets — this check is the tripwire for that seam.
learning.saveAnchor(db, { ...base, field_key: 'sales_order_number', direction: 'right',
                          anchor_label: 'SO #', label_detected: true });
r = anchorRow('sales_order_number');
check("'SO #' caption stored verbatim (# kept)", r && r.anchor_label === 'SO #');
check("... drift offsets PRESERVED (twin sanitizers agree)",
      r && r.offset_dx_norm === 0.1 && r.offset_dy_norm === 0.02);

// 3. The original field-KEY phantom check still works alongside.
learning.saveAnchor(db, { ...base, field_key: 'order_date', anchor_label: 'Order Date', label_detected: false });
r = anchorRow('order_date');
check("field-labelled synthesised caption ('Order Date' for order_date) -> stored ''", r && r.anchor_label === '');

// 4. A genuinely different printed caption is untouched.
learning.saveAnchor(db, { ...base, field_key: 'sales_order_number', anchor_label: 'SO No.', label_detected: false });
r = anchorRow('sales_order_number');
check("real caption ('SO No.') untouched", r && r.anchor_label === 'SO No.');

// 5. Minimal DBs without the fields tables must not crash (lookup is best-effort).
const bare = new Database(':memory:');
bare.exec(`CREATE TABLE field_anchors (
  id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_name TEXT, document_type TEXT, field_key TEXT NOT NULL,
  anchor_label TEXT NOT NULL, direction TEXT NOT NULL, page_zone TEXT NOT NULL, x_norm REAL, y_norm REAL,
  usage_count INTEGER NOT NULL DEFAULT 1, confidence REAL NOT NULL DEFAULT 1.0,
  last_seen TEXT NOT NULL DEFAULT (datetime('now')), last_authoritative_at TEXT,
  offset_dx_norm REAL, offset_dy_norm REAL, w_norm REAL NOT NULL DEFAULT 0, h_norm REAL NOT NULL DEFAULT 0,
  UNIQUE(supplier_name, document_type, field_key, anchor_label, direction))`);
let ok = true;
try { learning.saveAnchor(bare, { ...base, field_key: 'customer_name', anchor_label: 'Some Caption', label_detected: false }); }
catch { ok = false; }
check('fields-less fixture DB: saveAnchor still succeeds (lookup best-effort)', ok
      && bare.prepare('SELECT COUNT(*) n FROM field_anchors').get().n === 1);
bare.close();
db.close();

console.log(fails ? `\n${fails} FAILED` : '\nAll phantom-display-label checks passed.');
process.exit(fails ? 1 : 0);
