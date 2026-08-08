"""
extraction/format_anomaly_checker.py
-------------------------------------
Stage 4.5 — field format cross-referencing (Stage 1: anomaly detection only).

Compares a freshly-extracted value against the coarse format class learned
from confirmed historical values for the same (supplier_name, document_type,
field_key) group.

On anomaly: signals reduced confidence + validation_note to engine.py.
No correction is proposed here — that is Stage 2.

Classification is intentionally coarse.  Three samples from the most-recent
confirmed pool must agree unanimously; any disagreement → freetext (no
constraint applied).  The minimum of 3 distinct confirmed values is enforced
on the JS side (getFieldFormats filters groups below that threshold), but
also guarded here for belt-and-braces safety.
"""

import re
import sys
import math
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction.validator import parse_date, parse_amount
from extraction.ocr_corrector import LETTER_TO_DIGIT


# ── Format class labels ───────────────────────────────────────────────────────

DIGITS_ONLY    = 'digits_only'
UPPER_ALPHANUM = 'upper_alphanum'
ALPHANUM       = 'alphanum'
ALPHANUM_SEP   = 'alphanum_sep'
DATE_LIKE      = 'date_like'
CURRENCY_LIKE  = 'currency_like'
FREETEXT       = 'freetext'

# Currency indicator characters / codes — plain digits alone are NOT currency
_CURRENCY_SYMBOLS = frozenset('£$€¥')
_CURRENCY_CODES   = ('GBP', 'USD', 'EUR', 'JPY')

# Pool / sample sizes for format inference
_SAMPLE_POOL_SIZE = 5   # use the N most-recent distinct values as the candidate pool
_SAMPLE_SIZE      = 3   # draw this many from the pool for consensus check

# A within-class shape is only ACCEPTED (added to the learned/trusted set) once it clears an
# evidence bar. Below the bar a new shape is still FLAGGED for review (check_value low-severity),
# so a one-off OCR-garbled structure never gets silently trusted; once a genuinely recurring
# shape clears it, that shape stops being flagged — how a field "learns" a second structure.
#
# ANTI-POISONING: the bar is corpus-size-PROPORTIONAL, not a flat count — so a few bad
# confirmations can't poison a large corpus. A shape is trusted iff it clears the ABSOLUTE
# escape (a genuine minority series that has accrued this many docs is always legit) OR both
# the floor AND a fraction of the corpus. Mirrors name_match.py's proven floor-AND-ratio model
# (_STABLE_MIN_DOCS/_STABLE_FREQ). Identical to the old flat "count >= 3" for corpora up to
# ~30 docs (ceil(0.10*N) <= 3), so cold-start / small fields are unaffected; it only tightens
# as the corpus grows: 3-of-10 accepted, 3-of-100 suppressed. Validated offline against the
# real corpus (0 currently-trusted shapes suppressed). See tools/poison_gate_dryrun.py.
_SHAPE_ACCEPT_MIN   = 3      # floor — a shape needs at least this many docs regardless of ratio
_SHAPE_ACCEPT_RATIO = 0.10   # ...AND at least this fraction of the confirmed corpus, once it grows
_SHAPE_ACCEPT_ABS   = 8      # absolute-trust escape: a real minority series at this many docs is kept

# ── Misread-separator recovery (reggie) ── a structured ref's separator is interchangeable
# BY DESIGN (see _fold_shape), so a value whose separator differs from the field's OWN
# DOMINANT learned separator is a likely OCR MISREAD, not a format variant — recover-and-flag.
# Derived from the field's raw value_counts (the fold/widen erase the literal separator
# downstream), so it stays INERT on a field whose history genuinely mixes separators.
_REF_SEPS      = frozenset('-/.')                       # interchangeable ref separators _fold_shape folds
_SEP_DOMINANCE = 0.90                                   # one separator must cover >= this doc-share to be "uniform"
# Scoped separator OCR confusions — deliberately NOT in the global glyph maps (which are alnum-only
# and would fight the fold). A thin/degraded dash reads as a dot or mid-dot. '/' is left OUT ('/'↔'-'
# is a weak visual confusion + '/' is a common DELIBERATE separator); unicode – — are text_normalise's.
_SEP_CONFUSIONS = {'.': frozenset('-'), '·': frozenset('-')}   # misread char -> the learned separator(s) it can be


# ── Single-value classification ───────────────────────────────────────────────

def classify_single(value: str) -> str:
    """
    Classify one raw string into a coarse format class.

    Operates on the raw string — leading zeros, separators, case are all
    preserved and meaningful.  date_like and currency_like are checked first
    because their character sets overlap with the simpler classes.
    """
    v = (value or '').strip()
    if not v:
        return FREETEXT

    # Date before everything — "01/12/2025" would also pass alphanum_sep
    if parse_date(v) is not None:
        return DATE_LIKE

    # Currency only when an explicit indicator is present; plain "1250" → DIGITS_ONLY
    if (_CURRENCY_SYMBOLS & set(v) or
            any(code in v.upper() for code in _CURRENCY_CODES)):
        if parse_amount(v) is not None:
            return CURRENCY_LIKE

    # Character-set classes — ordered from most to least restrictive
    if all(c.isdigit() for c in v):
        return DIGITS_ONLY
    if all(c.isupper() or c.isdigit() for c in v):
        return UPPER_ALPHANUM
    if all(c.isalnum() for c in v):
        return ALPHANUM

    non_alnum = frozenset(c for c in v if not c.isalnum())
    if 1 <= len(non_alnum) <= 3:
        return ALPHANUM_SEP

    return FREETEXT


