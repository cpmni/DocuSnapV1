'use strict';

/**
 * modules/search/handler.js
 * Document search across confirmed and uncommitted documents.
 */

function register(ctx) {
  const { ipcMain, getDb } = ctx;
  const documents = require('../../../database/modules/documents');

  ipcMain.handle('search-documents', (_e, params) => {
    const db = getDb();
    const { company, reference, dateFrom, dateTo,
            docType, includeUncommitted } = params || {};

    // Confirmed documents
    const confirmed = documents.search(db, {
      company, reference, dateFrom, dateTo, docType, status: 'confirmed',
    });

    if (!includeUncommitted) {
      return { confirmed, uncommitted: [] };
    }

    // Uncommitted — needs_review + deferred
    const review   = documents.search(db, {
      company, reference, dateFrom, dateTo, docType, status: 'needs_review',
    });
    const deferred = documents.search(db, {
      company, reference, dateFrom, dateTo, docType, status: 'deferred',
    });

    return {
      confirmed,
      uncommitted: [...review, ...deferred],
    };
  });
}

module.exports = { register };
