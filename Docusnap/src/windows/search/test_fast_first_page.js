'use strict';
/*
 * test_fast_first_page.js — PIN for the fast-first-page PDF preview (owner, 2026-09-13: an 8 MB
 * multi-page PDF was slow to open). Page 1 is rendered + painted immediately, then the full page set
 * preloads in the background. Source pins guard the wiring across service/IPC/preload/renderer; the
 * actual raster is pypdfium2 + spawn (covered by the render path, not re-exercised here).
 *
 * Run: node src/windows/search/test_fast_first_page.js
 */
const path = require('path');
const fs   = require('fs');
const REPO = path.resolve(__dirname, '..', '..', '..');
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };

console.log('1. service renders ONE page (pdf-only, null fallback)');
{
  const ps = read('src/services/previewService.js');
  // (?!s) so "getDocumentPages" — which CONTAINS "getDocumentPage" — can't false-pass this: the SINGLE
  // -page fn must be its own export (it was defined but unexported until 2026-09-13, and this pin missed it).
  check('getDocumentPage (singular) is exported', /module\.exports = \{[^}]*getDocumentPage(?!s|Count)/.test(ps));
  check('getDocumentPageCount is exported', /module\.exports = \{[^}]*getDocumentPageCount/.test(ps));
  const body = ps.slice(ps.indexOf('function getDocumentPage'), ps.indexOf('function getThumbnail'));
  check('non-PDF → null (caller uses full render / grid instead)', /!== '\.pdf'\) return Promise\.resolve\(null\)/.test(body));
  check("uses pages.py single-page mode (--thumb --page)", /'--thumb', '--page'/.test(body));
}

console.log('2. IPC + preload');
{
  const rh = read('src/modules/review/handler.js');
  check('review handler registers get-document-page', /ipcMain\.handle\('get-document-page'/.test(rh));
  check('it resolves the file server-side', /get-document-page'[\s\S]{0,700}SELECT working_path, stored_path, folder_path, original_filename/.test(rh));
  const pre = read('src/preload.js');
  check('preload exposes getDocumentPage (with the 2026-09-14 format arg)', /getDocumentPage:\s+\(id, index, scale, format\) => ipcRenderer\.invoke\('get-document-page', id, index, scale, format\)/.test(pre));
  check('the IPC accepts format auto|jpeg only (anything else = PNG, unchanged)', /get-document-page', async \(_e, docId, index, scale, format\)/.test(rh) && /const fmt = \(format === 'auto' \|\| format === 'jpeg'\) \? format : undefined;/.test(rh));
}

console.log('3. renderer renders ONLY page 1 for a multi-page PDF, then loads the rest LAZILY on demand');
{
  const pv = read('src/windows/shared/search-ui/searchPreview.js');   // the shared search UI (2026-09-13)
  check('page 1 painted first for ANY PDF (not gated on a known page_count; only the transport CAP gates it)',
        /if \(_isPdf && _cap\('singlePage'\)\)/.test(pv) && /const _pageCount = Number\(merged\.page_count\) \|\| 0;/.test(pv));
  check('page-1 render via getDocumentPage(doc.id, 0, …) asking for the auto (JPEG-for-scans) format', /getDocumentPage\(doc\.id, 0, SEARCH_RENDER_SCALE, SEARCH_RENDER_FORMAT\)/.test(pv) && /const SEARCH_RENDER_FORMAT = 'auto';/.test(pv));
  check('SPARSE page array when count known; single-page array otherwise (NOT all pages up front)',
        /s\.currentPages = _pageCount > 1 \? new Array\(_pageCount\) : \[first\]/.test(pv));
  check('unknown count (NULL/0): page 1 shown, count PROBED cheaply (no all-pages render) for nav',
        /if \(_pageCount <= 1 && _cap\('pageCount'\)\)[\s\S]{0,700}getDocumentPageCount\(doc\.id\)\.then/.test(pv)
        && /const arr = new Array\(cnt\);[\s\S]{0,80}arr\[0\] = s\.currentPages\[0\]/.test(pv));
  check('_showPage is lazy: fetches a hole via getDocumentPage(mine.id, idx, …)',
        /async function _showPage/.test(pv) && /getDocumentPage\(mine\.id, idx, SEARCH_RENDER_SCALE, SEARCH_RENDER_FORMAT\)/.test(pv));
  check('the Contents panel loads AFTER the first paint (never before it) and is staleness-guarded',
        /await _showPage\(0\);\s*\n\s*_loadOutline\(mine\);/.test(pv) && /if \(window\.SearchState\.selectedDoc !== doc\) return;/.test(pv) && /_clearOutline\(\);/.test(pv));
  check('full getDocumentPages is only the FALLBACK/else path, not the multi-page happy path',
        pv.indexOf('getDocumentPage(doc.id, 0') < pv.indexOf('getDocumentPages(doc.id, null, null, SEARCH_RENDER_SCALE)'));
  check('staleness-guarded (a newer selection wins)', /const first = await window\.SearchTransport\.getDocumentPage[\s\S]{0,80}if \(s\.selectedDoc !== mine\) return;/.test(pv));
  check('every page read goes through the transport (never window.docusnap — the shared module is app-agnostic)',
        !/window\.docusnap/.test(pv));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
