#!/usr/bin/env node
'use strict';
/**
 * scripts/test_build_release.js — pins the release orchestrator's pure composeEnv()/gateSequence()
 * (slice 2.7 of docs/designs/AUDIT_FIX_PLAN_2026-09-08.md; Oracle C5): a release env is hardened + signing-off
 * + stripped of every test/kill variable regardless of the shell; a test env is plain + TEST_BUILD=1 + a -TEST
 * rev; HARDEN_JS=0 is an explicit, flagged escape; the gate order is fixed with the migration gate FIRST and the
 * artifact verifier LAST (release nsis only); package.json wires the three script names.
 *
 *   node scripts/test_build_release.js
 */
const path = require('path');
const fs = require('fs');
const { composeEnv, gateSequence } = require(path.join(__dirname, 'build-release.js'));
let pass = 0, fail = 0;
const check = (n, ok, extra) => { if (ok) { pass++; console.log(`  OK  ${n}`); } else { fail++; console.log(`  FAIL ${n}${extra ? ' — ' + extra : ''}`); } };

console.log('build-release orchestrator:');
const dirty = { PATH: 'x', TEST_BUILD: '1', SHIP_PY_SOURCE: '1', HARDEN_JS_NOBYTECODE: '1', BUILD_REV: '20260908-1500-abc1234-TEST' };
const rel = composeEnv('release', dirty);
check('release: HARDEN_JS=1 + HARDEN_JS_STRINGS=1 forced', rel.HARDEN_JS === '1' && rel.HARDEN_JS_STRINGS === '1');
check('release: TEST_BUILD / SHIP_PY_SOURCE / HARDEN_JS_NOBYTECODE deleted even if the shell had them', !('TEST_BUILD' in rel) && !('SHIP_PY_SOURCE' in rel) && !('HARDEN_JS_NOBYTECODE' in rel));
check('release: RELEASE_BUILD=1, signing auto-discovery off by default', rel.RELEASE_BUILD === '1' && rel.CSC_IDENTITY_AUTO_DISCOVERY === 'false');
check('release: a leftover -TEST rev is stripped', rel.BUILD_REV === '20260908-1500-abc1234');
check('release: SIGN=1 turns signing auto-discovery on', composeEnv('release', { SIGN: '1' }).CSC_IDENTITY_AUTO_DISCOVERY === 'true');
{ const esc = composeEnv('release', { HARDEN_JS: '0' });
  check('release: HARDEN_JS=0 is an explicit plaintext escape (flagged, not hardened)', esc.HARDEN_JS_ESCAPE === '1' && !('HARDEN_JS' in esc) && !('HARDEN_JS_STRINGS' in esc)); }
check('release: the input env object is not mutated', dirty.TEST_BUILD === '1' && dirty.HARDEN_JS === undefined);
const t = composeEnv('test', { PATH: 'x', BUILD_REV: '20260908-1500-abc1234' });
check('test: TEST_BUILD=1, no RELEASE_BUILD, rev gets -TEST once', t.TEST_BUILD === '1' && !('RELEASE_BUILD' in t) && t.BUILD_REV === '20260908-1500-abc1234-TEST' && composeEnv('test', t).BUILD_REV === t.BUILD_REV);
check('test: HARDEN_JS is NOT forced (plain path, unless the shell sets it)', !('HARDEN_JS' in t));
const names = (m, tg) => gateSequence(m, tg).map(([s]) => path.basename(s));
check('release nsis order: migrations gate FIRST … verifier LAST', (() => { const n = names('release', 'nsis'); return n[0] === 'check-release-migrations.js' && n[n.length - 1] === 'verify-release-artifact.js' && n.includes('check-npm-audit.js') && n.indexOf('check-npm-audit.js') < n.indexOf('compile-python-bytecode.js'); })(), names('release', 'nsis').join(' > '));
check('release appx: builds appx AND runs the artifact verifier (re-audit 2026-09-08: the Store SKU had no gate)', (() => { const s = gateSequence('release', 'appx'); const n = names('release', 'appx'); return s.some(([f, a]) => /build-electron/.test(f) && a[0] === 'appx') && n[n.length - 1] === 'verify-release-artifact.js'; })());
// Re-audit 2026-09-08: every gate-weakening variable is scrubbed from the inherited shell; only explicit flags re-enable.
{ const { applyFlags } = require(path.join(__dirname, 'build-release.js'));
  const scrubbed = composeEnv('release', { PATH: 'x', SKIP_SMOKE: '1', AUDIT_OFFLINE_OK: '1', HARDEN_JS_ESCAPE: '1' });
  check('release: SKIP_SMOKE / AUDIT_OFFLINE_OK / HARDEN_JS_ESCAPE are scrubbed from the inherited env', !('SKIP_SMOKE' in scrubbed) && !('AUDIT_OFFLINE_OK' in scrubbed) && !('HARDEN_JS_ESCAPE' in scrubbed));
  check('release: HARDEN_JS=0 still sets the escape marker itself (after the scrub)', composeEnv('release', { HARDEN_JS: '0', HARDEN_JS_ESCAPE: '1' }).HARDEN_JS_ESCAPE === '1');
  const flagged = applyFlags(scrubbed, ['nsis', '--skip-smoke', '--audit-offline-ok']);
  check('--skip-smoke / --audit-offline-ok are the only re-enables (explicit, after the scrub)', flagged.SKIP_SMOKE === '1' && flagged.AUDIT_OFFLINE_OK === '1' && !('SKIP_SMOKE' in applyFlags(scrubbed, ['nsis'])));
  check('applyFlags does not mutate its input', !('SKIP_SMOKE' in scrubbed)); }
check('test: no npm-audit, no verifier (the plain test path)', !names('test', 'nsis').includes('check-npm-audit.js') && !names('test', 'nsis').includes('verify-release-artifact.js') && names('test', 'nsis')[0] === 'check-release-migrations.js');
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
check('package.json wires build:release / build:release:store / build:test to the orchestrator', /build-release\.js nsis$/.test(pkg.scripts['build:release'] || '') && /build-release\.js appx$/.test(pkg.scripts['build:release:store'] || '') && /build-release\.js nsis --test$/.test(pkg.scripts['build:test'] || ''));
for (const [s] of gateSequence('release', 'nsis')) check(`gate script exists: ${s}`, fs.existsSync(path.join(__dirname, '..', s)));
console.log(`\nbuild-release: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
