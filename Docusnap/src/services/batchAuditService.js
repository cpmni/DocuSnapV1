'use strict';

/**
 * batchAuditService — the "Quick check" batch-audit grid for AUTO-FILED documents.
 *
 * WHY (owner request 2026-08-24): auto-filed docs flip to status='confirmed' and LEAVE the Review
 * queue, so their detected values are never seen by a human. This surface lays a filed BATCH out as a
 * grid (values left, preview right), lets the operator correct any wrong reads, and — crucially —
 * makes the correction reach LEARNING (non-cosmetic) so future detection stops using the wrong value.
 *
 * ARCHITECTURE (bob/gary/eric consensus, Oracle SIGN-OFF-W/COND 2026-08-24): a THIN orchestrator over
 * the EXISTING reviewService.confirm(allowRefile) — the one write path that re-files a confirmed doc
 * AND feeds the live-derived learning corpus. No new confirm variant, no new filing/learning logic.
 * The owner's "reach learning history" requirement is met at the mechanism: the re-file keeps the
 * machine confirmed_via, and machine rows are excluded from learning by default, BUT the C2 carve-out
 * (learning.js `isMachine = excludeMachine && machineVias.has(via) && corrected_value == null`)
 * INCLUDES a row once saveCorrections writes a corrections row — so a correction reaches
 * format/dominance/prefix/hints WITHOUT entering the graduation window (verified; PIN A).
 *
 * ORACLE CONDITIONS enforced HERE (the isRefile path bypasses every confirm safety gate, so the
 * orchestrator re-adds the checkpoint at its own edge):
 *   C1  document_type edits are REFUSED (route to full Review) — bulk:true would suppress the
 *       type-split ask. Issuer (supplier_name) edits are REFUSED too — the near-duplicate-company /
 *       split-identity risk. v1 grid edits VALUE/body/ref/date fields only.
 *   C2  value-only corrections PRESERVE the field's learned anchor (preserveAnchors → reviewService
 *       internal arg → saveCorrections opts) — the read was wrong, not the position. Killable.
 *   C3  edge field-validation REFUSES an invalid date inline (a DD-MM-YYYY that does not parse) — a
 *       held/unfiled field the operator is told about beats a silently re-filed wrong one.
 *   C4  per-doc failures SURFACE with a reason (never silent-skip): unknown-event, not-in-batch,
 *       not-confirmed, route-to-review, invalid-value, no-source-file, confirm-failed.
 *   C6  scope is status='confirmed' ∩ the event's ids only (a put-back doc is needs_review → excluded).
 *
 * Deps are injected so the whole thing is hermetically testable (stub reviewService.confirm etc.).
 */

// Reuse the confirm return contract: { ok:true, success:true, ...filingResult } / { ok:false, error, code }.

function _norm(v) { return String(v == null ? '' : v).trim(); }

// Edge validation (Oracle C3). Dates are the meaningful, checkable format gate (the whole date-read
// arc); a human-typed ref carries no universal server-side format and confirm's prefix-outlier gate
// already exempts human-typed values, so refs are accepted unless empty in a structural role. An empty
// value in the date/ref STRUCTURAL role is refused (a re-file must not blank the filename's key parts).
function validateEdit(fieldKey, fieldType, value, dtInfo, valPatterns, normaliseDate) {
  const trimmed = _norm(value);
  const isDate = fieldType === 'date' || (dtInfo && fieldKey === dtInfo.date_field_key);
  const isRef  = dtInfo && fieldKey === dtInfo.ref_field_key;
  if (!trimmed) {
    if (isDate || isRef) return { ok: false, reason: 'empty' };
    return { ok: true };  // clearing a non-structural field is allowed
  }
  if (isDate) {
    // Gate on the EXACT parser the folder builder uses (filing.normaliseDate) when it is injected, NOT
    // the loose validation_patterns substring test — the loose test passes a clipped "15/12/202" (year
    // \d{2,4}) which then re-files to Company/Unknown Year/Unknown Month (Oracle 2026-08-25: this edge
    // shared the same fig leaf as the confirm gate). Fall back to the pattern test only when no
    // normaliser is supplied (keeps the standalone export usable).
    if (typeof normaliseDate === 'function') {
      if (normaliseDate(trimmed) === null) return { ok: false, reason: 'invalid-date' };
    } else {
      const pats = (valPatterns && valPatterns.date) || [];
      if (pats.length) {
        const hit = pats.some(p => { try { return new RegExp(p, 'i').test(trimmed); } catch { return false; } });
        if (!hit) return { ok: false, reason: 'invalid-date' };
      }
    }
  }
  return { ok: true };
}

