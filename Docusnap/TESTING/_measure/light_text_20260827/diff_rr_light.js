// diff_rr_light.js — the light-text realdoc gate: per-doc OFF vs ON deltas (Oracle condition 6).
//   ELECTRON_RUN_AS_NODE=1 electron TESTING/_measure/light_text_20260827/diff_rr_light.js <dir>
// Reads <dir>/rr_light_off.jsonl + rr_light_on.jsonl (RR_CONSENSUS rows: wouldFile/reason/overall/ref/date/fields),
// <dir>/rr_light_{off,on}_dump.jsonl (supplier/method/template per doc) and rr_light_{off,on}_type.jsonl (type per doc).
// Prints: would-file OFF/ON, held→file and file→held lists, WRONG would-files gained/lost (ref/date correctness from
// the consensus rows), supplier/method/template/type deltas, and the docs whose serial_number changed.
const fs = require('fs'), path = require('path');
const S = process.argv[2];
const load = (f) => { const p = path.join(S, f); if (!fs.existsSync(p)) return {}; return Object.fromEntries(fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => { const o = JSON.parse(l); return [o.id, o]; })); };
const off = load('rr_light_off.jsonl'), on = load('rr_light_on.jsonl');
const dOff = load('rr_light_off_dump.jsonl'), dOn = load('rr_light_on_dump.jsonl');
const tOff = load('rr_light_off_type.jsonl'), tOn = load('rr_light_on_type.jsonl');
const ids = Object.keys(off).map(Number).filter(id => on[id]).sort((a, b) => a - b);
const wrong = (r) => (r.ref && r.ref.correct === false) || (r.date && r.date.correct === false);
let wfOff = 0, wfOn = 0, wrongOff = 0, wrongOn = 0;
const heldToFile = [], fileToHeld = [], wrongGained = [], wrongLost = [], supDelta = [], methDelta = [], tplDelta = [], typeDelta = [], serialDelta = [];
for (const id of ids) {
  const a = off[id], b = on[id];
  if (a.wouldFile) wfOff++; if (b.wouldFile) wfOn++;
  const wa = a.wouldFile && wrong(a), wb = b.wouldFile && wrong(b);
  if (wa) wrongOff++; if (wb) wrongOn++;
  if (!wa && wb) wrongGained.push({ id, ref: b.ref, date: b.date });
  if (wa && !wb) wrongLost.push({ id });
  if (!a.wouldFile && b.wouldFile) heldToFile.push({ id, offReason: a.reason, offOverall: a.overall, onOverall: b.overall, refOk: b.ref && b.ref.correct, dateOk: b.date && b.date.correct });
  if (a.wouldFile && !b.wouldFile) fileToHeld.push({ id, onReason: b.reason, offOverall: a.overall, onOverall: b.overall });
  const da = dOff[id] || {}, db = dOn[id] || {};
  if (da.sup !== db.sup) supDelta.push({ id, off: da.sup, on: db.sup });
  if (da.supMethod !== db.supMethod) methDelta.push({ id, off: da.supMethod, on: db.supMethod });
  if (da.tmpl !== db.tmpl) tplDelta.push({ id, off: da.tmpl, on: db.tmpl });
  const ta = tOff[id] || {}, tb = tOn[id] || {};
  if (ta.got !== tb.got) typeDelta.push({ id, off: ta.got, on: tb.got, gt: ta.gt });
  const sa = (a.fields && a.fields.serial_number && a.fields.serial_number[0]) || '', sb = (b.fields && b.fields.serial_number && b.fields.serial_number[0]) || '';
  if (sa !== sb) serialDelta.push({ id, off: sa, on: sb });
}
console.log(`docs ${ids.length} · would-file OFF ${wfOff} → ON ${wfOn} · WRONG would-file OFF ${wrongOff} → ON ${wrongOn} (gained ${wrongGained.length}, lost ${wrongLost.length})`);
console.log('held→file', heldToFile.length, JSON.stringify(heldToFile.slice(0, 20)));
console.log('file→held', fileToHeld.length, JSON.stringify(fileToHeld.slice(0, 20)));
console.log('WRONG gained', JSON.stringify(wrongGained));
console.log('supplier deltas', supDelta.length, JSON.stringify(supDelta.slice(0, 10)));
console.log('supplier-method deltas', methDelta.length, JSON.stringify(methDelta.slice(0, 10)));
console.log('template deltas', tplDelta.length, JSON.stringify(tplDelta.slice(0, 10)));
console.log('type deltas', typeDelta.length, JSON.stringify(typeDelta.slice(0, 10)));
console.log('serial_number deltas', serialDelta.length, JSON.stringify(serialDelta.slice(0, 30)));
const perTpl = (d) => { const m = {}; for (const id of ids) { const t = (d[id] || {}).tmpl; m[t] = (m[t] || 0) + 1; } return m; };
const po = perTpl(dOff), pn = perTpl(dOn);
const tplCountDelta = Object.keys({ ...po, ...pn }).filter(k => (po[k] || 0) !== (pn[k] || 0)).map(k => [k, po[k] || 0, pn[k] || 0]);
console.log('per-template match-count deltas', JSON.stringify(tplCountDelta));
