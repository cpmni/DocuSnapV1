'use strict';
// OFF vs ON per-doc diff for the class-F realdoc arms (RR_CONSENSUS + RR_DUMP JSONL).
const fs = require('fs');
const OUT = 'c:/GIT Projects/Docusnap/stress_test/out';
const load = (f) => { const m = new Map(); for (const l of fs.readFileSync(`${OUT}/${f}`, 'utf8').split('\n')) { if (!l.trim()) continue; try { const j = JSON.parse(l); m.set(j.id, j); } catch {} } return m; };
const off = load('rr_f_off.jsonl'), on = load('rr_f_on.jsonl');
const offD = load('rr_f_off_dump.jsonl'), onD = load('rr_f_on_dump.jsonl');
const ids = [...new Set([...off.keys(), ...on.keys()])].sort((a, b) => a - b);
let same = 0, changed = [], fileFlip = { gained: [], lost: [] }, wrongGained = [], fClears = [];
const sig = (r) => JSON.stringify({ w: r.wouldFile, reason: r.reason, ref: r.ref && [r.ref.val, r.ref.conf, r.ref.note, r.ref.method], date: r.date && [r.date.val, r.date.conf, r.date.note, r.date.method] });
for (const id of ids) {
  const a = off.get(id), b = on.get(id);
  if (!a || !b) { changed.push({ id, missing: !a ? 'off' : 'on' }); continue; }
  if (sig(a) === sig(b)) { same++; continue; }
  changed.push({ id, off: sig(a), on: sig(b) });
  if (!a.wouldFile && b.wouldFile) fileFlip.gained.push(id);
  if (a.wouldFile && !b.wouldFile) fileFlip.lost.push(id);
  for (const k of ['ref', 'date']) {
    const x = a[k], y = b[k];
    if (x && y && x.correct && !y.correct) wrongGained.push({ id, k, off: x.val, on: y.val });
    if (x && y && x.note && !y.note && String(y.method || '').includes('corrob_verified')) fClears.push({ id, k, val: y.val, conf: [x.conf, y.conf], correct: y.correct, note: x.note });
  }
}
const supChanged = ids.filter(id => offD.get(id) && onD.get(id) && (offD.get(id).sup !== onD.get(id).sup || offD.get(id).wouldFile !== onD.get(id).wouldFile));
console.log(`docs: ${ids.length}  identical: ${same}  changed: ${changed.length}`);
console.log(`would-file OFF: ${[...off.values()].filter(r => r.wouldFile).length}  ON: ${[...on.values()].filter(r => r.wouldFile).length}  gained: ${fileFlip.gained.join(',') || '-'}  lost: ${fileFlip.lost.join(',') || '-'}`);
console.log(`wrong-value GAINED on ref/date (must be 0): ${wrongGained.length} ${JSON.stringify(wrongGained)}`);
console.log(`class-F clears (+corrob_verified, note gone): ${fClears.length} ${JSON.stringify(fClears)}`);
console.log(`supplier/wouldFile changed in dump: ${supChanged.length} ${supChanged.slice(0, 20).join(',')}`);
for (const c of changed.slice(0, 15)) console.log(JSON.stringify(c));
