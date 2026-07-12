/*
 * logoSource.js — the ONE source of a page's logo/fingerprint image.
 *
 * The confirm-time supplier logo fingerprint (logo_fingerprints, fed to anchor.try_logo_supplier_match
 * for EVERY future raw import) and the on-load logo MATCH must always be taken from the RAW page render,
 * never from the on-screen image. When "Straighten" (display deskew) or "OCR Preview" (enhance) is active,
 * the on-screen <img> (docImg) is a rotated/enhanced bitmap whose perceptual hash drifts double-digit
 * Hamming from the learned RAW fingerprints — so fingerprinting it would (a) fail to MATCH a known
 * supplier and (b) on confirm INSERT a drifted fingerprint that silently poisons supplier identity for
 * every future raw import (Oracle C1, 2026-07-12). pageImages[page] is the raw page data-URL already in
 * memory; this returns its base64 payload, independent of whatever is currently displayed.
 *
 * Pure + framework-free so it is unit-testable (test_logo_source.js) and shared by the renderer.
 */
(function (root) {
  function rawPageBase64(pageImages, page) {
    const src = String((pageImages && pageImages[page]) || '');
    if (!src) return null;
    return src.includes(',') ? src.split(',')[1] : src;   // strip the "data:image/png;base64," header
  }
  root.LogoSource = { rawPageBase64 };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

// Node/test interop (the browser path uses window.LogoSource).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).LogoSource;
}
