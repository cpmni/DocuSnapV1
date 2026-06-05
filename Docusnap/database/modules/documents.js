'use strict';

function insert(db, { original_filename, folder_path, document_type_id,
                      supplier_name, overall_confidence, status }) {
  return db.prepare(`
    INSERT INTO documents
      (original_filename, folder_path, document_type_id,
       supplier_name, overall_confidence, status)
    VALUES
      (@original_filename, @folder_path, @document_type_id,
       @supplier_name, @overall_confidence, @status)
  `).run({ original_filename, folder_path, document_type_id: document_type_id || null,
           supplier_name: supplier_name || null,
           overall_confidence: overall_confidence || null,
           status: status || 'pending' });
}

function update(db, id, changes) {
  const allowed = ['document_type_id', 'stored_filename', 'stored_path',
                   'status', 'overall_confidence', 'supplier_name',
                   'doc_date', 'reference_number', 'confirmed_at',
                   'error_message'];
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
  return db.prepare('DELETE FROM documents WHERE id = ?').run(id);
}

function search(db, { company, reference, dateFrom, dateTo,
                      docType, status = 'confirmed', limit = 200 }) {
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
  if (dateFrom) {
    sql += ` AND d.doc_date >= @dateFrom`;
    params.dateFrom = dateFrom;
  }
  if (dateTo) {
    sql += ` AND d.doc_date <= @dateTo`;
    params.dateTo = dateTo;
  }
  if (docType && docType !== 'all') {
    sql += ` AND dt.slug = @docType`;
    params.docType = docType;
  }

  sql += ` ORDER BY d.confirmed_at DESC, d.processed_at DESC LIMIT @limit`;
  params.limit = limit;

  return db.prepare(sql).all(params);
}

module.exports = {
  insert, update, getById, getWithExtractions,
  getReviewQueue, getDeferredQueue,
  getReviewCount, getDeferredCount,
  confirm, deleteDoc, search,
};
