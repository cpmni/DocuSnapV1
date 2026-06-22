#!/usr/bin/env python3
"""
tests/test_registration_arbiter.py
----------------------------------
Stage 0.5 REGISTRATION ARBITER: when a fitted page transform says the taught
target box has MOVED (box_divergence beyond the row band), the registration read
is preferred over the stationary absolute read — catching the type-valid-WRONG
neighbour that shape_mode='ignore' lets through and the per-label guard misses.
Clean pages (transform ~ identity -> divergence ~ 0) keep the absolute fast path.

Drives template_mapper._extract_one directly with a hand-built
registration.Transform, so the arbiter is isolated from the landmark-locate path.
OCR stubbed via injected ocr_text_fn keyed on the crop's vertical centre.
    py -3.12 python_backend/tests/test_registration_arbiter.py
"""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import template_mapper  # noqa: E402
from extraction import registration     # noqa: E402


def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return bool(cond)


class FakePage:
    def __init__(self, size=(1000, 1000)):
        self.size = size
    def crop(self, box):
        return ("crop", box)


FPS = {"invoice_number": {"validation": "alphanumeric"}}
VPS = {"alphanumeric": [r"[A-Za-z0-9][A-Za-z0-9\-\/\.]{2,20}"]}
NO_LINES = lambda _crop: []          # arbiter path never needs ocr_lines_fn


def transform(ty=0.0, scale=1.0, residual=0.001):
    """Hand-built page transform: uniform scale + vertical translation."""
    return registration.Transform(np.array([[scale, 0.0, 0.0], [0.0, scale, ty]]),
                                   residual=residual, n_inliers=4, n_points=4, kind="similarity")


def mp(**ov):
    # anchor_text present (realistic) → absolute fast path scores 90; the per-label
    # drift guard is still skipped because we pass located=_UNSET, so these tests
    # isolate the registration arbiter.
    m = {"field_key": "invoice_number", "page_number": 0, "anchor_text": "Invoice No",
         "ocr_type": "alphanumeric", "search_expansion": 0.0, "enabled": True,
         "anchor_x_norm": 0.10, "anchor_y_norm": 0.18, "anchor_w_norm": 0.15, "anchor_h_norm": 0.03,
         "target_x_norm": 0.30, "target_y_norm": 0.20, "target_w_norm": 0.15, "target_h_norm": 0.04,
         "offset_dx_norm": 0.20, "offset_dy_norm": 0.02}
    m.update(ov)
    return m


def band_text(absolute_val, reg_val):
    """ocr_text_fn: stored target band (~y0.22) reads absolute_val; the shifted
    registration band (~y0.34) reads reg_val. None => empty (gate fails)."""
    def stub(crop):
        _, (x1, y1, x2, y2) = crop
        cy = (y1 + y2) / 2.0 / 1000.0
        return absolute_val if cy < 0.27 else reg_val
    return stub


def _run(page_transform, ocr_text_fn):
    return template_mapper._extract_one(
        FakePage(), mp(), FPS, NO_LINES, ocr_text_fn,
        located=template_mapper._UNSET, page_transform=page_transform,
        validation_patterns=VPS)


def test_box_divergence():
    print("box_divergence: identity -> 0; pure translation -> the shift")
    f = 0
    box = {"x_norm": 0.30, "y_norm": 0.20, "w_norm": 0.15, "h_norm": 0.04}
    f += not check("identity transform -> 0", registration.box_divergence(transform(0.0), box) < 1e-9)
    f += not check("translation 0.10 -> ~0.10",
                   abs(registration.box_divergence(transform(0.10), box) - 0.10) < 1e-6)
    f += not check("None transform -> 0", registration.box_divergence(None, box) == 0.0)
    print()
    return f


