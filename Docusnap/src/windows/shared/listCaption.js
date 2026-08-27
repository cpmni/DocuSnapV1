'use strict';
/*
 * shared/listCaption.js — ONE preview of what a LIST field's CAPTION collects on a page, shared by the
 * Teach wizard and the Review ⊕ path (owner 2026-08-27: "teach should display all the captured values on
 * the taught doc … so the user can see it is doing its job").
 *
 * A JS twin of keyword.py's INLINE list collect: the caption matches whitespace-tolerantly (word-bounded
 * when it is a single alphabetic word — mirrors _label_pattern), the value is what follows the caption
 * on the SAME line with caption punctuation stripped and cut at a column break; elements dedupe
 * first-seen. PREVIEW ONLY — the real collector (per-element validation, the shared _post_label_value
 * pipeline, a caption ABOVE a column) runs when the app processes the document. Keep in sync with the
 * inline shape of keyword.extract_fields(collect=True); pinned by src/windows/teach/test_teach_auto_field_rows.js.
 */
(function () {
  function previewValues(caption, ocrText) {
    const words = String(caption || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const body = words.map(esc).join('\\s*');
    // Tail bound `(?![a-z])` mirrors keyword.py LIST_CAPTION_TAIL_BOUND (collect mode only): "Serial No"
    // must not fire on "Serial Nos: A" — that yielded the debris element "s: A"; "Serial No1234" still hits.
    const re = (words.length === 1 && /^[a-z]+$/.test(words[0]))
      ? new RegExp('(?<![a-z0-9])' + body + '(?![a-z0-9])(.*)$', 'i')
      : new RegExp(body + '(?![a-z])(.*)$', 'i');
    const out = [], seen = new Set();
    for (const line of String(ocrText || '').split('\n')) {
      const m = re.exec(line);
      if (!m) continue;
      let v = String(m[1] || '').replace(/^[.\s:|\-–]+/, '');
      // Column break = a run of 4+ spaces, a middle-dot separator, or a tab (geometry-rebuilt page text
      // pads columns with wide runs; a 2–3 space gap can sit INSIDE one OCR'd value).
      v = v.split(/ {4,}| · |\t/)[0].trim();
      if (!v || v.length > 80) continue;
      const k = v.toLowerCase();          // casefold dedupe — mirrors the collector ("abc1" == "ABC1")
      if (seen.has(k)) continue;
      seen.add(k); out.push(v);
    }
    return out;
  }
  // ── ONE caption normaliser for the ⊕ road, the wizard AND the `teach-list-caption` IPC ──────────
  // What the preview shows MUST be what the collector will match. Chris round 8 card 1: the ⊕ bar
  // previewed "No:" (multi-word branch → one "Serial No:" line) while the IPC stored "No" (trailing
  // punctuation stripped) — and the collector's "No" then matched "JOB SHEET NO CJB-9791" on the twin,
  // filing the job number as the serial and reporting "1 found". Same rule everywhere, or the receipt lies.
  function cleanCaption(s) {
    return String(s || '').replace(/\s+/g, ' ').trim().replace(/[\s:.\-–|]+$/, '').trim();
  }
  // A caption that is only a generic TAIL word would fire on every "…No …" on the page — the job sheet
  // number, the VAT reg no, the PO no. Never a keyword on its own; the teach must carry the phrase.
  const GENERIC_TAILS = /^(?:no|nos|number|num|nº|#|ref|reference|id|code|date|qty|quantity)$/i;
  function isGenericCaption(s) { return GENERIC_TAILS.test(cleanCaption(s)); }
  // Extend a generic tail to the caption PHRASE printed left of the VALUE on the page: find the line that
  // shows the drawn value, take the words immediately before it (shortest non-generic run of ≤ 3 words,
  // stopping at a column gap) — "No" + "CT-8116138" on "…fitted  Serial No:    CT-8116138" → "Serial No".
  // Null when the page does not show the value or no non-generic phrase sits before it (caller refuses).
  function extendCaption(caption, value, ocrText) {
    const cap = cleanCaption(caption), val = String(value || '').trim();
    if (!cap || !val) return null;
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const valRe = new RegExp('(^|\\s)' + esc(val) + '(?![A-Za-z0-9])', 'i');
    for (const line of String(ocrText || '').split('\n')) {
      const m = valRe.exec(line);
      if (!m) continue;
      // trim the run of spaces between the caption and the value FIRST — otherwise a 4-space column gap
      // yields a trailing empty segment and the caption is lost
      const before = line.slice(0, m.index + m[1].length).replace(/\s+$/, '');
      const seg = (before.split(/ {3,}|\t| · /).pop() || '').replace(/[\s:.\-–|]+$/, '').trim();
      const words = seg.split(/\s+/).filter(Boolean);
      for (let k = 1; k <= Math.min(3, words.length); k++) {
        const phrase = cleanCaption(words.slice(-k).join(' '));
        if (phrase && !isGenericCaption(phrase) && phrase.length <= 40) return phrase;
      }
    }
    return null;
  }
  const api = { previewValues, cleanCaption, isGenericCaption, extendCaption };
  if (typeof window !== 'undefined') window.ListCaption = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