# Classes whose values have a meaningful fixed STRUCTURE worth enforcing beyond
# the coarse character set. date_like / currency_like deliberately excluded —
# their shape varies legitimately (e.g. "1/2/25" vs "01/12/2025") and they have
# their own parse-based validation.
_SHAPED_CLASSES = (DIGITS_ONLY, UPPER_ALPHANUM, ALPHANUM, ALPHANUM_SEP)


def shape_signature(value: str) -> str:
    """Normalised structural signature of a value.

    Each digit → '#', each letter → '@', every other character (separators,
    spaces) kept literally and in place. This captures digit/letter group
    LENGTHS and separator POSITIONS, so values that share a coarse class can
    still be told apart by structure:

        '1111-1111-1'  → '####-####-#'
        '11111-1111-1' → '#####-####-#'   (wrong-length first group)
        '11111111-1'   → '########-#'     (missing separator)
        '1111--1111-1' → '####--####-#'   (extra separator)

    All four are alphanum_sep, but only the first matches the learned shape.
    Pure and deterministic.

    ⚠ INVARIANT — the letter→'@' fold is DELIBERATELY prefix-AGNOSTIC, and must stay so
    HERE. `shape_signature('PO-1') == shape_signature('DN-1')` on purpose. A wrong-
    document-type misfile that keeps the same digit/separator shape (a PO filed as a
    delivery note: 'PO-21275' vs 'DN-70795') is therefore invisible to this signature —
    that is intentional at EXTRACTION time: making this prefix-aware would FALSE-HOLD a
    genuinely-new supplier with a legitimately different prefix against thin learned
    history (a fail-toward-review violation at the wrong moment). The prefix mismatch is
    caught POST-CONFIRM instead, where an 80+ doc pool makes it safe, by the JS detector
    `src/services/repairSuspects.detectRefPrefixOutliers` (a suggestion-only Learning-
    Repair rule). Do NOT port that rule into this function. Pinned by
    tests/test_format_shape_consistency.py (section 8, the prefix-agnostic invariant).
    """
    out = []
    for c in (value or '').strip():
        if c.isdigit():
            out.append('#')
        elif c.isalpha():
            out.append('@')
        else:
            out.append(c)
    return ''.join(out)


def shape_requires_digit(format_entry: Optional[dict]) -> bool:
    """True when the confirmed history is UNIFORMLY digit-bearing: the class is
    digits_only, OR every learned shape signature contains a digit position ('#',
    per shape_signature). Pure, data-driven; no supplier/field specifics. Used to
    refuse RESURRECTING a digit-FREE anchor read (a wrong-row word like "Field") on a
    field whose every confirmed value carries digits — while leaving alpha-only or
    digit-bearing reads, and fields with no/varied learned shape, untouched."""
    if not format_entry:
        return False
    if format_entry.get('class') == DIGITS_ONLY:
        return True
    shapes = format_entry.get('shapes')
    return bool(shapes) and all('#' in s for s in shapes)


def _shape_to_regex(shape: str) -> str:
    """Turn a shape signature into a regex that matches a STANDALONE run of that
    shape: '#'→a digit, '@'→a letter, any other char→itself (a literal
    separator). Word-boundary guards stop it matching a slice of a longer run
    (so '####-####-#' won't grab 4 of 5 digits)."""
    body = []
    for c in shape:
        if c == '#':
            body.append(r'\d')
        elif c == '@':
            body.append(r'[A-Za-z]')
        else:
            body.append(re.escape(c))
    return r'(?<![A-Za-z0-9])' + ''.join(body) + r'(?![A-Za-z0-9])'


