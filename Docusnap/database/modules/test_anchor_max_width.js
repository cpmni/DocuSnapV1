#!/usr/bin/env node
'use strict';
/**
 * database/modules/test_anchor_max_width.js
 * -----------------------------------------
 * Box-width learning — SLICE 1 (the learning/schema half; the Python crop reader is a
 * separate DARK slice). field_anchors.max_w_norm is the MONOTONIC high-water crop width for a
 * taught field: a ⊕ teach stores its drawn width in w_norm, but w_norm is not monotonic (an
 * authoritative re-teach REPLACES it; the passive within-spot path BLENDS toward narrower
 * samples), so a short teach ("Tesco") then a longer value ("Billies Hardware Store") truncates
 * the long value. max_w_norm records the widest width ever drawn so the crop can later extend to
 * it. This pins that max_w_norm NEVER shrinks across every write path (Oracle SIGN-OFF-WITH-
 * CONDITIONS 2026-07-21), including the accepted trade-off (a narrow re-teach does NOT shrink it),
 * and that delete+re-teach is the explicit reset.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_anchor_max_width.js
 */
const Database = require('better-sqlite3');
const learning = require('./learning');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

// Production-shape field_anchors incl. max_w_norm (mirrors migration 6 + 21 + 52).
function makeDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE field_anchors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_name TEXT, document_type TEXT, field_key TEXT,
    anchor_label TEXT, direction TEXT, page_zone TEXT,
    x_norm REAL, y_norm REAL, w_norm REAL DEFAULT 0, h_norm REAL DEFAULT 0,
    max_w_norm REAL NOT NULL DEFAULT 0,
    usage_count INTEGER DEFAULT 1, confidence REAL DEFAULT 0.6,
    last_seen TEXT DEFAULT (datetime('now')), last_authoritative_at TEXT,
    offset_dx_norm REAL, offset_dy_norm REAL
  );`);
  return db;
}
const SCOPE = { supplier_name: 'Larkspur Interiors', document_type: 'purchase_order', field_key: 'customer_name',
                anchor_label: 'Deliver To', direction: 'below', page_zone: 'mid',
                offset_dx_norm: 0.1, offset_dy_norm: 0.02 };
const teach = (db, w, authoritative) => learning.saveAnchor(db, {
  ...SCOPE, x_norm: 0.3, y_norm: 0.3, w_norm: w, h_norm: 0.02, authoritative });
const row = (db) => db.prepare("SELECT w_norm, max_w_norm FROM field_anchors WHERE field_key='customer_name'").get();

(function main() {
  // ── Authoritative path ──────────────────────────────────────────────────────
  let db = makeDb();
  teach(db, 0.10, true);                     // first teach: a NARROW box ("Tesco")
  check('auth first teach: max_w_norm == the drawn width', row(db).max_w_norm === 0.10);

  teach(db, 0.30, true);                      // re-teach WIDER ("Billies Hardware Store")
  check('auth wider re-teach: max_w_norm rises to the wider width', row(db).max_w_norm === 0.30);
  check('auth wider re-teach: w_norm follows the new draw (0.30)', row(db).w_norm === 0.30);

  teach(db, 0.08, true);                      // re-teach NARROW again (correcting position on a short value)
  check('THE FIX (accepted trade-off): a NARROW auth re-teach does NOT shrink max_w_norm', row(db).max_w_norm === 0.30);
  check('w_norm still follows the narrow draw (0.08) — only max_w_norm is monotonic', row(db).w_norm === 0.08);

  // Explicit reset: delete + re-teach starts the high-water fresh.
  const id = db.prepare("SELECT id FROM field_anchors WHERE field_key='customer_name'").get().id;
  learning.deleteAnchor(db, id);
  teach(db, 0.12, true);
  check('delete + re-teach RESETS the high-water (fresh INSERT) — the documented recovery', row(db).max_w_norm === 0.12);

  db.close();

  // ── Passive path (auto-learned, no ⊕) ───────────────────────────────────────
  db = makeDb();
  teach(db, 0.28, false);                     // passive new insert
  check('passive new insert: max_w_norm == drawn width', row(db).max_w_norm === 0.28);

  // A passive sample at the SAME spot but NARROWER: w_norm blends down, max must hold.
  teach(db, 0.12, false);
  const r = row(db);
  check('passive within-spot: w_norm may blend toward the narrower sample', r.w_norm < 0.28);
  check('passive within-spot: max_w_norm holds the high-water (binds the RAW drawn width, not the blend)', r.max_w_norm === 0.28);
  db.close();

  // ── Migration-52 backfill SQL (legacy rows get max_w_norm = w_norm) ──────────
  db = new Database(':memory:');
  db.exec(`CREATE TABLE field_anchors (id INTEGER PRIMARY KEY AUTOINCREMENT, field_key TEXT, w_norm REAL);`);
  db.prepare("INSERT INTO field_anchors (field_key, w_norm) VALUES ('customer_name', 0.22)").run();
  db.exec('ALTER TABLE field_anchors ADD COLUMN max_w_norm REAL NOT NULL DEFAULT 0');   // mig 52, step 1
  db.exec('UPDATE field_anchors SET max_w_norm = w_norm');                              // mig 52, backfill
  check('mig-52 backfill: a legacy row gets max_w_norm == its current w_norm (byte-identical until re-taught)',
    db.prepare("SELECT max_w_norm FROM field_anchors").get().max_w_norm === 0.22);
  db.close();

  console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}`);
  process.exit(fails ? 1 : 0);
})();
