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


def doubled_digit_fingerprint(winner_value, witness_value):
    """The MERGED-DOUBLED-DIGIT artifact fingerprint (Oracle W/COND 2026-08-01, the
    length-witness arm): True iff the witness's alnum form equals the winner's with exactly
    ONE digit INSERTED ADJACENT TO AN IDENTICAL DIGIT — the mechanical signature of a
    doubled glyph merging under a thin crop ('WS-1904' read where 'WS-11904' prints:
    '1904' -> '11904'). Direction is fixed (witness longer by one): the winner LOST one of
    a doubled pair. Anything else — substitutions, multi-edits ('PO-64334'/'PO-643224'),
    non-adjacent or alpha insertions, winner-longer — is NOT this artifact and must route
    to the flag lane at most. Adoption on the defect's fingerprint, never on statistical
    plausibility (the rollover-drift false-adopt: a stale 'INV-999' witness "passing the
    profile" against a correct novel 'INV-1000' fails this structurally)."""
    a = _alnum(winner_value)
    b = _alnum(witness_value)
    if not a or not b or len(b) != len(a) + 1:
        return False
    i = 0
    while i < len(a) and a[i] == b[i]:
        i += 1
    # b = a[:i] + b[i] + a[i:] — a single insertion at i, digit-only, adjacent-identical.
    if b[:i] + b[i + 1:] != a:
        return False
    ins = b[i]
    if not ins.isdigit():
        return False
    left  = b[i - 1] if i > 0 else None
    right = b[i + 1] if i + 1 < len(b) else None
    return ins == left or ins == right


def prefix_garble_fingerprint(winner_value, witness_value, dominant_prefix):
    """The LEADING-PREFIX-CORRUPTION artifact fingerprint (Oracle SIGN-OFF-W/COND 2026-08-03 —
    the prefix-garble adopt lane of the length-witness arm): True iff the winner is the witness
    with its confirmed leading code-prefix mis-read into a SHORT NON-ALPHA garble, the value's
    identity preserved. Signature ('PO-17039' printed; a tight Stage-0.5 crop reads '»0-17039',
    Stage-4.5 strips it to '0-17039'):
      - witness alnum starts with the DOMINANT confirmed prefix `dom`      ('po' + '17039');
      - winner alnum ENDS WITH the witness's EXACT post-prefix tail        (...'17039');
      - the winner's leading garble (what replaced `dom`) is entirely NON-ALPHA and no longer
        than `dom` — OCR corrupts a prefix glyph-for-glyph and may drop some, it never
        manufactures a new alpha run                                       ('0', <= len 'po');
      - PIN belt: the winner keeps the witness's identity DIGITS (no body digit changed).
    An ALPHA lead ('XO-17039') = a genuinely DIFFERENT code, not a garble -> False. An EMPTY lead
    ('17039') = the clean-clip class (clip_completion owns it) -> False. A body-digit change
    ('0-17038') -> False. Pure string geometry; the confirmed-prefix DOMINANCE + no-numeric-leading
    -precedent guards live with the caller (engine._strong_single_prefix) — those are what make
    the SINGLE-witness adopt safe (a keyword peer can otherwise match a different PO-#### on the
    page). Direction is fixed: the winner LOST its prefix, the witness carries it."""
    dom = _alnum(dominant_prefix)
    b   = _alnum(witness_value)
    if not dom or not b or not b.startswith(dom):
        return False
    tail = b[len(dom):]                              # 'po17039' -> '17039'  (the witness identity)
    if not tail or not any(c.isdigit() for c in tail):
        return False                                # the witness must carry real post-prefix identity
    a = _alnum(winner_value)                          # '»0-17039' / '0-17039' -> '017039'
    if a == b or not a.endswith(tail):
        return False                                # winner must DIFFER but keep the witness's EXACT tail
    lead = a[: len(a) - len(tail)]                    # '0'
    if not lead or any(c.isalpha() for c in lead):
        return False                                # empty lead = clip class; alpha lead = a different code
    if len(lead) > len(dom):
        return False                                # garble no longer than the prefix it replaced
    if not _digits(a).endswith(_digits(tail)):       # belt-and-braces PIN: identity digits preserved
        return False
    return True


_WS_RE = re.compile(r'\s+')


def digit_substitution_diff(winner_value, witness_value):
    """The INTERIOR-DIGIT-SUBSTITUTION comparator SHARED by the D1 in-band
    digit-disagreement flag and the (future) D2 second-render witness — ONE
    implementation, one pin (Oracle 2026-08-01: this comparator is the load-bearing
    safety of both arms; a garbage witness must compare as NOT-this-shape, never as
    a disagreement). Census-validated predicate (stress_test/census_digit_disagree.js
    — keep the two in lockstep): after uppercasing + stripping ALL whitespace, the two
    values must have the SAME length, be IDENTICAL at every non-digit position, digit
    positions aligned (digit opposite digit) — i.e. an identical non-digit skeleton —
    and differ ONLY at digit positions. Returns the count of differing digit positions,
    or -1 when the pair is not this shape (length/skeleton mismatch). 0 = same value.
    Substitutions can NEVER silently adopt (the C3 pin) — callers flag only."""
    a = _WS_RE.sub('', str(winner_value or '').upper())
    b = _WS_RE.sub('', str(witness_value or '').upper())
    if not a or not b or len(a) != len(b):
        return -1
    diff = 0
    for ca, cb in zip(a, b):
        da, db = ca.isdigit(), cb.isdigit()
        if da and db:
            if ca != cb:
                diff += 1
            continue
        if ca != cb:
            return -1
    return diff


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
