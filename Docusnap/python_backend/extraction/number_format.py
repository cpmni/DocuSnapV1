"""
extraction/number_format.py
---------------------------
Region-aware numeric NORMALISER (Phase 2 of REGION_SETTINGS_PLAN.md).

Money amounts group thousands and mark the decimal DIFFERENTLY by region:

    anglo        1,234.56     ,thousands  .decimal   (US, UK, most Anglo, JP, CN)
    continental  1.234,56     .thousands  ,decimal   (DE, ES, IT, NL, most of Europe/LatAm)
    french       1 234,56     (space)thousands ,decimal  (FR, francophone, official SI)
    swiss        1'234.56     'thousands  .decimal   (CH, LI)
    indian       12,34,567.89 ,thousands  .decimal   (India — 2-2-3 grouping)

`to_canonical(value, fmt)` rewrites the NUMERIC run(s) inside a string to the canonical
`1234.56` form (thousands stripped, '.' decimal), leaving any currency symbol/code, sign
and surrounding text intact. The downstream currency validation pattern + display then
work on a single, well-defined shape regardless of the operator's region.

`anglo` (and `indian`, which already use '.' decimal + ',' thousands) return the value
UNCHANGED — byte-identical to the historical behaviour, so an existing install is
unaffected until a user picks a non-Anglo region. Pure, offline, no deps.

Runs BACKEND-only: extracted money is normalised (and the currency symbol stripped) at
extraction time, so the stored value is always canonical numbers-only — the renderer's
on-blur validator and Search work on that canonical value (the shared bare-number
`validation_patterns.currency` entry accepts it). A renderer-side JS twin for accepting a
region-FORMATTED amount typed into the Search box (e.g. a Continental user typing
"1.234,56") is a deferred follow-up (see REGION_SETTINGS_PLAN.md); there is intentionally
no JS twin today.
"""

import re

_FORMATS = ("anglo", "continental", "french", "swiss", "indian")

# A numeric run: starts and ends with a digit, allowing the region separators in between
# (comma, dot, apostrophe, and space variants incl. NBSP/thin-space). A lone digit also matches.
_NUM_RE = re.compile(r"\d[\d.,'   ]*\d|\d")


# Process-wide region number format, set ONCE by set_format() (from process_docs
# --number-format → the region_number_format setting). Default 'anglo' = byte-identical.
_NUMBER_FORMAT = "anglo"


def strip_currency(value):
    """Remove any currency symbol/code (and the space it leaves) from a money value, leaving
    JUST the number: "$12,268.80" -> "12,268.80"; "GBP 118.83" -> "118.83"; "€1234.56" ->
    "1234.56". A value with no currency marker, and non-amounts, pass through unchanged."""
    if not value:
        return value
    s = str(value)
    s = re.sub(r"[£$€¥₹]", "", s)
    s = re.sub(r"\b(?:GBP|USD|EUR|JPY|INR|CAD|AUD|NZD|CHF|CNY|ZAR)\b", "", s, flags=re.IGNORECASE)
    return s.strip()


def normalise_currency_spacing(value):
    """Rejoin a thousands separator that OCR (or a PDF text layer) rendered as a SPACE, or
    split across word tokens, so "$10,576.31" reads as "$10 576.31" / "$10, 576.31" / even
    "$1 234 567.89". A currency value has no internal space, so a space (or comma+space)
    sitting between a digit and a following 3-digit group is a thousands boundary — collapse
    it back to a comma. Without this a currency read is TRUNCATED at the gap: the value regex
    (a contiguous match) stops at the space and returns just "$10". Non-numeric text and an
    already-contiguous value are untouched (no space → returned verbatim). Reusable across
    every supplier/field — no per-document logic. Shared by anchor.py (crop/inline paths) AND
    keyword.py (Stage 1) so the two never drift on OCR-split money."""
    if not value or ' ' not in value:
        return value
    prev = None
    out = value
    # 1) THOUSANDS: a space/comma between a digit and a 3-digit group → comma. Loop so
    # consecutive groups both collapse ("$1 234 567" → "$1,234,567"); re.sub's non-overlapping
    # scan gets adjacent ones, the loop the rest.
    while prev != out:
        prev = out
        out = re.sub(r'(?<=\d)[,\s]+(?=\d{3}(?:\D|$))', ',', out)
    # 2) DECIMAL point split by OCR spacing: "5,767 .71" / "5,767. 71" / "5,767 . 71" → "5,767.71".
    out = re.sub(r'(?<=\d)\s*\.\s*(?=\d)', '.', out)
    # 3) trailing 2-digit DECIMAL with the point dropped entirely: "5,767 71" → "5,767.71".
    # End-anchored (a thousands group is 3 digits, so a 2-digit group at the very end is the
    # cents) so it can't be mistaken for a thousands boundary.
    out = re.sub(r'(?<=\d)\s+(?=\d{2}\s*$)', '.', out)
    return out


