'use strict';

/**
 * modules/search/handler.js
 * Document search across confirmed and uncommitted documents.
 */

function register(ctx) {
  const { ipcMain, getDb } = ctx;
  const documents = require('../../../database/modules/documents');
  const { requireLogin, hasRole } = require('../auth/handler');

  ipcMain.handle('search-documents', (_e, params) => {
    requireLogin();
    const db = getDb();
    const { company, reference, dateFrom, dateTo,
            docType, includeUncommitted, fullText } = params || {};

    // Confirmed documents — what "search/view documents" means for every role.
    const confirmed = documents.search(db, {
      company, reference, dateFrom, dateTo, docType, fullText, status: 'confirmed',
    });

    // Uncommitted results open the inline mini-review/commit panel — an edit
    // action — so Read Only never receives them, regardless of what the
    // request asks for (the renderer hiding that toggle is a UX nicety only).
    if (!includeUncommitted || !hasRole('admin', 'edit')) {
      return { confirmed, uncommitted: [] };
    }

    // Uncommitted — needs_review + deferred
    const review   = documents.search(db, {
      company, reference, dateFrom, dateTo, docType, fullText, status: 'needs_review',
    });
    const deferred = documents.search(db, {
      company, reference, dateFrom, dateTo, docType, fullText, status: 'deferred',
    });

    return {
      confirmed,
      uncommitted: [...review, ...deferred],
    };
  });
}

module.exports = { register };
