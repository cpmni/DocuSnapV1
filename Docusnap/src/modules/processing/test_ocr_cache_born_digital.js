#!/usr/bin/env node
'use strict';
/*
 * test_ocr_cache_born_digital.js — Oracle re-rule C2 (2026-09-24 evening 2) for the QUIET REDETECT's born-digital
 * relaxation: `ocrCache.ocrCacheUsableForRedetect(row, current, { allowBornDigital })` waives ONLY the `born-digital-doc`
 * refusal and re-asks the SAME predicate, so every other invalidator still refuses; without the flag it is the batch
 * predicate byte-for-byte. The stamp is never laundered: an imageless run emits `{imageless:true}` only
 * (python_backend/tests/test_reextract_recipe.py) and the handler writes `ocr_recipe = COALESCE(?, ocr_recipe)`, so the
 * operator's batch still sees `bd_used` afterwards (source-pinned here).
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe src/modules/processing/test_ocr_cache_born_digital.js
 */
const path = require('path');
const fs = require('fs');
const oc = require('./ocrCache');
let fails = 0;
const check = (label, cond, extra) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? ' — ' + extra : ''}`); if (!cond) fails++; };

const current = { dpi: 200, light: [200, 210, 220, 230], bd: true, rev: oc.OCR_PIPELINE_REV, tess: '5.5.0.20241111' };
const stamp = (over) => JSON.stringify(Object.assign({ dpi: 200, light: [200, 210, 220, 230], bd: true, bd_used: true, rev: oc.OCR_PIPELINE_REV, tess: '5.5.0.20241111' }, over || {}));
const row = (over) => Object.assign({ ocr_text: 'DELIVERY NOTE OED/29786 22-01-2026', ocr_recipe: stamp(), enhance_active: false }, over || {});

console.log('1. without the flag the helper IS the batch predicate');
check('bd_used row → born-digital-doc (no flag)', oc.ocrCacheUsableForRedetect(row(), current).reason === 'born-digital-doc');
check('bd_used row → born-digital-doc (flag false)', oc.ocrCacheUsableForRedetect(row(), current, { allowBornDigital: false }).reason === 'born-digital-doc');
check('a scanned (bd_used:false) row is usable either way', oc.ocrCacheUsableForRedetect(row({ ocr_recipe: stamp({ bd_used: false }) }), current, { allowBornDigital: true }).usable === true
      && oc.ocrCacheUsable(row({ ocr_recipe: stamp({ bd_used: false }) }), current).usable === true);

console.log('\n2. with the flag ONLY bd_used is waived');
check('bd_used row + current recipe → ok-born-digital', JSON.stringify(oc.ocrCacheUsableForRedetect(row(), current, { allowBornDigital: true })) === JSON.stringify({ usable: true, reason: 'ok-born-digital' }));
check('bd_used row + dpi mismatch → dpi-changed (still refused)', oc.ocrCacheUsableForRedetect(row({ ocr_recipe: stamp({ dpi: 300 }) }), current, { allowBornDigital: true }).reason === 'dpi-changed');
check('bd_used row + born-digital setting changed → born-digital-setting-changed', oc.ocrCacheUsableForRedetect(row(), { ...current, bd: false }, { allowBornDigital: true }).reason === 'born-digital-setting-changed');
check('bd_used row + pipeline rev changed → pipeline-rev-changed', oc.ocrCacheUsableForRedetect(row({ ocr_recipe: stamp({ rev: oc.OCR_PIPELINE_REV + 1 }) }), current, { allowBornDigital: true }).reason === 'pipeline-rev-changed');
check('bd_used row + tesseract changed → tesseract-version-changed', oc.ocrCacheUsableForRedetect(row({ ocr_recipe: stamp({ tess: '5.4.0' }) }), current, { allowBornDigital: true }).reason === 'tesseract-version-changed');
check('bd_used row + light recovery changed → light-recovery-changed', oc.ocrCacheUsableForRedetect(row({ ocr_recipe: stamp({ light: [200] }) }), current, { allowBornDigital: true }).reason === 'light-recovery-changed');
check('empty text is still refused', oc.ocrCacheUsableForRedetect(row({ ocr_text: '   ' }), current, { allowBornDigital: true }).reason === 'empty-ocr-text');
check('a missing stamp is still refused', oc.ocrCacheUsableForRedetect(row({ ocr_recipe: null }), current, { allowBornDigital: true }).reason === 'no-recipe-stamp');
check('an enhanced template is still refused', oc.ocrCacheUsableForRedetect(row({ enhance_active: true }), current, { allowBornDigital: true }).reason === 'enhance-active-template');
check('no current recipe is still refused', oc.ocrCacheUsableForRedetect(row(), null, { allowBornDigital: true }).reason === 'no-current-recipe');

console.log('\n3. the stamp is never laundered (two separately pinned facts)');
const h = fs.readFileSync(path.join(__dirname, 'handler.js'), 'utf8');
check('applyReprocessResult writes ocr_recipe = COALESCE(?, ocr_recipe) (an imageless run emits no stamp → the old bd_used stays)', /ocr_recipe\s*=\s*COALESCE\(\?, ocr_recipe\)/.test(h));
const py = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'python_backend', 'process_docs.py'), 'utf8');
check('process_docs: a --reextract run emits {imageless: True} only (no ocr_recipe) — see tests/test_reextract_recipe.py', /if reextract:\s*\n\s*return \{["']imageless["']: True\}/.test(py));
// composite: after an imageless pass the same row still refuses under the batch predicate
const afterImageless = row();   // recipe untouched by construction (COALESCE)
check('the batch predicate still says born-digital-doc for the row after an imageless pass', oc.ocrCacheUsable(afterImageless, current).reason === 'born-digital-doc');
check('the lane is the ONLY caller that passes allowBornDigital', (fs.readFileSync(path.join(__dirname, 'quietLane.js'), 'utf8').match(/allowBornDigital: true/g) || []).length === 1
      && !/allowBornDigital: true/.test(h.replace(/quickUsable: \(db, docId, opts = \{\}\) => \{[\s\S]*?\},\n/, '')));

console.log(fails ? `\n${fails} FAILED` : '\nALL OK');
process.exit(fails ? 1 : 0);
