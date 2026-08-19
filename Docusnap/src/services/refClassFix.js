'use strict';
/**
 * src/services/refClassFix.js — the PURE half of the human-licensed class correction.
 * ----------------------------------------------------------------------------------
 * reggie + gary design → Oracle SIGN-OFF-WITH-CONDITIONS, 2026-08-19.
 *
 * THE OWNER'S ASK: "If enough docs exist to confirm it is always PI, accept it — or even ask once.
 * After ONE click to confirm, the system updates the other documents automatically. It should NOT
 * then ask 'do you wish to update the other 12?' — if the user has already told us it is correct,
 * there is no need for a second dialog."
 *
 * WHAT THIS FILE IS. Three pure functions, no database, no I/O, no side effects — so the licensing
 * rules can be pinned exhaustively without a fixture DB. `classFixService.js` owns every write.
 *
 * THE NARROW RULE (reggie and gary independently, and it is the whole safety story). Correcting a
 * `P1/` does NOT license rewriting a `PL/`. Only the OBSERVED substitution propagates. The measured
 * cost on the round-9 corpus is that the owner types TWO corrections instead of twelve — `P1/`×8
 * and `PL/`×4 — and each wrong form gets its own explicit human licence. The GENERALISED rule (any
 * confusable glyph, licensed by history) already exists as the engine's P adopt lane, which carries
 * a required page witness precisely because nobody licensed it by hand.
 *
 * WHY HEAD LENGTH IS MEASURED ON THE CORRECTED VALUE. `code_prefix` needs >=2 leading LETTERS. The
 * whole point of this class is that the misread destroys that: `P1/26/3130` has no extractable
 * prefix at all, while `PI/26/3130` has `PI`. Measure the head on the wrong side and every `P1`
 * case silently declines — the exact failure reggie flagged as "silently kills every P1 case".
 */

const { normaliseForTokens } = require('../../database/modules/text_normalise');

/**
 * OCR-confusable equivalence classes, PINNED to the engine's `_PREFIX_CONFUSE_CLASSES`
 * (python_backend/extraction/engine.py). Cross-language pin: test_ref_class_fix.js asserts these
 * are byte-identical to the Python tuple, so widening one side alone goes red. The documented
 * decisions live on the Python side and are not restated here — one source of truth for the
 * REASONS, two copies of the DATA, and a test that stops them drifting.
 */
const CONFUSE_CLASSES = Object.freeze([
  '1Iil|][L', '0OoQ', '5Ss$', '2Zz', '8B', '7T', '6Gb', '9gq', 'E€£',
].map(s => Object.freeze(new Set(s))));

/** Compare-time normalisation — the JS twin of engine `_cmp_norm` (normalise, then collapse ALL
 *  whitespace so '6 102' == '6102'). Idempotent, which is what lets the Python side hand this
 *  predicate an already-normalised bucket and still get the same answer. */
function cmpNorm(value) {
  return normaliseForTokens(value).split(' ').filter(Boolean).join('');
}

function sameClass(a, b) {
  return a !== b && CONFUSE_CLASSES.some(c => c.has(a) && c.has(b));
}

/** Length of the leading-alpha CODE prefix — the JS twin of `ocr_corrector.code_prefix`'s
 *  `^[A-Za-z]{2,}` gate, including its "must contain a digit somewhere" code test. 0 when there
 *  is none (a pure name, a digit-leading serial, or a single-letter prefix). */
function codePrefixLen(value) {
  const v = String(value == null ? '' : value);
  if (!/[0-9]/.test(v)) return 0;                       // a CODE, never a name
  const m = /^[A-Za-z]{2,}/.exec(v);
  return m ? m[0].length : 0;
}

/**
 * Read a human correction and decide whether it is a class fix at all.
 * Returns a frozen rule, or null (which is the answer for the overwhelming majority of edits —
 * a typo repair, a re-keyed reference, a different document entirely).
 *
 * ALL of these must hold:
 *   • same length, differing in EXACTLY ONE character position;
 *   • that pair is in the pinned confusable table (case-SENSITIVE: the classes carry both cases
 *     deliberately, so 'P1'->'PI' matches while 'p1'->'PI' does not — a case change is a different
 *     edit and gets no licence here);
 *   • the corrected value HAS a code prefix, and the diff sits INSIDE it;
 *   • the suffix is byte-identical — asserted explicitly rather than inferred from the single-diff
 *     test, because that is the invariant a future reader will rely on.
 */
function deriveClassFix(fromVal, toVal) {
  const from = String(fromVal == null ? '' : fromVal);
  const to   = String(toVal   == null ? '' : toVal);
  if (!from || !to || from === to || from.length !== to.length) return null;

  let idx = -1;
  for (let i = 0; i < from.length; i++) {
    if (from[i] === to[i]) continue;
    if (idx !== -1) return null;                        // a second difference — not this class
    idx = i;
  }
  if (idx === -1) return null;

  const a = from[idx], b = to[idx];
  if (!sameClass(a, b)) return null;

  const headLen = codePrefixLen(to);                    // ON THE CORRECTED VALUE — see the header
  if (!headLen || idx >= headLen) return null;
  if (from.slice(headLen) !== to.slice(headLen)) return null;   // suffix, asserted post-hoc

  return Object.freeze({
    fromHead: from.slice(0, headLen), toHead: to.slice(0, headLen),
    headLen, idx, a, b,
  });
}

