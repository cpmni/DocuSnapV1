"""
extraction/validator.py
-----------------------
Stage 4 — cross-field validation and confidence adjustment.
Catches obvious errors before they reach the review queue.
"""

import re
from datetime import datetime

from extraction import number_format   # region-aware amount normaliser


# ── Date parsing ──────────────────────────────────────────────────────────────

# Strip leading day names before parsing: "Monday, 01 May 2024" → "01 May 2024"
_DAY_NAME_RE = re.compile(
    r'^(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|'
    r'Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\s*,?\s*',
    re.IGNORECASE,
)
# Strip ordinal suffixes: "1st" → "1", "22nd" → "22", "3rd" → "3"
_ORDINAL_RE = re.compile(r'\b(\d{1,2})(st|nd|rd|th)\b', re.IGNORECASE)

# Fully-numeric ordering-SENSITIVE formats — the ONLY axis a region setting changes.
# DD-first (UK/EU/most of the world) vs MM-first (US). "03/04/2026" is 3 Apr under _DMY,
# 4 Mar under _MDY; a day-value > 12 makes only one order parse regardless.
_NUMERIC_DMY = ["%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y",
                "%d/%m/%y", "%d-%m-%y", "%d.%m.%y"]
_NUMERIC_MDY = ["%m/%d/%Y", "%m-%d-%Y", "%m.%d.%Y",
                "%m/%d/%y", "%m-%d-%y", "%m.%d.%y"]
# ISO (big-endian) — never ambiguous.
_NUMERIC_ISO = ["%Y-%m-%d", "%Y/%m/%d"]
# Month-NAME formats — never ambiguous (the month is spelled out), so order-independent.
_MONTH_NAME_FORMATS = [
    "%d %B %Y", "%d %b %Y",       # 01 May 2024 / 01 May 24
    "%d %B %y", "%d %b %y",
    "%d %B, %Y", "%d %b, %Y",     # 01 May, 2024
    "%d-%B-%Y", "%d-%b-%Y",       # 01-May-2024
    "%d/%B/%Y", "%d/%b/%Y",       # 01/May/2024
    "%d-%B-%y", "%d-%b-%y",       # 01-May-24
    "%d/%B/%y", "%d/%b/%y",       # 01/May/24
    "%B %d, %Y", "%b %d, %Y",     # May 01, 2024
    "%B %d %Y", "%b %d %Y",       # May 01 2024 (no comma)
    "%B-%d-%Y", "%b-%d-%Y",       # May-01-2024
    "%B %d, %y", "%b %d, %y",     # May 01, 24
    "%B %d %y", "%b %d %y",       # May 01 24 (no comma)
    "%B-%d-%y", "%b-%d-%y",       # May-01-24
]

# Region date order, set ONCE per process by set_date_order() (from process_docs
# --date-order → the region_date_order setting). Default 'dmy' = the historical behaviour,
# so every existing install is byte-identical until a user picks a different region.
_DATE_ORDER = "dmy"


def set_date_order(order):
    """Set the region date-ordering for numeric dates: dmy | mdy | ymd | auto (default dmy)."""
    global _DATE_ORDER
    o = (order or "dmy").strip().lower()
    _DATE_ORDER = o if o in ("dmy", "mdy", "ymd", "auto") else "dmy"


def _formats_for_order(order):
    """Build the strptime priority list for a date order. The unambiguous formats (ISO +
    month-name) are always tried; only the DD-first vs MM-first numeric PRIORITY changes."""
    order = (order or "dmy").lower()
    non_numeric = _NUMERIC_ISO + _MONTH_NAME_FORMATS
    if order == "mdy":               # US — MM/DD first, DD/MM as the fallback
        return _NUMERIC_MDY + non_numeric + _NUMERIC_DMY
    if order == "ymd":               # ISO-first regions (CN/JP/KR) — then DD-first for the rest
        return _NUMERIC_ISO + _NUMERIC_DMY + _MONTH_NAME_FORMATS + _NUMERIC_MDY
    # dmy (default) and auto — DD/MM first, US last (byte-identical to the historical list).
    return _NUMERIC_DMY + non_numeric + _NUMERIC_MDY


# Backwards-compatible module constant (the default DMY ordering) — some callers/tests
# import DATE_FORMATS directly.
DATE_FORMATS = _formats_for_order("dmy")

# How far ahead of "now" a date may sit before it is treated as anomalous.
# Document dates are issue dates that live in the past or present — old dates are
# entirely expected and never flagged on age. Only a date clearly in the FUTURE
# is suspicious. The tolerance (~1 year) absorbs clock skew and legitimately
# near-future dates (e.g. a due/expiry date), so the flag fires only when a date
# is CLEARLY in the future, not merely unusual.
_FUTURE_DATE_TOLERANCE_DAYS = 366

