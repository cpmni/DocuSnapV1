'use strict';
/*
 * test_slip_pack.js — pins the pack numbering/clamp/name helpers (Filing Slips slice 2).
 * Plain Node. Run: node src/modules/processing/test_slip_pack.js
 */
const { clampSlipCount, nextSlipRange, slipPackName, pad4 } = require('./slip_pack');

let fails = 0;
const check = (label, cond, extra) => {
  console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? `  [${extra}]` : ''}`);
  if (!cond) fails++;
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('§1 clampSlipCount — invalid → default 10, valid → clamp 1–50');
check('undefined → 10', clampSlipCount(undefined) === 10);
check('NaN/garbage → 10', clampSlipCount('x') === 10);
check('0 → 1', clampSlipCount(0) === 1);
check('-5 → 1', clampSlipCount(-5) === 1);
check('51 → 50', clampSlipCount(51) === 50);
check('10.7 → 10', clampSlipCount(10.7) === 10);
check("'25' → 25", clampSlipCount('25') === 25);

console.log('§2 nextSlipRange — counter semantics + restart-at-1 wrap (never a mixed-wrap pack)');
check('fresh counter', eq(nextSlipRange(1, 10), { first: 1, last: 10, next: 11 }));
check('string current', eq(nextSlipRange('7', 5), { first: 7, last: 11, next: 12 }));
check('would pass 9999 → whole pack restarts at 1', eq(nextSlipRange(9995, 10), { first: 1, last: 10, next: 11 }));
check('exactly reaching 9999 wraps next to 1', eq(nextSlipRange(9990, 10), { first: 9990, last: 9999, next: 1 }));
check('invalid current → 1', eq(nextSlipRange(0, 3), { first: 1, last: 3, next: 4 }));
check('out-of-range current → 1', eq(nextSlipRange(10000, 3), { first: 1, last: 3, next: 4 }));

console.log('§3 names');
check('slipPackName pads to 4', slipPackName(7, 16) === 'Filing slips 0007-0016.pdf');
check('pad4', pad4(7) === '0007' && pad4(9999) === '9999');

console.log(`\n${fails ? 'FAIL' : 'PASS'} — ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
