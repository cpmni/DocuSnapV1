'use strict';
/*
 * test_ooxml_grid.js — PIN for the dependency-free .xlsx grid preview (2026-09-13 route 1).
 *
 * Part 1 round-trips through the app's OWN writer (xlsxWriter.buildXlsx) → ooxmlGrid.extractGrid, so
 * the reader is pinned against a real workbook this app produces (inline strings, workbook rels), incl.
 * XML-entity decode and the not-an-xlsx → null guard. Part 2 pins the wiring across service/IPC/preload/
 * renderer so a drifted call-site can't silently drop the preview back to "no preview available".
 *
 * Run: node src/lib/test_ooxml_grid.js
 */
const path = require('path');
const fs   = require('fs');
const REPO = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('1. round-trip: buildXlsx → extractGrid returns the cells (values only, entities decoded)');
{
  const { buildXlsx }   = require('./xlsxWriter');
  const { extractGrid } = require('./ooxmlGrid');
  const cols = [{ key: 'a', label: 'Name' }, { key: 'b', label: 'Amount' }];
  const rows = [{ a: 'Widget & Co', b: '12.50' }, { a: 'Bolt <x>', b: '3' }, { a: '', b: '0' }];
  const buf = buildXlsx(cols, rows, 'Invoices');
  const g = extractGrid(buf);
  check('a grid is returned', !!g && Array.isArray(g.sheets) && g.sheets.length === 1);
  const sh = g && g.sheets[0];
  check('header row read', sh && eq(sh.rows[0], ['Name', 'Amount']));
  check('&-entity decoded, decimals kept', sh && eq(sh.rows[1], ['Widget & Co', '12.50']));
  check('<>-entities decoded', sh && eq(sh.rows[2], ['Bolt <x>', '3']));
  check('empty cell preserved as blank (grid stays rectangular)', sh && eq(sh.rows[3], ['', '0']));
  check('sheet has a name', sh && typeof sh.name === 'string' && sh.name.length > 0);
}

console.log('2. guards: a non-xlsx buffer yields null (caller keeps its "no preview" fallback)');
{
  const { extractGrid } = require('./ooxmlGrid');
  check('random bytes → null', extractGrid(Buffer.from('this is not a zip at all')) === null);
  check('empty buffer → null', extractGrid(Buffer.alloc(0)) === null);
  check('non-buffer → null', extractGrid(null) === null);
}

console.log('3. wiring — service, IPC, preload, renderer');
{
  const ps = read('src/services/previewService.js');
  check('previewService exports getSpreadsheetGrid', /getSpreadsheetGrid\b/.test(ps) && /module\.exports = \{[^}]*getSpreadsheetGrid/.test(ps));
  check('it is xlsx-only (legacy .xls/.ods → null)', /\.xlsx'.*return null|!== '\.xlsx'\) return null/.test(ps));

  const rh = read('src/modules/review/handler.js');
  check('review handler registers get-spreadsheet-grid', /ipcMain\.handle\('get-spreadsheet-grid'/.test(rh));
  check('it resolves the file server-side (never trusts client paths)',
        /get-spreadsheet-grid'[\s\S]{0,700}SELECT working_path, stored_path, folder_path, original_filename/.test(rh));

  const pre = read('src/preload.js');
  check('preload exposes getSpreadsheetGrid', /getSpreadsheetGrid:\s+\(id\)\s+=> ipcRenderer\.invoke\('get-spreadsheet-grid', id\)/.test(pre));

  const pv = read('src/windows/shared/search-ui/searchPreview.js');   // the shared search UI (2026-09-13)
  check('renderer tries the grid when a doc has no image pages', /_tryRenderSpreadsheet\(merged, ph\)/.test(pv));
  check('grid render is xlsx-gated + calls the bridge', /\/\\\.xlsx\$\/i\.test\(fn\)/.test(pv) && /getSpreadsheetGrid\(doc\.id\)/.test(pv));

  const oo = read('src/lib/ooxmlText.js');
  check('ooxmlText additively exports the ZIP primitives the grid reuses', /openZip: _open, readZipEntry: _readEntry/.test(oo));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
