// soak_e2e_check.js <db> <minId> <gt_e2e.json> — the Oracle's TRUNCATION metric (C6) + boundary accounting over one
// end-to-end import. For every doc with id > minId: map its original_filename (the drain/DB may append "-N") back to
// its source file + page range; a segment whose range is NOT exactly one GT document is a WRONG CUT; a wrong cut that
// AUTO-FILED (status confirmed) with page_count < its GT doc's page span is a TRUNCATION (the harm). Also: multi-page
// heuristic cuts must carry the mig-176 mark; structural sanity of auto-filed 1-page cuts (ref + date + supplier).
const fs = require('fs');
const Database = require('C:/GIT Projects/Docusnap/node_modules/better-sqlite3');
const SP = require('C:/GIT Projects/Docusnap/src/modules/processing/split_plan');
const db = new Database(process.argv[2], { readonly: true });
const minId = Number(process.argv[3]); const gt = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
const docs = db.prepare('SELECT id, original_filename, status, page_count, supplier_name, reference_number, doc_date FROM documents WHERE id > ? ORDER BY id').all(minId);
// EITHER segment-hold family counts as "marked": the mig-176 multi-page sentence OR the mig-180 pair sentence
// (split_plan.SEGMENT_HOLD_MARK / SEGMENT_PAIR_MARK — the belt's job is that neither half of a wrong cut files unseen).
const marks = new Set(db.prepare("SELECT DISTINCT document_id FROM extractions WHERE document_id > ? AND (validation_note LIKE '%were cut from a multi-document scan%' OR validation_note LIKE '%came out of a multi-document scan as a document on%')").all(minId).map(r => r.document_id));
const pairMarks = new Set(db.prepare("SELECT DISTINCT document_id FROM extractions WHERE document_id > ? AND validation_note LIKE '%came out of a multi-document scan as a document on%'").all(minId).map(r => r.document_id));
const stems = Object.keys(gt).map(f => f.replace(/\.pdf$/i, '')).sort((a, b) => b.length - a.length);
function parseOnce(n) {
  for (const s of stems) {
    if (n === s) return { file: s + '.pdf', range: null };
    const m = new RegExp('^' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '_split_p(\\d+)(?:-(\\d+))?$').exec(n);
    if (m) return { file: s + '.pdf', range: [Number(m[1]), Number(m[2] || m[1])] };
  }
  return null;
}
function parse(name) {
  const n = String(name).replace(/\.pdf$/i, '');
  // Try the name as-is FIRST (a range like `_split_p3-4` must not lose its `-4`); only then strip a trailing
  // `-N` (the DB/drain uniquifier for a repeated name) and retry.
  return parseOnce(n) || parseOnce(n.replace(/-\d+$/, ''));
}
const T = { docs: 0, unmatched: 0, exact: 0, wrongCut: 0, truncatedAutoFiled: 0, truncatedHeld: 0, truncatedHeldMarked: 0, truncatedUnmarked: 0, merged: 0, mergedMarked: 0, mergedUnmarked: 0, onePageAuto: 0, onePageAutoIncomplete: 0, whole: 0, pairMarked: 0, pairMarkedExact: 0 };
const bad = [];
for (const d of docs) {
  T.docs++;
  const p = parse(d.original_filename); if (!p) { T.unmatched++; continue; }
  const g = gt[p.file]; const range = p.range || [1, g.page_count];
  const gdocs = g.docs; const covering = gdocs.filter(x => !(x.pages[1] < range[0] || x.pages[0] > range[1]));
  const exact = covering.length === 1 && covering[0].pages[0] === range[0] && covering[0].pages[1] === range[1];
  if (!p.range) T.whole++;
  if (exact) T.exact++;
  else {
    T.wrongCut++;
    const truncated = covering.length === 1 && (range[1] - range[0] + 1) < (covering[0].pages[1] - covering[0].pages[0] + 1);
    const merged = covering.length > 1;
    if (merged) { T.merged++; if (marks.has(d.id)) T.mergedMarked++; else { T.mergedUnmarked++; bad.push(`#${d.id} ${d.original_filename} MERGED cut ${range} spans ${covering.length} GT docs and is NOT marked (status ${d.status})`); } }
    // Oracle C6 (mig 179, 2026-09-17): a HELD wrong cut is a violation too — a false cut whose page 1 lands in Review
    // is still a document sliced in two (the S4 silent class on manual import once a human confirms it unseen).
    // mig 180 (2026-09-17, the segment PAIR hold; Oracle gate): the cut itself still happens — the belt's job is that
    // NEITHER half files unseen. A truncated half that is HELD AND MARKED is the belt working (logged, not a violation);
    // an UNMARKED truncated half (held or filed) is a violation, and an AUTO-FILED one always is.
    if (truncated) {
      if (d.status === 'confirmed') { T.truncatedAutoFiled++; bad.push(`#${d.id} ${d.original_filename} TRUNCATED (pages ${range} of GT ${covering[0].pages}) and AUTO-FILED`); }
      else { T.truncatedHeld++; if (marks.has(d.id)) T.truncatedHeldMarked++; }
      if (!marks.has(d.id)) { T.truncatedUnmarked++; bad.push(`#${d.id} ${d.original_filename} TRUNCATED (pages ${range} of GT ${covering[0].pages} — ${covering[0].label}) and UNMARKED (status=${d.status})`); }
      else console.log(`  truncated half held+marked: #${d.id} ${d.original_filename} pages ${range} of GT ${covering[0].pages} status=${d.status} pair=${pairMarks.has(d.id)}`);
    }
    if (merged) console.log(`  merged cut: #${d.id} ${d.original_filename} pages ${range} spans ${covering.map(c => c.pages.join('-')).join(',')} status=${d.status} marked=${marks.has(d.id)}`);
  }
  if (pairMarks.has(d.id)) { T.pairMarked++; if (exact) { T.pairMarkedExact++; console.log(`  pair-marked but EXACT (a genuine document held for a look): #${d.id} ${d.original_filename} status=${d.status}`); } }
  if (p.range && range[0] === range[1] && d.status === 'confirmed') {
    T.onePageAuto++;
    if (!(String(d.reference_number || '').trim() && String(d.doc_date || '').trim() && String(d.supplier_name || '').trim())) { T.onePageAutoIncomplete++; bad.push(`#${d.id} ${d.original_filename} auto-filed 1-page cut lacks ref/date/supplier (${d.reference_number}|${d.doc_date}|${d.supplier_name})`); }
  }
}
console.log(JSON.stringify(T, null, 1));
console.log(bad.length ? `VIOLATIONS ${bad.length}:\n  ` + bad.join('\n  ') : 'VIOLATIONS 0 — no truncated half auto-filed or unmarked, every merged cut marked, every auto-filed 1-page cut has ref+date+supplier');
