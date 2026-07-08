#!/usr/bin/env python3
"""
tests/test_page_ocr_cache.py
----------------------------
Stage 1 / #4 — one full-page OCR per page, cached & reused.

Every PAGE-WIDE label locate (expansion >= 1.0) expands+clamps to the SAME
full-page crop_box (0,0,1,1) regardless of anchor, so without sharing each
landmark-fit and each per-field relocation re-ran a full-page image_to_data
(~2s). _locate_anchor now memoises by (page, crop_box) via an injected
`line_cache`, collapsing them to ONE pass. This test counts ocr_lines_fn
invocations to prove the collapse — and that it does NOT over-merge distinct
regions, and stays disabled under the dev slice-capture path.

No Tesseract: ocr_lines_fn is a counting stub.
Usage: py -3.12 python_backend/tests/test_page_ocr_cache.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import template_mapper as tm  # noqa: E402

fail = 0


def check(label, cond):
    global fail
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fail += 1


class FakePage:
    size = (1000, 1400)
    def crop(self, box):       # content never inspected — ocr_lines_fn is stubbed
        return self


def counting_fn():
    """An ocr_lines_fn that returns a fixed 'Location' line and counts calls."""
    calls = {"n": 0}
    line = {"text": "Location", "x_norm": 0.1, "y_norm": 0.4, "w_norm": 0.2, "h_norm": 0.03,
            "words": [{"text": "Location", "x_norm": 0.1, "y_norm": 0.4, "w_norm": 0.2, "h_norm": 0.03}]}
    def fn(_crop):
        calls["n"] += 1
        return [line]
    return fn, calls


BOX = {"x_norm": 0.10, "y_norm": 0.40, "w_norm": 0.10, "h_norm": 0.03}
OTHER_BOX = {"x_norm": 0.60, "y_norm": 0.10, "w_norm": 0.10, "h_norm": 0.03}

print("cache: repeated PAGE-WIDE locates collapse to ONE OCR pass")
page = FakePage()
cache = {}
fn, calls = counting_fn()
# Two page-wide locates (expansion 1.0) for DIFFERENT anchors -> both crop_box (0,0,1,1).
tm._locate_anchor(page, BOX, "Location", 1.0, fn, line_cache=cache)
tm._locate_anchor(page, OTHER_BOX, "Location", 1.0, fn, line_cache=cache)
check(f"two page-wide locates -> ocr_lines_fn called ONCE (got {calls['n']})", calls["n"] == 1)
print()

print("no cache: same two locates re-OCR each time (baseline behaviour preserved)")
fn, calls = counting_fn()
tm._locate_anchor(FakePage(), BOX, "Location", 1.0, fn)          # line_cache=None
tm._locate_anchor(FakePage(), OTHER_BOX, "Location", 1.0, fn)
check(f"no line_cache -> called twice (got {calls['n']})", calls["n"] == 2)
print()

print("safety: distinct crop regions are NOT merged")
fn, calls = counting_fn()
cache = {}
# A LOCAL locate (small region) vs a PAGE-WIDE locate -> different crop_box keys.
tm._locate_anchor(page, BOX, "Location", 0.0, fn, min_search=0.05, line_cache=cache)
tm._locate_anchor(page, BOX, "Location", 1.0, fn, min_search=0.05, line_cache=cache)
check(f"local + page-wide are distinct keys -> called twice (got {calls['n']})", calls["n"] == 2)
print()

print("trace-safe: slice capture disables caching (dev overlay stays byte-identical)")
fn, calls = counting_fn()
cache = {}
cap = lambda _c: None
tm._locate_anchor(page, BOX, "Location", 1.0, fn, capture=cap, line_cache=cache)
tm._locate_anchor(page, OTHER_BOX, "Location", 1.0, fn, capture=cap, line_cache=cache)
check(f"capture set -> not cached, called twice (got {calls['n']})", calls["n"] == 2)
print()

print("per-page: a different page object does not collide")
fn, calls = counting_fn()
cache = {}
tm._locate_anchor(FakePage(), BOX, "Location", 1.0, fn, line_cache=cache)
tm._locate_anchor(FakePage(), BOX, "Location", 1.0, fn, line_cache=cache)
check(f"two different pages -> called twice (got {calls['n']})", calls["n"] == 2)
print()

print("\n%s" % ("All page-OCR-cache checks passed." if not fail else f"{fail} FAILED"))
sys.exit(1 if fail else 0)
