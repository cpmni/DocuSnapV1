"""
extraction/name_match.py
------------------------
TOKEN-LEVEL canonical wording repair for name-like fields (company/customer), Phase 1
of pattern-based field correction. Repairs a garbled KNOWN token to its learned
canonical spelling while leaving the VARIABLE tail verbatim — e.g.
    "eeaument care homes - lisburn"  ->  "Beaumont Care Homes - lisburn"
It NEVER snaps to a whole previously-seen value and NEVER injects a token that wasn't
in the input (so a learned site like "Tudordale" can't replace a new site "Lisburn").

Design guards (per Reggie + gary review):
  * POSITIONAL gating — a token is only repaired at a content position where history
    *consistently* carries one dominant stable token; a site at a variable position is
    never compared to a stable token elsewhere (stops "Holmes" -> "homes").
  * DOC-COUNT FLOOR — a stable token needs doc-freq >= _STABLE_FREQ (0.6) AND
    >= _STABLE_MIN_DOCS (3) documents (reuses the _SHAPE_ACCEPT_MIN philosophy), so
    thin 2-of-3 evidence can't mint a "stable" token.
  * DETERMINISTIC canonical surface — max doc-count, ties broken lexicographically,
    so `corrected_to` is identical across reprocesses; repair is idempotent.
  * Space-split only — fixes per-token GLYPH garble, NOT OCR merge/split
    ("carehomes"/"ho mes") — those produce no repair (never a wrong one).

Pure module: suggestion logic only, no I/O, no engine coupling. The engine builds the
lexicon once per field group (from getFieldFormats `value_counts`) and calls
`repair_name_value` in the Stage 4.5 text branch as a `corrected_to` SUGGESTION.
"""

from extraction.text_normalise import normalise_for_tokens

_STABLE_FREQ      = 0.6   # a stable token must appear in >= 60% of confirmed docs at its position
_STABLE_MIN_DOCS  = 3     # ...AND in at least this many documents (mirrors _SHAPE_ACCEPT_MIN)
_FUZZY_MIN_LEN    = 4     # tokens shorter than this require an EXACT match (no fuzzy)
_FUZZY_RATIO_MIN  = 0.72  # 1 - dist/maxlen floor for a fuzzy token match
_FUZZY_LONG_LEN   = 6     # tokens this long may tolerate up to 2 edits, else 1
_STRONG_FREQ      = 0.9   # doc-freq at/above which a position is NEAR-UNIVERSAL: enough
                          # evidence to (a) allow a 3-char single-substitution repair
                          # ("Lid"->"Ltd") and (b) mark a repair "strong" => AUTO-APPLY.


def _is_content(tok):
    """A token is name CONTENT if it contains an alphanumeric (a bare separator like
    "-" is not — it's kept verbatim and does not occupy a content position)."""
    return any(c.isalnum() for c in tok)


def _levenshtein(a, b):
    if a == b:
        return 0
    la, lb = len(a), len(b)
    if not la:
        return lb
    if not lb:
        return la
    prev = list(range(lb + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (0 if ca == cb else 1)))
        prev = cur
    return prev[lb]


def _close(a, b):
    """Is normalised token `a` a credible OCR garble of stable token `b`? Exact for
    very short tokens; a small length-scaled edit budget + ratio floor otherwise."""
    la, lb = len(a), len(b)
    if min(la, lb) < _FUZZY_MIN_LEN:
        return a == b
    d = _levenshtein(a, b)
    if d == 0:
        return True
    budget = 2 if max(la, lb) >= _FUZZY_LONG_LEN else 1
    ratio = 1.0 - d / max(la, lb)
    return d <= budget and ratio >= _FUZZY_RATIO_MIN


def _short_strong(a, stable):
    """A 3-char ALPHABETIC stable token (Ltd / Inc / Plc / LLC ...) that is
    NEAR-UNIVERSAL at its position (doc_freq >= _STRONG_FREQ) may repair a
    SAME-LENGTH single substitution ("lid" -> "ltd"). Deliberately tighter than the
    >=4-char fuzzy path: exact length 3, exactly one edit, alphabetic only, and
    overwhelming positional evidence — so a common business suffix misread is fixed
    without opening short tokens to loose fuzzy collisions ("co" -> "go")."""
    b = stable.get("norm") or ""
    return (len(a) == 3 and len(b) == 3 and a.isalpha() and b.isalpha()
            and stable.get("doc_freq", 0.0) >= _STRONG_FREQ
            and _levenshtein(a, b) == 1)