def _fold_shape(sig: str) -> str:
    """Fold a PURELY-NUMERIC shape signature to a length- and thousands-grouping-
    INVARIANT family, so a number's digit-count and thousands grouping never create a
    spurious "wrong shape" anomaly:

        '#####' / '######'    -> '#'     (invoice numbers legitimately vary in length)
        '###.##' / '#,###.##'  -> '#.#'  (an amount that crosses into the thousands)

    A shape carrying LETTERS ('@') or STRUCTURAL separators (anything but the numeric
    thousands/decimal set ',' '.' ' ') is returned UNCHANGED — there the digit-group
    length + separator structure IS meaningful (e.g. a '####-####-#' reference), so the
    exact-shape guard that shape_signature exists for is fully preserved.

    WHY: a number's length and thousands grouping are inherently variable. Encoding the
    exact digit count into the accepted-shape veto silently REJECTED or TRUNCATED valid
    values whose length happened to be rarer than the corpus norm — a 6-digit invoice
    number in a 5-digit-dominated corpus was withheld ("format" reject), and a £1,000s
    total among mostly sub-£1,000 history was trimmed to its 3-digit tail ('4,699.20' ->
    '699.20'). Folding collapses all same-class numbers into ONE family, so it clears the
    proportional acceptance bar together and no legitimate amount/reference is an anomaly.

    A shape with LETTERS ('@') or a STRUCTURAL separator gets the SAME length-invariance for a
    SINGLE running-number group (a fixed prefix + counter): '@@@###'/'@@@####' -> '@@@#',
    '@@-####' -> '@@-#', '@@@-####' -> '@@@-#'. This is the identical fix for the most common
    invoice/PO/SO/order-number shape (INV001 -> INV1234 rolled the counter to 4 digits), which
    the pure-numeric branch alone left withheld. A MULTI-group reference (>= 2 digit runs, e.g.
    '####-####-#') is returned UNCHANGED — there the per-group lengths + separator STRUCTURE are
    meaningful (a truncated/mis-structured code), so the exact-shape drift guard stays intact.
    Pure/deterministic."""
    if not sig:
        return sig
    if '@' not in sig and all(c in '#,. ' for c in sig):
        # PURE NUMERIC: drop thousands separators, collapse EVERY digit run -> length/grouping-invariant.
        return re.sub(r'#+', '#', sig.replace(',', '').replace(' ', ''))
    # Has letters / a structural separator. First canonicalise the INTERCHANGEABLE ref separators
    # ('-' '/' '.') to one marker, so a supplier that writes "AB-126" and "AB/126" (or "12.34" vs
    # "12-34") folds to ONE family — a separator-CHARACTER-only difference is not a format anomaly.
    # The group STRUCTURE (number of groups + their digit lengths) is preserved, so a truncated /
    # mis-structured ref ("####-####" vs "####-####-#") is still caught.
    sig = re.sub(r'[-/.]', '-', sig)
    # Then fold a SINGLE running-number group's length (prefix + counter); keep a multi-group ref exact.
    if len(re.findall(r'#+', sig)) == 1:
        return re.sub(r'#+', '#', sig)
    return sig


def _is_numeric_family(shape: str) -> bool:
    """True when `shape` is a folded numeric family (only '#' and a decimal '.', no
    letters/structural separators) — its '#' denotes a whole digit RUN, so column-bleed
    extraction needs the run-aware regex below, not the per-glyph _shape_to_regex."""
    return bool(shape) and all(c in '#.' for c in shape)


def _numeric_family_regex(fam: str) -> str:
    """Regex for a folded numeric family: each '#' is a digit RUN with optional THOUSANDS
    grouping, '.' the literal decimal point. Boundary-guarded like _shape_to_regex so it grabs a
    standalone amount ("152567", "4,699.20") out of column-bleed and never a slice of a longer
    alphanumeric run.

    A '#' is `\\d+(?:[,\\s]\\d{3})*` — a run that only continues across a comma/space when the
    NEXT group is exactly 3 digits (a thousands boundary). It must NOT be `\\d[\\d,\\s]*`: that
    let a space span the gap between two amounts on one line, so "12.50 34.00" recovered as
    "12.50 34" — silent MAGNITUDE corruption. An optional leading '-' keeps a credit/negative
    amount's sign, so "-84.40" is matched WHOLE (never stripped to "84.40")."""
    body = [r'\d+(?:[,\s]\d{3})*' if c == '#' else re.escape(c) for c in fam]
    return r'(?<![A-Za-z0-9])-?' + ''.join(body) + r'(?![A-Za-z0-9])'


def extract_accepted_shape(value: str, format_entry: dict) -> Optional[str]:
    """If `value` carries column-bleed/junk wrapped around a substring that
    matches one of the field's learned accepted SHAPES, return just that
    substring — e.g. trim "2605-0769-1 Work Address Beaumont" to "2605-0769-1".

    Universal and learned: driven entirely by the field's own accepted shapes,
    never a per-field pattern. Returns None when no shapes are learned, the value
    already IS an accepted shape (nothing to trim), or no accepted-shape run is
    found inside it. Picks the LONGEST match so a fuller value wins.

    A match is REJECTED when it would cut a CONTINUING code: if the matched run is bounded by a
    ref separator ('-' '/' '.') that runs on into more alnum, the value continues as valid code
    past the match, so trimming would silently drop part of it ("5678-1234" must not return
    "5678"). Genuine column-bleed is bounded by a SPACE/word ("152567 Work Address"), not
    separator+alnum, so it still trims."""
    shapes = (format_entry or {}).get('shapes')
    if not shapes:
        return None
    v = (value or '').strip()
    if not v or _fold_shape(shape_signature(v)) in shapes:
        return None
    best = None
    for shape in shapes:
        try:
            # A folded numeric family's '#' is a whole digit RUN → run-aware regex; a
            # structured/code shape stays per-glyph so it can't over-match a longer run.
            rx = _numeric_family_regex(shape) if _is_numeric_family(shape) else _shape_to_regex(shape)
            matches = list(re.finditer(rx, v))
        except re.error:
            continue
        for m in matches:
            if re.match(r'[-/.][A-Za-z0-9]', v[m.end():m.end() + 2]):
                continue   # code continues to the RIGHT (a separator + more alnum) → don't truncate
            if re.search(r'[A-Za-z0-9][-/.]$', v[:m.start()]):
                continue   # code continued from the LEFT → this run is a middle slice, not the value
            if best is None or len(m.group(0)) > len(best):
                best = m.group(0)
    return best


