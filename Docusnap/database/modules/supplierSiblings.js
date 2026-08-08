'use strict';
/**
 * database/modules/supplierSiblings.js — CORRECTION RIPPLE (identity text-first, slice 2).
 *
 * The Larkspur incident's second half: the owner imported 20 dockets from a never-enrolled
 * supplier, the logo layer misassigned 5, and correcting ONE did not heal the rest — nearest-
 * neighbour still favoured the bigger wrong pools (Ridgeway 3 prints, Copperfield 6, the
 * corrected supplier 1), and the confidence formula's match_count bonus actively rewards the
 * established WRONG pool. (Oracle finding: `_supplier_hint_upgrade` needs usage_count >= 3, so
 * the hint path can't heal a batch off one correction either — three confirms would be needed.
 * That is WHY this slice exists; don't "simplify" it away.)
 *
 * So healing must NOT go through the logo layer at all. When the operator resolves the issuer on
 * one document, we find its siblings BY TEXT — the same distinctive branding tokens on the page —
 * and offer to apply the same supplier and re-read them.
 *
 * PURE + read-only here; the caller applies the result through the existing supplier-PIN rail
 * (review-bound 'operator_pin', plants no learning, cleared on confirm), so a wrong ripple costs
 * one extra review click per document and can never file a wrong value.
 */
const { symmetricDistinctiveOverlap, distinctiveTokens } = require('./branding_fingerprint');

const RIPPLE_BAR = 0.80;   // the measured 0-cross-supplier-false-match overlap bar
const RIPPLE_CAP = 25;     // never offer an unbounded batch

/** The stored distinctive-token fingerprint for a document row, or [] when unavailable. */
function _docFingerprint(row) {
  if (!row) return [];
  if (row.keyword_fingerprint) {
    try {
      const fp = JSON.parse(row.keyword_fingerprint);
      if (Array.isArray(fp) && fp.length) return fp;
    } catch { /* fall through to the text fallback */ }
  }
  // Fallback for rows processed before fingerprints were stored: derive from the page text.
  if (row.ocr_text) return distinctiveTokens(String(row.ocr_text).split(/[^A-Za-z0-9]+/));
  return [];
}

/**
 * Documents that look like they came from the same sender as `docId`.
 * Candidates are UNFILED work only (needs_review | deferred), never already-pinned, never the
 * source doc, and never ones already carrying the target supplier. A document with no usable
 * fingerprint returns nothing rather than guessing (fail-safe).
 */
function findSiblings(db, docId, pinnedValue, opts = {}) {
  const bar = typeof opts.bar === 'number' ? opts.bar : RIPPLE_BAR;
  const cap = typeof opts.cap === 'number' ? opts.cap : RIPPLE_CAP;
  const src = db.prepare(
    'SELECT id, keyword_fingerprint, ocr_text FROM documents WHERE id = ?'
  ).get(Number(docId));
  const srcFp = _docFingerprint(src);
  if (!srcFp.length) return [];

  const target = String(pinnedValue || '').trim().toLowerCase();
  const rows = db.prepare(`
    SELECT id, original_filename, stored_filename, supplier_name, status,
           keyword_fingerprint, ocr_text
      FROM documents
     WHERE id != ?
       AND status IN ('needs_review','deferred')
       AND supplier_pin IS NULL
       AND (supplier_name IS NULL OR LOWER(TRIM(supplier_name)) != ?)
     ORDER BY id DESC`).all(Number(docId), target);

  const out = [];
  for (const r of rows) {
    const fp = _docFingerprint(r);
    if (!fp.length) continue;
    const { ratio, shared } = symmetricDistinctiveOverlap(srcFp, fp);
    if (ratio >= bar) {
      out.push({
        id: r.id,
        filename: r.stored_filename || r.original_filename || `Document #${r.id}`,
        current_supplier: r.supplier_name || null,
        status: r.status,
        ratio: Math.round(ratio * 100) / 100,
        shared,
      });
    }
    if (out.length >= cap) break;
  }
  return out;
}

module.exports = { findSiblings, RIPPLE_BAR, RIPPLE_CAP, _docFingerprint };
