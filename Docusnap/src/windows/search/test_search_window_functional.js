'use strict';
/*
 * test_search_window_functional.js — the core Search window DRIVEN in a real renderer (client search
 * parity 2026-09-13, S0 gate). Spawns scripts/search-window-harness.js under the project's Electron
 * (as Electron, not as Node — the run-pins RUN_AS_NODE flag is stripped): the real index.html + the real
 * src/preload.js (contextIsolation, sandbox, CSP) over stubbed IPC, then a scripted user session —
 * results populate, a click previews (fields, lazy page 1, page nav, find highlights, action buttons),
 * page-next renders a hole, the .xlsx grid draws, the recycle bin toggles, ↓ cycles the selection.
 * Also asserts the IPC arity the adapter must preserve (get-document-pages (id,null,null,3), the sparse
 * page path never probing a known count, find-in-document (id, term)).
 *
 *   node src/windows/search/test_search_window_functional.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };

const exe = path.join(ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
if (!fs.existsSync(exe)) { console.log('  FAIL node_modules/electron missing — cannot run the windowed harness'); console.log('\n0 passed, 1 failed'); process.exit(1); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-search-fn-'));
const report = path.join(tmp, 'report.json');
const dump = path.join(tmp, 'dom.json');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;   // a WINDOW needs Electron proper
const r = spawnSync(exe, [path.join(ROOT, 'scripts', 'search-window-harness.js'), '--report', report, '--dump', dump], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000, windowsHide: true });

let rec = null;
try { rec = JSON.parse(fs.readFileSync(report, 'utf8')); } catch { /* no report */ }
if (!rec) {
  const line = String(r.stdout || '').split(/\r?\n/).find(l => l.startsWith('search-harness '));
  if (line) { try { rec = JSON.parse(line.slice('search-harness '.length)); } catch {} }
}
check('the harness ran and produced a report', !!rec);
if (!rec) {
  console.log((r.stdout || '').slice(-1500)); console.log((r.stderr || '').slice(-1500));
  console.log(`\n${pass} passed, ${fail + 1} failed`); process.exit(1);
}
console.log(`harness exit ${r.status}; ${rec.checks.length} in-page checks`);
for (const c of rec.checks) check(c.name, c.ok);
if (rec.consoleErrors && rec.consoleErrors.length) console.log('  (renderer console errors: ' + rec.consoleErrors.slice(0, 5).join(' | ') + ')');

console.log('IPC arity at the adapter seam');
const calls = rec.calls || [];
const has = (ch, pred) => calls.some(([c, a]) => c === ch && (!pred || pred(a)));
check('search-documents called with the params object (fullText inv)', has('search-documents', a => a[0] && a[0].fullText === 'inv'));
check('get-document-page (id 1, index 0, scale 3) — the lazy page-1 read', has('get-document-page', a => a[0] === 1 && a[1] === 0 && a[2] === 3));
check('get-document-page (id 1, index 1, scale 3) — the hole rendered on page-next', has('get-document-page', a => a[0] === 1 && a[1] === 1 && a[2] === 3));
check('a KNOWN page_count is never probed (no get-document-page-count for id 1)', !has('get-document-page-count', a => a[0] === 1));
check('an UNKNOWN page_count IS probed (get-document-page-count for id 3)', has('get-document-page-count', a => a[0] === 3));
check('get-document-pages (id 2, null, null, 3) — the non-PDF full-render arity preserved', has('get-document-pages', a => a[0] === 2 && a[1] === null && a[2] === null && a[3] === 3));
check('find-in-document (1, "inv") — the list-term highlight', has('find-in-document', a => a[0] === 1 && a[1] === 'inv'));
check('get-spreadsheet-grid (2) — the xlsx grid', has('get-spreadsheet-grid', a => a[0] === 2));
check('get-deleted-queue — the bin read', has('get-deleted-queue'));
check('get-document-thumbnail (id, null, null) — the row thumbnails through the transport twin', has('get-document-thumbnail', a => a.length === 3 && a[1] === null && a[2] === null));
check('get-setting keep_processed_originals is read lazily at most once (purge suffix)', calls.filter(([c, a]) => c === 'get-setting' && a[0] === 'keep_processed_originals').length <= 1);
check('the first-paint re-decoration is NOT a second search: search-documents ran exactly twice (initial + back-from-bin)', calls.filter(([c]) => c === 'search-documents').length === 2);