# ── Shape families + match score (Phase 2 — additive, diagnostic only) ─────────
# Purely-additive view over the SAME shape signatures `check_value` already uses.
# These NEVER change an anomaly decision, a confidence cap, a note, or any return
# shape — they exist for surfacing/diagnostics and as the foundation for a later
# candidate-override phase. shape_match_score reuses shape_signature +
# extract_accepted_shape so it can never disagree with check_value's accept rule.

MAX_SHAPE_FAMILIES = 6   # cap on the families VIEW (does not affect fmt['shapes'])


def _shape_canonical(shape: str) -> str:
    """Fold a shape so near-duplicates that differ only by SEPARATOR-RUN LENGTH
    group together: collapse a run of the same separator char to one. Group lengths
    (#/@ runs) are preserved, so genuinely different structures stay distinct.
        '####--####-#' -> '####-####-#'   (extra '-' folded)
        '#####-####-#' -> '#####-####-#'  (different group length: unchanged)
    """
    out = []
    prev = None
    for c in shape or '':
        if c in ('#', '@'):
            out.append(c)
            prev = None
        else:                      # a separator char — collapse consecutive repeats
            if c != prev:
                out.append(c)
            prev = c
    return ''.join(out)


def shape_families(value_counts, cap: int = MAX_SHAPE_FAMILIES) -> list:
    """Group the confirmed values' shape signatures into FAMILIES, folding
    separator-run near-duplicates, summing document counts, sorted by count desc
    (tie -> lexicographic), capped at `cap`. Pure; derived from the same
    `value_counts` classify_format uses. Returns
        [{'shape': <representative signature>, 'count': int, 'variants': [raw,...]}, ...]
    `last_seen` is intentionally omitted (value_counts carries no timestamp)."""
    vc = value_counts or {}
    groups: dict = {}
    for val, n in vc.items():
        sig = shape_signature(val)
        if not sig:
            continue
        key = _shape_canonical(sig)
        g = groups.setdefault(key, {"count": 0, "variants": {}})
        g["count"] += int(n or 0)
        g["variants"][sig] = g["variants"].get(sig, 0) + int(n or 0)
    families = []
    for key, g in groups.items():
        # representative = highest-count raw variant (tie -> lexicographic)
        rep = max(g["variants"].items(), key=lambda kv: (kv[1], [-ord(c) for c in kv[0]]))[0]
        families.append({"shape": rep, "count": g["count"],
                         "variants": sorted(g["variants"].keys())})
    families.sort(key=lambda f: (-f["count"], f["shape"]))
    return families[:cap]


def shape_match_score(value: str, format_entry: dict) -> float:
    """1.0 exact shape match; 0.8 a learned-shape substring (column-bleed); 0.0
    otherwise (incl. no learned shapes — read 0.0 as "no shape signal", NOT
    "anomalous"). Pure, deterministic, side-effect free; reuses shape_signature +
    extract_accepted_shape so it agrees with check_value's accept rule."""
    shapes = (format_entry or {}).get('shapes')
    if not value or not shapes:
        return 0.0
    if _fold_shape(shape_signature(value)) in shapes:
        return 1.0
    if extract_accepted_shape(value, format_entry):
        return 0.8
    return 0.0


# ── Consensus classification over a sample ───────────────────────────────────

