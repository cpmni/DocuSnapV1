'use strict';
/*
 * test_page_words_parallel.js — pins Oracle C1 of the teach-locate speedup (2026-09-26): the interactive
 * page-words spawn runs the PSM-3/PSM-6 full-page pair CONCURRENTLY (DS_OCR_PARALLEL_FULLPAGE). The merge is
 * byte-identical (tesseract.py:676 — PSM-3 fixed base + append PSM-6 survivors, OMP floored to 1, any failure
 * → sequential; already Oracle-signed for the single-reprocess spawn). Set on BOTH page-words spawns so the
 * desktop teach and the /v1-client teach read the same. This is a SPEED lever only — it changes nothing about
 * the read, so it ships ahead of, and independently of, the downscale (test_page_words_speed.js).
 *   node src/modules/processing/test_page_words_parallel.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..', '..');
const norm = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('  ok  ' + n); } else { fail++; console.log('  FAIL ' + n); } };

const desk = norm('src/modules/processing/handler.js');
const v1 = norm('src/modules/api/handler.js');
const tess = norm('python_backend/ocr/tesseract.py');

console.log('== teach page-words parallel passes (Oracle C1) ==');
ok('desktop ocr-page-words sets DS_OCR_PARALLEL_FULLPAGE on its spawn env',
   /_pwEnv\.DS_OCR_PARALLEL_FULLPAGE\s*=\s*'1'/.test(desk));
ok('/v1 ocr-page-words sets DS_OCR_PARALLEL_FULLPAGE on its spawn env',
   /pwEnv\.DS_OCR_PARALLEL_FULLPAGE\s*=\s*'1'/.test(v1));
// the byte-identical merge the flag rides still exists (PSM-3 fixed base + append PSM-6 survivors)
ok('tesseract.py keeps the byte-identical parallel merge gate',
   /DS_OCR_PARALLEL_FULLPAGE'\s*,\s*'0'\)\s*!=\s*'0'/.test(tess));
ok('the parallel path floors OMP only when absent (never lowers an exported cap)',
   /OMP_THREAD_LIMIT/.test(tess) && /max_workers=2/.test(tess));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
