#!/usr/bin/env python3
"""
tests/test_anchor_registration.py — Stage 2 "register, then read" rung.

Proves the registration rung added to anchor.extract_with_anchors recovers a
taught field on a SHIFTED page (where the rigid crop at stored coords misses and
the field's own label can't be re-found) by mapping the stored value box through
the per-page transform. Hermetic: _crop_and_ocr / _relocate / _filter are stubbed,
so no Tesseract or image is needed.

Usage:  py -3.12 python_backend/tests/test_anchor_registration.py
"""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import anchor, registration  # noqa: E402

DATE_PATS = {"date": [r"\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}"]}


def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return cond


class FakePage:
    size = (1000, 1000)


def _shift_transform(dx, dy):
    return registration.Transform(np.array([[1.0, 0.0, dx], [0.0, 1.0, dy]]),
                                  residual=0.0, n_inliers=4, n_points=4, kind="similarity")


def _anchor(**ov):
    a = {"field_key": "date", "anchor_label": "Ticket Logged", "direction": "right",
         "usage_count": 3, "confidence": 0.8,
         "x_norm": 0.30, "y_norm": 0.25, "w_norm": 0.12, "h_norm": 0.03}
    a.update(ov)
    return a


def _run(monkey_crop, page_transform, orig=None):
    """Run extract_with_anchors with stubbed crop/relocate/filter. `monkey_crop`
    takes (x,y) crop centre and returns the OCR'd value (or None)."""
    saved = (anchor._crop_and_ocr, anchor._locate_for_relocation, anchor._filter_anchors)
    anchor._crop_and_ocr = lambda page, x, y, w, h, vt, capture=None, verify_fn=None, meta=None, continuation=None: monkey_crop(x, y)
    anchor._locate_for_relocation = lambda *a, **k: None          # force the no-label case (relocate finds nothing)
    anchor._filter_anchors = lambda anchors, s, d: list(anchors)
    try:
        return anchor.extract_with_anchors(
            "dummy ocr text", [_anchor()], supplier_name=None, document_type="worksheet",
            page_images=[FakePage()], field_patterns={"date": {"validation": "date"}},
            validation_patterns=DATE_PATS, page_transform=page_transform)
    finally:
        anchor._crop_and_ocr, anchor._locate_for_relocation, anchor._filter_anchors = saved


def test_shifted_recovery():
    failures = 0
    print("Stage 2 registration: recovers a shifted-page value the rigid crop misses")
    # Page shifted +0.10/+0.05; the value is ONLY at the mapped position, not the
    # stored coords (so the rigid crop misses and registration must recover it).
    def crop(x, y):
        return "27-05-2026" if (abs(x - 0.40) < 0.012 and abs(y - 0.30) < 0.012) else None
    res = _run(crop, _shift_transform(0.10, 0.05))
    got = res.get("date", {})
    if not check("date recovered on the shifted page", got.get("value") == "27-05-2026"):
        failures += 1
    if not check(f"method is anchor_registration (got {got.get('method')})",
                 got.get("method") == "anchor_registration"):
        failures += 1
    if not check(f"confidence from fit quality, capped 93 (got {got.get('confidence')})",
                 got.get("confidence") == 93):
        failures += 1
    print()
    return failures


def test_no_transform_no_change():
    failures = 0
    print("Stage 2 registration: no transform -> rung inert (field stays empty)")
    # Same shifted page, but page_transform=None: rigid misses, relocate stubbed to
    # None, no registration -> field omitted (exactly today's behaviour).
    def crop(x, y):
        return "27-05-2026" if (abs(x - 0.40) < 0.012 and abs(y - 0.30) < 0.012) else None
    res = _run(crop, None)
    if not check("with no transform the field is omitted (no regression)", "date" not in res):
        failures += 1
    print()
    return failures


def test_clean_page_uses_rigid_not_registration():
    failures = 0
    print("Stage 2 registration: clean page is read by the rigid crop, rung not used")
    # Value present at the STORED coords -> rigid crop wins; registration never runs.
    def crop(x, y):
        return "27-05-2026" if (abs(x - 0.30) < 0.012 and abs(y - 0.25) < 0.012) else "WRONG"
    res = _run(crop, _shift_transform(0.10, 0.05))
    got = res.get("date", {})
    if not check("clean page resolved via anchor_crop (not registration)",
                 got.get("value") == "27-05-2026" and got.get("method") == "anchor_crop"):
        failures += 1
    print()
    return failures


def test_gate_rejects_wrong_format():
    failures = 0
    print("Stage 2 registration: a mapped read failing the date gate is rejected")
    # Registration maps to a spot that OCRs a non-date -> _crop_is_credible(date)
    # rejects it -> falls through (relocate stubbed None) -> field omitted.
    def crop(x, y):
        return "Booking" if (abs(x - 0.40) < 0.012 and abs(y - 0.30) < 0.012) else None
    res = _run(crop, _shift_transform(0.10, 0.05))
    if not check("non-date mapped read rejected by the credibility gate", "date" not in res):
        failures += 1
    print()
    return failures


def main():
    failures = 0
    failures += test_shifted_recovery()
    failures += test_no_transform_no_change()
    failures += test_clean_page_uses_rigid_not_registration()
    failures += test_gate_rejects_wrong_format()
    if failures:
        print(f"{failures} check(s) failed — Stage 2 registration regressed.")
        return 1
    print("All checks passed — Stage 2 registration rung behaves as expected.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
