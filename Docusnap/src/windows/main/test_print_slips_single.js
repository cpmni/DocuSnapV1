#!/usr/bin/env node
'use strict';
/*
 * src/windows/main/test_print_slips_single.js — owner 2026-09-07: "the separator sheet print … only needs to be 1
 * page with a barcode — the split should happen when the code is seen, no need for numbering". Both print
 * surfaces now ask for ONE PLAIN sheet (generateFilingSlips(1, { plain: true })); the IPC passes --plain to the
 * generator and names the file separator-sheet-NNNN.pdf; the preload forwards opts; the settings count box is
 * hidden; the help copy says "print or photocopy as many copies as you need". Source pin.
 *
 *   node src/windows/main/test_print_slips_single.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..', '..');
let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const main = read('src/windows/main/renderer.js'), mainHtml = read('src/windows/main/index.html');
const set = read('src/windows/settings/renderer.js'), setHtml = read('src/windows/settings/index.html');
const pre = read('src/preload.js'), ph = read('src/modules/processing/handler.js');
const py = read('python_backend/filing_slips.py'), help = read('src/windows/help/importing.html');

console.log('1 both surfaces ask for ONE plain sheet');
check('Import screen: generateFilingSlips(1, { plain: true })', /generateFilingSlips\(1, \{ plain: true \}\)/.test(main));
check('Settings: generateFilingSlips(1, { plain: true })', /generateFilingSlips\(1, \{ plain: true \}\)/.test(set));
check('Import button copy says "a separator sheet"', /id="btn-print-slips"[^>]*>Print a separator sheet</.test(mainHtml));
check('Settings row copy: one sheet, copies, no numbering', /Print a separator sheet<\/div>/.test(setHtml) && /no numbering is needed/.test(setHtml));
check('the settings count box is hidden (kept for wiring)', /id="filing-slips-count"[^>]*display:none/.test(setHtml));

console.log('2 the road');
check('preload forwards opts', /generateFilingSlips:\s+\(count, opts\)\s+=> ipcRenderer\.invoke\('generate-filing-slips', count, opts\)/.test(pre));
check("the IPC reads opts.plain and passes --plain", /const plain = !!\(opts && opts\.plain\);/.test(ph) && /\.\.\.\(plain \? \['--plain'\] : \[\]\)/.test(ph));
check('a plain sheet is named separator-sheet-NNNN.pdf (the numbered pack keeps its name)', /plain \? `separator-sheet-\$\{pad4\(first\)\}\.pdf` : slipPackName\(first, last\)/.test(ph));

console.log('3 the generator');
check('make_sheet(number, plain=False) — same QR payload contract', /def make_sheet\(number, plain=False\):/.test(py) && /payload = f"SFSEP-\{number:04d\}"/.test(py));
check('plain replaces the big number with "SEPARATOR SHEET"', /if plain:\s*\n\s*d\.text\(\(PAGE_W \/\/ 2, y \+ 130\), "SEPARATOR SHEET"/.test(py));
check('plain instructions: print or photocopy copies', /Print or photocopy as many copies as you need — every copy works the same\./.test(py));
check('--plain CLI flag + JSON echo', /add_argument\("--plain", action="store_true"/.test(py) && /"plain": bool\(args\.plain\)/.test(py));
check('the numbered pack path is untouched (SEPARATOR NN still drawn when not plain)', /f"SEPARATOR \{number:02d\}"/.test(py));

console.log('4 the help copy');
check('help: print or photocopy copies, nothing to number', /print or photocopy as many copies as you need/.test(help) && /nothing to number/.test(help));

console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
