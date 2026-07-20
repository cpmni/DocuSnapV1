'use strict';
/*
 * branding_fingerprint.js — the ONE source of truth for a supplier's DISTINCTIVE branding tokens and
 * the SYMMETRIC distinctive-overlap comparator used to converge / reuse / merge learned templates by
 * BRANDING (the letterhead words) rather than by the unstable logo phash.
 *
 * WHY: on scans the coarse 64-bit logo phash drifts as much for the SAME supplier (measured up to 36
 * Hamming) as it separates DIFFERENT suppliers (as low as 2), so it cannot key template identity. The
 * keyword branding fingerprint separates cleanly (measured 0% cross-supplier false-match at 0.80 overlap
 * on a 9-supplier corpus). See docs/designs/TEMPLATE_CONVERGENCE_2026-07-17.md.
 *
 * Shared by: templates.js (findByBrandingFingerprint / merge candidacy), graduationTemplate.js (the
 * distinctive-token create gate), and src/modules/review/handler.js (_upsertTemplate M2 reuse) — ONE
 * helper so the reuse and link paths can never disagree about "same template" (Oracle SEAM condition).
 *
 * BRANDING_STOPWORDS mirrors engine.py `_BRANDING_STOPWORDS` — doc-type words that are NOT a supplier's
 * distinctive branding (two suppliers' delivery dockets both carry "delivery"/"docket"). Keep in sync.
 */

const BRANDING_STOPWORDS = new Set([
  'delivery', 'docket', 'note', 'notes', 'invoice', 'order', 'purchase', 'sales',
  'statement', 'remittance', 'receipt', 'quote', 'quotation', 'worksheet',
  'credit', 'debit', 'advice', 'proforma', 'job', 'copy', 'original',
]);

// K — the minimum number of SHARED distinctive tokens for a convergence / reuse match. Two shared
// distinctive branding words is not identity (a trading estate, "& Sons" boilerplate); three is the
// measured-safe bar (mirrors engine._flag_branding_conflict's own distinctive-token floor).
const DISTINCTIVE_MIN = 3;

// Distinctive branding tokens = fingerprint tokens (lowercased, len>=3, doc-type stopword removed),
// de-duplicated. Mirrors graduationTemplate's old local copy + engine.py:1013-1016.
function distinctiveTokens(keywordFingerprint) {
  const out = new Set();
  for (const w of (keywordFingerprint || [])) {
    const wl = String(w == null ? '' : w).trim().toLowerCase();
    if (wl.length >= 3 && !BRANDING_STOPWORDS.has(wl)) out.add(wl);
  }
  return [...out];
}

/**
 * SYMMETRIC distinctive-token overlap between two keyword fingerprints.
 * Returns { shared, ratio } where shared = |dist(A) ∩ dist(B)| and
 * ratio = shared / max(|dist(A)|, |dist(B)|).
 *
 * The MAX denominator makes it symmetric (Oracle SEAM-2): a DIRECTIONAL ratio (denominator = one side)
 * lets a bloated superset doc score 1.0 against a minimal template and mis-reuse — max-denominator
 * penalises the non-overlap on the larger side, so a subset only qualifies when the two sets are
 * genuinely close in size. Either side empty ⇒ ratio 0 (never a match).
 */
function symmetricDistinctiveOverlap(fpA, fpB) {
  const a = distinctiveTokens(fpA);
  const b = distinctiveTokens(fpB);
  if (!a.length || !b.length) return { shared: 0, ratio: 0 };
  const bSet = new Set(b);
  let shared = 0;
  for (const t of a) if (bSet.has(t)) shared++;
  return { shared, ratio: shared / Math.max(a.length, b.length) };
}

/**
 * Does fingerprint A converge onto B? Requires BOTH the absolute floor (>= DISTINCTIVE_MIN shared
 * distinctive tokens) AND the symmetric ratio >= threshold. The floor closes the short/generic-fingerprint
 * collision; the ratio closes the bloated-superset collision. Callers add the same-slug scope.
 */
function convergesByBranding(fpA, fpB, threshold) {
  const { shared, ratio } = symmetricDistinctiveOverlap(fpA, fpB);
  return shared >= DISTINCTIVE_MIN && ratio >= threshold;
}

/**
 * CONFIRM-TIME PLANT GATE (identity text-first, Oracle C4) — is `supplierName` corroborated by
 * this document's own text? A logo fingerprint planted under a wrong-but-confirmed supplier is
 * the poison loop the text-agreement gate can't reach: the human rubber-stamps a plausible
 * prefill, and the page phash is planted under the wrong company, making the NEXT batch worse.
 *
 * Judged on the supplier's DISTINCTIVE tokens: its learned template fingerprints when it has
 * any, else the distinctive words of its own NAME (so a genuine FIRST-CONTACT enrolment — the
 * case that has no template yet — still corroborates and still plants; gating on "has a note"
 * instead would starve legitimate enrolment, which is why the Oracle rejected that shape).
 *
 * FAIL OPEN by design: no text, or nothing distinctive to test, ⇒ { judgeable:false,
 * corroborated:true }. This gate may only ever SKIP a learning write — it can never change a
 * filed value — so an unjudgeable case must not block enrolment.
 */
function nameCorroboratedByText(supplierName, supplierFingerprints, ocrText) {
  const text = String(ocrText || '').toLowerCase();
  let tokens = [];
  for (const fp of (supplierFingerprints || [])) tokens.push(...distinctiveTokens(fp));
  if (!tokens.length) tokens = distinctiveTokens(String(supplierName || '').split(/\s+/));
  tokens = [...new Set(tokens)];
  if (!text || !tokens.length) return { judgeable: false, corroborated: true, matched: [] };
  const matched = tokens.filter(t => new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`)
    .test(text));
  return { judgeable: true, corroborated: matched.length > 0, matched };
}

module.exports = {
  BRANDING_STOPWORDS,
  DISTINCTIVE_MIN,
  distinctiveTokens,
  symmetricDistinctiveOverlap,
  convergesByBranding,
  nameCorroboratedByText,
};
