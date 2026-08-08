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

// Import names that should NO LONGER be present (RapidOCR was removed 2026-07).
const REMOVED = ['rapidocr_onnxruntime', 'onnxruntime', 'cv2', 'shapely', 'pyclipper'];

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

const stale = REMOVED.filter(canImport);
if (stale.length) {
  console.warn('\n  ⚠ vendor/python still carries the removed RapidOCR stack: ' + stale.join(', '));
  console.warn('    It is unused since 2026-07 and adds ~80-180 MB to the installer. Reclaim (optional):');
  console.warn('    vendor\\python\\python.exe -m pip uninstall -y rapidocr-onnxruntime onnxruntime opencv-python shapely pyclipper');
}

console.log('\n  ✓ vendor/python OK — required packages present (rapidfuzz + core backend deps)'
  + (stale.length ? ' [see RapidOCR warning above]' : '') + '.\n');
process.exit(0);