def classify_format(values: list[str], value_counts: dict | None = None) -> dict:
    """
    Infer a format class from a list of confirmed historical values.

    Takes the _SAMPLE_POOL_SIZE most-recent values (caller should pass
    values ordered newest-first), draws the first _SAMPLE_SIZE from that
    pool, and requires ALL of them to agree on the same class.

    Any disagreement → {'class': FREETEXT, 'separators': frozenset()}.

    Returns:
        {'class': str, 'separators': frozenset, 'shapes': frozenset}
        'separators' is populated for ALPHANUM_SEP only (union across pool).
        'shapes' is the SET of within-class shape_signatures that are accepted
        for this field. When `value_counts` (value → confirmed-document count)
        is supplied, a shape is accepted once it has been confirmed at least
        _SHAPE_ACCEPT_MIN times — so a field can legitimately carry more than
        one structure (e.g. a 4- and a 5-digit reference) without permanently
        flagging the rarer one. When `value_counts` is omitted (legacy / direct
        / test callers) it falls back to the original behaviour: a single shape,
        learned only if the entire recent pool is unanimous.
    """
    # Deduplicate in insertion order (values from getFieldFormats are already
    # distinct, but guard here for direct callers and test code)
    seen: dict[str, None] = {}
    for v in (values or []):
        s = (v or '').strip()
        if s:
            seen[s] = None
    clean = list(seen.keys())

    if len(clean) < 3:
        return {'class': FREETEXT, 'separators': frozenset()}

    pool   = clean[:_SAMPLE_POOL_SIZE]
    sample = pool[:_SAMPLE_SIZE]

    classes = [classify_single(v) for v in sample]
    unique  = set(classes)

    if len(unique) != 1:
        return {'class': FREETEXT, 'separators': frozenset(), 'shapes': frozenset()}

    cls = unique.pop()

    seps = frozenset()
    if cls == ALPHANUM_SEP:
        seps = frozenset(c for v in pool for c in v if not c.isalnum())

    # Learn the SET of within-class shapes this field accepts.
    #
    # Preferred path (value_counts present): sum confirmed-document counts per
    # shape_signature across ALL confirmed values, and accept every shape that
    # clears _SHAPE_ACCEPT_MIN. This lets a field carry several legitimate
    # structures at once — a new shape is flagged until it has been confirmed
    # enough times, then it joins the accepted set and stops being flagged.
    #
    # Fallback path (no value_counts): the original unanimous-pool rule — accept
    # exactly one shape, and only when the whole recent pool shares it; any
    # variation learns no shape constraint at all.
    shapes = frozenset()
    if cls in _SHAPED_CLASSES:
        # Shapes are FOLDED (_fold_shape) so a purely-numeric field's digit-count and
        # thousands grouping don't fragment one legitimate family across many exact-length
        # shapes (which then each fell below the acceptance bar). Structured refs/codes fold
        # to themselves, so their exact-shape guard is untouched.
        if value_counts:
            shape_counts: dict[str, int] = {}
            for val, n in value_counts.items():
                sig = _fold_shape(shape_signature(val))
                if sig:
                    shape_counts[sig] = shape_counts.get(sig, 0) + int(n or 0)
            # Corpus-size-proportional trust (anti-poisoning): a shape is trusted iff it clears
            # the absolute escape, OR both the floor and a fraction of the corpus N. So a couple
            # of bad confirmations can't join the trusted set on a large corpus, while a genuine
            # new format still establishes with proportional support. See constants above.
            N   = sum(int(n or 0) for n in value_counts.values())
            thr = max(_SHAPE_ACCEPT_MIN, math.ceil(_SHAPE_ACCEPT_RATIO * N))
            shapes = frozenset(sig for sig, c in shape_counts.items()
                               if c >= _SHAPE_ACCEPT_ABS or c >= thr)
        else:
            pool_shapes = {_fold_shape(shape_signature(v)) for v in pool}
            if len(pool_shapes) == 1:
                shapes = frozenset(pool_shapes)

    # NUMERIC-FAMILY separator tolerance: when every learned shape is a folded numeric
    # family (a money/amount field), the thousands/decimal separators ',' '.' ' ' are ALL
    # universally valid — so a value that crosses into the thousands ('4,699.20') is never
    # flagged for an "unexpected" comma just because the sampled pool happened to be
    # sub-thousand (no comma). Same corpus-skew class as the shape fold, on the separator
    # axis. Only widens a field already proven numeric; structured refs keep their exact
    # learned separators.
    if cls == ALPHANUM_SEP and shapes and all(_is_numeric_family(s) for s in shapes):
        seps = seps | frozenset(',. ')

    # REF-SEPARATOR tolerance: when a structured code field's learned separators are all drawn
    # from the interchangeable ref set ('-' '/' '.'), accept ANY of them — a supplier that writes
    # "AB-126" and "AB/126" interchangeably shouldn't have the rarer separator flagged as an
    # "unexpected character" just because the sampled pool used the other. Pairs with the
    # separator-fold in _fold_shape (which already folds the SHAPE); this clears the CHARSET axis.
    elif cls == ALPHANUM_SEP and seps and seps <= frozenset('-/.'):
        seps = seps | frozenset('-/.')

    return {'class': cls, 'separators': seps, 'shapes': shapes}


# ── Anomaly check ─────────────────────────────────────────────────────────────

def _disallowed_chars(value: str, cls: str, seps: frozenset) -> frozenset:
    """Returns characters in value that are disallowed by the format class."""
    bad: set[str] = set()
    for c in value:
        if cls == DIGITS_ONLY:
            if not c.isdigit():
                bad.add(c)
        elif cls == UPPER_ALPHANUM:
            if not (c.isupper() or c.isdigit()):
                bad.add(c)
        elif cls == ALPHANUM:
            if not c.isalnum():
                bad.add(c)
        elif cls == ALPHANUM_SEP:
            if not (c.isalnum() or c in seps):
                bad.add(c)
    return frozenset(bad)


def check_value(value: str, format_entry: dict) -> Optional[dict]:
    """
    Compare a value against a learned format entry.

    Returns None if the value is consistent with the learned format (or if
    no constraint applies).

    Returns an anomaly dict on violation:
        {'anomaly': str, 'severity': 'low' | 'high'}

    severity 'high' = structurally disallowed character(s) in a strict class
                      (e.g. letter in a digits_only field)
    severity 'low'  = border-case mismatch (e.g. extra separator in alphanum_sep
                      beyond the learned separator set)
    """
    cls  = format_entry.get('class', FREETEXT)
    seps = format_entry.get('separators', frozenset())
    v    = (value or '').strip()

    if not v or cls == FREETEXT:
        return None

    if cls == DATE_LIKE:
        if parse_date(v) is None:
            return {
                'anomaly':  'date_like field, value does not parse as date',
                'severity': 'high',
            }
        return None

    if cls == CURRENCY_LIKE:
        if parse_amount(v) is None:
            return {
                'anomaly':  'currency_like field, value does not parse as currency amount',
                'severity': 'high',
            }
        return None

    disallowed = _disallowed_chars(v, cls, seps)
    if disallowed:
        severity = 'high' if cls in (DIGITS_ONLY, UPPER_ALPHANUM) else 'low'
        return {
            'anomaly':  f"{cls} field, unexpected character(s): {sorted(disallowed)!r}",
            'severity': severity,
        }

    # Stricter within-class shape check. The value fits the coarse class, but a
    # learned set of shape signatures (digit-group lengths + separator positions)
    # lets us still flag a structurally wrong value — e.g. an extra digit
    # ('11111-1111-1' vs learned '####-####-#') or a missing/extra hyphen.
    # A value is only flagged when its shape is in NEITHER of the accepted
    # shapes, so a field that legitimately has more than one structure (each
    # confirmed enough times) is never penalised. Empty/absent set → no shape
    # constraint. Low severity: it forces review, never an auto-correction.
    shapes = format_entry.get('shapes')
    if shapes:
        vsig = _fold_shape(shape_signature(v))   # numeric length/grouping-invariant; raw for structured
        if vsig not in shapes:
            return {
                'anomaly':  f"{cls} field, shape {vsig!r} not in learned shapes {sorted(shapes)!r}",
                'severity': 'low',
            }

    return None


