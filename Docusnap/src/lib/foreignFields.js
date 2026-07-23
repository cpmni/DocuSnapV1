'use strict';

/*
 * foreignFields — type-scoped extraction hygiene (P2, 2026-07-22).
 *
 * Extraction runs against the UNION of every installed type's field keys (load-bearing for the
 * "add a document type later without re-reading" flow), so a DELIVERY docket's bare `Date:` caption
 * is grabbed by invoice_date / order_date / po_date too (they all list a bare "Date" label) and
 * STORED — a delivery note ends up carrying four date fields, all the same value. That junk is
 * inert for filing but clutters Learning Repair and pollutes getFieldFormats; it is also a latent
 * trap for a future po_date-corroboration feature.
 *
 * FIX (Oracle SIGN-OFF-WITH-CONDITIONS 2026-07-22): drop the FOREIGN extraction rows — the ones
 * whose field_key does not belong to the document's ASSIGNED type — at the two CONFIRM transitions
 * (reviewService.confirm + processing/handler._autoFileDoc), each placed AFTER that path's filing /
 * auto-file-eligibility decision has already run. Ordering is load-bearing: at gate time the foreign
 * rows still exist, so a garbled foreign field still HOLDS a doc for review exactly as today — the
 * drop can NEVER open the auto-file gate. (This is why we do NOT drop at import.)
 *
 * The keep-predicate is the SAME one review/handler._buildTemplateFields uses (its `ownField`,
 * review/handler.js:1209-1210) — shared here so the drop sites and the template builder can't drift.
 * Fail-OPEN: a type with no field metadata keeps every row (never blank a doc on a metadata gap).
 *
 * Kill switch: env FOREIGN_FIELD_DROP=0 restores the legacy keep-all (OFF => byte-identical).
 */

const { COMPANY_KEYS } = require('../../database/modules/document_types');

// OFF => byte-identical. Read at call time so a test can toggle it per-case.
function foreignFieldDropEnabled() {
  return process.env.FOREIGN_FIELD_DROP !== '0';
}

// Keep-predicate: (field_key) => boolean. Keep iff the key belongs to the doc's OWN type — a defined
// field, the identity/company key (supplier_name), or the type's ref/date structural role. Fail-OPEN
// (keep all) when the type carries no field metadata. Verbatim mirror of review/handler.js:1209-1210.
function ownFieldPredicate(dtInfo) {
  const companyKeys = COMPANY_KEYS || ['supplier_name'];
  const fieldMeta   = new Map(((dtInfo && dtInfo.fields) || []).map(f => [f.key, f]));
  const roleKeys    = new Set([...companyKeys, dtInfo && dtInfo.ref_field_key, dtInfo && dtInfo.date_field_key].filter(Boolean));
  return (key) => fieldMeta.size === 0 || fieldMeta.has(key) || roleKeys.has(key);
}

// Delete stored extraction rows whose field_key is FOREIGN to the doc's assigned type. No-op when
// the kill switch is off, when dtInfo has no field metadata (fail-open), or when nothing is foreign.
// Returns the count of rows deleted. The CALLER must already have made its filing / auto-file decision
// before invoking this (ordering is load-bearing — see the module header).
function dropForeignExtractions(db, documentId, dtInfo) {
  if (!foreignFieldDropEnabled()) return 0;
  const fields = (dtInfo && Array.isArray(dtInfo.fields)) ? dtInfo.fields : [];
  if (fields.length === 0) return 0;                 // fail-open: no metadata => keep every row
  const keep = ownFieldPredicate(dtInfo);
  const rows = db.prepare('SELECT DISTINCT field_key FROM extractions WHERE document_id = ?').all(documentId);
  const foreign = rows.map(r => r.field_key).filter(k => !keep(k));
  if (foreign.length === 0) return 0;
  const del = db.prepare('DELETE FROM extractions WHERE document_id = ? AND field_key = ?');
  let n = 0;
  for (const k of foreign) n += del.run(documentId, k).changes;
  return n;
}

// Filter the CONFIRM LEARNING INPUT (allValues + corrections) by the same keep-predicate — the
// PLANT-side twin of dropForeignExtractions (Oracle C7 of the un-plant sign-off, 2026-07-23).
// dropForeignExtractions runs AFTER learning.saveCorrections in reviewService.confirm, so a
// bulk / /v1 payload carrying foreign keys planted hints/corrections the row-drop then orphaned
// — residue the send-back retract can never see (no extraction row remains to mirror). Filtering
// the LEARNING input closes the plant; the row-drop's load-bearing ordering (after the filing /
// auto-file decision) is untouched because learning input feeds no gate. Same switch, same
// fail-open (no field metadata ⇒ passthrough); pure — returns new objects, never mutates.
function filterLearningInput(allValues, corrections, dtInfo) {
  if (!foreignFieldDropEnabled()) return { allValues, corrections };
  const fields = (dtInfo && Array.isArray(dtInfo.fields)) ? dtInfo.fields : [];
  if (fields.length === 0) return { allValues, corrections };
  const keep = ownFieldPredicate(dtInfo);
  const filt = (o) => {
    if (!o || typeof o !== 'object') return o;
    const out = {};
    for (const [k, v] of Object.entries(o)) { if (keep(k)) out[k] = v; }
    return out;
  };
  return { allValues: filt(allValues), corrections: filt(corrections) };
}

module.exports = { foreignFieldDropEnabled, ownFieldPredicate, dropForeignExtractions, filterLearningInput };
