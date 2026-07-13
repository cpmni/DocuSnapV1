"""Character-language "wordness" + structure signals for free-text NAME fields.

Catches free-text supplier/customer reads that are NOT credible names so the review
layer can FLAG them (never reject — review-not-reject). Designed from a measured
failure breakdown of 112 wrong name reads and a reggie pattern review; the levers, in
ROI order for that failure mix:

  1. DOCUMENT-CHROME stoplist (prefix-aware) — a name field that grabbed a heading
     ("INVOI", "INVO", "Total", "urgent"). Highest ROI, ~0 false-flag (no supplier is
     named "INVOICE"). [25% of failures]
  2. REF-BLEED / digit-fraction — a name field that grabbed a reference/code
     ("INV-2026021", "REM-2026037"). [3%]
  3. CHARACTER TRIGRAM wordness — an INTERPOLATED trigram language model (trained
     offline on public-domain word + US-census name lists, see build_wordness_table.py).
     Interpolation/backoff is the key false-flag defence: a novel trigram inside a real
     coined brand ("Crestwave", "Tideway") still scores via its bigram/unigram mass
     instead of collapsing to the smoothing floor. Catches improbable-cluster OCR
     ("Usiities") + short non-word fragments. [part of the 39% word-shaped + garble]

NOT this signal's job (documented limits): clean real-word substitutions ("Club"->"Chub")
and real-word truncations ("Joinery") — character statistics cannot separate those from
a real name. They are the per-supplier lexicon / history (name_match) path.

FLAG-ONLY: returns a short note string or None; it never changes the winning value. It
is an extraction-time confidence input, NOT a user-editable validation pattern — it is
deliberately NOT in config validation_patterns and has no renderer mirror.

Offline + dependency-free: ships only data/char_trigrams.json (~93 KB).
"""
from __future__ import annotations
import json
import math
import os
import re
from functools import lru_cache

from extraction.value_quality import ABBREV, COMMON_WORDS

_START = "^"
_DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "char_trigrams.json")

# Interpolation weights λ3,λ2,λ1,λ0 (trigram, bigram, unigram, uniform). Heavy on the
# trigram, with real backoff mass so coined brand tokens are not floored.
_LAMBDA = (0.6, 0.3, 0.09, 0.01)

# A token whose interpolated mean log-prob/trigram is below this is "not word-like".
# Calibrated on the synthetic corpus: across the sweep the false-flag rate on CORRECT
# supplier/customer names stayed ~0% (the multi-word majority-bad aggregation protects
# legitimate names) while the header/garble classes are caught. Conservative by design —
# false-flagging a real name is the cardinal risk. See tests/test_wordness.py.
WEAK_TOKEN_LOGPROB = -3.3
# A single clearly-garbled token drags the whole value down even inside a longer name.
_HARD_FLOOR = -4.2
_MIN_TOKEN_LEN = 3

# A name field that grabbed a reference/code: a short alpha prefix glued to a long digit
# run, or a value that is mostly digits.
_REF_BLEED = re.compile(r"[A-Za-z]{1,5}[-\s/]?\d{4,}")

# Document "chrome" headings sometimes captured into a name field. Tiny + generic; the
# trigram covers the long tail. Matched at TOKEN level by equality OR prefix-of (so an
# OCR clip "INVOI"/"INVO"/"STMT" of "INVOICE"/"STATEMENT" is caught).
_CHROME = {
    "invoice", "receipt", "statement", "remittance", "order", "purchase", "delivery",
    "quotation", "quote", "estimate", "credit", "note", "page", "total", "subtotal",
    "balance", "due", "account", "reference", "tax", "vat", "number", "urgent", "copy",
    "original", "minute", "amount", "date", "bill", "ship", "deliver",
}


