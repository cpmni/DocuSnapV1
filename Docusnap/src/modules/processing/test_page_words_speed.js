'use strict';
/*
 * test_page_words_speed.js — pins the teach-locate page-words SPEEDUP (2026-09-26, oscar+Oracle
 * SIGN-OFF-W/COND C1-C4). Structural guards; the efficacy + placement PROOF is the recall A/B gate
 * TESTING/_measure/teach_pagewords_recall_20260926/RESULT.md (new recall >= old, 0 IoU<0.5).
 *   C1  both page-words spawns run the byte-identical parallel PSM-3/PSM-6 pair (DS_OCR_PARALLEL_FULLPAGE).
 *   C2  region.py REASSIGNS `img` on downscale, and emits THAT img's w/h — so the words and the reported
 *       dims are always the SAME frame (locate normalises by w/h → no silent box shift). No `img_small`.
 *   C3  the desktop handler picks a DPI-AWARE target clamp(importDpi, 150, 288) and passes src+target dpi.
 *   C4  the kill switch TEACH_PAGE_WORDS_DOWNSCALE=0 makes the callers omit the args; region.py then
 *       defaults both to 0 → dpi=None + native image = today's byte-identical read.
 *   node src/modules/processing/test_page_words_speed.js   (or via scripts/run-pins.js)
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..', '..');
const norm = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('  ok  ' + n); } else { fail++; console.log('  FAIL ' + n); } };

const desk = norm('src/modules/processing/handler.js');
const v1 = norm('src/modules/api/handler.js');
const region = norm('python_backend/ocr/region.py');

console.log('== teach page-words downscale (Oracle C2-C4; C1 parallel = test_page_words_parallel.js) ==');

// C2 — region.py reassigns `img` (not a forgettable img_small) and emits that img's dims
ok('C2 region.py REASSIGNS img on downscale', /\bimg\s*=\s*img\.resize\(/.test(region));
ok('C2 region.py never introduces an img_small', !/img_small/.test(region));
ok('C2 the page-words emit reports img.width/img.height (the downscaled frame)',
   /json\.dumps\(\{\s*"w":\s*img\.width,\s*"h":\s*img\.height/.test(region));
ok('C2 the OCR reads the SAME reassigned img (dpi passed)',
   /reconstruct_page_text\(img,\s*dpi=_pw_dpi,\s*words_out=wo\)/.test(region));

// C3 — DPI-aware target on the desktop handler; both dpi args plumbed
ok('C3 desktop target = clamp(importDpi, 150, 288)',
   /Math\.max\(150,\s*Math\.min\(TEACH_SRC_DPI,\s*_resolveOcrDpi\(getDb\(\)\)\)\)/.test(desk));
ok('C3 desktop passes --page-words-src-dpi + --page-words-target-dpi',
   /--page-words-src-dpi/.test(desk) && /--page-words-target-dpi/.test(desk));
ok('C3 region.py accepts both dpi args',
   /--page-words-src-dpi/.test(region) && /--page-words-target-dpi/.test(region));

// C4 — downscale is OPT-IN (default OFF after the 2026-09-26 real-scan regression: lower DPI misreads
// value digits → locate miss → no auto-draw). On ONLY when TEACH_PAGE_WORDS_DOWNSCALE=1. region.py native by default.
ok('C4 desktop downscale is opt-in (=== \'1\'), default OFF',
   /process\.env\.TEACH_PAGE_WORDS_DOWNSCALE\s*===\s*'1'/.test(desk));
ok('C4 /v1 downscale is opt-in (=== \'1\'), default OFF',
   /process\.env\.TEACH_PAGE_WORDS_DOWNSCALE\s*===\s*'1'/.test(v1));
ok('C4 region.py defaults both dpi args to 0 (off = native dpi=None)',
   /--page-words-src-dpi'[\s\S]{0,80}default=0/.test(region) && /--page-words-target-dpi'[\s\S]{0,80}default=0/.test(region));
ok('C4 region.py: dpi stays None until src dpi is supplied',
   /_pw_dpi\s*=\s*None/.test(region) && /if\s+_src\s*>\s*0:/.test(region));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
