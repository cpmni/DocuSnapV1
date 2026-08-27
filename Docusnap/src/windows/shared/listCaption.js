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
    const re = (words.length === 1 && /^[a-z]+$/.test(words[0]))
      ? new RegExp('(?<![a-z0-9])' + body + '(?![a-z0-9])(.*)$', 'i')
      : new RegExp(body + '(.*)$', 'i');
    const out = [], seen = new Set();
    for (const line of String(ocrText || '').split('\n')) {
      const m = re.exec(line);
      if (!m) continue;
      let v = String(m[1] || '').replace(/^[.\s:|\-–]+/, '');
      v = v.split(/\s{3,}| · |\t/)[0].trim();
      if (!v || v.length > 80) continue;
      if (seen.has(v)) continue;
      seen.add(v); out.push(v);
    }
    return out;
  }
  const api = { previewValues };
  if (typeof window !== 'undefined') window.ListCaption = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
