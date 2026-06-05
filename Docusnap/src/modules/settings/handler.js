'use strict';

/**
 * modules/settings/handler.js
 * Document types, fields, app settings (output folder etc).
 */

function register(ctx) {
  const { ipcMain, getDb } = ctx;
  const doctypes = require('../../../database/modules/document_types');
  const learning = require('../../../database/modules/learning');

  // ── Document types ──────────────────────────────────────────────────────────
  ipcMain.handle('get-document-types',   () => doctypes.getAll(getDb()));
  ipcMain.handle('get-all-doc-types',    () => doctypes.getAllWithFields(getDb()));
  ipcMain.handle('add-document-type',    (_e, data)    => doctypes.addType(getDb(), data));
  ipcMain.handle('update-document-type', (_e, id, ch)  => doctypes.updateType(getDb(), id, ch));

  // ── Fields ──────────────────────────────────────────────────────────────────
  ipcMain.handle('add-field',    (_e, data)    => doctypes.addField(getDb(), data));
  ipcMain.handle('update-field', (_e, id, ch)  => doctypes.updateField(getDb(), id, ch));
  ipcMain.handle('delete-field', (_e, id)      => doctypes.deleteField(getDb(), id));

  // ── App settings (key-value) ─────────────────────────────────────────────────
  ipcMain.handle('get-setting', (_e, key)      => learning.getSetting(getDb(), key));
  ipcMain.handle('set-setting', (_e, key, val) => {
    learning.setSetting(getDb(), key, val);
    return true;
  });
}

module.exports = { register };
