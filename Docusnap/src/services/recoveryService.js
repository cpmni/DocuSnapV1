'use strict';

/**
 * services/recoveryService.js
 * ---------------------------
 * "Fix a document type" — compose the existing scope-reset primitives into a single,
 * safe recovery operation for a (document type, optional supplier) scope. Transport-
 * agnostic (DB handle injected); the IPC edge owns the admin gate, the .bak safety
 * snapshot, and the audit entry.
 *
 * The important design fact: the format/value model is DERIVED LIVE from CONFIRMED
 * documents, so clearing the learning tables alone doesn't un-poison — it re-derives
 * from the still-confirmed docs. The complete fix SETS ASIDE the offending documents
 * (documents.softDelete → recycle bin, reversible) so they stop feeding the model, and
 * optionally FORGETS the scope's active learning artifacts (which re-learn from the
 * remaining good docs). logo_fingerprints is NEVER touched here — it is supplier-scoped
 * and shared across that supplier's other types.
 */

function createRecoveryService(deps = {}) {
  const documents = deps.documents || require('../../database/modules/documents');
  const learning  = deps.learning  || require('../../database/modules/learning');

  const _count = (db, table, sn, dt) => db.prepare(
    `SELECT COUNT(*) AS n FROM ${table} WHERE (@sn IS NULL OR supplier_name = @sn) AND (@dt IS NULL OR document_type = @dt)`
  ).get({ sn: sn || null, dt: dt || null }).n;

  // Light, READ-ONLY diagnosis: confirmed docs in THIS scope whose reference number or
  // filename ALSO appears under a DIFFERENT document type — the classic "same document
  // filed under two types" poison. Returned as SUGGESTIONS to highlight, never auto-ticked.
  function _crossTypeSuspects(db, sn, dt) {
    try {
      return db.prepare(`
        SELECT DISTINCT d.id
        FROM documents d
        JOIN document_types t ON t.id = d.document_type_id AND t.slug = @dt
        JOIN documents o ON o.status = 'confirmed' AND o.id <> d.id
             AND o.document_type_id <> d.document_type_id
             AND ( (d.reference_number IS NOT NULL AND TRIM(d.reference_number) <> '' AND o.reference_number = d.reference_number)
                OR (o.original_filename = d.original_filename) )
        WHERE d.status = 'confirmed' AND (@sn IS NULL OR d.supplier_name = @sn)
      `).all({ sn: sn || null, dt }).map(r => r.id);
    } catch { return []; }
  }

  // Read-only summary for the wizard preview.
  function overview(db, { document_type_slug, supplier_name } = {}) {
    if (!document_type_slug) return { error: 'A document type is required.' };
    const sn = supplier_name || null, dt = document_type_slug;
    const docs = documents.getConfirmedDocsForScope(db, { supplier_name: sn, document_type_slug: dt });
    const suggestedIds = _crossTypeSuspects(db, sn, dt);
    return {
      scope: { document_type_slug: dt, supplier_name: sn },
      learned: {
        anchors:     _count(db, 'field_anchors', sn, dt),
        hints:       _count(db, 'supplier_hints', sn, dt),
        corrections: _count(db, 'corrections', sn, dt),
        fieldRules:  _count(db, 'field_rules', sn, dt),
      },
      confirmedCount: docs.length,
      documents: docs,
      // Read-only suggestions to HIGHLIGHT (never pre-tick / auto-run): docs that also
      // appear under another type — the likely "filed under the wrong type" culprits.
      suggestedIds,
    };
  }

  // Apply a recovery. ONE transaction. `documentIds` = docs to set aside (reversible).
  // `forgetLearning` = clear the scope's anchors/hints/field_rules (and corrections ONLY
  // when the derived model is also addressed). `requeue` = the heavy "start this type over"
  // (de-confirm the scope's docs). Never touches logo_fingerprints or templates.
  function apply(db, actor, payload = {}) {
    const { document_type_slug, supplier_name, documentIds, forgetLearning, requeue } = payload;
    if (!document_type_slug) return { ok: false, error: 'A document type is required.' };
    const sn = supplier_name || null, dt = document_type_slug;
    const ids = (Array.isArray(documentIds) ? documentIds : []).map(n => parseInt(n, 10)).filter(Number.isInteger);
    if (!ids.length && !forgetLearning && !requeue) return { ok: false, error: 'Nothing selected to recover.' };

    const scope = { supplier_name: sn, document_type: dt };
    const summary = { setAside: 0, anchors: 0, hints: 0, fieldRules: 0, corrections: 0, requeued: 0 };

    db.transaction(() => {
      // 1) Set aside the offending documents (recycle bin — reversible; stops them feeding the derived model).
      for (const id of ids) summary.setAside += (documents.softDelete(db, id).changes || 0);

      // 2) Forget the scope's active learning artifacts (they re-learn from the remaining good docs).
      if (forgetLearning) {
        summary.anchors    = learning.clearFieldAnchorsForScope(db, scope).changes || 0;
        summary.hints      = learning.clearSupplierHintsForScope(db, scope).changes || 0;
        summary.fieldRules = learning.clearFieldRulesForScope(db, scope).changes || 0;
        // Corrections are cleared ONLY alongside a document set-aside / requeue — clearing them
        // on their own would regress getFieldFormats to the raw mis-read for the still-confirmed docs.
        if (ids.length || requeue) summary.corrections = learning.clearCorrectionsForScope(db, scope).changes || 0;
      }

      // 3) Advanced: de-confirm the whole scope ("start this type's learning over").
      if (requeue) summary.requeued = documents.requeueConfirmedDocsForScope(db, { supplier_name: sn, document_type_slug: dt }).changes || 0;
    })();

    return { ok: true, summary, setAsideIds: ids };
  }

  return { overview, apply };
}

module.exports = { createRecoveryService };
