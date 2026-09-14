'use strict';
/*
 * scripts/teach-window-harness.js — RUNTIME boot/flow smoke for the shared teach UI
 * (teach-over-client, 2026-09-14; the search-window-harness twin).
 *
 * The pins under src/windows/{teach,shared} are SOURCE-CONTRACT checks — they read teach.js as text. They do
 * not prove the shared teach-ui module + the coreTeachTransport/coreTeachHost adapters + the REAL preload
 * actually boot the wizard and carry data end-to-end. This harness opens the real teach index.html HIDDEN with
 * the real src/preload.js and stubbed ipcMain handlers, then drives it: boot (globals + step 0), advance to the
 * document picker (proves TeachTransport delivers the review queue) and the type step (proves it delivers the
 * doc types), then into the point-out-fields step (proves it delivers the page render). Reports pass/fail per
 * check + the IPC channels it saw.
 *
 * Run with ELECTRON (not node):  <repo>\node_modules\electron\dist\electron.exe scripts/teach-window-harness.js
 *   --dump <file>   write #stage layout + loaded scripts after boot
 *   --report <file> write the JSON record
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const argOf = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const DUMP = argOf('--dump');
const REPORT = argOf('--report');
const HTML = path.join(ROOT, 'src', 'windows', 'teach', 'index.html');
const PRELOAD = path.join(ROOT, 'src', 'preload.js');

// Throwaway userData BEFORE ready (never the live one; own single-instance key).
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-teach-harness-'));
app.setPath('userData', tmpUserData);

// ── Stub world ───────────────────────────────────────────────────────────────
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG_URL = 'data:image/png;base64,' + PNG;
const REVIEW_ROW = { id: 1, original_filename: 'demo-invoice.pdf', supplier_name: 'Acme Ltd', type_name: 'Invoice', folder_path: 'C:/x', page_count: 1 };
const DOC_TYPE = {
  slug: 'invoice', name: 'Invoice', ref_field_key: 'invoice_number', date_field_key: 'invoice_date',
  fields: [
    { key: 'invoice_number', label: 'Invoice No', type: 'text', required: 1, enabled: 1, built_in: 1 },
    { key: 'invoice_date',   label: 'Date',       type: 'date', required: 1, enabled: 1, built_in: 1 },
  ],
};

const calls = [];
function stub(channel, fn) { ipcMain.handle(channel, (_e, ...a) => { calls.push(channel); return fn(...a); }); }

stub('get-teach-target', () => null);
stub('get-review-queue', () => [REVIEW_ROW]);
stub('get-deferred-queue', () => []);
stub('get-all-doc-types', () => [DOC_TYPE]);
stub('get-all-doc-types-all', () => [DOC_TYPE]);
stub('get-document-pages', () => [PNG_URL]);
stub('get-document-thumbnail', () => null);
stub('get-staged-teach-thumbnail', () => null);
stub('get-setting', () => '');                                   // feature flags off
stub('get-validation-patterns', () => ({}));
stub('get-field-patterns', () => ({}));
stub('get-label-overrides', () => []);
stub('get-doctype-catalog', () => []);
stub('get-page-deskew', () => ({ image: PNG, angle: 0, measured: true }));
stub('ocr-region', () => 'ACME LTD');
stub('ocr-region-boxes', () => ({ words: [] }));
stub('ocr-page-words', () => ({ w: 1, h: 1, words: [] }));
stub('get-template-detail', () => ({ landmarks: [] }));
stub('get-teach-followup', () => ({ ok: false }));
// commit-side channels (not driven by the boot smoke, but stubbed so a stray call cannot reject noisily)
for (const c of ['promote-to-template', 'save-template-mapping', 'set-template-field-fixed',
                 'set-template-hidden-field', 'teach-list-caption', 'confirm-review',
                 'check-issuer-read', 'check-identity-near-match', 'check-type-split']) {
  stub(c, () => ({ success: true }));
}

const DRIVE = `(async () => {
  const checks = [];
  const ok = (name, cond) => checks.push({ name, ok: !!cond });
  const $ = (id) => document.getElementById(id);
  const until = async (fn, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (fn()) return true; } catch {} await new Promise(r => setTimeout(r, 60)); } return false; };
  const activeStep = () => { const s = document.querySelector('.step.active'); return s ? s.dataset.step : null; };

  // 1 — boot: the adapters + the shared wizard + its sub-components are live.
  ok('window.TeachTransport is defined (the data adapter loaded before the wizard)', !!window.TeachTransport);
  ok('window.TeachHost is defined (the chrome adapter loaded before the wizard)', !!window.TeachHost);
  ok('the transport declares caps', window.TeachTransport && typeof window.TeachTransport.caps === 'object');
  ok('the wizard reached an active step (renderFooter/setStep ran → teach.js did not throw at load)', activeStep() !== null);
  ok('the footer Next button carries a label (renderFooter ran)', ($('btn-next')?.textContent || '').trim().length > 0);

  // 2 — advance to the document picker: proves TeachTransport delivered the review queue into the real wizard.
  await until(() => activeStep() === '0' || activeStep() === '1');
  if (activeStep() === '0') { $('btn-next').click(); }
  const gotPicker = await until(() => activeStep() === '1' && $('doc-picker') && $('doc-picker').querySelector('.card'));
  ok('step 1 renders a picker card from the review queue (getReviewQueue via TeachTransport)', gotPicker);

  // 3 — advance to the type step: proves getAllDocTypes flowed through the adapter.
  const canNext1 = await until(() => !$('btn-next').disabled);
  ok('Next is enabled once a document is selected (renderDocPicker auto-picked the first)', canNext1);
  $('btn-next').click();
  const gotTypes = await until(() => activeStep() === '2' && $('type-grid') && $('type-grid').querySelector('.card[data-slug]'));
  ok('step 2 renders a type card (getAllDocTypes via TeachTransport)', gotTypes);

  // 4 — pick the type, advance to the point-out step: proves getDocumentPages rendered onto the canvas.
  const card = $('type-grid') && $('type-grid').querySelector('.card[data-slug="invoice"]');
  if (card) card.click();
  const canNext2 = await until(() => !$('btn-next').disabled);
  ok('Next is enabled once a type is picked', canNext2);
  if (canNext2) $('btn-next').click();
  const gotCanvas = await until(() => activeStep() === '3' && $('rg-loading') && $('rg-loading').classList.contains('hidden') && $('pageCanvas') && $('pageCanvas').width > 0, 8000);
  ok('step 3 renders the page onto the canvas (getDocumentPages via TeachTransport; loading overlay cleared)', gotCanvas);

  const needGlobals = ['TeachTransport', 'TeachHost', 'DocTypeEditor', 'DocTypeCatalog', 'Thumbs', 'AnchorLabel', 'ListCaption', 'BoxSnap', 'ValueLocate'];
  return { checks, globals: needGlobals.filter(g => window[g] === undefined) };
})()`;

const DUMP_JS = `(() => ({
  activeStep: (document.querySelector('.step.active') || {}).dataset ? document.querySelector('.step.active').dataset.step : null,
  scripts: [...document.scripts].map(s => s.getAttribute('src')),
  nextLabel: (document.getElementById('btn-next') || {}).textContent,
}))()`;

app.whenReady().then(async () => {
  const consoleErrors = [];
  const rec = { ok: false, checks: [], consoleErrors, calls: null, missingGlobals: null };
  let win = null;
  const finish = (code) => {
    try { if (win && !win.isDestroyed()) win.destroy(); } catch {}
    rec.calls = [...new Set(calls)];
    console.log('teach-harness ' + JSON.stringify(rec));
    if (REPORT) { try { fs.writeFileSync(REPORT, JSON.stringify(rec, null, 2)); } catch {} }
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
    if (DUMP) { await new Promise(r => setTimeout(r, 500)); fs.writeFileSync(DUMP, JSON.stringify(await wc.executeJavaScript(DUMP_JS), null, 2)); }
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
