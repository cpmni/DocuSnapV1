'use strict';
/*
 * suggestTeach.js — the pure classifier behind the SUGGESTED-TEACH picker (Slice 1, 2026-09-25).
 *
 * WHY THIS EXISTS. When an operator teaches a field on the ⊕ Review readout, instead of making them
 * draw a box we reconstruct the box the machine already read (region.py --page-words → string-match
 * the committed value → its box, via ValueLocate.locateValueInWords). This module takes the candidate
 * value(s) for one field and the page's words and decides ONE thing: how many distinct places on the
 * page the value(s) sit — which drives the three UI states:
 *   - none     → no run reproduces the value on this frame → fall back to a manual draw (no regression).
 *   - unique   → exactly one box → pre-fill it as a single suggestion (after the renderer's verify).
 *   - multiple → two or more location-distinct boxes → show the PICKER and NEVER auto-pick.
 *
 * The Oracle census (TESTING/_measure/teach_reconstruction_census_20260925) proved the whole measured
 * ambiguity is SAME-VALUE-multiple-boxes (Ironclad statements list the ref/date several times; Pelican
 * prints the ref twice), so for Slice 1 the caller passes a single-element [currentValue] — the extra
 * multi-VALUE candidate case (two different labels) is a deferred engine slice.
 *
 * PURE + GEOMETRY-ONLY, exactly like ValueLocate: no score, no verdict, no I/O. A located box is
 * evidence about WHERE, never WHETHER — the placement verify + the human's confirm/pick earn the right
 * to promote a box to an anchor. This module must not be treated as corroboration of the value.
 */
(function (root) {
  const ValueLocate = root.ValueLocate ||
    (typeof require === 'function' ? require('./valueLocate.js') : null);

  const MAX_BOXES = 6;   // mirror ValueLocate.MAX_HITS: a value printed more times has no useful pick set

  // Same rounded-coord key ValueLocate dedupes with, so the same physical box found via two candidate
  // values collapses to one pick.
  function boxKey(box) {
    return [box.x, box.y, box.w, box.h].map((v) => Math.round(v * 2000)).join(':');
  }

  /**
   * @param {Array<string>|string} candidateValues  the field's value(s) to locate (Slice 1: [currentValue])
   * @param {object} opts  { words:[{t,b:[l,t,w,h]}], natW, natH } — one ocr-page-words result frame
   * @returns {{state:'none'|'unique'|'multiple', boxes:Array<{box,text,wordCount,value}>}}
   *   boxes are page-normalised (ValueLocate frame), deduped across candidate values by physical box,
   *   capped at MAX_BOXES, each tagged with the candidate `value` that produced it (for the picker copy).
   */
  function suggestTeachState(candidateValues, opts) {
    const values = Array.isArray(candidateValues) ? candidateValues : [candidateValues];
    const boxes = [];
    const seen = new Set();
    if (ValueLocate && typeof ValueLocate.locateValueInWords === 'function') {
      for (const v of values) {
        if (v == null || String(v).trim() === '') continue;
        const hits = ValueLocate.locateValueInWords(v, opts) || [];
        for (const h of hits) {
          const key = boxKey(h.box);
          if (seen.has(key)) continue;
          seen.add(key);
          boxes.push({ box: h.box, text: h.text, wordCount: h.wordCount, value: v });
          if (boxes.length >= MAX_BOXES) break;
        }
        if (boxes.length >= MAX_BOXES) break;
      }
    }
    const state = boxes.length === 0 ? 'none' : boxes.length === 1 ? 'unique' : 'multiple';
    return { state, boxes };
  }

  root.SuggestTeach = { suggestTeachState, MAX_BOXES };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

// Node/test interop (the browser path uses window.SuggestTeach after valueLocate.js loads first).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).SuggestTeach;
}
