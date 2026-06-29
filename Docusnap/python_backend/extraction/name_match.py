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

import re

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


_FRAG_MAXLEN = 2   # a final VARIABLE-position content token this short is a clipped fragment


def is_truncated_name(value, lexicon):
    """True when `value` looks TRUNCATED / FRAGMENTARY vs the confirmed-history name —
    the dominant name silent-error class character wordness cannot catch (a fragment is
    itself a real word). Two shapes, both needing the per-field length history (so inert
    without confirmed history):

      (1) SHORTER than the length history consistently carries (expected_len) — the tail
          is missing entirely, e.g. "Beaumont Care Homes Ltd -" or "Joinery" (history
          "Stonebridge Joinery", expected_len 2).
      (2) FINAL-TOKEN fragment — a right-clip can leave the variable TAIL as a 1-2 char
          stub ("Beaumont Care Homes Ltd - B" / "...Dundonald H"), so the content-token
          COUNT still reaches expected_len. Flag when the LAST content token sits at a
          VARIABLE (non-stable) position, is <= _FRAG_MAXLEN alpha chars, and is not a
          known business word/abbrev (Ltd/Co). Real site/tail tokens are >= 3 chars.

    Mirrors the content-token iteration (separators don't occupy a position)."""
    if not value or not lexicon:
        return False
    exp = lexicon.get("expected_len") or 0
    if exp <= 1:
        return False                       # no usable length expectation
    content = [t for t in str(value).split() if _is_content(t)]
    n = len(content)
    if n == 0:
        return False
    if n < exp:
        return True                        # (1) tail missing entirely
    # (2) final-token fragment at a variable position.
    positions = lexicon.get("positions") or {}
    last_i = n - 1
    if last_i in positions:
        return False                       # last token is a learned STABLE token, not a clip
    alpha = "".join(c for c in content[last_i].lower() if c.isalpha())
    if len(alpha) > _FRAG_MAXLEN or not alpha:
        return False
    try:
        from extraction.value_quality import ABBREV, COMMON_WORDS
        if alpha in ABBREV or alpha in COMMON_WORDS:
            return False                   # a legitimate short word/abbrev tail (Co/Ltd)
    except Exception:
        pass
    return True


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


# Trailing continuation markers: hyphen, en-dash, em-dash (the multi-line "this value wraps"
# cue). A per-field rule may widen this set; dash-only is the default.
_CONT_DEFAULT_CHARS = "-–—"


def matches_stable_prefix(value, lexicon):
    """True when `value` is CONSISTENT with the learned name's stable prefix — every stable
    position the value reaches carries the canonical token, AND the value actually covers the
    FIRST stable position. Unlike conforms_to_lexicon this does NOT require reaching
    expected_len, so it accepts a genuine TRUNCATION ("Beaumont Care Homes Ltd") while
    REJECTING an unrelated/drifted value ("2604-0511-1", "Field") whose first token isn't the
    canonical prefix — the guard that stops a multi-line join firing on a wrong read."""
    if not value or not lexicon:
        return False
    positions = lexicon.get("positions") or {}
    if not positions:
        return False
    content = [t for t in str(value).split() if _is_content(t)]
    if not content:
        return False
    covered = False
    for i, st in positions.items():
        if i < len(content):
            if normalise_for_tokens(content[i]) != st["norm"]:
                return False               # a covered stable position carries the WRONG token
            if i == 0:
                covered = True             # value is anchored to the prefix start
    # Accept only when the value reaches the FIRST stable position (anchored to the name).
    # If there's no position-0 stable token, fall back to "at least one stable position matched".
    return covered or (0 not in positions and any(i < len(content) for i in positions))


def _shape_is_complete(value, fmt_entry):
    """Coarse history check used only when there is NO name lexicon: True when the value's
    structural shape (format_anomaly_checker.shape_signature) is one the field has actually
    confirmed — so a value that legitimately ends in a continuation char (its shape is
    learned) is treated as complete, not truncated. Inert without a learned shape set."""
    if not fmt_entry:
        return False
    shapes = fmt_entry.get("shapes")
    if not shapes:
        return False
    try:
        from extraction.format_anomaly_checker import shape_signature
        return shape_signature(str(value)) in shapes
    except Exception:
        return False


def should_continue_line(line1, pattern_chars=None, name_lex=None, fmt_entry=None):
    """Per-read decision: should the value on `line1` CONTINUE onto the line below?
    Pattern-primary, history-guarded (designed with reggie):

        continue := (trailing continuation char AND NOT complete-per-history)
                    OR is_truncated_name(line1, name_lex)

    A trailing continuation char (default -/–/—) fires on document #1 (no history needed);
    the history check only SUPPRESSES it for a value that legitimately ends in the char yet
    already matches confirmed history (conforms_to_lexicon, or the coarse learned-shape).
    The pure-data branch (is_truncated_name) adds recall for a no-dash truncation and is
    inert without confirmed history. Returns the BOOLEAN only — the caller owns the
    free-text gating and the actual read/join."""
    s = (line1 or "").rstrip()
    if not s:
        return False
    # PRECISION GUARD: when we have a name lexicon, the read must be a PLAUSIBLE PREFIX of the
    # learned name. Otherwise a DRIFTED wrong read (a ref code "2604-0511-1", or "Field")
    # would wrongly trigger a join (the "multiline applying where it shouldn't" bug). Inert
    # without confirmed history (no positions → skip, the pattern branch still works cold).
    if name_lex and name_lex.get("positions") and not matches_stable_prefix(s, name_lex):
        return False
    chars = pattern_chars or _CONT_DEFAULT_CHARS
    if re.search("[" + re.escape(chars) + "]$", s):
        # Trailing continuation char. Suppress only when history confirms completeness;
        # the name lexicon is authoritative when present, else the coarse learned-shape.
        if name_lex:
            return not conforms_to_lexicon(s, name_lex)
        return not _shape_is_complete(s, fmt_entry)
    # No trailing char: fall back to the data-verified truncation signal (history-gated,
    # inert without confirmed history).
    return bool(name_lex) and is_truncated_name(s, name_lex)
