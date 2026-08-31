#!/usr/bin/env node
'use strict';
/**
 * test_name_snap_gate.js — the NAME SUFFIX-SNAP cross-language + self-feed pins, on a REAL migrated DB.
 *
 * CLEAN-ROW (Oracle 2026-08-24, the cross-language pin): the engine writes a snapped issuer/customer row
 * with was_corrected=1 but NO validation_note and NO corrected_to (method '…+name_snap'). trust.js must
 * NOT count that row as `flagged` — it is exactly the row shape the auto-file gate clears — while the OLD
 * WEAK shape (corrected_to + "Suggested name correction" note) still holds the doc. If the engine and the
 * gate ever disagree on the row shape, a snapped doc would silently fail to file (or a WEAK one would file).
 *
 * SELF-FEED (B7): a value the snap adopted may never count as evidence FOR the dominant that produced it.
 * getFieldFormats must EXCLUDE a '+name_snap' row from its value_counts, and a later human correction must
 * re-admit it (the corrections carve-out).
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_name_snap_gate.js
 */
const Database = require('better-sqlite3');
const { runMigrations } = require('../index');
const doctypes = require('./document_types');
const learning = require('./learning');
const trust = require('./trust');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

function fresh() {
  const db = new Database(':memory:');
  runMigrations(db);
  doctypes.seedBuiltInTypes(db);
  return db;
}
const SUP = 'Bramblewood Joinery Ltd';

// Seed a confirmed invoice for supplier SUP whose supplier_name extraction has the given method/shape.
function seedNameDoc(db, { method = 'anchor', note = null, correctedTo = null, wasCorrected = 0, addCorrection = false } = {}) {
  const inv = doctypes.getWithFields(db, 'invoice');
  const r = db.prepare(`INSERT INTO documents
      (document_type_id, original_filename, stored_filename, stored_path, folder_path, status, supplier_name,
       doc_date, reference_number, overall_confidence, confirmed_via, confirmed_at)
    VALUES (?, 'd.pdf', 'd.pdf', 'C:/out/d.pdf', 'C:/in', 'confirmed', ?, '01-02-2026', 'INV-1', 100, NULL, datetime('now'))`)
    .run(inv.id, SUP);
  const docId = r.lastInsertRowid;
  db.prepare(`INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method, was_corrected, validation_note, corrected_to)
              VALUES (?, 'supplier_name', ?, ?, 95, ?, ?, ?, ?)`)
    .run(docId, SUP, SUP, method, wasCorrected, note, correctedTo);
  if (addCorrection) {
    db.prepare(`INSERT INTO corrections (document_id, field_key, original_value, corrected_value, supplier_name, document_type)
                VALUES (?, 'supplier_name', 'x', ?, ?, 'invoice')`).run(docId, SUP, SUP);
  }
  return docId;
}
const supCounts = (db) => {
  const g = learning.getFieldFormats(db).find(f =>
    String(f.supplier_name).toLowerCase() === SUP.toLowerCase() && f.field_key === 'supplier_name');
  return g ? g.value_counts : null;
};

console.log('\nname suffix-snap gate (clean-row + self-feed)');

// ── SELF-FEED: a +name_snap row is excluded from value_counts; a correction re-admits it ──
{
  const db = fresh();
  for (let i = 0; i < 3; i++) seedNameDoc(db, { method: 'anchor' });          // 3 human reads
  seedNameDoc(db, { method: 'anchor+name_snap', wasCorrected: 1 });           // a snapped read
  const c = supCounts(db);
  check('self-feed: human history counts (3)', !!c && c[SUP] === 3);
  check('self-feed: the +name_snap row is EXCLUDED (not 4)', !!c && c[SUP] === 3);

  const db2 = fresh();
  for (let i = 0; i < 3; i++) seedNameDoc(db2, { method: 'anchor' });
  seedNameDoc(db2, { method: 'anchor+name_snap', wasCorrected: 1, addCorrection: true });   // human-corrected
  const c2 = supCounts(db2);
  check('self-feed: a human correction RE-ADMITS the +name_snap row (4)', !!c2 && c2[SUP] === 4);
}

// ── CLEAN-ROW: the snap's row shape clears trust.flagged; the WEAK shape does not ──
{
  const db = fresh();
  const inv = doctypes.getWithFields(db, 'invoice');
  const doc = { id: 1, document_type_id: inv.id, overall_confidence: 100, supplier_name: SUP };
  const clean = [
    { field_key: 'supplier_name',   display_value: SUP,         validation_note: null, corrected_to: null, extraction_method: 'anchor+name_snap' },
    { field_key: 'invoice_number',  display_value: 'INV-1',     validation_note: null, corrected_to: null, extraction_method: 'keyword' },
    { field_key: 'invoice_date',    display_value: '01-02-2026', validation_note: null, corrected_to: null, extraction_method: 'keyword' },
  ];
  const weak = clean.map(e => e.field_key === 'supplier_name'
    ? { ...e, extraction_method: 'anchor', corrected_to: SUP, validation_note: 'Suggested name correction: ' + SUP } : e);

  const rClean = trust.isAutoFileEligible(db, doc, { extractions: clean });
  const rWeak  = trust.isAutoFileEligible(db, doc, { extractions: weak });
  check('clean-row: the +name_snap row does NOT trip the flagged gate', rClean.reason !== 'flagged');
  check('clean-row: it auto-files (eligible)', rClean.eligible === true);
  check('WEAK shape: corrected_to + note DOES trip the flagged gate', rWeak.reason === 'flagged');
}

console.log(fails === 0 ? '\nALL PASS' : `\nFAILED (${fails})`);
process.exit(fails ? 1 : 0);
