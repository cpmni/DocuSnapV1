'use strict';
/*
 * name_proximity.js — "are these two strings the SAME company, one misread?"
 *
 * THE DEFECT THIS EXISTS FOR (Chris round 4, verified in the sandbox DB and on disk).
 * An operator drew a slightly-off box on their own company name. OCR read
 * 'B8ramblewood Joinery Ltd'. The teach OVERWROTE template 13's already-frozen identity —
 * `template_fields.fixed_value`, `is_variable=0` — replacing a value backed by 38 confirmations
 * with one draw-box read of one crop. The template then stamped 20 sibling purchase orders via
 * `template_fixed` at 95 with an EMPTY validation_note, so every auto-file gate passed them; 20
 * were confirmed and 12 were written to disk under `Output\B8ramblewood-Joinery-Ltd\`. The
 * garble also became a learning SCOPE key.
 *
 * The write had exactly one guard — `fixed_locked = 1` — and NEVER COMPARED WARRANTS.
 *
 * WHY A SEPARATE MODULE, AND WHY THESE NUMBERS.
 * Python already owns this comparison for the READ side: name_match.similar_identity /
 * near_match_identity decide whether a Stage-0.5 mapping READ may displace a curated
 * `fixed_value`. That seam carries Oracle condition C3 — "do NOT widen the budget past 1" —
 * and this module deliberately does NOT touch it. This is the INVERSE and much rarer question,
 * asked at the WRITE side about a value that is about to BECOME the stored identity, where the
 * candidate set is exactly ONE string (the value being replaced). A different seam, so its own
 * budget; the C3 ruling is untouched and unwidened.
 *
 * SIMILARITY, NOT AN EDIT BUDGET ALONE — measured, because the budget alone cannot separate the
 * cases:
 *     'B8ramblewood Joinery Ltd' vs 'Bramblewood Joinery Ltd'  = 1 edit / 22 = 0.955
 *     'Brambleworth Joinery Ltd' vs 'Bramblewood Joinery Ltd'  = 3 edits / 22 = 0.864   <- a
 *                                                        GENUINELY DIFFERENT company
 * Both clear a bare 0.75 floor, so BOTH legs are required: a similarity floor AND a hard edit
 * cap. The cap is what separates them here.
 *
 * THE INVARIANT THIS MUST NOT BREAK: a genuinely DIFFERENT company must still be able to
 * displace a stored identity, or a wrong frozen name could never be corrected by re-teaching —
 * which is its own trap, and the reason this refuses only NEAR matches and passes everything
 * else straight through.
 *
 * Metric choice (reggie, 2026-08-14): Levenshtein on the alnum fold normalised by the longer
 * string — i.e. the shipped `similar_identity`. NOT Jaro-Winkler: its prefix bonus systematically
 * under-scores this product's documented corruption class, which hits the FIRST glyph constantly
 * ('lronciad'/'Ironclad', 'astellan'/'Castellan', 'Sramblewood'/'Bramblewood'). NOT a token-set
 * ratio: 'Smith Ltd' vs 'Smith Roofing Ltd' scores 100, which would merge real businesses.
 *
 * PARITY NOTE. `foldIdentity` mirrors Python's `name_match.fold_identity`
 * (`''.join(c.lower() for c in v if c.isalnum())`). Python's `str.isalnum()` is Unicode-aware, so
 * the fold here uses \p{L}/\p{N} rather than [a-z0-9] — an ASCII-only fold would silently drop
 * accented letters and make 'Nestlé' and 'Nestl' identical. Keep the two in step.
 */

// Fold length below which a name carries too little signal to judge — mirrors
// name_match._NEAR_MATCH_MIN_FIXED_LEN. Short names ('BP', 'IBM', '3M', 'EE', 'O2') are
// structurally excluded: in a 2-4 character identity a single substitution is a 25-50% change
// with no linguistic redundancy to detect it, so those must be exact or nothing.
const MIN_FOLD_LEN = 8;
// Hard edit cap on the fold. Deliberately 2, not the read side's 1 (see header): the exhibit is
// 1 edit, and 2 covers the doubled-glyph and dropped-glyph variants of the same class while
// still refusing 'Brambleworth' at 3.
const MAX_EDITS = 2;
// Similarity floor. Not a tuned constant — a genuinely different company scores ~0.2 against a
// stored name, so 0.75 sits in open space. Mirrors name_match._NEAR_MATCH_MIN_SIMILARITY.
const MIN_SIMILARITY = 0.75;

function foldIdentity(v) {
  return String(v == null ? '' : v).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[n];
}

/** Similarity of two company names on the alnum fold, 0..1. Twin of name_match.similar_identity. */
function similarIdentity(a, b) {
  const fa = foldIdentity(a), fb = foldIdentity(b);
  if (!fa || !fb) return 0;
  return 1 - (levenshtein(fa, fb) / Math.max(fa.length, fb.length));
}

/**
 * Is `candidate` the SAME company as `existing`, misread?
 *
 * Returns a verdict object rather than a bare boolean so callers can LOG WHY — a silent refusal
 * with no recorded reason is how this class stayed invisible for four review rounds.
 *   { near, reason, distance, similarity }
 *
 * `near` is true ONLY for a near-miss of a sufficiently long stored name. Identical values, short
 * names, and genuinely different companies all return false, each with its own reason.
 */
function nearMatchIdentity(candidate, existing) {
  const fc = foldIdentity(candidate), fe = foldIdentity(existing);
  const out = (near, reason, distance = null, similarity = null) =>
    ({ near, reason, distance, similarity });
  if (!fc || !fe) return out(false, 'empty');
  if (fc === fe) return out(false, 'identical', 0, 1);
  // Judge the length of the STORED name: it is the thing carrying the warrant.
  if (fe.length < MIN_FOLD_LEN) return out(false, 'stored-name-too-short');
  const d = levenshtein(fc, fe);
  const sim = 1 - (d / Math.max(fc.length, fe.length));
  if (d > MAX_EDITS) return out(false, 'different-company', d, sim);
  if (sim < MIN_SIMILARITY) return out(false, 'different-company', d, sim);
  return out(true, 'near-match', d, sim);
}

module.exports = {
  foldIdentity, levenshtein, similarIdentity, nearMatchIdentity,
  MIN_FOLD_LEN, MAX_EDITS, MIN_SIMILARITY,
};
