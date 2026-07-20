'use strict';

const path = require('path');

function insert(db, { original_filename, folder_path, document_type_id,
                      supplier_name, overall_confidence, status,
                      template_id, logo_phash, logo_detail_hash, keyword_fingerprint,
                      ocr_text, page_count, detected_type_name }) {
  return db.prepare(`
    INSERT INTO documents
      (original_filename, folder_path, document_type_id,
       supplier_name, overall_confidence, status,
       template_id, logo_phash, logo_detail_hash, keyword_fingerprint, ocr_text, page_count,
       detected_type_name)
    VALUES
      (@original_filename, @folder_path, @document_type_id,
       @supplier_name, @overall_confidence, @status,
       @template_id, @logo_phash, @logo_detail_hash, @keyword_fingerprint, @ocr_text, @page_count,
       @detected_type_name)
  `).run({
    original_filename, folder_path,
    document_type_id:    document_type_id    || null,
    supplier_name:       supplier_name       || null,
    overall_confidence:  overall_confidence  || null,
    status:              status              || 'pending',
    template_id:         template_id         || null,
    logo_phash:          logo_phash          || null,
    logo_detail_hash:    logo_detail_hash    || null,
    keyword_fingerprint: keyword_fingerprint || null,
    ocr_text:            ocr_text            || null,
    page_count:          page_count          || null,
    detected_type_name:  detected_type_name  || null,   // mig 51 — set ONLY when the detected type isn't installed
  });
}

function update(db, id, changes) {
  const allowed = ['document_type_id', 'stored_filename', 'stored_path',
                   'status', 'overall_confidence', 'supplier_name',
                   'doc_date', 'reference_number', 'confirmed_at',
                   'error_message', 'template_id', 'working_path',
                   'review_acknowledged_at', 'page_count', 'confirmed_by_username', 'supplier_pin',
                   // mig 51. This whitelist SILENTLY DROPS anything not listed, so a column added
                   // to insert() but not here writes once and can never be cleared again.
                   'detected_type_name'];
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

// The extracted total as a DISPLAY STRING ("£1,046.16"), or NULL when the doc has no total field
// (delivery notes, acknowledge-only routes, any type without a total). NULL-safe by design — the
// decision snapshot (Slice 2) must still record a row for a total-less doc. Uses the same total
// field keys as the search total-filter (search() below).
function getExtractedTotalDisplay(db, documentId) {
  const row = db.prepare(
    `SELECT COALESCE(display_value, raw_value) AS v FROM extractions
      WHERE document_id = ? AND field_key IN ('total_amount','total','grand_total')
        AND COALESCE(display_value, raw_value) IS NOT NULL
      ORDER BY confidence DESC LIMIT 1`
  ).get(documentId);
  return row ? (row.v ?? null) : null;
}

// The full trust context of the extracted total, from the SAME highest-confidence total row: its
// field_key, value (display), confidence, and validation_note. Used by Slice-3 amount routing, which
// must read the note + confidence BEFORE reviewService.confirm clears the note. NULL when the doc has
// no total field. (was_corrected-this-cycle is derived by the caller from the corrections payload, not
// the sticky row flag.)
function getExtractedTotalContext(db, documentId) {
  const row = db.prepare(
    `SELECT field_key, COALESCE(display_value, raw_value) AS value, confidence, validation_note
       FROM extractions
      WHERE document_id = ? AND field_key IN ('total_amount','total','grand_total')
        AND COALESCE(display_value, raw_value) IS NOT NULL
      ORDER BY confidence DESC LIMIT 1`
  ).get(documentId);
  if (!row) return null;
  return { fieldKey: row.field_key, value: row.value, confidence: row.confidence, note: row.validation_note };
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
  // Disambiguation picker: parse the stored candidates JSON (migration 48) back to an array so the
  // renderer consumes it directly. Malformed/NULL → undefined (renderer shows today's behaviour).
  for (const ex of doc.extractions) {
    if (ex.candidates) { try { ex.candidates = JSON.parse(ex.candidates); } catch { ex.candidates = undefined; } }
  }
  return doc;
}

// Distinct values previously CONFIRMED for the same field on the same document type —
// the source for the Review window's type-ahead suggestions. Scoped to the current
// document's type, excludes the document itself, capped. Read-only.
function getFieldValueSuggestions(db, documentId, fieldKey) {
  const docId = parseInt(documentId, 10);
  if (!docId || !fieldKey) return [];
  const rows = db.prepare(`
    SELECT DISTINCT COALESCE(NULLIF(TRIM(e.display_value), ''), e.raw_value) AS v
    FROM extractions e
    JOIN documents d ON d.id = e.document_id
    WHERE d.document_type_id = (SELECT document_type_id FROM documents WHERE id = @docId)
      AND e.field_key = @fieldKey
      AND d.status = 'confirmed'
      AND d.id != @docId
    ORDER BY v COLLATE NOCASE
    LIMIT 500
  `).all({ docId, fieldKey });
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const v = (r.v || '').trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;     // case-insensitive de-dup
    seen.add(k); out.push(v);
  }
  return out;
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
      ) AS below_threshold_count,
      -- missing_required_labels: the labels of the fields that BLOCK confirm and are
      -- still EMPTY — the assigned Date/Reference roles + any custom field flagged
      -- Required, EXCLUDING the identity (Document-Issuer is warn-only, not a hard
      -- block). Mirrors validateConfirm in review/renderer.js. Lets the queue colour a
      -- row that "looks good" (high confidence, no flags) but actually can't be filed
      -- because a required field read empty (unset roles are NULL and skipped). A field
      -- counts as filled if EITHER its display or raw value is non-empty.
      (SELECT GROUP_CONCAT(f.label, ', ')
         FROM fields f
        WHERE f.document_type_id = d.document_type_id
          AND (f.enabled IS NULL OR f.enabled = 1)
          AND ( f.key = dt.ref_field_key
                OR f.key = dt.date_field_key
                OR (f.required = 1 AND f.key NOT IN ('supplier_name','customer_name')) )
          AND NOT EXISTS (
                SELECT 1 FROM extractions e
                 WHERE e.document_id = d.id AND e.field_key = f.key
                   AND ( (e.display_value IS NOT NULL AND TRIM(e.display_value) <> '')
                      OR (e.raw_value     IS NOT NULL AND TRIM(e.raw_value)     <> '') ) )
      ) AS missing_required_labels
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

