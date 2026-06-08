'use strict';

/**
 * modules/settings/handler.js
 * Document types, fields, app settings (output folder etc).
 */

function register(ctx) {
  const { ipcMain, getDb, notifyAllWindows } = ctx;
  const doctypes = require('../../../database/modules/document_types');
  const learning = require('../../../database/modules/learning');
  const { requireRole, requireLogin } = require('../auth/handler');

  // ── Document types ──────────────────────────────────────────────────────────
  // get-all-doc-types is shared with Review (Admin/Edit) and Search (every
  // role, including Read Only — it populates the type filter); gate to "any
  // signed-in user". The "…All" variant (incl. disabled types, used to build
  // the Document Types tab) and every mutation below live only in the
  // Admin-exclusive Settings window — "access all settings".
  ipcMain.handle('get-document-types',        () => { requireLogin(); return doctypes.getAll(getDb()); });
  ipcMain.handle('get-all-doc-types',         () => { requireLogin(); return doctypes.getAllWithFields(getDb()); });
  ipcMain.handle('get-all-doc-types-all',     () => { requireRole('admin'); return doctypes.getAllWithFieldsAll(getDb()); });
  ipcMain.handle('add-document-type',    (_e, data)    => { requireRole('admin'); return doctypes.addType(getDb(), data); });
  ipcMain.handle('update-document-type', (_e, id, ch)  => { requireRole('admin'); return doctypes.updateType(getDb(), id, ch); });

  // ── Fields ──────────────────────────────────────────────────────────────────
  ipcMain.handle('add-field',    (_e, data)    => { requireRole('admin'); return doctypes.addField(getDb(), data); });
  ipcMain.handle('update-field', (_e, id, ch)  => { requireRole('admin'); return doctypes.updateField(getDb(), id, ch); });
  ipcMain.handle('delete-field', (_e, id)      => { requireRole('admin'); return doctypes.deleteField(getDb(), id); });

  // ── App settings (key-value) ─────────────────────────────────────────────────
  // get-setting stays open even pre-login: theme.js reads 'theme' from every
  // window — including the login screen, before currentSession exists — to
  // apply the dark/light theme before first paint. It's a low-sensitivity
  // read (theme name, folder paths already visible via Search results) with
  // no per-key write path outside the Admin-gated Settings window, where
  // set-setting below is the actual enforcement boundary for "access all
  // settings".
  ipcMain.handle('get-setting', (_e, key)      => learning.getSetting(getDb(), key));
  ipcMain.handle('set-setting', (_e, key, val) => {
    requireRole('admin');
    learning.setSetting(getDb(), key, val);
    if (key === 'theme') notifyAllWindows('theme-changed', val);
    return true;
  });
}

module.exports = { register };
