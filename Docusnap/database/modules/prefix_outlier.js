'use strict';
/**
 * database/modules/prefix_outlier.js
 * ----------------------------------
 * JS MIRROR of python_backend/extraction/ocr_corrector.py's prefix-outlier predicate
 * (code_prefix / build_prefix_index arming / is_prefix_outlier — WEIGHT-AWARE as of 2026-07-19),
 * so the CONFIRM-TIME gate (reviewService.confirm, Slice 1) applies the SAME rule as the
 * extraction-time guard (Slice 2). Keeping ONE rule means the UI and backend can't drift.
 *
 * Byte-parity with the python is pinned by database/modules/test_prefix_outlier.js (which spawns
 * the python predicate and compares). Keep the constants below in LOCKSTEP with ocr_corrector.py:
 *   DOMINANT_MIN_COUNT / DOMINANT_MIN_SHARE      (arming)
 *   _PREFIX_ACCEPT_MIN / _RATIO / _ABS            (the weight-aware support bar)
 *
 * This module is a PURE predicate — FLAG-ONLY behaviour (route to review, never rewrite) lives at
 * the call site. env PREFIX_OUTLIER_SUPPORT_FLOOR (shared with the python) forces a flat count bar
 * (=1 restores the pre-2026-07-19 count-1 membership immunization).
 */

const DOMINANT_MIN_COUNT  = 5;
const DOMINANT_MIN_SHARE  = 0.80;
const PREFIX_ACCEPT_MIN   = 3;
const PREFIX_ACCEPT_RATIO = 0.10;
const PREFIX_ACCEPT_ABS   = 8;

const LEAD_ALPHA = /^[A-Za-z]{2,}/;   // >=2 leading letters (precision gate; mirrors _LEAD_ALPHA_RE)

// Leading-alpha CODE prefix of a value (uppercased) — only for values that CARRY A DIGIT (a code,
// not a name); pure-numeric / digit-leading serials / single-letter prefixes -> null.
function codePrefix(value) {
  const v = String(value == null ? '' : value);
  if (!/[0-9]/.test(v)) return null;
  const m = LEAD_ALPHA.exec(v);
  return m ? m[0].toUpperCase() : null;
}

// From a scope's confirmed {value: count} map, the DOMINANT leading-alpha prefix + per-prefix
// counts + total (over ALL confirmed values). Returns null (scope DISARMED — no nag) unless one
// prefix has count >= DOMINANT_MIN_COUNT AND >= DOMINANT_MIN_SHARE of all confirmed values.
function buildScopeRec(valueCounts) {
  const counts = valueCounts || {};
  let totalAll = 0;
  for (const c of Object.values(counts)) totalAll += Math.max(1, parseInt(c, 10) || 1);
  const prefixCounts = {};
  const known = new Set();
  for (const [value, c] of Object.entries(counts)) {
    const p = codePrefix(value);
    if (!p) continue;
    prefixCounts[p] = (prefixCounts[p] || 0) + Math.max(1, parseInt(c, 10) || 1);
    known.add(p);
  }
  if (!Object.keys(prefixCounts).length || totalAll <= 0) return null;
  let domP = null, domN = -1;
  for (const [p, n] of Object.entries(prefixCounts)) if (n > domN) { domP = p; domN = n; }
  if (domN < DOMINANT_MIN_COUNT || domN < DOMINANT_MIN_SHARE * totalAll) return null;
  return { dominant: domP, known, counts: prefixCounts, total: totalAll };
}

// True when readPrefix is a SAME-LENGTH Hamming-1 neighbour of the dominant prefix whose OWN
// confirmed count is below the corpus-proportional support bar (max(MIN, ceil(RATIO*total)) OR the
// absolute escape ABS) — a likely single-glyph misread (DN->IN) to review, not trust. WEIGHT-AWARE:
// a low-count known stray (self-poison) still flags; an established second prefix self-heals.
// floorOverride (or env PREFIX_OUTLIER_SUPPORT_FLOOR) forces a flat count bar (1 = the old rule).
function isPrefixOutlier(readPrefix, rec, floorOverride) {
  if (!readPrefix || !rec) return false;
  const dom = rec.dominant;
  if (!dom || readPrefix === dom) return false;
  if (readPrefix.length !== dom.length) return false;
  let d = 0;
  for (let i = 0; i < dom.length; i++) if (readPrefix[i] !== dom[i]) d++;
  if (d !== 1) return false;
  const counts = rec.counts || {};
  const total  = parseInt(rec.total, 10) || 0;
  const c = parseInt(counts[readPrefix], 10) || 0;
  let floor = (floorOverride != null) ? floorOverride : process.env.PREFIX_OUTLIER_SUPPORT_FLOOR;
  if (floor != null && floor !== '' && Number.isFinite(+floor)) return !(c >= +floor);
  const thr = Math.max(PREFIX_ACCEPT_MIN, Math.ceil(PREFIX_ACCEPT_RATIO * total));
  return !(c >= PREFIX_ACCEPT_ABS || c >= thr);
}

// Convenience for the confirm gate: {outlier, prefix, dominant}. Non-code values (no prefix) and a
// disarmed/absent scope are never outliers.
function checkValue(value, rec, floorOverride) {
  const prefix = codePrefix(value);
  const dominant = rec ? rec.dominant : null;
  if (!prefix || !rec) return { outlier: false, prefix, dominant };
  return { outlier: isPrefixOutlier(prefix, rec, floorOverride), prefix, dominant };
}

module.exports = {
  codePrefix, buildScopeRec, isPrefixOutlier, checkValue,
  DOMINANT_MIN_COUNT, DOMINANT_MIN_SHARE, PREFIX_ACCEPT_MIN, PREFIX_ACCEPT_RATIO, PREFIX_ACCEPT_ABS,
};
