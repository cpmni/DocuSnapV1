#!/usr/bin/env python3
"""
tests/test_anchor_crop_credibility.py
-------------------------------------
Regression coverage for the shared anchor-crop credibility gate in
extraction.anchor. A fixed normalized-coordinate crop is positionally rigid:
when an upstream line wraps or a block shifts on a sibling layout, the box can
land off-target and return a NON-EMPTY but wrong value (the real-world
">alifornia" failure on a SuperStore invoice). Previously that wrong value was
committed AND it suppressed the anchor_label + direction relocation fallback
(which only ran when the crop returned empty).

The fix (anchor._crop_is_credible, applied to the crop and to the final value):
  * a credible crop still wins (no behaviour change for healthy layouts);
  * an implausible crop is treated as a miss so the label-relative search runs;
  * an implausible value from EITHER path is never committed (left for review).

OCR enters anchor only via _crop_and_ocr (pytesseract); every test stubs it, so
no Tesseract install is needed.  Run:  py -3.12 python_backend/tests/test_anchor_crop_credibility.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import anchor  # noqa: E402

FIELD_PATTERNS = {
    "customer":     {"validation": "text"},
    "invoice_date": {"validation": "date"},
}
# The real type->regex table the keyword stage trusts (subset is enough here).
VALIDATION_PATTERNS = {
    "date":     [r"\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}"],
    "currency": [r"[£$€¥]\s*[\d,]+\.?\d*", r"[\d,]+\.\d{2}"],
}

_failures = []
def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        _failures.append(label)


class FakePage:
    size = (1000, 1000)
    def crop(self, box):  # never inspected — _crop_and_ocr is stubbed
        return ("crop", box)


def anchor_for(field_key, label, direction):
    return {
        "field_key": field_key, "anchor_label": label, "direction": direction,
        "x_norm": 0.3, "y_norm": 0.2, "w_norm": 0.1, "h_norm": 0.02,
        "supplier_name": "ACME", "document_type": "invoice",
        "usage_count": 5, "confidence": 0.9,
    }


def run(ocr_text, field_key, label, direction, crop_returns):
    """Run extract_with_anchors with _crop_and_ocr stubbed to crop_returns."""
    orig = anchor._crop_and_ocr
    anchor._crop_and_ocr = lambda *a, **k: crop_returns
    try:
        return anchor.extract_with_anchors(
            ocr_text, [anchor_for(field_key, label, direction)],
            "ACME", "invoice", page_images=[FakePage()],
            field_patterns=FIELD_PATTERNS, validation_patterns=VALIDATION_PATTERNS,
        )
    finally:
        anchor._crop_and_ocr = orig


print("anchor crop-credibility gate:")

# 1) A valid crop still wins exactly as before.
r = run("Bill To:\nAlan Barnes\nDecatur", "customer", "Bill To:", "below",
        crop_returns="Alan Barnes")
check("valid crop kept (value + anchor_crop method)",
      r.get("customer", {}).get("value") == "Alan Barnes"
      and r.get("customer", {}).get("method") == "anchor_crop")

# 2) A wrong-but-non-empty crop falls through to label-relative relocation.
r = run("Bill To:\nAdam Hart\nBeach, California", "customer", "Bill To:", "below",
        crop_returns=">alifornia")
check("junk crop rejected -> label fallback relocates to 'Adam Hart'",
      r.get("customer", {}).get("value") == "Adam Hart"
      and r.get("customer", {}).get("method") == "anchor")

# 3) The bad.pdf vertical-shift shape: crop drifts AND the first line below the
#    label is an adjacent field label. Neither is committed (no wrong value).
r = run("Bill To: Ship To:\n. Ship Mode: Standard Class\nAdam Hart 92646",
        "customer", "Bill To:", "below", crop_returns=">alifornia")
check("drifted crop + junk fallback line -> field left empty (review)",
      "customer" not in r)

# 4) No regression for typed fields: valid date crop kept; junk date discarded.
r = run("Date:\n15-11-2012", "invoice_date", "Date", "right",
        crop_returns="15-11-2012")
check("typed crop matching validation kept",
      r.get("invoice_date", {}).get("value") == "15-11-2012")
r = run("Date:\nfoo bar", "invoice_date", "Date", "right", crop_returns="Adam Hart")
check("typed crop failing validation discarded (not committed)",
      "invoice_date" not in r)

# 5) Direct unit checks of the credibility helper.
vp = VALIDATION_PATTERNS
check("_credible: clean name (text) True",
      anchor._crop_is_credible("Alan Barnes", "text", vp) is True)
check("_credible: leading-punctuation junk False",
      anchor._crop_is_credible(">alifornia", "text", vp) is False)
check("_credible: adjacent-label line False",
      anchor._crop_is_credible(". Ship Mode: Standard Class", "text", vp) is False)
check("_credible: empty False",
      anchor._crop_is_credible("   ", "text", vp) is False)
check("_credible: valid date True",
      anchor._crop_is_credible("15-11-2012", "date", vp) is True)
check("_credible: non-date for date field False",
      anchor._crop_is_credible("Adam Hart", "date", vp) is False)
check("_credible: free-text starting with digit (address) True",
      anchor._crop_is_credible("92646 Huntington Beach", "text", vp) is True)

if _failures:
    print(f"\nFAILED: {len(_failures)} check(s): {_failures}")
    sys.exit(1)
print("\nAll anchor crop-credibility checks passed.")