def parse_date(raw: str | None, date_order: str | None = None) -> datetime | None:
    if not raw:
        return None
    s = str(raw).strip()
    # Remove leading day name and optional comma/space
    s = _DAY_NAME_RE.sub('', s).strip().lstrip(',').strip()
    # Remove ordinal suffixes from day numbers
    s = _ORDINAL_RE.sub(r'\1', s)
    # Collapse runs of whitespace that ordinal removal may have created
    s = re.sub(r'\s{2,}', ' ', s).strip()
    for fmt in _formats_for_order(date_order or _DATE_ORDER):
        try:
            d = datetime.strptime(s, fmt)
        except ValueError:
            continue
        # Year floor (Oracle 2026-08-05, Slice B companion): %Y happily parses a
        # 3-digit year ('03-06-202' → year 202) — always a right-clipped 4-digit
        # year from a cut crop, never a real office document. Without the floor,
        # normalise/salvage expand the fragment into a confidently-wrong full date.
        # 2-digit years are untouched (%y maps to 1969-2068, always >= 1000).
        if d.year < 1000:
            continue
        return d
    return None

def normalise_date(raw: str | None) -> str | None:
    """Normalise any recognised date string to DD-MM-YYYY."""
    d = parse_date(raw)
    return d.strftime("%d-%m-%Y") if d else raw


# ── Salvaging a date embedded in noisy OCR text ───────────────────────────────
# parse_date() above only succeeds on a string that is a date START-to-END. But
# cropped/anchor OCR sometimes drops a real date inside surrounding junk that
# rides along on the SAME alphanumeric run (so the char-class strip in
# _sanitise_date_junk can't remove it), e.g. "2_ 2/4/26bf" or "Inv01-May-2024x".
# salvage_date() finds the date inside that junk. It is deliberately
# conservative: the regexes only LOCATE date-shaped candidates (a run carrying
# real date separators or a month name — never a bare run of digits), and
# parse_date() is the sole gatekeeper that decides whether a candidate is a real
# calendar date. Arbitrary text and plain numbers are therefore never coerced.

# Allow OCR whitespace around the separators ("16 / 03 / 2026") — the candidate
# is space-normalised before parse_date (see salvage_date) so it still parses.
_NUMERIC_DATE_RE = re.compile(r'\d{1,4}\s*[/.\-]\s*\d{1,2}\s*[/.\-]\s*\d{1,4}')

_MONTH_NAME = (r'(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|'
               r'Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|'
               r'Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)')
_ORD = r'(?:st|nd|rd|th)?'   # optional ordinal suffix on the day ("6th")
_MONTH_NAME_DATE_RE = re.compile(
    r'\d{1,2}' + _ORD + r'\s*[-/ ]\s*' + _MONTH_NAME + r'\s*[-/ ,]?\s*\d{2,4}'  # 6th May 2024 / 1-May-24
    r'|' + _MONTH_NAME + r'\s+\d{1,2}' + _ORD + r',?\s+\d{2,4}',                # May 6th, 2024
    re.IGNORECASE,
)


# ── OCR date pre-clean (space/split tolerance) ────────────────────────────────
# Rejoin a number an OCR word-break SPLIT ("1 5" -> "15", "2 0 2 6" -> "2026") WITHOUT
# touching a digit/letter boundary ("15 Jun" stays), then collapse whitespace around the
# date separators ("16 / 03 / 2026" -> "16/03/2026"). The zero-width lookaround is REQUIRED:
# a capturing replace r'(\d)\s+(\d)' consumes the trailing digit and misses the next split
# space in a 3+-digit run ("2 0 2 6" -> "20 26"). Deletes whitespace only — never reorders or
# inserts a digit, so it cannot fabricate a date (parse_date/strptime stays the sole gate).
#
# SAFETY (Oracle 2026-07-16): fed in front of the SALVAGE locator ONLY — never parse_date, the
# Stage-2 anchor read, or the engine merge. So a recovered split date stays at the salvage tier
# (_CLEAN_SALVAGE_CONF 80, review-held, < the 88 critical-field floor) and can NEVER auto-file;
# and the spaced anchor read keeps its (depressed) confidence and still loses to a clean keyword
# read. Moving this into parse_date would let a spaced date parse at _CLEAN_DATE_CONF 94 (>=88)
# and become auto-file-eligible — do NOT. JS twin: _datePreclean in src/windows/review/renderer.js
# and src/modules/filing/handler.js (keep the three aligned — see test_date_salvage.py twin pin).
_DIGIT_SPLIT_RE = re.compile(r'(?<=\d)\s+(?=\d)')
_DATE_SEP_WS_RE = re.compile(r'\s*([/.\-])\s*')
# A month NAME means a space can legitimately separate a day from a year ("Aug 3 2024"), where the
# digit-join would wrongly FUSE "3 2024" -> "32024". Numeric dates (digits + / - . separators) never
# contain a month token, so a digit-space-digit there is always an OCR split. Gate the join on the
# ABSENCE of a month name — so "1 5/06/2026" rejoins but "Aug 3 2024" / "15 Jun 2026" are untouched.
_MONTH_TOKEN_RE = re.compile(r'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec', re.IGNORECASE)


