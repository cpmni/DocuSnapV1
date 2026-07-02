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
            return datetime.strptime(s, fmt)
        except ValueError:
            pass
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
    s = str(raw)
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


# ── Main validation ───────────────────────────────────────────────────────────

def validate_and_adjust(extractions: dict,
                        field_defs:  list[dict]) -> dict:
    """
    Cross-validate extracted fields and adjust confidence scores.
    Returns the same dict with confidence scores modified.
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

    # Region-normalise every currency/number value to canonical 1234.56 (a no-op for anglo/
    # indian → byte-identical), so whatever path read it (keyword/anchor/mapping) the STORED
    # amount is one well-defined shape for filing, search and the maths cross-check below.
    for key, data in results.items():
        if key.startswith('_') or not isinstance(data, dict):
            continue
        if _field_types.get(key) in ("currency", "number") and isinstance(data.get("value"), str):
            _canon = number_format.canonical(data["value"])
            if _canon != data.get("value"):
                data["value"] = _canon
                if data.get("display_value") is not None:
                    data["display_value"] = _canon

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

    # 2. Validate currency fields and cross-check subtotal + VAT ≈ total
    subtotal = parse_amount(results.get("subtotal", {}).get("value"))
    vat      = parse_amount(results.get("vat_tax",  {}).get("value"))
    total    = parse_amount(results.get("total_amount", {}).get("value"))

    if subtotal and vat and total:
        expected = subtotal + vat
        diff     = abs(expected - total)
        tolerance = total * 0.02  # 2% tolerance for rounding

        if diff > tolerance:
            # Numbers don't add up — flag total and VAT
            for key in ("total_amount", "vat_tax"):
                if key in results and results[key].get("value"):
                    note = f"maths check failed: {subtotal}+{vat}≠{total}"
                    results[key] = {
                        **results[key],
                        "confidence": min(results[key]["confidence"], 50),
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
                       key_fields: list[str] | None = None) -> int:
    """
    Calculate weighted average confidence across the fields that matter most
    for this document type. "What matters" comes from the type's own schema
    (required fields) — not a hardcoded list of field-key names that only
    covers the three built-in document types and silently ignores any custom
    type's fields entirely.
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
    """True if any enabled field is below its confidence threshold."""
    for f in field_defs:
        key       = f["key"]
        threshold = f.get("confidence_threshold", 70)
        data      = extractions.get(key)
        if not isinstance(data, dict):
            continue
        if data.get("confidence", 0) < threshold:
            return True
    return False
