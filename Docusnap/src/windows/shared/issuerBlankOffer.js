'use strict';

// Card 4 (Chris R5) — the blank-issuer "these look like X?" offer predicate. When a Confirm & File
// lands with the Document Issuer blank BUT the engine already carried a letterhead name it could not
// safely adopt, offer to file under that name instead of scattering the doc into "Unknown Company".
//
// THE SEAM (Oracle, 2026-08-26): extractions.suggested_supplier has SEVERAL writers, but every ON
// writer means one thing — "the company the page's own letterhead/branding identifies as the issuer,
// a garble-of the SAME company" — and three consumers depend on that meaning (the Review-list
// grouping, the review_group_by_letterhead confirm hold, and this offer). So the offer must gate on
// the note's PROVENANCE (the branding-suggestion regex, the exact one renderer isBrandingFlag uses),
// NOT merely on suggested_supplier being non-null. A future writer that puts a DIFFERENT company in
// the column (e.g. a buyer-issued PO's body vendor) carries a NON-branding note and must NOT be
// offered here — the negative pin guards that. A Path-B abstain (no corroborated alt) carries no
// suggested_supplier at all, so the honest "Unknown Company" stays the outcome there.
//
// Pure, dependency-free; loaded as a <script> in Review (window.IssuerBlankOffer) and require()d by
// its unit test — ONE source, no mirror to drift.
(function (root) {
  // The branding-suggestion provenance — identical to renderer.js isBrandingFlag's gate.
  const BRANDING_PROVENANCE = /page branding reads|confirm the correct company|letterhead may read/i;

  // issuerOfferForBlank({ issuerValue, suggestedSupplier, note }) → { offer:true, name } | { offer:false }
  function issuerOfferForBlank(o) {
    o = o || {};
    if (String(o.issuerValue == null ? '' : o.issuerValue).trim()) return { offer: false };   // never override a value
    const name = String(o.suggestedSupplier == null ? '' : o.suggestedSupplier).trim();
    if (!name) return { offer: false };                                                        // Path B — honest Unknown
    if (!BRANDING_PROVENANCE.test(String(o.note == null ? '' : o.note))) return { offer: false };   // seam: branding provenance only
    return { offer: true, name };
  }

  root.IssuerBlankOffer = { issuerOfferForBlank, BRANDING_PROVENANCE };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).IssuerBlankOffer;
}
