#!/usr/bin/env python3
"""
tests/test_currency_label_lock.py — the LABEL LOCK now covers CURRENCY.

A taught currency anchor (e.g. Total) reads a RIGID crop at absolute coords. In a stacked
totals block (Subtotal / Discount / Shipping / Total) a variable Discount line pushes Total
DOWN a row, so the rigid crop lands on the Shipping row and reads a VALID currency
("$111.94") that PASSES the currency gate — committing the wrong total while the "Total:"
label sits a row below. Free-text already locked its value to the located label; this proves
currency does too: when the label locates, the value is re-read beside it and preferred, but
only when it DIFFERS and is credible (a clean page is byte-identical).

Hermetic — _crop_and_ocr / _locate_for_relocation / _filter_anchors stubbed (no Tesseract).

    py -3.12 python_backend/tests/test_currency_label_lock.py
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import anchor  # noqa: E402

# Real currency validation patterns (mirror config/keyword_patterns.json).
PATS = {"currency": [r'[£$€]\s*[\d,]+\.?\d*', r'[\d,]+\.\d{2}\s*(?:GBP|USD|EUR|JPY)?']}
FIELD_PATS = {"total": {"validation": "currency"}}
fmt = lambda field_key: None   # no learned shape → currency qualifies on regex/type alone

FAILS = 0
def check(label, cond):
    global FAILS
    if not cond:
        FAILS += 1
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return bool(cond)


class FakePage:
    size = (1000, 1000)


def _total_anchor(**ov):
    a = {"field_key": "total", "anchor_label": "Total", "direction": "right",
         "usage_count": 3, "confidence": 0.8,
         "x_norm": 0.62, "y_norm": 0.55, "w_norm": 0.12, "h_norm": 0.03,
         "offset_dx_norm": 0.0, "offset_dy_norm": 0.0}
    a.update(ov)
    return a


def _located(inline_value):
    # "Total:" label located a row LOWER than the rigid box, with the value inline on its row.
    return {"label_box":  {"x_norm": 0.58, "y_norm": 0.62, "w_norm": 0.05, "h_norm": 0.03},
            "inline_value": inline_value,
            "inline_box":  {"x_norm": 0.66, "y_norm": 0.62, "w_norm": 0.10, "h_norm": 0.03}}


def _run(rigid_value, located_ret):
    saved = (anchor._crop_and_ocr, anchor._locate_for_relocation, anchor._filter_anchors)
    anchor._crop_and_ocr = (lambda page, x, y, w, h, vt, capture=None, verify_fn=None,
                            meta=None, continuation=None: rigid_value)
    anchor._locate_for_relocation = lambda *a, **k: located_ret
    anchor._filter_anchors = lambda anchors, s, d: list(anchors)
    try:
        return anchor.extract_with_anchors(
            "dummy ocr text", [_total_anchor()], supplier_name="SuperStore",
            document_type="invoice", page_images=[FakePage()], field_patterns=FIELD_PATS,
            validation_patterns=PATS, format_lookup=fmt, page_transform=None)
    finally:
        anchor._crop_and_ocr, anchor._locate_for_relocation, anchor._filter_anchors = saved


print("Currency LABEL LOCK:")

# a) DRIFT: rigid crop reads the Shipping row ($111.94, valid currency); the located "Total:"
#    label inline-harvests the real total -> value follows the label.
got = _run("$111.94", _located("$1,955.03")).get("total", {})
check(f"drifted currency follows the label (got {got.get('value')!r})", got.get("value") == "$1,955.03")
check(f"method is anchor_crop_relocated (got {got.get('method')})", got.get("method") == "anchor_crop_relocated")

# b) CLEAN page: the located label + offset ≈ the rigid box, so the re-read matches -> no
#    replacement, rigid wins, byte-identical.
got = _run("$1,955.03", _located("$1,955.03")).get("total", {})
check(f"clean page keeps the rigid read (got {got.get('value')!r})", got.get("value") == "$1,955.03")
check(f"clean page method is anchor_crop (got {got.get('method')})", got.get("method") == "anchor_crop")

# c) label UN-findable: nothing to lock to, rigid read stays (documents the limitation —
#    recovery needs the label; no worse than before).
got = _run("$111.94", None).get("total", {})
check(f"no located label -> rigid kept (got {got.get('value')!r}/{got.get('method')})",
      got.get("value") == "$111.94" and got.get("method") == "anchor_crop")

print(f"\n{'ALL PASS' if FAILS == 0 else str(FAILS) + ' FAILED'}")
sys.exit(1 if FAILS else 0)
