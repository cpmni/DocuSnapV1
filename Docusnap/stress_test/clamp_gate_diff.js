'use strict';
/*
 * clamp_gate_diff.js — ANCHOR_LABEL_LEFT_CLAMP OFF-vs-ON gate evaluator (G1-G6,
 * Oracle SIGN-OFF-W/COND 2026-08-01).
 *
 * Consumes the two RR_CONSENSUS jsonl dumps (+ RR_DUMP supplier dumps) produced by
 * back-to-back realdoc_regression.js runs:
 *   OFF: clamp_off.jsonl / clamp_off_dump.jsonl
 *   ON:  clamp_on.jsonl  / clamp_on_dump.jsonl
 * and prints the gate verdicts:
 *   G1  outside the class, OFF==ON (per-doc ref/date VALUES identical; changes listed)
 *   M   zero value flips correct→wrong; zero would-auto-file-wrong on ON
 *   G2  anchor_crop_recovered rows shrink-or-equal, none ≥88 conf, none on a
 *       would-auto-file+wrong doc
 *   G6  total flag count (ref+date+supplier notes) must not rise
 *   Saltmarsh: every Saltmarsh doc's ref correct on ON + zero recovered
 * (G5 throughput is wall-clock, printed by the runner. ws09 identity is covered by
 *  G1's per-doc value diff — any change on it would list here.)
 *
 * Run: node stress_test/clamp_gate_diff.js
 */
const fs = require('fs'), path = require('path');
const OUT = path.join('c:/GIT Projects/Docusnap', 'stress_test', 'out');

