#!/usr/bin/env node
'use strict';
/**
 * test_batch_audit_learning.js — the batch-audit LINCHPIN + anchor policy, on a REAL migrated DB.
 *
 * PIN A (the linchpin, Oracle 2026-08-24): a batch correction of an AUTO-filed (machine confirmed_via)
 * doc, with learning_exclude_machine_confirms ON, must make the READER (getFieldFormats) reflect the
 * corrected value — proving the correction reaches the counted learning substrate via the C2 carve-out
 * (a corrections row re-admits a machine-via row). A test that only checked the corrections TABLE would
 * pass while the reader still ignored it; this asserts the reader OUTPUT.
 *
 * PIN E: a value-only correction (preserveAllAnchors) must PRESERVE the field's learned anchor; the
 * default (no preserve) still wipes it. PIN "not-cosmetic": the new value becomes a supplier hint.
 * Marker-survival: documents.confirm (the isRefile writer) never touches the mig-86/87 put-back cols.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_batch_audit_learning.js
 */
const Database = require('better-sqlite3');
const { runMigrations } = require('../index');
const doctypes = require('./document_types');
const learning = require('./learning');
const documents = require('./documents');
const { MACHINE_VIAS_SET } = require('./machine_vias');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

function fresh() {
  const db = new Database(':memory:');
  runMigrations(db);
  doctypes.seedBuiltInTypes(db);
  return db;
}
// Seed one confirmed invoice for supplier S reading `ref` for invoice_number, with the given via
// (a machine via like 'auto_threshold', or null/'' for a human confirm).
function seedDoc(db, { supplier = 'Acme Ltd', ref = 'INV-BAD', via = 'auto_threshold' } = {}) {
  const inv = doctypes.getWithFields(db, 'invoice');
  const r = db.prepare(`INSERT INTO documents
      (document_type_id, original_filename, stored_filename, stored_path, folder_path, status, supplier_name,
       doc_date, reference_number, overall_confidence, confirmed_via, confirmed_at)
    VALUES (?, ?, ?, ?, ?, 'confirmed', ?, '01-02-2026', ?, 95, ?, datetime('now'))`)
    .run(inv.id, 'inv.pdf', 'Invoice.01-02-2026.' + ref + '.pdf', 'C:/out/' + ref + '.pdf', 'C:/in', supplier, ref, via || null);
  const docId = r.lastInsertRowid;
  db.prepare(`INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method, was_corrected)
              VALUES (?, 'invoice_number', ?, ?, 95, 'keyword', 0)`).run(docId, ref, ref);
  return docId;
}
const seedAutoDoc = (db, o = {}) => ({ docId: seedDoc(db, { via: 'auto_threshold', ...o, ref: o.badRef || o.ref || 'INV-BAD' }) });
const scopeCounts = (db, supplier, slug, field) => {
  const g = learning.getFieldFormats(db).find(f =>
    String(f.supplier_name).toLowerCase() === supplier.toLowerCase() &&
    String(f.document_type || '') === slug && f.field_key === field);
  return g ? g.value_counts : null;
};

console.log('\nbatch-audit learning linchpin (PIN A / E)');

// ── sanity: auto_threshold is a machine via ───────────────────────────────────
check('auto_threshold ∈ MACHINE_VIAS_SET', MACHINE_VIAS_SET.has('auto_threshold'));

// ── PIN A — the reader reflects the correction (exclude ON), the LINCHPIN ───────
// Solid history: 3 HUMAN-confirmed docs read INV-GOOD (so the scope group emits, ≥3 bar). One
// MACHINE (auto_threshold) doc misread INV-BAD. With exclude ON the machine doc is INVISIBLE to the
// counted substrate — until a correction row re-admits it (C2 carve-out). A batch correction of the
// machine doc must make the reader COUNT the corrected value.
{
  const db = fresh();
  learning.setSetting(db, 'learning_exclude_machine_confirms', 'true');
  for (let i = 0; i < 3; i++) seedDoc(db, { supplier: 'Acme Ltd', ref: 'INV-GOOD', via: null });   // human history
  const { docId } = seedAutoDoc(db, { supplier: 'Acme Ltd', badRef: 'INV-BAD' });                    // machine misread

  const before = scopeCounts(db, 'Acme Ltd', 'invoice', 'invoice_number');
  check('PIN A pre: scope group emits (human history solid)', !!before && before['INV-GOOD'] === 3);
  check('PIN A pre: the machine misread is EXCLUDED (no INV-BAD counted)', !!before && !before['INV-BAD']);

  // The batch correction's learning write (exactly what reviewService.confirm calls on isRefile).
  learning.saveCorrections(db, docId,
    { invoice_number: { original_value: 'INV-BAD', corrected_value: 'INV-FIXED' } },
    'Acme Ltd', 'invoice',
    { supplier_name: 'Acme Ltd', invoice_number: 'INV-FIXED' }, [], { preserveAllAnchors: true });

  const after = scopeCounts(db, 'Acme Ltd', 'invoice', 'invoice_number');
  check('PIN A: corrected machine row NOW COUNTED by the reader (C2 carve-out)', !!after && after['INV-FIXED'] === 1);
  check('PIN A: the wrong value did NOT leak into counts', !!after && !after['INV-BAD']);
  db.close();
}