def _date_preclean(text: str) -> str:
    s = str(text)
    if not _MONTH_TOKEN_RE.search(s):
        s = _DIGIT_SPLIT_RE.sub('', s)              # numeric-only: "1 5/06/2026" -> "15/06/2026"
    s = _DATE_SEP_WS_RE.sub(r'\1', s)               # "16 / 03 / 2026" -> "16/03/2026"
    s = re.sub(r'\s{2,}', ' ', s)
    return s.strip()


def _best_date_candidate(candidates: list[datetime]) -> datetime:
    """Pick the most plausible date among confirmed candidates.

    Prefers dates inside the same ±10-year window the sanity check trusts;
    among those, the one closest to today. Falls back to all candidates when
    none are in-window, so a real-but-unusual date is still salvaged rather
    than dropped. Deterministic for a given input."""
    now        = datetime.now()
    reasonable = [d for d in candidates if abs((now - d).days) / 365 <= 10]
    pool       = reasonable or candidates
    return min(pool, key=lambda d: abs((now - d).days))


def salvage_date_detail(raw: str | None) -> "tuple[datetime | None, int]":
    """Return (best date found embedded in noisy text, number of DISTINCT dates).

    Locates date-shaped substrings (numeric first, then month-name), confirms each
    with parse_date(), and returns the best-supported one plus how many distinct
    calendar dates the text contained. The COUNT is the trust signal: salvage only
    trims surrounding junk and collapses whitespace around separators — it NEVER
    changes a digit (a glyph misread like "202G" is not located at all). So a count
    of 1 means the recovered date is the ONLY date-shaped run present — a verbatim
    capture that already lived in the string. A count >1 means salvage had to CHOOSE
    among several dates (a judgement worth a human's confirmation). (0, None) when no
    candidate is a real date — callers fall back to their existing handling."""
    if not raw:
        return None, 0
    s = _date_preclean(str(raw))   # rejoin an OCR-split number ("1 5" -> "15") BEFORE locating (salvage tier only)
    candidates: list[datetime] = []
    for rx in (_NUMERIC_DATE_RE, _MONTH_NAME_DATE_RE):
        for m in rx.finditer(s):
            # Collapse OCR whitespace sitting around the separators so a noisy
            # crop like "16 / 03 / 2026" still parses as a real date.
            cand = re.sub(r'\s*([/.\-])\s*', r'\1', m.group(0)).strip()
            d = parse_date(cand)
            if d:
                candidates.append(d)
    if not candidates:
        return None, 0
    distinct = len({d.date() for d in candidates})
    return _best_date_candidate(candidates), distinct


def salvage_date(raw: str | None) -> datetime | None:
    """Return a real date found embedded inside noisy text, or None. Thin wrapper
    over salvage_date_detail() (kept for the existing engine/template_mapper callers)."""
    return salvage_date_detail(raw)[0]


# Confidence for a CLEAN salvage (a single, unambiguous, verbatim date recovered
# from surrounding junk). Above the default review threshold (70) so an otherwise-
# correct date isn't sent to review just because crop junk rode along with it.
_CLEAN_SALVAGE_CONF = 80

# Confidence floor for a date that parses start-to-end (a real, well-formed calendar
# date). Such a date is reliable regardless of the extraction stage's confidence —
# which for a freshly-learned anchor is often low (usage-based) — so normalising its
# separator format (29/05/2026 → 29-05-2026, cosmetic, NOT a correction) must not
# leave a correctly-read date flagged for review. Set to "High" but below the 95 cap
# clean keyword reads get, so the ecosystem stays consistent. (Residual risk: an
# anchor that drifted to a DIFFERENT but valid date — rare for distinctive date text.)
_CLEAN_DATE_CONF = 94


# ── Field-specific OCR-noise sanitisation ─────────────────────────────────────
# Targeted, schema-driven cleanup for the two failure shapes most often seen
# in cropped/anchor OCR output: stray bracket/hash noise riding alongside a
# date ("(01-12-2012", "#Dec 01 2012") or a reference number ("(12345",
# ")12345"). Deliberately NOT a global strip-all-punctuation pass — that would
# just as readily mangle "Smith & Sons (UK) Ltd." or "AB-12345". Each rule is
# scoped by the field's own schema (`type == "date"`, or the `..._number` key
# convention every built-in and learned reference field already follows), so
# it generalises to any future supplier, layout or custom field of the same
# shape rather than special-casing the one in front of us.

# A date can only legitimately contain digits, letters (month/day names),
# whitespace and the separators DATE_FORMATS knows how to parse. Anything
# else here rode in from neighbouring text during crop+OCR.
_DATE_JUNK_RE = re.compile(r"[^0-9A-Za-z\s\-/.,]")