console.log('S4 — the shared workflow / mailbox / stamp modules on the core (harness --workflow)');
{
  const rep2 = path.join(tmp, 'report-wf.json');
  const r2 = spawnSync(exe, [path.join(ROOT, 'scripts', 'search-window-harness.js'), '--workflow', '--report', rep2], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000, windowsHide: true });
  let rec2 = null; try { rec2 = JSON.parse(fs.readFileSync(rep2, 'utf8')); } catch {}
  check('the workflow run produced a report', !!rec2);
  if (rec2) {
    console.log(`harness(--workflow) exit ${r2.status}; ${rec2.checks.length} in-page checks`);
    for (const c of rec2.checks.filter(c => /workflow|popup|mailbox|Send or stamp/.test(c.name))) check(c.name, c.ok);
    check('every in-page check of the workflow run passed', rec2.checks.every(c => c.ok));
    const calls2 = rec2.calls || [];
    check('the desktop workflow bridge was driven through the core adapter (workflow-inbox / recipients / stamp-types)',
          calls2.some(([c]) => c === 'workflow-inbox') && calls2.some(([c]) => c === 'workflow-recipients') && calls2.some(([c]) => c === 'stamp-types'));
  }
}

console.log('S0b mount contract + the load-bearing layout (the height chain a wrapper would break)');
let d = null; try { d = JSON.parse(fs.readFileSync(dump, 'utf8')); } catch {}
check('the DOM dump was produced', !!d && !!d.styles);
if (d && d.styles) {
  const kids = d.appChildren || [];
  check('#search-bar / #date-range-note / #body are DIRECT children of #app (no wrapper)',
        ['search-bar', 'date-range-note', 'body'].every(id => kids.includes(id)));
  check('#app is the flex column (display flex, column)', d.styles.app && d.styles.app.display === 'flex' && d.styles.app.flexDirection === 'column');
  check('#body grows to fill it (flex 1) and clips (overflow hidden)', d.styles.body && /^1\b/.test(d.styles.body.flex) && d.styles.body.overflow === 'hidden');
  check('#results-pane keeps its 420px column; #preview-pane is the flex-1 remainder',
        d.styles['results-pane'] && d.styles['results-pane'].width === '420px' && d.styles['preview-pane'] && /^1\b/.test(d.styles['preview-pane'].flex));
  check('#results-scroll and #preview-img-area are the scroll containers (overflow auto)',
        d.styles['results-scroll'] && /auto/.test(d.styles['results-scroll'].overflow) && d.styles['preview-img-area'] && /auto/.test(d.styles['preview-img-area'].overflow));
  check('the panes have real height (the height chain is intact)',
        parseInt(d.styles.body.height, 10) > 300 && parseInt(d.styles['results-pane'].height, 10) > 300);
  check('stylesheets load in the load-bearing order: theme → searchUI → searchComponents',
        (() => { const s = (d.sheets || []).join(' '); return s.indexOf('theme.css') >= 0 && s.indexOf('theme.css') < s.indexOf('searchUI.css') && s.indexOf('searchUI.css') < s.indexOf('searchComponents.css'); })());
  check('the shared markup script loads before the other shared scripts',
        (() => { const s = d.scripts || []; const i = s.findIndex(x => /searchMarkup\.js/.test(x || '')); const j = s.findIndex(x => /searchState\.js/.test(x || '')); return i >= 0 && j > i; })());
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
