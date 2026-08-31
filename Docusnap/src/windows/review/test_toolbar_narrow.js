#!/usr/bin/env node
'use strict';
/**
 * test_toolbar_narrow.js — the Review document toolbar in a NARROW window (owner 2026-08-27: "the review window
 * buttons float over each other when the window size is reduced").
 *
 * The toolbar (#doc-toolbar) is a one-line flex row whose buttons never shrank and whose row never clipped, so at
 * small widths the Page/Next/Straighten/Print controls overflowed the document panel and painted over the
 * Extracted Fields header. The fix keeps the row ONE line (the activity strip / readout / hint bars anchor to its
 * 46 px bottom through --doc-head-h, so wrapping is NOT an option), clips it to its panel, lets the filename yield
 * first, and collapses the button WORDS to glyphs below ~700 px of panel width via a container query. Source pins:
 *   1. #doc-toolbar: flex-wrap nowrap + overflow hidden + min-width 0 (clip, never overlap, never wrap)
 *   2. #doc-panel is the container (container-type: inline-size) and the query hides the .lbl words
 *   3. the filename shrinks first (flex-basis 40px, min-width 24px)
 *   4. every worded toolbar button wraps its word in <span class="lbl"> — markup AND the renderer's rewrite of
 *      the Straighten button (updateDeskewBtn), so a toggle can't drop the wrapper
 *   5. --doc-head-h stays 46px (the one-line contract the absolute children depend on)
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe src/windows/review/test_toolbar_narrow.js
 */
const fs = require('fs');
const path = require('path');
let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };
const norm = (s) => s.split('\r\n').join('\n');
const html = norm(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'));
const js   = norm(fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'));

const toolbarCss = (html.match(/#doc-toolbar \{[\s\S]*?\}/) || [''])[0];
check('1. #doc-toolbar never wraps', /flex-wrap:\s*nowrap/.test(toolbarCss));
check('1. #doc-toolbar clips its overflow', /overflow:\s*hidden/.test(toolbarCss));
check('1. #doc-toolbar may shrink (min-width 0)', /min-width:\s*0/.test(toolbarCss));
check('2. #doc-panel is an inline-size container', /#doc-panel \{ container-type: inline-size; \}/.test(html));
check('2. a container query collapses the button words', /@container \(max-width: 700px\)[\s\S]*?#doc-toolbar \.doc-nav-btn \.lbl[^}]*display: none/.test(html));
check('3. the filename yields first', /\.doc-name \{[^}]*flex: 1 1 40px;[^}]*min-width: 24px/.test(html));
for (const id of ['btn-page-prev', 'btn-page-next', 'btn-deskew', 'btn-print-doc']) {
  const m = html.match(new RegExp(`id="${id}"[^>]*>[\\s\\S]*?</button>`));
  check(`4. ${id} wraps its word in <span class="lbl">`, !!m && /<span class="lbl">[A-Za-z]+<\/span>/.test(m[0]));
}
check('4. updateDeskewBtn keeps the .lbl wrapper on both states',
      /btn\.innerHTML = straightened \? '&#8734; <span class="lbl">Straightened<\/span>' : '&#8734; <span class="lbl">Straighten<\/span>'/.test(js));
check('5. --doc-head-h stays the one-line 46px contract', /--doc-head-h: 46px/.test(html));

console.log(fails ? `\n${fails} FAILED` : '\nAll narrow-toolbar pins passed');
process.exit(fails ? 1 : 0);
