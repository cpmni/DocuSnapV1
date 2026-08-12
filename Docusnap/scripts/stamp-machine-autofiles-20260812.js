#!/usr/bin/env node
'use strict';
/*
 * scripts/stamp-machine-autofiles-20260812.js
 * -------------------------------------------
 * LIVE-DATA REMEDIATION (Oracle condition C3 of the gate-unify slice, 2026-08-12 NIGHT):
 * every machine auto-file to date stamped confirmed_via NULL (handler.js set a sentinel only
 * for the corroborated basis), so graduated @95 files (Ironclad/Meadowvale) and threshold @100
 * files (Bramblewood/Harrowgate) count as HUMAN confirms in the graduation window — the same
 * self-manufactured-trust mechanism as the 08-12 sweep incident. The code fix (T3 stamps +
 * the trust.js:538 exclusions) is go-forward; this stamps the HISTORIC cohort so the windows
 * tell the truth. Oracle: the graduated cohort stamp is BLOCKING for the autofile_gate_unify
 * flip; the threshold cohort is recommended.
 *
 * Cohort self-validates per doc (never a bare id list): status still 'confirmed',
 * confirmed_via NULL, username LIKE 'Auto-filed%' (the machine claim stamp — no human account
 * carries it). Basis derived from the stored confidence: <100 = graduated ('auto_graduated'),
 * 100 = threshold ('auto_threshold'). NEVER stamps 'scope_sweep' (Undo-all is via-checked).
 *
 * Pattern: CENSUS (read-only, default) -> BACKUP -> APPLY. Run with the APP CLOSED.
 *   census:  ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\stamp-machine-autofiles-20260812.js
 *   apply:   ... with APPLY=1
 * After APPLY: re-measure scopeTrust on the listed scopes and report any graduation revocation
 * plainly (the 08-12 precedent: revocation = real corrections resurfacing, not a defect).
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

const cohort = db.prepare(`
  SELECT id, supplier_name, overall_confidence, confirmed_by_username FROM documents
  WHERE status = 'confirmed'
    AND (confirmed_via IS NULL OR confirmed_via = '')
    AND confirmed_by_username LIKE 'Auto-filed%'
  ORDER BY supplier_name, id`).all();

const grad = cohort.filter(d => (d.overall_confidence || 0) < 100);
const thr  = cohort.filter(d => (d.overall_confidence || 0) >= 100);
console.log(`\ncohort: ${cohort.length} via-NULL machine files — ${grad.length} graduated-basis (<100), ${thr.length} threshold (100)`);
const bySup = {};
for (const d of cohort) {
  const k = `${d.supplier_name} @${d.overall_confidence}`;
  bySup[k] = (bySup[k] || 0) + 1;
}
for (const [k, n] of Object.entries(bySup)) console.log(`  ${String(n).padStart(3)}  ${k}`);

if (!APPLY) { console.log('\nCensus only (APPLY=1 to stamp — close the app first).'); db.close(); process.exit(0); }

const backup = DB_PATH.replace(/\.db$/, '_pre_machinestamp_20260812.db');
db.backup(backup).then(() => {
  console.log('backup done:', backup, fs.statSync(backup).size, 'bytes');
  const upd = db.prepare("UPDATE documents SET confirmed_via = ? WHERE id = ? AND (confirmed_via IS NULL OR confirmed_via = '') AND confirmed_by_username LIKE 'Auto-filed%'");
  let ng = 0, nt = 0;
  for (const d of grad) ng += upd.run('auto_graduated', d.id).changes;
  for (const d of thr)  nt += upd.run('auto_threshold', d.id).changes;
  console.log(`stamped ${ng} auto_graduated + ${nt} auto_threshold (of ${cohort.length})`);
  console.log('\nRe-measure next: scopeTrust on the scopes above; report revocations plainly.');
  db.close();
}).catch(e => { console.error('BACKUP FAILED — nothing written:', e.message); db.close(); process.exit(1); });
