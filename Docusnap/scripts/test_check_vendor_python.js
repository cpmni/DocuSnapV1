#!/usr/bin/env node
'use strict';
/**
 * scripts/test_check_vendor_python.js — pins the vendor gate's exact-version pin (audit P1-2; AUDIT_FIX_PLAN §5):
 * compareLock() refuses drift / an unpinned required package / a missing install and passes an exact match; names
 * normalise across pip/dist-info spellings (zxing-cpp vs zxing_cpp, RapidFuzz vs rapidfuzz); the committed
 * python_backend/requirements.lock pins every REQUIRED package (Pillow first among them); and, when vendor/python is
 * present on this machine, it matches the lock exactly.
 *
 *   node scripts/test_check_vendor_python.js
 */
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const V = require(path.join(__dirname, 'check-vendor-python.js'));
let pass = 0, fail = 0;
const check = (n, ok, extra) => { if (ok) { pass++; console.log(`  OK  ${n}`); } else { fail++; console.log(`  FAIL ${n}${extra ? ' — ' + extra : ''}`); } };

console.log('check-vendor-python exact-version pin:');
check('the gate exports the pure API without running its checks', typeof V.compareLock === 'function' && typeof V.parseLock === 'function' && Array.isArray(V.REQUIRED));
const lock = V.parseLock('pillow==12.2.0\nzxing-cpp==3.1.0\nRapidFuzz==3.14.5\n# comment\npypdfium2==5.10.1\n');
check('parseLock normalises names (RapidFuzz → rapidfuzz, zxing-cpp)', lock.rapidfuzz === '3.14.5' && lock['zxing-cpp'] === '3.1.0' && lock.pillow === '12.2.0');
const inst = { pillow: '12.2.0', 'zxing-cpp': '3.1.0', rapidfuzz: '3.14.5', pypdfium2: '5.10.1' };
check('exact match → no problems', V.compareLock(lock, inst, ['pillow', 'zxing-cpp', 'rapidfuzz', 'pypdfium2']).length === 0);
check('version drift is refused (pillow 12.2.0 → 12.1.0)', (() => { const b = V.compareLock(lock, { ...inst, pillow: '12.1.0' }, ['pillow']); return b.length === 1 && b[0].why === 'version drift' && b[0].want === '12.2.0' && b[0].have === '12.1.0'; })());
check('a required package missing from vendor is refused', (() => { const b = V.compareLock(lock, { pillow: '12.2.0' }, ['pillow', 'pypdfium2']); return b.length === 1 && b[0].why === 'not installed'; })());
check('a required package missing from the LOCK is refused (the lock must pin every required package)', (() => { const b = V.compareLock(lock, inst, ['pillow', 'segno']); return b.length === 1 && b[0].why === 'not pinned in requirements.lock'; })());
check('dist-info spelling zxing_cpp matches pip spelling zxing-cpp', V.normName('zxing_cpp') === V.normName('zxing-cpp') && V.normName('PyWavelets') === 'pywavelets');
check('installedVersions parses <Name>-<ver>.dist-info folders', (() => {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'vendorpin-'));
  for (const d of ['pillow-12.2.0.dist-info', 'zxing_cpp-3.1.0.dist-info', 'notes.txt']) fs.mkdirSync(path.join(tmp, d), { recursive: true });
  const got = V.installedVersions(tmp); fs.rmSync(tmp, { recursive: true, force: true });
  return got.pillow === '12.2.0' && got['zxing-cpp'] === '3.1.0' && Object.keys(got).length === 2; })());
// The committed lock pins every REQUIRED package.
const lockPath = path.join(ROOT, 'python_backend', 'requirements.lock');
check('python_backend/requirements.lock exists', fs.existsSync(lockPath));
const realLock = fs.existsSync(lockPath) ? V.parseLock(fs.readFileSync(lockPath, 'utf8')) : {};
const required = V.REQUIRED.map(([m]) => V.PIP_OF[m] || m);
const unpinned = required.filter(p => !realLock[V.normName(p)]);
check(`the lock pins every REQUIRED package (${required.length})`, unpinned.length === 0, unpinned.join(','));
check('Pillow (untrusted image parser) is pinned', !!realLock.pillow);
// If vendor/python is on this machine it must match the lock exactly.
const site = path.join(ROOT, 'vendor', 'python', 'Lib', 'site-packages');
if (fs.existsSync(site)) {
  const bad = V.compareLock(realLock, V.installedVersions(site));
  check('vendor/python on this machine matches the lock exactly', bad.length === 0, bad.map(b => `${b.pkg} ${b.want}≠${b.have}`).join(','));
} else console.log('  (vendor/python not present here — the exact-match check runs on the build machine)');
console.log(`\ncheck-vendor-python: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
