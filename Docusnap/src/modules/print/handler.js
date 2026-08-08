'use strict';

/**
 * modules/print/handler.js — Document printing through the CUSTOMER'S PRINTER DRIVER.
 *
 * Print-Slice 1 (docs/designs/WORKFLOW_SUITE_2026-07-18.md §7; owner requirement: print
 * through the installed driver and ITS settings — duplex/tray/paper/quality/copies — NOT a
 * fixed Windows print path; audit EVERY print like any other action; original-vs-stamped —
 * original ships here, stamped is Print-Slice 2).
 *
 * MECHANISM: load the resolved PDF into a dedicated, per-job, BARE (no preload / no app JS)
 * offscreen BrowserWindow — Chromium's own PDF viewer renders it — then
 * `webContents.print({silent:false})` raises the OS/DRIVER print dialog. That dialog IS the
 * customer's installed-driver dialog, so the driver's settings are honoured. No app HTML/JS
 * runs (the top-level document is the PDF itself from a MAIN-resolved file://), so the app
 * CSP is irrelevant and there is nothing to relax; `will-navigate`/window-open denials keep a
 * crafted PDF from pivoting. Create-per-job, destroy-per-job, all closes isDestroyed()-guarded.
 *
 * SECURITY: the renderer supplies ONLY {docId, source} — never a path — so this can never be
 * an arbitrary-file-print primitive. The on-disk PDF is resolved SERVER-SIDE from the doc row
 * (documents.resolveFilePath). A print is a READ, so it goes through the Slice-0
 * canAccessDocument gate. Kill switch: setting `printing_enabled` (default OFF) + env
 * PRINTING_ENABLED=1 override; OFF ⇒ the IPC is inert and no print UI is shown.
 */

const documents = require('../../../database/modules/documents');
const learning  = require('../../../database/modules/learning');
const accessService = require('../../services/accessService');
const { requireLogin, logAudit } = require('../auth/handler');

const PRINT_LOAD_TIMEOUT_MS = 20000;

function printingEnabled(db) {
  const env = String(process.env.PRINTING_ENABLED || '').trim().toLowerCase();
  if (env === '1' || env === 'true' || env === 'on') return true;
  if (env === '0' || env === 'false' || env === 'off') return false;
  try { return learning.getSetting(db, 'printing_enabled', 'false') === 'true'; }
  catch { return false; }
}

