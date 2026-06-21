'use strict';

const path = require('path');

function insert(db, { original_filename, folder_path, document_type_id,
                      supplier_name, overall_confidence, status,
                      template_id, logo_phash, keyword_fingerprint,
                      ocr_text }) {
  return db.prepare(`
    INSERT INTO documents
      (original_filename, folder_path, document_type_id,
       supplier_name, overall_confidence, status,
       template_id, logo_phash, keyword_fingerprint, ocr_text)
    VALUES
      (@original_filename, @folder_path, @document_type_id,
       @supplier_name, @overall_confidence, @status,
       @template_id, @logo_phash, @keyword_fingerprint, @ocr_text)
  `).run({
    original_filename, folder_path,
    document_type_id:    document_type_id    || null,
    supplier_name:       supplier_name       || null,
    overall_confidence:  overall_confidence  || null,
    status:              status              || 'pending',
    template_id:         template_id         || null,
    logo_phash:          logo_phash          || null,
    keyword_fingerprint: keyword_fingerprint || null,
    ocr_text:            ocr_text            || null,
  });
}

function update(db, id, changes) {
  const allowed = ['document_type_id', 'stored_filename', 'stored_path',
                   'status', 'overall_confidence', 'supplier_name',
                   'doc_date', 'reference_number', 'confirmed_at',
                   'error_message', 'template_id', 'working_path',
                   'review_acknowledged_at'];
  const sets = Object.keys(changes)
    .filter(k => allowed.includes(k))
    .map(k => `${k} = @${k}`)
    .join(', ');
  if (!sets) return;
  return db.prepare(`UPDATE documents SET ${sets} WHERE id = @id`)
    .run({ ...changes, id });
}

function getById(db, id) {
  return db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
}

// Clear any FK reference into documents that has NO ON DELETE action, so the
// subsequent DELETE doesn't trip a constraint. extractions/corrections cascade
// (001_initial.sql), but templates.sample_document_id (added by JS migration 8
// via ALTER TABLE, which can't carry an ON DELETE clause) is a back-link with no
// cascade — NULL it for the doomed rows. A deleted sample doesn't harm the
// template: its landmarks are already derived and stored in template_landmarks
// (keyed by template_id), so only the now-stale browse link is dropped. Guarded
// so minimal DBs without a templates table are a no-op. `whereSql`/`params`
// select the doomed document ids (e.g. "id = ?" or "status = ?").
function _clearDanglingDocRefs(db, whereSql, params) {
  try {
    db.prepare(
      `UPDATE templates SET sample_document_id = NULL
       WHERE sample_document_id IN (SELECT id FROM documents WHERE ${whereSql})`
    ).run(...params);
  } catch { /* no templates table (minimal test DB) — nothing to clear */ }
}

// Bulk delete every document in ONE workflow status — used only by the
// admin "Delete All Review" / "Delete All Deferred" actions. Scoped strictly to
// the given status so it can never touch confirmed (or any other) documents;
// extractions/corrections are removed by their ON DELETE CASCADE, and the
// no-cascade templates.sample_document_id back-link is cleared first (in one
// transaction) so the DELETE can't fail the FK. Callers are responsible for
// unlinking the source files first (see review/handler.js).
function deleteByStatus(db, status) {
  const tx = db.transaction((st) => {
    _clearDanglingDocRefs(db, 'status = ?', [st]);
    return db.prepare('DELETE FROM documents WHERE status = ?').run(st);
  });
  return tx(status);
}

function getWithExtractions(db, id) {
  const doc = getById(db, id);
  if (!doc) return null;
  doc.extractions = db.prepare(
    'SELECT * FROM extractions WHERE document_id = ? ORDER BY rowid'
  ).all(id);
  return doc;
}

function getReviewQueue(db) {
  // review_flag_count: how many of the doc's fields carry a validation note or a
  // correction candidate — lets the review list colour "corrected/flagged" rows
  // distinctly without loading every field. Read-only enrichment; no change to
  // confidence calculation.
  return db.prepare(`
    SELECT d.*, dt.name as type_name, dt.slug as type_slug,
      (SELECT COUNT(*) FROM extractions e
         WHERE e.document_id = d.id
           AND ( (e.validation_note IS NOT NULL AND e.validation_note <> '')
              OR (e.corrected_to   IS NOT NULL AND e.corrected_to   <> '') )
      ) AS review_flag_count,
      (SELECT COUNT(*) FROM extractions e
         JOIN fields f ON f.document_type_id = d.document_type_id AND f.key = e.field_key
         WHERE e.document_id = d.id
           AND e.confidence IS NOT NULL
           AND (f.enabled IS NULL OR f.enabled = 1)
           AND e.confidence < COALESCE(f.confidence_threshold, 70)
      ) AS below_threshold_count
    FROM documents d
    LEFT JOIN document_types dt ON dt.id = d.document_type_id
    WHERE d.status = 'needs_review'
    ORDER BY d.processed_at DESC
  `).all();
}

function getDeferredQueue(db) {
  return db.prepare(`
    SELECT d.*, dt.name as type_name, dt.slug as type_slug
    FROM documents d
    LEFT JOIN document_types dt ON dt.id = d.document_type_id
    WHERE d.status = 'deferred'
    ORDER BY d.processed_at DESC
  `).all();
}

function getReviewCount(db) {
  return db.prepare(
    "SELECT COUNT(*) as n FROM documents WHERE status = 'needs_review'"
  ).get().n;
}