/**
 * createBatchAuditService(deps) →
 *   buildGrid(db, { eventId })                     → { ok, event, rows } | { ok:false, reason }
 *   confirmBatch(db, actor, { eventId, edits })    → { ok, results[], filed }
 *
 * deps: { reviewService, documents, doctypes, getEvent, valPatterns, preserveAnchors }
 *   getEvent(db, id)  → the reviewEvents ledger event (the AUTHORITATIVE id set — never trust the
 *                       renderer's list; honor the C5 "re-derive against live rows" rule).
 *   valPatterns()     → the raw validation_patterns map (the SAME source get-validation-patterns uses).
 *   preserveAnchors() → boolean (the BATCH_AUDIT_PRESERVE_ANCHORS kill switch).
 */
function createBatchAuditService(deps) {
  const { reviewService, documents, doctypes, getEvent } = deps;
  const valPatterns = typeof deps.valPatterns === 'function' ? deps.valPatterns : () => (deps.valPatterns || {});
  const preserveAnchors = typeof deps.preserveAnchors === 'function' ? deps.preserveAnchors : () => !!deps.preserveAnchors;
  // The canonical date parser the folder builder uses — injected so validateEdit gates on the SAME
  // predicate as filing/reviewService (no fig-leaf loose pattern). Null → validateEdit falls back.
  const normaliseDate = typeof deps.normaliseDate === 'function' ? deps.normaliseDate : null;

  // The two field keys the grid must NEVER re-file in place (route to full Review instead).
  const ROUTED_KEYS = new Set(['supplier_name', 'document_type', 'document_type_slug']);

  function _resolveDtInfo(db, doc) {
    let slug = doc.type_slug || null;
    // getWithExtractions (→ documents.getById, SELECT *) does NOT join document_types, so the real-DB
    // row carries no type_slug — resolve it from document_type_id or the re-file loses the doc's real
    // type and reviewService.confirm's filename builder falls back to the literal "Document" (Chris
    // 2026-08-25 Card 3: a corrected Invoice re-filed as "Document.<date>.<ref>.pdf"). The grid read
    // (buildGrid → documents.getByIds) already carries type_slug; this makes the WRITE path agree.
    if (!slug && doc.document_type_id != null && doctypes && typeof doctypes.getAll === 'function') {
      try {
        const t = (doctypes.getAll(db) || []).find(x => x && x.id === doc.document_type_id);
        if (t) slug = t.slug || null;
      } catch { /* leave slug null → dtInfo null (unchanged legacy behaviour) */ }
    }
    if (!slug) return { slug: null, dtInfo: null };
    let dtInfo = null;
    try { dtInfo = doctypes.getWithFields(db, slug); } catch { dtInfo = null; }
    return { slug, dtInfo };
  }

  // PROJECTED read — no stored_path/folder_path/working_path/ocr_text ever crosses to the renderer
  // (Oracle C5). Preview is fetched separately via get-document-pages, which resolves stored_path
  // server-side from the row (the grid supplies no path).
  function buildGrid(db, { eventId } = {}) {
    const ev = getEvent(db, eventId);
    if (!ev) return { ok: false, reason: 'unknown-event', rows: [] };
    const ids = (ev.ids || []).map(Number).filter(Boolean);
    const evMeta = { id: ev.id, kind: ev.kind, at: ev.at, count: ids.length };
    if (!ids.length) return { ok: true, event: evMeta, rows: [] };

    const ph = ids.map(() => '?').join(',');
    const exRows = db.prepare(
      `SELECT document_id, field_key, display_value, confidence, extraction_method, was_corrected, validation_note
         FROM extractions WHERE document_id IN (${ph})`
    ).all(...ids);
    const byDoc = {};
    for (const e of exRows) (byDoc[e.document_id] || (byDoc[e.document_id] = [])).push(e);

    const docs = documents.getByIds(db, ids);   // returns d.* — PROJECT below, never return raw
    const rows = docs
      .filter(d => d.status === 'confirmed')     // C6: a put-back doc is needs_review → excluded
      .map(d => ({
        id: d.id,
        filename: d.original_filename || null,
        supplier_name: d.supplier_name || null,   // display only; issuer edits routed to Review
        type_slug: d.type_slug || null,
        type_name: d.type_name || null,
        reference_number: d.reference_number || null,
        doc_date: d.doc_date || null,
        overall_confidence: d.overall_confidence,
        fields: (byDoc[d.id] || []).map(e => ({
          key: e.field_key,
          value: e.display_value,
          confidence: e.confidence,
          method: e.extraction_method,
          corrected: !!e.was_corrected,
          note: e.validation_note || null,
        })),
      }));
    return { ok: true, event: evMeta, rows };
  }

  async function confirmBatch(db, actor, { eventId, edits } = {}) {
    const ev = getEvent(db, eventId);
    if (!ev) return { ok: false, reason: 'unknown-event', results: [], filed: 0 };
    const evIds = new Set((ev.ids || []).map(Number).filter(Boolean));
    const list = Array.isArray(edits) ? edits : [];
    const results = [];
    const _preserve = !!preserveAnchors();
    const _pats = valPatterns() || {};

    for (const edit of list) {
      const docId = Number(edit && edit.docId);
      const r = { docId, ok: false };
      if (!docId || !evIds.has(docId)) { r.reason = 'not-in-batch'; results.push(r); continue; }   // C5

      const doc = documents.getWithExtractions(db, docId);
      if (!doc) { r.reason = 'not-found'; results.push(r); continue; }
      if (doc.status !== 'confirmed') { r.reason = 'not-confirmed'; results.push(r); continue; }   // C6

      const { slug, dtInfo } = _resolveDtInfo(db, doc);

      const cur = {};
      for (const ex of (doc.extractions || [])) cur[ex.field_key] = ex.display_value;

      const fields = (edit && edit.fields) || {};
      let routed = null;
      const changed = {};
      for (const [k, v] of Object.entries(fields)) {
        if (ROUTED_KEYS.has(k)) { routed = k; break; }              // C1: issuer/type → full Review
        const nv = _norm(v);
        const ov = _norm(cur[k]);
        if (nv !== ov) changed[k] = { original_value: cur[k] == null ? null : cur[k], corrected_value: nv };
      }
      if (routed) { r.reason = 'route-to-review'; r.field = routed; results.push(r); continue; }

      const keys = Object.keys(changed);
      if (!keys.length) { r.ok = true; r.reason = 'no-change'; results.push(r); continue; }

      // C3: edge validation — refuse an invalid value BEFORE any re-file.
      let bad = null;
      for (const k of keys) {
        const fdef = dtInfo && Array.isArray(dtInfo.fields) ? dtInfo.fields.find(f => f.key === k) : null;
        const vr = validateEdit(k, fdef && fdef.type, changed[k].corrected_value, dtInfo, _pats, normaliseDate);
        if (!vr.ok) { bad = { field: k, reason: vr.reason }; break; }
      }
      if (bad) { r.reason = 'invalid-value'; r.field = bad.field; r.detail = bad.reason; results.push(r); continue; }

      // allValues = the FULL current field map with the edits applied (filename builder needs it).
      const allValues = Object.assign({}, cur);
      for (const k of keys) allValues[k] = changed[k].corrected_value;
      allValues.supplier_name = doc.supplier_name;   // issuer unchanged (edits to it are routed above)

      try {
        const cr = await reviewService.confirm(db, actor, {
          document_id: docId,
          corrections: changed,
          allValues,
          supplier_name: doc.supplier_name,
          document_type_slug: slug,
          allowRefile: true,
          bulk: true,
        }, { preserveAnchors: _preserve });
        if (cr && cr.ok) {
          r.ok = true;
          r.filed = cr.filename || (cr.filePath ? String(cr.filePath).split(/[\\/]/).pop() : null);
          r.fieldsChanged = keys;
        } else {
          r.reason = (cr && (cr.code || cr.error)) || 'confirm-failed';
          if (cr && cr.code) r.code = cr.code;
        }
      } catch (e) { r.reason = 'error'; r.detail = (e && e.message) || String(e); }
      results.push(r);
    }

    const filed = results.filter(x => x.ok && x.reason !== 'no-change').length;
    return { ok: true, results, filed };
  }

  return { buildGrid, confirmBatch, validateEdit };
}

module.exports = { createBatchAuditService, validateEdit };
