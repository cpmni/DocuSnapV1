'use strict';
/**
 * format_consistency.js — the ONE JS home of validator.py's document-level format-consistency
 * PENALTY constants (`_FC_MISMATCH_BASE/STEP/CAP`, python_backend/extraction/validator.py).
 *
 * Two JS scorers mirror the Python document score (a valued key field carrying a validation_note is a
 * MISMATCH; the first costs BASE, each further one STEP more, capped at CAP):
 *   - src/services/charsetAcceptService.js recomputeOverall (charset accept, 2026-09-01)
 *   - src/modules/processing/handler.js quickRescoreMerged (Quick-reprocess rescore, 2026-09-24)
 * Each used to carry its own copy of the three numbers — a drift seam (Oracle C2, 2026-09-24). They
 * now both read them from here, and test_format_consistency_twin.js FAILS on a one-sided bump by
 * reading validator.py's literals at test time.
 *
 * The positive BOOST leg (learned-format support) is deliberately NOT mirrored: it needs the engine's
 * Python-only format_class_index, so every JS score is a conservative lower bound (never above what
 * the engine would give for the same rows).
 */
const FC_MISMATCH_BASE = 12;   // penalty for the first mismatched field
const FC_MISMATCH_STEP = 6;    // extra penalty per additional mismatched field
const FC_MISMATCH_CAP  = 25;   // most we ever subtract

/** Document delta for `mismatched` valued+noted key fields: 0, -12, -18, -24, -25, -25 … */
function mismatchDelta(mismatched) {
  const n = Number(mismatched) || 0;
  return n > 0 ? -Math.min(FC_MISMATCH_CAP, FC_MISMATCH_BASE + FC_MISMATCH_STEP * (n - 1)) : 0;
}

module.exports = { FC_MISMATCH_BASE, FC_MISMATCH_STEP, FC_MISMATCH_CAP, mismatchDelta };
