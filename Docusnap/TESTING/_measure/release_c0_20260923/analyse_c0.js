#!/usr/bin/env node
'use strict';
/*
 * C0 analysis (Oracle 2026-09-23, confusable RELEASE flip gate). Reads an RR_CONSENSUS jsonl written by
 * stress_test/realdoc_regression.js (with the 2026-09-23 `corrob` field) and, for every doc whose REF note is the
 * Gate-C confusable soften ("look like another on a scan"), classifies it:
 *   (i)   page-family disagreement STILL in the record after the mig-191 suppression → trust.js would hold it anyway
 *   (ii)  winner is a Stage-0.5 taught read AND the record carries `suppressed_taught_role` (the mig-191 lift fired)
 *   (iii) neither (no page family ever disagreed — keyword captured nothing)
 * Yield = (ii) + (iii). Also prints, for each soften doc, the gate reason + overall so "below-floor = the note's own
 * −12 fc penalty" cases are visible.
 *
 * Usage: node analyse_c0.js <path/to/full.jsonl>
 */
const fs = require('fs');
const PAGE = new Set(['mapping', 'crop', 'keyword']);          // trust.js _CORROB_PAGE_FAMILIES
const SOFT = 'look like another on a scan';
const rows = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const soft = rows.filter(r => r.ref && r.ref.note && r.ref.note.includes(SOFT));
const pageFamilyDisagrees = (rec) => {
  if (!rec || !Array.isArray(rec.disagree)) return false;
  const pool = rec.disagree.concat(Array.isArray(rec.discounted) ? rec.discounted : []);
  return pool.some(d => d && PAGE.has(String(d.family || '')));
};
const cat = { i: [], ii: [], iii: [] };
for (const r of soft) {
  const rec = r.ref.corrob || null;
  const taught = /^template_(mapping|registration)/.test(String(r.ref.method || ''));
  if (pageFamilyDisagrees(rec)) cat.i.push(r);
  else if (taught && rec && Array.isArray(rec.suppressed_taught_role) && rec.suppressed_taught_role.length) cat.ii.push(r);
  else cat.iii.push(r);
}
const line = (r) => `  #${r.id} ${r.type} ref='${r.ref.val}' (${r.ref.method}, conf ${r.ref.conf}) overall=${r.overall} reason=${r.reason}` +
  (r.ref.corrob ? ` disagree=${JSON.stringify(r.ref.corrob.disagree || [])} suppressed=${JSON.stringify(r.ref.corrob.suppressed_taught_role || [])}` : ' corrob=none');
console.log(`docs: ${rows.length} · soften-noted refs: ${soft.length}`);
console.log(`(i)   still page-family-held (trust.js disagreeing-read): ${cat.i.length}`);
cat.i.forEach(r => console.log(line(r)));
console.log(`(ii)  taught + on-shape (mig-191 suppression lifted the page family): ${cat.ii.length}`);
cat.ii.forEach(r => console.log(line(r)));
console.log(`(iii) no page family ever disagreed: ${cat.iii.length}`);
cat.iii.forEach(r => console.log(line(r)));
console.log(`\nYIELD (ii)+(iii) = ${cat.ii.length + cat.iii.length} of ${soft.length} soften docs (${rows.length} docs total)`);
// context: every other ref note kind, so the soften's share of the ref-note population is visible
const kinds = {};
for (const r of rows) { const n = r.ref && r.ref.note; if (n) { const k = n.slice(0, 48); kinds[k] = (kinds[k] || 0) + 1; } }
console.log('\nref-note heads (all docs):'); Object.entries(kinds).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${n}  ${k}…`));
const reasons = {};
for (const r of rows) { const k = String(r.reason).replace(/:.*/, ''); reasons[k] = (reasons[k] || 0) + 1; }
console.log('\ngate reasons (all docs):', reasons);
