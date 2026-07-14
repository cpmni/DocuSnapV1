"""
chrome_band.py — issuer-band chrome extraction (STDLIB-ONLY, no rapidfuzz).

The ISSUER letterhead sits at the top of a document, ABOVE the first recipient marker
("Bill To" / "Customer" / "FAO" …); everything from the marker down is the recipient (a
customer), never the issuer. `issuer_chrome` returns that top band so identity checks match
the ISSUER name and can't mistake the recipient/printer/line-item text for the sender.

Lifted verbatim out of identity_fusion.py (2026-07-14) so it can be used by the branding
cross-check WITHOUT importing identity_fusion — which top-imports rapidfuzz and is therefore
unreachable in packaged builds. identity_fusion re-exports these for backward-compat.
"""
import re

# A line that BEGINS a recipient / "addressed-to" block. When one appears in the top band the
# issuer letterhead is ABOVE it; everything from the marker down is the recipient (a customer),
# never the issuer. reggie-reviewed set (checked against the recipient vs issuer label vocab in
# config/keyword_patterns.json). It LEANS TO RECALL on markers: a MISSED marker leaks the
# recipient into the chrome (→ a misfile) while a FALSE marker only truncates early → the caller
# abstains (safe). `customer`/`client` carry a negative lookahead so an issuer's own "Customer
# Service"/"Client portal" contact strip doesn't fire; `[-\s]*` folds hyphen/OCR-join variants
# ("Sold-To"/"BillTo"); bare "to:" is line-anchored + colon-required.
_RECIPIENT_MARKER = re.compile(
    r"\b(?:bill(?:ed)?|invoiced?|sold|ship(?:ped)?|deliver(?:y|ed)?)[-\s]*to\b"
    r"|\bconsignee\b|\brecipient\b"
    r"|\bcustomer\b(?!\s*(?:service|care|support|enquir|inquir|relation|helpline|hotline|feedback|portal))"
    r"|\bclient\b(?!\s*(?:login|portal|area))"
    r"|\baccount[-\s]*(?:name|holder)\b"
    r"|\b(?:buyer|purchaser)\b|\b(?:purchased|ordered)[-\s]*by\b"
    r"|\bfor\s+the\s+attention\s+of\b|\bf\.?\s*a\.?\s*o\b\.?"
    r"|\battention\b|\battn\b"
    r"|^\s*to\s*:",
    re.IGNORECASE,
)


def issuer_chrome(ocr_text: str, max_lines: int = 6) -> str:
    """The ISSUER band for supplier identity: the top letterhead lines, TRUNCATED at the first
    recipient marker ("Bill To"/"Customer"/"FAO"/…), FOOTER excluded. Replaces a flat first-6/
    last-3-line chrome that let a NON-issuer name match (the recipient block, a printer footer, a
    line item) — the real-engine precision hole the shadow measurement surfaced (67% vs 100% on
    realistic docs). Literal (no letter-level fuzz): a marker mangled enough to slip past almost
    always sits above an equally-mangled name that then fails the caller's gate, so this truncation
    is defence-in-depth, not the sole guard. On a marker hit, any text BEFORE the marker on that
    same line is kept (salvages a two-column "Issuer …… Bill To:" letterhead). Empty band → "" →
    the caller abstains (the safe outcome)."""
    band = []
    lines = [l.strip() for l in (ocr_text or "").splitlines() if l.strip()]
    for ln in lines[:max_lines]:
        m = _RECIPIENT_MARKER.search(ln)
        if m:
            head = ln[:m.start()].strip()   # keep an issuer name sharing the marker's line
            if head:
                band.append(head)
            break
        band.append(ln)
    return " ".join(band)
