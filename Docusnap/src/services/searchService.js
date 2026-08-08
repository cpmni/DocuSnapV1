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
          docType, includeUncommitted, fullText, total, totalOp } = params || {};
  const common = { company, reference, dateFrom, dateTo, docType, fullText, total, totalOp };

  // Confirmed documents — what "search/view documents" means for every role.
  // PROJECTED after filterExisting (LOAD-BEARING ORDER: the existence filter needs the
  // paths; the search ROW surface must never carry them). Honest scope (Oracle C3): the
  // single-doc click path (get-document-with-extractions → getById SELECT *) still ships
  // the selected doc's paths + ocr_text — its caller-aware projection is a named follow-up
  // (pendingfeatures "Document-detail DTO"), because Review consumes folder_path/ocr_text
  // from the SAME IPC and a global strip would break it.
  const confirmed = onlyExisting(documents.search(db, { ...common, status: 'confirmed' })).map(projectSearchRow);

  if (!includeUncommitted || !canSeeUncommitted(role)) {
    return { confirmed, uncommitted: [] };
  }

  // Uncommitted — needs_review + deferred.
  const review   = documents.search(db, { ...common, status: 'needs_review' });
  const deferred = documents.search(db, { ...common, status: 'deferred' });

  return { confirmed, uncommitted: onlyExisting([...review, ...deferred]).map(projectSearchRow) };
}

// ── DE-PATHING projection (owner 2026-08-02) ─────────────────────────────────────
// documents.search ships SELECT d.* — stored_path/working_path/folder_path, the FULL
// ocr_text of every row (200 rows × whole documents over IPC per keystroke), and the
// learning hashes. None of it is renderable; the paths were the sequential-filename
// browsing surface and ocr_text was pure payload. Every row a search RENDERER receives
// goes through this projection: the display fields + `has_file` (the Boolean the Open
// buttons used stored_path's truthiness for — same column, same semantics; opens now
// resolve server-side by docId). test_search_contract.js pins the ABSENCE of the
// stripped fields; getReviewQueue/getByIds and the internal callers are untouched.
const SEARCH_ROW_FIELDS = [
  'id', 'supplier_name', 'reference_number', 'doc_date', 'status',
  'type_name', 'type_slug', 'overall_confidence', 'original_filename', 'stored_filename',
  'page_count', 'deleted_at', 'document_type_id', 'confirmed_at', 'processed_at', 'template_id',
];
function projectSearchRow(row) {
  const out = {};
  for (const k of SEARCH_ROW_FIELDS) out[k] = row[k] !== undefined ? row[k] : null;
  out.has_file = !!row.stored_path;
  return out;
}

module.exports = { searchDocuments, canSeeUncommitted, projectSearchRow, UNCOMMITTED_ROLES };
