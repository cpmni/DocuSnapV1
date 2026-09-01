'use strict';
// Pins src/modules/processing/ocrCache.js (Quick Reprocess, 2026-09-01; gary → Oracle C1-C7).
//
// Every invalidator must FLIP a usable recipe to not-usable; every per-doc refusal must hold; and the
// JS pipeline-rev mirror must equal the Python one (a one-sided bump would silently keep Quick alive
// across an OCR change). The fail-safe direction is pinned in both polarities.
//
// Run: ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe src/modules/processing/test_ocr_cache_usable.js
const path = require('path');
const fs = require('fs');
const C = require(path.join(__dirname, 'ocrCache.js'));

let fails = 0, n = 0;
function ok(label, cond) { n++; if (cond) { console.log('  ok   ' + label); return; } fails++; console.log('  FAIL ' + label); }

// A recipe the current pipeline would stamp, and a stored row that MATCHES it → usable.
const current = { dpi: 200, light: null, bd: true, rev: C.OCR_PIPELINE_REV, tess: '5.3.1' };
const goodRecipe = { dpi: 200, light: null, bd: true, bd_used: false, rev: C.OCR_PIPELINE_REV, tess: '5.3.1' };
const row = (over = {}) => ({ ocr_text: 'some stored page text', enhance_active: false, ocr_recipe: JSON.stringify(goodRecipe), ...over });

console.log('baseline');
ok('a matching stamped row is usable', C.ocrCacheUsable(row(), current).usable === true);

console.log('recipe invalidators (each flips usable → not-usable, with a named reason)');
ok('DPI changed', reason(row(), { ...current, dpi: 300 }) === 'dpi-changed');
ok('light recovery turned ON (row off, current on)', reason(row(), { ...current, light: [200, 210, 220, 230] }) === 'light-recovery-changed');
ok('light recovery turned OFF (row on, current off)',
   reason(row({ ocr_recipe: JSON.stringify({ ...goodRecipe, light: [200, 210, 220, 230] }) }), current) === 'light-recovery-changed');
ok('light LEVELS changed', reason(row({ ocr_recipe: JSON.stringify({ ...goodRecipe, light: [200, 210, 220, 230] }) }),
   { ...current, light: [205, 215] }) === 'light-recovery-changed');
ok('born-digital setting changed', reason(row(), { ...current, bd: false }) === 'born-digital-setting-changed');
ok('pipeline rev changed', reason(row(), { ...current, rev: C.OCR_PIPELINE_REV + 1 }) === 'pipeline-rev-changed');
ok('tesseract version changed (both known)', reason(row(), { ...current, tess: '5.4.0' }) === 'tesseract-version-changed');

console.log('tess is only an invalidator when BOTH sides are known (rev is the real code guard)');
ok('unknown CURRENT tess does not refuse reuse', C.ocrCacheUsable(row(), { ...current, tess: '' }).usable === true);
ok('unknown STORED tess does not refuse reuse',
   C.ocrCacheUsable(row({ ocr_recipe: JSON.stringify({ ...goodRecipe, tess: '' }) }), current).usable === true);

console.log('per-document refusals (independent of the recipe compare)');
ok('empty ocr_text', reason(row({ ocr_text: '   ' }), current) === 'empty-ocr-text');
ok('missing ocr_text', reason(row({ ocr_text: null }), current) === 'empty-ocr-text');
ok('enhance-active template', reason(row({ enhance_active: true }), current) === 'enhance-active-template');
ok('born-digital doc (bd_used)', reason(row({ ocr_recipe: JSON.stringify({ ...goodRecipe, bd_used: true }) }), current) === 'born-digital-doc');
ok('NULL stamp (legacy doc)', reason(row({ ocr_recipe: null }), current) === 'no-recipe-stamp');
ok('malformed stamp', reason(row({ ocr_recipe: '{not json' }), current) === 'no-recipe-stamp');
ok('empty-string stamp', reason(row({ ocr_recipe: '' }), current) === 'no-recipe-stamp');
ok('no row at all', reason(null, current) === 'no-row');

console.log('parseRecipe tolerates object, string, null');
ok('object passes through', C.parseRecipe(goodRecipe) === goodRecipe);
ok('string parses', C.parseRecipe(JSON.stringify(goodRecipe)).dpi === 200);
ok('null → null', C.parseRecipe(null) === null);

console.log('CROSS-LANGUAGE rev pin — JS mirror must equal ocr/tesseract.py OCR_PIPELINE_REV');
const py = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'python_backend', 'ocr', 'tesseract.py'), 'utf8');
const m = py.match(/^OCR_PIPELINE_REV\s*=\s*(\d+)/m);
ok('python OCR_PIPELINE_REV is defined', !!m);
ok(`JS mirror (${C.OCR_PIPELINE_REV}) === python (${m && m[1]})`, m && Number(m[1]) === C.OCR_PIPELINE_REV);

function reason(r, c) { return C.ocrCacheUsable(r, c).reason; }

console.log(`\n${n - fails}/${n} passed`);
if (fails) { console.log('FAILED ' + fails); process.exit(1); }