# ── Digits-only OCR cleanup + correction proposal (Stage 2) ──────────────────

# Reuse the extractor's existing OCR confusable map (l/I→1, O→0, S→5, …) rather
# than duplicating it, extended with the one digit-only-specific case it lacks:
# a slash misread for a 7. Scoped to digit-only output only — never applied to
# alphanumeric or free-text fields.
_DIGIT_OCR_SUBST = {**LETTER_TO_DIGIT, '/': '7'}

# Characters legitimately stripped when normalising to digits-only (separators,
# whitespace) — their removal counts as a "safe" change for the confident path.
_STRIPPABLE = frozenset(' \t.,-_')


def clean_digits_only(value: str) -> str:
    """Conservatively normalise a value toward digits-only output.

    Order (per spec): (1) apply the OCR substitution map, (2) drop every
    character that is not a digit — letters, spaces, punctuation, (3+4) leading,
    trailing, and interior whitespace are removed as a consequence of the
    digit-only filter, (5) the meaningful digits are preserved in order.
    """
    s = value or ''
    s = ''.join(_DIGIT_OCR_SUBST.get(c, c) for c in s)   # 1
    s = ''.join(c for c in s if c.isdigit())             # 2 (+3,4 implicitly)
    return s                                              # 5


def propose_correction(value: str, format_entry: dict) -> Optional[dict]:
    """Propose a digits-only cleanup for a value on a digits_only field.

    Returns None unless the learned class is DIGITS_ONLY and cleanup yields a
    different, valid all-digit string. Otherwise returns:
        {'corrected': str, 'note': str, 'confident': bool}

    `confident` is True only when EVERY character that was substituted or
    removed was a known OCR confusable or a strippable separator/space — i.e.
    the cleanup is unambiguous (e.g. "/ 36714" → "736714", "I36714" → "136714").
    A value like "INV12345" requires dropping 'N'/'V' (not confusables), so it
    is returned as a non-confident CANDIDATE — never silently auto-applied.
    """
    if (format_entry or {}).get('class') != DIGITS_ONLY:
        return None
    original = (value or '').strip()
    if not original:
        return None
    cleaned = clean_digits_only(original)
    if not cleaned or cleaned == original or not cleaned.isdigit():
        return None
    confident = all(
        c.isdigit() or c in _DIGIT_OCR_SUBST or c in _STRIPPABLE
        for c in original
    )
    note = (f"Auto-corrected digits-only field from '{original}' to '{cleaned}'."
            if confident
            else f"format anomaly: correction candidate — {cleaned}")
    return {'corrected': cleaned, 'note': note, 'confident': confident}


# ── Valid-character policy (Phase 1) ──────────────────────────────────────────

def charset_disallowed(value, allowed_extra) -> list:
    """Return the sorted DISALLOWED characters in `value` for a field type — anything
    that is NOT alphanumeric, NOT whitespace, and NOT in `allowed_extra` (the per-type
    extra-punctuation string from config `field_charsets`). The OCR replacement char
    U+FFFD therefore always counts as disallowed. `allowed_extra is None` => no
    constraint (free text) => []. Backend-only FLAG signal — never strips/mutates."""
    if allowed_extra is None or not value:
        return []
    extra = set(allowed_extra)
    bad = {c for c in str(value) if not c.isalnum() and not c.isspace() and c not in extra}
    return sorted(bad)


# ── Misread-separator recovery (reggie) ─────────────────────────────────────────

def learn_ref_separator(value_counts: dict, shapes) -> "str | None":
    """The single ref separator that DOMINATES a structured-code field's confirmed history,
    or None. Derived from RAW value_counts, BEFORE _fold_shape / the separator-widen erase the
    literal char (a uniform-dash, a uniform-dot and a mixed field ALL end up storing
    shapes={'@@-#'}). Counts only a value carrying EXACTLY ONE distinct ref-separator char
    (0 or >1 → abstain, conservative); excludes numeric-family money shapes (their '.' is a
    decimal). Returns the top separator only when it covers >= _SEP_DOMINANCE of the counted docs
    over >= _SHAPE_ACCEPT_MIN docs — so a genuinely MIXED-separator field returns None and the
    misread check below stays INERT, preserving the deliberate interchangeable-separator fold.
    Pure/deterministic."""
    if not shapes or any(_is_numeric_family(s) for s in shapes):
        return None
    counts, total = {}, 0
    for val, n in (value_counts or {}).items():
        n = int(n or 0)
        if n <= 0:
            continue
        seps = {c for c in (val or '') if c in _REF_SEPS}
        if len(seps) == 1:
            s = next(iter(seps))
            counts[s] = counts.get(s, 0) + n
            total += n
    if not counts or total < _SHAPE_ACCEPT_MIN:
        return None
    top, tc = max(counts.items(), key=lambda kv: kv[1])
    return top if (tc / total) >= _SEP_DOMINANCE else None


