#!/usr/bin/env node
'use strict';
/*
 * scripts/remediate-sweep-cohort-20260812.js
 * ------------------------------------------
 * LIVE-DATA REMEDIATION (Oracle-ordered, 2026-08-12): the retired queue-wide
 * autoCommitFullConfidence sweep filed 101 docs at 12:36:29-46 UTC as ordinary HUMAN confirms
 * (confirmed_via NULL, the operator's username) — inflating the human graduation windows and
 * indistinguishable from hand confirms. Code fix shipped (`0177716`, consent bar + the
 * 'auto_reprocess' sentinel in trust.js). This stamps the cohort so the windows tell the truth.
 *
 * NEVER stamps 'scope_sweep' (the Undo-all mass-revert path is via-checked).
 * Pattern: CENSUS (read-only, default) -> BACKUP -> APPLY. Run with the APP CLOSED.
 *   census:  ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\remediate-sweep-cohort-20260812.js
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

// Cohort: the audit burst window, self-validated per doc (Oracle discipline — ids key a mutable
// DB): the doc must STILL be confirmed, confirmed_via NULL, and carry the burst's human username.
const burst = db.prepare(`SELECT DISTINCT document_id id, actor_username FROM audit_log
  WHERE action = 'review_confirmed' AND created_at >= '2026-08-12 12:36:29' AND created_at <= '2026-08-12 12:36:46'`).all();
const cohort = [];
for (const b of burst) {
  const d = db.prepare('SELECT id, supplier_name, status, confirmed_via, confirmed_by_username FROM documents WHERE id = ?').get(b.id);
  if (!d) continue;
  if (d.status !== 'confirmed' || d.confirmed_via != null || d.confirmed_by_username !== b.actor_username) {
    console.log(`  skip #${b.id}: state changed since the burst (${d.status}/${d.confirmed_via}/${d.confirmed_by_username})`);
    continue;
  }
  cohort.push(d);
}
console.log(`\ncohort: ${cohort.length} docs (audit burst rows: ${burst.length})`);
const bySup = {};
for (const d of cohort) (bySup[d.supplier_name] = bySup[d.supplier_name] || []).push(d.id);
for (const [s, ids] of Object.entries(bySup)) console.log(`  ${String(ids.length).padStart(3)}  ${s}`);

if (!APPLY) { console.log('\nCensus only (APPLY=1 to stamp — close the app first).'); db.close(); process.exit(0); }

const backup = DB_PATH.replace(/\.db$/, '_pre_sweepstamp_20260812.db');
db.backup(backup).then(() => {
  console.log('backup done:', backup, fs.statSync(backup).size, 'bytes');
  const upd = db.prepare("UPDATE documents SET confirmed_via = 'auto_reprocess' WHERE id = ? AND confirmed_via IS NULL");
  let n = 0;
  for (const d of cohort) n += upd.run(d.id).changes;
  console.log(`stamped ${n} of ${cohort.length} docs confirmed_via='auto_reprocess'`);
  console.log('\nRe-measure next: scopeTrust on the suppliers listed above; then the owed censuses');
  console.log('(pin-discharge / CONFADOPT / shadow-attribution) treating this cohort as suspect.');
  db.close();
}).catch(e => { console.error('BACKUP FAILED — nothing written:', e.message); db.close(); process.exit(1); });
