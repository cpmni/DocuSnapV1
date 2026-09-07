#!/usr/bin/env node
'use strict';
/*
 * src/modules/review/test_promote_sample_angle.js — TEACH-COMMIT SAMPLE ANGLE (2026-09-07, 007 → Oracle
 * SIGN-OFF-W/COND C1-C5). The engine composes every taught box by (sample tilt − scan tilt) and read a NULL
 * sample tilt as 0.00°; on the packaged build the async detector (detect_angle.py) had been compiled away, so
 * every template stayed NULL and every tilted sibling read its boxes a glyph to the side ('5/03/2026',
 * 'NS-39241'). Now: the wizard's already-measured page-0 tilt rides the promote payload and is written at
 * commit (guarded IS NULL; a 0 from an unmeasured page is never "level"), a ≥0.3° re-teach frame mix WARNs, and
 * a startup backfill detects every NULL-angled template once.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe src/modules/review/test_promote_sample_angle.js
 */
const fs = require('fs');
const path = require('path');
let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };
const ROOT = path.join(__dirname, '..', '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const { _wizardSampleAngle: W } = require('./handler');

console.log('1 the payload validator (C1/C2): measured + finite, or nothing');
check('measured 1.2 → written', JSON.stringify(W({ sample_deskew_angle: 1.2, angle_measured: true })) === JSON.stringify({ angle: 1.2, measured: true }));
check('measured LEVEL (0) → written as 0 (a measured level page IS level)', JSON.stringify(W({ sample_deskew_angle: 0, angle_measured: true })) === JSON.stringify({ angle: 0, measured: true }));
check('UNMEASURED 0 (a parse/spawn failure) → NOT written', W({ sample_deskew_angle: 0, angle_measured: false }).measured === false);
check('angle null → not written', W({ sample_deskew_angle: null, angle_measured: true }).measured === false);
check('NaN / string junk → not written', W({ sample_deskew_angle: 'abc', angle_measured: true }).measured === false && W({ sample_deskew_angle: NaN, angle_measured: true }).measured === false);
check('a numeric STRING is accepted (IPC round-trip)', JSON.stringify(W({ sample_deskew_angle: '-1.5', angle_measured: true })) === JSON.stringify({ angle: -1.5, measured: true }));
check('missing keys (old callers) → not written', W({}).measured === false && W(null).measured === false);

console.log('2 the promote road (source pins)');
const rh = read('src/modules/review/handler.js');
const promo = rh.slice(rh.indexOf("ipcMain.handle('promote-to-template'"), rh.indexOf("ipcMain.handle('promote-to-template'") + 5000);
check('the wizard angle is validated once from the payload', /const wizardAngle = _wizardSampleAngle\(payload\);/.test(promo));
check('written ONLY when measured, ONLY when still NULL (guarded UPDATE)', /if \(wizardAngle\.measured\) \{[\s\S]{0,400}UPDATE templates SET sample_deskew_angle = \? WHERE id = \? AND sample_deskew_angle IS NULL/.test(promo));
check('C3: a REUSED template with a ≥0.3° mismatch WARNs (never overwrites)', /result\.created === false\s*&& Math\.abs\(Number\(before\.sample_deskew_angle\) - wizardAngle\.angle\) >= 0\.3/.test(promo) && /re-teach frame mix/.test(promo));
check('the async detect stays the fallback AFTER the sync write', promo.indexOf('UPDATE templates SET sample_deskew_angle') < promo.indexOf('ctx.generateSampleAngle(result.templateId)'));

console.log('3 the wizard side');
const tw = read('src/windows/teach/renderer.js');
check('promote payload carries sample_deskew_angle + angle_measured from page 0', /sample_deskew_angle:_sa\.angle, angle_measured:_sa\.measured,/.test(tw) && /function _sampleAngleForCommit\(\)/.test(tw));
check('the measured flag comes from the IPC result, not from having an image', /if \(res && res\.measured\) \{ state\.deskewMeasured = true; state\.deskewMeasuredAngle = Number\(res\.angle\) \|\| 0; \}/.test(tw));
check('the per-page cache banks measured + angle (multi-page teach)', /_pc\.deskewMeasured = state\.deskewMeasured; _pc\.deskewMeasuredAngle = state\.deskewMeasuredAngle;/.test(tw) && /deskewMeasured: !!state\.deskewMeasured, deskewMeasuredAngle: state\.deskewMeasuredAngle \|\| 0/.test(tw));
const ph = read('src/modules/processing/handler.js');
check('get-page-deskew reports measured:true only on a PARSED result, false on failure', /resolve\(\{ measured: true, \.\.\.JSON\.parse\(out\.trim\(\)\) \}\); \} catch \{ resolve\(\{ angle: 0, image: null, measured: false \}\); \}/.test(ph));

console.log('4 the startup backfill (C4)');
const th = read('src/modules/templates/handler.js');
check('templates with a sample but a NULL angle are detected once at startup, sequentially', /WHERE sample_document_id IS NOT NULL AND sample_deskew_angle IS NULL/.test(th) && /for \(const r of rows\) \{ try \{ const res = await generateSampleAngle\(r\.id\);/.test(th));
check('…delayed and best-effort (never blocks startup)', /\}, 10000\);/.test(th) && /sample-angle backfill failed/.test(th));

console.log('5 the packaged script stays a real file (the root cause)');
const cp = read('scripts/compile-python-bytecode.js');
check("compile-python-bytecode KEEP_SOURCE carries ocr/detect_angle.py", /'ocr\/detect_angle\.py'/.test(cp));

console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
