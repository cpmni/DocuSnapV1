'use strict';

// THE ONE review-queue readiness classifier (Q4b of the Chris round-14 queue; gary → Oracle
// SIGN-OFF-W/COND C4b.1, 2026-08-22 — "two readiness notions is the forbidden class", C2.4).
//
// Home's "N ready to file" (documents.getReviewSplit) and Review's File All Ready dialog
// (renderer fileAllReady) used to classify a queue row with DIFFERENT predicates: the split had
// no "no type" leg (an UNTYPED doc has no fields → no missing-required labels → counted READY) and
// no acknowledged-flag exemption; File All had both. Chris saw "20 ready to file" over 20 docs
// with no type / no issuer / no fields. Both now call classify() on the SAME queue row shape
// (getReviewQueue's columns), so the two numbers cannot disagree.
//
//   classify(row, { valuedOnly }) →
//     'flagged' — a note / correction candidate, or a below-threshold read (VALUED only when the
//                 far_lowconf_valued_only two-tier rule is on), NOT yet acknowledged
//     'noType'  — no document type chosen (nothing can be filed)
//     'missing' — a required detail (date / reference / sender) is empty (queue row's
//                 missing_required_labels, the DB twin of validateConfirm)
//     'ready'   — files as-is
//   The ORDER is File All's skip order (flagged › noType › missing) so the held groups it names
//   partition the queue exactly as the loop then skips.
//
// Pure, dependency-free; loaded as a <script> in Review (window.ReviewReadiness) and require()d
// by database/modules/documents.js — ONE source, no mirror to drift.
(function (root) {
  function isFlagged(row, valuedOnly) {
    const below = valuedOnly ? (row && row.below_threshold_valued_count) : (row && row.below_threshold_count);
    return ((row && row.review_flag_count) || 0) > 0 || (below || 0) > 0;
  }
  function classify(row, opts) {
    const valuedOnly = !!(opts && opts.valuedOnly);
    if (!row) return 'missing';
    if (isFlagged(row, valuedOnly) && !row.review_acknowledged_at) return 'flagged';
    if (!row.type_slug) return 'noType';
    if (String(row.missing_required_labels || '').trim()) return 'missing';
    if (Number(row.issuer_blank) === 1) return 'missing';      // Chris r17 card 5b: a blank issuer is not "ready" (File All would refuse it)
    return 'ready';
  }
  /** Partition a queue into the four groups (File All's dialog + the Home split both use this). */
  function partition(rows, opts) {
    const out = { flagged: [], noType: [], missing: [], ready: [] };
    for (const r of rows || []) out[classify(r, opts)].push(r);
    return out;
  }
  root.ReviewReadiness = { classify, partition, isFlagged };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).ReviewReadiness;
}
