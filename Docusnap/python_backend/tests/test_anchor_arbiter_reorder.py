#!/usr/bin/env python3
"""
tests/test_anchor_arbiter_reorder.py — Stage 2 "anchor arbiter" rung reorder.

Proves the 2026-06 reorder (the LABEL-based drift-recovery / inline-harvest runs BEFORE the
GLOBAL registration transform) + the partial-shape resurrection guard, for the live bug where
a worksheet Reference (learned shape ####-####-#, true value 2605-0849-1) committed the
wrong-row fragment 849-4.

Hermetic — _crop_and_ocr, _locate_for_relocation, _filter_anchors are stubbed and a
format_lookup is injected, so no Tesseract or real image is needed. Reusable across shapes /
labels, NOT a one-document hack.

    py -3.12 python_backend/tests/test_anchor_arbiter_reorder.py
"""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import anchor, registration  # noqa: E402

# Generic alphanumeric ref pattern (mirrors config/keyword_patterns.json) — matches any
# >=3-char alnum token, so the learned SHAPE is the only precision backstop (the crux).
PATS = {"alphanumeric": [r"[A-Za-z0-9][A-Za-z0-9\-\/\.]{2,20}"]}
FIELD_PATS = {"reference_number": {"validation": "alphanumeric"}}

# Uniform single learned shape — every confirmed value is NNNN-NNNN-N.
REF_ENTRY = {"class": "alphanum_sep", "separators": frozenset({"-"}),
             "shapes": frozenset({"####-####-#"})}
def fmt(field_key):
    return REF_ENTRY if field_key == "reference_number" else None


def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return cond


class FakePage:
    size = (1000, 1000)


def _shift_transform(dx, dy):
    return registration.Transform(np.array([[1.0, 0.0, dx], [0.0, 1.0, dy]]),
                                  residual=0.0, n_inliers=4, n_points=4, kind="similarity")


def _ref_anchor(**ov):
    a = {"field_key": "reference_number", "anchor_label": "Ticket No.", "direction": "right",
         "usage_count": 3, "confidence": 0.8,
         "x_norm": 0.30, "y_norm": 0.25, "w_norm": 0.12, "h_norm": 0.03,
         "offset_dx_norm": 0.10, "offset_dy_norm": 0.0}
    a.update(ov)
    return a


# A located label whose OCR line carries the value to the right (inline harvest).
def _located(inline_value):
    return {"label_box":  {"x_norm": 0.30, "y_norm": 0.25, "w_norm": 0.05, "h_norm": 0.03},
            "inline_value": inline_value,
            "inline_box":  {"x_norm": 0.40, "y_norm": 0.25, "w_norm": 0.10, "h_norm": 0.03}}


RIGID = (0.30, 0.25)   # stored value box — the rigid crop reads garbage here


def _run(reg_value, located_ret, page_transform):
    """rigid crop -> garbage (rejected); any OTHER crop position (the registration mapped
    box) -> reg_value. `located_ret` is what _locate_for_relocation returns (None = label
    un-findable)."""
    def crop(x, y):
        if abs(x - RIGID[0]) < 0.02 and abs(y - RIGID[1]) < 0.02:
            return "ReAF AOAKR A"          # space-laden garbage -> not credible -> rejected
        return reg_value
    saved = (anchor._crop_and_ocr, anchor._locate_for_relocation, anchor._filter_anchors)
    anchor._crop_and_ocr = (lambda page, x, y, w, h, vt, capture=None, verify_fn=None,
                            meta=None, continuation=None: crop(x, y))
    anchor._locate_for_relocation = lambda *a, **k: located_ret
    anchor._filter_anchors = lambda anchors, s, d: list(anchors)
    try:
        return anchor.extract_with_anchors(
            "dummy ocr text", [_ref_anchor()], supplier_name=None, document_type="worksheet",
            page_images=[FakePage()], field_patterns=FIELD_PATS,
            validation_patterns=PATS, format_lookup=fmt, page_transform=page_transform)
    finally:
        anchor._crop_and_ocr, anchor._locate_for_relocation, anchor._filter_anchors = saved


