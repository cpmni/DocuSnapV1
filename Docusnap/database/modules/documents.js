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
                   'error_message', 'template_id'];
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

// Bulk delete every document in ONE workflow status — used only by the
// admin "Delete All Review" / "Delete All Deferred" actions. Scoped strictly to
// the given status so it can never touch confirmed (or any other) documents;
// extractions/corrections are removed by their ON DELETE CASCADE. Callers are
// responsible for unlinking the source files first (see review/handler.js).
function deleteByStatus(db, status) {
  // templates.sample_document_id -> documents.id is ON DELETE NO ACTION, so any
  // template pinned to one of these docs (e.g. a confirmed sample later
  // reprocessed back to needs_review) would FK-block the whole DELETE — aborting
  // it atomically and leaving every row behind. Clear the dangling pin first,
  // in one transaction, mirroring templates.remove() nulling template_id.
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE templates SET sample_document_id = NULL
       WHERE sample_document_id IN (SELECT id FROM documents WHERE status = ?)`
    ).run(status);
    return db.prepare('DELETE FROM documents WHERE status = ?').run(status);
  });
  return tx();
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
  return db.prepare(`
    SELECT d.*, dt.name as type_name, dt.slug as type_slug
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

function confirm(db, id, { stored_filename, stored_path }) {
  return update(db, id, {
    status:       'confirmed',
    stored_filename,
    stored_path,
    confirmed_at: new Date().toISOString(),
  });
}

function deleteDoc(db, id) {
  // Same FK guard as deleteByStatus: a doc pinned as a template's sample
  // (sample_document_id, ON DELETE NO ACTION) can't be deleted until that
  // reference is cleared — otherwise single-delete of a pinned doc throws.
  const tx = db.transaction(() => {
    db.prepare('UPDATE templates SET sample_document_id = NULL WHERE sample_document_id = ?').run(id);
    return db.prepare('DELETE FROM documents WHERE id = ?').run(id);
  });
  return tx();
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

module.exports = {
  insert, update, getById, getWithExtractions,
  getReviewQueue, getDeferredQueue,
  getReviewCount, getDeferredCount,
  confirm, deleteDoc, deleteByStatus, search,
  resolveFilePath, filterExisting,
};
