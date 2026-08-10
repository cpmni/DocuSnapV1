'use strict';
/*
 * boxSnap.js — snap a hand-drawn box to the WORDS underneath it.
 *
 * A human draws a generous-or-clipping rectangle; the words underneath know the truth. This
 * re-reads a slightly WIDER band around the drawn box, converts its word boxes to page
 * coordinates, admits ONLY the words the DRAWN box actually touches, and returns the union of
 * those words as the box to keep.
 *
 * THE CORE INVARIANT (do not weaken it): the snap FINISHES a nicked word — 'Stu[dio]' becomes
 * 'Studio' — it NEVER reaches out to a token the drawn box did not already touch. That is what
 * keeps a snap from quietly swallowing the neighbouring column, and it is why admission is an
 * intersection test against the drawn rectangle rather than a proximity test.
 *
 * Lifted VERBATIM (same maths, same guards, same order) from the teach wizard's `snapDrawnBox`,
 * which shipped 2026-08-04 after a gary design and an owner GO. It lives here so the teach wizard
 * and the Template Manager share ONE implementation instead of growing two that drift — the same
 * reason the type EDITOR and the doc-type CATALOG were made shared components.
 *
 * FRAME CONTRACT — the caller owns the frame, and it must be consistent:
 *   `box` is normalised against the SAME image `cropB64` crops from. If the caller is displaying
 *   a straightened page, the crop must come from that straightened bitmap and the returned box is
 *   in the straightened frame too. Mixing frames here would put the box on the wrong words.
 * RESOLUTION CONTRACT: `cropB64` MUST crop at NATIVE resolution (no downscale). Word boxes come
 *   back in crop pixels and are divided by natW/natH, so a downscaled crop silently mis-scales
 *   every word.
 *
 * Returns `{ box, text }` on success, or null to mean "keep the drawn box" — every guard below
 * fails CLOSED to the human's rectangle rather than guessing.
 */
(function (root) {
  /**
   * @param {{x,y,w,h}} box            drawn box, page-normalised
   * @param {object} opts
   *   @param {number} opts.natW       natural pixel width of the displayed image
   *   @param {number} opts.natH       natural pixel height
   *   @param {function} opts.cropB64  async ({x,y,w,h} page-norm) → base64 PNG, NATIVE resolution
   *   @param {function} opts.ocrRegionBoxes async (b64) → { words: [{ text, box:[l,t,w,h] }] }
   *   @param {number} [opts.labelRightEdge] page-norm x: drop any word centred at or left of this
   *          (never re-absorb the tail of a label sitting to the LEFT of the value)
   */
  async function snapBoxToWords(box, opts) {
    const { natW, natH, cropB64, ocrRegionBoxes, labelRightEdge } = opts || {};
    if (!box || !natW || !natH || typeof cropB64 !== 'function' || typeof ocrRegionBoxes !== 'function') return null;

    // Re-read a band ~1.2 line-heights wider sideways and a little taller, so a word the drawn
    // box only nicked is present WHOLE in the OCR result and can be completed.
    const padXn = (box.h * natH * 1.2) / natW;
    const padYn = box.h * 0.35;
    const band = {
      x: Math.max(0, box.x - padXn),
      y: Math.max(0, box.y - padYn),
      w: Math.min(1 - Math.max(0, box.x - padXn), box.w + 2 * padXn),
      h: Math.min(1 - Math.max(0, box.y - padYn), box.h + 2 * padYn),
    };

    let res = null;
    try { res = await ocrRegionBoxes(await cropB64(band)); } catch { return null; }
    const raw = (res && res.words) || [];
    if (!raw.length) return null;

    // Crop px → page-norm. Valid ONLY because the crop is native-resolution (see the contract).
    const words = [];
    for (const wd of raw) {
      const b = wd && wd.box;
      if (!Array.isArray(b) || b.length < 4) continue;
      const [l, t, w, h] = b;
      if (!(w > 0 && h > 0)) continue;
      words.push({ text: String(wd.text || ''), x: band.x + l / natW, y: band.y + t / natH,
                   w: w / natW, h: h / natH });
    }
    if (!words.length) return null;

    // Admit only what the DRAWN box touches — the core invariant.
    const bx2 = box.x + box.w, by2 = box.y + box.h;
    let admitted = words.filter((wd) => {
      const ix = Math.max(0, Math.min(bx2, wd.x + wd.w) - Math.max(box.x, wd.x));
      const iy = Math.max(0, Math.min(by2, wd.y + wd.h) - Math.max(box.y, wd.y));
      return ix > 0 && iy > 0;
    });
    if (!admitted.length) return null;

    // Never re-absorb the tail of a label to the left.
    if (Number.isFinite(labelRightEdge)) {
      admitted = admitted.filter((wd) => wd.x + wd.w / 2 > labelRightEdge);
      if (!admitted.length) return null;
    }

    // Single-row scope: a deliberate multi-row draw (an address block) keeps its drawn box.
    const cys = admitted.map((wd) => wd.y + wd.h / 2).sort((a, b) => a - b);
    const medH = admitted.map((wd) => wd.h).sort((a, b) => a - b)[admitted.length >> 1] || box.h;
    if (cys[cys.length - 1] - cys[0] > medH * 0.8) return null;

    const x1 = Math.min(...admitted.map((wd) => wd.x));
    const x2 = Math.max(...admitted.map((wd) => wd.x + wd.w));
    const y1 = Math.min(...admitted.map((wd) => wd.y));
    const y2 = Math.max(...admitted.map((wd) => wd.y + wd.h));
    const pad = Math.min(0.004, box.h * 0.15);
    const snapped = {
      x: Math.max(0, x1 - pad), y: Math.max(0, y1 - pad),
      w: Math.min(1, x2 + pad) - Math.max(0, x1 - pad),
      h: Math.min(1, y2 + pad) - Math.max(0, y1 - pad),
    };
    // Over-grab cap: a snap that quadruples the drawn area is not a correction, it is a mistake.
    if (snapped.w * snapped.h > 4 * Math.max(box.w * box.h, 1e-9)) return null;

    const text = admitted.sort((a, b) => a.x - b.x).map((wd) => wd.text).join(' ').trim();
    return { box: snapped, text: text || null };
  }

  // A native-resolution crop from an <img>, in the shape snapBoxToWords expects. Both callers
  // need exactly this, and getting the downscale wrong silently mis-scales every word box — so
  // it ships beside the contract that depends on it.
  function makeNativeCropper(img) {
    return async function cropB64(b) {
      const natW = img.naturalWidth, natH = img.naturalHeight;
      const x = Math.max(0, b.x * natW), y = Math.max(0, b.y * natH);
      const w = Math.min(natW - x, b.w * natW), h = Math.min(natH - y, b.h * natH);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
      c.getContext('2d').drawImage(img, x, y, w, h, 0, 0, c.width, c.height);
      return c.toDataURL('image/png').split(',')[1];
    };
  }

  root.BoxSnap = { snapBoxToWords, makeNativeCropper };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

// Node/test interop (the browser path uses window.BoxSnap).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).BoxSnap;
}