def _sanitise_date_junk(raw: str) -> str:
    """Strip characters that cannot legitimately appear in a date, leaving
    the existing parse_date()/normalise_date() pipeline a clean string to
    interpret exactly as before."""
    return _DATE_JUNK_RE.sub("", raw).strip()


# Edge noise on a reference number: stray marks like '(', ')', '#', '|' that
# the crop boundary swept in alongside the real value. Only the leading run
# before the first letter/digit and the trailing run after the last
# letter/digit are removed — the interior, where genuine structure lives
# ("AB-12345", "INV12345"), is left exactly as captured.
_EDGE_NOISE_RE = re.compile(r"^[^0-9A-Za-z]+|[^0-9A-Za-z]+$")

def _sanitise_reference_edges(raw: str) -> str:
    """Trim non-alphanumeric noise from the edges of a reference/number
    value only — never touches internal separators or letter prefixes."""
    return _EDGE_NOISE_RE.sub("", raw)


def _is_reference_number_field(key: str) -> bool:
    """Reference/number fields follow one consistent `..._number` naming
    convention across every built-in document type (invoice_number,
    po_number, sales_order_number) and any custom field added the same
    way — keying off that convention covers unseen types without
    hardcoding a single field name."""
    return key.endswith("_number")


# ── Currency parsing ──────────────────────────────────────────────────────────

CURRENCY_RE = re.compile(
    r'[£$€¥]?\s*([\d,]+\.?\d*)\s*(?:GBP|USD|EUR|JPY)?', re.IGNORECASE
)

def parse_amount(raw: str | None) -> float | None:
    if not raw:
        return None
    m = CURRENCY_RE.search(str(raw))
    if not m:
        return None
    try:
        return float(m.group(1).replace(",", ""))
    except ValueError:
        return None


# ── Total reconciliation (shared: the Stage-4 flag AND the engine's reconciliation-aware pick) ──

def _reconcile_components(results: dict) -> dict:
    """Resolve the money ROLES (subtotal/vat_tax/shipping/discount) from `results` as parsed
    amounts — the canonical key first, then any ROLE_KEY_ALIASES-keyed field carrying a value, so
    the maths works whatever the doc type named them ("Postage" as shipping, "GST" as tax)."""
    from extraction.keyword import ROLE_KEY_ALIASES
    def role(r):
        d = results.get(r)
        if isinstance(d, dict) and d.get("value"):
            return d
        for k, data in results.items():
            if k in ROLE_KEY_ALIASES.get(r, ()) and isinstance(data, dict) and data.get("value"):
                return data
        return {}
    return {
        'subtotal': parse_amount(role('subtotal').get('value')),
        'tax':      parse_amount(role('vat_tax').get('value')),
        'shipping': parse_amount(role('shipping').get('value')),
        'discount': parse_amount(role('discount').get('value')),
    }


def total_reconciles(total_value, results: dict):
    """True when `total_value` BALANCES against the components in `results` — subtotal + tax +
    shipping - discount, with shipping/discount tried IN and OUT of the subtotal (a delivery/
    discount line may already sit inside it). None when there is no subtotal to check against
    (unknown, NOT 'reconciles'). Shared by the Stage-4 flag and the engine's reconciliation-aware
    total pick (prefer the total CANDIDATE that balances over a drifted mapping / wrong-row read)."""
    total = parse_amount(total_value)
    comp = _reconcile_components(results)
    subtotal = comp['subtotal']
    if not (total and total > 0 and subtotal and subtotal > 0):
        return None
    tol = max(total * 0.02, 0.05)
    _tax = comp['tax'] or 0
    return any(abs(total - (subtotal + _tax + s * (comp['shipping'] or 0) - d * (comp['discount'] or 0))) <= tol
               for s in (0, 1) for d in (0, 1))


# ── Main validation ───────────────────────────────────────────────────────────

