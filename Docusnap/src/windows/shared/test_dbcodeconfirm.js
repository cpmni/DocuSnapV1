'use strict';
/*
 * Pin: the DB-encryption ceremony proof-of-possession matcher (dbCodeConfirm.js).
 * A future dev must not silently weaken it back to a reflexive click-through.
 */
const assert = require('assert');
const { fold, lastGroup, matches } = require('./dbCodeConfirm.js');

const CODE = 'Z4Y4G-NJC7K-FWQAT-NAAT3-4JWZ3';   // display form, 5 groups of 5
const LAST = '4JWZ3';

let pass = 0, fail = 0;
function ok(label, cond) { if (cond) { pass++; console.log('  OK  ' + label); } else { fail++; console.log('  FAIL ' + label); } }

// lastGroup / fold
ok('lastGroup = the group after the final dash', lastGroup(CODE) === LAST);
ok('fold strips dashes/spaces + uppercases', fold(' z4y4g-njc7k ') === 'Z4Y4GNJC7K');
ok('fold is idempotent', fold(fold(CODE)) === fold(CODE));
ok('fold repairs human misread O/I/L/U', fold('OIL U') === '011V');

// ACCEPT
ok('accepts the exact last block', matches(LAST, CODE));
ok('accepts the last block lowercased', matches('4jwz3', CODE));
ok('accepts the last block with stray spaces', matches('  4JWZ3 ', CODE));
ok('accepts the whole code typed back', matches(CODE, CODE));
ok('accepts the whole code without dashes', matches('Z4Y4GNJC7KFWQATNAAT34JWZ3', CODE));

// REJECT
ok('rejects empty', !matches('', CODE));
ok('rejects null', !matches(null, CODE));
ok('rejects a wrong 5-char block', !matches('AAAAA', CODE));
ok('rejects a different real group (not the last)', !matches('NJC7K', CODE));
ok('rejects too-short input', !matches('JWZ3', CODE));
ok('rejects trailing-substring-but-not-last-group', !matches('X4JWZ3', CODE) || fold('X4JWZ3') === LAST); // 6 chars, folds to X4JWZ3 != 4JWZ3

// Malformed code must NEVER auto-pass
ok('malformed short code => any input fails', !matches('ABCD', 'AB'));
ok('malformed short code => empty fails', !matches('', 'AB'));

// sanity via assert (throws hard if the contract regressed)
assert.strictEqual(matches(LAST, CODE), true);
assert.strictEqual(matches('AAAAA', CODE), false);

console.log(`\ndbcodeconfirm: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