/**
 * Apply a rule to one sibling value. Returns the new value, or null when the rule does not reach
 * it — which is the common case and must stay cheap and silent.
 *
 * Refuses: a value shorter than the head; a head that is not byte-equal to the corrected value's
 * WRONG head; a no-op (already correct — idempotent by construction, so a double-run is harmless);
 * and anything whose round trip is not licensed by `deriveClassFix` at the SAME position with the
 * SAME glyph pair and the SAME head length. That last check is what stops a suffix from quietly
 * changing the head's meaning — e.g. a sibling reading `P1X/…` would derive a three-letter head.
 */
function applyClassFix(siblingVal, rule) {
  const s = String(siblingVal == null ? '' : siblingVal);
  if (!s || !rule || s.length <= rule.headLen) return null;
  if (s.slice(0, rule.headLen) !== rule.fromHead) return null;

  const out = rule.toHead + s.slice(rule.headLen);
  if (out === s) return null;

  const back = deriveClassFix(s, out);
  if (!back || back.idx !== rule.idx || back.a !== rule.a
      || back.b !== rule.b || back.headLen !== rule.headLen) return null;
  return out;
}

/**
 * BOTH FORMS ESTABLISHED — the one shared refusal, over the one shared evidence set.
 *
 * True when the scope's confirmed history already holds the READ's form often enough to be a
 * second convention rather than a misread. The engine treats that as a hard veto (an established
 * second convention is DATA); the confirm path treats it as the trigger for a single ask.
 *
 * Oracle premise correction (2026-08-19): the Python twin consumes `confirmed_counts_index`, whose
 * keys are ALREADY `_cmp_norm`-collapsed, while the JS `value_counts` keys are raw trimmed strings.
 * A predicate written over raw keys with a case-sensitive compare is therefore NOT the same
 * predicate, and a shared fixture would green anyway unless it contains mixed-case and
 * separator-variant rows. So this function normalises BOTH sides itself (`cmpNorm` is idempotent,
 * so handing it a pre-normalised bucket is safe), and the shared fixture carries exactly those two
 * awkward rows. Bar: `max(3, ceil(0.10 * n))`, identical to the engine's.
 *
 * @param {object|Map} valueCounts  confirmed value -> count, for one (supplier, type, field)
 * @param {string}     head         the read's head, e.g. 'P1'
 */
function bothFormsEstablished(valueCounts, head) {
  const headNorm = cmpNorm(head);
  if (!headNorm) return false;
  const entries = (valueCounts instanceof Map)
    ? Array.from(valueCounts.entries())
    : Object.entries(valueCounts || {});
  let total = 0, same = 0;
  for (const [v, n] of entries) {
    const c = Number(n) || 0;
    if (c <= 0) continue;
    total += c;
    if (cmpNorm(v).slice(0, headNorm.length) === headNorm) same += c;
  }
  if (!total) return false;
  return same >= Math.max(3, Math.ceil(0.10 * total));
}

/**
 * PAGE WITNESS — the JS twin of engine `_page_carries_sepless` (leg 1 of Gate-C page-match v2).
 * "Is this exact string printed on the page?", allowing only for retokenisation: sepless equality
 * against a single token or a join of 2-3 CONSECUTIVE tokens ON THE SAME LINE. A cross-line join
 * is manufactured adjacency and is refused.
 *
 * ⚠ LEG 1 ONLY, for the same reason stated at length on the Python side: leg 2 is a backed-
 * CONFUSABLE tolerance, and as a witness for a candidate that is itself a one-glyph variant it
 * would let the misread witness its own correction. Never widen this.
 *
 * Here it answers Tier 2 — "does THIS document's own page agree?" — which is the only evidence
 * that may clear a blocking note on a document the operator has not looked at.
 */
function pageCarriesSepless(pageText, value) {
  const strip = s => String(s == null ? '' : s).toLowerCase().replace(/[^0-9a-z]+/g, '');
  const sv = strip(value);
  if (sv.length < 4) return false;                      // too short to judge — same bar as Python
  for (const line of String(pageText == null ? '' : pageText).split(/\r?\n/)) {
    const words = line.split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      for (let j = i + 1; j <= Math.min(i + 3, words.length); j++) {
        if (strip(words.slice(i, j).join('')) === sv) return true;
      }
    }
  }
  return false;
}

module.exports = {
  deriveClassFix, applyClassFix, bothFormsEstablished, pageCarriesSepless,
  cmpNorm, codePrefixLen, sameClass, CONFUSE_CLASSES,
};
