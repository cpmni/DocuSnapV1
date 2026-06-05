"""
extraction/validator.py
-----------------------
Stage 4 — cross-field validation and confidence adjustment.
Catches obvious errors before they reach the review queue.
"""

import re
from datetime import datetime


# ── Date parsing ──────────────────────────────────────────────────────────────

DATE_FORMATS = [
    "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y",
    "%Y-%m-%d", "%Y/%m/%d",
    "%d/%m/%y", "%d-%m-%y",
    "%d %B %Y", "%d %b %Y",
    "%B %d, %Y", "%b %d, %Y",
    "%m/%d/%Y",  # US format — lower priority
]

def parse_date(raw: str | None) -> datetime | None:
    if not raw:
        return None
    raw = str(raw).strip()
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            pass
    return None

def normalise_date(raw: str | None) -> str | None:
    """Normalise date to DD/MM/YYYY format."""
    d = parse_date(raw)
    return d.strftime("%d/%m/%Y") if d else raw


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
            results[key] = {**data, "value": d.strftime("%d/%m/%Y")}

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
                       key_fields: list[str] | None = None) -> int:
    """Calculate weighted average confidence across key fields."""
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