function register(ctx) {
  const { ipcMain, getDb, fs, path, logger } = ctx;
  const { BrowserWindow } = require('electron');

  // The visible window that OWNS the print job's dialog — so the native driver dialog stays
  // above the app instead of dropping behind when the app is clicked (eric: a `show:false`
  // print window is unowned, so its dialog can be occluded). Prefer Review (where the Print
  // button lives), then main, then the focused window; all isDestroyed()-guarded so a closed
  // window can never be passed to `parent` (which would throw at construction).
  const getPrintParent = () => {
    const w = ctx.windows && ctx.windows['review'];
    if (w && !w.isDestroyed()) return w;
    const m = ctx.getMainWindow && ctx.getMainWindow();
    if (m && !m.isDestroyed()) return m;
    const f = BrowserWindow.getFocusedWindow();
    return (f && !f.isDestroyed()) ? f : undefined;
  };

  // Audit helper — every print INTENT gets a row (success | cancelled | failure | noop).
  const auditPrint = (db, docId, outcome, meta) => {
    try {
      logAudit(db, {
        action: 'document_printed', action_category: 'document',
        target_type: 'document', target_id: docId, document_id: docId,
        outcome,
        metadata: meta,   // NOTE: audit sanitiser redacts keys matching fingerprint/token — keep names clean
      });
    } catch (e) { try { logger?.warn?.('[print] audit failed: ' + e.message); } catch {} }
  };

  // Print one resolved PDF via a bare per-job window. `po` = print options:
  //   { silent, deviceName, pageRanges, copies, duplexMode, color }.
  // silent:false — THE DEFAULT (owner-directed 2026-07-18; the custom preview modal was
  // removed) — raises the OS/driver print dialog: the customer's installed-driver dialog,
  // so tray/duplex/paper/quality/copies are the driver's own; the only path with a user
  // 'cancelled' outcome. NOTE the preview pane INSIDE Windows' modern print dialog shows
  // "This app doesn't support print preview" — an Electron platform limitation (no
  // app-side preview provider); the dialog's settings all work. silent:true prints
  // straight to the chosen device through ITS driver (omitted options INHERIT the
  // printer's saved Printing Preferences — "the driver, with its settings", not a
  // bypass; eric) — kept for a future silent quick-print (Print-Slice 3). A BARE call
  // must never silently spool to the default printer, hence explicit opt-in below.
  // The REAL vector PDF is always what spools.
  function printPdf(db, docId, pdfPath, source, po) {
    const silent = po.silent === true;       // default FALSE = the OS/driver dialog
    return new Promise((resolve) => {
      let win = null, settled = false, timer = null, poll = null;
      const finish = (outcome, extra) => {
        if (settled) return; settled = true;
        if (timer) { clearTimeout(timer); timer = null; }
        if (poll) { clearInterval(poll); poll = null; }
        try { if (win && !win.isDestroyed()) win.destroy(); } catch {}
        win = null;
        auditPrint(db, docId, outcome, {
          source, printer: po.deviceName || null,
          pages: (Array.isArray(po.pageRanges) && po.pageRanges.length) ? 'range' : 'all',
          copies: po.copies || 1, silent, ...(extra || {}),
        });
        resolve({ ok: outcome === 'success', outcome });
      };
      try {
        win = new BrowserWindow({
          show: false,
          parent: getPrintParent(),   // owner association — bounds the ghost's lifetime to the app window; composes with topmost.
          // alwaysOnTop forces the OS/driver dialog (an OWNED window of this ghost) into the Windows
          // TOPMOST z-band, so it stays above the app when the app is clicked. `parent` ALONE cannot do
          // this: the ghost is show:false / never activated, so clicking a sibling app window doesn't
          // restack the dialog through the invisible intermediate owner (eric, 2026-07-18; the splash uses
          // the same show:false+alwaysOnTop pattern, main.js:379). skipTaskbar: explicit (the ghost is hidden).
          alwaysOnTop: true,
          skipTaskbar: true,
          webPreferences: { plugins: true, sandbox: true, contextIsolation: true, nodeIntegration: false, preload: undefined },
        });
        win.setMenu(null);
        win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        win.webContents.on('will-navigate', (e) => e.preventDefault());
        win.webContents.on('did-fail-load', (_e, code, desc) => finish('failure', { load_error: `${code} ${desc}`.slice(0, 80) }));
        // Leak backstop: if the ghost is ever torn down without a print outcome (the parent Review
        // window closes, or the app quits while the driver dialog is open), settle so the Promise +
        // audit row can't leak. No-op during normal finish()-driven teardown (the settled guard).
        win.once('closed', () => finish('cancelled', { reaped: 'window_closed' }));

        timer = setTimeout(() => finish('failure', { load_error: 'load timeout' }), PRINT_LOAD_TIMEOUT_MS);

        win.webContents.once('did-finish-load', () => {
          // The PDF has loaded — the load-timeout's job is done. CLEAR it (eric): otherwise a
          // user who reads/configures the driver dialog for >20s would hit the load-timeout,
          // which destroys the window and closes the dialog under them. An interactive dialog
          // must have NO wall-clock cap.
          if (timer) { clearTimeout(timer); timer = null; }
          // small settle so the PDF plugin is ready to print
          setTimeout(() => {
            if (settled || !win || win.isDestroyed()) return;
            const opts = { silent, printBackground: true };
            if (po.deviceName) opts.deviceName = po.deviceName;
            if (Array.isArray(po.pageRanges) && po.pageRanges.length) opts.pageRanges = po.pageRanges;
            if (po.copies && po.copies > 1) opts.copies = po.copies;
            if (po.duplexMode) opts.duplexMode = po.duplexMode;       // 'simplex'|'shortEdge'|'longEdge'
            if (po.pagesPerSheet && po.pagesPerSheet > 1) opts.pagesPerSheet = po.pagesPerSheet;  // N-up (reading order)
            if (typeof po.color === 'boolean') opts.color = po.color; // omit ⇒ driver default
            try {
              try { win.setAlwaysOnTop(true); } catch {}   // re-assert topmost the instant before the dialog opens (the ghost is never shown)
              win.webContents.print(opts, (success, failureReason) => {
                if (success) return finish('success');
                if (failureReason && /cancel/i.test(String(failureReason))) return finish('cancelled');
                finish('failure', { print_error: String(failureReason || 'unknown').slice(0, 80) });
              });
              // The print callback is UNRELIABLE — it may not fire on cancel, on a virtual printer's
              // "Save as" prompt, or even a normal Ricoh job (owner-observed) — so it can't be the only
              // teardown, or a cancelled/no-callback print leaks the ghost + Promise and writes NO audit
              // row. Independent close-detector: a modal print dialog DISABLES its owner (the ghost) while
              // open and re-enables it on close, so win.isEnabled() tracks open→closed. On open-then-closed
              // with no callback, reap. Deliberately NO "never opened" wall-clock cap is armed (eric's
              // openBound): that could close a LIVE dialog if the enabled-state signal is absent (unverified
              // on the Win11 modern dialog). Without it this is fail-safe either way — it reaps when
              // isEnabled tracks state, and harmlessly no-ops if it doesn't (the once('closed') backstop
              // above still resolves on app-window close; leak then bounded to Review's lifetime). (eric, 2026-07-18)
              let sawDisabled = false;
              poll = setInterval(() => {
                if (settled || !win || win.isDestroyed()) { if (poll) { clearInterval(poll); poll = null; } return; }
                let enabled; try { enabled = win.isEnabled(); } catch { return; }
                if (!sawDisabled) { if (enabled === false) sawDisabled = true; }   // dialog opened
                else if (enabled === true) {                                        // dialog closed (printed OR cancelled)
                  clearInterval(poll); poll = null;
                  // Let a late/slow callback land first — it carries the accurate success/cancel outcome;
                  // only if none arrives do we record the honest, indeterminate 'closed'.
                  setTimeout(() => { if (!settled) finish('closed', { callback: false }); }, 600);
                }
              }, 200);
            } catch (e) { finish('failure', { print_error: e.message.slice(0, 80) }); }
          }, 300);
        });

        const { pathToFileURL } = require('url');
        win.loadURL(pathToFileURL(pdfPath).href).catch((e) => finish('failure', { load_error: e.message.slice(0, 80) }));
      } catch (e) {
        finish('failure', { spawn_error: e.message.slice(0, 80) });
      }
    });
  }

  // print-document({ docId, source:'original'|'stamped', silent?, deviceName?, pageRanges?, copies?, duplexMode?, color? })
  ipcMain.handle('print-document', async (_e, payload) => {
    const sess = requireLogin();
    const db = getDb();
    const docId = payload && Number(payload.docId);
    const source = (payload && payload.source) || 'original';
    const po = {
      silent:     payload ? payload.silent : undefined,   // default FALSE in printPdf (OS/driver dialog)
      deviceName: payload && payload.deviceName,
      pageRanges: payload && payload.pageRanges,
      copies:     payload && Number(payload.copies) > 0 ? Math.min(99, Math.floor(Number(payload.copies))) : 1,
      duplexMode: payload && payload.duplexMode,
      color:      payload && typeof payload.color === 'boolean' ? payload.color : undefined,
      // N-up (plain reading-order pages-per-sheet — Chromium honours 1/2/4/6/9/16). NOT booklet
      // imposition: booklet needs page reordering the driver owns, so it lives only in the full
      // driver dialog (silent:false). See the modal's "Full printer dialog…" button.
      pagesPerSheet: payload && Number(payload.pagesPerSheet) > 1 ? Math.floor(Number(payload.pagesPerSheet)) : undefined,
    };

    if (!printingEnabled(db)) return { ok: false, reason: 'disabled' };
    if (!docId) return { ok: false, reason: 'bad_request' };

    // A print is a READ — the same per-document gate as preview (Slice 0). Fail closed.
    if (accessService.gateEnabled()) {
      const acc = accessService.canAccessDocument(db, sess, docId);
      if (!acc.allow) { auditPrint(db, docId, 'noop', { source, reason: 'access_denied' }); return { ok: false, reason: 'forbidden' }; }
    }

    // Stamped source lands in Print-Slice 2 (route resolution + party scope). For now,
    // never silently substitute — tell the renderer it can print the original.
    if (source === 'stamped') {
      auditPrint(db, docId, 'noop', { source, reason: 'stamped_not_available' });
      return { ok: false, reason: 'stamped_not_available', canPrintOriginal: true };
    }

    const doc = documents.getById(db, docId);
    const pdfPath = doc ? documents.resolveFilePath(doc) : null;
    if (!pdfPath || !fs.existsSync(pdfPath)) { auditPrint(db, docId, 'failure', { source, reason: 'file_missing' }); return { ok: false, reason: 'file_missing' }; }
    if (String(path.extname(pdfPath)).toLowerCase() !== '.pdf') { auditPrint(db, docId, 'noop', { source, reason: 'not_pdf' }); return { ok: false, reason: 'not_pdf' }; }

    return printPdf(db, docId, pdfPath, source, po);
  });

  // Read-only: is printing available? (for the renderer to show/hide the print control)
  ipcMain.handle('print-available', () => {
    try { requireLogin(); } catch { return false; }
    return printingEnabled(getDb());
  });

  // List installed printers for the in-app print-preview picker. No paths/privileged data
  // cross; gated on login + the printing feature. Uses the CALLING window's webContents.
  ipcMain.handle('list-printers', async (_e) => {
    try { requireLogin(); } catch { return []; }
    if (!printingEnabled(getDb())) return [];
    try {
      const wc = _e && _e.sender;
      if (!wc || wc.isDestroyed()) return [];
      const printers = await wc.getPrintersAsync();
      return (printers || []).map(p => ({
        name: p.name, displayName: p.displayName || p.name,
        isDefault: !!p.isDefault, status: p.status,
      }));
    } catch { return []; }
  });
}

module.exports = { register, _printingEnabled: printingEnabled };
