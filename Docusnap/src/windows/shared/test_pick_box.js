'use strict';
/*
 * test_pick_box.js — the disambiguation picker's CONVENTION pin (Oracle G2, the one
 * silent-learning-corruption risk). The candidate box is TOP-LEFT; field_anchors stores CENTRE.
 * pickBoxToAnchorCentre must convert exactly once. If a future dev flips the emit to CENTRE (and the
 * renderer keeps adding w/2), OR drops the conversion, every picked anchor shifts by half a box — this
 * test fails. Also round-trips through the REAL learning.saveAnchor to prove the stored row is CENTRE.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron src/windows/shared/test_pick_box.js
 */
const path = require('path');
const Database = require('better-sqlite3');
const REPO = 'c:/GIT Projects/Docusnap';
const PickBox = require(path.join(REPO, 'src', 'windows', 'shared', 'pickBox.js'));
const { runMigrations } = require(path.join(REPO, 'database', 'index.js'));
const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));

let fails = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'BAD ') + label); if (!cond) fails++; };
const approx = (a, b) => Math.abs(a - b) < 1e-9;

// TOP-LEFT box → CENTRE: x=0.10,w=0.30 → cx=0.25 ; y=0.20,h=0.05 → cy=0.225
const BOX = { x_norm: 0.10, y_norm: 0.20, w_norm: 0.30, h_norm: 0.05 };
const c = PickBox.pickBoxToAnchorCentre(BOX);
check('top-left → centre x (0.10 + 0.30/2 = 0.25)', approx(c.x_norm, 0.25));
check('top-left → centre y (0.20 + 0.05/2 = 0.225)', approx(c.y_norm, 0.225));
check('w/h preserved', approx(c.w_norm, 0.30) && approx(c.h_norm, 0.05));
check('centre is OFF the top-left by exactly w/2 (flip-detection)', approx(c.x_norm - BOX.x_norm, BOX.w_norm / 2));
check('pure / frame-independent: same result on a second call', approx(PickBox.pickBoxToAnchorCentre(BOX).x_norm, c.x_norm));
check('bad/empty box → null', PickBox.pickBoxToAnchorCentre(null) === null
  && PickBox.pickBoxToAnchorCentre({ x_norm: 0, y_norm: 0, w_norm: 0, h_norm: 0 }) === null);

// ── Round-trip through the REAL store: saveAnchor must persist the CENTRE ──────
const db = new Database(':memory:');
runMigrations(db);
const dt = db.prepare("INSERT INTO document_types (name, slug) VALUES ('Sales Order','sales_order')").run();
db.prepare("INSERT INTO fields (document_type_id, key, label, type) VALUES (?, 'customer_name', 'Customer', 'text')").run(dt.lastInsertRowid);

// build the anchor exactly as resolveCandidatePick does, then save it
learning.saveAnchor(db, {
  supplier_name: 'Northgate Textiles',
  document_type: 'sales_order',
  field_key: 'customer_name',
  anchor_label: '',           // position-only sentinel
  direction: 'right',
  page_zone: c.y_norm < 0.33 ? 'top' : c.y_norm < 0.66 ? 'middle' : 'bottom',
  x_norm: c.x_norm, y_norm: c.y_norm, w_norm: c.w_norm, h_norm: c.h_norm,
  authoritative: true,
});
const row = db.prepare("SELECT x_norm, y_norm, w_norm, h_norm, anchor_label FROM field_anchors WHERE field_key='customer_name'").get();
check('saveAnchor round-trip: stored x_norm == box CENTRE (0.25), NOT the top-left (0.10)', row && approx(row.x_norm, 0.25));
check('saveAnchor round-trip: stored y_norm == box CENTRE (0.225)', row && approx(row.y_norm, 0.225));
check('saveAnchor round-trip: position-only (empty label persisted)', row && (row.anchor_label === '' || row.anchor_label == null));

console.log('\n' + (fails === 0 ? 'ALL PASS' : `${fails} FAILED`));
process.exit(fails ? 1 : 0);
