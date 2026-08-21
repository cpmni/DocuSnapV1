'use strict';
/*
 * valueLocate.js — find a TYPED value in a page's word geometry and return the box it sits in.
 *
 * WHY THIS EXISTS. When the teach wizard's operator types a value instead of drawing a box, the
 * template stores WHAT it says and nothing about WHERE it sits: `{value, target:null, anchor:null,
 * status:'fixed'}` becomes a frozen `fixed_value` that is re-asserted on every document of the
 * type, whatever that document actually prints. Three separate defects this week ran through that
 * one path — a frozen `supplier_name` stamped onto 18 other companies' documents, `vat_no` frozen
 * as the literal caption 'VAT', `serials` frozen as 'Serial No:'. All the same shape: a value with
 * no position, taken from a sample of one, asserted confidently.
 *
 * The census (`stress_test/fixed_value_locatable.js`, 2026-08-10) measured the way out: 17 of the
 * 19 measurable fixed values are PRINTED on their own sample page (supplier_name 7/7, vat_no 6/6,
 * account_no 3/3). They were typed because the READ was wrong, not because the value is absent. So
 * if we search the page's words for the typed string we can give most manual entries a real
 * position, and the template reads the page instead of repeating a constant.
 *
 * THE CONDITION THE SAME CENSUS IMPOSED — presence is not correctness. Two of those 17 are values
 * we already know are WRONG (`vat_no = 'VAT'` matches because the CAPTION is on the page). So a
 * located box is evidence about WHERE a string sits, and NEVER about WHETHER it is the right value.
 * This module therefore returns geometry and nothing else: no score, no confidence, no verdict.
 * Callers must not treat a hit as corroboration.
 *
 * MATCHING IS DELIBERATELY STRICT — exact after normalisation, no fuzzy tier. A near-miss match
 * would put the box on the wrong words, which is worse than the position-less status quo; failing
 * to match simply leaves the existing typed-value path exactly as it was. Two normalised forms are
 * compared so a value split differently by OCR still matches: whitespace-collapsed ('PO 59430'),
 * and whitespace-removed ('PI/26/6000' vs the words 'PI/26' '/6000').
 *
 * SCOPE: single visual ROW only. A run of words is only ever assembled left-to-right within one
 * row — the same discipline as boxSnap's single-row scope. A value wrapped across two lines is not
 * located, and falls back to the typed-value path.
 */
