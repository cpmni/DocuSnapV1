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


# ── Consensus classification over a sample ───────────────────────────────────

def classify_format(values: list[str]) -> dict:
    """
    Infer a format class from a list of confirmed historical values.

    Takes the _SAMPLE_POOL_SIZE most-recent values (caller should pass
    values ordered newest-first), draws the first _SAMPLE_SIZE from that
    pool, and requires ALL of them to agree on the same class.

    Any disagreement → {'class': FREETEXT, 'separators': frozenset()}.

    Returns:
        {'class': str, 'separators': frozenset}
        'separators' is populated for ALPHANUM_SEP only (union across pool).
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
        return {'class': FREETEXT, 'separators': frozenset()}

    cls = unique.pop()

    seps = frozenset()
    if cls == ALPHANUM_SEP:
        seps = frozenset(c for v in pool for c in v if not c.isalnum())

    return {'class': cls, 'separators': seps}


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
    if not disallowed:
        return None

    severity = 'high' if cls in (DIGITS_ONLY, UPPER_ALPHANUM) else 'low'
    return {
        'anomaly':  f"{cls} field, unexpected character(s): {sorted(disallowed)!r}",
        'severity': severity,
    }


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


def _strip_edge_noise(value: str) -> str:
    """Strip leading AND trailing runs of non-alphanumeric characters, leaving
    the alphanumeric-bounded core.

    Values of the character-set classes (digits_only / alphanum / upper_alphanum
    / alphanum_sep) always begin and end with an alphanumeric character —
    separators are interior — so stray OCR noise OR a dangling separator at
    either edge ("<-2605-0769-1", "2605-0769-1%\"", "(2605-0769-1)") is safely
    removed, while interior content is never touched (an anomaly whose bad
    characters sit inside the value is left intact for manual review)."""
    start, end = 0, len(value)
    while start < end and not value[start].isalnum():
        start += 1
    while end > start and not value[end - 1].isalnum():
        end -= 1
    return value[start:end]


def propose_correction(value: str, format_entry: dict) -> Optional[dict]:
    """Propose a conservative cleanup for an anomalous value.

    Two reusable, format-class-driven repairs, both strictly scoped by the
    learned (supplier, document_type, field_key) format entry:

      • DIGITS_ONLY — OCR-confusable substitution + drop non-digits. Returned
        as a CONFIDENT auto-fix only when every changed character was a known
        confusable or strippable separator/space ("/ 36714" → "736714");
        otherwise a review-forced CANDIDATE ("INV12345" → "12345").

      • UPPER_ALPHANUM / ALPHANUM / ALPHANUM_SEP — strip leading/trailing runs
        of non-alphanumeric characters (stray edge OCR noise or a dangling edge
        separator: "1234-1234-1%\"" → "1234-1234-1", "<-2605-0769-1" →
        "2605-0769-1"). Always a non-confident CANDIDATE — never a silent
        rewrite — and only proposed when stripping the edges yields a value that
        FULLY satisfies the learned class (interior noise is left for manual
        review).

    Returns None when no safe proposal applies, else:
        {'corrected': str, 'note': str, 'confident': bool}
    """
    cls      = (format_entry or {}).get('class')
    original = (value or '').strip()
    if not original:
        return None

    if cls == DIGITS_ONLY:
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

    if cls in (UPPER_ALPHANUM, ALPHANUM, ALPHANUM_SEP):
        seps     = (format_entry or {}).get('separators', frozenset())
        stripped = _strip_edge_noise(original)
        if (stripped and stripped != original
                and not _disallowed_chars(stripped, cls, seps)):
            return {
                'corrected':  stripped,
                'note':       f"format anomaly: stray edge characters — correction candidate {stripped}",
                'confident':  False,
            }

    return None


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

        if not supplier or not doc_type or not field_key:
            continue
        if len(samples) < 3:
            continue

        fmt = classify_format(samples)
        if fmt['class'] == FREETEXT:
            continue  # no usable constraint learned

        index[(supplier, doc_type, field_key)] = fmt

    return index
