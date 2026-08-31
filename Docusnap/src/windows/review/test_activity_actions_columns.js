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
check('4. a row is a [time | body | actions] grid', /\.ap-row \{[^}]*display: grid;[^}]*grid-template-columns: 92px minmax\(0, 1fr\) auto/.test(html));
check('4. the time is a right-aligned sans margin note on the 20px line unit', /\.ap-when \{[^}]*font-family: inherit;[^}]*line-height: 20px;[^}]*text-align: right/.test(html));
console.log('\n5. design pass (one line unit, two rails, one tinted primary, sticky titled header)');
check('5. the body carries the icon rail (18px) and the icon sits on it absolutely', /\.ap-body \{[^}]*padding-left: 18px/.test(html) && /\.ap-line \.ap-ico \{[^}]*position: absolute; left: 0; top: 0; width: 14px; line-height: 20px/.test(html));
check('5. headline, chips and buttons share the 20px line unit', /\.ap-line \{[^}]*line-height: 20px/.test(html) && /\.ap-chip \{[^}]*line-height: 20px/.test(html) && /\.ap-btn \{[^}]*height: 20px; line-height: 18px/.test(html));
check('5. the primary is a TINT with --text (not a saturated block)', /\.ap-btn\.primary \{[^}]*background: var\(--accent-bg\);[^}]*color: var\(--text\)/.test(html));
check('5. chips are fill only (no border)', /\.ap-chip \{[^}]*border: 0;/.test(html));
check('5. a sticky titled header replaces the floating X', /\.ap-head \{[^}]*position: sticky; top: 0/.test(html) && /<div class="ap-head"><span class="ap-title">\$\{_asOpenId === 'recent' \? 'Recent activity' : 'This batch'\}<\/span>/.test(js));
check('5. the panel is capped and is its own container; narrow rows drop the actions under the body', /#activity-panel \{[^}]*max-width: 1120px;[^}]*container-type: inline-size/.test(html) && /@container \(max-width: 780px\) \{\s*\.ap-row \{ grid-template-columns: 92px minmax\(0, 1fr\); \}\s*\.ap-actions \{ grid-column: 2; margin-top: 8px; \}/.test(html));
check('4. the headline is split into WHAT (bold) and WHY (muted) at the first dash', /const _full = _asLineFull\(ev\), _cut = _full\.indexOf\(' — '\);/.test(js) && /\.ap-what \{ font-weight: 600; \}/.test(html) && /\.ap-why \{ color: var\(--muted\)/.test(html));
check('4. the headline icon carries the strip\'s colour class', /<span class="ap-ico \$\{_asIconClass\(ev\)\}">\$\{_asIcon\(ev\)\}<\/span>/.test(js) && /\.ap-line \.ap-ico\.filed \{ color: var\(--ok\); \}/.test(html));
check('4. sender counts render as chips with a bold count', /<span class="ap-chip">\$\{escHtml\(k\)\} <b>\$\{v\}<\/b><\/span>/.test(js) && /\.ap-chip \{[^}]*border-radius: var\(--r-pill\)/.test(html));
check('4. kept-back is an amber-barred note', /\.ap-kept \{[^}]*border-left: 2px solid var\(--warn\)/.test(html));
check('4. the row markup is time / body(line, chips, kept) / actions', /<div class="ap-row"><div class="ap-when">[\s\S]*?<\/div><div class="ap-body"><div class="ap-line">\$\{line\}<\/div>\$\{by\}\$\{kept\}<\/div><span class="ap-actions">/.test(js));
check('4. no theme-foreign colour literals in the panel styles', !/\.ap-(row|when|line|what|why|chip|kept|sub) \{[^}]*#[0-9a-f]{3,6}/i.test(html));

console.log('\n6. the zero-filed receipt (owner: "what is this notification? it doesn\'t make sense")');
check("6. a zero-filed 'approved' row says Nothing filed, never 'You filed 0 … in one go'", /case 'approved':\s+return n === 0 \? `Nothing filed\$\{sup \? ` from <b>\$\{sup\}<\/b>` : ''\} — see why below`/.test(js));
check("6. the kept-back reason names YOU when the viewer is the actor", /'being-viewed-by-you': 'you have it open in Review — confirm it from there'/.test(html + js) && /'being-viewed':\s+'being viewed by someone else'/.test(js));
const handlerSrc = norm(fs.readFileSync(path.join(__dirname, '..', '..', 'modules', 'processing', 'handler.js'), 'utf8'));
check("6. the sweep emits 'being-viewed-by-you' when every viewer is the current user", /reason: _onlyMe \? 'being-viewed-by-you' : 'being-viewed'/.test(handlerSrc) && /_viewers\.every\(v => String\(v\.username \|\| ''\)\.trim\(\)\.toLowerCase\(\) === _me\)/.test(handlerSrc));
const evSrc = norm(fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'reviewEvents.js'), 'utf8'));
check('6. a zero-filed event is never undoable (no Put back for nothing)', /undoable: n > 0 && _undoable\(ev\)/.test(evSrc));

console.log(fails ? `\n${fails} FAILED` : '\nAll activity-actions column pins passed');
process.exit(fails ? 1 : 0);