const load = f => fs.readFileSync(path.join(OUT, f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const byId = rows => { const m = {}; for (const r of rows) m[r.id] = r; return m; };

const off = byId(load('clamp_off.jsonl')), on = byId(load('clamp_on.jsonl'));
const offD = byId(load('clamp_off_dump.jsonl')), onD = byId(load('clamp_on_dump.jsonl'));

const ids = Object.keys(off).filter(id => on[id]);
const missing = Object.keys(off).length - ids.length + Object.keys(on).length - ids.length;

const V = r => ({ ref: r.ref ? String(r.ref.val ?? '') : null, date: r.date ? String(r.date.val ?? '') : null });
const notes = (r, d) => ['ref', 'date'].filter(k => r[k] && String(r[k].note || '').trim()).length
                      + ((d && String(d.supNote || '').trim()) ? 1 : 0);
const recovered = r => ['ref', 'date'].filter(k => r[k] && r[k].method === 'anchor_crop_recovered');

let valueChanges = [], flips = [], heals = [];
let flagsOff = 0, flagsOn = 0, recOff = 0, recOn = 0;
let recOnHigh = [], recOnWrongFile = [];
let mOn = 0, mOnDocs = [], wfOff = 0, wfOn = 0;

for (const id of ids) {
  const o = off[id], n = on[id], od = offD[id] || {}, nd = onD[id] || {};
  const vo = V(o), vn = V(n);
  for (const k of ['ref', 'date']) {
    if (vo[k] !== vn[k]) {
      valueChanges.push(`#${id} ${k}: '${vo[k]}' -> '${vn[k]}' (correct ${o[k]?.correct} -> ${n[k]?.correct})`);
      if (o[k]?.correct === true && n[k]?.correct === false) flips.push(`#${id} ${k}`);
      if (o[k]?.correct === false && n[k]?.correct === true) heals.push(`#${id} ${k}`);
    }
  }
  if (String(od.sup || '') !== String(nd.sup || '')) valueChanges.push(`#${id} supplier: '${od.sup}' -> '${nd.sup}'`);
  flagsOff += notes(o, od); flagsOn += notes(n, nd);
  recOff += recovered(o).length;
  const rn = recovered(n);
  recOn += rn.length;
  for (const k of rn) {
    if (n[k].conf != null && n[k].conf >= 88) recOnHigh.push(`#${id} ${k}@${n[k].conf}`);
    if (n.wouldFile && n[k].correct === false) recOnWrongFile.push(`#${id} ${k}`);
  }
  if (o.wouldFile) wfOff++;
  if (n.wouldFile) wfOn++;
  if (n.wouldFile && ['ref', 'date'].some(k => n[k] && n[k].correct === false)) { mOn++; mOnDocs.push(`#${id}`); }
}
// The M gate is DELTA-scoped: the clamp must add no NEW would-auto-file-wrong doc.
// (The corpus carries a pre-existing M set — GT-poison + the stroke-substitution class —
// visible identically in the OFF baseline; an absolute-zero comparator would fail every
// change on inherited debt instead of the change under test.)
const mSet = run => Object.keys(run).filter(id => run[id].wouldFile
  && ['ref', 'date'].some(k => run[id][k] && run[id][k].correct === false));
const mNew = mSet(on).filter(id => !mSet(off).includes(id));
// G2 ≥88 likewise: only a recovered row the clamp CHANGED counts (a pre-existing
// recovered@90 identical in both runs is inherited, not lifted).
recOnHigh = recOnHigh.filter(tag => {
  const id = tag.slice(1).split(' ')[0];
  const o = off[id], n = on[id];
  return !o || ['ref', 'date'].some(k => JSON.stringify((o[k] || {})) !== JSON.stringify((n[k] || {})));
});

// Saltmarsh subset (ON run): ref correct + zero recovered.
const salt = ids.filter(id => /saltmarsh/i.test(String((onD[id] || {}).sup || (offD[id] || {}).sup || '')));
// Delta-scoped like M: a ref wrong in BOTH runs is inherited corpus debt, not a clamp casualty.
const saltBad = salt.filter(id => on[id].ref && on[id].ref.correct === false
                                && !(off[id].ref && off[id].ref.correct === false));
const saltRec = salt.filter(id => recovered(on[id]).length);
const saltEligible = salt.filter(id => on[id].wouldFile).length;

console.log(`docs compared: ${ids.length} (${missing} unmatched between runs)`);
console.log(`\nG1 per-doc value changes OFF->ON: ${valueChanges.length}`);
valueChanges.slice(0, 60).forEach(x => console.log('  ' + x));
console.log(`  heals (wrong->correct): ${heals.length} ${heals.join(' ')}`);
console.log(`\nM  correct->wrong flips: ${flips.length} ${flips.join(' ')}  (MUST be 0)`);
console.log(`M  ON would-auto-file-wrong (ref/date): ${mOn} ${mOnDocs.join(' ')} — NEW vs OFF: ${mNew.length} ${mNew.map(i => '#' + i).join(' ')}  (NEW MUST be 0)`);
console.log(`\nG6 flag count (ref+date+supplier notes): OFF ${flagsOff} -> ON ${flagsOn}  (must not rise)`);
console.log(`\nG2 anchor_crop_recovered rows: OFF ${recOff} -> ON ${recOn}  (shrink-or-equal)`);
console.log(`G2 recovered ≥88 conf NEW/CHANGED on ON: ${recOnHigh.length} ${recOnHigh.join(' ')}  (MUST be 0)`);
console.log(`G2 recovered on would-file+wrong doc: ${recOnWrongFile.length} ${recOnWrongFile.join(' ')}  (MUST be 0)`);
console.log(`\nwould-auto-file: OFF ${wfOff} -> ON ${wfOn}`);
console.log(`\nSaltmarsh (${salt.length} docs, ON run): ref wrong ${saltBad.length} ${saltBad.map(i => '#' + i).join(' ')} · recovered ${saltRec.length} · would-file ${saltEligible}`);

const pass = flips.length === 0 && mNew.length === 0 && flagsOn <= flagsOff && recOn <= recOff
          && recOnHigh.length === 0 && recOnWrongFile.length === 0 && saltBad.length === 0 && saltRec.length === 0;
console.log(`\nGATES: ${pass ? 'ALL PASS' : 'FAIL'}`);
process.exit(pass ? 0 : 1);