# ── STRICT money shape (2026-08-30, reggie design; hoisted from template_mapper._MONEY_WELLFORMED_RE) ──
# The pipeline's `validator.parse_amount` / `validation_patterns.currency` are SEARCHES: a garbled zone
# read like '£9 32632.76' "parses" as 9.0 and passes every loose gate. This is the WHOLE-STRING
# discipline — sign / currency symbol / code / accounting parens stripped, then the bare literal must be
# a canonically grouped amount. Region-aware by construction: the value is first pushed through the same
# two cleaners the keyword and crop paths already apply (`canonical` + `normalise_currency_spacing`, both
# idempotent), so a continental '2.363,76' under a continental install is judged as '2363.76'. Internal
# whitespace is deliberately NOT stripped afterwards — after the respacing pass it IS the invalidity
# signal ('9 32632.76' survives respacing: the 3-digit-group lookahead never fires on '32632').
# Consumers: the corroboration record's format-invalid-witness discount, the Stage-0.5 format-fail
# yield's strict currency leg, the re-slice witness STOP predicate. Pinned in
# tests/test_money_strict_shape.py. `template_mapper._money_wellformed` is an alias of
# `money_wellformed` (its truth table — incl. the deliberately-accepted clipped '0,603.44' — is pinned
# in tests/test_money_snap_proof.py and unchanged).
MONEY_STRICT_RE        = re.compile(r"(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?")
MONEY_STRICT_INDIAN_RE = re.compile(r"\d{1,2}(?:,\d{2})*,\d{3}(?:\.\d{1,2})?")     # lakh grouping, region-gated
_CODE_STRIP_RE = re.compile(r"(?<![A-Za-z])(?:GBP|USD|EUR|JPY|INR|CAD|AUD|NZD|CHF|CNY|ZAR)(?![A-Za-z])", re.I)
_CR_STRIP_RE   = re.compile(r"(?<![A-Za-z])CR(?![A-Za-z])", re.I)                  # accounting credit marker
_NEG_HINT_RES  = (re.compile(r"^\s*[(\[]"),                                          # (160.32)
                  re.compile(r"^\s*[£$€¥₹]?\s*[-–—]\s*[£$€¥₹]?\s*\d"),               # -£1.00 / £-1.00
                  re.compile(r"\d\s*[-–—]\s*$"),                                     # 160.32-
                  re.compile(r"(?<![A-Za-z])CR(?![A-Za-z])", re.I))                  # 160.32 CR


def money_wellformed(bare):
    """True when the WHOLE string (bare of sign/currency/parens/space) is a canonically grouped amount.
    The ORIGINAL template_mapper predicate, verbatim (moved here so one regex serves every consumer)."""
    if not bare:
        return False
    s = str(bare).strip()
    s = re.sub(r"^[\s(\[]*[-–—+]?\s*[£$€]?\s*", "", s)
    s = re.sub(r"\s*(?:GBP|USD|EUR|JPY)?[\s)\]]*$", "", s, flags=re.I)
    return bool(s) and MONEY_STRICT_RE.fullmatch(s) is not None


def _money_bare(value):
    """The amount literal with every non-amount decoration removed (sign, symbol, code, parens,
    accounting minus, CR). Returns '' for a non-money string. Region cleaners run first."""
    s = normalise_currency_spacing(canonical(str(value or "").strip()))
    s = _CR_STRIP_RE.sub("", s)
    s = _CODE_STRIP_RE.sub("", s)
    s = re.sub(r"[£$€¥₹]", "", s)
    s = re.sub(r"^[\s(\[]*[-–—+]?\s*", "", s)          # leading paren / sign
    s = re.sub(r"\s*[-–—]?[\s)\]]*$", "", s)           # trailing paren / accounting minus
    return s.strip()


def money_strict_shape(value) -> bool:
    """Deterministic whole-string money validity (see the block comment above). False for '', for a
    space-bearing amount that respacing could not rejoin ('9 32632.76'), for a double-dot ('2.205.60'),
    for mis-grouped thousands ('1,2345.67'), for any non-digit debris ('L922.14', 'O.00', prose)."""
    s = _money_bare(value)
    if not s:
        return False
    if MONEY_STRICT_RE.fullmatch(s) is not None:
        return True
    return get_format() == "indian" and MONEY_STRICT_INDIAN_RE.fullmatch(s) is not None


