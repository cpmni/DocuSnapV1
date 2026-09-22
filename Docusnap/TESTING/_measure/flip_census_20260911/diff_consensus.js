'use strict';
/*
 * diff_consensus.js  OFF.jsonl  ON.jsonl
 * Diffs two RR_CONSENSUS dumps (realdoc_regression.js:364) for a single-arc flip gate.
 * Reports:  M (silent wrong reads introduced ON) · filer-set changes · new-filer==GT.
 * Reads the owner's own values; output is local only (gitignored dir). No writes.
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron diff_consensus.js off.jsonl on.jsonl
 */
const fs = require('fs');
const [offP, onP] = process.argv.slice(2);
if (!offP || !onP) { console.error('usage: diff_consensus.js OFF.jsonl ON.jsonl'); process.exit(2); }
const load = p => {
  const m = {};
  for (const ln of fs.readFileSync(p, 'utf8').split('\n')) {
    const t = ln.trim(); if (t[0] !== '{') continue;
    let o; try { o = JSON.parse(t); } catch { continue; }
    m[o.id] = o;
  }
  return m;
};
const OFF = load(offP), ON = load(onP);
const ids = [...new Set([...Object.keys(OFF), ...Object.keys(ON)])];

const fv = (o, k) => (o && o[k] && o[k].val != null) ? String(o[k].val) : '';   // ref|date
const trunc = s => (s || '').length > 40 ? s.slice(0, 40) + '…' : (s || '∅');
const fieldVals = o => o && o.fields ? Object.fromEntries(Object.entries(o.fields).map(([k, a]) => [k, a && a[0] != null ? String(a[0]) : ''])) : {};

let mHard = [], valDelta = [], filerRemoved = [], filerNewGood = [], filerNewBad = [];

for (const id of ids) {
  const a = OFF[id], b = ON[id];
  if (!a || !b) { console.log(`  [only in ${a ? 'OFF' : 'ON'}] id=${id}`); continue; }

  // ── M: a role read that was CORRECT off is WRONG on (silent regression to a wrong value)
  for (const k of ['ref', 'date']) {
    if (a[k] && b[k] && a[k].correct === true && b[k].correct === false)
      mHard.push(`id=${id} ${k}: OFF='${trunc(fv(a,k))}'(GT✓) -> ON='${trunc(fv(b,k))}'(GT✗)`);
  }
  // ── any value delta OFF->ON (the review set — includes benign + the mHard above)
  if (fv(a,'ref') !== fv(b,'ref')) valDelta.push(`id=${id} ref: '${trunc(fv(a,'ref'))}' -> '${trunc(fv(b,'ref'))}'${b.ref&&b.ref.correct===false?' [GT✗]':''}`);
  if (fv(a,'date') !== fv(b,'date')) valDelta.push(`id=${id} date: '${trunc(fv(a,'date'))}' -> '${trunc(fv(b,'date'))}'${b.date&&b.date.correct===false?' [GT✗]':''}`);
  const fa = fieldVals(a), fb = fieldVals(b);
  for (const k of new Set([...Object.keys(fa), ...Object.keys(fb)]))
    if ((fa[k]||'') !== (fb[k]||'')) valDelta.push(`id=${id} ${k}: '${trunc(fa[k])}' -> '${trunc(fb[k])}'`);

  // ── filer set
  if (a.wouldFile && !b.wouldFile) filerRemoved.push(`id=${id} (ON reason: ${b.reason||'?'})`);
  if (!a.wouldFile && b.wouldFile) {
    const gtOk = (!b.ref || b.ref.correct !== false) && (!b.date || b.date.correct !== false);
    (gtOk ? filerNewGood : filerNewBad).push(`id=${id} ref='${trunc(fv(b,'ref'))}'${b.ref?`(GT${b.ref.correct?'✓':b.ref.correct===false?'✗':'?'})`:''} date='${trunc(fv(b,'date'))}'`);
  }
}

const sec = (title, arr) => { console.log(`\n${title}: ${arr.length}`); arr.slice(0, 60).forEach(x => console.log('   ' + x)); if (arr.length > 60) console.log(`   … +${arr.length-60} more`); };
console.log(`docs: OFF=${Object.keys(OFF).length} ON=${Object.keys(ON).length}`);
sec('M — CORRECT-off -> WRONG-on (HARD FAIL if > 0)', mHard);
sec('filer REMOVED off->on (REGRESSION if > 0; breaks wouldFile(ON)⊇wouldFile(OFF))', filerRemoved);
sec('new filer with WRONG value (FAIL if > 0; breaks new-filers==GT)', filerNewBad);
sec('new filer == GT (the arc\'s intended wins)', filerNewGood);
sec('all value deltas off->on (review; benign + the M rows above)', valDelta);

const pass = mHard.length === 0 && filerRemoved.length === 0 && filerNewBad.length === 0;
console.log(`\nGATE: ${pass ? 'PASS (M=0, no removed filer, no wrong new filer)' : 'FAIL — see above'}`);
process.exit(pass ? 0 : 1);
