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
  check('getDocumentPage exported', /getDocumentPage\b/.test(ps) && /module\.exports = \{[^}]*getDocumentPage/.test(ps));
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
  check('preload exposes getDocumentPage', /getDocumentPage:\s+\(id, index, scale\) => ipcRenderer\.invoke\('get-document-page', id, index, scale\)/.test(pre));
}

console.log('3. renderer paints page 1 first for a multi-page doc, then preloads the rest');
{
  const pv = read('src/windows/search/search-preview.js');
  check('multi-page gate on page_count', /const _pageCount = Number\(merged\.page_count\) \|\| 0;[\s\S]{0,80}if \(_pageCount > 1\)/.test(pv));
  check('early page-1 paint via getDocumentPage(doc.id, 0, …)', /getDocumentPage\(doc\.id, 0, SEARCH_RENDER_SCALE\)/.test(pv));
  check('full getDocumentPages still runs afterwards (preloads the rest + nav)',
        pv.indexOf('getDocumentPage(doc.id, 0') < pv.indexOf('getDocumentPages(doc.id, null, null, SEARCH_RENDER_SCALE)'));
  check('staleness-guarded (a newer selection wins)', /const first = await window\.docusnap\.getDocumentPage[\s\S]{0,80}if \(s\.selectedDoc !== mine\) return;/.test(pv));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