// Docs by id in the SAME shape as getReviewQueue (any non-deleted status) — used to re-surface
// the recently AUTO-FILED (confirmed) docs into the Review list so they can be checked/edited.
function getByIds(db, ids) {
  if (!Array.isArray(ids) || !ids.length) return [];
  const ph = ids.map(() => '?').join(',');
  return db.prepare(`
    SELECT d.*, dt.name as type_name, dt.slug as type_slug,
      (SELECT COUNT(*) FROM extractions e
         WHERE e.document_id = d.id
           AND ( (e.validation_note IS NOT NULL AND e.validation_note <> '')
              OR (e.corrected_to   IS NOT NULL AND e.corrected_to   <> '') )
      ) AS review_flag_count
    FROM documents d
    LEFT JOIN document_types dt ON dt.id = d.document_type_id
    WHERE d.id IN (${ph}) AND d.status != 'deleted'
    ORDER BY d.confirmed_at DESC, d.id DESC
  `).all(...ids);
}

// ── Recycle bin (soft delete) ────────────────────────────────────────────────
// Delete is recoverable: status→'deleted' + deleted_at; the file(s) are KEPT. Restore
// returns it to a sensible live status; purge (deleteDoc) is the permanent removal.
function softDelete(db, id) {
  return db.prepare(
    "UPDATE documents SET status = 'deleted', deleted_at = ? WHERE id = ?"
  ).run(new Date().toISOString(), id);
}
function restoreDeleted(db, id) {
  const doc = getById(db, id);
  if (!doc) return { changes: 0 };
  // A filed doc returns to 'confirmed'; anything else goes back to the review queue.
  const to = doc.confirmed_at ? 'confirmed' : 'needs_review';
  return db.prepare(
    "UPDATE documents SET status = ?, deleted_at = NULL WHERE id = ?"
  ).run(to, id);
}
function getDeletedQueue(db) {
  return db.prepare(`
    SELECT d.*, dt.name as type_name, dt.slug as type_slug
    FROM documents d
    LEFT JOIN document_types dt ON dt.id = d.document_type_id
    WHERE d.status = 'deleted'
    ORDER BY d.deleted_at DESC
  `).all();
}
function getDeletedCount(db) {
  return db.prepare("SELECT COUNT(*) as n FROM documents WHERE status = 'deleted'").get().n;
}

