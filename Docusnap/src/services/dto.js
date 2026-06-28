'use strict';

/**
 * services/dto.js
 * ---------------
 * THE TRUST-BOUNDARY PROJECTION for the detached-client API.
 *
 * The internal IPC handlers return rich rows straight from `documents.*`
 * (getById is `SELECT *`), which include FILESYSTEM PATHS (`stored_path`,
 * `folder_path`, `working_path`) and raw `ocr_text`. Those must NEVER cross the
 * network boundary to a detached client — a path lets a client reason about /
 * potentially reach the server's filesystem, and raw OCR text is un-permissioned
 * content. So every value the API emits is built with an explicit ALLOWLIST here;
 * we never hand back a raw DB row.
 *
 * Allowlist (not denylist) on purpose: a new column added to `documents` later
 * cannot accidentally start leaking — it simply won't appear until added here.
 */

// The fields a detached search client needs for a result row — exactly the set
// frozen by database/modules/test_search_contract.js (ESSENTIAL), no paths.
const SEARCH_ROW_FIELDS = [
  'id', 'supplier_name', 'reference_number', 'doc_date', 'status',
  'type_name', 'type_slug', 'overall_confidence',
  'original_filename', 'stored_filename',
];

// Extra non-path fields safe to expose on the single-document detail view.
const DETAIL_EXTRA_FIELDS = [
  'document_type_id', 'confirmed_at', 'processed_at', 'digit_only_fields',
];

// Per-extraction display fields — display_value (what the UI shows), confidence,
// and the review/flag hints. raw_value and internal bookkeeping are omitted.
const EXTRACTION_FIELDS = [
  'field_key', 'display_value', 'confidence',
  'was_corrected', 'corrected_to', 'validation_note', 'extraction_method',
];

// Workflow route fields safe for the wire — username snapshots (not raw user ids),
// the request/decision/state, comments, claim/resolve stamps, the optimistic
// version, and a small joined document summary. No filesystem fields exist on a
// route row, but this stays an allowlist for the same forward-safety reason.
const ROUTE_FIELDS = [
  'id', 'document_id', 'from_username', 'to_username', 'action_required', 'state',
  'comment', 'resolution_comment', 'claimed_by_username', 'claimed_at', 'resolved_at',
  'version', 'created_at',
  'supplier_name', 'reference_number', 'doc_date', 'doc_status', 'type_name', 'type_slug',
];

// Fields that must never appear in any DTO. Asserted by the conformance test.
const FORBIDDEN_FIELDS = ['stored_path', 'folder_path', 'working_path', 'ocr_text'];

function pick(row, fields) {
  const out = {};
  if (!row) return out;
  for (const f of fields) if (f in row) out[f] = row[f];
  return out;
}

function projectSearchRow(row) {
  return pick(row, SEARCH_ROW_FIELDS);
}

/** Project a { confirmed, uncommitted } search result for the wire. */
function projectSearchResult(result) {
  const r = result || {};
  return {
    confirmed:   (r.confirmed   || []).map(projectSearchRow),
    uncommitted: (r.uncommitted || []).map(projectSearchRow),
  };
}

/** Project a single enriched document-detail row (+ its extractions) for the wire. */
function projectDocumentDetail(doc) {
  if (!doc) return null;
  const out = pick(doc, [...SEARCH_ROW_FIELDS, ...DETAIL_EXTRA_FIELDS]);
  out.extractions = Array.isArray(doc.extractions)
    ? doc.extractions.map(e => pick(e, EXTRACTION_FIELDS))
    : [];
  return out;
}

// Expose only a BOOLEAN that a stamped copy exists — never the server-side file path
// (the client fetches the stamped pages by route id, mirroring the doc-pages boundary).
function projectRoute(row) { return { ...pick(row, ROUTE_FIELDS), has_stamp: !!(row && row.stamped_path) }; }
function projectRoutes(rows) { return (rows || []).map(projectRoute); }

module.exports = {
  projectSearchRow, projectSearchResult, projectDocumentDetail,
  projectRoute, projectRoutes,
  SEARCH_ROW_FIELDS, DETAIL_EXTRA_FIELDS, EXTRACTION_FIELDS, ROUTE_FIELDS, FORBIDDEN_FIELDS,
};
