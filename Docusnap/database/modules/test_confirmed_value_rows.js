'use strict';
/*
 * test_confirmed_value_rows.js — PINs for "a confirmed value becomes evidence"
 * (gary design → Oracle SIGN-OFF-W/COND C1–C5, 2026-08-18; both flags DEFAULT OFF, migration 73).
 *
 * THE DEFECT, traced then PROVEN. A value the operator APPROVED but did not EDIT never became an
 * extraction row: the confirm-upsert (`insertManualExtraction`) fires only from the CORRECTIONS
 * loop, and the teach wizard sends `corrections: []` by design — it has nothing to correct, the
 * operator pointed at values and approved them. `getFieldFormats` reads FROM extractions, so a
 * taught document was invisible to the very evidence that decides whether its sender can file
 * itself. Measured on the owner's install: 9 of 10 taught documents had NO supplier_name row.
 * Proven live: one more confirm took a sender to 3 contributing documents and released the other
 * 17 immediately, with no page re-read.
 *
 * The §0 and §6 pins FAIL against the pre-fix code — that is the point of them.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe database/modules/test_confirmed_value_rows.js
 */
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const { runMigrations } = require('../index');
const learning = require('./learning');
const trust    = require('./trust');

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };
const rowsFor = (db, id) => db.prepare('SELECT * FROM extractions WHERE document_id = ? ORDER BY field_key').all(id);

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  db.prepare("INSERT INTO document_types (id, name, slug, built_in, ref_field_key, date_field_key) VALUES (1,'Credit Note','credit_note',0,'credit_note_number','credit_note_date')").run();
  for (const [k, t] of [['supplier_name', 'text'], ['credit_note_number', 'reference_code'], ['credit_note_date', 'date']])
    db.prepare('INSERT INTO fields (document_type_id, key, label, type, required, built_in) VALUES (1,?,?,?,1,1)').run(k, k, t);
  return db;
}
const newDoc = (db, name = 'scan.pdf') => Number(db.prepare(
  `INSERT INTO documents (document_type_id, original_filename, folder_path, status, supplier_name, overall_confidence)
   VALUES (1, ?, '/in', 'needs_review', 'Meadowvale Dairy Wholesale', 93)`).run(name).lastInsertRowid);
const TAUGHT = { supplier_name: 'Meadowvale Dairy Wholesale', credit_note_number: 'MVC-8136', credit_note_date: '17-05-2025' };

console.log('0. THE CUSTOMER CASE — a taught confirm (corrections: []) mints its approved values');
{
  const db = freshDb();
  const id = newDoc(db);
  check('a taught document starts with NO rows at all (the measured state)', rowsFor(db, id).length === 0);
  const n = learning.persistConfirmedValues(db, id, TAUGHT);
  const rows = rowsFor(db, id);
  check('all three approved values become rows', n === 3 && rows.length === 3);
  const sup = rows.find(r => r.field_key === 'supplier_name');
  check("provenance is 'operator_confirmed' — never 'manual', which carries real exemptions "
        + '(the cross-field duplication sweep exempts manual; minting it would disarm that)',
        sup.extraction_method === 'operator_confirmed');
  check('no confidence is claimed — the engine measured nothing', sup.confidence === null);
  check('raw_value NULL, was_corrected 0, no note, no corrected_to',
        sup.raw_value === null && sup.was_corrected === 0 && !sup.validation_note && !sup.corrected_to);
  check('corroboration is NULL, so a minted row can never license the corroborated routes',
        sup.corroboration == null && trust._corrobLicensed && trust._corrobLicensed(null) === false);
  db.close();
}

console.log('1. INSERT-ONLY-WHEN-ABSENT — the anti-restore pin (Oracle G4)');
{
  // A future dev WILL want to "improve" this into an update/backfill. That would overwrite rows
  // whose provenance carries the CONFADOPT / name-repair exclusions, which are unconditional in
  // getFieldFormats precisely because those values must not re-enter learning.
  const db = freshDb();
  const id = newDoc(db);
  db.prepare(`INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method)
              VALUES (?, 'supplier_name', 'Meadowvale', 'Meadowvale', 90, 'anchor_crop+name_repair')`).run(id);
  const before = JSON.stringify(rowsFor(db, id).find(r => r.field_key === 'supplier_name'));
  learning.persistConfirmedValues(db, id, TAUGHT);
  const after = rowsFor(db, id);
  const supRows = after.filter(r => r.field_key === 'supplier_name');
  check('a +name_repair row is left BYTE-UNCHANGED even though the approved value differs',
        supRows.length === 1 && JSON.stringify(supRows[0]) === before);
  check('...and the other approved fields still mint (1 pre-existing + 2 minted)', after.length === 3);
  db.close();
}
{
  const db = freshDb();
  const id = newDoc(db);
  db.prepare(`INSERT INTO extractions (document_id, field_key, display_value, extraction_method)
              VALUES (?, 'credit_note_number', 'MVC-0001', 'template_mapping+confirmed_adopt')`).run(id);
  learning.persistConfirmedValues(db, id, TAUGHT);
  const r = rowsFor(db, id).filter(x => x.field_key === 'credit_note_number');
  check('a +confirmed_adopt row is likewise untouched (exactly one row, original value)',
        r.length === 1 && r[0].display_value === 'MVC-0001');
  db.close();
}