def test_inline_wins_over_drifted_registration():
    print("a) label findable: inline-harvest beats the row-off registration read")
    # Registration WOULD read 849-4 (a row off); the located label inline-harvests the truth.
    res = _run("849-4", _located("2605-0849-1"), _shift_transform(0.10, 0.05))
    got = res.get("reference_number", {})
    f = 0
    f += not check(f"value is 2605-0849-1, not 849-4 (got {got.get('value')!r})",
                   got.get("value") == "2605-0849-1")
    f += not check(f"method is anchor_inline, not anchor_registration (got {got.get('method')})",
                   got.get("method") == "anchor_inline")
    print()
    return f


def test_registration_preserved_as_fallback():
    print("b) label un-findable: registration still recovers a VALID full read (fallback kept)")
    res = _run("2605-0849-1", None, _shift_transform(0.10, 0.05))
    got = res.get("reference_number", {})
    f = 0
    f += not check(f"value recovered via registration (got {got.get('value')!r})",
                   got.get("value") == "2605-0849-1")
    f += not check(f"method is anchor_registration (got {got.get('method')})",
                   got.get("method") == "anchor_registration")
    print()
    return f


def test_partial_shape_refused():
    print("c) label un-findable + registration reads a partial shape -> refused (new guard)")
    # 849-4 (###-#) is a sub-run of the uniform ####-####-# -> must NOT commit -> field empty.
    res = _run("849-4", None, _shift_transform(0.10, 0.05))
    f = not check("partial-shape 849-4 not committed (field empty)", "reference_number" not in res)
    print()
    return f


def test_digit_free_refused():
    print("d) label un-findable + registration reads a digit-free word -> refused (existing guard)")
    res = _run("Field", None, _shift_transform(0.10, 0.05))
    f = not check("digit-free 'Field' not committed (field empty)", "reference_number" not in res)
    print()
    return f


def test_new_variable_code_survives():
    print("e) label un-findable + a genuinely-NEW differently-shaped code -> kept")
    # @@-#### is NOT a sub-run of ####-####-# -> guard does not fire -> resurrected.
    res = _run("AB-1234", None, _shift_transform(0.10, 0.05))
    got = res.get("reference_number", {})
    f = not check(f"new code AB-1234 committed (got {got.get('value')!r})",
                  got.get("value") == "AB-1234")
    print()
    return f


def test_clean_page_uses_rigid():
    print("f) clean page: value at the stored box -> rigid wins, byte-identical")
    def crop(x, y):
        return "2605-0849-1" if (abs(x - RIGID[0]) < 0.02 and abs(y - RIGID[1]) < 0.02) else "WRONG-9"
    saved = (anchor._crop_and_ocr, anchor._locate_for_relocation, anchor._filter_anchors)
    anchor._crop_and_ocr = (lambda page, x, y, w, h, vt, capture=None, verify_fn=None,
                            meta=None, continuation=None: crop(x, y))
    anchor._locate_for_relocation = lambda *a, **k: _located("WRONG-9")
    anchor._filter_anchors = lambda anchors, s, d: list(anchors)
    try:
        res = anchor.extract_with_anchors(
            "dummy", [_ref_anchor()], supplier_name=None, document_type="worksheet",
            page_images=[FakePage()], field_patterns=FIELD_PATS, validation_patterns=PATS,
            format_lookup=fmt, page_transform=_shift_transform(0.10, 0.05))
    finally:
        anchor._crop_and_ocr, anchor._locate_for_relocation, anchor._filter_anchors = saved
    got = res.get("reference_number", {})
    f = not check(f"clean rigid read wins (got {got.get('value')!r}/{got.get('method')})",
                  got.get("value") == "2605-0849-1" and got.get("method") == "anchor_crop")
    print()
    return f


def main():
    failures = 0
    for t in (test_inline_wins_over_drifted_registration,
              test_registration_preserved_as_fallback,
              test_partial_shape_refused,
              test_digit_free_refused,
              test_new_variable_code_survives,
              test_clean_page_uses_rigid):
        failures += t()
    print("All checks passed." if failures == 0 else f"{failures} CHECK(S) FAILED.")
    return failures


if __name__ == "__main__":
    sys.exit(1 if main() else 0)
