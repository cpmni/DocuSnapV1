#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_repair_unplant.js — pins the Learning-Repair send-back UN-PLANT
 * (gary design → Oracle SIGN OFF WITH CONDITIONS C1-C7, 2026-07-23; kill REPAIR_UNPLANT=0).
 *
 * WHAT THIS GUARDS. deconfirmDocument reverses only the LIVE-derived half of confirm learning;
 * supplier_hints (stored increments) and the corrections re-confirm echo had no inverse, and the
 * doc returned to Review looking clean (the rubber-stamp gap). The un-plant retracts EXACTLY this
 * doc's plants — the load-bearing pin is the round trip: plant A + plant B + retract A must leave
 * the hints table IDENTICAL to a pristine plant of B alone (never touch another doc's
 * contribution).
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_repair_unplant.js
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const learning = require('./learning');
const repairService = require('../../src/services/repairService');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; return cond; };
const section = (t) => console.log(`\n${t}`);

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE document_types (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT UNIQUE);
    CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_name TEXT, document_type_id INTEGER,
                            status TEXT, confirmed_at TEXT, confirmed_by_username TEXT);
    CREATE TABLE extractions (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT,
                              raw_value TEXT, display_value TEXT, confidence INTEGER, extraction_method TEXT,
                              was_corrected INTEGER DEFAULT 0, validation_note TEXT, corrected_to TEXT, anchor_label TEXT);
    CREATE TABLE corrections (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT,
                              original_value TEXT, corrected_value TEXT, supplier_name TEXT, document_type TEXT,
                              corrected_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE supplier_hints (id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_name TEXT, document_type TEXT,
                                 field_key TEXT, hint_value TEXT, usage_count INTEGER DEFAULT 1, last_seen TEXT,
                                 UNIQUE(supplier_name, document_type, field_key, hint_value));
    CREATE TABLE field_anchors (id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_name TEXT, document_type TEXT,
                                field_key TEXT, anchor_label TEXT);
  `);
  const tid = db.prepare("INSERT INTO document_types (name, slug) VALUES ('Delivery Note','delivery_note')").run().lastInsertRowid;
  return { db, tid };
}

function seedDoc(db, tid, supplier, fields /* {key: display} */) {
  const id = db.prepare(
    "INSERT INTO documents (supplier_name, document_type_id, status, confirmed_at, confirmed_by_username) VALUES (?,?, 'confirmed', datetime('now'), 'chris')"
  ).run(supplier, tid).lastInsertRowid;
  for (const [k, v] of Object.entries(fields || {})) {
    db.prepare("INSERT INTO extractions (document_id, field_key, display_value, confidence, extraction_method) VALUES (?,?,?,95,'keyword')")
      .run(id, k, v);
  }
  return id;
}

// Snapshot hints without volatile columns (id autoinc + last_seen timestamps).
const hintsSnap = (db) => JSON.stringify(db.prepare(
  'SELECT supplier_name, document_type, field_key, hint_value, usage_count FROM supplier_hints ORDER BY supplier_name, field_key, hint_value'
).all());
const flagCount = (db, id) => db.prepare(
  "SELECT COUNT(*) c FROM extractions WHERE document_id = ? AND validation_note IS NOT NULL AND TRIM(validation_note) <> ''"
).get(id).c;

function main() {
  section('1. ROUND TRIP — plant A + plant B + retract A == pristine plant of B (the anti-touch pin)');
  {
    const { db, tid } = makeDb();
    const A = seedDoc(db, tid, 'Acme Ltd', { supplier_name: 'Acme Ltd', delivery_number: 'DN-1', delivery_date: '01-02-2026' });
    const B = seedDoc(db, tid, 'Acme Ltd', { supplier_name: 'Acme Ltd', delivery_number: 'DN-2' });
    learning.saveCorrections(db, A, { delivery_number: { original_value: 'ON-1', corrected_value: 'DN-1' } },
      'Acme Ltd', 'delivery_note', { supplier_name: 'Acme Ltd', delivery_number: 'DN-1', delivery_date: '01-02-2026' });
    learning.saveCorrections(db, B, {}, 'Acme Ltd', 'delivery_note', { supplier_name: 'Acme Ltd', delivery_number: 'DN-2' });
    const r = repairService.sendBackToReview(db, A, {});
    check('send-back succeeds + reports counts', r.ok && r.unplanted && r.unplanted.corrections_deleted === 1);

    const { db: db2, tid: tid2 } = makeDb();
    const B2 = seedDoc(db2, tid2, 'Acme Ltd', { supplier_name: 'Acme Ltd', delivery_number: 'DN-2' });
    learning.saveCorrections(db2, B2, {}, 'Acme Ltd', 'delivery_note', { supplier_name: 'Acme Ltd', delivery_number: 'DN-2' });
    check('hints table == pristine B-only plant (shared 2→1 kept, A-only deleted, B untouched)',
      hintsSnap(db) === hintsSnap(db2));
    check("A's corrections rows deleted", db.prepare('SELECT COUNT(*) c FROM corrections WHERE document_id=?').get(A).c === 0);
    check('doc A back in review + flagged (C5)',
      db.prepare('SELECT status FROM documents WHERE id=?').get(A).status === 'needs_review' && flagCount(db, A) >= 1);

    section('  trade-off pin — re-confirm RE-PLANTS (retract is cycle-scoped, never a value ban)');
    learning.saveCorrections(db, A, {}, 'Acme Ltd', 'delivery_note', { supplier_name: 'Acme Ltd', delivery_number: 'DN-1', delivery_date: '01-02-2026' });
    check('re-planting restores the hints (usage back at 1 for A-only values)',
      db.prepare("SELECT usage_count u FROM supplier_hints WHERE field_key='delivery_date' AND hint_value='01-02-2026' AND supplier_name <> '__global__'").get().u === 1);
  }

  section('2. C1 — whitespace-variant rows: AT MOST ONE row decremented, exact first');
  {
    const { db, tid } = makeDb();
    // Doc A's correction planted UNTRIMMED ' DN-9 '; doc B's allValues planted trimmed 'DN-9'.
    const A = seedDoc(db, tid, 'Acme Ltd', { ref: ' DN-9 ' });
    const B = seedDoc(db, tid, 'Acme Ltd', { ref: 'DN-9' });
    learning.saveCorrections(db, A, { ref: { original_value: 'x', corrected_value: ' DN-9 ' } }, 'Acme Ltd', 'delivery_note', { ref: ' DN-9 ' });
    learning.saveCorrections(db, B, {}, 'Acme Ltd', 'delivery_note', { ref: 'DN-9' });
    const rows = () => db.prepare("SELECT hint_value, usage_count FROM supplier_hints WHERE field_key='ref' AND supplier_name <> '__global__' ORDER BY hint_value").all();
    check('fixture: both variants coexist', rows().length === 2);
    repairService.sendBackToReview(db, A, {});
    const after = rows();
    check("retract A removed ONLY the untrimmed variant; B's trimmed row untouched",
      after.length === 1 && after[0].hint_value === 'DN-9' && after[0].usage_count === 1);
  }

  section("3. C2 — passthrough-implausible 'IN' never touches a corrected-'IN' row");
  {
    const { db, tid } = makeDb();
    const A = seedDoc(db, tid, 'IN', { supplier_name: 'IN' });               // passthrough: plant SKIPPED (:322)
    const B = seedDoc(db, tid, 'IN', { supplier_name: 'IN' });               // user-corrected: planted (:276)
    learning.saveCorrections(db, A, {}, 'IN', 'delivery_note', { supplier_name: 'IN' });
    learning.saveCorrections(db, B, { supplier_name: { original_value: 'TN', corrected_value: 'IN' } }, 'IN', 'delivery_note', { supplier_name: 'IN' });
    const before = hintsSnap(db);
    repairService.sendBackToReview(db, A, {});
    check("A's retract mirrors the plausibility skip — B's corrected-'IN' hint untouched", hintsSnap(db) === before);
  }

  section('4. C3 — null-supplier doc: __global__ scope, SINGLE decrement, clean round trip');
  {
    const { db, tid } = makeDb();
    const A = seedDoc(db, tid, '', { delivery_number: 'DN-7' });
    learning.saveCorrections(db, A, { delivery_number: { original_value: 'x', corrected_value: 'DN-7' } }, '', 'delivery_note', { delivery_number: 'DN-7' });
    check('fixture: plant used __global__ scope with ONE row (no separate global upsert)',
      db.prepare('SELECT COUNT(*) c FROM supplier_hints').get().c === 1
      && db.prepare('SELECT supplier_name s FROM supplier_hints').get().s === '__global__');
    repairService.sendBackToReview(db, A, {});
    check('round trip → hints empty (single decrement, never negative)',
      db.prepare('SELECT COUNT(*) c FROM supplier_hints').get().c === 0);
  }

  section('5. C4 — two-cycle corrections: latest-row-wins sync, NEVER the old poison (red vs naive)');
  {
    const { db, tid } = makeDb();
    const A = seedDoc(db, tid, 'Acme Ltd', { ref: 'GOOD' });
    // Cycle 1 corrected to 'BAD' (poison), cycle 2 corrected to 'GOOD'; display already 'GOOD'.
    db.prepare("INSERT INTO corrections (document_id, field_key, original_value, corrected_value, supplier_name, document_type) VALUES (?,?,?,?,?,?)")
      .run(A, 'ref', 'orig', 'BAD', 'Acme Ltd', 'delivery_note');
    db.prepare("INSERT INTO corrections (document_id, field_key, original_value, corrected_value, supplier_name, document_type) VALUES (?,?,?,?,?,?)")
      .run(A, 'ref', 'BAD', 'GOOD', 'Acme Ltd', 'delivery_note');
    repairService.sendBackToReview(db, A, {});
    // The NAIVE `display <> corrected` sweep iterates ALL rows and would write 'BAD' back here.
    check("display stays 'GOOD' (latest-row-wins; the naive predicate re-poisons)",
      db.prepare("SELECT display_value v FROM extractions WHERE document_id=? AND field_key='ref'").get(A).v === 'GOOD');
    check('both corrections rows deleted', db.prepare('SELECT COUNT(*) c FROM corrections WHERE document_id=?').get(A).c === 0);
  }

  section('6. C5 — notes: suspect field, generic fallback, and the missing-row insert');
  {
    const { db, tid } = makeDb();
    const A = seedDoc(db, tid, 'Acme Ltd', { supplier_name: 'Acme Ltd', ref: 'DN-3' });
    repairService.sendBackToReview(db, A, { suspects: [{ field: 'ref', note: 'prefix differs from siblings' }] });
    const note = db.prepare("SELECT validation_note n FROM extractions WHERE document_id=? AND field_key='ref'").get(A).n;
    check('suspect field carries the named note', /Sent back from Learning Repair: prefix differs/.test(note || ''));
    // confirm's own note-wipe self-cleans on re-file (reviewService :216 mirror):
    db.prepare('UPDATE extractions SET validation_note = NULL, corrected_to = NULL WHERE document_id = ?').run(A);
    check('confirm-time note-clear round trip → flag gone', flagCount(db, A) === 0);

    const B = seedDoc(db, tid, 'Acme Ltd', { ref: 'DN-4' });   // NO supplier_name row at all
    repairService.sendBackToReview(db, B, {});                  // no suspects → generic doc-level note
    const row = db.prepare("SELECT display_value v, validation_note n, extraction_method m FROM extractions WHERE document_id=? AND field_key='supplier_name'").get(B);
    check('missing supplier_name row → manual row INSERTED so the flag COUNTS (bulk File-All excluded)',
      row && /re-check this document/.test(row.n || '') && row.m === 'manual' && flagCount(db, B) >= 1);
  }

  section('7. Idempotence + atomicity');
  {
    const { db, tid } = makeDb();
    const A = seedDoc(db, tid, 'Acme Ltd', { ref: 'DN-5' });
    learning.saveCorrections(db, A, {}, 'Acme Ltd', 'delivery_note', { ref: 'DN-5' });
    repairService.sendBackToReview(db, A, {});
    const snap = hintsSnap(db);
    const second = repairService.sendBackToReview(db, A, {});
    check('second send on a needs_review doc → ok:false, zero decrements', second.ok === false && hintsSnap(db) === snap);

    const { db: db3, tid: tid3 } = makeDb();
    const C = seedDoc(db3, tid3, 'Acme Ltd', { ref: 'DN-6' });
    learning.saveCorrections(db3, C, {}, 'Acme Ltd', 'delivery_note', { ref: 'DN-6' });
    const preHints = hintsSnap(db3);
    const orig = learning.retractConfirmHints;
    learning.retractConfirmHints = () => { throw new Error('induced'); };   // AFTER the deconfirm statement
    let threw = false;
    try { repairService.sendBackToReview(db3, C, {}); } catch { threw = true; }
    learning.retractConfirmHints = orig;
    check('induced mid-tx failure → rolled back: doc STILL CONFIRMED, hints untouched',
      threw && db3.prepare('SELECT status s FROM documents WHERE id=?').get(C).s === 'confirmed'
      && hintsSnap(db3) === preHints);
  }

  section('8. Wiring (source) — kill switch, co-location, threading');
  {
    const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), 'utf8');
    const handler = read('..', '..', 'src', 'modules', 'settings', 'handler.js');
    check('IPC is kill-switched (REPAIR_UNPLANT=0 ⇒ the legacy status flip, byte-identical)',
      handler.includes("process.env.REPAIR_UNPLANT !== '0'") && /const r = documents\.deconfirmDocument\(db, docId\);/.test(handler));
    const lj = read('learning.js');
    check('retract is co-located directly below the plant (lockstep pair)',
      0 < lj.indexOf('function saveCorrections') && lj.indexOf('function saveCorrections') < lj.indexOf('function retractConfirmHints')
      && lj.indexOf('function retractConfirmHints') - lj.indexOf('function saveCorrections') < 12000);
    const preload = read('..', '..', 'src', 'preload.js');
    check('preload threads the optional opts arg', preload.includes("repairDeconfirm:     (id, opts) => ipcRenderer.invoke('repair-deconfirm', id, opts)"));
    const rend = read('..', '..', 'src', 'windows', 'settings', 'renderer.js');
    check('the Repair renderer threads its suspect context', /api\.repairDeconfirm\(_rpSel, \{ suspects \}\)/.test(rend));
  }

  console.log(fails ? `\n${fails} FAILED` : '\nAll repair un-plant checks passed');
  process.exit(fails ? 1 : 0);
}

main();
