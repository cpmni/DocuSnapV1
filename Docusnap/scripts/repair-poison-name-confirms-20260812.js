#!/usr/bin/env node
'use strict';
/*
 * scripts/repair-poison-name-confirms-20260812.js
 * ------------------------------------------------
 * DATA REMEDIATION (owner-consented; the confusable-snap Slice-1 finding, 2026-08-12 NIGHT):
 * confirmed GARBLED customer names dilute the Stage-4.5 name lexicon below the 0.9 STRONG bar
 * (Quillstone scope: 79 clean + 5 'Quilistone' + 1 'Quiltstone' + 4 wrong-party = doc_freq
 * 0.888 → the repair that owns this class demotes itself to suggestion-only), and hold the
 * CONFADOPT/STRICT-variability licences shut (Castellan: 'Branblewood' ×9).
 * Provenance: chris test-era confirms (via NULL) + machine auto-files that confirmed garble
 * (auto_threshold/auto_graduated) — the machine-feeds-learning loop, filed as its own arc.
 *
 * FIX SHAPE: display-value correction ONLY (raw_value keeps the honest original read — the
 * same shape a Review correction leaves). Deliberately NO corrections rows: mass-writing 15
 * corrections would revoke graduation on three scopes (recent-correction) — punishing the
 * owner for cleaning test pollution. Value_counts/lexicons heal because getFieldFormats reads
 * display_value of confirmed docs.
 *
 * Pattern: CENSUS (read-only, default) -> BACKUP -> APPLY. Run with the APP CLOSED.
 *   census:  ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\repair-poison-name-confirms-20260812.js
 *   apply:   ... with APPLY=1
 */
const path = require('path');
const fs = require('fs');
const DB_PATH = process.env.RS_DB || path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db');
console.log('DB path (resolved):', DB_PATH, '| exists:', fs.existsSync(DB_PATH));
if (!fs.existsSync(DB_PATH)) process.exit(1);
const REPO = path.resolve(__dirname, '..');
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const APPLY = process.env.APPLY === '1';
const db = new Database(DB_PATH, { readonly: !APPLY, fileMustExist: true });

// Self-validating cohort: confirmed docs whose customer_name display is one of the KNOWN
// garble literals of a KNOWN canonical. Never keyed on bare ids (a mutable DB).
const REPAIRS = [
  { bad: 'Quilistone Print & Packaging', good: 'Quillstone Print & Packaging' },
  { bad: 'Quiltstone Print & Packaging', good: 'Quillstone Print & Packaging' },
  { bad: 'Branblewood Joinery Ltd',      good: 'Bramblewood Joinery Ltd' },
];

let total = 0;
for (const r of REPAIRS) {
  const rows = db.prepare(`SELECT e.id eid, d.id, d.original_filename, d.confirmed_by_username, d.confirmed_via
    FROM extractions e JOIN documents d ON d.id = e.document_id
    WHERE d.status = 'confirmed' AND e.field_key = 'customer_name' AND e.display_value = ?`).all(r.bad);
  console.log(`\n'${r.bad}' -> '${r.good}': ${rows.length} confirmed rows`);
  for (const x of rows) console.log(`  #${x.id} ${x.original_filename} (by=${x.confirmed_by_username} via=${x.confirmed_via || 'NULL'})`);
  total += rows.length;
}
if (!APPLY) { console.log(`\nCensus only — ${total} rows (APPLY=1 to repair — close the app first).`); db.close(); process.exit(0); }

const backup = DB_PATH.replace(/\.db$/, '_pre_namerepair_20260812.db');
db.backup(backup).then(() => {
  console.log('backup done:', backup, fs.statSync(backup).size, 'bytes');
  let n = 0;
  const upd = db.prepare(`UPDATE extractions SET display_value = ?
    WHERE field_key = 'customer_name' AND display_value = ?
      AND document_id IN (SELECT id FROM documents WHERE status = 'confirmed')`);
  for (const r of REPAIRS) n += upd.run(r.good, r.bad).changes;
  console.log(`repaired ${n} rows (display_value only; raw_value untouched).`);
  console.log('Effect on next processing run: Quillstone lexicon 85/89 = 0.955 >= 0.9 STRONG;');
  console.log('Castellan customer bucket single-key -> CONFADOPT licence restored.');
  db.close();
}).catch(e => { console.error('BACKUP FAILED — nothing written:', e.message); db.close(); process.exit(1); });
