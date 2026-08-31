'use strict';
/*
 * test_teach_multipage.js — the teach wizard must be able to teach a field on ANY page.
 *
 * Until 2026-08-08 the wizard resolved getDocumentPages(...) to `pages[0]` and hard-coded
 * `page_number: 0` on commit. The hardcode was TRUTHFUL, not a bug — there was no navigation, so
 * page 1 was the only page a box could be drawn on. That is precisely why the two must never be
 * separated again: replacing the hardcode without navigation is a no-op, and adding navigation
 * without replacing the hardcode would store every page-2 box against page 1, where extraction
 * would then read the WRONG PAGE and the operator would have no way to see why.
 *
 * A static pin (no DOM/Electron needed) over the renderer + markup. It asserts the two halves are
 * both present and wired to each other, plus the three consequences that make the feature honest:
 * a stored box carries the page it was drawn on, boxes are only drawn on their own page, and
 * selecting a field taught elsewhere follows it to that page.
 *
 *   node src/windows/teach/test_teach_multipage.js
 */
const fs = require('fs');
const path = require('path');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

const raw = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
// Strip line comments before asserting on structure. The comments here deliberately DESCRIBE the
// old shape ("used to resolve ... pages[0]"), so a naive source scan finds the very pattern it is
// checking has gone — the first run of this pin failed on its own documentation.
const js = raw.split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

console.log('\nTHE TWO HALVES — navigation and the page number must ship together');
check('every rendered page is kept (the pages[0] discard is gone)',
      !/getDocumentPages\([^)]*\)[\s\S]{0,120}pages\[0\]/.test(js));
check('the commit no longer hard-codes page_number:0',
      !/page_number\s*:\s*0\s*,/.test(js));
check('the commit sends the page the box was drawn on',
      /page_number\s*:\s*Number\.isInteger\(r\.page\)\s*\?\s*r\.page\s*:\s*0/.test(js));
check('a stored result records its page at the single place a box is stored (store())',
      /state\.results\[f\.key\]\s*=\s*\{[^}]*page\s*:\s*state\.pageIndex/.test(js));

console.log('\nNAVIGATION');
check('showTeachPage() exists and is the one path onto the canvas', js.includes('async function showTeachPage('));
check('gotoTeachPage() exists', js.includes('async function gotoTeachPage('));
check('renderPageNav() exists', js.includes('function renderPageNav('));
check('the page strip element exists in the markup', html.includes('id="rg-pagenav"'));
check('the page strip is hidden for a single-page document',
      /const n = \(state\.pages \|\| \[\]\)\.length;[\s\S]{0,120}n <= 1[\s\S]{0,60}add\('hidden'\)/.test(js));
check('per-page render cache exists so flipping back does not re-deskew', js.includes('state.pageCache'));
check('the straightened render is banked against its own page',
      /_pc\.deskewImg = state\.deskewImg/.test(js));

console.log('\nTHE CONSEQUENCES THAT KEEP IT HONEST');
check("a half-drawn box is dropped when the page changes (it means nothing on another page)",
      /async function gotoTeachPage\([\s\S]{0,200}drag = null; drawnBox = null;/.test(js));
check('a stored box is only drawn on the page it belongs to',
      /cr\.page !== state\.pageIndex\) cr = null/.test(js));
check('selecting a field taught on another page follows it there',
      /_r\.page !== state\.pageIndex\) gotoTeachPage\(_r\.page\)/.test(js));
// Found by the sandbox smoke run: the canvas switched pages but the panel kept offering the
// previous page's read-back with a live "Looks right" button, so a value from a page the operator
// was no longer viewing could be confirmed. The stored row was always correct, so this was a trust
// defect rather than data corruption — but it is exactly the kind of thing that makes an operator
// distrust the whole wizard.
check('an UNCONFIRMED read-back is dropped when the page changes',
      /_pending\.status === 'pending'\) delete state\.results\[_cf\.key\]/.test(js));
check('the panel is reset via renderFieldPrompt (not promptField, which would flip back)',
      /_setPageLoading\(false\);[\s\S]{0,240}renderFieldPrompt\(\);/.test(js)
      && /function renderFieldPrompt\(/.test(js));

console.log('\nBACKWARD COMPATIBILITY');
check('a result with no page (an in-flight wizard across an update) still commits as page 0',
      /Number\.isInteger\(r\.page\)\s*\?\s*r\.page\s*:\s*0/.test(js));

console.log(fails ? `\n${fails} FAILED` : '\nAll teach multi-page pins passed');
process.exit(fails ? 1 : 0);
