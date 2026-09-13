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
function runHarness(serverContract) {
  const exe = path.join(ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
  if (!fs.existsSync(exe)) { check('node_modules/electron present', false); return null; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-popout-fn-'));
  const report = path.join(tmp, 'report.json'), dump = path.join(tmp, 'dom.json');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const args = [path.join(ROOT, 'scripts', 'search-window-harness.js'), '--client', '--report', report, '--dump', dump];
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
    check('client-get-page (1, 0, 3) — the lazy page-1 read over /v1', has('client-get-page', a => a[0] === 1 && a[1] === 0 && a[2] === 3));
    check('client-get-page (1, 1, 3) — the hole rendered on page-next', has('client-get-page', a => a[0] === 1 && a[1] === 1 && a[2] === 3));
    check('a KNOWN page_count is never probed; the UNKNOWN one is (client-page-count for 3 only)', !has('client-page-count', a => a[0] === 1) && has('client-page-count', a => a[0] === 3));
    check('client-find (1, "inv") — the list-term highlight over /v1', has('client-find', a => a[0] === 1 && a[1] === 'inv'));
    check('client-spreadsheet (2) — the xlsx grid over /v1', has('client-spreadsheet', a => a[0] === 2));
    check('client-get-pages only as the non-PDF full render (id 2)', has('client-get-pages', a => a[0] === 2) && !has('client-get-pages', a => a[0] === 1));
    check('no core-only channels ever called', !calls.some(([c]) => /^get-document-page$|^get-document-page-count$|^find-in-document$|^get-spreadsheet-grid$/.test(c)));
    check('client-current-user read once for the role', calls.filter(([c]) => c === 'client-current-user').length === 1);
    check('client-search-target pulled once (the deep-link)', calls.filter(([c]) => c === 'client-search-target').length === 1);
    check('client-server-info read for the capability gate', has('client-server-info'));
    check('client-get-thumbnail used for the row thumbnails', has('client-get-thumbnail'));
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
  check('client adapter: initial caps — S2 reads OFF until the handshake gate flips them; sendBack/restoreAll/localFile/review/print/stamps/settings false (no /v1 backing); bin true',
        /singlePage: false, pageCount: false, find: false, spreadsheet: false/.test(adapter) && /bin: true, restoreAll: false, sendBack: false/.test(adapter) && /localFile: false, review: false, print: false/.test(adapter) && /stamps: false/.test(adapter) && /settings: false/.test(adapter));
  check('client adapter (S2): the four reads are wired cap-gated (404 → cap off) and S2_METHODS_PRESENT is true',
        /S2_METHODS_PRESENT = true/.test(adapter) && /getDocumentPage:\s+capGated\('singlePage'/.test(adapter) && /getDocumentPageCount: capGated\('pageCount'/.test(adapter) && /getSpreadsheetGrid:\s+capGated\('spreadsheet'/.test(adapter) && /api\.find\(id, q\)/.test(adapter));
  check('client adapter (S2): a find timeout/error (status 0) is the client\'s OWN outcome — returned as kind, never a lost connection',
        /if \(r && r\.status === 0\) return \{ kind: \(r\.json && r\.json\.kind\) \|\| 'error', pages: 0, matches: \[\] \};/.test(adapter));
  const mainJs = read('client', 'main.js');
  check("main (S2): client-find is NOT guarded() — a timeout returns a kind:'timeout' envelope instead of tripping the connection overlay",
        /ipcMain\.handle\('client-find', async \(_e, id, query\) => \{\s*try \{ const r = await client\.find\(id, query\); markConnection\(true\); return r; \}/.test(mainJs) && /kind: timedOut \? 'timeout' : 'error'/.test(mainJs) && !/ipcMain\.handle\('client-find',\s*guarded/.test(mainJs));
  const apiC = read('client', 'apiClient.js');
  check('apiClient (S2): CLIENT_CONTRACT 1.3.0 in lockstep; find carries a LONG idle timeout', /CLIENT_CONTRACT = '1\.3\.0'/.test(apiC) && /\/find\?\$\{q\}`, \{ withAuth: true, timeoutMs: 180000 \}/.test(apiC));
  const srvH = read('src', 'modules', 'api', 'handler.js');
  check('server: API_CONTRACT_VERSION 1.3.0 (lockstep with the client)', /API_CONTRACT_VERSION = '1\.3\.0'/.test(srvH));
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
  check(`pop-out: no top-level name declared in more than one script (${scripts.length} scripts scanned)` + (dupes.length ? ` — DUPES: ${dupes.map(([n, fs2]) => `${n} (${[...new Set(fs2)].join(' + ')})`).join('; ')}` : ''), scripts.length >= 11 && dupes.length === 0);

  const main = read('client', 'main.js');
  check('main: a single pop-out (module ref; focus if alive, null on closed)', /let searchWin = null;/.test(main) && /if \(searchWin && !searchWin\.isDestroyed\(\)\)/.test(main) && /w\.on\('closed', \(\) => \{ if \(searchWin === w\) searchWin = null; \}\)/.test(main));
  check('main: the pop-out loads from INSIDE the navGuard root (client/renderer/search/index.html) with the SAME webPreferences posture', /path\.join\(__dirname, 'renderer', 'search', 'index\.html'\)/.test(main) && /contextIsolation: true,\s*nodeIntegration: false,\s*sandbox: true,\s*\},\s*\}\);\s*searchWin = w;/.test(main));
  check('main: logout closes the pop-out', /ipcMain\.handle\('client-logout',[\s\S]{0,200}closeSearchWindow\(\);/.test(main));
  check('main: main-window close closes the pop-out', /win\.on\('closed', \(\) => \{ win = null; closeSearchWindow\(\); \}\)/.test(main));
  check('main: connection lost/restored broadcast to EVERY window', /for \(const w of BrowserWindow\.getAllWindows\(\)\)[\s\S]{0,200}client-connection-restored' : 'client-connection-lost'/.test(main));
  check('main: client-current-user serves role/name from the login response, null when signed out, never a token', /currentUser = \{ role: u\.role \|\| null, username: u\.username \|\| null, displayName/.test(main) && /ipcMain\.handle\('client-current-user', \(\) => \(client && client\.isAuthenticated\(\)\) \? currentUser : null\)/.test(main) && !/currentUser = \{[^}]*token/.test(main));
  check('main: the pop-out 401 report is sender-scoped and signs the main window out', /ipcMain\.on\('client-popout-session-expired', \(e\) => \{\s*if \(!searchWin \|\| e\.sender !== searchWin\.webContents\) return;/.test(main) && /win\.webContents\.send\('client-session-expired'\)/.test(main));
  check('main: client-open-search refuses when not signed in; bounds persisted', /if \(!client \|\| !client\.isAuthenticated\(\)\) return \{ ok: false, error: 'not signed in' \};/.test(main) && /search-window-state\.json/.test(main) && /w\.on\('close', \(\) => saveSearchState\(w\)\)/.test(main));
  check('main: show:false + ready-to-show (no blank flash)', /show: false, backgroundColor/.test(main) && /w\.once\('ready-to-show'/.test(main));

  const pre = read('client', 'preload.js');
  for (const m of ['openSearch', 'searchTarget', 'currentUser', 'serverInfo', 'onSearchSetQuery', 'onSearchGotoDoc', 'popoutSessionExpired', 'onSessionExpired'])
    check(`preload exposes ${m}`, new RegExp('^\\s+' + m + ':', 'm').test(pre));

  const rend = read('client', 'renderer', 'renderer.js');
  check('renderer: the Search nav opens the pop-out (not the in-pane view)', /\$\('nav-search'\)\.addEventListener\('click', \(\) => openSearchWindow\(\)\)/.test(rend) && !/\$\('nav-search'\)\.addEventListener\('click', \(\) => setView\('search'\)\)/.test(rend));
  check('renderer: Home search + recent rows go to the pop-out (query / docId deep-links)', /openSearchWindow\(\{ query: \$\('home-search-input'\)\.value\.trim\(\) \}\)/.test(rend) && /openSearchWindow\(\{ docId: d\.id \}\)/.test(rend));
  check('renderer: the in-pane view is the mailbox viewer only (legacy-viewer class, no search priming)', /classList\.toggle\('legacy-viewer', view === 'search'\)/.test(rend) && !/if \(view === 'search' && !searchPrimed\)/.test(rend));
  check('renderer: a session-expired push from main signs out', /api\.onSessionExpired\?\.\(\(\) => \{ if \(role\) \{ doLogout\(\);/.test(rend));
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
