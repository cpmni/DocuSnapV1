'use strict';

/**
 * modules/export/handler.js
 * -------------------------
 * Data-export IPC: the Home → Export window pulls confirmed document data
 * (chosen suppliers × types × fields) out to a CSV or JSON file the user saves
 * wherever they like. Read-only against the data model; ADMIN-gated (a bulk
 * egress of business data, matching the settings-backup / audit-log exporters).
 *
 * The OS save dialog's returned path is the sole write target — we write there
 * and nowhere else, and never derive a second path from it (so the export never
 * needs, and never uses, the _allowedOpenRoots containment that governs
 * in-app file OPENS). Every run is audited with row count + filename only.
 */

function register(ctx) {
  const { ipcMain, getDb } = ctx;
  const { requireRole, logAudit } = require('../auth/handler');
  const exportService = require('../../services/exportService');

  // What the Export window needs to build its selectors.
  ipcMain.handle('export-options', () => {
    requireRole('admin');
    return exportService.listOptions(getDb());
  });

  // Live preview: total match count + the first rows for the selected scope.
  ipcMain.handle('export-preview', (_e, { filters, sel } = {}) => {
    requireRole('admin');
    const g = exportService.gather(getDb(), filters || {}, { ...(sel || {}), limit: 50 });
    return { count: g.count, columns: g.columns, rows: g.rows, truncated: g.truncated };
  });

  // Save dialog FIRST, then gather → serialise → write (so a mis-click never
  // freezes the app on a big gather before the user has committed — Oracle).
  // The ACTUAL format is derived from the saved extension, so the dialog filter
  // and the writer can never disagree; the chosen format only seeds the default.
  ipcMain.handle('export-run', async (e, { filters, sel } = {}) => {
    requireRole('admin');
    const { dialog, BrowserWindow } = require('electron');
    const fs = require('fs');
    const path = require('path');

    const win = BrowserWindow.fromWebContents(e.sender);
    const stamp = new Date().toISOString().slice(0, 10);
    const pref = (sel && sel.format) === 'json' ? 'json' : (sel && sel.format) === 'xlsx' ? 'xlsx' : 'csv';
    const F = {
      csv:  { name: 'CSV (Excel, databases)', extensions: ['csv'] },
      json: { name: 'JSON', extensions: ['json'] },
      xlsx: { name: 'Excel workbook', extensions: ['xlsx'] },
    };
    const order = [pref, ...['csv', 'json', 'xlsx'].filter((k) => k !== pref)];
    const r = await dialog.showSaveDialog(win, {
      title: 'Export document data',
      defaultPath: `scanfinder-export-${stamp}.${pref}`,
      filters: order.map((k) => F[k]),
    });
    if (r.canceled || !r.filePath) return { saved: false, canceled: true };

    const g = exportService.gather(getDb(), filters || {}, sel || {});
    if (!g.rows.length) return { saved: false, empty: true };
    const trunc = g.truncated ? { exported: g.rows.length, total: g.count } : null;

    const ext = path.extname(r.filePath).toLowerCase();
    let format;
    if (ext === '.json') {
      fs.writeFileSync(r.filePath, exportService.toJson(g.columns, g.rows, trunc), 'utf8'); format = 'json';
    } else if (ext === '.xlsx') {
      fs.writeFileSync(r.filePath, exportService.toXlsx(g.columns, g.rows, trunc)); format = 'xlsx';
    } else {
      fs.writeFileSync(r.filePath, exportService.toCsv(g.columns, g.rows, trunc), 'utf8'); format = 'csv';
    }

    try {
      logAudit(getDb(), {
        action: 'data_export',
        action_category: 'data',
        outcome: 'ok',
        target_type: 'export',
        details: `${format} · ${g.rows.length} row(s) · ${g.columns.length} column(s) · ${exportService.filterSummary(filters || {})}${trunc ? ' · TRUNCATED at cap' : ''} · ${path.basename(r.filePath)}`,
      });
    } catch { /* audit is best-effort, never blocks the export */ }

    return { saved: true, path: r.filePath, count: g.rows.length, columns: g.columns.length, format, truncated: g.truncated, total: g.count };
  });
}

module.exports = { register };
