'use strict';

/**
 * modules/search/handler.js
 * Document search across confirmed and uncommitted documents.
 *
 * The query + role-based result shaping live in the transport-agnostic
 * services/searchService.js so the SAME logic backs a future detached LAN client.
 * This handler owns only the Electron/IPC edge: authenticate, derive the caller's
 * role, delegate. Do NOT re-add the shaping rules here — they belong in the service.
 */

const searchService = require('../../services/searchService');

function register(ctx) {
  const { ipcMain, getDb } = ctx;
  const { requireLogin } = require('../auth/handler');

  ipcMain.handle('search-documents', (_e, params) => {
    // Authentication is transport-specific: the in-process session supplies the
    // role; a detached client would map a token to the same role set instead.
    const { role } = requireLogin();
    return searchService.searchDocuments({ db: getDb(), params, role });
  });
}

module.exports = { register };
