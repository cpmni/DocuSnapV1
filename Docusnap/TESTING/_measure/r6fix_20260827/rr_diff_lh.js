'use strict';
// OFF vs ON per-doc diff for the LETTERHEAD-SCOPE realdoc arms (RR_CONSENSUS + RR_DUMP JSONL).
// Gate (gary → Oracle): supplier accuracy unchanged · 0 wrong values gained on ref/date · would-file lost = 0
// · per-TEMPLATE match counts OFF == ON (the owner's own PO layout keeps every recognition) · M / M_type
// read from the two .md summaries by hand.
const fs = require('fs');
const OUT = 'c:/GIT Projects/Docusnap/stress_test/out';
const load = (f) => { const m = new Map(); for (const l of fs.readFileSync(`${OUT}/${f}`, 'utf8').split('\n')) { if (!l.trim()) continue; try { const j = JSON.parse(l); m.set(j.id, j); } catch {} } return m; };
const off = load('rr_lh_off.jsonl'), on = load('rr_lh_on.jsonl');
const offD = load('rr_lh_off_dump.jsonl'), onD = load('rr_lh_on_dump.jsonl');
const ids = [...new Set([...off.keys(), ...on.keys()])].sort((a, b) => a - b);
let same = 0, changed = [], fileFlip = { gained: [], lost: [] }, wrongGained = [];
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
  }
}
const dumpIds = [...new Set([...offD.keys(), ...onD.keys()])].sort((a, b) => a - b);
const supChanged = dumpIds.filter(id => offD.get(id) && onD.get(id) && offD.get(id).sup !== onD.get(id).sup);
const methodChanged = dumpIds.filter(id => offD.get(id) && onD.get(id) && offD.get(id).sup === onD.get(id).sup && offD.get(id).supMethod !== onD.get(id).supMethod);
const tmplCount = (m) => { const c = new Map(); for (const r of m.values()) { const k = r.tmpl == null ? 'none' : String(r.tmpl); c.set(k, (c.get(k) || 0) + 1); } return c; };
const tOff = tmplCount(offD), tOn = tmplCount(onD);
const tKeys = [...new Set([...tOff.keys(), ...tOn.keys()])].sort((a, b) => (a === 'none') - (b === 'none') || Number(a) - Number(b));
const tmplDiff = tKeys.filter(k => (tOff.get(k) || 0) !== (tOn.get(k) || 0)).map(k => `${k}: ${tOff.get(k) || 0}→${tOn.get(k) || 0}`);
const bwOff = [...offD.values()].filter(r => /bramblewood/i.test(r.sup || '')).length;
const bwOn = [...onD.values()].filter(r => /bramblewood/i.test(r.sup || '')).length;
console.log(`docs: ${ids.length}  identical: ${same}  changed: ${changed.length}`);
console.log(`would-file OFF: ${[...off.values()].filter(r => r.wouldFile).length}  ON: ${[...on.values()].filter(r => r.wouldFile).length}  gained: ${fileFlip.gained.join(',') || '-'}  lost: ${fileFlip.lost.join(',') || '-'}`);
console.log(`wrong-value GAINED on ref/date (must be 0): ${wrongGained.length} ${JSON.stringify(wrongGained)}`);
console.log(`supplier CHANGED in dump (must be 0 unless a wrong claim was released): ${supChanged.length} ${supChanged.slice(0, 20).map(id => `${id}:${offD.get(id).sup}→${onD.get(id).sup}`).join(' | ')}`);
console.log(`supplier method changed, same value: ${methodChanged.length} ${methodChanged.slice(0, 20).map(id => `${id}:${offD.get(id).supMethod}→${onD.get(id).supMethod}`).join(' | ')}`);
console.log(`per-template match counts that differ OFF→ON (must be empty): ${tmplDiff.length ? tmplDiff.join(' | ') : 'none'}`);
console.log(`docs stamped Bramblewood: OFF ${bwOff}  ON ${bwOn}`);
for (const c of changed.slice(0, 15)) console.log(JSON.stringify(c));