def validate_and_adjust(extractions: dict,
                        field_defs:  list[dict],
                        trace = None) -> dict:
    """
    Cross-validate extracted fields and adjust confidence scores.
    Returns the same dict with confidence scores modified.

    `trace` (optional): a dev-only event callback (engine._t). When supplied, the TOTAL
    reconciliation emits a `reconcile` event with the exact maths it used — each money
    component (with MISSING flagged), the computed sum, the delta vs the total, the
    tolerance, and the verdict — so SFDEV can show WHY a correct-looking total was flagged.
    """
    # Normalise all values to {"value": ..., "confidence": ...} dicts
    # Skip internal metadata keys (prefixed with _)
    results = {}
    for key, data in extractions.items():
        if key.startswith('_'):
            results[key] = data  # pass through metadata unchanged
            continue
        if isinstance(data, dict):
            results[key] = data
        elif data is not None:
            results[key] = {"value": str(data), "confidence": 50, "method": "unknown"}
        else:
            results[key] = {"value": None, "confidence": 0, "method": "unknown"}

    # 0. Reject values that are clearly mis-captured LABELS, not values.
    # A trailing ':' usually means an anchor/crop landed on the field's LABEL
    # rather than its value — e.g. an anchor_crop returning "Total:" for
    # invoice_number at 85% confidence (observed in processing.log).
    # BUT a genuine value can pick up a STRAY trailing colon when the crop bleeds
    # into a neighbouring label ("12/01/2026 :", "2601-0371-1 :") — that is crop
    # noise, not a mis-captured label, and flagging it forces a needless review.
    # So distinguish the two by what remains once the trailing colon is trimmed:
    #   • a DATE field whose trimmed value still PARSES as a date, or
    #   • any other field whose trimmed value still carries a DIGIT
    # is a real value with a stray colon → trim it and move on. A bare word label
    # ("Total", "Ticket No.") has no digit and no date → still flagged. Layout-
    # and supplier-agnostic; only narrows a known false-positive class.
    _field_types = {f.get("key"): (f.get("type") or "") for f in field_defs}

    # Money fields store JUST THE NUMBER: region-normalise to canonical 1234.56 (a no-op for
    # anglo/indian) THEN strip the currency symbol/code, so a detected "$12,268.80" / "GBP
    # 118.83" / "€1.234,56" is stored as the bare amount ("12,268.80" / "118.83" / "1234.56").
    # The currency is deliberately NOT baked into the value (money = numbers only).
    for key, data in results.items():
        if key.startswith('_') or not isinstance(data, dict):
            continue
        if _field_types.get(key) in ("currency", "number") and isinstance(data.get("value"), str):
            _new = number_format.strip_currency(number_format.canonical(data["value"]))
            if _new != data.get("value"):
                data["value"] = _new
                if data.get("display_value") is not None:
                    data["display_value"] = _new

    for key, data in results.items():
        if key.startswith('_') or not isinstance(data, dict):
            continue
        val = data.get("value")
        if not (isinstance(val, str) and val.strip().endswith(':')):
            continue
        trimmed = val.strip().rstrip(':').strip()
        # A bare mis-captured LABEL ("Date:", "Estimated depletion:", "Total:") has NO digit.
        # A real value — including a textual date parse_date can't parse ("September 1, 2026:")
        # or a partial date — always carries a digit, so a DATE field accepts either a parseable
        # date OR any digit-bearing trimmed value (was parse_date-only, which false-flagged a
        # valid textual date as "looks like a label"). Non-date fields already use the digit test.
        is_real_value = (parse_date(trimmed) is not None
                         or any(ch.isdigit() for ch in trimmed)) \
            if _field_types.get(key) == "date" \
            else any(ch.isdigit() for ch in trimmed)
        if is_real_value:
            # Real value with a crop-bled trailing colon → clean it, don't flag.
            results[key] = {**data, "value": trimmed}
        else:
            results[key] = {
                **data,
                "confidence": min(data.get("confidence", 0), 35),
                "validation_note": "value looks like a label, not a field value",
            }

    # 0b. Field-specific OCR-noise cleanup (dates & reference numbers).
    # Runs after the label-shape guard (so a genuinely mis-captured label is
    # flagged on its original shape, not silently reshaped into something
    # that no longer looks like one) and before date parsing (so the parser
    # gets a clean string). Skips anything the guard above already flagged —
    # an already-suspect value is left exactly as captured for the user to
    # inspect, per its "not silently discarded" contract.
    for f in field_defs:
        key  = f["key"]
        data = results.get(key)
        if not isinstance(data, dict) or data.get("validation_note"):
            continue
        val = data.get("value")
        if not isinstance(val, str) or not val:
            continue

        if f.get("type") == "date":
            cleaned = _sanitise_date_junk(val)
        elif _is_reference_number_field(key):
            cleaned = _sanitise_reference_edges(val)
        else:
            continue

        if cleaned and cleaned != val:
            results[key] = {**data, "value": cleaned}

    # 1. Validate date fields
    for f in field_defs:
        if f.get("type") != "date":
            continue
        key  = f["key"]
        data = results.get(key)
        if not data or not data.get("value"):
            continue

        d = parse_date(data["value"])
        if d is not None:
            # Clean date — normalise to DD-MM-YYYY. The value was already a valid,
            # well-formed date; reformatting the separator is cosmetic, not a fix, so
            # floor the confidence to "High" rather than letting a correctly-read date
            # stay below the review threshold on a low (e.g. usage-based) anchor score.
            results[key] = {**data, "value": d.strftime("%d-%m-%Y"),
                            "confidence": max(data.get("confidence", 0), _CLEAN_DATE_CONF)}
            continue

        # Doesn't parse start-to-end. Before giving up, try to salvage a real date
        # embedded in OCR junk (e.g. "2_ 2/4/26bf" → 02-04-2026). salvage only TRIMS
        # surrounding junk and collapses spacing around separators — it never changes
        # a digit (a glyph misread like "202G" is not salvaged; it falls through to
        # the branch below and stays in review). So the recovery is only "guessed"
        # when SEVERAL date-shaped runs are present and salvage had to choose one.
        salvaged, n_dates = salvage_date_detail(data["value"])
        if salvaged is not None and n_dates == 1:
            # The date was the ONLY one in the text — a verbatim capture that already
            # lived in the string, just surrounded by junk/odd spacing. Trust it: no
            # character was guessed, so don't force review for the noise.
            results[key] = {
                **data,
                "value":      salvaged.strftime("%d-%m-%Y"),
                "confidence": max(data.get("confidence", 0), _CLEAN_SALVAGE_CONF),
            }
        elif salvaged is not None:
            # Multiple dates present — salvage chose one. Keep the review so a human
            # confirms it picked the field's actual date.
            results[key] = {
                **data,
                "value":           salvaged.strftime("%d-%m-%Y"),
                "confidence":      min(data["confidence"], 45),
                "validation_note": "date recovered from noisy text — please verify",
            }
        else:
            # Couldn't parse or salvage. Distinguish two cases instead of always
            # blanking (which wiped a taught date that merely OCR'd noisily and
            # made the field look like it stopped working):
            #  • the value carries date-like content (any digit, or a month name)
            #    but noise stopped it parsing — KEEP it (flagged) so the user sees
            #    a value to verify/fix rather than an empty field;
            #  • a value with NO date content at all ("Colour Issues") is genuinely
            #    not a date — WITHHOLD it.
            raw = str(data["value"])
            looks_date_like = any(c.isdigit() for c in raw) or \
                              re.search(_MONTH_NAME, raw, re.IGNORECASE)
            if looks_date_like:
                results[key] = {**data,
                                "confidence":      min(data["confidence"], 30),
                                "validation_note": "date couldn't be read cleanly — please verify"}
            else:
                results[key] = {**data, "value": None, "confidence": 0,
                                "validation_note": "not a valid date — please enter manually"}

    # 2. TOTAL RECONCILIATION (Stage 3) — the reliable disambiguator between the real
    # total and a positional misread of a neighbouring currency (subtotal/shipping/a
    # stale total position). A total can't be trusted by FORMAT alone (every row in a
    # totals block is valid currency) or by POSITION (the total row moves down as line
    # items grow). So cross-check it against the subtotal + whatever components exist:
    #   CLOSE      — total ≈ subtotal + tax + shipping − discount → trust (leave as-is),
    #                even on a mediocre scan (maths beats OCR confidence).
    #   CONTRADICT — flag + cap confidence + note → needs_review (a low confidence on a
    #                required field forces review via overall_confidence/needs_review):
    #                  · total < subtotal (and no discount to explain it) — a smaller line
    #                    was read as the total;
    #                  · tax present but total ≈ subtotal — the SUBTOTAL row was grabbed;
    #                  · components present but nothing reconciles — maths doesn't add up;
    #                  · total ≫ subtotal (>2.5×) with no tax/shipping captured to explain
    #                    it — a wrong-cell read (the "$3,446.16 on a $105.96 invoice" shape).
    #   NEUTRAL    — only the subtotal is known and total ≥ subtotal by a plausible margin
    #                (uncaptured shipping/tax) — precision-first, no penalty.
    # Keys off whatever component fields the type actually defines (shipping/discount are
    # optional and absent by default) — reggie-designed, reusable across invoice layouts.
    _RECONCILE_CAP = 50   # low enough to force review on a required total field
    # Resolve each money ROLE to whatever key the doc type actually used (canonical key first,
    # then any alias-keyed field that carries a value) so the maths reconciles regardless of
    # naming — "Postage"/"Carriage" as shipping, "VAT"/"GST" as tax, "Balance Due" as total.
    # Shares keyword.ROLE_KEY_ALIASES (single source with the extractor).
    from extraction.keyword import ROLE_KEY_ALIASES
    def _role_field(role):
        d = results.get(role)
        if isinstance(d, dict) and d.get("value"):
            return role, d
        for k, data in results.items():
            if k in ROLE_KEY_ALIASES.get(role, ()) and isinstance(data, dict) and data.get("value"):
                return k, data
        return role, {}
    total_key, total_data = _role_field("total_amount")
    total      = parse_amount(total_data.get("value"))
    subtotal   = parse_amount(_role_field("subtotal")[1].get("value"))
    tax        = parse_amount(_role_field("vat_tax")[1].get("value"))
    shipping   = parse_amount(_role_field("shipping")[1].get("value"))
    discount   = parse_amount(_role_field("discount")[1].get("value"))

    if total and total > 0 and subtotal and subtotal > 0 and total_data.get("value"):
        tol        = max(total * 0.02, 0.05)   # 2% or 5 cents, absorbs rounding/OCR
        # Shipping/discount may be SEPARATE additions OR line items ALREADY inside the subtotal —
        # total_reconciles tries both compositions (shared with the engine's reconciliation-aware
        # total pick so the "does it balance?" rule is defined in exactly one place).
        reconciles = bool(total_reconciles(total_data.get("value"), results))
        note = None
        if reconciles:
            pass                                                   # CLOSE → trust
        elif total < subtotal - tol and discount is None:
            note = "the total is less than the subtotal — please check"
        elif tax and abs(total - subtotal) <= tol:
            note = "the total looks like the subtotal (tax not included) — please check"
        elif (tax is not None or shipping is not None):
            note = "the total doesn't add up against the line amounts — please check"
        elif total > subtotal * 2.5:
            note = "the total is much larger than the subtotal — please check"
        # else: only the subtotal is known and total is a plausible subtotal+shipping — neutral.
        # Dev trace (SFDEV): show the exact reconciliation maths — what value each money role
        # resolved to (MISSING when a component wasn't captured, the usual reason a correct-looking
        # total is flagged, e.g. an un-captured "Discount (10%)"), the primary composition sum, the
        # delta vs the total, the tolerance, and the verdict. total_reconciles ALSO tries shipping/
        # discount folded INTO the subtotal, so `reconciles` can be True even when this primary
        # composition's delta exceeds tol — the flag chain above is the authority.
        if trace:
            _fmt = lambda v: 'MISSING' if v is None else round(v, 2)
            _computed = round((subtotal or 0) + (tax or 0) + (shipping or 0) - (discount or 0), 2)
            trace('reconcile',
                  total_key=total_key, total=round(total, 2), subtotal=round(subtotal, 2),
                  tax=_fmt(tax), shipping=_fmt(shipping), discount=_fmt(discount),
                  formula='subtotal + tax + shipping - discount',
                  computed=_computed, delta=round(abs(total - _computed), 2), tol=round(tol, 2),
                  reconciles=reconciles, verdict=(note or 'OK — reconciles / plausible'))
        if note:
            results[total_key] = {
                **total_data,
                "confidence":      min(total_data.get("confidence", 0), _RECONCILE_CAP),
                "validation_note": note,
            }

    # 3. Sanity check — a document date should not be in the future. Old dates
    # are expected (this system files historical paperwork) and are NEVER flagged
    # on age. Only a date clearly beyond today (past the future tolerance) is
    # treated as anomalous; this is generic across every date field.
    now = datetime.now()
    for f in field_defs:
        if f.get("type") != "date":
            continue
        key  = f["key"]
        data = results.get(key)
        if not data or not data.get("value"):
            continue
        d = parse_date(data["value"])
        if d and (d - now).days > _FUTURE_DATE_TOLERANCE_DAYS:
            results[key] = {
                **data,
                "confidence": min(data["confidence"], 40),
                "validation_note": "date is in the future",
            }

    # 4. Currency symbol → currency code inference
    for f in field_defs:
        if f.get("key") != "currency":
            continue
        if results.get("currency", {}).get("value"):
            continue  # already have it
        # Try to infer from total_amount or subtotal
        symbols = {"£": "GBP", "$": "USD", "€": "EUR", "¥": "JPY"}
        for amount_key in ("total_amount", "subtotal"):
            val = results.get(amount_key, {}).get("value", "")
            for sym, code in symbols.items():
                if sym in str(val):
                    results["currency"] = {
                        "value": code, "confidence": 80,
                        "method": "inferred_from_symbol"
                    }
                    break
            if results.get("currency", {}).get("value"):
                break

    return results


