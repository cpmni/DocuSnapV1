// census_parked_eligible.js — READ-ONLY census of the eligible-but-parked class.
//
// Counts every queued (needs_review) document that the authoritative predicate
// trust.isAutoFileEligible judges ELIGIBLE — i.e. docs the import pre-gate or FAR's
// isFlagged parked even though the shared predicate would file them. This is the
// before/after gate instrument for the three-gate-disparity slice (pendingfeatures
// 2026-08-12 NIGHT top entry).
//
// Usage (Electron-as-Node, DB path optional — defaults to a SNAPSHOT you provide;
// NEVER point it at a DB the app holds):
//   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe \
//     stress_test/census_parked_eligible.js <db-path>
//
// Output: one line per parked-eligible doc (id, file, supplier, conf, basis) +
// per-reason counts for the parked-INELIGIBLE remainder, so the census also shows
// what the predicate itself refuses (flagged / below-floor / weak-critical / gate).
const path = require('path');
const Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'));

const dbPath = process.argv[2];
if (!dbPath) { console.error('usage: census_parked_eligible.js <db-path>'); process.exit(2); }

const db = new Database(dbPath, { readonly: true });
const trust = require(path.join(__dirname, '..', 'database', 'modules', 'trust'));

const docs = db.prepare(
  "SELECT id, original_filename, document_type_id, overall_confidence, supplier_name " +
  "FROM documents WHERE status = 'needs_review'").all();

const eligible = [];
const refused  = new Map();   // reason -> count
for (const d of docs) {
  let r;
  try { r = trust.isAutoFileEligible(db, d); }
  catch (e) { r = { eligible: false, reason: 'predicate-error:' + e.message }; }
  if (r.eligible) eligible.push({ id: d.id, file: d.original_filename, supplier: d.supplier_name,
                                  conf: d.overall_confidence, basis: r.basis, floor: r.floor });
  else refused.set(r.reason, (refused.get(r.reason) || 0) + 1);
}

console.log(`queued (needs_review): ${docs.length}`);
console.log(`ELIGIBLE-BUT-PARKED:   ${eligible.length}`);
for (const e of eligible) {
  console.log(`  #${e.id} ${e.file}  [${e.supplier}] conf=${e.conf} basis=${e.basis} floor=${e.floor}`);
}
console.log('parked-ineligible reasons:');
for (const [reason, n] of [...refused.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${reason}`);
}
db.close();
