'use strict';
/*
 * test_review_not_recognised_ui.js — the "Not recognised" tab's BULK action asks first (Chris 2026-09-24 one-liner:
 * "Set aside all" moved seven papers to Deferred with no prompt; reversible per row, but silent).
 * Run: node src/windows/review/test_review_not_recognised_ui.js
 *
 * Source-regex pin (the renderer runs only inside Electron). The membership predicate itself is pinned in
 * src/windows/shared/test_not_recognised.js; this file covers the tab's UI contract:
 *   1. "Set aside all" asks ONCE with the COUNT and the way back — the same native confirm() the delete and the
 *      big put-back use (one idiom, one help-mode wrapper) — and does nothing when declined;
 *   2. the per-row actions stay prompt-free for set-aside (a single row is cheap to bring back);
 *   3. the tab intro speaks about the SENDER (card 8 layout fix, 2026-09-24).
 */
const fs = require('fs');
const path = require('path');
const renderer = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8').replace(/\r\n/g, '\n');

let fails = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'BAD ') + label); if (!cond) fails++; };

const start = renderer.indexOf("setAside.textContent = 'Set aside all';");
check('the Not-recognised head carries the one bulk action "Set aside all"', start > -1);
const handler = start > -1 ? renderer.slice(start, start + 1200) : '';
const askIdx = handler.indexOf('if (!confirm(`Set aside ${_n} document');
const deferIdx = handler.indexOf('await window.docusnap.deferDocument(d.id)');
check('1. it asks ONCE with the count before any defer call (ordering)', askIdx > -1 && deferIdx > -1 && askIdx < deferIdx);
check('1. ... the prompt names the way back (Deferred → open one to bring it back)',
      /They move to Deferred — open one there to bring it back to Review\./.test(handler));
check('1. ... and a decline returns before the button is disabled or anything moves',
      /if \(!confirm\(`Set aside[^\n]*\)\) return;\s*\n\s*setAside\.disabled = true;/.test(handler));
check('1. ... pluralised honestly (1 document / N documents)', /document\$\{_n === 1 \? '' : 's'\}\?/.test(handler));
check('2. the same native confirm() idiom the delete uses (no second modal system)',
      /if \(!confirm\(`Delete "\$\{doc\.original_filename\}"\?/.test(renderer));
check('3. the tab intro speaks about the SENDER', /The sender of these documents couldn’t be identified\./.test(renderer));

console.log(fails ? `\n${fails} FAILED` : '\nall green');
process.exit(fails ? 1 : 0);
