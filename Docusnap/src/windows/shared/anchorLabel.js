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

  // Group words into visual rows on y-centre proximity (scale-free: threshold from the median
  // word height; floor keeps very small print from fragmenting into per-word rows). Shared by
  // nearestAboveRow (bottom row) and nearestRowTo (row nearest a given y).
  function _groupRows(words) {
    const ws = (words || [])
      .filter(w => w && Array.isArray(w.box) && w.box.length >= 4 && (w.text || '').trim())
      .map(w => ({ text: w.text.trim(), l: +w.box[0], t: +w.box[1], w: +w.box[2], h: +w.box[3] }))
      .filter(w => isFinite(w.t) && isFinite(w.h));
    if (!ws.length) return [];
    const heights = ws.map(w => w.h).filter(h => h > 0).sort((a, b) => a - b);
    const medH = heights[Math.floor(heights.length / 2)] || 0;
    const band = Math.max(medH * 0.6, 4);
    const rows = [];
    for (const w of ws.slice().sort((a, b) => (a.t + a.h / 2) - (b.t + b.h / 2))) {
      const c = w.t + w.h / 2;
      const row = rows.find(r => Math.abs(c - r.c) <= band);
      if (row) {
        row.words.push(w);
        row.c += (c - row.c) / row.words.length;   // running mean centre
      } else {
        rows.push({ c, words: [w] });
      }
    }
    return rows;
  }

  // From the OCR word boxes of a LEFT-of-value strip that is TALLER than one line (the strip
  // is vertically EXPANDED so a bolder/higher caption isn't decapitated — the 'SO #'→'sok'
  // class, 2026-07-10), return only the words of the visual row NEAREST the given y-centre
  // (the VALUE row's centre in the words' own px space) — so a neighbouring row's words can't
  // hijack the rightmost-column pick that follows. Returns a words array for
  // nearestLeftCluster, or null when there are no usable words.
  function nearestRowTo(words, centreY) {
    const rows = _groupRows(words);
    if (!rows.length) return null;
    const best = rows.reduce((a, b) =>
      (Math.abs(b.c - centreY) < Math.abs(a.c - centreY) ? b : a));
    return best.words.map(w => ({ text: w.text, box: [w.l, w.t, w.w, w.h] }));
  }

  // From the OCR word boxes of an ABOVE-the-value strip, return only the BOTTOM visual row —
  // the caption line NEAREST the value. The strip must be tall enough to CONTAIN the caption
  // (line spacing routinely exceeds the value box's own height, so a one-line strip clips the
  // caption to its bottom pixel-tips and OCR hallucinates junk from the sliver — the
  // "eee F WS CwE ewe" ⊕ readout, 2026-07-10); a taller strip may then catch the row above the
  // caption too, and THIS selection is what stops that row being glued on (the old reason the
  // strip was starved to one line). Returns { text, box:[l,t,w,h] } in the words' own px space,
  // or null when there are no usable words.
  function nearestAboveRow(words) {
    const rows = _groupRows(words);
    if (!rows.length) return null;
    const bottom = rows.reduce((a, b) => (b.c > a.c ? b : a));
    const block = bottom.words.slice().sort((a, b) => a.l - b.l);
    const l = Math.min(...block.map(w => w.l));
    const t = Math.min(...block.map(w => w.t));
    const r = Math.max(...block.map(w => w.l + w.w));
    const btm = Math.max(...block.map(w => w.t + w.h));
    return { text: block.map(w => w.text).join(' '), box: [l, t, r - l, btm - t] };
  }

  // SHORT-CAPTION allowlist (reggie, 2026-07-10): real order-ref captions are often ≤3 chars
  // ("SO", "SO#", "S/O", "Ref", "No.") and died at extractLabel's length gate, leaving the
  // field position-only-anchored even beside a clean printed caption (the MP_sal_35 "SO #"
  // case). CLOSED class — the two known order-ref stems (dotted/slashed forms included), the
  // two bare generic caption words, and at most ONE optional trailing caption punctuation —
  // so 3-char OCR debris ('sok', 'po4', '$0') still returns null (position-only, as today).
  const SHORT_CAPTION = /^(?:[SP]\/?O|[SP]\.O\.?|REF|NO)\s?[.#:]?$/i;

  // The caption nearest the value = the LAST (rightmost/closest) words of the strip text.
  function extractLabel(text) {
    const cleaned = String(text || '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    const tail = cleaned.slice(-40).trim();
    if (tail.length > 3 && /[a-zA-Z]/.test(tail)) return tail;
    // Normalise a GLUED trailing '#' to the spaced caption form ('SO#' → 'SO #'): the glue is
    // an OCR artifact, and the spaced label locates decisively (1.0 on "SO #" rows, <0.6 on
    // "SOLD TO") where the glued form fuzzy-ties (0.667 on both — a proximity coin-toss).
    if (SHORT_CAPTION.test(tail)) return tail.replace(/(\S)#$/, '$1 #');
    return null;
  }

  // Strip value-shaped tokens so a MAC/IP/reference/date/serial sitting where a label was
  // expected is never saved AS the label (it would never re-locate on a future page).
  // MIRROR PAIR: database/modules/learning.js sanitizeAnchorLabel MUST stay identical —
  // saveAnchor re-sanitizes, and a difference both re-strips the label AND nulls the
  // drift-invariant offset (learning.js's `_clean !== anchor_label` branch).
  function sanitizeAnchorLabel(label) {
    if (!label || typeof label !== 'string') return '';
    const kept = label.trim().split(/\s+/).filter(tok => {
      // A STANDALONE '#' (optionally '#.'/'#:') is caption punctuation ("SO #", "Item #"),
      // never a value — KEEP it: the '#' is the uniqueness that makes a 2-char stem
      // locatable (reggie, 2026-07-10). A glued '#12345' has no letters and still drops.
      if (/^#[.:]?$/.test(tok)) return true;
      if (!/[a-zA-Z]/.test(tok)) return false;                 // bare number / ref / date
      if ((tok.match(/\d/g) || []).length >= 3) return false;  // code-like serial
      return true;
    });
    if (!kept.some(t => /[a-zA-Z]/.test(t))) return '';        // a label must carry letters
    return kept.join(' ').trim();
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
    // COMMA-ORPHAN (D1, 2026-07-11): a label ending in a comma + a single stray letter ("esha, i")
    // is an OCR FRAGMENT (a word split across the strip edge), never a real caption — flag it so
    // the existing suspicious->position-only downgrade drops it instead of staging garble.
    if (/,\s*\p{L}\.?\s*$/u.test(label.trim())) return true;
    return false;
  }

  // D1 — TEACH LABEL-PICK: score a candidate caption. 2 = matches one of THIS field's own known
  // captions (a field-scoped bank — its DB labels + display label; NOT a global bank, which would
  // let a neighbouring row's 'Date' outscore the true unknown left caption); 1 = not suspicious;
  // 0 = suspicious/empty. Pure — no OCR, no DOM.
  function _normCaption(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
  function _matchesFieldCaption(label, fieldCaptions) {
    const n = _normCaption(label);
    if (!n) return false;
    return (fieldCaptions || []).some(c => _normCaption(c) === n);
  }
  function scoreLabelCandidate(label, fieldCaptions) {
    if (!label || !label.trim()) return 0;
    if (_matchesFieldCaption(label, fieldCaptions)) return 2;
    return labelLooksSuspicious(label) ? 0 : 1;
  }

  // Pick between the LEFT-strip and ABOVE-strip captions at teach time. Higher score wins; a TIE
  // goes to LEFT (the status-quo direction). BOTH 0 -> position-only (empty label, never a staged
  // garble). Returns {label, direction:'left'|'above'|null}. This replaces the left-first EARLY
  // RETURN that let a garbled left strip ('esha, i') beat a clean caption above ('Customer').
  function pickLabelCandidate(leftLabel, aboveLabel, fieldCaptions) {
    const L = (leftLabel || '').trim(), A = (aboveLabel || '').trim();
    const sL = scoreLabelCandidate(L, fieldCaptions), sA = scoreLabelCandidate(A, fieldCaptions);
    if (sL === 0 && sA === 0) return { label: '', direction: null };   // position-only
    if (sA > sL) return { label: A, direction: 'above' };
    return { label: L, direction: 'left' };                            // sL >= sA incl. tie -> LEFT
  }

  root.AnchorLabel = { nearestLeftCluster, nearestAboveRow, nearestRowTo, extractLabel, sanitizeAnchorLabel, labelLooksSuspicious, scoreLabelCandidate, pickLabelCandidate };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

// Node/test interop (the browser path uses window.AnchorLabel).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).AnchorLabel;
}
