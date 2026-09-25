'use strict';
/*
 * test_client_search_popout.js — the detached client's SEARCH POP-OUT (client search parity S1, 2026-09-13;
 * Oracle S1 conditions). Two halves:
 *
 *  A. FUNCTIONAL — scripts/search-window-harness.js --client drives the REAL pop-out page
 *     (client/renderer/search/index.html + client/preload.js, contextIsolation/sandbox/CSP) over stubbed
 *     client IPC ({status,json} envelopes): results, preview, page nav, bin, ↓ cycling; the S1 capability
 *     posture (Find / grid / desktop actions / send-back / Restore-all HIDDEN, never dead); the mount
 *     contract + height chain; the IPC arity at the client adapter seam.
 *  B. SOURCE — the Oracle's S1 conditions as pins: pop-out CSP carries style-src 'self' (the main page's
 *     CSP would block the shared stylesheets); theme.css + fonts + patterns are in the sync set and the
 *     pop-out loads the REAL theme in cascade order; the adapter touches no core bridge / no Node; a client
 *     twin of the one-global-scope collision pin; main closes the pop-out on logout AND on main-window
 *     close, broadcasts connection events to EVERY window, serves the role via client-current-user; the
 *     in-pane search is reduced to a launcher (nav/Home open the window; the old view is the mailbox's
 *     viewer only).
 *
 *   node scripts/test_client_search_popout.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };

// Run the harness in client mode against a stubbed core advertising `serverContract`. PARITY (the client's own
// contract, 1.3.0+) = every S2 read available; LITE (1.2.0) = an older core: the S2 caps stay off, the
// controls hide, the "newer core needed" hint shows. Both must hold — a customer may upgrade the client first.
function runHarness(serverContract, extra = []) {
  const exe = path.join(ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
  if (!fs.existsSync(exe)) { check('node_modules/electron present', false); return null; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-popout-fn-'));
  const report = path.join(tmp, 'report.json'), dump = path.join(tmp, 'dom.json');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const args = [path.join(ROOT, 'scripts', 'search-window-harness.js'), '--client', '--report', report, '--dump', dump, ...extra];
  if (serverContract) args.push('--server-contract', serverContract);
  const r = spawnSync(exe, args, { cwd: ROOT, env, encoding: 'utf8', timeout: 120000, windowsHide: true });
  let rec = null; try { rec = JSON.parse(fs.readFileSync(report, 'utf8')); } catch {}
  check(`the harness ran and produced a report (server ${serverContract || 'parity'})`, !!rec);
  if (!rec) { console.log((r.stdout || '').slice(-1200)); console.log((r.stderr || '').slice(-1200)); return null; }
  console.log(`  harness exit ${r.status}; ${rec.checks.length} in-page checks`);
  for (const c of rec.checks) check(c.name, c.ok);
  if (rec.consoleErrors && rec.consoleErrors.length) console.log('  (renderer console errors: ' + rec.consoleErrors.slice(0, 5).join(' | ') + ')');
  let d = null; try { d = JSON.parse(fs.readFileSync(dump, 'utf8')); } catch {}
  return { rec, d, calls: rec.calls || [] };
}

console.log('A1. functional — PARITY: the pop-out against a core that has the S2 reads (contract 1.3.0)');
{
  const run = runHarness(null);
  if (run) {
    const { calls, d } = run;
    const has = (ch, pred) => calls.some(([c, a]) => c === ch && (!pred || pred(a)));
    check('client-search called with the params object (fullText inv from the deep-link)', has('client-search', a => a[0] && a[0].fullText === 'inv'));
    check('client-get-document for the clicked docs', has('client-get-document', a => a[0] === 1) && has('client-get-document', a => a[0] === 3));
    check('client-page-info (1, 0, [], 3, "auto") — ONE request for the first paint (page 1 + count + bookmarks), no `also`', has('client-page-info', a => a[0] === 1 && a[1] === 0 && Array.isArray(a[2]) && a[2].length === 0 && a[2].length === 0 && a[3] === 3 && a[4] === 'auto'));
    check('client-page-info (1, 1, [2], 3, "auto") — the read-ahead batch for pages 2-3 in ONE request, after the first paint', has('client-page-info', a => a[0] === 1 && a[1] === 1 && JSON.stringify(a[2]) === '[2]' && a[3] === 3 && a[4] === 'auto')
          && calls.findIndex(([c, a]) => c === 'client-page-info' && a[0] === 1 && a[1] === 1) > calls.findIndex(([c, a]) => c === 'client-page-info' && a[0] === 1 && a[1] === 0));
    check('doc 1: NO per-page read, NO separate outline read, NO count probe (all came with page-info / the read-ahead)', !has('client-get-page', a => a[0] === 1) && !has('client-outline', a => a[0] === 1) && !has('client-page-count'));
    check('doc 1: EXACTLY two page-info requests (the first paint, then ONE read-ahead batch) — a duplicate batch would show here (Oracle C4)', calls.filter(([c, a]) => c === 'client-page-info' && a[0] === 1).length === 2);
    check('client-find (1, "inv") — the list-term highlight over /v1', has('client-find', a => a[0] === 1 && a[1] === 'inv'));
    check('client-spreadsheet (2) — the xlsx grid over /v1', has('client-spreadsheet', a => a[0] === 2));
    check('client-get-pages only as the non-PDF full render (id 2)', has('client-get-pages', a => a[0] === 2) && !has('client-get-pages', a => a[0] === 1));
    check('no core-only channels ever called', !calls.some(([c]) => /^get-document-page$|^get-document-page-count$|^find-in-document$|^get-spreadsheet-grid$/.test(c)));
    check('client-current-user read once for the role', calls.filter(([c]) => c === 'client-current-user').length === 1);
    check('client-search-target pulled once (the deep-link)', calls.filter(([c]) => c === 'client-search-target').length === 1);
    check('client-server-info read for the capability gate', has('client-server-info'));
    check('client-get-thumbnail used for the row thumbnails', has('client-get-thumbnail'));
    check('the first-paint re-decoration is NOT a second search: client-search ran exactly 3 times (initial + setQuery + back-from-bin)', calls.filter(([c]) => c === 'client-search').length === 3);
    check('DOM dump produced', !!d && !!d.styles);
    if (d && d.styles) {
      check('#app direct children = banner, note, search-bar, date-range-note, body (no wrapper)',
            JSON.stringify(d.appChildren) === JSON.stringify(['popout-banner', 'popout-note', 'search-bar', 'date-range-note', 'body']));
      check('#app flex column; #body flex 1; panes have real height (height chain intact)',
            d.styles.app.display === 'flex' && d.styles.app.flexDirection === 'column' && /^1\b/.test(d.styles.body.flex) && parseInt(d.styles.body.height, 10) > 300 && parseInt(d.styles['results-pane'].height, 10) > 300);
      check('stylesheets: theme → searchUI → searchComponents', (() => { const s = (d.sheets || []).join(' '); return s.indexOf('theme.css') >= 0 && s.indexOf('theme.css') < s.indexOf('searchUI.css') && s.indexOf('searchUI.css') < s.indexOf('searchComponents.css'); })());
      check('scripts: themeBoot → clientTransport → searchMarkup → … → popout', (() => { const s = (d.scripts || []).map(x => x || ''); const i = (re) => s.findIndex(x => re.test(x)); return i(/themeBoot/) >= 0 && i(/themeBoot/) < i(/clientTransport/) && i(/clientTransport/) < i(/searchMarkup/) && i(/searchMarkup/) < i(/searchState/) && i(/popout\.js/) === s.length - 1; })());
    }
  }
}

console.log('A2. functional — LITE: the same pop-out against an OLDER core (1.2.0, no S2 reads)');
{
  const run = runHarness('1.2.0');
  if (run) {
    const { calls } = run;
    const has = (ch, pred) => calls.some(([c, a]) => c === ch && (!pred || pred(a)));
    check('lite: pages come from the full render for every previewed doc (client-get-pages 1, 3, 2)', has('client-get-pages', a => a[0] === 1) && has('client-get-pages', a => a[0] === 3) && has('client-get-pages', a => a[0] === 2));
    check('lite: the S2 channels are NEVER called (caps gated off by the handshake, not by a 404 round-trip)', !calls.some(([c]) => /^client-get-page$|^client-page-count$|^client-find$|^client-spreadsheet$/.test(c)));
    check('lite: the 1.5.0 outline and 1.6.0 page-info channels are never called either', !has('client-outline') && !has('client-page-info'));
  }
}

console.log('A3. functional — WORKFLOW (S4): approvals, the Send-or-stamp popup and the Mailbox in the pop-out');
{
  const run = runHarness(null, ['--workflow']);
  if (run) {
    const { calls } = run;
    const has = (ch, pred) => calls.some(([c, a]) => c === ch && (!pred || pred(a)));
    check('client-wf-list(inbox) + client-wf-recipients + client-wf-can-stamp + client-wf-stamp-types driven over the client bridge',
          has('client-wf-list', a => a[0] === 'inbox') && has('client-wf-recipients') && has('client-wf-can-stamp') && has('client-wf-stamp-types'));
    check('client-wf-stamp-list consulted for the previewed docs (stamped/original toggle)', has('client-wf-stamp-list'));
    check('1.4.0: the popup history read doc 1 (client-wf-doc-history 1) and the routed banner read doc 2 (client-wf-doc-routes 2)', has('client-wf-doc-history', a => a[0] === 1) && has('client-wf-doc-routes', a => a[0] === 2));
    { const idx = (pred) => calls.findIndex(pred), lastIdx = (pred) => { for (let i = calls.length - 1; i >= 0; i--) if (pred(calls[i])) return i; return -1; };
      check('1.4.0 (Oracle C2): the hidden doc 3 answered 404 on both per-doc reads and a LATER per-doc read (doc 1 history) still ran — the cap survived (the in-page check asserts it stayed true)',
            has('client-wf-doc-routes', a => a[0] === 3) && has('client-wf-doc-history', a => a[0] === 3)
            && lastIdx(([c, a]) => c === 'client-wf-doc-history' && a[0] === 1) > idx(([c, a]) => c === 'client-wf-doc-history' && a[0] === 3)); }
    check('1.4.0: the two-step cancel called client-wf-admin-cancel with the route id + CAS version', has('client-wf-admin-cancel', a => a[0] && a[0].id === 13 && a[0].version === 1));
    check('1.4.0: "View stamped copy" fetched the stamped pages by ROUTE id (client-wf-stamped 12)', has('client-wf-stamped', a => a[0] === 12));
  }
}

console.log('A5. functional — WORKFLOW as an EDIT user on a 1.4.0 core: hidden beats refused (no cancel, no new stamp, no purge; the admin channels never called) — Oracle C3');
{
  const run = runHarness(null, ['--workflow', '--role', 'edit']);
  if (run) {
    const { calls } = run;
    const has = (ch, pred) => calls.some(([c, a]) => c === ch && (!pred || pred(a)));
    check('edit: client-wf-admin-cancel and client-wf-stamp-type-create are NEVER called', !has('client-wf-admin-cancel') && !has('client-wf-stamp-type-create'));
    check('edit: the per-doc reads still run (routes for doc 2, history for doc 1) — read caps are admin/edit', has('client-wf-doc-routes', a => a[0] === 2) && has('client-wf-doc-history', a => a[0] === 1));
    check('edit: no purge / empty-bin channel called (admin-only controls hidden, not refused)', !has('client-recycle-purge') && !has('client-recycle-purge-all'));
  }
}

console.log('A4. functional — WORKFLOW against a 1.3.0 core: the 1.4.0 bits hide (caps off by the handshake, no 404 round-trips)');
{
  const run = runHarness('1.3.0', ['--workflow']);
  if (run) {
    const { calls } = run;
    check('1.3.0 core: the 1.4.0 channels are NEVER called (doc-routes / doc-history / admin-cancel / stamp-type-create)',
          !calls.some(([c]) => /^client-wf-doc-routes$|^client-wf-doc-history$|^client-wf-admin-cancel$|^client-wf-stamp-type-create$/.test(c)));
    check('1.3.0 core: the S2 reads still run (the two gates are independent)', calls.some(([c]) => c === 'client-get-page'));
    check('1.3.0 core: the 1.5.0 outline and 1.6.0 page-info channels are never called (hidden by the handshake)', !calls.some(([c]) => c === 'client-outline') && !calls.some(([c]) => c === 'client-page-info'));
  }
}

console.log('A7. functional — the read-ahead RACE on the client (Oracle 2026-09-14 C1): a late batch from a previous selection never frees the latch');
{
  const run = runHarness(null, ['--race']);
  if (run) {
    const { rec } = run;
    check('the race scenario ran in the pop-out (its checks are in the in-page list above)', rec.checks.some(c => /^race \(Oracle C1\)/.test(c.name) && c.ok));
  }
}

console.log('A6. functional — against a 1.5.0 core: the Contents panel through its own outline read, pages through the per-page reads (no page-info)');
{
  const run = runHarness('1.5.0');
  if (run) {
    const { calls } = run;
    const has = (ch, pred) => calls.some(([c, a]) => c === ch && (!pred || pred(a)));
    check('1.5.0 core: page-info is never asked; the S2 per-page read serves page 1 with fmt=auto', !has('client-page-info') && has('client-get-page', a => a[0] === 1 && a[1] === 0 && a[2] === 3 && a[3] === 'auto'));
    check('1.5.0 core: the Contents panel came from the 1.5.0 outline read (client-outline 1)', has('client-outline', a => a[0] === 1));
    check('1.5.0 core: the unknown count is probed the old way (client-page-count for 3)', has('client-page-count', a => a[0] === 3));
  }
}

console.log('B. source — the Oracle S1 conditions');
{
  const html = read('client', 'renderer', 'search', 'index.html');
  const csp = (html.match(/Content-Security-Policy"\s*content="([^"]+)"/) || [])[1] || '';
  check("pop-out CSP has style-src 'self' (the main page's lacks it → shared stylesheets would be blocked)", /style-src[^;]*'self'/.test(csp));
  check("pop-out CSP: font-src 'self' (theme fonts) + img-src 'self' data: (pages + pattern tiles) + script-src 'self' + no unsafe script", /font-src 'self'/.test(csp) && /img-src 'self' data:/.test(csp) && /script-src 'self'/.test(csp) && !/unsafe-eval/.test(csp));
  check('pop-out loads the REAL shared theme.css + searchUI.css + searchComponents.css', /href="\.\.\/shared\/theme\.css"/.test(html) && /search-ui\/searchUI\.css/.test(html) && /search-ui\/searchComponents\.css/.test(html));
  const tag = (f) => html.indexOf(`<script src="${f}"></script>`);   // the SCRIPT TAG (comments also name these files)
  check('pop-out mounts the shared markup (searchMarkup.js) after the adapter and before the modules',
        tag('clientTransport.js') > 0 && tag('clientTransport.js') < tag('../shared/search-ui/searchMarkup.js') && tag('../shared/search-ui/searchMarkup.js') < tag('../shared/search-ui/searchState.js'));

  const adapter = read('client', 'renderer', 'search', 'clientTransport.js');
  check('client adapter reaches IO only through window.scanfinder (no core bridge, no Node)', !/window\.docusnap/.test(adapter) && !/\bipcRenderer\b/.test(adapter) && !/\brequire\(/.test(adapter) && /window\.scanfinder/.test(adapter));
  check('client adapter sets window.SearchTransport with caps', /window\.SearchTransport = T/.test(adapter) && /caps:\s*\{/.test(adapter));
  check('client adapter: initial caps — S2 reads OFF until the handshake gate flips them; sendBack/restoreAll/localFile/review/print/settings false (no /v1 backing); bin + stamps true',
        /singlePage: false, pageCount: false, find: false, spreadsheet: false/.test(adapter) && /bin: true, restoreAll: false, sendBack: false/.test(adapter) && /localFile: false, review: false, print: false/.test(adapter) && /stamps: true/.test(adapter) && /settings: false/.test(adapter));
  check('client adapter (S2): the four reads are wired cap-gated (404 → cap off) and S2_METHODS_PRESENT is true',
        /S2_METHODS_PRESENT = true/.test(adapter) && /getDocumentPage:\s+capGated\('singlePage'/.test(adapter) && /getDocumentPageCount: capGated\('pageCount'/.test(adapter) && /getSpreadsheetGrid:\s+capGated\('spreadsheet'/.test(adapter) && /api\.find\(id, q\)/.test(adapter));
  check('client adapter (S2): a find timeout/error (status 0) is the client\'s OWN outcome — returned as kind, never a lost connection',
        /if \(r && r\.status === 0\) return \{ kind: \(r\.json && r\.json\.kind\) \|\| 'error', pages: 0, matches: \[\] \};/.test(adapter));
  const mainJs = read('client', 'main.js');
  check("main (S2): client-find is NOT guarded() — a timeout returns a kind:'timeout' envelope instead of tripping the connection overlay",
        /ipcMain\.handle\('client-find', async \(_e, id, query\) => \{\s*try \{ const r = await client\.find\(id, query\); markConnection\(true\); return r; \}/.test(mainJs) && /kind: timedOut \? 'timeout' : 'error'/.test(mainJs) && !/ipcMain\.handle\('client-find',\s*guarded/.test(mainJs));
  const apiC = read('client', 'apiClient.js');
  check('apiClient: CLIENT_CONTRACT 1.10.0 in lockstep (1.10.0: + nearMatch on the review-confirm 400; 1.9.0: + filed_by on the detail DTO); find carries a LONG idle timeout', /CLIENT_CONTRACT = '1\.10\.0'/.test(apiC) && /\/find\?\$\{q\}`, \{ withAuth: true, timeoutMs: 180000 \}/.test(apiC));
  check('apiClient (1.6.0): getPageInfo reads /documents/:id/page-info with page / also / scale / fmt and a longer idle timeout',
        /\/v1\/documents\/\$\{encodeURIComponent\(id\)\}\/page-info\?\$\{q\}`, \{ withAuth: true, timeoutMs: 90000 \}/.test(apiC) && /if \(extra\.length\) q\.set\('also', extra\.join\(','\)\);/.test(apiC) && /getOutline, getPageInfo,/.test(apiC));
  check('apiClient (1.5.0): getPage forwards fmt=auto|jpeg only; getOutline reads /documents/:id/outline',
        /if \(fmt === 'auto' \|\| fmt === 'jpeg'\) q\.set\('fmt', fmt\);/.test(apiC) && /\/v1\/documents\/\$\{encodeURIComponent\(id\)\}\/outline`/.test(apiC) && /getSpreadsheet, getOutline,/.test(apiC));
  check('apiClient (1.4.0): the four workflow routes — documents/:id/routes + /history, routes/:id/cancel, POST stamp-types',
        /\/v1\/workflow\/documents\/\$\{documentId\}\/routes`/.test(apiC) && /\/v1\/workflow\/documents\/\$\{documentId\}\/history`/.test(apiC)
        && /\/v1\/workflow\/routes\/\$\{id\}\/cancel`, \{ withAuth: true, body: \{ version, reason \} \}/.test(apiC) && /request\('POST', '\/v1\/workflow\/stamp-types'/.test(apiC)
        && /docRoutes: wfDocRoutes, docHistory: wfDocHistory, adminCancel: wfAdminCancel, stampTypeCreate/.test(apiC));
  const srvH = read('src', 'modules', 'api', 'handler.js');
  check('server: API_CONTRACT_VERSION 1.10.0 (lockstep with the client)', /API_CONTRACT_VERSION = '1\.10\.0'/.test(srvH));
  check('server (1.6.0): the page-info route sits behind the same gates as /page and caps `also` at PAGE_INFO_ALSO_MAX_V1 (bounded work per request)',
        /documents\/\(\\\\d\+\)\/page-info\$/.test(srvH) && /infoMatch\) \{\s*\n\s*const session = requireSession\(req, res\); if \(!session\) return;\s*\n\s*const id = Number\(infoMatch\[1\]\);\s*\n\s*if \(!_gateDoc\(session, id\)\) return;/.test(srvH)
        && /const PAGE_INFO_ALSO_MAX_V1 = 4;/.test(srvH) && /\.slice\(0, PAGE_INFO_ALSO_MAX_V1\)/.test(srvH));
  check('server (1.5.0): the outline route sits behind the same gates as /page (requireSession → _gateDoc → server-side resolution) and the page read takes fmt=auto|jpeg only',
        /documents\/\(\\\\d\+\)\/outline\$/.test(srvH) && /outlineMatch\) \{\s*\n\s*const session = requireSession\(req, res\); if \(!session\) return;\s*\n\s*const id = Number\(outlineMatch\[1\]\);\s*\n\s*if \(!_gateDoc\(session, id\)\) return;/.test(srvH)
        && /const format = \(fmtRaw === 'auto' \|\| fmtRaw === 'jpeg'\) \? fmtRaw : undefined;/.test(srvH));
  check('server (1.4.0): the four routes mirror their desktop twins — writer-gated reads through _canAccess, admin-only cancel + stamp-type create',
        /workflow\/documents\/\(\\\\d\+\)\/routes\$/.test(srvH) && /workflow\/documents\/\(\\\\d\+\)\/history\$/.test(srvH)
        && /workflow\/routes\/\(\\\\d\+\)\/cancel\$/.test(srvH) && /req\.method === 'POST' && pathname === `\$\{API_PREFIX\}\/workflow\/stamp-types`/.test(srvH)
        && (srvH.match(/if \(!isWriter\(session\)\) return sendJson\(res, 403, \{ error: 'forbidden' \}\);\s*\n\s*const db = getDb\(\), docId = Number\(wfDoc(Routes|History)\[1\]\);\s*\n\s*if \(!_canAccess\(db, session, docId\)\) return sendJson\(res, 404/g) || []).length === 2
        && /if \(session\.role !== 'admin'\) return sendJson\(res, 403, \{ error: 'forbidden' \}\);\s*\n\s*let body;[\s\S]{0,400}workflow\.adminCancelRoute\(/.test(srvH)
        && /if \(session\.role !== 'admin'\) return sendJson\(res, 403, \{ error: 'forbidden' \}\);\s*\n\s*let body;[\s\S]{0,300}stampsDb\.createStampType\(/.test(srvH));
  const sharedPv = read('src', 'windows', 'shared', 'search-ui', 'searchPreview.js');
  check("shared UI: a find 'timeout' kind reads \"took too long\" (never a silent 0 / 0)", /res\.kind === 'timeout'/.test(sharedPv) && /took too long/.test(sharedPv));
  check('client adapter: a 401 reports the expired session to main', /r\.status === 401\) \{ expired\(\);/.test(adapter) && /api\.popoutSessionExpired\(\)/.test(adapter));
  check('client adapter: a non-200 REJECTS (mirrors the core bridge) and a 404/426/402 on a cap-gated read flips the cap', /r\.status !== 200\) throw new Error/.test(adapter) && /r\.status === 404 \|\| r\.status === 426 \|\| r\.status === 402\)\) \{ T\.caps\[name\] = false;/.test(adapter));
  check('client adapter: capability gate needs BOTH client methods AND server ≥ 1.3.0', /const on = clientHasS2 && serverHasS2;/.test(adapter) && /atLeast\(sv, '1\.3\.0'\)/.test(adapter));
  check('client adapter: the role comes from client-current-user (null → read-only)', /authGetCurrentUser:\s+async \(\) => \(await api\.currentUser\(\)\) \|\| null/.test(adapter));

  // Collision twin: the pop-out is ONE global scope too (the `_btn` incident class).
  const dir = path.join(ROOT, 'client', 'renderer', 'search');
  const scripts = [...html.matchAll(/<script src="([^"]+\.js)"><\/script>/g)].map(m => m[1]);
  const decls = {};
  for (const f of scripts) {
    let src = ''; try { src = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
    for (const m of src.matchAll(/^(?:(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=)/gm)) { const n = m[1] || m[2]; (decls[n] || (decls[n] = [])).push(f); }
  }
  const dupes = Object.entries(decls).filter(([, fs2]) => new Set(fs2).size > 1);
  check(`pop-out: no top-level name declared in more than one script (${scripts.length} scripts scanned)` + (dupes.length ? ` — DUPES: ${dupes.map(([n, fs2]) => `${n} (${[...new Set(fs2)].join(' + ')})`).join('; ')}` : ''), scripts.length >= 14 && dupes.length === 0);
  check('pop-out (S4): loads the shared workflow / mailbox / stamp modules', /search-ui\/searchWorkflow\.js/.test(html) && /search-ui\/searchMailbox\.js/.test(html) && /search-ui\/searchStamp\.js/.test(html));
  check('client adapter (S4 + 1.4.0): stamps cap true; history / doc-routes / admin-cancel / stamp-create start OFF (the handshake flips them), the stamped viewer is always on',
        /stamps: true/.test(adapter) && /workflowHistory: false, docRoutes: false, adminCancel: false, stampCreate: false, stampedViewer: true/.test(adapter));
  check('client adapter (1.4.0): the four caps need BOTH sides ≥ 1.4.0 AND the role (reads admin/edit, cancel + new stamp admin) — role from SearchState, never a second IPC',
        /const serverHas14 = atLeast\(sv, '1\.4\.0'\);/.test(adapter) && /const clientHas14 = atLeast\(cc, '1\.4\.0'\);/.test(adapter)
        && /const role = \(window\.SearchState && window\.SearchState\.role\) \|\| null;/.test(adapter)
        && /T\.caps\.docRoutes = on14 && writer; T\.caps\.workflowHistory = on14 && writer;/.test(adapter) && /T\.caps\.adminCancel = on14 && admin; T\.caps\.stampCreate = on14 && admin;/.test(adapter)
        && /serverBehind = \(clientHasS2 && !serverHasS2\) \|\| \(clientHas14 && !serverHas14\) \|\| \(clientHas15 && !serverHas15\) \|\| \(clientHas16 && !serverHas16\)/.test(adapter));
  check('client adapter (1.6.0): the pageInfo cap needs both sides ≥ 1.6.0; page-info is a docRead (404 = hidden doc → null, cap kept — the viewer falls back to the per-page reads)',
        /T\.caps\.pageInfo = serverHas16 && clientHas16;/.test(adapter) && /getDocumentPageInfo:\s+docRead\('pageInfo', null, \(id, page, also, scale, fmt\) => api\.getPageInfo\(id, page, also, scale, fmt\)/.test(adapter) && /pageInfo: false,/.test(adapter));
  check('client adapter (1.5.0): the Contents cap needs both sides ≥ 1.5.0; the outline is a docRead (404 = hidden doc, cap kept); the page read forwards fmt',
        /T\.caps\.outline = serverHas15 && clientHas15;/.test(adapter) && /getDocumentOutline:\s+docRead\('outline', \[\], \(id\) => api\.getOutline\(id\)/.test(adapter)
        && /getDocumentPage:\s+capGated\('singlePage', null, \(id, index, scale, fmt\) => api\.getPage\(id, index, scale, fmt\)/.test(adapter) && /outline: false,/.test(adapter));
  check('client adapter (1.4.0): doc-routes / history are docRead reads (a 404 = a hidden doc → empty shape, cap KEPT; only 426/402 flip — Oracle C2), cancel unwraps {route}, new stamp unwraps {id,key}',
        /docRoutes:\s+docRead\('docRoutes', \[\], \(id\) => api\.workflow\.docRoutes\(id\), \(j\) => j\.routes \|\| \[\]\)/.test(adapter)
        && /docHistory:\s+docRead\('workflowHistory', \[\], \(id\) => api\.workflow\.docHistory\(id\), \(j\) => j\.history \|\| \[\]\)/.test(adapter)
        && /function docRead\(name, empty, call, pick\) \{\s*\n\s*return async \(\.\.\.a\) => \{\s*\n\s*const r = await call\(\.\.\.a\);\s*\n\s*if \(r && r\.status === 404\) return empty;\s*\n\s*if \(r && \(r\.status === 426 \|\| r\.status === 402\)\) \{ T\.caps\[name\] = false; return empty; \}/.test(adapter)
        && /adminCancel:\s+async \(id, version, reason\) => unwrap\(await api\.workflow\.adminCancel\(id, version, reason\)/.test(adapter)
        && /typeCreate:\s+async \(p\) => unwrap\(await api\.workflow\.stampTypeCreate\(\{ label: p && p\.label, color: p && p\.color \}\)/.test(adapter));
  check('client adapter (1.4.0): "View stamped copy" = an in-window overlay over the stamped-pages read (never a path, never a shell open)',
        /async function stampedOverlay\(routeId\)/.test(adapter) && /api\.workflow\.stamped\(routeId\)/.test(adapter) && /openStampedViewer: \(routeId\) => \{ stampedOverlay\(routeId\); \}/.test(adapter)
        && !/shell\.|openExternal|openPath/.test(adapter) && /#stamped-overlay \.stamped-pages img/.test(html));
  check('client adapter (S4): the workflow boxes unwrap {routes}, recipients {recipients}, stamp list {stamps}, types {stampTypes}',
        /api\.workflow\.list\('inbox'\), \(j\) => j\.routes/.test(adapter) && /\(j\) => j\.recipients/.test(adapter) && /\(j\) => j\.stamps/.test(adapter) && /\(j\) => j\.stampTypes/.test(adapter));
  check('client adapter (S4): assign carries resubmitOf (the "Send again" lineage) end to end', /assign:\s+async \(documentId, toUserId, actionRequired, comment, resubmitOf\)/.test(adapter) && /resubmitOf \}\) =>\s*client\.workflow\.assign\(documentId, toUserId, actionRequired, comment, resubmitOf\)/.test(read('client', 'main.js')) && /assign:\s+\(documentId, toUserId, actionRequired, comment, resubmitOf\)/.test(read('client', 'preload.js')));
  check('client adapter: a read-only user\'s 403 on /v1/doc-types yields an empty type list, not a failed boot', /if \(r && r\.status === 403\) return \[\];/.test(adapter));

  const main = read('client', 'main.js');
  check('main: a single pop-out (module ref; focus if alive, null on closed)', /let searchWin = null;/.test(main) && /if \(searchWin && !searchWin\.isDestroyed\(\)\)/.test(main) && /w\.on\('closed', \(\) => \{[^\n]*if \(searchWin === w\) searchWin = null; \}\)/.test(main));
  check('main: the pop-out is revealed on ready-to-show AND by a fallback timer (a renderer that never paints must not leave a window that "doesn\'t open")',
        /w\.once\('ready-to-show', \(\) => reveal\('ready-to-show'\)\)/.test(main) && /setTimeout\(\(\) => reveal\('fallback-timer'\), 2500\)/.test(main) && /if \(shown \|\| w\.isDestroyed\(\)\) return;/.test(main));
  check('main: the pop-out loads from INSIDE the navGuard root (client/renderer/search/index.html) with the SAME webPreferences posture', /path\.join\(__dirname, 'renderer', 'search', 'index\.html'\)/.test(main) && /contextIsolation: true,\s*nodeIntegration: false,\s*sandbox: true,\s*\},\s*\}\);\s*searchWin = w;/.test(main));
  check('main: logout closes the pop-out', /ipcMain\.handle\('client-logout',[\s\S]{0,200}closeSearchWindow\('logout'\);/.test(main));
  check('main: main-window close closes the pop-out', /win\.on\('closed', \(\) => \{ win = null; closeSearchWindow\('main-window-closed'\);/.test(main));
  check('main: connection lost/restored broadcast to EVERY window', /for \(const w of BrowserWindow\.getAllWindows\(\)\)[\s\S]{0,200}client-connection-restored' : 'client-connection-lost'/.test(main));
  check('main: client-current-user serves role/name from the login response, null when signed out, never a token', /currentUser = \{ role: u\.role \|\| null, username: u\.username \|\| null, displayName/.test(main) && /ipcMain\.handle\('client-current-user', \(\) => \(client && client\.isAuthenticated\(\)\) \? currentUser : null\)/.test(main) && !/currentUser = \{[^}]*token/.test(main));
  check('main: the pop-out 401 report is sender-scoped and signs the main window out', /ipcMain\.on\('client-popout-session-expired', \(e\) => \{/.test(main) && /e\.sender === searchWin\.webContents/.test(main) && /win\.webContents\.send\('client-session-expired'\)/.test(main));
  check('main: client-open-search refuses when not signed in (logged); bounds persisted', /if \(!client \|\| !client\.isAuthenticated\(\)\) \{[\s\S]{0,300}return \{ ok: false, error: 'not signed in' \};/.test(main) && /search-window-state\.json/.test(main) && /w\.on\('close', \(\) => saveSearchState\(w\)\)/.test(main));
  check('main: show:false + ready-to-show (no blank flash)', /show: false, backgroundColor/.test(main) && /w\.once\('ready-to-show'/.test(main));
  // A remembered position on a screen that is gone would create the pop-out OFF-SCREEN ("doesn't open" — owner 2026-09-14,
  // the stale-session story was unconfirmed). The saved bounds go through windowBounds.sanitizeBounds against the live displays.
  check('main: the remembered pop-out position is sanitised against the connected displays before the window is created',
        /const \{ sanitizeBounds \} = require\('\.\/windowBounds'\);/.test(main) && /displays = screen\.getAllDisplays\(\);/.test(main)
        && /const b = sanitizeBounds\(st, displays\);/.test(main) && /width: b\.width, height: b\.height, minWidth: 900, minHeight: 560,\s*\n\s*x: b\.x, y: b\.y,/.test(main));
  {
    const { sanitizeBounds, MIN_VISIBLE } = require(path.join(ROOT, 'client', 'windowBounds.js'));
    const one = [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }];
    const two = [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }, { workArea: { x: 1920, y: 0, width: 2560, height: 1400 } }];
    const a = sanitizeBounds({ x: 100, y: 80, width: 1280, height: 820 }, one);
    check('windowBounds: a position on a connected screen is kept', a.x === 100 && a.y === 80 && a.width === 1280 && a.height === 820);
    const b2 = sanitizeBounds({ x: 2200, y: 120, width: 1280, height: 820 }, two);
    check('windowBounds: a position on the SECOND screen is kept while that screen exists', b2.x === 2200 && b2.y === 120);
    const c = sanitizeBounds({ x: 2200, y: 120, width: 1280, height: 820 }, one);
    check('windowBounds: the same position with the second screen GONE drops x/y (Electron centres it) and keeps the size', c.x === undefined && c.y === undefined && c.width === 1280 && c.height === 820);
    const d = sanitizeBounds({ x: -1200, y: -700, width: 1280, height: 820 }, one);
    check(`windowBounds: a window dragged almost entirely off the desktop (< ${MIN_VISIBLE}px visible) is re-centred`, d.x === undefined && d.y === undefined);
    const e = sanitizeBounds({ x: 1850, y: 980, width: 1280, height: 820 }, one);
    check('windowBounds: a sliver on-screen (< MIN_VISIBLE) counts as off-screen', e.x === undefined);
    const f = sanitizeBounds({ x: 10, y: 10, width: 5000, height: 4000 }, one);
    check('windowBounds: a size larger than any screen is clamped to the largest work area', f.width === 1920 && f.height === 1040 && f.x === 10);
    const g = sanitizeBounds(null, one), h = sanitizeBounds({ x: 50, y: 50, width: 1280, height: 820 }, []);
    check('windowBounds: no saved state → defaults, no position; no displays known → position dropped, size kept', g.width === 1280 && g.x === undefined && h.x === undefined && h.width === 1280);
  }

  const pre = read('client', 'preload.js');
  for (const m of ['openSearch', 'searchTarget', 'currentUser', 'serverInfo', 'onSearchSetQuery', 'onSearchGotoDoc', 'popoutSessionExpired', 'onSessionExpired'])
    check(`preload exposes ${m}`, new RegExp('^\\s+' + m + ':', 'm').test(pre));
  for (const m of ['docRoutes', 'docHistory', 'adminCancel', 'stampTypeCreate'])
    check(`preload (1.4.0) exposes workflow.${m}`, new RegExp('^\\s+' + m + ':\\s+\\(.*\\) => ipcRenderer\\.invoke\\(\'client-wf-', 'm').test(pre));
  check('main (1.4.0): the four workflow IPCs are guarded pass-throughs', ['client-wf-doc-routes', 'client-wf-doc-history', 'client-wf-admin-cancel', 'client-wf-stamp-type-create']
        .every(ch => new RegExp("ipcMain\\.handle\\('" + ch + "',\\s+guarded\\(").test(main)));

  const rend = read('client', 'renderer', 'renderer.js');
  check('renderer: the Search nav opens the pop-out (not the in-pane view)', /\$\('nav-search'\)\.addEventListener\('click', \(\) => openSearchWindow\(\)\)/.test(rend) && !/\$\('nav-search'\)\.addEventListener\('click', \(\) => setView\('search'\)\)/.test(rend));
  check('renderer: Home search + recent rows go to the pop-out (query / docId deep-links)', /openSearchWindow\(\{ query: \$\('home-search-input'\)\.value\.trim\(\) \}\)/.test(rend) && /openSearchWindow\(\{ docId: d\.id \}\)/.test(rend));
  check('renderer: the in-pane view is the mailbox viewer only (legacy-viewer class, no search priming)', /classList\.toggle\('legacy-viewer', view === 'search'\)/.test(rend) && !/if \(view === 'search' && !searchPrimed\)/.test(rend));
  check('renderer: a session-expired push from main signs out AND always tells the user why', /api\.onSessionExpired\?\.\(\(\) => \{ if \(role\) doLogout\(\); toast\('Your session ended/.test(rend));
  check('renderer: theme applier delegated to the shared themeBoot', /window\.ClientTheme\.apply\(name\)/.test(rend) && /const THEMES = window\.ClientTheme\.THEMES;/.test(rend));
  const mainHtml = read('client', 'renderer', 'index.html');
  check('main page loads themeBoot.js before renderer.js + hides the legacy search bar in viewer mode', mainHtml.indexOf('themeBoot.js') > 0 && mainHtml.indexOf('themeBoot.js') < mainHtml.indexOf('src="renderer.js"') && /#view-search\.legacy-viewer \.searchbar/.test(mainHtml));

  const S = require(path.join(__dirname, 'sync-client-search.js'));
  const names = S.SETS.map(s => s.name);
  check('sync set covers search-ui + theme + fonts + patterns', ['search-ui', 'theme', 'fonts', 'patterns'].every(n => names.includes(n)));
  const d = S.diff();
  check('every mirrored copy is current (incl. theme.css, fonts, patterns)', d.stale.length === 0 && d.missing.length === 0 && d.extra.length === 0);
  const themeBoot = read('client', 'renderer', 'themeBoot.js');
  check('themeBoot applies from localStorage synchronously + re-applies on the storage event (cross-window sync)', /applyAttrs\(current\(\)\);/.test(themeBoot) && /addEventListener\('storage'/.test(themeBoot));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