# Canonical spelling for common business suffixes — so a merged OCR-garble cluster
# canonicalises to the REAL suffix even if misreads outnumber the correct spelling in
# confirmed history.
_LEGAL_SUFFIX_CANON = {"ltd": "Ltd", "inc": "Inc", "plc": "Plc",
                       "llc": "LLC", "llp": "LLP", "co": "Co"}


def _ocr_equiv(a, b):
    """True when 3-char alphabetic norm `a` is a single-substitution OCR misread of `b`
    (the SAME intended token) — used to fold a minority garble into the dominant token
    when building the lexicon, so confirmed misreads ("lid" for "ltd") don't dilute the
    canonical's doc_freq below the repair threshold. SCOPED to the 3-char business-suffix
    class (Ltd/Inc/Plc/...) where the short-token repair lives. Deliberately NOT extended
    to longer tokens — fuzzy-merging there would collapse legitimately-varying codes /
    postcodes / sites (AB12 vs AB13) into a false 'stable' token; longer OCR garbles are
    already handled by the _close repair when a dominant stable token exists."""
    return (len(a) == 3 and len(b) == 3 and a.isalpha() and b.isalpha()
            and _levenshtein(a, b) == 1)


def build_token_lexicon(value_counts, confirmed_count=None):
    """Build the positional canonical lexicon for ONE field group from confirmed
    history. `value_counts` = {confirmed_value: doc_count}; `confirmed_count` = total
    confirmed docs (defaults to the sum). Returns
        {"positions": {i: {"norm","surface","doc_freq"}}, "n_docs": int}
    holding only positions with a dominant stable token. Empty positions map => the
    field has no canonical wording to repair against (repair is then a no-op)."""
    vc = value_counts or {}
    n_docs = confirmed_count if confirmed_count else sum(vc.values())
    if not vc or not n_docs or n_docs <= 0:
        return {"positions": {}, "n_docs": n_docs or 0}

    # position -> norm_token -> doc_count ; and norm_token -> surface -> doc_count
    pos_norm_counts = {}
    pos_norm_surface = {}
    for value, cnt in vc.items():
        raw_tokens = [t for t in str(value).split() if _is_content(t)]
        for i, raw in enumerate(raw_tokens):
            norm = normalise_for_tokens(raw)
            if not norm:
                continue
            pn = pos_norm_counts.setdefault(i, {})
            pn[norm] = pn.get(norm, 0) + cnt
            surf = pos_norm_surface.setdefault((i, norm), {})
            surf[raw] = surf.get(raw, 0) + cnt

    positions = {}
    for i, norm_counts in pos_norm_counts.items():
        # Fold minority OCR-garble variants at this position INTO the dominant token,
        # so confirmed misreads ("Lid" for "Ltd") don't dilute the canonical's doc_freq
        # below the repair threshold (the "Lid stopped correcting once a few misreads
        # were confirmed" regression). Conservative: only a token with NO-MORE docs
        # folds into the more-confirmed one it is OCR-equivalent to; surfaces merge too.
        # Reusable — any field/supplier/token, not just business suffixes. Works on a
        # COPY so pos_norm_counts (used by expected_len below) is untouched.
        merged = dict(norm_counts)
        anchor = max(merged, key=lambda n: (merged[n], _neg_lex(n)))
        for n in [k for k in merged if k != anchor]:
            if merged[n] <= merged[anchor] and _ocr_equiv(n, anchor):
                merged[anchor] += merged[n]
                src = pos_norm_surface.get((i, n), {})
                dst = pos_norm_surface.setdefault((i, anchor), {})
                for surf, c in src.items():
                    dst[surf] = dst.get(surf, 0) + c
                del merged[n]
        # dominant token after merge (max doc-count, tie -> lexicographic norm)
        norm, doc_count = max(merged.items(), key=lambda kv: (kv[1], _neg_lex(kv[0])))
        if doc_count < _STABLE_MIN_DOCS or doc_count < _STABLE_FREQ * n_docs:
            continue
        surfaces = pos_norm_surface.get((i, norm), {})
        # canonical surface: a known business-suffix spelling present in the cluster wins
        # over a more-frequent misread; otherwise the most-confirmed surface (tie -> lex).
        canon = next((_LEGAL_SUFFIX_CANON[normalise_for_tokens(s)]
                      for s in surfaces if normalise_for_tokens(s) in _LEGAL_SUFFIX_CANON), None)
        surface = canon or (max(surfaces.items(), key=lambda kv: (kv[1], _neg_lex(kv[0])))[0] if surfaces else norm)
        positions[i] = {"norm": norm, "surface": surface, "doc_freq": doc_count / n_docs}

    # EXPECTED LENGTH — the longest CONSECUTIVE run of content positions that a strong
    # majority (>= _STABLE_FREQ) of confirmed docs actually reach. History that is
    # always "<stable prefix> - <variable site>" reaches position 4 in (nearly) every
    # doc, so expected_len = 5. A value that STOPS SHORT of this ("Beaumont Care Homes
    # Ltd -" with the site truncated off) is missing the variable tail history always
    # carries — NOT a conforming "new site", so conforms_to_lexicon rejects it and the
    # shape flag is kept. pos_doc_count[i] = docs (weighted) that have content at i.
    pos_doc_count = {i: sum(nc.values()) for i, nc in pos_norm_counts.items()}
    expected_len = 0
    while pos_doc_count.get(expected_len, 0) >= _STABLE_FREQ * n_docs:
        expected_len += 1
    return {"positions": positions, "n_docs": n_docs, "expected_len": expected_len}


