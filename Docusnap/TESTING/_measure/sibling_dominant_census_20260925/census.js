#!/usr/bin/env node
'use strict';
/**
 * Tier C "converging siblings" — false-hold census (Oracle C5, 2026-09-25) over a READ-ONLY DB copy.
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe TESTING/_measure/sibling_dominant_census_20260925/census.js <db-copy> <label>
 * Arm Q (queued): every needs_review / deferred doc with an issuer → findDominantSiblingIdentity(db, id, issuer) — the
 *   holds the switch WOULD raise today (the exhibit's positive control: exactly docs 69 + 62 on Chris's copy, 0 of the 18).
 * Arm R (REPLAY): every HUMAN-confirmed doc treated as queued beside its converging siblings (the function already
 *   counts queued + human-confirmed rows and excludes the doc itself) → a hold whose offer ≠ the confirmed value is a
 *   FALSE-hold CANDIDATE for hand adjudication (FALSE = the offer is a different real company or the confirmed value
 *   was right; CATCH = the human rubber-stamped a garble). Prints every candidate with both spellings + the tally.
 * Also logs P size (distinct folds), pair tests and ms per call (Oracle C3 perf evidence). Never writes.
 */
const path = require('path');
const REPO = 'C:/GIT Projects/Docusnap';
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const { MACHINE_VIAS_SQL } = require(path.join(REPO, 'database', 'modules', 'machine_vias.js'));
const [dbPath, label] = process.argv.slice(2);
const db = new Database(dbPath, { readonly: true });
process.env.ISSUER_SIBLING_DOMINANT_HOLD = '1';
const cols = new Set(db.prepare('PRAGMA table_info(documents)').all().map(c => c.name));
const delClause = cols.has('deleted_at') ? ' AND deleted_at IS NULL' : '';
const viaClause = cols.has('confirmed_via') ? ` AND COALESCE(confirmed_via, '') NOT IN (${MACHINE_VIAS_SQL})` : '';
const run = (rows, arm) => {
  const holds = []; let totalMs = 0, maxMs = 0, pairMax = 0, tests = 0;
  for (const r of rows) {
    const t0 = Date.now();
    const sd = learning.findDominantSiblingIdentity(db, r.id, r.supplier_name);
    const ms = Date.now() - t0; totalMs += ms; maxMs = Math.max(maxMs, ms); pairMax = Math.max(pairMax, Number(sd && sd.pairTests) || 0); tests++;
    if (sd && sd.near) holds.push({ id: r.id, file: String(r.original_filename || '').slice(0, 44), typed: r.supplier_name, offer: sd.existing, kind: sd.kind, distance: sd.distance, siblings: sd.siblings, confirmedSiblings: sd.confirmedSiblings, own: sd.own, pairTests: sd.pairTests });
  }
  console.log(`arm ${arm}: ${rows.length} docs · holds ${holds.length} · avg ${tests ? (totalMs / tests).toFixed(1) : 0} ms · max ${maxMs} ms · max pairTests ${pairMax}`);
  for (const h of holds) console.log('   ', JSON.stringify(h));
  return holds;
};
console.log(`== ${label}: ${dbPath}`);
const queued = db.prepare(`SELECT id, original_filename, supplier_name FROM documents WHERE status IN ('needs_review','deferred') AND supplier_name IS NOT NULL AND TRIM(supplier_name) <> ''${delClause} ORDER BY id`).all();
const confirmed = db.prepare(`SELECT id, original_filename, supplier_name FROM documents WHERE status = 'confirmed' AND supplier_name IS NOT NULL AND TRIM(supplier_name) <> ''${viaClause}${delClause} ORDER BY id`).all();
const folds = db.prepare(`SELECT COUNT(DISTINCT LOWER(TRIM(supplier_name))) AS n FROM documents WHERE supplier_name IS NOT NULL${delClause}`).get().n;
console.log(`distinct sender spellings: ${folds}`);
const hq = run(queued, 'Q (queued today)');
const hr = run(confirmed, 'R (REPLAY of human-confirmed docs — every hold is a FALSE-hold candidate to adjudicate)');
console.log(`SUMMARY ${label}: queued holds ${hq.length} · replay candidates ${hr.length}`);
db.close();
