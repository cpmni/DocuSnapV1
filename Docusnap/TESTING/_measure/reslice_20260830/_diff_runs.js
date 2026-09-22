'use strict';
/* _diff_runs.js <A_summary.json> <B_summary.json> [fields=total_amount,invoice_date,...]
 * Per-doc, per-field diff of two _run_docs.js summaries: value / note / confidence / method / corroboration.
 * Prints ONLY the fields that differ, plus per-doc overall/needs_review changes and a tally. */
const fs = require('fs');
const [a, b, fieldsArg] = process.argv.slice(2);
const A = JSON.parse(fs.readFileSync(a, 'utf8')), B = JSON.parse(fs.readFileSync(b, 'utf8'));
const only = fieldsArg ? new Set(fieldsArg.split(',')) : null;
const tally = { docs: 0, docsChanged: 0, valueChanged: 0, noteCleared: 0, noteAdded: 0, noteChanged: 0, confChanged: 0, reviewToClean: 0, cleanToReview: 0 };
const j = x => JSON.stringify(x);
for (const name of Object.keys(A).sort()) {
  const da = A[name], db = B[name];
  tally.docs++;
  if (!db) { console.log(`${name}: MISSING in B`); continue; }
  const lines = [];
  if (da.overall !== db.overall || da.needs_review !== db.needs_review) {
    lines.push(`  doc: overall ${da.overall} -> ${db.overall}; needs_review ${da.needs_review} -> ${db.needs_review}`);
    if (da.needs_review && !db.needs_review) tally.reviewToClean++;
    if (!da.needs_review && db.needs_review) tally.cleanToReview++;
  }
  const keys = new Set([...Object.keys(da.fields || {}), ...Object.keys(db.fields || {})]);
  for (const k of keys) {
    if (only && !only.has(k)) continue;
    const fa = (da.fields || {})[k] || {}, fb = (db.fields || {})[k] || {};
    const diffs = [];
    if ((fa.value ?? '') !== (fb.value ?? '')) { diffs.push(`value ${j(fa.value)} -> ${j(fb.value)}`); tally.valueChanged++; }
    if ((fa.note || '') !== (fb.note || '')) {
      diffs.push(`note ${j(fa.note)} -> ${j(fb.note)}`);
      if (fa.note && !fb.note) tally.noteCleared++; else if (!fa.note && fb.note) tally.noteAdded++; else tally.noteChanged++;
    }
    if ((fa.confidence ?? null) !== (fb.confidence ?? null)) { diffs.push(`conf ${fa.confidence} -> ${fb.confidence}`); tally.confChanged++; }
    if ((fa.method || '') !== (fb.method || '')) diffs.push(`method ${fa.method} -> ${fb.method}`);
    if (j(fa.corroboration) !== j(fb.corroboration)) diffs.push(`corrob ${j(fa.corroboration)} -> ${j(fb.corroboration)}`);
    if (diffs.length) lines.push(`  ${k}: ${diffs.join(' | ')}`);
  }
  if (lines.length) { tally.docsChanged++; console.log(`${name}:`); for (const l of lines) console.log(l); }
}
console.log('\nTALLY', JSON.stringify(tally));
