"""
extraction/suffix_reconcile.py
------------------------------
CLIPPED-SUFFIX RECONCILIATION (Oracle-amended verdict 2026-07-31; kill switch
CANDIDATE_SUFFIX_RECONCILE, ships dark).

The evidenced class (#121/123/124/131 'V-69523'): a LABEL-CONFIRMED anchor read
(anchor_registration / anchor_crop_relocated / anchor_inline) wins the field with a
value whose leading glyphs were cut off by a misplaced crop, while an INDEPENDENT
Stage-1 keyword read of the SAME token — same digits, fuller prefix — was discarded
on tier. Label-confirmed methods are deliberately exempt from the learned-shape veto
(anchor.py _LABEL_CONFIRMED_METHODS / engine.py:4692), so nothing downstream can see
the clip: it files silently at 90+.

This module is the PURE classifier: given the winning value and one retained
candidate, decide
    ('adopt', clean_candidate)  — the candidate is the same token read more
                                  completely AND every corroboration bar is met;
    ('flag',)                   — clip-shaped, but the completed prefix has no
                                  confirmed in-scope support (fail toward review);
    None                        — not the clip pattern; do nothing.

Corroboration bars for ADOPT (all mandatory — Oracle conditions):
  1. the winner FAILS the supplier-scoped learned shape and the candidate PASSES it
     (checked by the CALLER, which owns the fmt_entry scope — see engine.
     _reconcile_clipped_suffix);
  2. the winner's alnum form is a STRICT CONTIGUOUS SUFFIX of the candidate's alnum
     form — the completion is ALPHA-ONLY, 1..3 chars (a clip is a prefix phenomenon;
     any digit change/reorder/growth is NOT this class);
  3. digit subsequences are byte-identical (implied by 2; asserted independently so
     a future edit to 2 cannot silently admit a digit change — the PIN);
  4. the completed leading code prefix is a CONFIRMED in-scope prefix with real
     support (ocr_corrector.prefix_confirmed) — membership, not similarity.

Bar 4 missing (no prefix record for the scope) -> ('flag',): the operator sees
"a fuller read of the same number exists" instead of a silent clipped value.

Deliberately NOT handled (pinned residuals — do not widen):
  - '1V-69523' (digit-bearing completion): fails bar 2 -> None. Widening to digit
    completions would let a hallucinated leading digit rewrite a real code.
  - 'PO-34729' vs 'PO-24729' (interior substitution): not a suffix -> None.
  - equal-after-normalisation reads: nothing to reconcile -> None.
"""

import re

_ALNUM_RE = re.compile(r'[^0-9a-z]+')
_EDGE_JUNK_RE = re.compile(r'^[^0-9A-Za-z]+|[^0-9A-Za-z]+$')
_COMPLETION_MAX = 3


def _alnum(s) -> str:
    return _ALNUM_RE.sub('', str(s or '').lower())


def edge_strip(s) -> str:
    """Strip leading/trailing NON-alnum page debris from a candidate value
    ('. INV-69523' -> 'INV-69523') without touching interior separators. The
    full-page keyword pass legitimately drags punctuation debris along the line;
    the learned-shape check and code_prefix both reject on it, so the clean form
    is what every downstream bar judges."""
    return _EDGE_JUNK_RE.sub('', str(s or ''))


def _digits(s) -> str:
    return ''.join(c for c in str(s or '') if c.isdigit())


def clip_completion(winner_value, candidate_value):
    """The alpha-only completion string P (lowercase) such that
    alnum(candidate) == P + alnum(winner), with 1 <= len(P) <= 3 — or None when the
    pair is not the clipped-suffix pattern. Pure string geometry; no shape/prefix
    knowledge (those bars live with the caller / classify)."""
    a = _alnum(winner_value)
    c = _alnum(candidate_value)
    if not a or not c or len(c) <= len(a):
        return None
    if not c.endswith(a):
        return None
    p = c[: len(c) - len(a)]
    if not (1 <= len(p) <= _COMPLETION_MAX) or not p.isalpha():
        return None
    if _digits(c) != _digits(a):        # belt-and-braces with p.isalpha() (the PIN)
        return None
    return p


def classify(winner_value, candidate_value, clean_candidate, prefix_rec,
             prefix_confirmed_fn, code_prefix_fn):
    """Classify one (winner, candidate) pair. The CALLER has already established:
    the winner fails the in-scope learned shape; `clean_candidate` (the candidate
    with page debris stripped, e.g. '. INV-69523' -> 'INV-69523') PASSES it.

    prefix_rec            — ocr_corrector.lookup_prefix record for the scope (or None)
    prefix_confirmed_fn   — ocr_corrector.prefix_confirmed
    code_prefix_fn        — ocr_corrector.code_prefix
    """
    if clip_completion(winner_value, candidate_value) is None:
        return None
    # The CLEAN candidate must still be the same clipped-suffix pair — debris
    # stripping must not have changed the content relationship (a shape-extract
    # that trimmed digits would break the suffix identity and land here).
    if clip_completion(winner_value, clean_candidate) is None:
        return None
    if prefix_rec:
        p = code_prefix_fn(clean_candidate)
        if p and prefix_confirmed_fn(p, prefix_rec):
            return ('adopt', clean_candidate)
    return ('flag',)
