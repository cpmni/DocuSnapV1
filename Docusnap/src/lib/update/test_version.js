#!/usr/bin/env node
'use strict';

/**
 * src/lib/update/test_version.js — guards the garbage-safe SemVer comparator.
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/lib/update/test_version.js
 */
const { compareVersions, isNewer } = require('./version');

let fails = 0;
function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; }

console.log('compareVersions — ordering');
check("equal 2.0.0/2.0.0 → 0",        compareVersions('2.0.0', '2.0.0') === 0);
check("patch 2.0.1 > 2.0.0",          compareVersions('2.0.1', '2.0.0') === 1);
check("minor 2.1.0 > 2.0.9",          compareVersions('2.1.0', '2.0.9') === 1);
check("major 3.0.0 > 2.9.9",          compareVersions('3.0.0', '2.9.9') === 1);
check("lower 2.0.0 < 2.0.1",          compareVersions('2.0.0', '2.0.1') === -1);

console.log('\npadding / truncation / normalisation');
check("2.0 == 2.0.0",                 compareVersions('2.0', '2.0.0') === 0);
check("2.0.0.1 (MSIX 4-part) tolerated, compares on first 3 → 0", compareVersions('2.0.0.1', '2.0.0') === 0);
check("leading zeros 2.01.0 == 2.1.0", compareVersions('2.01.0', '2.1.0') === 0);
check("leading v stripped: v2.1.0 > 2.0.0", compareVersions('v2.1.0', '2.0.0') === 1);
check("pre-release stripped: 2.0.0-beta == 2.0.0", compareVersions('2.0.0-beta', '2.0.0') === 0);
check("build metadata stripped: 2.0.0+r123 == 2.0.0", compareVersions('2.0.0+r123', '2.0.0') === 0);

console.log('\ngarbage-safe (never throws; unparseable → 0 / no update)');
for (const g of ['', null, undefined, 'abc', '2.x.0', {}, [], '   ', '2.0.0.0.0', 'v', '-1.0.0']) {
  let threw = false, r = null;
  try { r = compareVersions(g, '2.0.0'); } catch { threw = true; }
  check(`compareVersions(${JSON.stringify(g)}, '2.0.0') → 0, no throw`, !threw && r === 0);
}

console.log('\nisNewer — the "update available" predicate');
check("isNewer(2.1.0, 2.0.0) → true",  isNewer('2.1.0', '2.0.0') === true);
check("isNewer(2.0.0, 2.0.0) → false", isNewer('2.0.0', '2.0.0') === false);
check("client AHEAD: isNewer(2.0.0, 2.1.0) → false (dev/beta never nags)", isNewer('2.0.0', '2.1.0') === false);
check("isNewer(garbage, 2.0.0) → false", isNewer('nope', '2.0.0') === false);
check("isNewer(null, 2.0.0) → false",    isNewer(null, '2.0.0') === false);

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}`);
process.exit(fails === 0 ? 0 : 1);
