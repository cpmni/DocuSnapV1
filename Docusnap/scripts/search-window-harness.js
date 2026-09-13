'use strict';
/**
 * scripts/search-window-harness.js — a REAL-RENDERER functional smoke of the core Search window
 * (client search parity 2026-09-13, S0 gate). Run with the project's Electron (NOT as node):
 *
 *   node_modules\electron\dist\electron.exe scripts\search-window-harness.js [--report out.json] [--dump dom.json] [--html <index.html>]
 *
 * WHY: `--smoke-windows` proves the page loads and its globals exist; the source pins prove the wiring
 * text. Neither proves the shared search-ui module + the coreTransport adapter + the real preload
 * (contextIsolation, sandbox, CSP `script-src 'self'`) actually DRIVE the page: a search populates rows,
 * a click previews (fields + page + lazy nav + find highlights + action buttons), the xlsx grid draws,
 * the recycle bin toggles. This harness opens the real index.html HIDDEN with the real src/preload.js
 * and answers every IPC channel the page needs with deterministic stub data — no DB, no Python, no login
 * — then drives it through executeJavaScript and reports pass/fail per check plus the IPC calls it saw
 * (so arity/shape drift at the adapter seam is caught too). It never touches the live userData.
 *
 * `--dump` writes #app.outerHTML + the computed layout of the load-bearing containers after load — the
 * baseline/compare artefact for the S0b markup-extraction DOM-equivalence gate (Oracle 2026-09-13).
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const argOf = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const REPORT = argOf('--report');
const DUMP = argOf('--dump');
// --client: drive the detached CLIENT's search pop-out instead (client/renderer/search/index.html with the
// client's preload + its IPC channel names and { status, json } envelopes). Same shared UI, different transport.
const CLIENT = argv.includes('--client');
// --server-contract X.Y.Z: what the stubbed core advertises (client mode). Default = this client's own contract
// (parity: every S2 read available). An older value (e.g. 1.2.0) = LITE — the S2 caps stay off, the controls
// hide and the "newer core needed" hint shows.
const CLIENT_CONTRACT = CLIENT ? require(path.join(ROOT, 'client', 'apiClient.js')).CLIENT_CONTRACT : null;
const SERVER_CONTRACT = argOf('--server-contract') || CLIENT_CONTRACT || '1.3.0';
const atLeast = (v, want) => { const a = String(v).split('.').map(Number), b = String(want).split('.').map(Number); return a[0] > b[0] || (a[0] === b[0] && a[1] >= b[1]); };
const LITE = CLIENT && !atLeast(SERVER_CONTRACT, '1.3.0');
const HTML = argOf('--html') || (CLIENT ? path.join(ROOT, 'client', 'renderer', 'search', 'index.html')
                                        : path.join(ROOT, 'src', 'windows', 'search', 'index.html'));
const PRELOAD = CLIENT ? path.join(ROOT, 'client', 'preload.js') : path.join(ROOT, 'src', 'preload.js');

// Throwaway userData BEFORE ready (never the live one; also a different single-instance key).
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-search-harness-'));
app.setPath('userData', tmpUserData);

// ── Stub world ─────────────────────────────────────────────────────────────────
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const ROWS = {
  confirmed: [
    { id: 1, supplier_name: 'Acme Ltd', type_name: 'Invoice', reference_number: 'INV-001', doc_date: '12-03-2026', status: 'confirmed', has_file: true, original_filename: 'Invoice.12-03-2026.INV-001.pdf', page_count: 3, overall_confidence: 97 },
    { id: 2, supplier_name: 'Bolt Supplies', type_name: 'Invoice', reference_number: 'INV-002', doc_date: '14-03-2026', status: 'confirmed', has_file: true, original_filename: 'sheet.xlsx', overall_confidence: 100 },
  ],
  uncommitted: [
    { id: 3, supplier_name: 'Cable Co', type_name: 'Purchase Order', reference_number: 'PO-7', doc_date: '', status: 'needs_review', has_file: true, original_filename: 'po.pdf', page_count: null, overall_confidence: 72 },
  ],
};
const DELETED = [{ id: 9, supplier_name: 'Old Co', type_name: 'Invoice', reference_number: 'X-1', doc_date: '01-01-2026', status: 'deleted', original_filename: 'old.pdf' }];
const byId = (id) => [...ROWS.confirmed, ...ROWS.uncommitted, ...DELETED].find(r => r.id === Number(id)) || null;

const calls = [];   // [channel, args]
function stub(channel, fn) { ipcMain.handle(channel, (_e, ...a) => { calls.push([channel, a]); return fn(...a); }); }
const DOC_TYPES = [{ slug: 'invoice', name: 'Invoice' }, { slug: 'purchase_order', name: 'Purchase Order' }];
const detailOf = (id) => { const r = byId(id); return r ? { ...r, extractions: [{ field_key: 'total_amount', display_value: '£120.00', confidence: 95, validation_note: null }] } : null; };
const pagesOf = (id) => { const r = byId(id); if (!r || !/\.pdf$/i.test(r.original_filename)) return []; return new Array(Number(id) === 3 ? 2 : (r.page_count || 1)).fill(PNG); };
if (CLIENT) {
  // The client bridge: every read returns a { status, json } envelope (what client/main.js hands back).
  const ok = (json) => ({ status: 200, json });
  stub('client-doc-types', () => ok({ types: DOC_TYPES }));
  stub('client-search', () => ok({ confirmed: ROWS.confirmed, uncommitted: ROWS.uncommitted }));
  stub('client-recycle-list', () => ok({ deleted: DELETED }));
  stub('client-get-document', (id) => { const d = detailOf(id); return d ? ok(d) : { status: 404, json: { error: 'not found' } }; });
  stub('client-get-pages', (id) => ok({ pages: pagesOf(id) }));
  stub('client-get-thumbnail', () => ok({ thumbnail: PNG }));
  stub('client-entitlement', () => ok({ entitled: true, workflow: { entitled: false } }));
  stub('client-current-user', () => ({ role: 'admin', username: 'harness', displayName: 'Harness' }));
  stub('client-search-target', () => ({ query: 'inv', docId: null }));
  stub('client-server-info', () => ({ serverVersion: SERVER_CONTRACT, clientContract: CLIENT_CONTRACT, mode: atLeast(SERVER_CONTRACT, '1.3.0') ? 'ok' : 'warn' }));
  // The S2 reads (contract 1.3.0). A LITE (older) core does not have them → 404 (the adapter flips the cap).
  const notFound = { status: 404, json: { error: 'not found' } };
  stub('client-get-page', (id, idx) => (LITE ? notFound : ok({ page: (byId(id) && /\.pdf$/i.test(byId(id).original_filename)) ? PNG : null })));
  stub('client-page-count', (id) => (LITE ? notFound : ok({ count: Number(id) === 3 ? 2 : ((byId(id) && byId(id).page_count) || null) })));
  stub('client-find', (id, q) => (LITE ? notFound : ok({ kind: 'pdf', pages: 3, matches: String(q).toLowerCase() === 'inv' ? [{ page: 0, x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.12 }] : [] })));
  stub('client-spreadsheet', (id) => (LITE ? notFound : ok({ grid: Number(id) === 2 ? { sheets: [{ name: 'Sheet1', rows: [['Item', 'Qty'], ['Bolt', '12']] }], truncated: false } : null })));
  stub('client-recycle-delete', () => ok({ ok: true }));
  stub('client-recycle-restore', () => ok({ ok: true }));
  stub('client-recycle-purge', () => ok({ ok: true }));
  stub('client-recycle-purge-all', () => ok({ ok: true }));
  stub('client-retry-connection', () => ({ ok: true }));
} else {
stub('get-all-doc-types', () => DOC_TYPES);
stub('search-documents', () => ({ confirmed: ROWS.confirmed, uncommitted: ROWS.uncommitted }));
stub('get-deleted-queue', () => DELETED);
stub('get-document-detail', (id) => { const r = byId(id); return r ? { ...r, extractions: [{ field_key: 'total_amount', display_value: '£120.00', confidence: 95, validation_note: null }] } : null; });
stub('get-document-page', (id, idx, scale) => { const r = byId(id); return (r && /\.pdf$/i.test(r.original_filename)) ? PNG : null; });
stub('get-document-page-count', (id) => (Number(id) === 3 ? 2 : (byId(id) && byId(id).page_count) || null));
stub('get-document-pages', (id) => { const r = byId(id); return (r && /\.pdf$/i.test(r.original_filename)) ? [PNG] : []; });
stub('find-in-document', (id, q) => ({ kind: 'text', pages: 3, matches: String(q).toLowerCase() === 'inv' ? [{ page: 0, x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.12 }] : [] }));
stub('get-spreadsheet-grid', (id) => (Number(id) === 2 ? { sheets: [{ name: 'Sheet1', rows: [['Item', 'Qty'], ['Bolt', '12']] }], truncated: false } : null));
stub('get-document-thumbnail', () => PNG);
stub('get-entitlement', () => ({ entitled: true, workflow: { entitled: false } }));
stub('auth-get-current-user', () => ({ id: 1, username: 'harness', role: 'admin' }));
stub('stamp-can', () => ({ canStamp: false }));
stub('stamp-list', () => []);
stub('print-available', () => true);
stub('get-setting', (key) => (key === 'keep_processed_originals' ? 'true' : null));
stub('get-search-target', () => 'inv');
stub('get-search-view-target', () => null);
}

// ── The drive (runs INSIDE the page) ───────────────────────────────────────────
// CLIENT = the pop-out over /v1: no desktop-local actions, no send-back, no Restore-all. LITE = a client against an
// OLDER core (no S2 reads): the lazy single page / count probe / find / spreadsheet grid caps are off → those
// controls HIDE (never dead) and pages come from the full render. Otherwise the pop-out mirrors the core.
const DRIVE = `(async () => {
  const CLIENT = ${CLIENT};
  const LITE = ${LITE};
  const checks = [];
  const ok = (name, cond) => checks.push({ name, ok: !!cond });
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (fn()) return true; } catch {} await sleep(40); } return false; };
  const vis = (el) => !!el && el.style.display !== 'none';
  const btns = () => $$('#preview-actions button').map(b => b.textContent.trim());
  const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));

  // 1 — the list populated from the stub search (pre-filled with the deep-link term)
  ok('results: 3 rows rendered (2 confirmed + 1 unconfirmed)', await until(() => $$('.result-item').length === 3));
  ok('results: section headers CONFIRMED + UNCONFIRMED', $$('.section-header').map(h => h.textContent.trim().split(/\\s/)[0]).join(',') === 'CONFIRMED,UNCONFIRMED');
  ok('doc-type dropdown seeded from the transport (All types + 2)', $$('#inp-type option').length === 3);
  ok('quick-find deep-link pre-filled the full-text box', $('#inp-fulltext').value === 'inv');
  ok('admin sees the Recycle bin button', await until(() => vis($('#btn-recycle'))));
  // NOTE (pre-existing, pinned as-is for byte-identity): the FIRST paint runs before the entitlement
  // resolves (results-first ordering), so an unconfirmed row's confidence pip only appears on the next
  // list render — asserted after the bin round-trip below. Logged in pendingfeatures.md 2026-09-13.
  ok('first paint: no confidence pip yet (entitlement resolves after the results-first search)', !$('.result-item[data-id="3"] .result-conf'));
  ok('thumbnail loader attached an image to each row', $$('.result-thumb-img').length === 3);

  // 2 — preview a confirmed 3-page PDF
  click($('.result-item[data-id="1"]'));
  ok('preview: page 1 painted (lazy single-page read)', await until(() => ($('#preview-img').src || '').startsWith('data:image/png') && vis($('#preview-img-wrap'))));
  ok('preview: fields table rendered (Company/Type/Reference/Date/Status + extras)', $$('.pf-row').length >= 6);
  ok('preview: no confidence band on a CONFIRMED doc', !$('.pf-confband'));
  ok('preview: page nav shown with 1 / 3 (' + (LITE ? 'full render' : 'sparse array from page_count') + ')', await until(() => vis($('#page-nav')) && $('#page-label').textContent.trim() === '1 / 3'));
  if (LITE) {
    ok('preview (lite client): Find cluster HIDDEN (caps.find false — the core has no /v1 find)', await until(() => !vis($('#match-nav')) && !vis($('#match-sep'))));
    ok('preview (lite client): no highlight overlay drawn', $$('#preview-hl-layer .pv-hl').length === 0);
  } else {
    ok('preview: Find cluster shown (caps.find) and seeded with the list term', vis($('#match-nav')) && $('#inp-find-doc').value === 'inv');
    ok('preview: the list term is highlighted on page 1 (1 / 1)', await until(() => $$('#preview-hl-layer .pv-hl').length === 1 && $('#match-label').textContent.trim() === '1 / 1'));
  }
  if (CLIENT) ok('actions (client, admin, confirmed): Delete only — no Explorer / Open File / Print / Send back', (() => { const b = btns(); return b.some(t => t === 'Delete') && !b.some(t => /Explorer|Open File|Print|Send back|Edit in Review/.test(t)); })());
  else ok('actions (admin, confirmed, has_file): Send back + Explorer + Open File + Print + Delete', (() => { const b = btns(); return ['Send back to Review', 'Open in Explorer', 'Open File', 'Print', 'Delete'].every(x => b.some(t => t.includes(x))); })());
  ok('actions: no Stamp button when stamp.can says no + no workflow', !btns().some(t => /stamp|Send…/i.test(t)));
  ok('status chip reads Confirmed', ($('.ap-chip') || {}).textContent === 'Confirmed');

  // 3 — page nav: next page (a hole rendered on demand; lite client: the pre-rendered page)
  click($('#btn-page-next'));
  ok('page nav: next → 2 / 3', await until(() => $('#page-label').textContent.trim() === '2 / 3'));

  if (!LITE) {
    // 4 — find box: a term with no matches → no-match state; Esc clears
    const fi = $('#inp-find-doc'); fi.value = 'zzz'; fi.dispatchEvent(new Event('input', { bubbles: true }));
    ok('find: a no-match term marks the box + 0 / 0', await until(() => fi.classList.contains('no-match') && $('#match-label').textContent.trim() === '0 / 0'));
    fi.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    ok('find: Esc clears the box', await until(() => fi.value === '' && !fi.classList.contains('no-match')));
  }

  // 5 — an UNCONFIRMED doc: confidence band (+ Edit in Review on the core), no Send back
  click($('.result-item[data-id="3"]'));
  ok('unconfirmed preview: confidence band shown', await until(() => !!$('.pf-confband')));
  if (CLIENT) ok('unconfirmed preview (client): neither Edit in Review nor Send back (no desktop, no /v1 send-back)', (() => { const b = btns(); return !b.some(t => t.includes('Edit in Review')) && !b.some(t => t.includes('Send back')); })());
  else ok('unconfirmed preview: Edit in Review offered, Send back not', (() => { const b = btns(); return b.some(t => t.includes('Edit in Review')) && !b.some(t => t.includes('Send back')); })());
  ok('unconfirmed preview: ' + (LITE ? '2 rendered pages → 1 / 2 nav' : 'unknown page_count → probed → 1 / 2 nav'), await until(() => vis($('#page-nav')) && $('#page-label').textContent.trim() === '1 / 2'));

  // 6 — an .xlsx: no page image → the grid / the honest "No preview available" (lite client, caps.spreadsheet false)
  click($('.result-item[data-id="2"]'));
  if (LITE) ok('xlsx preview (lite client): honest "No preview available" (the core has no /v1 grid)', await until(() => /No preview available/.test($('#preview-img-placeholder').textContent)));
  else {
    ok('xlsx preview: cell grid rendered', await until(() => !!$('#preview-img-placeholder .xlsx-table')));
    ok('xlsx preview: 2 data rows + column letters', $$('.xlsx-table .xlsx-rownum').length === 2 && $$('.xlsx-table .xlsx-colhdr').length === 2);
  }
  ok('xlsx preview: page nav hidden', !vis($('#page-nav')));

  // 7 — the recycle bin
  click($('#btn-recycle'));
  ok('bin: RECYCLE BIN section with the deleted row', await until(() => $$('.section-header').some(h => /RECYCLE BIN/.test(h.textContent)) && !!$('.result-item[data-id="9"]')));
  if (CLIENT) ok('bin (client): Empty bin shown to an admin, Restore all HIDDEN (no /v1 restore-all)', vis($('#btn-empty-bin')) && !vis($('#btn-restore-all')));
  else ok('bin: Restore all + Empty bin shown to an admin', vis($('#btn-restore-all')) && vis($('#btn-empty-bin')));
  ok('bin: the toggle relabelled', /Back to search/.test($('#btn-recycle').textContent));
  click($('.result-item[data-id="9"]'));
  ok('bin: a deleted doc offers Restore + Delete permanently', await until(() => { const b = btns(); return b.some(t => t === 'Restore') && b.some(t => t.includes('Delete permanently')); }));
  ok('bin: the deleted row names its file', /old\\.pdf/.test($('.result-item[data-id="9"] .result-detail').textContent));
  click($('#btn-recycle'));
  ok('bin: back to the search results', await until(() => $$('.result-item').length === 3 && !$$('.section-header').some(h => /RECYCLE BIN/.test(h.textContent))));
  ok('re-render: an unconfirmed row now shows its confidence pip (entitled, enhanced search)', !!$('.result-item[data-id="3"] .result-conf'));

  // 8 — keyboard cycling (↓ from row 1 selects row 2)
  click($('.result-item[data-id="1"]'));
  await until(() => $('.result-item[data-id="1"].active'));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  ok('keys: ArrowDown moves the selection to the next row', await until(() => !!$('.result-item[data-id="2"].active')));

  if (CLIENT) {
    // 9 — client specifics: the capability hint shows ONLY for remediable drift (this client knows the S2 reads,
    //     the core does not = LITE); the theme attributes came from themeBoot (the shared theme.css is live).
    if (LITE) ok('lite client: "newer core needed" hint SHOWN (remediable drift)', await until(() => $('#popout-note').classList.contains('show')));
    else ok('client: "newer core needed" hint hidden when nothing is remediable', !$('#popout-note').classList.contains('show'));
    ok('client: theme attributes applied by themeBoot', !!document.documentElement.getAttribute('data-theme') && !!document.documentElement.getAttribute('data-mode'));
    ok('client: the shared theme.css is live (a token the search CSS needs resolves)', getComputedStyle(document.documentElement).getPropertyValue('--doc-bg').trim() !== '');
    ok('client: the connection banner starts hidden', !$('#popout-banner').classList.contains('show'));
  }

  const need = ['SearchTransport', 'SearchMarkup', 'SearchState', 'SearchThumbs', 'SearchActions', 'SearchResults', 'SearchPreview', 'SearchQuery', 'SearchUI']
    .concat(CLIENT ? ['ClientTheme'] : ['SearchWorkflow', 'SearchMailbox', 'SearchStamp']);
  return { checks, globals: need.filter(g => window[g] === undefined) };
})()`;

const DUMP_JS = `(() => {
  const ids = ['app', 'body', 'results-pane', 'preview-pane', 'preview-sidebar', 'results-scroll', 'preview-img-area'];
  const styles = {};
  for (const id of ids) { const el = document.getElementById(id); if (!el) { styles[id] = null; continue; } const cs = getComputedStyle(el);
    styles[id] = { display: cs.display, flexDirection: cs.flexDirection, flex: cs.flex, height: cs.height, width: cs.width, overflow: cs.overflow }; }
  const appEl = document.getElementById('app');
  // Direct children of #app (ids) — the S0b mount contract: the shared markup must sit DIRECTLY under #app.
  const appChildren = appEl ? [...appEl.children].map(c => c.id || ('.' + c.className)) : null;
  return { app: appEl ? appEl.outerHTML : null, appChildren, styles,
           scripts: [...document.scripts].map(s => s.getAttribute('src')),
           sheets: [...document.querySelectorAll('link[rel="stylesheet"]')].map(l => l.getAttribute('href')) };
})()`;

app.whenReady().then(async () => {
  const consoleErrors = [];
  const rec = { ok: false, checks: [], consoleErrors, calls: null, missingGlobals: null, html: HTML };
  let win = null;
  const finish = (code) => {
    try { if (win && !win.isDestroyed()) win.destroy(); } catch {}
    rec.calls = calls;
    const line = 'search-harness ' + JSON.stringify(rec);
    if (REPORT) { try { fs.writeFileSync(REPORT, JSON.stringify(rec, null, 2)); } catch {} }
    console.log(line);
    try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch {}
    app.exit(code);
  };
  const cap = setTimeout(() => { rec.checks.push({ name: 'overall timeout (60s)', ok: false }); finish(5); }, 60000);
  try {
    win = new BrowserWindow({
      show: false, width: 1400, height: 900, skipTaskbar: true, backgroundThrottling: false,
      webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    const wc = win.webContents;
    wc.on('console-message', (e, level, message) => { if (level >= 3 || /Uncaught|ReferenceError|TypeError/.test(message)) consoleErrors.push(message); });
    wc.on('render-process-gone', (e, d) => { rec.checks.push({ name: 'render-process-gone: ' + (d && d.reason), ok: false }); finish(5); });
    await win.loadFile(HTML);
    if (DUMP) {
      await new Promise(r => setTimeout(r, 600));
      const d = await wc.executeJavaScript(DUMP_JS);
      fs.writeFileSync(DUMP, JSON.stringify(d, null, 2));
    }
    const r = await wc.executeJavaScript(DRIVE);
    rec.checks = r.checks;
    rec.missingGlobals = r.globals;
    const fatal = consoleErrors.filter(m => /Uncaught|ReferenceError|TypeError/.test(m));
    if (fatal.length) rec.checks.push({ name: 'no uncaught renderer errors — ' + fatal.slice(0, 3).join(' | '), ok: false });
    if (r.globals.length) rec.checks.push({ name: 'load-bearing globals present (missing: ' + r.globals.join(', ') + ')', ok: false });
    rec.ok = rec.checks.every(c => c.ok);
    clearTimeout(cap);
    finish(rec.ok ? 0 : 5);
  } catch (e) {
    rec.checks.push({ name: 'harness threw: ' + (e && e.message), ok: false });
    clearTimeout(cap);
    finish(5);
  }
});