def overall_confidence(extractions: dict,
                       field_defs: list[dict] | None = None,
                       key_fields: list[str] | None = None,
                       exclude_keys: set | None = None) -> int:
    """
    Calculate weighted average confidence across the fields that matter most
    for this document type. "What matters" comes from the type's own schema
    (required fields) — not a hardcoded list of field-key names that only
    covers the three built-in document types and silently ignores any custom
    type's fields entirely.

    exclude_keys (HIDDEN_FIELD_SCORING, Oracle-signed 2026-07-27): operator-declared
    "this layout lacks this field" keys (template_hidden_fields, resolved per
    (supplier, type) by template_matcher.hidden_fields_for_scope). EMPTY-ONLY
    exclusion: an excluded key suppresses ONLY the expected-but-missing 0 below —
    a VALUED excluded field still counts exactly as today (its drag is what keeps a
    ghost read out of the gate-free at-100 auto-file arm; do NOT widen this to
    filtering key_fields). None ⇒ byte-identical.
    """
    # When the key fields come from the type's SCHEMA, an expected field that is EMPTY is
    # a real failure to extract — it must count as 0, not be skipped. Otherwise a doc with
    # one good field and several empty required fields scores on the single field and reads
    # as high/green (the "72% with two empty fields" bug). Only the hard-coded fallback (no
    # schema) keeps the old present-only average, since those keys may not exist for a type.
    from_schema = False
    if key_fields is None and field_defs:
        key_fields = [f["key"] for f in field_defs if f.get("required")] \
                     or [f["key"] for f in field_defs]
        from_schema = True
    if key_fields is None:
        key_fields = [
            "invoice_number", "invoice_date", "total_amount", "supplier_name",
            "sales_order_number", "order_date", "po_number", "po_date",
        ]
    scores = []
    for k in key_fields:
        data = extractions.get(k)
        if isinstance(data, dict) and data.get("value"):
            scores.append(data.get("confidence", 0))
        elif from_schema:
            if exclude_keys and k in exclude_keys:
                continue       # operator declared this layout lacks the field — not an expected miss
            scores.append(0)   # an expected (required/schema) field with no value → 0
    return int(sum(scores) / len(scores)) if scores else 0


