'use strict';
/**
 * src/lib/nameLookup.js — the ONE shared matcher for Quick File Records-list typeahead + import dedupe
 * (reggie's design; Oracle C3 — token-PREFIX, never a substring/first-token-only degrade). Built on the
 * existing compare-time normaliser (database/modules/text_normalise.normaliseForTokens) plus two name-only
 * steps (diacritic strip + apostrophe/dot join + hyphen split). Pure, dependency-free, JS-only — the Quick
 * File lane has no Python/OCR consumer, so there is NO Python twin (a future /v1 lookup must mirror this).
 *
 * Rule: a record matches iff EVERY query token is a prefix of a DISTINCT record token.
 *   "doe"   → "John Doe"     (surname token prefix)
 *   "jo do" → "John Doe"     (two token prefixes)
 *   "ann"   → NOT "Susanna"  (a substring is not a token prefix — precision)
 */
const { normaliseForTokens } = require('../../database/modules/text_normalise');

// Name match-key: shared normaliser, then NAME-only folding. Diacritics stripped (Áine→aine), intra-name
// punctuation JOINED (O'Brien→obrien, St.→st), double-barrelled SPLIT (Smith-Jones→smith jones).
function nameMatchTokens(s) {
  const base = normaliseForTokens(s);
  if (!base) return [];
  const folded = base
    .normalize('NFD').replace(/\p{M}+/gu, '')   // strip combining marks (diacritics)
    .replace(/['.]/g, '')                        // join apostrophes/dots
    .replace(/-/g, ' ');                         // split hyphens
  return folded.split(' ').filter(Boolean);
}

// Every query token must prefix a DISTINCT record token (order-independent).
function nameMatches(qTokens, rTokens) {
  if (!qTokens.length) return false;
  const used = new Array(rTokens.length).fill(false);
  return qTokens.every((q) => {
    const i = rTokens.findIndex((r, k) => !used[k] && r.startsWith(q));
    if (i < 0) return false;
    used[i] = true; return true;
  });
}

// Rank tier for a matched record (lower = better): 0 exact, 1 whole-key prefix, 2 front-anchored
// token-prefix (first query token prefixes the first record token), 3 any-order token-prefix.
function _tier(qNorm, qTokens, rNorm, rTokens) {
  if (qNorm === rNorm) return 0;
  if (rNorm.startsWith(qNorm)) return 1;
  if (rTokens.length && qTokens.length && rTokens[0].startsWith(qTokens[0])) return 2;
  return 3;
}

/**
 * Filter + rank records against a query (token-prefix). Precision-first, no fuzzy typo tolerance.
 * @param records [{ id, master_value, ... }]
 * @param query   the raw typed string
 * @param opts    { limit=8 }
 * @returns matched records (input objects, untouched) sorted by (tier, fewer tokens, alpha), capped;
 *          plus a `_more` count of matches beyond the cap on the LAST element is NOT added — callers
 *          get `{ rows, total }` from rankMatches for the "+N more" affordance.
 */
function rankMatches(records, query, opts = {}) {
  const limit = Math.max(1, opts.limit || 8);
  const qNorm = normaliseForTokens(query);
  const qTokens = nameMatchTokens(query);
  if (!qTokens.length) return { rows: [], total: 0 };
  const hits = [];
  for (const rec of (records || [])) {
    const rNorm = normaliseForTokens(rec.master_value);
    const rTokens = nameMatchTokens(rec.master_value);
    if (!nameMatches(qTokens, rTokens)) continue;
    hits.push({ rec, tier: _tier(qNorm, qTokens, rNorm, rTokens), toks: rTokens.length, key: rNorm });
  }
  hits.sort((a, b) => (a.tier - b.tier) || (a.toks - b.toks) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { rows: hits.slice(0, limit).map((h) => h.rec), total: hits.length };
}

module.exports = { nameMatchTokens, nameMatches, rankMatches };
