#!/usr/bin/env node
'use strict';
// Unit test for lib/totp.js — RFC 6238 test vector + round-trip + window behaviour.
// Run: node src/lib/test_totp.js  (pure crypto, no native deps)

const totp = require('./totp');

// RFC 6238 Appendix B vector: ASCII secret "12345678901234567890" (SHA-1),
// at T=59s the 8-digit code is 94287082 (6-digit: 287082).
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

let fail = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fail++; };

check('generate 8-digit @T=59 == 94287082', totp.generate(SECRET, { time: 59, digits: 8 }) === '94287082');
check('generate 6-digit @T=59 == 287082',   totp.generate(SECRET, { time: 59, digits: 6 }) === '287082');
check('verify correct code @T=59',          totp.verify('94287082', SECRET, { time: 59, digits: 8 }) === true);
check('verify wrong code @T=59',            totp.verify('00000000', SECRET, { time: 59, digits: 8 }) === false);
check('verify wrong length',                totp.verify('287082', SECRET, { time: 59, digits: 8 }) === false);

// Window: a code from step 1 (T=59) is accepted one step later (T=89, window 1)
// but not two steps later (T=119).
const c1 = totp.generate(SECRET, { time: 59 });
check('within +/-1 window accepted', totp.verify(c1, SECRET, { time: 89 }) === true);
check('outside window rejected',     totp.verify(c1, SECRET, { time: 119 }) === false);

// Round-trip with a freshly generated secret at "now".
const s = totp.generateSecret();
check('generated secret is base32-decodable', (() => { try { totp.base32Decode(s); return true; } catch { return false; } })());
check('round-trip generate/verify @now', totp.verify(totp.generate(s), s) === true);

console.log(fail ? `\n${fail} check(s) FAILED` : '\nAll totp checks passed.');
process.exit(fail ? 1 : 0);