def propose_sep_fix(value: str, format_entry: dict) -> "str | None":
    """If `value` carries a FOREIGN, known-confusable separator where the field's history is
    dominated by a DIFFERENT one (sep_uniform), return the value with every foreign separator
    swapped to the learned one — provided the swap lands on a learned shape. A likely OCR misread
    ("PO.20011" -> "PO-20011" when history is uniformly '-'). Else None. Recover-and-FLAG: the
    caller SUGGESTS this (corrected_to), never silently rewrites. Pure/deterministic."""
    sep = (format_entry or {}).get('sep_uniform')
    if not sep or not value:
        return None
    v = str(value)
    wrong = {c for c in v if c in _REF_SEPS and c != sep}
    if not wrong or not all(sep in _SEP_CONFUSIONS.get(w, ()) for w in wrong):
        return None
    cand = ''.join(sep if c in wrong else c for c in v)
    shapes = (format_entry or {}).get('shapes') or ()
    if shapes and _fold_shape(shape_signature(cand)) not in shapes:   # belt-and-braces vs a spurious swap
        return None
    return cand if cand != v else None


# ── Index builder ─────────────────────────────────────────────────────────────

def _derive_charset(values) -> dict | None:
    """Character-class summary of a scope's confirmed values, by UNANIMITY (ANCHOR_CHARSET_DEBRIS):
    {has_letter, has_digit, has_space, literals:set}. has_letter True means SOME confirmed value
    carried a letter — so a letter can never be treated as impossible junk for this scope. Returns
    None when no non-empty values (⇒ no descriptor ⇒ the debris arm abstains)."""
    has_letter = has_digit = has_space = False
    literals: set = set()
    n = 0
    for v in values:
        s = str(v or '')
        if not s:
            continue
        n += 1
        for c in s:
            if c.isalpha():
                has_letter = True
            elif c.isdigit():
                has_digit = True
            elif c.isspace():
                has_space = True
            else:
                literals.add(c)
    if not n:
        return None
    return {'has_letter': has_letter, 'has_digit': has_digit,
            'has_space': has_space, 'literals': literals}