# ── Document-level format-consistency weighting ───────────────────────────────
# Rolls the per-field format signals the earlier stages already produced up into
# ONE document-level confidence adjustment. Re-uses, rather than recomputes,
# those signals: a field carrying a validation_note (from Stage 4 validation or
# the Stage 4.5 format-anomaly check) is a format MISMATCH; a clean field whose
# key has a learned format for this supplier/type (strong historical support) is
# a SUPPORTED MATCH. The rule is deterministic and explainable: penalise any
# mismatch, and reward a document only when SEVERAL well-supported fields all
# match — so a single field, a sparse document, or one with no historical
# evidence is never over-rewarded.

_FC_MISMATCH_BASE   = 12   # penalty for the first mismatched field
_FC_MISMATCH_STEP   = 6    # extra penalty per additional mismatched field
_FC_MISMATCH_CAP    = 25   # most we ever subtract
_FC_BOOST_PER_FIELD = 3    # boost per well-supported matching field
_FC_BOOST_CAP       = 10   # most we ever add (kept below the penalty range)
_FC_MIN_FIELDS      = 3    # need at least this many valued fields before any boost
_FC_MIN_SUPPORTED   = 2    # need at least this many SUPPORTED matches before any boost


def format_consistency_adjustment(field_signals: list[dict]) -> int:
    """Document-level confidence delta from per-field format consistency.

    `field_signals` — one dict per KEY field that has a value:
        {'mismatch': bool, 'supported': bool}

    Returns an int delta (negative = penalty, positive = boost):
      * Any mismatch → a penalty that grows with the number of mismatched fields
        (capped). A single bad field always lowers the document score.
      * No mismatches → a boost ONLY when there are at least _FC_MIN_FIELDS valued
        fields and at least _FC_MIN_SUPPORTED supported matches; it scales with
        the supported matches and is capped below the penalty range. A sparse or
        unverified-but-clean document gets 0 — never an inflated score.
    """
    present = len(field_signals)
    if present == 0:
        return 0
    mismatched = sum(1 for s in field_signals if s.get('mismatch'))
    if mismatched:
        return -min(_FC_MISMATCH_CAP,
                    _FC_MISMATCH_BASE + _FC_MISMATCH_STEP * (mismatched - 1))
    supported_matches = sum(1 for s in field_signals if s.get('supported'))
    if present >= _FC_MIN_FIELDS and supported_matches >= _FC_MIN_SUPPORTED:
        return min(_FC_BOOST_CAP, _FC_BOOST_PER_FIELD * supported_matches)
    return 0