// ── Recovery: de-confirm a scope's documents ─────────────────────────────────
// A scoped, lighter mirror of resetToFreshInstall's document reset: move CONFIRMED docs
// for a (optional supplier, doc-type slug) scope back to needs_review so they stop feeding
// the CONFIRMED-only derived learning (getFieldFormats / getFieldValueHistory). Keeps
// supplier_name / document_type_id / working_path / extractions so a reprocess re-files
// correctly. Requires the doc-type SLUG (never scopes to "all types"). The heaviest
// recovery intensity — "start this type's learning over" — used only when the user opts in.
function requeueConfirmedDocsForScope(db, { supplier_name, document_type_slug } = {}) {
  if (!document_type_slug) return { changes: 0 };
  const sn = supplier_name || null;
  return db.prepare(`
    UPDATE documents
       SET status = 'needs_review', confirmed_at = NULL, confirmed_by_username = NULL
     WHERE status = 'confirmed'
       AND (@sn IS NULL OR supplier_name = @sn)
       AND document_type_id = (SELECT id FROM document_types WHERE slug = @slug)
  `).run({ sn, slug: document_type_slug });
}

// Send ONE confirmed document back to the review queue ("Send back to Review" in Learning
// Repair) so it stops feeding the confirmed-only derived learning and can be re-checked.
// KEEPS stored_filename/stored_path — their presence on a needs_review doc is the
// "previously filed" signal that lets reviewService re-file IN PLACE on re-confirm
// (no -DUPLICATE). Status-guarded: only a currently-confirmed doc moves.
function deconfirmDocument(db, id) {
  return db.prepare(
    "UPDATE documents SET status = 'needs_review', confirmed_at = NULL, confirmed_by_username = NULL WHERE id = ? AND status = 'confirmed'"
  ).run(id);
}

// List a scope's CONFIRMED documents (for the recovery preview / set-aside picker).
function getConfirmedDocsForScope(db, { supplier_name, document_type_slug } = {}) {
  if (!document_type_slug) return [];
  // Supplier is a forgiving CONTAINS filter (partial company name), NOT an exact match —
  // so "acme" finds "Acme Industrial Ltd" and near-duplicate/garbled variants too.
  const sn = (supplier_name && String(supplier_name).trim()) ? String(supplier_name).trim() : null;
  return db.prepare(`
    SELECT d.id, d.original_filename, d.supplier_name, d.doc_date, d.reference_number,
           d.confirmed_at, d.stored_filename, d.stored_path, d.folder_path, d.working_path
    FROM documents d
    WHERE d.status = 'confirmed'
      AND (@sn IS NULL OR d.supplier_name LIKE '%' || @sn || '%')
      AND d.document_type_id = (SELECT id FROM document_types WHERE slug = @slug)
    ORDER BY d.confirmed_at DESC
  `).all({ sn, slug: document_type_slug });
}

// Same column projection as getConfirmedDocsForScope, but for a specific id set — used by
// Learning Repair to union full-type-pool outliers into a supplier-filtered browse list.
function getConfirmedDocsByIds(db, ids) {
  const list = [...new Set((ids || []).map(Number).filter(Number.isFinite))];
  if (!list.length) return [];
  const ph = list.map(() => '?').join(',');
  return db.prepare(`
    SELECT d.id, d.original_filename, d.supplier_name, d.doc_date, d.reference_number,
           d.confirmed_at, d.stored_filename, d.stored_path, d.folder_path, d.working_path
    FROM documents d
    WHERE d.status = 'confirmed' AND d.id IN (${ph})
    ORDER BY d.confirmed_at DESC
  `).all(...list);
}

