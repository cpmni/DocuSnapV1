// Ask the REAL predicate why each queued doc is not auto-filing, and tally the reasons.
const db = require('better-sqlite3')(process.argv[2], { readonly: true });
const trust = require('C:/GIT Projects/Docusnap/database/modules/trust.js');
const docs = db.prepare("SELECT * FROM documents WHERE status='needs_review'").all();
const tally = {}, byReason = {};
for (const d of docs) {
  let v;
  try { v = trust.isAutoFileEligible(db, d); } catch (e) { v = { eligible: false, reason: 'ERR:' + e.message }; }
  const key = v.eligible ? 'ELIGIBLE' : (v.reason || 'unknown');
  tally[key] = (tally[key] || 0) + 1;
  (byReason[key] = byReason[key] || []).push(`${d.original_filename} conf=${d.overall_confidence} floor=${v.floor}`);
}
console.log('queued docs:', docs.length);
for (const [k, n] of Object.entries(tally).sort((a,b)=>b[1]-a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${k}`);
  byReason[k].slice(0, 2).forEach(s => console.log(`         e.g. ${s}`));
}
const thr = db.prepare("SELECT value FROM settings WHERE key='auto_file_threshold'").get();
console.log('auto_file_threshold =', thr ? thr.value : '(unset → 100)');
console.log('confirmed docs in DB:', db.prepare("SELECT COUNT(*) n FROM documents WHERE status='confirmed'").get().n);
