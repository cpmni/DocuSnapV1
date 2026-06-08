"""
extraction/validator.py
-----------------------
Stage 4 — cross-field validation and confidence adjustment.
Catches obvious errors before they reach the review queue.
"""

import re
from datetime import datetime


# ── Date parsing ──────────────────────────────────────────────────────────────

# Strip leading day names before parsing: "Monday, 01 May 2024" → "01 May 2024"
_DAY_NAME_RE = re.compile(
    r'^(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|'
    r'Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\s*,?\s*',
    re.IGNORECASE,
)
# Strip ordinal suffixes: "1st" → "1", "22nd" → "22", "3rd" → "3"
_ORDINAL_RE = re.compile(r'\b(\d{1,2})(st|nd|rd|th)\b', re.IGNORECASE)

DATE_FORMATS = [
    # Fully numeric — DD-first (UK/EU)
    "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y",
    "%d/%m/%y", "%d-%m-%y", "%d.%m.%y",
    # Fully numeric — YYYY-first (ISO)
    "%Y-%m-%d", "%Y/%m/%d",
    # Day + full month name
    "%d %B %Y", "%d %b %Y",       # 01 May 2024 / 01 May 24
    "%d %B %y", "%d %b %y",
    "%d %B, %Y", "%d %b, %Y",     # 01 May, 2024
    "%d-%B-%Y", "%d-%b-%Y",       # 01-May-2024
    "%d/%B/%Y", "%d/%b/%Y",       # 01/May/2024
    # Month name + day (US-ish)
    "%B %d, %Y", "%b %d, %Y",     # May 01, 2024
    "%B %d %Y", "%b %d %Y",       # May 01 2024 (no comma)
    "%B-%d-%Y", "%b-%d-%Y",       # May-01-2024
    # US numeric — lowest priority (ambiguous with DD/MM)
    "%m/%d/%Y", "%m-%d-%Y",
]

def parse_date(raw: str | None) -> datetime | None:
    if not raw:
        return None
    s = str(raw).strip()
    # Remove leading day name and optional comma/space
    s = _DAY_NAME_RE.sub('', s).strip().lstrip(',').strip()
    # Remove ordinal suffixes from day numbers
    s = _ORDINAL_RE.sub(r'\1', s)
    # Collapse runs of whitespace that ordinal removal may have created
    s = re.sub(r'\s{2,}', ' ', s).strip()
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            pass
    return None

def normalise_date(raw: str | None) -> str | None:
    """Normalise any recognised date string to DD-MM-YYYY."""
    d = parse_date(raw)
    return d.strftime("%d-%m-%Y") if d else raw


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

    # 0. Reject values that are clearly mis-captured labels, not values.
    # A label-shaped string (ends with ':') is the universal signal that an
    # anchor/crop landed on the field's LABEL rather than its value — e.g. an
    # anchor_crop returning "Total:" for invoice_number at 85% confidence
    # (observed in processing.log — high enough to skip review entirely).
    # No legitimate value for any field type (reference number, date, amount,
    # name) naturally ends with a bare colon, so this is a safe, layout- and
    # supplier-agnostic guard against that failure class, not a one-off patch.
    for key, data in results.items():
        if key.startswith('_') or not isinstance(data, dict):
            continue
        val = data.get("value")
        if isinstance(val, str) and val.strip().endswith(':'):
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
        if d is None:
            # Doesn't look like a valid date — reduce confidence
            results[key] = {**data, "confidence": min(data["confidence"], 30),
                            "validation_note": "invalid date format"}
        else:
            # Normalise to consistent format
            results[key] = {**data, "value": d.strftime("%d-%m-%Y")}

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

    # 3. Sanity check — dates should be reasonable (not in far future/past)
    now = datetime.now()
    for f in field_defs:
        if f.get("type") != "date":
            continue
        key  = f["key"]
        data = results.get(key)
        if not data or not data.get("value"):
            continue
        d = parse_date(data["value"])
        if d:
            age_years = abs((now - d).days / 365)
            if age_years > 10:
                results[key] = {
                    **data,
                    "confidence": min(data["confidence"], 40),
                    "validation_note": "date seems too old or in the future",
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
    if key_fields is None and field_defs:
        key_fields = [f["key"] for f in field_defs if f.get("required")] \
                     or [f["key"] for f in field_defs]
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
    return int(sum(scores) / len(scores)) if scores else 0


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
