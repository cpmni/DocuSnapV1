'use strict';

/**
 * modules/processing/slip_pack.js — PURE helpers for the "Print separator sheets"
 * pack generation (Filing Slips slice 2, docs/designs/FILING_SLIPS_2026-07-18.md §5).
 * No deps — unit-tested by test_slip_pack.js.
 *
 * Numbering is a settings counter (`filing_slip_next_number`): numbers are LABELS,
 * not tokens — reuse of printed sheets is fine forever; the counter only stops fresh
 * packs colliding on one desk. 4-digit space, wraps by restarting the whole pack at 1
 * when it would pass 9999 (mixed-wrap packs like 9999,0001 would muddy the printed
 * range name and the slice-6 OCR rescue rung).
 */

const pad4 = (n) => String(n).padStart(4, '0');

// Invalid input falls back to the UI default (10); valid input clamps to 1–50.
function clampSlipCount(n) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return 10;
  return Math.max(1, Math.min(50, v));
}

function nextSlipRange(current, count) {
  let first = Math.floor(Number(current));
  if (!Number.isFinite(first) || first < 1 || first > 9999) first = 1;
  if (first + count - 1 > 9999) first = 1;          // restart the pack rather than mixed-wrap
  const last = first + count - 1;
  const next = last >= 9999 ? 1 : last + 1;
  return { first, last, next };
}

function slipPackName(first, last) {
  return `Filing slips ${pad4(first)}-${pad4(last)}.pdf`;
}

module.exports = { clampSlipCount, nextSlipRange, slipPackName, pad4 };
