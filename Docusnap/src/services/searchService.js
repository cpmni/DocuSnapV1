'use strict';

/**
 * services/searchService.js
 * -------------------------
 * Transport-agnostic document-search logic, shared by the in-process IPC handler
 * (src/modules/search/handler.js) and any future detached/read-only client API.
 *
 * Design (see the detached-search-client plan, Stage 1):
 *  - Takes an EXPLICIT `role` rather than reading the in-process auth session, so
 *    the SAME authorization shaping applies no matter how the caller authenticated
 *    (an Electron IPC `currentSession` today; a token-mapped role for a detached
 *    LAN client later). AUTHENTICATION ("who are you") stays at the transport edge;
 *    this module owns only the role-based RESULT SHAPING and the query.
 *  - Reuses database/modules/documents.search()/filterExisting() UNCHANGED — there
 *    is no second search engine, so the SQL contract frozen by
 *    database/modules/test_search_contract.js is preserved by construction.
 *  - Returns rich rows (the internal shape). Any path-stripping DTO projection for
 *    a network client lives at the API edge (Stage 2), not here.
 */

const documents = require('../../database/modules/documents');

// Roles permitted to see uncommitted (needs_review + deferred) documents.
// Uncommitted results open the inline mini-review/commit panel — an edit action —
// so Read Only never receives them regardless of what the request asks for. This
// is the long-standing rule from the original search handler, centralised here so
// every transport enforces it identically.
const UNCOMMITTED_ROLES = ['admin', 'edit'];

function canSeeUncommitted(role) {
  return UNCOMMITTED_ROLES.includes(role);
}

/**
 * Run a document search and shape the result by the caller's role.
 *
 * @param {object}   args
 * @param {object}   args.db      open better-sqlite3 database handle
 * @param {object}   args.params  { company, reference, dateFrom, dateTo, docType, includeUncommitted, fullText }
 * @param {string}   args.role    'admin' | 'edit' | 'readonly'
 * @param {object}  [deps]
 * @param {function}[deps.existsFn] file-existence test (injectable for tests); defaults to fs.existsSync
 * @returns {{confirmed: object[], uncommitted: object[]}}
 */
function searchDocuments({ db, params, role }, deps = {}) {
  const existsFn = deps.existsFn || require('fs').existsSync;
  const onlyExisting = (rows) => documents.filterExisting(rows, existsFn);

  const { company, reference, dateFrom, dateTo,
          docType, includeUncommitted, fullText } = params || {};
  const common = { company, reference, dateFrom, dateTo, docType, fullText };

  // Confirmed documents — what "search/view documents" means for every role.
  const confirmed = onlyExisting(documents.search(db, { ...common, status: 'confirmed' }));

  if (!includeUncommitted || !canSeeUncommitted(role)) {
    return { confirmed, uncommitted: [] };
  }

  // Uncommitted — needs_review + deferred.
  const review   = documents.search(db, { ...common, status: 'needs_review' });
  const deferred = documents.search(db, { ...common, status: 'deferred' });

  return { confirmed, uncommitted: onlyExisting([...review, ...deferred]) };
}

module.exports = { searchDocuments, canSeeUncommitted, UNCOMMITTED_ROLES };