// Each field's CONFIRMED value for a doc, for the Learning Repair fields panel. A UNION so
// the panel never shows "nothing recorded" for a confirmed doc that clearly has values:
//   (1) the document's authoritative identity (company + the type's ref/date roles, from the
//       documents row — always present post-confirm) FIRST, so Supplier/Date/Reference lead;
//   (2) extraction rows (correction (latest) wins over the raw OCR read — shows confirmed
//       "152888", not a superseded misread "St");
//   (3) correction-only fields (a value learned at confirm with NO extraction row, e.g. a
//       supplier_name that was empty at extraction time).
// De-duped by field_key (first writer wins → identity is authoritative). Read-only.
function getConfirmedFieldValues(db, id) {
  const doc = db.prepare(`
    SELECT d.supplier_name, d.reference_number, d.doc_date,
           dt.ref_field_key, dt.date_field_key
    FROM documents d LEFT JOIN document_types dt ON dt.id = d.document_type_id
    WHERE d.id = ?`).get(id);
  const out = [];
  const seen = new Set();
  const push = (key, value) => {
    if (!key || value == null) return;
    const v = String(value).trim();
    if (!v || seen.has(key)) return;
    seen.add(key); out.push({ field_key: key, value: v });
  };
  if (doc) {
    push('supplier_name', doc.supplier_name);
    if (doc.date_field_key) push(doc.date_field_key, doc.doc_date);
    if (doc.ref_field_key)  push(doc.ref_field_key,  doc.reference_number);
  }
  const exRows = db.prepare(`
    SELECT e.field_key AS field_key,
           TRIM(COALESCE(
             (SELECT c.corrected_value FROM corrections c
                WHERE c.document_id = e.document_id AND c.field_key = e.field_key
                ORDER BY c.rowid DESC LIMIT 1),
             NULLIF(TRIM(e.display_value), ''),
             e.raw_value)) AS value
    FROM extractions e
    WHERE e.document_id = ?
    ORDER BY e.rowid
  `).all(id);
  for (const r of exRows) push(r.field_key, r.value);
  const corrRows = db.prepare(
    'SELECT field_key, corrected_value FROM corrections WHERE document_id = ? ORDER BY rowid'
  ).all(id);
  for (const r of corrRows) push(r.field_key, r.corrected_value);
  return out;
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

// Real "documents filed" totals for the dashboard pulse — counted in SQL (not derived
// from the capped search list), so they reflect the true volume up to 999+. confirmed_at
// is ISO-8601 UTC, which compares lexicographically = chronologically; the index
// idx_documents_status_conf keeps this cheap as the corpus grows.
function getFiledCounts(db) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const weekAgo      = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const stmt = db.prepare(
    "SELECT COUNT(*) as n FROM documents WHERE status = 'confirmed' AND confirmed_at >= ?"
  );
  return { today: stmt.get(startOfToday).n, week: stmt.get(weekAgo).n, month: stmt.get(startOfMonth).n };
}

// "Stuck" documents — extraction failed, so they hold at status='error'. These
// are the records behind the launchpad "couldn't be read" surface + reprocess.
function getStuckCount(db) {
  return db.prepare(
    "SELECT COUNT(*) as n FROM documents WHERE status = 'error'"
  ).get().n;
}

function getStuckQueue(db) {
  return db.prepare(`
    SELECT id, original_filename, folder_path, working_path, error_message, processed_at
    FROM documents
    WHERE status = 'error'
    ORDER BY processed_at DESC
  `).all();
}

function confirm(db, id, { stored_filename, stored_path, confirmed_by_username = null }) {
  return update(db, id, {
    status:       'confirmed',
    stored_filename,
    stored_path,
    confirmed_at: new Date().toISOString(),
    confirmed_by_username,
    supplier_pin: null,   // clear the operator "Resolve" pin — the name is now learned; a stale pin must not override later
  });
}

// ── Atomic, status-guarded transitions (multi-user concurrency guard) ──────────
// A plain confirm()/update() is an unconditional UPDATE, so two callers (two clients,
// a client vs the desktop, or the auto-file vs a manual confirm) can both "win" and
// double-file. These compare-and-set helpers only mutate when the row is STILL in a
// reviewable state, returning better-sqlite3's `info` so the caller can detect a lost
// race (`changes === 0`) and respond cleanly ("already filed by <name>"). Atomic because
// better-sqlite3 is synchronous and the API + IPC share one event loop — no await between
// the WHERE test and the write, so no second writer can interleave.

// Claim a document as confirmed ONLY if it is still reviewable (needs_review/deferred), or
// — for the desktop re-file path — already confirmed when allowRefile is set. stored_* may
// be null when claiming BEFORE filing (the caller fills them in via update() afterwards).
function confirmIfReviewable(db, id, { stored_filename = null, stored_path = null,
                                       confirmed_by_username = null, allowRefile = false } = {}) {
  return db.prepare(`
    UPDATE documents
       SET status                = 'confirmed',
           confirmed_at          = @confirmed_at,
           confirmed_by_username = @confirmed_by_username,
           stored_filename       = @stored_filename,
           stored_path           = @stored_path,
           supplier_pin          = NULL
     WHERE id = @id
       AND ( status IN ('needs_review','deferred')
          OR (status = 'confirmed' AND @allowRefile = 1) )
  `).run({
    id,
    stored_filename, stored_path, confirmed_by_username,
    confirmed_at: new Date().toISOString(),
    allowRefile: allowRefile ? 1 : 0,
  });
}