@lru_cache(maxsize=1)
def _model():
    try:
        with open(_DATA, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None


def available() -> bool:
    return _model() is not None


def _clean(tok: str) -> str:
    return "".join(c for c in tok.lower() if "a" <= c <= "z")


def token_logprob(token: str) -> "float | None":
    """Mean INTERPOLATED log P(c3|c1c2) per position over ^^token$. Higher = more
    word-like. None when unscorable (< _MIN_TOKEN_LEN alpha chars / no model)."""
    m = _model()
    w = _clean(token)
    if not m or len(w) < _MIN_TOKEN_LEN:
        return None
    k, V = m["k"], m["V"]
    uni, bi, tri = m["uni"], m["bi"], m["tri"]
    uni_total = m.get("uni_total") or sum(uni.values()) or 1
    l3, l2, l1, l0 = _LAMBDA
    s = _START + _START + w + "$"
    total = 0.0
    n = len(s) - 2
    for i in range(n):
        c1, c2, c3 = s[i], s[i + 1], s[i + 2]
        c12, c123 = c1 + c2, c1 + c2 + c3
        p3 = (tri.get(c123, 0) + k) / (bi.get(c12, 0) + k * V)
        p2 = (bi.get(c2 + c3, 0) + k) / (uni.get(c2, 0) + k * V)
        p1 = (uni.get(c3, 0) + k) / (uni_total + k * V)
        total += math.log(l3 * p3 + l2 * p2 + l1 * p1 + l0 / V)
    return total / n


def _is_chrome(tok: str) -> bool:
    t = _clean(tok)
    if not t:
        return False
    for c in _CHROME:
        if t == c or (len(t) >= 3 and (c.startswith(t) or t.startswith(c))):
            return True
    return False


def ref_bleed(value: str) -> bool:
    """True if a NAME value looks like a reference/code (digit-heavy or alpha+digits)."""
    s = (value or "").strip()
    if not s:
        return False
    if _REF_BLEED.search(s):
        return True
    alnum = [c for c in s if c.isalnum()]
    digits = sum(c.isdigit() for c in alnum)
    return bool(alnum) and digits / len(alnum) >= 0.4


def name_structure_flag(value, *, word_like: bool = True) -> "str | None":
    """Return a short review NOTE if a free-text NAME `value` does not read like a name,
    else None. Caller gates on is_name_like_field. `word_like=False` (the field's
    confirmed history is code-like) disables the language checks — the field's own
    regex/type owns it then, so this returns None.

    FLAG-ONLY: the value is never changed. Aggregation is fraction-of-bad with a
    single-token special case and a MIN backstop, skipping known-good tokens
    (ABBREV / COMMON_WORDS), so real multi-word names are not flagged."""
    if not available() or not value or not word_like:
        return None
    raw = str(value).strip()

    # 2) reference/code captured into a name field.
    if ref_bleed(raw):
        return "looks like a reference/code, not a name — please verify"

    toks = [t for t in re.split(r"[^A-Za-z]+", raw) if t]
    substantial = [t for t in toks if len(_clean(t)) >= _MIN_TOKEN_LEN]
    # Known-good tokens (legal abbrevs / common name words) are PROTECTIVE evidence —
    # their presence means the value carries real name structure, so a single coined
    # token beside them ("Zylo Systems") must not be flagged. They are excluded only
    # from the trigram CONTENT (they'd always pass anyway), never from the name-evidence.
    content = [t for t in substantial
               if _clean(t) not in ABBREV and _clean(t) not in COMMON_WORDS]

    # No scorable token at all ("NY", "i", "4.3"): not a credible name.
    if not substantial:
        return "doesn't read like a name — please verify"
    # Value is only known-good words/abbrevs ("City Care", "North Supplies Ltd"): a name.
    if not content:
        return None

    # 1) document chrome — the WHOLE value is a single heading token / its OCR clip.
    if len(substantial) == 1 and _is_chrome(content[0]):
        return "looks like a document heading, not a name — please verify"

    # 3) trigram wordness over content tokens.
    scored = [(t, token_logprob(t)) for t in content]
    scored = [(t, s) for t, s in scored if s is not None]
    if not scored:
        return None
    bad = [(t, s) for t, s in scored if s < WEAK_TOKEN_LOGPROB or _is_chrome(t)]
    min_score = min(s for _t, s in scored)
    # Flag when the MAJORITY of content tokens are not word-like (a single content
    # token counts as its own majority — so a lone garbled distinctive token beside
    # common words, e.g. "Aabiield Logistics", is caught), or when any one token is
    # clearly garbled (hard floor). Known-good words (ABBREV/COMMON_WORDS) were already
    # removed from `content`, so they neither trip nor dilute this.
    if (len(bad) / len(scored) >= 0.5) or min_score < _HARD_FLOOR:
        return "doesn't read like a name — please verify"
    return None


def has_no_protective_token(value) -> bool:
    """True when NONE of `value`'s substantial tokens is a known-good structural word
    (ABBREV / COMMON_WORDS) — i.e. the value carries NO protective name-structure evidence.
    Pairs with name_structure_flag to tell a document-CAPTION garble ("Deliver To RRS", "Deliver
    lo") — all-coined tokens, no real word — from a legit company that merely contains a
    chrome-shaped distinctive word beside a real one ("Delivery Solutions Ltd" carries
    'Solutions'/'Ltd'). Mirrors name_structure_flag's own substantial/content split so the two
    agree on tokenisation. False for an empty / no-substantial-token value (no basis to demote)."""
    toks = [t for t in re.split(r"[^A-Za-z]+", str(value or "")) if t]
    substantial = [t for t in toks if len(_clean(t)) >= _MIN_TOKEN_LEN]
    return bool(substantial) and all(
        _clean(t) not in ABBREV and _clean(t) not in COMMON_WORDS for t in substantial)


def looks_like_garble(value: str) -> bool:
    """Convenience boolean: should this free-text NAME value be flagged for review?"""
    return name_structure_flag(value) is not None
