'use strict';

// THE "Not recognised" membership predicate (Part B, 2026-09-21; barry's shape, pendingfeatures.md
// 2026-09-20 "Undetected issuer"). A review-queue row is UNIDENTIFIED — and belongs in the calm
// "Not recognised" tab instead of intermixing with the confidently-read queue — when it has:
//   • NO issuer value        (issuer_blank === 1 — the getReviewQueue column; a suggestion is not a value),
//   • NO document type       (document_type_id is null — a TYPED-but-no-issuer doc is only PARTIALLY
//                             recognised and stays in the main Review queue), AND
//   • NOTHING suggested      (no issuer_suggested letterhead canonical to offer a "Use X" button).
//
// NEVER keyed on confidence — a faint-but-present read is not "unrecognised" (the overcorrection guard,
// the owner's explicit rule). Pairs with Part A (engine declare-issuer-undetected, mig 195): a doc whose
// garbage issuer Part A blanked lands here; a doc with a genuinely empty issuer + no type lands here too.
//
// Pure, dependency-free; uses ONLY columns getReviewQueue already carries (no data change). Loaded as a
// <script> in Review (window.NotRecognised) and require()d by test_not_recognised.js — ONE source.
(function (root) {
  function isNotRecognisedDoc(doc) {
    if (!doc) return false;
    const noIssuer     = doc.issuer_blank === 1 || doc.issuer_blank === true;
    const noType       = !doc.document_type_id;
    const noSuggestion = !(doc.issuer_suggested && String(doc.issuer_suggested).trim());
    return noIssuer && noType && noSuggestion;
  }
  root.NotRecognised = { isNotRecognisedDoc };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).NotRecognised;
}
