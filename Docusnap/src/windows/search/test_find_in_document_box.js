'use strict';
/*
 * test_find_in_document_box.js — PIN for the "Find in this document" input (owner, 2026-09-13).
 *
 * A dedicated find box in the preview's top-right Find cluster, searching ONLY the open document
 * (reuses the per-doc findInDocument backend + the page-fraction highlight overlay built 09-13 DAY).
 * These source pins catch a drifted call-site across the HTML + preview JS — the box has no unit-
 * runnable DOM, so the wiring is what we guard.
 *
 * Run: node src/windows/search/test_find_in_document_box.js
 */
const path = require('path');
const fs   = require('fs');
const REPO = path.resolve(__dirname, '..', '..', '..');
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };

console.log('1. the input lives in the preview Find cluster (top-right nav bar)');
{
  const html = read('src/windows/search/index.html');
  check('input #inp-find-doc exists', /id="inp-find-doc"/.test(html));
  const nav = html.slice(html.indexOf('id="match-nav"'), html.indexOf('id="btn-match-next"') + 160);
  check('it sits inside the #match-nav (Find) group, before the ‹ / › stepper', /id="inp-find-doc"/.test(nav));
  check('the ‹ / › steppers start disabled (no matches yet)',
        /id="btn-match-prev"[^>]*disabled/.test(nav) && /id="btn-match-next"[^>]*disabled/.test(nav));
  check('the .mn-input has a style rule', /\.mn-input\s*\{/.test(html));
}

console.log('2. the Find cluster is shown whenever a doc is previewed (input always usable)');
{
  const pv = read('src/windows/shared/search-ui/searchPreview.js');   // the shared search UI (2026-09-13)
  const sync = pv.slice(pv.indexOf('function _syncPageNav'), pv.indexOf('function _showPage'));
  check("_syncPageNav reveals #match-nav when pages exist (hidden ONLY when the transport cannot find — caps.find === false)",
        /const findOn = _cap\('find'\);/.test(sync) && /getElementById\('match-nav'\)[^\n]*display = findOn \? '' : 'none'/.test(sync));
  check('_updateMatchNav no longer hides the whole group (only count + disable steppers)',
        !/getElementById\('match-nav'\); if \(nav\) nav\.style\.display/.test(pv)
        && /btn-match-prev'\); if \(prev\) prev\.disabled = !on/.test(pv));
}

console.log('3. the input searches ONLY the current doc, with step/clear keys');
{
  const pv = read('src/windows/shared/search-ui/searchPreview.js');   // the shared search UI (2026-09-13)
  check('runDocFind calls findInDocument for the SELECTED doc', /findInDocument\(doc\.id, term\)/.test(pv));
  check('a stale-selection guard protects a late result', /if \(s\.selectedDoc !== doc\) return;/.test(pv));
  check('no-match state is shown on the input', /classList\.add\('no-match'\)/.test(pv));
  const init = pv.slice(pv.indexOf('function initPageNav'), pv.length);
  check('debounced live search on input', /addEventListener\('input'[\s\S]{0,160}setTimeout\(\(\) => runDocFind/.test(init));
  check('Enter steps to next / Shift+Enter previous once matched, else searches',
        /if \(_matches\.length && v === _findTerm\) _gotoMatch\(_matchIdx \+ \(e\.shiftKey \? -1 : 1\)\)/.test(init));
  check('Esc clears the box', /e\.key === 'Escape'[\s\S]{0,120}runDocFind\(''\)/.test(init));
  check('nav keys stopPropagation so list ↑/↓ doc-cycling does not fire while typing',
        /e\.key === 'ArrowUp' \|\| e\.key === 'ArrowDown'[\s\S]{0,60}stopPropagation/.test(init));
}

console.log('4. opening a doc from a search seeds the box with the list term');
{
  const pv = read('src/windows/shared/search-ui/searchPreview.js');   // the shared search UI (2026-09-13)
  check('selectDoc sets the input value to the active query', /findInput\.value = q;/.test(pv));
}

console.log('5. scanned-page OCR fallback is wired (tesseract path threaded to pdf_find)');
{
  const svc = read('src/services/previewService.js');
  check('findInDocument forwards --tesseract when provided', /if \(deps\.tesseract\) args\.push\('--tesseract', deps\.tesseract\)/.test(svc));
  const rh = read('src/modules/review/handler.js');
  check('find-in-document handler supplies the tesseract path',
        /find-in-document'[\s\S]{0,1200}tesseract: typeof tesseractPath === 'function' \? tesseractPath\(\) : tesseractPath/.test(rh));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
