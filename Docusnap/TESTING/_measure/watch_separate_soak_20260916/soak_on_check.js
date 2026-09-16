// soak_on_check.js <db> <minId> [maxId] — belt-ON verification over the docs produced by one arm (ids in (min,max]).
// Buckets: multi-page split segments / 1-page split segments / whole files. For each: how many carry the
// segment-hold mark, how many auto-filed (status confirmed), how many the ONE predicate would file now.
const path = require('path');
const Database = require('C:/GIT Projects/Docusnap/node_modules/better-sqlite3');
const trust = require('C:/GIT Projects/Docusnap/database/modules/trust');
const SP = require('C:/GIT Projects/Docusnap/src/modules/processing/split_plan');
const db = new Database(process.argv[2], { readonly: true });
const minId = Number(process.argv[3] || 0), maxId = Number(process.argv[4] || 1e9);
const docs = db.prepare('SELECT * FROM documents WHERE id > ? AND id <= ? ORDER BY id').all(minId, maxId);
const notes = {};
for (const r of db.prepare('SELECT document_id, field_key, validation_note FROM extractions WHERE document_id > ? AND document_id <= ? AND TRIM(COALESCE(validation_note,\'\')) <> \'\'').all(minId, maxId)) (notes[r.document_id] = notes[r.document_id] || []).push(r);
// Classify by the app's own page_count (authoritative) — the DB uniquifies a repeated original_filename with a
// trailing "-N", which makes a name regex misread "_split_p4-1" as a page range.
const kind = (n, pc) => /_split_p\d+/i.test(n) ? ((pc || 1) >= 2 ? 'multi-page cut' : '1-page cut') : 'whole file';
const tally = {};
const bad = [];
for (const d of docs) {
  const k = kind(d.original_filename, d.page_count);
  const t = tally[k] = tally[k] || { n: 0, marked: 0, autoFiled: 0, eligibleNow: 0, held: 0 };
  t.n++;
  const marked = (notes[d.id] || []).some(e => SP.hasSegmentHold(e.validation_note));
  if (marked) t.marked++;
  if (d.status === 'confirmed') t.autoFiled++;
  let el = false; try { el = d.status !== 'confirmed' && !!trust.isAutoFileEligible(db, d).eligible; } catch {}
  if (el) t.eligibleNow++;
  if (d.status === 'needs_review') t.held++;
  if (k === 'multi-page cut' && (!marked || d.status === 'confirmed' || el)) bad.push(`#${d.id} ${d.original_filename} marked=${marked} status=${d.status} eligibleNow=${el}`);
  if (k !== 'multi-page cut' && marked) bad.push(`#${d.id} ${d.original_filename} UNEXPECTED mark on a ${k}`);
}
console.log(`docs ${docs.length} (ids ${minId + 1}..${docs.length ? docs[docs.length - 1].id : '-'})`);
for (const [k, t] of Object.entries(tally)) console.log(`  ${k.padEnd(15)} n=${t.n} marked=${t.marked} autoFiled=${t.autoFiled} eligibleNow=${t.eligibleNow} held=${t.held}`);
console.log(bad.length ? `VIOLATIONS ${bad.length}:\n  ` + bad.join('\n  ') : 'VIOLATIONS 0 — every multi-page cut marked + not filed + not eligible; no mark on any 1-page cut or whole file');
const sample = docs.filter(d => kind(d.original_filename, d.page_count) === 'multi-page cut').slice(0, 2);
for (const d of sample) console.log(`  e.g. #${d.id} ${d.original_filename}: ${(notes[d.id] || []).map(e => e.field_key + ': ' + e.validation_note).join(' | ')}`);
