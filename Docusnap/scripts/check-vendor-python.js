#!/usr/bin/env node
'use strict';

/**
 * scripts/check-vendor-python.js
 * ------------------------------
 * PREBUILD GATE: the bundled Python interpreter (`vendor/python`) must be provisioned with the
 * REQUIRED runtime packages before the installer is packaged. `vendor/` is git-ignored (it holds
 * large platform binaries), so a fresh or moved build machine has an EMPTY/partial interpreter
 * that a clone can't reveal — this check catches it at build time instead of silently shipping a
 * broken or feature-dead installer.
 *
 * HARD FAIL (exit 1) when:
 *   - `vendor/python/python.exe` is missing (no bundled interpreter → the packaged app can't run
 *     the Python backend at all), OR
 *   - a REQUIRED package can't be imported by that interpreter. Most important: `rapidfuzz`, which
 *     powers the text-led supplier-identity conflict flag (extraction/identity_fusion.py) — without
 *     it the feature's guarded import silently no-ops, so the build would ship it dead with no error.
 *
 * SOFT WARNING (exit 0) when the removed RapidOCR stack is still bundled — dead weight (~80-180 MB)
 * since the 2026-07 removal, but not a correctness problem.
 *
 * Wired into `npm run build` (before electron-builder) and runnable standalone via `npm run check:vendor`.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const py = path.join(root, 'vendor', 'python', 'python.exe');

// [import name, why it's required]. `PIL` is pillow's import name.
const REQUIRED = [
  ['rapidfuzz',  'the supplier-identity conflict flag (extraction/identity_fusion.py) silently no-ops without it'],
  ['pytesseract','OCR (Tesseract driver)'],
  ['PIL',        'image handling (pillow)'],
  ['pypdfium2',  'PDF page rendering'],
  ['pypdf',      'PDF split / rotate'],
  ['zxingcpp',   'QR decode — Filing Slips separator-sheet detection (ocr/slip_detect.py aborts to no-split without it)'],
  ['segno',      'QR encode — separator-sheet pack generation + slip test fixtures'],
];
// pip package name when it differs from the import name (for the "how to fix" hint).
const PIP_NAME = { PIL: 'pillow', zxingcpp: 'zxing-cpp' };

// EXACT-VERSION PIN (2026-09-08, pre-deployment audit P1-2 — AUDIT_FIX_PLAN §5): python_backend/requirements.lock is the
// shipped vendor/python inventory (`vendor\python\python.exe -m pip freeze`). Pillow parses untrusted scanned images and
// pypdfium2 untrusted PDFs, so a silently re-provisioned vendor/ that pulled a different version must refuse the build:
// every REQUIRED package's installed dist-info version must equal the lock. Bumping = edit the lock deliberately (a
// dated security decision), then re-provision. compareLock() is pure (pinned by scripts/test_check_vendor_python.js).
const LOCK = path.join(root, 'python_backend', 'requirements.lock');
const PIP_OF = { PIL: 'pillow', zxingcpp: 'zxing-cpp', rapidfuzz: 'rapidfuzz', pytesseract: 'pytesseract', pypdfium2: 'pypdfium2', pypdf: 'pypdf', segno: 'segno' };
const normName = (n) => String(n).toLowerCase().replace(/[-_.]+/g, '-');
function parseLock(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) { const m = /^\s*([A-Za-z0-9_.\-]+)\s*==\s*([^\s#]+)/.exec(line); if (m) out[normName(m[1])] = m[2]; }
  return out;
}
function installedVersions(sitePackages) {
  const out = {};
  if (!fs.existsSync(sitePackages)) return out;
  for (const d of fs.readdirSync(sitePackages)) { const m = /^(.+?)-([0-9][^-]*)\.dist-info$/.exec(d); if (m) out[normName(m[1])] = m[2]; }
  return out;
}
/** compareLock(lock, installed, required) → [{pkg, want, have, why}] mismatches. Pure.
 *  REQUIRED packages must be pinned AND installed at the pinned version; EVERY OTHER lock line present in vendor
 *  must also match (re-audit 2026-09-08: numpy / scipy / ImageHash / PyWavelets — the phash stack that parses every
 *  logo crop — were listed but never compared). A lock line absent from vendor is not an error (the lock may
 *  carry packages a slimmer provisioning dropped). */
