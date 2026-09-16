// soak_check.js <soakRoot> <minDocId> — boundary + accounting check of the soak against gt.json.
// For each dropped file: the segments the watch produced (documents whose original_filename = <stem>_split_p<range>.pdf,
// or the whole file if not split) vs the expected page ranges. Prints a per-file verdict + the field reads of every
// produced document (supplier / type / ref / date / status / notes) so the boundary can be judged by content too.
'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('C:/GIT Projects/Docusnap/node_modules/better-sqlite3');
const root = process.argv[2], minId = Number(process.argv[3] || 0);
const gt = JSON.parse(fs.readFileSync(path.join(root, 'gt.json'), 'utf8'));
const db = new Database(path.join(root, 'userData', 'docusnap.db'), { readonly: true });
const types = {}; for (const r of db.prepare('SELECT id, name FROM document_types').all()) types[r.id] = r.name;
const docs = db.prepare('SELECT id, original_filename, status, page_count, supplier_name, document_type_id, reference_number, doc_date, overall_confidence, working_path, stored_path FROM documents WHERE id > ? ORDER BY id').all(minId);
const notes = {};
for (const r of db.prepare('SELECT document_id, field_key, display_value, validation_note FROM extractions WHERE document_id > ? AND validation_note IS NOT NULL AND validation_note <> \'\'').all(minId)) (notes[r.document_id] = notes[r.document_id] || []).push(`${r.field_key}: ${r.validation_note}`);
const parseRange = (name, stem) => { const m = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_split_p(\\d+)(?:-(\\d+))?\\.pdf$`, 'i').exec(name); return m ? [Number(m[1]), Number(m[2] || m[1])] : null; };
let filesOk = 0, filesBad = 0, segTotal = 0, held = 0, filed = 0;
const out = [];
for (const [file, g] of Object.entries(gt)) {
  const stem = file.replace(/\.pdf$/i, '');
  const segs = docs.filter(d => parseRange(d.original_filename, stem)).map(d => ({ d, range: parseRange(d.original_filename, stem) })).sort((a, b) => a.range[0] - b.range[0]);
  const whole = docs.find(d => d.original_filename.toLowerCase() === file.toLowerCase());
  const expected = g.docs.map(x => x.pages);
  let actual, verdict;
  if (segs.length) { actual = segs.map(s => s.range); segTotal += segs.length; }
  else if (whole) actual = [[1, g.page_count]];
  else actual = null;
  if (!actual) verdict = 'MISSING (no document produced)';
  else if (JSON.stringify(actual) === JSON.stringify(expected)) verdict = 'OK';
  else verdict = `BOUNDARY MISMATCH expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`;
  if (verdict === 'OK') filesOk++; else filesBad++;
  out.push(`\n${verdict.startsWith('OK') ? 'OK ' : 'BAD'} ${file} (${g.page_count}p, expect ${expected.length} doc(s)) — ${verdict}`);
  const rows = segs.length ? segs.map(s => s.d) : (whole ? [whole] : []);
  for (const d of rows) {
    if (d.status === 'needs_review' || d.status === 'deferred') held++; else if (d.status === 'confirmed') filed++;
    const r = parseRange(d.original_filename, stem);
    out.push(`    #${d.id} p${r ? r.join('-') : '1-' + d.page_count} ${d.page_count}p ${d.status} · ${d.supplier_name || '—'} · ${types[d.document_type_id] || '—'} · ${d.reference_number || '—'} · ${d.doc_date || '—'} · ${d.overall_confidence ?? '—'}%${notes[d.id] ? '  notes: ' + notes[d.id].join(' | ') : ''}`);
  }
  if (segs.length) { const gd = g.docs; segs.forEach((s, i) => { const e = gd.find(x => x.pages[0] === s.range[0]); if (e) out.push(`        expected: ${e.label}`); }); }
}
console.log(out.join('\n'));
console.log(`\nfiles OK ${filesOk} / BAD ${filesBad} · segments produced ${segTotal} · docs held ${held} · auto-filed ${filed} · new docs total ${docs.length}`);
const stray = docs.filter(d => !Object.keys(gt).some(f => d.original_filename.toLowerCase() === f.toLowerCase() || parseRange(d.original_filename, f.replace(/\.pdf$/i, ''))));
if (stray.length) console.log('STRAY new docs (not from a dropped file):', stray.map(d => `#${d.id} ${d.original_filename}`).join(', '));
fs.writeFileSync(path.join(root, 'produced.json'), JSON.stringify(docs.map(d => ({ id: d.id, name: d.original_filename, pages: d.page_count, status: d.status, supplier: d.supplier_name, type: types[d.document_type_id], ref: d.reference_number, date: d.doc_date, path: (d.working_path && fs.existsSync(d.working_path)) ? d.working_path : d.stored_path })), null, 1));
