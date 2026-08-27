#!/usr/bin/env node
'use strict';
/**
 * test_activity_actions_columns.js — the activity panel's row actions sit in THREE FIXED COLUMNS
 * (owner 2026-08-27: "this window looks a bit messy, can we give each button its own column with the permanent
 * ones to the right"). "Put back" only exists on undoable rows, so the two permanent buttons (See them, Quick check)
 * used to slide left and right from row to row. Now every row renders [Put back | See them | Quick check] in that
 * order, with an INVISIBLE placeholder (same element, same label — so the same width) in any slot the row lacks.
 *
 *   1. the actions block is a 3-column grid and the ghost class is invisible + inert
 *   2. the renderer emits the three slots in the order Put back, See them, Quick check
 *   3. every slot falls back to a same-label ghost BUTTON (not '' and not a span)
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe src/windows/review/test_activity_actions_columns.js
 */
const fs = require('fs');
const path = require('path');
let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };
const norm = (s) => s.split('\r\n').join('\n');
const html = norm(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'));
const js   = norm(fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'));

check('1. .ap-actions is a three-column grid', /\.ap-actions \{[^}]*display: grid;[^}]*grid-template-columns: repeat\(3, max-content\)/.test(html));
check('1. .ap-ghost is invisible and inert', /\.ap-btn\.ap-ghost \{[^}]*visibility: hidden;[^}]*pointer-events: none/.test(html));
check('2. slots emitted in the order Put back, See them, Quick check', /<span class="ap-actions">\$\{undo\}\$\{see\}\$\{qcheck\}<\/span>/.test(js));
const ghostDef = /const _apGhost = \(label\) => `<button type="button" class="ap-btn ap-ghost" disabled tabindex="-1" aria-hidden="true">\$\{label\}<\/button>`;/.test(js);
check('3. the ghost is a same-element BUTTON with the same label', ghostDef);
check("3. 'Put back' falls back to its ghost", /: _apGhost\('Put back'\);/.test(js));
check("3. 'See them' falls back to its ghost", /: _apGhost\('See them'\);/.test(js));
check("3. 'Quick check' falls back to its ghost", /: _apGhost\('Quick check'\);/.test(js));
check('3. no slot falls back to an empty string any more', !/data-ap="see"[^\n]*\n?[^\n]*: '';/.test(js));

console.log('\n4. distinct sections (owner: "no real formatting on the text")');
check('4. a row is a [time | body | actions] grid', /\.ap-row \{[^}]*display: grid;[^}]*grid-template-columns: 78px minmax\(0, 1fr\) auto/.test(html));
check('4. the time is a small mono column', /\.ap-when \{[^}]*font-family: var\(--mono\)/.test(html));
check('4. the headline is split into WHAT (bold) and WHY (muted) at the first dash', /const _full = _asLineFull\(ev\), _cut = _full\.indexOf\(' — '\);/.test(js) && /\.ap-what \{ font-weight: 600; \}/.test(html) && /\.ap-why \{ color: var\(--muted\)/.test(html));
check('4. the headline icon carries the strip\'s colour class', /<span class="ap-ico \$\{_asIconClass\(ev\)\}">\$\{_asIcon\(ev\)\}<\/span>/.test(js) && /\.ap-line \.ap-ico\.filed \{ color: var\(--ok\); \}/.test(html));
check('4. sender counts render as chips with a bold count', /<span class="ap-chip">\$\{escHtml\(k\)\} <b>\$\{v\}<\/b><\/span>/.test(js) && /\.ap-chip \{[^}]*border-radius: var\(--r-pill\)/.test(html));
check('4. kept-back is an amber-barred note', /\.ap-kept \{[^}]*border-left: 2px solid var\(--warn\)/.test(html));
check('4. the row markup is time / body(line, chips, kept) / actions', /<div class="ap-row"><div class="ap-when">[\s\S]*?<\/div><div class="ap-body"><div class="ap-line">\$\{line\}<\/div>\$\{by\}\$\{kept\}<\/div><span class="ap-actions">/.test(js));
check('4. no theme-foreign colour literals in the panel styles', !/\.ap-(row|when|line|what|why|chip|kept|sub) \{[^}]*#[0-9a-f]{3,6}/i.test(html));

console.log(fails ? `\n${fails} FAILED` : '\nAll activity-actions column pins passed');
process.exit(fails ? 1 : 0);
