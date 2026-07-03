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
