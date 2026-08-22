'use strict';
/**
 * database/modules/typeSplit.js — the TYPE-SPLIT ask (A3 of the type-split arc, 2026-08-22; gary →
 * Oracle SIGN-OFF-W/COND S2-js-a).
 *
 * THE INCIDENT: the owner confirmed ONE Nordwind quote as a Purchase Order (type left/picked wrong);
 * that confirm bore a purchase_order template on the quote-only letterhead and every later Nordwind
 * quote was held with "this letterhead is used for several document types". A typo-class mistake
 * with a 17-document blast radius, caught at source by ONE question.
 *
 * PURE PREDICATE: does confirming `document_type_slug` for `supplier_name` SPLIT an issuer whose
 * confirmed history is 100 % ONE other type? Fires only when the issuer (normalised name) has at least
 * `minConfirms` confirmed documents (any via — a machine-confirmed history is still history) AND every
 * one of them is the same type T AND T ≠ the slug being confirmed. Once the first genuine second type
 * is confirmed (acknowledged), the history is no longer 100 % one type and the ask never fires again
 * for that issuer — one question per sender-type split, by construction.
 *
 * Read-only; never throws past the caller's try (a broken lookup must fail OPEN — the gate is
 * advisory, its worst case is one click). Pinned in test_type_split_gate.js.
 */

function checkTypeSplit(db, supplierName, documentTypeSlug, opts = {}) {
  const minConfirms = Number.isFinite(opts.minConfirms) ? opts.minConfirms : 3;
  const sup = String(supplierName || '').trim();
  const slug = String(documentTypeSlug || '').trim();
  if (!sup || !slug) return { split: false, reason: 'no-input' };
  const rows = db.prepare(`
    SELECT dt.slug AS slug, dt.name AS name, COUNT(*) AS n
      FROM documents d JOIN document_types dt ON dt.id = d.document_type_id
     WHERE d.status = 'confirmed' AND LOWER(TRIM(d.supplier_name)) = LOWER(?)
     GROUP BY dt.slug, dt.name`).all(sup);
  const total = rows.reduce((a, r) => a + (r.n || 0), 0);
  if (total < minConfirms) return { split: false, reason: 'thin', count: total };
  if (rows.length !== 1) return { split: false, reason: 'mixed', count: total };
  const only = rows[0];
  if (String(only.slug || '').toLowerCase() === slug.toLowerCase()) return { split: false, reason: 'same', count: total };
  let typedName = null;
  try { typedName = (db.prepare('SELECT name FROM document_types WHERE slug = ?').get(slug) || {}).name || null; } catch { /* advisory */ }
  return {
    split: true,
    supplier: sup,
    established_slug: only.slug, established_name: only.name, count: only.n,
    typed_slug: slug, typed_name: typedName,
    message: `${sup} files as ${only.name} (${only.n} so far). File this one as ${typedName || slug}?`,
  };
}

module.exports = { checkTypeSplit };