// Move a document to deferred ONLY if it is currently needs_review.
function deferIfReviewable(db, id) {
  return db.prepare(
    `UPDATE documents SET status = 'deferred' WHERE id = ? AND status = 'needs_review'`
  ).run(id);
}

// Restore a deferred document to the review queue ONLY if it is currently deferred.
function restoreIfDeferred(db, id) {
  return db.prepare(
    `UPDATE documents SET status = 'needs_review' WHERE id = ? AND status = 'deferred'`
  ).run(id);
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
                      docType, status = 'confirmed', fullText, total, totalOp, limit = 200 }) {
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
    // "Full text" searches ALL of a document's data — the OCR page text, the core identity
    // columns, AND every extracted/corrected field value (amounts, dates, codes, names…) —
    // so a value is found wherever it lives, of ANY type, not only in the OCR layer (which
    // can be empty). Thousands separators are stripped from BOTH sides so "1137" finds
    // "1,137" and "1,137" finds "1137". Case-insensitive (SQLite LIKE on ASCII). The
    // EXISTS subqueries key on document_id (indexed) so this stays cheap.
    sql += ` AND (
      REPLACE(COALESCE(d.ocr_text,''), ',', '')           LIKE @fullText
      OR REPLACE(COALESCE(d.supplier_name,''), ',', '')   LIKE @fullText
      OR REPLACE(COALESCE(d.reference_number,''), ',', '') LIKE @fullText
      OR REPLACE(COALESCE(d.doc_date,''), ',', '')        LIKE @fullText
      OR EXISTS (SELECT 1 FROM extractions e WHERE e.document_id = d.id
                 AND REPLACE(COALESCE(e.display_value, e.raw_value, ''), ',', '') LIKE @fullText)
      OR EXISTS (SELECT 1 FROM corrections c WHERE c.document_id = d.id
                 AND REPLACE(COALESCE(c.corrected_value,''), ',', '') LIKE @fullText)
    )`;
    params.fullText = `%${fullText.trim().replace(/,/g, '')}%`;
  }
  // TOTAL amount filter — Equals / Above / Below a value. The total lives in extractions (the
  // currency total field), stored as a display string ("£1,046.16"), so parse it numerically in
  // SQL (strip currency symbols / commas / spaces → CAST AS REAL) and compare against the common
  // total field keys. Equals uses a small tolerance (float compare); a non-numeric/empty value is
  // excluded by the digit guard.
  const _total = (total === 0 || total) ? parseFloat(String(total).replace(/[^0-9.\-]/g, '')) : NaN;
  if (!isNaN(_total)) {
    const op  = totalOp === 'gt' ? '>' : totalOp === 'lt' ? '<' : '=';
    const CLEAN = "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(e.display_value, e.raw_value, ''),',',''),'£',''),'$',''),'€',''),' ','')";
    const NUM = `CAST(${CLEAN} AS REAL)`;
    const cmp = op === '=' ? `ABS(${NUM} - @total) < 0.005` : `${NUM} ${op} @total`;
    sql += ` AND EXISTS (SELECT 1 FROM extractions e WHERE e.document_id = d.id
      AND e.field_key IN ('total_amount','total','grand_total')
      AND ${CLEAN} GLOB '*[0-9]*' AND ${cmp})`;
    params.total = _total;
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
  insert, update, getById, getExtractedTotalDisplay, getExtractedTotalContext, getWithExtractions,
  getReviewQueue, getDeferredQueue, getByIds,
  getReviewCount, getDeferredCount, getStuckCount, getStuckQueue, getFiledCounts,
  softDelete, restoreDeleted, getDeletedQueue, getDeletedCount,
  requeueConfirmedDocsForScope, getConfirmedDocsForScope, getConfirmedDocsByIds, getConfirmedFieldValues, deconfirmDocument,
  getFieldValueSuggestions,
  confirm, confirmIfReviewable, deferIfReviewable, restoreIfDeferred,
  deleteDoc, deleteByStatus, search,
  resolveFilePath, filterExisting, getWorkingPaths,
};