def money_cents(value):
    """(cents:int, negative:bool) for a strict-shape amount, else None. Integer cents (never float,
    never the sign-blind parse_amount) — the corroboration fold's comparison key. The sign is read
    from the RAW string (validator._NEG_MARKERS' forms: leading '-', symbol-then-minus, accounting
    trailing minus, parens, CR)."""
    if not money_strict_shape(value):
        return None
    raw = str(value or "")
    neg = any(r.search(raw) for r in _NEG_HINT_RES)
    s = _money_bare(value).replace(",", "")
    ip, _, fp = s.partition(".")
    try:
        return int(ip or "0") * 100 + int((fp + "00")[:2]), neg
    except ValueError:
        return None


_PARENS_MONEY_RE = re.compile(r"\(\s*[£$€¥₹]?\s*(\d[\d.,\s]*?)\s*\)")
_CR_MONEY_RE     = re.compile(r"[£$€¥₹]?\s*(\d[\d.,\s]*?)\s+CR\.?", re.I)


def signed_money_capture(value):
    """A whole-segment ACCOUNTING-NEGATIVE money marker → ('-<bare amount>', kind) else None.

    Two notations only (reggie design 2026-08-31; each behind its own DARK flag at the call
    sites — MONEY_SIGN_PARENS / MONEY_SIGN_CR): balanced parens '(£908.16)' and a trailing CR
    marker '£908.16 CR'. FULLMATCH on the stripped segment — '(10%)', '(see note 3)',
    '908.16 CREDIT', an unbalanced '(£9…' and any embedded prose all return None — and the
    amount itself must pass money_strict_shape, so a garble never gains a sign. A bare
    leading/trailing minus stays note-only by design (the scan dash-leader class; the shipped
    MONEY_SIGN_CAPTURE leg owns the symbol-minus '£-x' shape)."""
    s = normalise_currency_spacing(canonical(str(value or "").strip()))
    for _re, _kind in ((_PARENS_MONEY_RE, "parens"), (_CR_MONEY_RE, "cr")):
        m = _re.fullmatch(s)
        if m:
            amt = m.group(1).strip()
            if money_strict_shape(amt):
                return "-" + _money_bare(amt), _kind
    return None


def set_format(fmt):
    """Set the process-wide region number format: anglo|continental|french|swiss|indian."""
    global _NUMBER_FORMAT
    f = (fmt or "anglo").strip().lower()
    _NUMBER_FORMAT = f if f in _FORMATS else "anglo"


def get_format():
    return _NUMBER_FORMAT


def canonical(value):
    """Normalise `value` using the process-wide format (a no-op for anglo/indian)."""
    return to_canonical(value, _NUMBER_FORMAT)


def to_canonical(value, fmt="anglo"):
    """Return `value` with its numeric run(s) rewritten to canonical 1234.56 form for the
    region `fmt`. anglo/indian (already '.'-decimal) are returned unchanged. Non-numeric
    strings and None pass through untouched."""
    if value is None:
        return value
    fmt = (fmt or "anglo").strip().lower()
    if fmt not in _FORMATS or fmt in ("anglo", "indian"):
        return value

    def _last_sep(num):
        # The DECIMAL separator is the LAST '.' or ',' in the run. anglo/canonical use '.',
        # continental/french use ',' — so this discriminates the two even under a wrong region,
        # guarding a mixed inbox: an anglo "1,234.56" (last sep '.') is left AS-IS instead of
        # being mangled to "1.23456". (Trade-off: a rare continental whole-thousands value with
        # no decimal, "1.234", is left as anglo.)
        last = None
        for ch in num:
            if ch in ".,":
                last = ch
        return last

    def _norm(m):
        num = m.group(0)
        if fmt == "continental":     # . thousands, , decimal
            if _last_sep(num) != ",":
                return num            # doesn't look continental → leave (don't corrupt anglo)
            return num.replace(".", "").replace(",", ".")
        if fmt == "french":          # space (incl. NBSP/thin) thousands, , decimal
            if _last_sep(num) != ",":
                return num            # not french-shaped: leave (guard mixed inbox)
            return re.sub(r"[   ]", "", num).replace(",", ".")
        if fmt == "swiss":           # ' thousands, . decimal
            return num.replace("'", "")
        return num

    return _NUM_RE.sub(_norm, str(value))
