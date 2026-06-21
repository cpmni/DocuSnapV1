#!/usr/bin/env node
'use strict';
/*
 * scripts/check-rapidocr-bundled.js
 * ---------------------------------
 * Prebuild guard: refuse to package a dist whose bundled vendor/python is
 * missing (or has a broken) RapidOCR runtime.
 *
 * Why: RapidOCR is an opt-in full-page OCR engine bundled into vendor/python by
 * a MANUAL provisioning step (BUILD.txt Part 3.1 STEP A — pip install -r
 * python_backend/requirements-ocr.txt). `npm run build` does NOT run that step,
 * so a forgotten provisioning would SILENTLY ship an installer in which
 * Settings -> OCR engine -> RapidOCR just falls back to Tesseract forever. This
 * guard runs the SAME init probe the app does at runtime against the SAME
 * interpreter the app launches (vendor/python/python.exe, see src/main.js
 * pythonExe()), so an absent OR broken runtime (e.g. the onnxruntime/NumPy-2
 * mismatch) fails the build loudly instead of shipping.
 *
 * It does NOT change the OCR default (still Tesseract) or runtime fallback — it
 * only gates packaging.
 *
 * Usage:  node scripts/check-rapidocr-bundled.js
 * Exit 0 = RapidOCR initialises in vendor/python. Exit 1 = absent/broken.
 * Escape hatch (deliberate, non-silent): set SCANFINDER_SKIP_RAPIDOCR_CHECK=1 to
 * build a knowingly Tesseract-only dist; the guard prints a loud warning.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const PYEXE = path.join(REPO, 'vendor', 'python', 'python.exe');
const REQ = 'python_backend\\requirements-ocr.txt';
const PROBE = "from rapidocr_onnxruntime import RapidOCR; RapidOCR()";

function fail(lines) {
  console.error('\n  RapidOCR prebuild guard: FAILED\n');
  for (const l of lines) console.error('  ' + l);
  console.error('');
  process.exit(1);
}

if (process.env.SCANFINDER_SKIP_RAPIDOCR_CHECK) {
  console.warn('\n  ⚠ RapidOCR prebuild guard SKIPPED (SCANFINDER_SKIP_RAPIDOCR_CHECK set).');
  console.warn('    This dist may ship without RapidOCR; Settings -> OCR engine will fall back to Tesseract.\n');
  process.exit(0);
}

if (!fs.existsSync(PYEXE)) {
  fail([
    'Bundled interpreter not found: ' + PYEXE,
    'vendor/python is not assembled yet. Assemble it first (BUILD.txt Part 3.1 STEP A,',
    'Python 3.12 only), then install the OCR runtime into it:',
    '  vendor\\python\\python.exe -m pip install -r ' + REQ,
  ]);
}

const res = spawnSync(PYEXE, ['-c', PROBE], { encoding: 'utf8' });

if (res.status === 0) {
  console.log('  RapidOCR prebuild guard: OK (RapidOCR initialises in vendor/python).');
  process.exit(0);
}

const detail = ((res.stderr || '') + (res.error ? String(res.error) : '')).trim();
fail([
  'RapidOCR did not initialise in the bundled vendor/python.',
  'Install (or repair) it before building — BUILD.txt Part 3.1 STEP A:',
  '  vendor\\python\\python.exe -m pip install -r ' + REQ,
  'Then verify:',
  '  vendor\\python\\python.exe -c "' + PROBE + "; print('RapidOCR OK')" + '"',
  '',
  'Probe error (last lines):',
  ...(detail ? detail.split(/\r?\n/).slice(-8).map((s) => '  ' + s) : ['  (no output)']),
]);