// ── PIN "not-cosmetic" — the new value is a supplier hint ─────────────────────
{
  const db = fresh();
  const { docId } = seedAutoDoc(db, { badRef: 'INV-9' });
  learning.saveCorrections(db, docId,
    { invoice_number: { original_value: 'INV-9', corrected_value: 'INV-42' } },
    'Acme Ltd', 'invoice', { supplier_name: 'Acme Ltd', invoice_number: 'INV-42' }, [], { preserveAllAnchors: true });
  const hint = db.prepare(`SELECT usage_count FROM supplier_hints WHERE supplier_name='Acme Ltd' AND document_type='invoice' AND field_key='invoice_number' AND hint_value='INV-42'`).get();
  check('not-cosmetic: new value became a supplier hint', !!hint && hint.usage_count >= 1);
  db.close();
}

// ── PIN E — value-only correction PRESERVES the learned anchor; default wipes ──
function seedAnchor(db, supplier) {
  db.prepare(`INSERT INTO field_anchors
      (supplier_name, document_type, field_key, anchor_label, direction, page_zone,
       x_norm, y_norm, w_norm, h_norm, usage_count, confidence)
    VALUES (?, 'invoice', 'invoice_number', 'Invoice No', 'right', 'top-right', 0.6, 0.1, 0.2, 0.05, 3, 90)`).run(supplier);
}
const anchorCount = (db, supplier) => db.prepare(`SELECT COUNT(*) n FROM field_anchors WHERE supplier_name=? AND document_type='invoice' AND field_key='invoice_number'`).get(supplier).n;
{
  const db = fresh();
  const { docId } = seedAutoDoc(db, { supplier: 'Keep Co', badRef: 'K-1' });
  seedAnchor(db, 'Keep Co');
  check('PIN E pre: anchor present', anchorCount(db, 'Keep Co') === 1);
  learning.saveCorrections(db, docId,
    { invoice_number: { original_value: 'K-1', corrected_value: 'K-2' } },
    'Keep Co', 'invoice', { supplier_name: 'Keep Co', invoice_number: 'K-2' }, [], { preserveAllAnchors: true });
  check('PIN E: preserveAllAnchors → anchor SURVIVES', anchorCount(db, 'Keep Co') === 1);
  db.close();
}
{
  const db = fresh();
  const { docId } = seedAutoDoc(db, { supplier: 'Wipe Co', badRef: 'W-1' });
  seedAnchor(db, 'Wipe Co');
  learning.saveCorrections(db, docId,
    { invoice_number: { original_value: 'W-1', corrected_value: 'W-2' } },
    'Wipe Co', 'invoice', { supplier_name: 'Wipe Co', invoice_number: 'W-2' }, []);   // no opts → default wipe
  check('PIN E control: default (no preserve) WIPES the anchor', anchorCount(db, 'Wipe Co') === 0);
  db.close();
}

// ── Marker survival — documents.confirm (isRefile writer) never touches put-back cols ─
{
  const db = fresh();
  const { docId } = seedAutoDoc(db, { supplier: 'Mark Co', badRef: 'M-1' });
  // Force a put-back marker on (a positive control: the column exists + is writable).
  db.prepare(`UPDATE documents SET put_back_at = datetime('now') WHERE id=?`).run(docId);
  const before = db.prepare('SELECT put_back_at FROM documents WHERE id=?').get(docId).put_back_at;
  check('marker control: put_back_at set', !!before);
  documents.confirm(db, docId, { stored_filename: 'x.pdf', stored_path: 'C:/out/x.pdf', confirmed_by_username: 'u' });
  const after = db.prepare('SELECT put_back_at FROM documents WHERE id=?').get(docId).put_back_at;
  check('marker survives documents.confirm (isRefile writer)', after === before);
  db.close();
}

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}`);
process.exit(fails ? 1 : 0);