def _neg_lex(s):
    """Lexicographic tie-break helper: pick the SMALLEST string on a max() by negating
    the ordering (max wants the lexicographically-first surface among equal counts)."""
    return tuple(-ord(c) for c in s)


def repair_name_value(value, lexicon, details=False):
    """Return a token-level repaired suggestion for `value`, or None if no safe repair.
    Idempotent; never injects tokens; never replaces a whole value. Variable tokens
    (positions with no stable token) are preserved verbatim.

    With `details=True` returns `(repaired_or_None, strong)`: `strong` is True when
    EVERY changed content token was repaired/canonicalised at a NEAR-UNIVERSAL
    position (doc_freq >= _STRONG_FREQ). The engine AUTO-APPLIES strong repairs (a
    confident misread fix backed by overwhelming history) and keeps weaker ones as
    review-only suggestions."""
    none = (None, False) if details else None
    if not value or not lexicon:
        return none
    positions = lexicon.get("positions") or {}
    if not positions:
        return none

    out = []
    content_i = 0
    changed = False
    strong  = True   # AND over every change's evidence (vacuously True if nothing changed)
    for raw in str(value).split():
        if not _is_content(raw):
            out.append(raw)            # separator — verbatim, does not advance position
            continue
        stable = positions.get(content_i)
        if stable:
            norm_tok = normalise_for_tokens(raw)
            did_change = False
            if norm_tok == stable["norm"]:
                if raw != stable["surface"]:
                    out.append(stable["surface"]); changed = True; did_change = True  # canonicalise case/spelling
                else:
                    out.append(raw)
            elif _close(norm_tok, stable["norm"]) or _short_strong(norm_tok, stable):
                out.append(stable["surface"]); changed = True; did_change = True      # repair garbled known token
            else:
                out.append(raw)                                     # genuinely different -> keep
            if did_change and stable.get("doc_freq", 0.0) < _STRONG_FREQ:
                strong = False
        else:
            out.append(raw)                                         # variable position -> keep
        content_i += 1

    if not changed:
        return none
    result = " ".join(out)
    return (result, strong) if details else result


def conforms_to_lexicon(value, lexicon):
    """True if `value` matches the learned name PATTERN: at EVERY stable position it
    carries the canonical token (exact, normalised), and the remaining positions are
    its variable tail. A conforming value is the EXPECTED "stable prefix + variable
    tail" shape ("Beaumont Care Homes Ltd - <Site>" with a NEW site) — not an
    anomaly — so the coarse learned-SHAPE check (which would flag a never-seen site
    length) should be suppressed for it. Returns False when a stable position is
    missing or carries a DIFFERENT token (a real anomaly), or there are no stable
    positions. Mirrors repair_name_value's iteration (separators don't advance the
    content position)."""
    if not value or not lexicon:
        return False
    positions = lexicon.get("positions") or {}
    if not positions:
        return False
    content_toks = [t for t in str(value).split() if _is_content(t)]
    # TRUNCATION GUARD: the value must reach the length history consistently carries.
    # A value missing its variable TAIL ("Beaumont Care Homes Ltd -" with the site
    # cut off) is NOT a conforming "new site" — history always had a site there — so
    # it falls through to the shape flag instead of being silently accepted.
    if len(content_toks) < (lexicon.get("expected_len") or 0):
        return False
    # Every STABLE prefix position must be present AND carry the canonical token.
    for i, st in positions.items():
        if i >= len(content_toks):
            return False                   # a stable prefix token is missing entirely
        if normalise_for_tokens(content_toks[i]) != st["norm"]:
            return False                   # wrong/garbled token at a stable position
    return True
