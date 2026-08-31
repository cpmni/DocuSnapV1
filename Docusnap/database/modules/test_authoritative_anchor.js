#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_authoritative_anchor.js
 * ----------------------------------------------
 * Verifies saveAnchor's authoritative re-teach (Option C) and the component-wise
 * passive tolerance fix.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_authoritative_anchor.js
 *   (or: node database/modules/test_authoritative_anchor.js, if better-sqlite3 ABI matches)
 */

const Database = require('better-sqlite3');
const learning = require('./learning');

function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); return cond; }

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE field_anchors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_name TEXT, document_type TEXT, field_key TEXT NOT NULL,
      anchor_label TEXT NOT NULL, direction TEXT NOT NULL,
      page_zone TEXT NOT NULL, x_norm REAL, y_norm REAL,
      w_norm REAL NOT NULL DEFAULT 0, h_norm REAL NOT NULL DEFAULT 0,
      max_w_norm REAL NOT NULL DEFAULT 0,
      usage_count INTEGER NOT NULL DEFAULT 1,
      confidence REAL NOT NULL DEFAULT 1.0,
      last_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_authoritative_at TEXT,
      offset_dx_norm REAL,
      offset_dy_norm REAL,
      UNIQUE(supplier_name, document_type, field_key, anchor_label, direction)
    );
  `);
  return db;
}

let fail = 0;

// ── 1. Authoritative re-teach overrides a stale, high-usage anchor ────────────
{
  const db = freshDb();
  // Stale wrong anchor: y=0.1985 (the bug — a line above the date), high usage,
  // a DIFFERENT auto-derived label than the re-teach will produce.
  db.prepare(`INSERT INTO field_anchors
    (supplier_name, document_type, field_key, anchor_label, direction,
     page_zone, x_norm, y_norm, w_norm, h_norm, usage_count, confidence)
    VALUES ('ds','worksheet','date','Ticket Category','right','top',0.243,0.1985,0.10,0.024,12,1.0)`).run();

  // Operator redraws the date a line lower (y=0.206), label OCR reads "Date".
  learning.saveAnchor(db, {
    supplier_name: 'ds', document_type: 'worksheet', field_key: 'date',
    anchor_label: 'Date', direction: 'right', page_zone: 'top',
    x_norm: 0.236, y_norm: 0.206, w_norm: 0.096, h_norm: 0.023,
    authoritative: true,
  });

  const rows = db.prepare(`SELECT * FROM field_anchors WHERE field_key='date'`).all();
  fail += !check('authoritative teach collapses to a SINGLE row for the field', rows.length === 1);
  const r = rows[0];
  fail += !check('the surviving anchor is the freshly-drawn one (y≈0.206, not 0.1985)',
    Math.abs(r.y_norm - 0.206) < 1e-6);
  fail += !check('coords overwritten outright (no blend toward the stale 0.1985)',
    Math.abs(r.x_norm - 0.236) < 1e-6);
  fail += !check('last_authoritative_at stamped', !!r.last_authoritative_at);
  db.close();
}

// ── 1b. Authoritative teach supersedes a stale anchor under a DIFFERENT ───────
//        supplier scope (the resolved-supplier collision that broke re-teach).
{
  const db = freshDb();
  // Stale wrong date anchor saved last session under a REAL supplier the
  // template/logo resolves to — supplier-exact, so it out-ranked a blank teach.
  db.prepare(`INSERT INTO field_anchors
    (supplier_name, document_type, field_key, anchor_label, direction,
     page_zone, x_norm, y_norm, w_norm, h_norm, usage_count, confidence)
    VALUES ('document solutions','wsd','date','Ticket Category','right','top',0.243,0.1985,0.10,0.024,18,1.0)`).run();

  // Operator re-teaches with supplier left blank (doc-agnostic).
  learning.saveAnchor(db, {
    supplier_name: null, document_type: 'wsd', field_key: 'date',
    anchor_label: 'Date', direction: 'right', page_zone: 'top',
    x_norm: 0.236, y_norm: 0.206, w_norm: 0.096, h_norm: 0.023,
    authoritative: true,
  });

  const rows = db.prepare(`SELECT * FROM field_anchors WHERE field_key='date'`).all();
  fail += !check('cross-supplier stale anchor is swept by an authoritative teach (single row)', rows.length === 1);
  fail += !check('surviving row is the taught one (y≈0.206)', Math.abs(rows[0].y_norm - 0.206) < 1e-6);
  db.close();
}

// ── 2. Re-teaching the SAME label/spot updates in place, stamps recency ───────
{
  const db = freshDb();
  const base = {
    supplier_name: 'ds', document_type: 'worksheet', field_key: 'date',
    anchor_label: 'Date', direction: 'right', page_zone: 'top',
    w_norm: 0.096, h_norm: 0.023, authoritative: true,
  };
  learning.saveAnchor(db, { ...base, x_norm: 0.236, y_norm: 0.206 });
  learning.saveAnchor(db, { ...base, x_norm: 0.240, y_norm: 0.210 }); // nudge, same label
  const rows = db.prepare(`SELECT * FROM field_anchors WHERE field_key='date'`).all();
  fail += !check('same-label authoritative re-teach stays ONE row', rows.length === 1);
  fail += !check('re-teach snaps to the latest drawn coords (0.210, no averaging)',
    Math.abs(rows[0].y_norm - 0.210) < 1e-6);
  fail += !check('usage_count incremented (history not discarded)', rows[0].usage_count >= 2);
  db.close();
}

// ── 3. Passive path: a one-line vertical move is a CORRECTION, not a blend ─────
{
  const db = freshDb();
  // Established passive anchor: wide+short value box, high usage. y=0.20.
  db.prepare(`INSERT INTO field_anchors
    (supplier_name, document_type, field_key, anchor_label, direction,
     page_zone, x_norm, y_norm, w_norm, h_norm, usage_count, confidence)
    VALUES ('ds','worksheet','date','Date','right','top',0.25,0.20,0.12,0.020,20,1.0)`).run();

  // PASSIVE re-learn (authoritative omitted) a line lower: dy=0.025 > tolY(h/2=0.01)
  // but dx=0 — old behaviour (max(w,h)/2 = 0.06 radial) would have BLENDED it away.
  learning.saveAnchor(db, {
    supplier_name: 'ds', document_type: 'worksheet', field_key: 'date',
    anchor_label: 'Date', direction: 'right', page_zone: 'top',
    x_norm: 0.25, y_norm: 0.225, w_norm: 0.12, h_norm: 0.020,
    // "Date" is a REAL detected on-page caption — it equals the field key but must be
    // KEPT (label_detected), else the field-name guard nulls it and a 2nd anchor row is
    // inserted instead of updating, so the passive tolerance path never runs.
    label_detected: true,
  });
  const r = db.prepare(`SELECT * FROM field_anchors WHERE field_key='date'`).get();
  fail += !check('component-wise tolerance treats a one-line vertical move as a correction (snaps to 0.225)',
    Math.abs(r.y_norm - 0.225) < 1e-6);
  db.close();
}

// ── 4. Passive path: true jitter within both axes still blends (stability) ────
{
  const db = freshDb();
  db.prepare(`INSERT INTO field_anchors
    (supplier_name, document_type, field_key, anchor_label, direction,
     page_zone, x_norm, y_norm, w_norm, h_norm, usage_count, confidence)
    VALUES ('ds','worksheet','ref','Ref','right','top',0.25,0.20,0.12,0.030,9,1.0)`).run();
  // tiny jitter: dx=0.002 (< 0.06), dy=0.003 (< 0.015) -> within spot -> blend
  learning.saveAnchor(db, {
    supplier_name: 'ds', document_type: 'worksheet', field_key: 'ref',
    anchor_label: 'Ref', direction: 'right', page_zone: 'top',
    x_norm: 0.252, y_norm: 0.203, w_norm: 0.12, h_norm: 0.030,
    label_detected: true,   // real detected caption "Ref" (== field key) — keep it
  });
  const r = db.prepare(`SELECT * FROM field_anchors WHERE field_key='ref'`).get();
  const blended = (0.20 * 9 + 0.203) / 10; // 0.2003
  fail += !check('small jitter still usage-weight-blends (anchor stays stable)',
    Math.abs(r.y_norm - blended) < 1e-6);
  db.close();
}

console.log(fail ? `\n${fail} FAILED` : '\nAll authoritative-anchor checks passed');
process.exit(fail ? 1 : 0);
