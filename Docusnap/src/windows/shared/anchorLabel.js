'use strict';

// Shared label-quality helpers for the "teach a field" surfaces — the Review ⊕ tool and the
// Teach-a-document wizard. These were previously defined ONLY in review/renderer.js, so the
// teach wizard carried its own weaker label detection: it took the whole left-band OCR text as
// the "label" (a wide two-column key/value row glued the far-left caption onto the adjacent one
// → the label "spanned to the left") and never stripped value-shaped tokens. Extracting them
// here — used by BOTH renderers — makes the label detection identical and unable to diverge again.
//
// PURE functions (no DOM / no closure state). Exposed as window.AnchorLabel for the classic
// (non-module) window scripts, which load this before their renderer.js. Guarded by
// src/windows/shared/test_anchor_label.js.

(function (root) {
  // From the OCR word boxes of a left-of-value strip (one line tall), return the RIGHTMOST
  // contiguous block — the caption NEAREST the value — split from any other column on a wide
  // horizontal gap. Returns { text, box:[l,t,w,h] } in the words' own px space, or null when
  // there are no usable words. This is what stops a wide two-column key/value row
  // ("Ticket No. … Work Address") merging BOTH captions into one bogus anchor.
  function nearestLeftCluster(words) {
    const ws = (words || [])
      .filter(w => w && Array.isArray(w.box) && w.box.length >= 4 && (w.text || '').trim())
      .map(w => ({ text: w.text.trim(), l: +w.box[0], t: +w.box[1], w: +w.box[2], h: +w.box[3] }))
      .filter(w => isFinite(w.l) && isFinite(w.w))
      .sort((a, b) => a.l - b.l);
    if (!ws.length) return null;
    // A real inter-COLUMN gap is several text-heights wide — far larger than the inter-word
    // space inside one caption. Tie the threshold to the median word height so it scales with
    // DPI/zoom rather than a brittle pixel constant.
    const heights = ws.map(w => w.h).filter(h => h > 0).sort((a, b) => a - b);
    const medH = heights[Math.floor(heights.length / 2)] || 0;
    const gapThresh = Math.max(medH * 1.2, 8);
    // Walk left→right; a gap past the threshold starts a new column, discarding everything to
    // its left. The surviving block is the rightmost (nearest) column.
    let block = [ws[0]];
    for (let i = 1; i < ws.length; i++) {
      const prev = ws[i - 1];
      const gap = ws[i].l - (prev.l + prev.w);
      if (gap > gapThresh) block = [ws[i]];
      else block.push(ws[i]);
    }
    const l = Math.min(...block.map(w => w.l));
    const t = Math.min(...block.map(w => w.t));
    const r = Math.max(...block.map(w => w.l + w.w));
    const b = Math.max(...block.map(w => w.t + w.h));
    return { text: block.map(w => w.text).join(' '), box: [l, t, r - l, b - t] };
  }

  // The caption nearest the value = the LAST (rightmost/closest) words of the strip text.
  function extractLabel(text) {
    const cleaned = String(text || '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    const tail = cleaned.slice(-40).trim();
    if (tail.length > 3 && /[a-zA-Z]/.test(tail)) return tail;
    return null;
  }

  // Strip value-shaped tokens so a MAC/IP/reference/date/serial sitting where a label was
  // expected is never saved AS the label (it would never re-locate on a future page).
  function sanitizeAnchorLabel(label) {
    if (!label || typeof label !== 'string') return '';
    return label.trim().split(/\s+/).filter(tok => {
      if (!/[a-zA-Z]/.test(tok)) return false;                 // bare number / ref / date
      if ((tok.match(/\d/g) || []).length >= 3) return false;  // code-like serial
      return true;
    }).join(' ').trim();
  }

  // An auto-detected label captured off a NOISY scan can be garbled ("Serial No." → "verial No.",
  // "Description" → a replacement-char-prefixed "escription"). A garbled label never re-locates on
  // future pages, so the taught anchor silently reads nothing forever. Flag the obvious garble so
  // the readout can warn + let the operator fix the label before it's saved.
  function labelLooksSuspicious(label) {
    if (!label || !label.trim()) return true;
    if (/�/.test(label)) return true;                                  // OCR replacement char
    if (/[^\p{L}\p{N}\s.,'&()/:#%\-]/u.test(label)) return true;            // junk symbols real captions don't carry
    // a long alphabetic token with NO vowel reads as garble ("brtnz", "vrntx")
    const toks = label.split(/\s+/).map(t => t.replace(/[^a-zA-Z]/g, '')).filter(t => t.length >= 4);
    if (toks.some(t => !/[aeiouy]/i.test(t))) return true;
    // intra-token case chaos — a lowercase letter immediately followed by an uppercase one.
    // A real caption never does this (Title-case caps only at the front; ALLCAPS not at all),
    // but garbled OCR does ("Site / Customer" misread as "VUoWwriter" trips o→W). Also catches
    // an ALLCAPS word with one misread lowercase ("INVOlCE" → l→C). reggie-designed 2026-07-10;
    // 0 false-flags across the real-caption vocab. Cannot catch clean-case clips ("verial",
    // "escription") — no character rule can (they read as words) → left to the operator.
    if (/\p{Ll}\p{Lu}/u.test(label)) return true;
    return false;
  }

  root.AnchorLabel = { nearestLeftCluster, extractLabel, sanitizeAnchorLabel, labelLooksSuspicious };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

// Node/test interop (the browser path uses window.AnchorLabel).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).AnchorLabel;
}
