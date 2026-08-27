// Per-doc diff of the targeted realdoc A/B: OFF (required=0 roles) vs ON (mig-92 heal) on the 165 worksheet docs.
const fs = require('fs'), path = require('path');
const S = process.argv[2];
const load = (f) => Object.fromEntries(fs.readFileSync(path.join(S, f), 'utf8').split('\n').filter(Boolean).map(l => { const o = JSON.parse(l); return [o.id, o]; }));
const off = load('rr_ws_off.jsonl'), on = load('rr_ws_on.jsonl');
const ids = Object.keys(off).map(Number).sort((a, b) => a - b);
let flipsTF = 0, flipsFT = 0, same = 0, valueDiff = 0;
const byReasonOff = {}, byReasonOn = {}, flipped = [];
const cnt = (m, k) => { m[k] = (m[k] || 0) + 1; };
for (const id of ids) {
  const a = off[id], b = on[id];
  if (!b) { console.log('missing ON row for', id); continue; }
  cnt(byReasonOff, a.wouldFile ? 'would-file' : (a.reason || 'held')); cnt(byReasonOn, b.wouldFile ? 'would-file' : (b.reason || 'held'));
  const va = JSON.stringify([a.ref && a.ref.val, a.date && a.date.val, Object.entries(a.fields || {}).map(([k, v]) => [k, v[0]])]);
  const vb = JSON.stringify([b.ref && b.ref.val, b.date && b.date.val, Object.entries(b.fields || {}).map(([k, v]) => [k, v[0]])]);
  if (va !== vb) valueDiff++;
  if (a.wouldFile === b.wouldFile) same++;
  else if (!a.wouldFile && b.wouldFile) { flipsFT++; flipped.push({ id, sup: (b.fields && b.fields.supplier_name && b.fields.supplier_name[0]) || null, offReason: a.reason, offOverall: a.overall, onOverall: b.overall, refOk: b.ref && b.ref.correct, dateOk: b.date && b.date.correct }); }
  else { flipsTF++; flipped.push({ id, dir: 'true->false', offOverall: a.overall, onOverall: b.overall, onReason: b.reason }); }
}
console.log('docs', ids.length, 'same verdict', same, 'held->would-file', flipsFT, 'would-file->held', flipsTF, 'value diffs', valueDiff);
console.log('OFF reasons', JSON.stringify(byReasonOff));
console.log('ON  reasons', JSON.stringify(byReasonOn));
const wrong = flipped.filter(f => f.dir !== 'true->false' && (f.refOk === false || f.dateOk === false));
console.log('flipped-to-would-file with a WRONG ref/date:', wrong.length, JSON.stringify(wrong));
const bySup = {}; for (const f of flipped) if (!f.dir) cnt(bySup, f.sup);
console.log('held->would-file by supplier', JSON.stringify(bySup));
const notFlipped = ids.filter(id => !off[id].wouldFile && !on[id].wouldFile).map(id => ({ id, reason: on[id].reason, overall: on[id].overall, sup: on[id].fields && on[id].fields.supplier_name && on[id].fields.supplier_name[0] }));
console.log('still held ON:', notFlipped.length, JSON.stringify(notFlipped.slice(0, 30)));
console.log('sample flip:', JSON.stringify(flipped[0]));
console.log('overall OFF->ON on flips:', JSON.stringify(flipped.slice(0, 8).map(f => [f.id, f.offOverall, f.onOverall])));
