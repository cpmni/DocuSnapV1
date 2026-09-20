'use strict';
// Compare the OFF vs ON arms of the anchor_code_left_grow safety census.
//   M=0 gate      : the ON arm never makes a would-file REF value WRONG (val != confirmed GT while wouldFile).
//   no accuracy drop: total correct REF reads ON >= OFF.
//   delta confined : any change is a ref whose crop_fullpage_disagree flag CLEARED on convergence (value == GT).
//   false-flag census: count crop_fullpage_disagree / XCHECK "disagreed" fires OFF vs ON (the click-clear win).
const fs = require('fs');
const path = require('path');
const DIR = __dirname;
const load = (f) => {
  const m = new Map();
  for (const ln of fs.readFileSync(path.join(DIR, f), 'utf8').split('\n')) {
    if (!ln.trim()) continue;
    const r = JSON.parse(ln);
    m.set(r.id, r);
  }
  return m;
};
const OFF = load('base_off.jsonl');
const ON = load('on_anchor.jsonl');
const isFlag = (r) => !!(r && r.ref && ((r.ref.method || '').includes('crosscheck') || /disagree/i.test(r.ref.note || '')));
const correct = (m) => [...m.values()].filter(r => r.ref && r.ref.correct === true).length;

let mViol = 0, changed = 0, clearedFlags = 0, accDrop = 0;
const changes = [];
for (const [id, on] of ON) {
  const off = OFF.get(id);
  if (!off) continue;
  const offV = off.ref && off.ref.val, onV = on.ref && on.ref.val;
  // M=0: a would-file ref that ON reads WRONG (against GT)
  if (on.wouldFile && on.ref && on.ref.correct === false) mViol++;
  // accuracy drop on this doc: OFF read correct, ON read wrong
  if (off.ref && off.ref.correct === true && on.ref && on.ref.correct === false) accDrop++;
  if (offV !== onV || isFlag(off) !== isFlag(on) || off.wouldFile !== on.wouldFile) {
    changed++;
    if (isFlag(off) && !isFlag(on)) clearedFlags++;
    changes.push({ id, offV, onV, offFlag: isFlag(off), onFlag: isFlag(on),
                   offFile: off.wouldFile, onFile: on.wouldFile, onCorrect: on.ref && on.ref.correct });
  }
}
const offFlags = [...OFF.values()].filter(isFlag).length;
const onFlags = [...ON.values()].filter(isFlag).length;

console.log('=== anchor_code_left_grow SAFETY census ===');
console.log(`docs compared: ${ON.size} (OFF ${OFF.size})`);
console.log(`REF correct: OFF ${correct(OFF)}  ON ${correct(ON)}   (accuracy drop on ${accDrop} doc(s))`);
console.log(`crop_fullpage_disagree/XCHECK flags: OFF ${offFlags}  ON ${onFlags}   (cleared by convergence: ${clearedFlags})`);
console.log(`docs changed OFF->ON: ${changed}`);
console.log(`M violations (would-file ref WRONG under ON): ${mViol}`);
for (const c of changes.slice(0, 40)) console.log('  ', JSON.stringify(c));
const pass = (mViol === 0 && accDrop === 0);
console.log(`\nGATE: ${pass ? 'PASS (M=0, no accuracy drop)' : 'FAIL'}`);
process.exit(pass ? 0 : 1);