def build_format_class_index(formats_data: list) -> dict:
    """
    Build a lookup dict keyed by (supplier_lower, doc_type_lower, field_key).

    Only entries where classify_format() resolves to a non-freetext class
    are stored — freetext entries are silently dropped (no constraint to apply).

    Groups with fewer than 3 sample values are skipped.  This is belt-and-
    braces: getFieldFormats() already filters to ≥3 distinct confirmed values
    on the JS side, but the check guards against direct callers and test stubs.

    Strict (supplier, document_type, field_key) scoping is the only key
    structure used — no cross-supplier or cross-type fallback.
    """
    index: dict[tuple, dict] = {}

    for entry in (formats_data or []):
        supplier  = (entry.get('supplier_name') or '').lower().strip()
        doc_type  = (entry.get('document_type')  or '').lower().strip()
        field_key = entry.get('field_key', '')
        samples   = entry.get('sample_values') or []
        vcounts   = entry.get('value_counts') or None

        # Require a doc-type + field, but ALLOW an empty supplier: the
        # doc-type-scoped groups getFieldFormats emits for document-agnostic
        # learning are keyed ('', doc_type, field). Rejecting empty-supplier
        # entries here silently DROPPED every one of them from the index, so
        # _make_format_lookup's ('', d, fk) fallback never found anything and the
        # qualification gate was effectively OFF for any supplier-agnostic setup
        # (it only mattered on a drifted/degraded crop, which is why clean pages
        # still looked fine). Keep supplier-scoped entries too.
        if not doc_type or not field_key:
            continue
        # PROVISIONAL entries (below the ≥3-confirm bar, tagged by learning.js) must NEVER
        # enter the MAIN index (Oracle NIGHT 2026-08-03 S2: a 1-count taught skeleton must
        # not veto legitimate sibling variation pipeline-wide). They feed ONLY the separate
        # consent-only index below. The <3 length check would drop most of them anyway —
        # this is the explicit, pinned guarantee.
        if entry.get('provisional'):
            continue
        if len(samples) < 3:
            continue

        fmt = classify_format(samples, vcounts)

        # Token lexicon for NAME-LIKE fields (company/customer), Phase 1 canonical
        # repair. Built here so it's computed ONCE per group and attached to the
        # fmt entry the Stage 4.5 loop already resolves. Names are usually coarse
        # class FREETEXT, so this MUST be attached even when the class is freetext —
        # otherwise the entry is dropped below and the repair has nothing to read.
        name_lex = None
        word_like = None
        try:
            from extraction import value_quality, name_match
            if value_quality.is_name_like_field(field_key):
                lex = name_match.build_token_lexicon(vcounts or {}, entry.get('confirmed_count'))
                if lex and lex.get('positions'):
                    name_lex = lex
                # word_like self-calibration (reggie follow-up): mean name-quality over the
                # confirmed values. A name-LABELLED but CODE-valued field (e.g. a custom
                # "vendor_code" holding "AB-1234") scores low -> word_like False, which the
                # engine's wordness gate reads to SELF-DISABLE the language flag (the field's
                # own regex owns it). A genuine name field scores high -> word_like True.
                _vals = list((vcounts or {}).keys()) or samples
                _qs = [value_quality.name_quality(v) for v in _vals if v]
                if _qs:
                    word_like = (sum(_qs) / len(_qs)) >= 0.5
        except Exception:
            name_lex = None

        if fmt['class'] == FREETEXT and not name_lex:
            continue  # no usable constraint learned and no name lexicon

        if name_lex:
            fmt = {**fmt, 'name_lexicon': name_lex}
        if word_like is not None:
            fmt = {**fmt, 'word_like': word_like}
        # Additive families VIEW (Phase 2) — diagnostic only; existing consumers read
        # class/separators/shapes and never see this key. Empty when no shapes/counts.
        if fmt.get('shapes') and vcounts:
            fams = shape_families(vcounts)
            if fams:
                fmt = {**fmt, 'shape_families': fams}
        # Dominant learned SEPARATOR (reggie) — carries the raw '-'/'.'/'/' the fold erases, so
        # Stage 4.5 can flag a MISREAD separator ("PO.20011" where history is uniformly "PO-…").
        # Additive: absent unless one separator dominates a non-numeric structured code.
        _sep_uni = learn_ref_separator(vcounts or {}, fmt.get('shapes'))
        if _sep_uni:
            fmt = {**fmt, 'sep_uniform': _sep_uni}
        # How much confirmed history backs this format — the learned-agreement confidence
        # boost (engine Stage 4.5) scales with it. confirmed_count (total confirmed docs) is
        # the strongest signal; fall back to the distinct-sample count (already >= 3 here).
        _support = entry.get('confirmed_count')
        if not _support and vcounts:
            _support = sum(int(n or 0) for n in vcounts.values())
        fmt = {**fmt, 'support': int(_support) if _support else len(samples)}
        # Learned CHARSET descriptor (ANCHOR_CHARSET_DEBRIS, Oracle C2 2026-07-27) — derived by
        # UNANIMITY over ALL raw distinct confirmed values (value_counts keys ∪ samples), NOT the
        # ratio-accepted shapes: one lettered confirm anywhere ⇒ has_letter True ⇒ the debris arm
        # permanently refuses letter-stripping for the scope (fail-safe: a poisoned confirm can
        # only DISABLE the arm, never widen it; a Learning-Repair purge re-enables with no code
        # change). Additive key — non-freetext entries only; no existing consumer reads it.
        if fmt.get('class') != FREETEXT:
            _cs = _derive_charset(set((vcounts or {}).keys()) | set(samples))
            if _cs:
                fmt = {**fmt, 'charset': _cs}
        index[(supplier, doc_type, field_key)] = fmt

    return index


# ── PROVISIONAL taught-skeleton index (Oracle NIGHT 2026-08-03, gary #3 + S2) ─────────────────
# Day-one shape witness for a freshly-taught template: the taught/early-confirmed values' shape
# skeletons, from the `provisional: true` groups learning.js now emits for BELOW-the-≥3-bar
# scopes. CONSENT-ONLY by construction — a SEPARATE index consumed exclusively by the mapper's
# clean-commit consent ladder (template_mapper._shape_consents). It must NEVER be visible to
# _format_rejects / check_value / _gate_value (the ≥3-confirm VETO principle stays verbatim;
# pinned in tests). Lone-skeleton corroboration can only LICENSE a heal that already carries an
# independent witness — it can never reject or flag anything.

def build_provisional_shape_index(formats_data: list) -> dict:
    """(supplier_lower, doc_type_lower, field_key) -> set of canonical shape skeletons."""
    idx: dict[tuple, set] = {}
    for entry in (formats_data or []):
        if not isinstance(entry, dict) or not entry.get('provisional'):
            continue
        supplier = (entry.get('supplier_name') or '').lower().strip()
        doc_type = (entry.get('document_type') or '').lower().strip()
        field_key = entry.get('field_key', '')
        if not doc_type or not field_key:
            continue
        sks = set()
        for v in (entry.get('sample_values') or []):
            if v:
                try:
                    sks.add(_shape_canonical(shape_signature(str(v))))
                except Exception:
                    pass
        if sks:
            idx.setdefault((supplier, doc_type, field_key), set()).update(sks)
    return idx


def provisional_shape_accepts(value, skeleton_set) -> bool:
    """Does `value`'s canonical skeleton match a provisionally-taught skeleton? Pure;
    False on any doubt (consent-only — a False here only declines a heal)."""
    if not value or not skeleton_set:
        return False
    try:
        return _shape_canonical(shape_signature(str(value))) in skeleton_set
    except Exception:
        return False
