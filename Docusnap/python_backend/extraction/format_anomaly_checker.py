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

# A within-class shape is only ACCEPTED (added to the learned set) once it has
# been seen in at least this many confirmed documents. Below the threshold a new
# shape is still flagged for review, so a one-off OCR-garbled structure never
# gets learned; once a genuinely recurring shape clears it, that shape stops
# being flagged — this is how the field "learns" a second legitimate structure.
_SHAPE_ACCEPT_MIN = 3


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


def extract_accepted_shape(value: str, format_entry: dict) -> Optional[str]:
    """If `value` carries column-bleed/junk wrapped around a substring that
    matches one of the field's learned accepted SHAPES, return just that
    substring — e.g. trim "2605-0769-1 Work Address Beaumont" to "2605-0769-1".

    Universal and learned: driven entirely by the field's own accepted shapes,
    never a per-field pattern. Returns None when no shapes are learned, the value
    already IS an accepted shape (nothing to trim), or no accepted-shape run is
    found inside it. Picks the LONGEST match so a fuller value wins."""
    shapes = (format_entry or {}).get('shapes')
    if not shapes:
        return None
    v = (value or '').strip()
    if not v or shape_signature(v) in shapes:
        return None
    best = None
    for shape in shapes:
        try:
            m = re.search(_shape_to_regex(shape), v)
        except re.error:
            continue
        if m and (best is None or len(m.group(0)) > len(best)):
            best = m.group(0)
    return best


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
        if value_counts:
            shape_counts: dict[str, int] = {}
            for val, n in value_counts.items():
                sig = shape_signature(val)
                if sig:
                    shape_counts[sig] = shape_counts.get(sig, 0) + int(n or 0)
            shapes = frozenset(sig for sig, c in shape_counts.items()
                               if c >= _SHAPE_ACCEPT_MIN)
        else:
            pool_shapes = {shape_signature(v) for v in pool}
            if len(pool_shapes) == 1:
                shapes = frozenset(pool_shapes)

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
    if shapes and shape_signature(v) not in shapes:
        return {
            'anomaly':  f"{cls} field, shape {shape_signature(v)!r} not in learned shapes {sorted(shapes)!r}",
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


# ── Index builder ─────────────────────────────────────────────────────────────

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
        if len(samples) < 3:
            continue

        fmt = classify_format(samples, vcounts)
        if fmt['class'] == FREETEXT:
            continue  # no usable constraint learned

        index[(supplier, doc_type, field_key)] = fmt

    return index
