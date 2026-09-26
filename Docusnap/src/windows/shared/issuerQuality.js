'use strict';
/*
 * issuerQuality.js — teach-time quality checks for a DOCUMENT-ISSUER (company-name) value.
 *
 * OVER-CAPTURE (Chris sandbox r3, 2026-09-26; reggie design): a slightly loose teach box over a
 * letterhead grabs the company NAME plus its trailing address/phone — e.g.
 *   "Larkspur Interiors The Design Rooms, 3 Chapel Lane Harrogate HG1 2PZ T 01493 …"
 * and the existing garble check (`issuerReadLooksImplausible`) passes it (starts with a letter,
 * multi-token, high name-quality), so it is taught as the sender identity AND the filing folder name.
 * This module adds a PRECISION-FIRST, non-blocking signal so the confirm can warn "that looks like it
 * includes the address — draw a tighter box, or use it as-is". It never blocks and never rewrites.
 *
 * Precision rule: a company NAME on its own does not carry its own postcode or phone number, so either
 * of those alone is decisive; otherwise warn only when the value is BOTH longer than a plausible name
 * AND carries an address token. Length alone never warns (a long charity/partnership name stays silent).
 *
 * Pure (no DOM / no IO) so the teach wizard, the Review ⊕ readout and the client copy can share ONE
 * detector instead of drifting. The UK-postcode INNER shape is byte-identical to
 * config/keyword_patterns.json validation_patterns.postcode_uk — keep them in lockstep.
 */
(function (root) {
  // Embedded (de-anchored) UK postcode: a real boundary each side so it can't match mid-token; the
  // inner shape (outward + optional space + inward) mirrors validation_patterns.postcode_uk.
  const UK_POSTCODE = /(^|[\s,(])[A-Za-z]{1,2}\d[A-Za-z\d]?\s?\d[A-Za-z]{2}(?=$|[\s,.)])/;
  const PHONE_CAPTION = /(?:^|[\s,(])(?:tel|telephone|fax|phone|mob|mobile)\.?\s*[:.]?\s*\+?\(?\d{3}/i;
  const PHONE_CAPTION_1 = /(?:^|[\s,(])[TFM]\.?\s*[:.]?\s*\+?\(?\d{3}/;   // WEAK — "T 01493"; combine only (a bare "T Smith" has no digits)
  const STREET_TYPE = /\b(?:road|street|lane|avenue|ave|drive|close|way|court|place|square|crescent|terrace|wharf|quay|parade|walk|row|estate|industrial\s+estate|business\s+park|trading\s+estate)\b/i;
  const HOUSE_NO = /(?:^|[\s,])\d{1,4}[A-Za-z]?[\s,]+[A-Z][a-z]/;   // "3 Chapel", "12A High"
  const PO_BOX = /\bp\.?\s?o\.?\s*box\b/i;
  const UNIT_NO = /\bunit\s+\d/i;

  // A dial-run of >= 9 digits (regex finds a candidate run, JS counts the digits — a 6-digit ref never trips it).
  function hasPhoneRun(s) {
    const m = s.match(/\+?\(?\d[\d\s().\-]{6,}\d/);
    return !!m && m[0].replace(/\D/g, '').length >= 9;
  }

  /**
   * @param {string} value the issuer value about to be taught
   * @returns {{over:boolean, hasPostcode:boolean, hasPhone:boolean}}
   */
  function overCapture(value) {
    const s = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    // Too short to be name+address; a bare postcode is the garble check's job (mixed digit/letter tokens).
    if (s.length < 12) return { over: false, hasPostcode: false, hasPhone: false };
    const hasPostcode = UK_POSTCODE.test(s);
    const hasPhone = hasPhoneRun(s) || PHONE_CAPTION.test(s);
    const tokens = s.split(' ').length;
    const isLong = tokens >= 6 || s.length >= 40;
    const hasAddr = STREET_TYPE.test(s) || HOUSE_NO.test(s) || PO_BOX.test(s) || UNIT_NO.test(s) || PHONE_CAPTION_1.test(s);
    return { over: hasPostcode || hasPhone || (isLong && hasAddr), hasPostcode, hasPhone };
  }

  root.IssuerQuality = { overCapture, hasPhoneRun, UK_POSTCODE };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

// Node/test interop (the browser path uses window.IssuerQuality).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).IssuerQuality;
}