def format_consistency_delta(extractions: dict,
                             field_defs: list[dict] | None,
                             supported_keys: set | None = None) -> int:
    """Build per-field signals from validated results and return the document
    delta (see format_consistency_adjustment).

    A field is a MISMATCH when it has a value AND a validation_note; SUPPORTED
    when its key is in `supported_keys` (the fields that have a learned format
    for this document's supplier/type). Judges the SAME key fields as
    overall_confidence so the weighting is about the fields the score is built
    from.
    """
    if not field_defs:
        return 0
    key_fields = [f["key"] for f in field_defs if f.get("required")] \
                 or [f["key"] for f in field_defs]
    supported_keys = supported_keys or set()
    signals = []
    for k in key_fields:
        data = extractions.get(k)
        if isinstance(data, dict) and data.get("value"):
            signals.append({
                "mismatch":  bool(data.get("validation_note")),
                "supported": k in supported_keys,
            })
    return format_consistency_adjustment(signals)


def needs_review(extractions: dict, field_defs: list[dict]) -> bool:
    """True if any field needs a human check: a REQUIRED field that is missing/empty, OR any
    present field below its confidence threshold.

    A missing required field (e.g. the Document Issuer that logo/keyword extraction couldn't
    find on a fresh install) used to be SKIPPED here — so a doc with a blank company read as
    "ready to file" and would file under "Unknown Company". A required field the app couldn't
    fill is exactly what a human must supply, so it now flags for review.
    """
    for f in field_defs:
        key       = f["key"]
        threshold = f.get("confidence_threshold", 70)
        data      = extractions.get(key)
        if f.get("required"):
            val = data.get("value") if isinstance(data, dict) else data
            if val is None or str(val).strip() == "":
                return True
        if not isinstance(data, dict):
            continue
        if data.get("confidence", 0) < threshold:
            return True
    return False