function getDeferredCount(db) {
  return db.prepare(
    "SELECT COUNT(*) as n FROM documents WHERE status = 'deferred'"
  ).get().n;
}

// "Stuck" documents — extraction failed, so they hold at status='error'. These
// are the records behind the launchpad "couldn't be read" surface + reprocess.
function getStuckCount(db) {
  return db.prepare(
    "SELECT COUNT(*) as n FROM documents WHERE status = 'error'"
  ).get().n;
}

function confirm(db, id, { stored_filename, stored_path }) {
  return update(db, id, {
    status:       'confirmed',
    stored_filename,
    stored_path,
    confirmed_at: new Date().toISOString(),
  });
}

function deleteDoc(db, id) {
  // Same FK guard as deleteByStatus: clear the no-cascade template back-link
  // before the DELETE so removing a doc that is a template's pinned sample can't
  // fail the templates.sample_document_id constraint.
  const tx = db.transaction((docId) => {
    _clearDanglingDocRefs(db, 'id = ?', [docId]);
    return db.prepare('DELETE FROM documents WHERE id = ?').run(docId);
  });
  return tx(id);
}

function search(db, { company, reference, dateFrom, dateTo,
                      docType, status = 'confirmed', fullText, limit = 200 }) {
  let sql = `
    SELECT d.*, dt.name as type_name, dt.slug as type_slug
    FROM documents d
    LEFT JOIN document_types dt ON dt.id = d.document_type_id
    WHERE 1=1
  `;
  const params = {};

  if (status) {
    sql += ` AND d.status = @status`;
    params.status = status;
  }
  if (company && company.trim()) {
    sql += ` AND d.supplier_name LIKE @company`;
    params.company = `%${company.trim()}%`;
  }
  if (reference && reference.trim()) {
    sql += ` AND d.reference_number LIKE @reference`;
    params.reference = `%${reference.trim()}%`;
  }
  // doc_date is stored DD-MM-YYYY (validator.normalise_date), but the Search
  // date inputs (<input type="date">) supply ISO YYYY-MM-DD. Comparing those two
  // formats as strings never works (e.g. "16-03-2026" >= "2026-03-01" is always
  // false), so reshape a clean DD-MM-YYYY doc_date to ISO before comparing. Rows
  // whose doc_date isn't a well-formed DD-MM-YYYY yield NULL here and are simply
  // excluded from a date-filtered result — they can't be placed on the timeline.
  const ISO_DOC_DATE =
    "CASE WHEN d.doc_date GLOB '[0-9][0-9]-[0-9][0-9]-[0-9][0-9][0-9][0-9]' " +
    "THEN substr(d.doc_date,7,4)||'-'||substr(d.doc_date,4,2)||'-'||substr(d.doc_date,1,2) END";
  if (dateFrom) {
    sql += ` AND ${ISO_DOC_DATE} >= @dateFrom`;
    params.dateFrom = dateFrom;
  }
  if (dateTo) {
    sql += ` AND ${ISO_DOC_DATE} <= @dateTo`;
    params.dateTo = dateTo;
  }
  if (docType && docType !== 'all') {
    sql += ` AND dt.slug = @docType`;
    params.docType = docType;
  }
  if (fullText && fullText.trim()) {
    sql += ` AND d.ocr_text LIKE @fullText`;
    params.fullText = `%${fullText.trim()}%`;
  }

  sql += ` ORDER BY d.confirmed_at DESC, d.processed_at DESC LIMIT @limit`;
  params.limit = limit;

  return db.prepare(sql).all(params);
}

// Canonical on-disk path backing a document row, mirroring the same resolution
// the search/review previews use: a confirmed doc lives at its filed stored_path;
// anything else lives at folder_path/original_filename. folder_path is kept in
// sync with normal-flow moves (e.g. the processed-folder move updates it), so a
// MISSING file here means a real out-of-band deletion, not an app move. Returns
// null when no path can be resolved (such rows are never treated as stale).
function resolveFilePath(doc) {
  if (!doc) return null;
  // The app-managed working copy is the reliable, app-owned location and is the
  // normal path for unconfirmed docs (kept until the doc is filed or deleted).
  if (doc.working_path) return doc.working_path;
  if (doc.status === 'confirmed' && doc.stored_path) return doc.stored_path;
  if (doc.folder_path && doc.original_filename) {
    return path.join(doc.folder_path, doc.original_filename);
  }
  return null;
}

// Drop rows whose backing file no longer exists on disk — used to keep deleted
// documents out of search results without hard-deleting the audit rows. Bounded
// to the rows passed in (no full-disk scan); `existsFn` is injectable for tests.
function filterExisting(rows, existsFn) {
  return (rows || []).filter(doc => {
    const p = resolveFilePath(doc);
    return !p || existsFn(p);
  });
}

// Non-null managed working-copy paths across all documents — used by the
// startup inbox integrity sweep to distinguish live managed copies from
// crash-orphaned files.
function getWorkingPaths(db) {
  return db.prepare(
    "SELECT working_path FROM documents WHERE working_path IS NOT NULL AND working_path <> ''"
  ).all().map(r => r.working_path);
}

module.exports = {
  insert, update, getById, getWithExtractions,
  getReviewQueue, getDeferredQueue,
  getReviewCount, getDeferredCount, getStuckCount,
  confirm, deleteDoc, deleteByStatus, search,
  resolveFilePath, filterExisting, getWorkingPaths,
};
