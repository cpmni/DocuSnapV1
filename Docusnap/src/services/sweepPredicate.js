'use strict';

/**
 * src/services/sweepPredicate.js
 * ------------------------------
 * Catch-up Filing slice 2 — the PURE Tier-2 consistency predicate
 * (docs/designs/CATCHUP_FILING_2026-07-31.md; barry→gary→Oracle W/COND).
 *
 * A queue doc holds correct values on STALE scores. The sweep re-extracts it imagelessly
 * against the now-warmer learning and asks: did the warmer system leave the answer the
 * operator can SEE unchanged, and do the normal trust gates pass NOW? This module decides
 * the "answer unchanged" half on plain data (no DB, no IPC — unit-tested directly);
 * trust.isAutoFileEligible is re-asked separately on the overlay this returns.
 *
 * FRAMING (Oracle): Tier 2 re-parses the SAME stored ocr_text — a consistency check,
 * NEVER corroboration or a re-read of the page. Copy/comments must not claim otherwise.
 *
 * Rules (design §Green-light predicate — every arm pinned in test_sweep_predicate.js):
 *  - type slug must be unchanged;
 *  - ROLE fields (supplier + the type's ref/date keys): fresh value NON-EMPTY and
 *    normalise-equal (text_normalise twin) to the stored DISPLAY value. Fresh-empty on a
 *    role field = FAIL. MISMATCH RULE (pinned trade-off): a BETTER fresh value (un-clipped
 *    code, shed note) still FAILS — the displayed value is stale/wrong and must not
 *    batch-file; the doc stays in review.
 *  - non-role fields: no contradiction — both non-empty must normalise-equal; fresh-empty
 *    PASSES (imageless anchor self-skip is structural, not evidence of absence);
 *    stored-EMPTY + fresh-VALUE = HELD, not filed (the warm system just read a value the
 *    file would permanently miss — reason 'new-value-on-recheck').
 *  - BOTH sides must be note-free AND corrected_to-free.
 *
 * Returns { pass, reason, field, overlay } — overlay = the stored rows overlaid with
 * fresh confidences (fresh-empty non-role keeps the STORED confidence, so a stale-weak
 * anchor field still trips the 88 critical floor in the isAutoFileEligible re-ask).
 */

const { normaliseForTokens } = require('../../database/modules/text_normalise');

const _s = v => String(v == null ? '' : v).trim();
const _eq = (a, b) => normaliseForTokens(a) === normaliseForTokens(b);
const _noted = e => !!(_s(e && e.validation_note) || _s(e && e.corrected_to));

/**
 * @param storedRows  extraction rows from the DB ({field_key, display_value, raw_value,
 *                    confidence, validation_note, corrected_to})
 * @param freshFields the fast re-extract's extractions map {field_key: {value, confidence,
 *                    method, validation_note?, corrected_to?}}
 * @param roleKeys    Set of role field keys (supplier_name + the type's ref/date keys)
 * @param storedSlug / freshSlug  document type slugs (fresh from --known-doc-slug echo)
 */
function evaluateSweepConsistency({ storedRows, freshFields, roleKeys, storedSlug, freshSlug }) {
  const fail = (reason, field) => ({ pass: false, reason, field: field || null, overlay: null });

  if (_s(storedSlug).toLowerCase() !== _s(freshSlug).toLowerCase()) return fail('type-changed');

  const fresh = freshFields || {};
  const stored = new Map();
  for (const r of (storedRows || [])) if (r && r.field_key) stored.set(r.field_key, r);

  // Note/correction freedom on BOTH sides, any field (one flagged side = review stays).
  for (const r of stored.values()) if (_noted(r)) return fail('stored-flagged', r.field_key);
  for (const [k, f] of Object.entries(fresh)) if (_noted(f)) return fail('fresh-flagged', k);

  const roles = roleKeys instanceof Set ? roleKeys : new Set(roleKeys || []);
  for (const rk of roles) {
    const sv = _s((stored.get(rk) || {}).display_value ?? (stored.get(rk) || {}).raw_value);
    const fv = _s((fresh[rk] || {}).value);
    if (!sv) return fail('role-empty-stored', rk);        // nothing displayed to consent to
    if (!fv) return fail('role-empty-on-recheck', rk);    // warm pass lost a role read → review
    if (!_eq(sv, fv)) return fail('role-mismatch', rk);   // incl. the BETTER-fresh-value case
  }

  for (const [k, f] of Object.entries(fresh)) {
    if (roles.has(k)) continue;
    const fv = _s(f && f.value);
    if (!fv) continue;                                    // imageless self-skip — structural
    const srow = stored.get(k);
    const sv = _s(srow && (srow.display_value ?? srow.raw_value));
    if (!sv) return fail('new-value-on-recheck', k);      // HELD — the file would miss it
    if (!_eq(sv, fv)) return fail('field-mismatch', k);
  }

  // Overlay for the isAutoFileEligible re-ask: stored values, fresh confidence where the
  // fresh pass produced one; fresh-empty keeps the STORED confidence (stale-weak anchor
  // fields must still trip the critical floor). Notes are empty by construction here.
  const overlay = [];
  for (const [k, srow] of stored.entries()) {
    const f = fresh[k];
    const fc = f && _s(f.value) && f.confidence != null ? Number(f.confidence) : null;
    overlay.push({
      field_key: k,
      display_value: srow.display_value,
      raw_value: srow.raw_value,
      confidence: (fc != null && !Number.isNaN(fc)) ? fc : srow.confidence,
      validation_note: null,
      corrected_to: null,
      // THREADED 2026-08-07: docTrustGate's shadow-row skip keys on extraction_method. Dropping it
      // here would silently present every stored row as a non-shadow row to the re-asked gate.
      extraction_method: srow.extraction_method ?? null,
    });
  }
  return { pass: true, reason: 'ok', field: null, overlay };
}

/** Stable fingerprint of a doc's extraction rows (SEAM 2 — candidacy→accept mutation guard).
 *  Any pill fill / OCR-enhance / edit between the consent list and the accept changes it. */
function extractionsFingerprint(rows) {
  const crypto = require('crypto');
  const parts = (rows || [])
    .filter(r => r && r.field_key)
    .map(r => [r.field_key, _s(r.display_value), _s(r.raw_value), _s(r.confidence),
               _s(r.validation_note), _s(r.corrected_to)].join(''))
    .sort();
  return crypto.createHash('sha256').update(parts.join('')).digest('hex').slice(0, 32);
}

module.exports = { evaluateSweepConsistency, extractionsFingerprint };
