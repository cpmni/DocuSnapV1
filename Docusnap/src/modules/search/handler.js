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
  const documents = require('../../../database/modules/documents');

  // Real "documents filed" totals (today / this week / this month) for the dashboard
  // pulse — a direct SQL count, so it reflects true volume up to 999+ instead of being
  // capped by the search list. Read-only, login-gated like search.
  ipcMain.handle('get-filed-counts', () => {
    requireLogin();
    return documents.getFiledCounts(getDb());
  });

  ipcMain.handle('search-documents', (_e, params) => {
    // F-01 (multi-point licensing): search is DELIBERATELY left ungated in phase 1.
    // It is read-only (lowest value to a licence bypass — the licensed asset is the
    // extraction/learning WRITE path, gated at confirm-review + template mappings)
    // and carries the highest regression risk (locking a valid-but-just-expired
    // session out of merely VIEWING records). Revisit if search becomes a gated tier.
    //
    // Authentication is transport-specific: the in-process session supplies the
    // role; a detached client would map a token to the same role set instead.
    const { role } = requireLogin();
    return searchService.searchDocuments({ db: getDb(), params, role });
  });
}

module.exports = { register };