function compareLock(lock, installed, required = REQUIRED.map(([m]) => PIP_OF[m] || m)) {
  const bad = [];
  const req = new Set(required.map(normName));
  for (const pkg of required) {
    const k = normName(pkg); const want = lock[k], have = installed[k];
    if (!want) bad.push({ pkg, want: null, have: have || null, why: 'not pinned in requirements.lock' });
    else if (have !== want) bad.push({ pkg, want, have: have || null, why: have ? 'version drift' : 'not installed' });
  }
  for (const [k, want] of Object.entries(lock)) {
    if (req.has(k)) continue;
    const have = installed[k];
    if (have && have !== want) bad.push({ pkg: k, want, have, why: 'version drift (transitive/optional package)' });
  }
  return bad;
}
module.exports = { parseLock, installedVersions, compareLock, normName, PIP_OF, REQUIRED };
if (require.main !== module) return;   // pure API for the pin — the checks below only run as a script

// Import names that should NO LONGER be present (RapidOCR was removed 2026-07).
const REMOVED = ['rapidocr_onnxruntime', 'onnxruntime', 'cv2', 'shapely', 'pyclipper',
                 // RapidOCR-era transitive leftovers (re-audit 2026-09-08): zero imports in python_backend, ~12 MB shipped.
                 'google.protobuf', 'flatbuffers', 'yaml', 'requests', 'tqdm', 'urllib3', 'certifi', 'charset_normalizer', 'idna'];

function canImport(mod) {
  try { execFileSync(py, ['-c', `import ${mod}`], { stdio: 'ignore' }); return true; }
  catch { return false; }
}

function fail(msg) {
  console.error('\n  ✗ vendor/python prebuild check FAILED\n');
  console.error('  ' + msg.split('\n').join('\n  '));
  console.error('\n  Assemble/provision the bundled interpreter per BUILD.txt (STEP A), then rebuild.\n');
  process.exit(1);
}

if (!fs.existsSync(py)) {
  fail('vendor/python/python.exe is missing — the app bundles its own Python interpreter, so a\n'
     + 'packaged build needs it present. vendor/ is git-ignored, so it must be assembled on THIS\n'
     + 'machine (BUILD.txt §3: embeddable zip → enable site → bootstrap pip → pip install deps).');
}

const missing = REQUIRED.filter(([m]) => !canImport(m));
if (missing.length) {
  const lines = missing.map(([m, why]) => `  - ${m}: ${why}`).join('\n');
  const pipList = missing.map(([m]) => PIP_NAME[m] || m).join(' ');
  fail('vendor/python is missing REQUIRED package(s):\n' + lines
     + '\n\nInstall them into the BUNDLED interpreter (not the system one):\n'
     + `  vendor\\python\\python.exe -m pip install ${pipList}`);
}

// Exact versions vs the lock (P1-2). After the import check so a missing package reports as missing, not drift.
{
  const lockText = fs.existsSync(LOCK) ? fs.readFileSync(LOCK, 'utf8') : '';
  if (!lockText) fail('python_backend/requirements.lock is missing — regenerate it from the bundled interpreter:\n  vendor\\python\\python.exe -m pip freeze > python_backend\\requirements.lock');
  const bad = compareLock(parseLock(lockText), installedVersions(path.join(root, 'vendor', 'python', 'Lib', 'site-packages')));
  if (bad.length) {
    const lines = bad.map(b => `  - ${b.pkg}: lock pins ${b.want || '(none)'}, vendor has ${b.have || '(none)'} — ${b.why}`).join('\n');
    fail('vendor/python does not match python_backend/requirements.lock (exact-version pin, audit P1-2):\n' + lines
       + '\n\nEither re-provision the pinned version into the BUNDLED interpreter, or — after a deliberate review — update the lock:\n'
       + '  vendor\\python\\python.exe -m pip freeze > python_backend\\requirements.lock');
  }
}

const stale = REMOVED.filter(canImport);
if (stale.length) {
  console.warn('\n  ⚠ vendor/python still carries the removed RapidOCR stack: ' + stale.join(', '));
  console.warn('    It is unused since 2026-07 and adds ~80-180 MB to the installer. Reclaim (optional):');
  console.warn('    vendor\\python\\python.exe -m pip uninstall -y rapidocr-onnxruntime onnxruntime opencv-python shapely pyclipper');
}

console.log('\n  ✓ vendor/python OK — required packages present (rapidfuzz + core backend deps)'
  + (stale.length ? ' [see RapidOCR warning above]' : '') + '.\n');
process.exit(0);