(function (root) {
  const MAX_RUN = 8;      // longest run of page words a single value may span
  const MAX_HITS = 6;     // a value printed more times than this is not a useful position
  const EDGE_PUNCT = /^[.,;:()[\]{}"'`‘’“”\-–—]+|[.,;:()[\]{}"'`‘’“”\-–—]+$/g;
  // Currency symbols are NOT edge-punctuation (a £/$ is meaningful, not stray punctuation), so norm
  // keeps them — which made a typed "4,142.35" fail to locate the page's "£4,142.35" and offered a
  // FROZEN constant instead (Chris round-10 card #4). Strip a currency symbol ONLY when it directly
  // abuts a digit at the string START — a deterministic canonicalisation of a money token, never a
  // fuzzy match. Mirrors review/renderer.js _stripCurrencySymbol so the teach locate agrees with how
  // the app reads money. Leading-only (no lookbehind) → identical in the browser and Node.
  const CUR_EDGE = /^[£$€¥₹](?=\d)/;
  const stripCur = (t) => t.replace(CUR_EDGE, '');

  // Compare-time normalisation. Mirrors the spirit of text_normalise.js (case + unicode dash/quote
  // folding + whitespace collapse) plus the SAME edge-punctuation set the engine's page-presence
  // gate strips (`_filing_value_sanity`, engine.py) — so a value this module can locate is a value
  // that gate would also recognise on the page.
  function norm(s) {
    let t = String(s == null ? '' : s);
    try { t = t.normalize('NFKC'); } catch { /* older engines: the rest of the fold still applies */ }
    t = t.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"')
         .replace(/[‐-―−]/g, '-')
         .replace(/\s+/g, ' ').trim().toLowerCase();
    return t.replace(EDGE_PUNCT, '');
  }
  const squash = (s) => norm(s).replace(/\s+/g, '');

  /**
   * @param {string} value        the string the operator typed
   * @param {object} opts
   *   @param {Array} opts.words  [{t, b:[l,t,w,h]}] from `ocr-page-words`, in image pixels
   *   @param {number} opts.natW  image pixel width  (the frame `words` was produced in)
   *   @param {number} opts.natH  image pixel height
   * @returns {Array<{box:{x,y,w,h}, text:string, wordCount:number}>} page-normalised boxes, in
   *   reading order. Empty when the value is not printed on the page as written.
   */
  function locateValueInWords(value, opts) {
    const { words, natW, natH } = opts || {};
    const targetSpaced = norm(value);
    const targetSquash = squash(value);
    const targetCur = stripCur(targetSquash);   // === targetSquash unless the value itself is money-shaped
    // A one-character target matches noise on any page; there is no position worth storing.
    if (targetSquash.length < 2) return [];
    if (!Array.isArray(words) || !words.length || !(natW > 0) || !(natH > 0)) return [];

    // → page-normalised, dropping anything without real geometry or text.
    const ws = [];
    for (const wd of words) {
      const b = wd && wd.b;
      if (!Array.isArray(b) || b.length < 4) continue;
      const [l, t, w, h] = b;
      if (!(w > 0 && h > 0)) continue;
      const text = String(wd.t || '').trim();
      if (!text) continue;
      ws.push({ text, x: l / natW, y: t / natH, w: w / natW, h: h / natH });
    }
    if (!ws.length) return [];

    // Group into visual ROWS by y-centre, exactly the way the page text itself is rebuilt from word
    // geometry (ocr/tesseract.py `_group_words_into_lines`) — so a run assembled here is a run the
    // pipeline would also read as one line.
    const heights = ws.map((w) => w.h).sort((a, b) => a - b);
    const medH = heights[heights.length >> 1] || 0.01;
    const byY = ws.slice().sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2));
    const rows = [];
    for (const w of byY) {
      const yc = w.y + w.h / 2;
      const row = rows[rows.length - 1];
      if (row && Math.abs(yc - row.yc) <= medH * 0.6) { row.words.push(w); row.yc = (row.yc + yc) / 2; }
      else rows.push({ yc, words: [w] });
    }

    const hits = [];
    const seen = new Set();
    for (const row of rows) {
      const rw = row.words.slice().sort((a, b) => a.x - b.x);
      for (let i = 0; i < rw.length; i++) {
        let spaced = '', squashed = '';
        for (let n = 0; n < MAX_RUN && i + n < rw.length; n++) {
          const run = rw.slice(i, i + n + 1);
          spaced = run.map((w) => w.text).join(' ');
          squashed = squash(spaced);
          // Prune: once the run is longer than the target under BOTH forms it can only grow.
          // Currency-aware prune/compare (card #4): stripCur is inert unless a token abuts a leading
          // currency glyph, so this adds NO new bare-number match class — only "£4,142.35" now equals
          // typed "4,142.35". A non-currency prefix ("#4,142.35") is untouched and still does not match.
          if (stripCur(squashed).length > targetCur.length && norm(spaced).length > targetSpaced.length) break;
          if (norm(spaced) !== targetSpaced && squashed !== targetSquash && stripCur(squashed) !== targetCur) continue;
          const x1 = Math.min(...run.map((w) => w.x));
          const x2 = Math.max(...run.map((w) => w.x + w.w));
          const y1 = Math.min(...run.map((w) => w.y));
          const y2 = Math.max(...run.map((w) => w.y + w.h));
          // Trailing-edge floor mirrors boxSnap.js: a single-line hit's height-scaled pad
          // (~0.002) is thinner than sibling drift (0.003-0.005), which stores a flush right
          // edge that shears the final glyph on drifted siblings. Right edge only.
          const pad = Math.min(0.004, (y2 - y1) * 0.15);
          const TRAIL_PAD = 0.004;
          const box = {
            x: Math.max(0, x1 - pad), y: Math.max(0, y1 - pad),
            w: Math.min(1, x2 + TRAIL_PAD) - Math.max(0, x1 - pad),
            h: Math.min(1, y2 + pad) - Math.max(0, y1 - pad),
          };
          const key = [box.x, box.y, box.w, box.h].map((v) => Math.round(v * 2000)).join(':');
          if (!seen.has(key)) {
            seen.add(key);
            hits.push({ box, text: spaced, wordCount: run.length });
          }
          i += n;   // this run is consumed — never start another match inside it
          break;
        }
        if (hits.length >= MAX_HITS) return hits;
      }
    }
    return hits;
  }

  root.ValueLocate = { locateValueInWords, norm, squash };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

// Node/test interop (the browser path uses window.ValueLocate).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).ValueLocate;
}