console.log('2. Oracle C2 — an implausible passthrough issuer mints NOTHING');
{
  const db = freshDb();
  const id = newDoc(db);
  learning.persistConfirmedValues(db, id, { supplier_name: 'IN', credit_note_number: 'MVC-8136' });
  const rows = rowsFor(db, id);
  check('"IN" (a garbled INVOICE title) never becomes identity evidence — the same refusal the '
        + 'hint plant and the retract/replant pair make',
        !rows.some(r => r.field_key === 'supplier_name'));
  check('...while the other approved field still mints', rows.some(r => r.field_key === 'credit_note_number'));
  db.close();
}

console.log('3. empties and junk');
{
  const db = freshDb();
  const id = newDoc(db);
  const n = learning.persistConfirmedValues(db, id, { supplier_name: '   ', credit_note_number: '', credit_note_date: null });
  check('empty / whitespace / null values mint nothing', n === 0 && rowsFor(db, id).length === 0);
  db.close();
}

console.log('4. Oracle C1/C3 — the call site guards (source pins)');
{
  const fs = require('fs');
  const rs = fs.readFileSync(path.join(REPO, 'src', 'services', 'reviewService.js'), 'utf8');
  check('an EXPLICIT !_via guard wraps the call (the guard at :279 closes at :281 — relying on it '
        + 'would be a machine hole waiting for a refactor)',
        /if \(!_via && dtInfo && process\.env\.CONFIRM_PERSIST_VALUES !== '0'/.test(rs));
  check('dtInfo is required too — a metadata-gap document mints nothing', /!_via && dtInfo/.test(rs));
  check('it runs AFTER dropForeignExtractions, so it cannot resurrect a dropped row',
        rs.indexOf('persistConfirmedValues') > rs.indexOf('dropForeignExtractions'));
  check('it is fed the FILTERED learning input, never the raw payload',
        /persistConfirmedValues\(db, document_id, _learn\.allValues\)/.test(rs));
  check('_autoFileDoc never mints (machine files are not evidence for their own trust)',
        !/persistConfirmedValues/.test(fs.readFileSync(path.join(REPO, 'src', 'modules', 'processing', 'handler.js'), 'utf8')));
}

console.log('5. Oracle C4 — the corrections fan-out (its own flag, ships with the mint)');
{
  const db = freshDb();
  const id = newDoc(db, 'corrected.pdf');
  db.prepare(`INSERT INTO extractions (document_id, field_key, display_value, extraction_method)
              VALUES (?, 'credit_note_number', 'MVC-1', 'template_mapping')`).run(id);
  db.prepare("UPDATE documents SET status='confirmed' WHERE id=?").run(id);
  for (const v of ['MVC-2', 'MVC-3', 'MVC-4']) {
    db.prepare(`INSERT INTO corrections (document_id, field_key, original_value, corrected_value, supplier_name, document_type)
                VALUES (?, 'credit_note_number', 'MVC-1', ?, 'Meadowvale Dairy Wholesale', 'credit_note')`).run(id, v);
  }
  const countFor = () => {
    const g = (learning.getFieldFormats(db, { includeProvisional: true }) || [])
      .find(f => f.field_key === 'credit_note_number' && String(f.supplier_name || '').trim());
    return g ? Number(g.confirmed_count) : 0;
  };
  process.env.FORMAT_CORRECTIONS_DEDUPE = '0';
  const before = countFor();
  process.env.FORMAT_CORRECTIONS_DEDUPE = '1';
  const after = countFor();
  delete process.env.FORMAT_CORRECTIONS_DEDUPE;
  check(`OFF: ONE document corrected 3 times counts as ${before} (the fan-out — it could reach the `
        + 'solid-format bar alone)', before === 3);
  check('ON: it counts as 1 — confirmed_count finally counts DOCUMENTS', after === 1);
  db.close();
}

console.log('6. THE PROMISE — three taught confirms make a sender verifiable (red before the fix)');
{
  const db = freshDb();
  const solid = () => (learning.getFieldFormats(db) || [])
    .some(f => f.field_key === 'supplier_name' && String(f.supplier_name || '').trim());
  for (let i = 0; i < learning.FORMAT_SOLID_MIN; i++) {
    const id = newDoc(db, `taught${i}.pdf`);
    learning.persistConfirmedValues(db, id, TAUGHT);       // the taught confirm, corrections: []
    db.prepare("UPDATE documents SET status='confirmed' WHERE id=?").run(id);
  }
  check(`${learning.FORMAT_SOLID_MIN} taught confirms now produce a SOLID learned group — before `
        + 'this fix they produced none, and the sender could never file below 100', solid() === true);
  db.close();
}

console.log('7. migration 73 seeds both OFF and does not disturb the mig-72 pins');
{
  const db = new Database(':memory:');
  runMigrations(db);
  const get = k => (db.prepare('SELECT value FROM settings WHERE key = ?').get(k) || {}).value;
  check('confirm_persist_values seeded OFF', get('confirm_persist_values') === 'false');
  check('format_corrections_dedupe seeded OFF', get('format_corrections_dedupe') === 'false');
  check('the migration-72 switches are still OFF', get('filing_sanity_page_match_v2') === 'false'
        && get('vat_reg_symbol_confusable') === 'false' && get('money_sign_capture') === 'false');
  db.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