def test_drifted_registration_beats_typevalid_wrong_absolute():
    print("headline: drifted page -> registration corrects a type-valid WRONG absolute read")
    f = 0
    out = _run(transform(ty=0.12), band_text("INV-999", "INV-001"))   # abs wrong, reg correct
    f += not check("registration value wins (INV-001)", (out or {}).get("value") == "INV-001")
    f += not check("method is a registration tier",
                   (out or {}).get("method", "").startswith("template_registration"))
    print()
    return f


def test_clean_page_keeps_absolute_fast_path():
    print("clean: identity transform -> divergence ~0 -> absolute fast path unchanged")
    f = 0
    out = _run(transform(0.0), lambda _c: "INV-001")
    f += not check("absolute value kept", (out or {}).get("value") == "INV-001")
    f += not check("method=template_mapping, conf=90 (arbiter did NOT fire)",
                   (out or {}).get("method") == "template_mapping" and (out or {}).get("confidence") == 90)
    print()
    return f


def test_no_transform_unchanged():
    print("no landmarks: page_transform None -> arbiter inert, absolute used")
    f = 0
    out = _run(None, lambda _c: "INV-001")
    f += not check("method=template_mapping", (out or {}).get("method") == "template_mapping")
    print()
    return f


def test_below_tolerance_keeps_absolute():
    print("jitter: divergence below the row band -> arbiter does NOT fire")
    f = 0
    out = _run(transform(ty=0.005), lambda _c: "INV-001")   # 0.005 < max(h*0.5, 0.02)
    f += not check("absolute kept, method=template_mapping",
                   (out or {}).get("value") == "INV-001" and (out or {}).get("method") == "template_mapping")
    print()
    return f


def test_registration_read_fails_falls_through_to_absolute():
    print("resilience: drift detected but reg crop reads nothing -> falls through to absolute")
    f = 0
    out = _run(transform(ty=0.12), band_text("INV-001", None))   # abs ok, reg band empty
    f += not check("falls through to the absolute read (not None)",
                   (out or {}).get("value") == "INV-001" and (out or {}).get("method") == "template_mapping")
    print()
    return f


def _run_located(page_transform, ocr_text_fn, located):
    return template_mapper._extract_one(
        FakePage(), mp(), FPS, NO_LINES, ocr_text_fn,
        located=located, page_transform=page_transform, validation_patterns=VPS)


def test_found_anchor_not_displaced_beats_registration():
    print("LINK: this field's anchor found at its spot -> the rigid anchored read wins over a (poor) page transform")
    f = 0
    # `located` ≈ the drawn anchor box (NOT displaced) -> _label_drifted False ->
    # anchor_stable -> the registration arbiter must NOT override a correctly-anchored
    # value, even though box_divergence is high (a poor global landmark fit). This is
    # the "anchor and data point aren't linked" fix: the local label→value link wins.
    located = {"x_norm": 0.10, "y_norm": 0.18, "w_norm": 0.15, "h_norm": 0.03,
               "matched_text": "Invoice No",
               "label_box": {"x_norm": 0.10, "y_norm": 0.18, "w_norm": 0.15, "h_norm": 0.03}}
    out = _run_located(transform(ty=0.12), band_text("INV-001", "INV-XXX"), located)
    f += not check("anchored absolute value wins (INV-001), NOT the transform read (INV-XXX)",
                   (out or {}).get("value") == "INV-001")
    f += not check("method stays template_mapping (arbiter skipped: anchor is a usable local signal)",
                   (out or {}).get("method") == "template_mapping")
    print()
    return f


def main():
    fails = 0
    fails += test_box_divergence()
    fails += test_drifted_registration_beats_typevalid_wrong_absolute()
    fails += test_clean_page_keeps_absolute_fast_path()
    fails += test_no_transform_unchanged()
    fails += test_below_tolerance_keeps_absolute()
    fails += test_registration_read_fails_falls_through_to_absolute()
    fails += test_found_anchor_not_displaced_beats_registration()
    if fails:
        print(f"{fails} check(s) failed - registration arbiter regressed.")
        return 1
    print("All checks passed - registration arbiter prefers the transform read only on a drifted page.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
