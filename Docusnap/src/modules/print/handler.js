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

  // Print one resolved PDF via a bare per-job window + the driver dialog. Resolves to the
  // print outcome; never rejects (all failure lands as an audited outcome).
  function printPdf(db, docId, pdfPath, source, deviceName, pageRanges) {
    return new Promise((resolve) => {
      let win = null, settled = false, timer = null;
      const finish = (outcome, extra) => {
        if (settled) return; settled = true;
        if (timer) { clearTimeout(timer); timer = null; }
        try { if (win && !win.isDestroyed()) win.destroy(); } catch {}
        win = null;
        auditPrint(db, docId, outcome, { source, printer: deviceName || null, pages: pageRanges ? 'range' : 'all', silent: false });
        resolve({ ok: outcome === 'success', outcome });
      };
      try {
        win = new BrowserWindow({
          show: false,
          webPreferences: { plugins: true, sandbox: true, contextIsolation: true, nodeIntegration: false, preload: undefined },
        });
        win.setMenu(null);
        win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        win.webContents.on('will-navigate', (e) => e.preventDefault());
        win.webContents.on('did-fail-load', (_e, code, desc) => finish('failure', { load_error: `${code} ${desc}`.slice(0, 80) }));

        timer = setTimeout(() => finish('failure', { load_error: 'load timeout' }), PRINT_LOAD_TIMEOUT_MS);

        win.webContents.once('did-finish-load', () => {
          // small settle so the PDF plugin is ready to print
          setTimeout(() => {
            if (settled || !win || win.isDestroyed()) return;
            const opts = { silent: false, printBackground: true };
            if (deviceName) opts.deviceName = deviceName;
            if (Array.isArray(pageRanges) && pageRanges.length) opts.pageRanges = pageRanges;
            try {
              win.webContents.print(opts, (success, failureReason) => {
                if (success) return finish('success');
                if (failureReason && /cancel/i.test(String(failureReason))) return finish('cancelled');
                finish('failure', { print_error: String(failureReason || 'unknown').slice(0, 80) });
              });
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

  // print-document({ docId, source:'original'|'stamped', deviceName?, pageRanges? })
  ipcMain.handle('print-document', async (_e, payload) => {
    const sess = requireLogin();
    const db = getDb();
    const docId = payload && Number(payload.docId);
    const source = (payload && payload.source) || 'original';
    const deviceName = payload && payload.deviceName;
    const pageRanges = payload && payload.pageRanges;

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

    return printPdf(db, docId, pdfPath, source, deviceName, pageRanges);
  });

  // Read-only: is printing available? (for the renderer to show/hide the print control)
  ipcMain.handle('print-available', () => {
    try { requireLogin(); } catch { return false; }
    return printingEnabled(getDb());
  });
}

module.exports = { register, _printingEnabled: printingEnabled };
