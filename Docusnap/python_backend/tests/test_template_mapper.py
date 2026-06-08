#!/usr/bin/env python3
"""
tests/test_template_mapper.py
-----------------------------
Direct unit test for extraction.template_mapper — the Stage 0.5 admin-drawn
anchor -> target zone mapper (Settings -> Templates -> "Map a Field").

Mirrors run_regression.py's "bypass Tesseract entirely" approach: OCR only
ever enters this module through the injectable `ocr_lines_fn`/`ocr_text_fn`
parameters, so every test below supplies small deterministic stubs instead
of depending on a Tesseract install (matching test_validator_ocr_sanitisation
.py's convention of testing extraction logic directly, at its own boundary).

Coverage:
  - Pure geometry helpers (box derivation/expansion/clamping)
  - Anchor relocation: fuzzy text match, no-match fallback, no-anchor-text mode
  - End-to-end extract_with_mappings: relative-offset target derivation off
    the anchor's RELOCATED position (the drift-handling "primary model"),
    low-confidence retry-with-expansion, and every guard that guarantees a
    template without (enabled) mappings — or a mapping whose anchor can't be
    found — produces zero interference with the rest of the pipeline.

Usage:
    py -3.12 python_backend/tests/test_template_mapper.py

Exit code 0 = guard behaves correctly. Exit code 1 = regression.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import template_mapper  # noqa: E402


def check(label, condition):
    print(f"  {'OK ' if condition else 'BAD'} {label}")
    return condition


# ── Fixtures ──────────────────────────────────────────────────────────────────

class FakePage:
    """Stands in for a PIL page image. Only `.size`/`.crop()` are touched —
    `.crop()` just tags the requested box; the OCR stubs below never inspect
    crop content, so no real image data is needed."""
    def __init__(self, size=(1000, 1000)):
        self.size = size

    def crop(self, box):
        return ("crop", box)


def lines_stub(lines):
    """Canned `ocr_lines_fn` — always returns the same crop-relative lines."""
    return lambda crop: lines


def text_queue_stub(values):
    """Canned `ocr_text_fn` — pops one value per call (None once exhausted),
    so a test can script "first crop empty, expanded retry succeeds"."""
    queue = list(values)

    def stub(crop):
        return queue.pop(0) if queue else None
    return stub


def base_mapping(**overrides):
    """
    A consistent anchor/target pair: target sits to the right of the anchor
    on the SAMPLE document, so offset_dx_norm/offset_dy_norm — computed the
    same way database/modules/templates.js::saveMapping does it
    (target - anchor) — describe "value is ~0.15 right, level with the label".
    """
    anchor = {"anchor_x_norm": 0.10, "anchor_y_norm": 0.20,
              "anchor_w_norm": 0.20, "anchor_h_norm": 0.04}
    target = {"target_x_norm": 0.25, "target_y_norm": 0.20,
              "target_w_norm": 0.15, "target_h_norm": 0.04}
    m = {
        "field_key": "invoice_number",
        "page_number": 0,
        "anchor_text": "Invoice Number",
        "ocr_type": "text",
        "search_expansion": 0.0,
        "enabled": True,
        **anchor, **target,
        "offset_dx_norm": target["target_x_norm"] - anchor["anchor_x_norm"],
        "offset_dy_norm": target["target_y_norm"] - anchor["anchor_y_norm"],
    }
    m.update(overrides)
    return m


# ── Geometry helpers ──────────────────────────────────────────────────────────

def test_geometry_helpers():
    failures = 0
    print("Geometry helpers: box derivation / expansion / clamping")

    box = template_mapper._norm_box(base_mapping(), "anchor")
    if not check("_norm_box reads the four anchor_* keys",
                 box == {"x_norm": 0.10, "y_norm": 0.20, "w_norm": 0.20, "h_norm": 0.04}):
        failures += 1

    incomplete = dict(base_mapping())
    del incomplete["target_h_norm"]
    if not check("_norm_box returns None when a coordinate is missing (signals 'skip mapping')",
                 template_mapper._norm_box(incomplete, "target") is None):
        failures += 1

    expanded = template_mapper._expand_box({"x_norm": 0.40, "y_norm": 0.30, "w_norm": 0.10, "h_norm": 0.05}, 0.05)
    expect_expanded = {"x_norm": 0.35, "y_norm": 0.25, "w_norm": 0.20, "h_norm": 0.15}
    if not check("_expand_box grows every edge by the given fraction",
                 all(abs(expanded[k] - v) < 1e-9 for k, v in expect_expanded.items())):
        failures += 1

    edge = template_mapper._expand_box({"x_norm": 0.0, "y_norm": 0.0, "w_norm": 0.05, "h_norm": 0.05}, 0.05)
    if not check("_expand_box clamps at the page edge instead of going negative",
                 edge["x_norm"] == 0.0 and edge["y_norm"] == 0.0):
        failures += 1

    clamped = template_mapper._clamp_box({"x_norm": 0.95, "y_norm": 0.10, "w_norm": 0.20, "h_norm": 0.10})
    if not check("_clamp_box shrinks width/height that would overflow the page",
                 abs(clamped["x_norm"] + clamped["w_norm"] - 1.0) < 1e-9):
        failures += 1

    print()
    return failures


# ── Anchor relocation ─────────────────────────────────────────────────────────

def test_locate_anchor():
    failures = 0
    print("_locate_anchor: fuzzy text match against the drawn anchor region")
    page = FakePage()
    anchor_box = {"x_norm": 0.10, "y_norm": 0.20, "w_norm": 0.20, "h_norm": 0.04}

    # OCR misread ("Numben") still fuzzy-matches "Invoice Number" above the
    # 0.6 threshold, and the located position is translated from crop-relative
    # back to page-relative coordinates using the (unexpanded) search box.
    misread = [{"text": "Invoice Numben", "x_norm": 0.5, "y_norm": 0.25, "w_norm": 0.4, "h_norm": 0.5}]
    located = template_mapper._locate_anchor(page, anchor_box, "Invoice Number", 0.0, lines_stub(misread))
    if not check("fuzzy OCR-misread match still locates the anchor",
                 located is not None and located.get("matched_text") == "Invoice Numben"):
        failures += 1
    if located:
        expect_x = 0.10 + 0.5 * 0.20   # crop_box.x + word.x_norm * crop_box.w
        expect_y = 0.20 + 0.25 * 0.04
        if not check(f"located position translated to page-relative ({expect_x:.3f}, {expect_y:.3f})",
                     abs(located["x_norm"] - expect_x) < 1e-9 and abs(located["y_norm"] - expect_y) < 1e-9):
            failures += 1

    # A region that simply doesn't contain the label must report "not found"
    # — this is the documented signal that lets engine.py fall back cleanly.
    unrelated = [{"text": "Terms and Conditions", "x_norm": 0.1, "y_norm": 0.1, "w_norm": 0.3, "h_norm": 0.2}]
    missing = template_mapper._locate_anchor(page, anchor_box, "Invoice Number", 0.0, lines_stub(unrelated))
    if not check("unrelated text in the anchor region -> None (fallback signal)", missing is None):
        failures += 1

    # Empty OCR result -> None, not a crash.
    empty = template_mapper._locate_anchor(page, anchor_box, "Invoice Number", 0.0, lines_stub([]))
    if not check("no OCR lines at all -> None", empty is None):
        failures += 1

    # No stored anchor_text (admin drew the box but didn't label it) — accept
    # whatever is there; matched_text stays None so confidence reflects that.
    any_text = [{"text": "Some Label", "x_norm": 0.0, "y_norm": 0.0, "w_norm": 0.5, "h_norm": 0.5}]
    untexted = template_mapper._locate_anchor(page, anchor_box, None, 0.0, lines_stub(any_text))
    if not check("missing anchor_text accepts the first line found, matched_text=None",
                 untexted is not None and untexted["matched_text"] is None):
        failures += 1

    print()
    return failures


# ── End-to-end extract_with_mappings ──────────────────────────────────────────

def test_extract_with_mappings():
    failures = 0
    print("extract_with_mappings: relative-offset derivation + guards + fallback")
    page = FakePage()
    field_patterns = {"invoice_number": {"validation": "alphanumeric"}}

    # Anchor relocates ~0.10 right / ~0.01 down from its SAMPLE-document spot
    # (simulates scan/print drift). The target must be derived from this
    # ACTUAL position + the stored relative offset — NOT from the absolute
    # saved target box — proving the "anchor + relative target zone" model.
    drifted = [{"text": "Invoice Number", "x_norm": 0.5, "y_norm": 0.25, "w_norm": 0.4, "h_norm": 0.5}]
    mapping = base_mapping()
    results = template_mapper.extract_with_mappings(
        [page], [mapping], field_patterns,
        ocr_lines_fn=lines_stub(drifted),
        ocr_text_fn=text_queue_stub(["INV-2026-001"]),
    )
    if not check("happy path resolves the field via template_mapping",
                 results.get("invoice_number", {}).get("value") == "INV-2026-001"
                 and results["invoice_number"]["method"] == "template_mapping"):
        failures += 1
    if not check("matched-anchor confidence lands at 90",
                 results.get("invoice_number", {}).get("confidence") == 90):
        failures += 1
    if not check("result carries the anchor label for traceability",
                 results.get("invoice_number", {}).get("anchor") == "Invoice Number"):
        failures += 1

    # Anchor not found anywhere in its region -> field omitted entirely, so
    # engine.py's merge leaves whatever keyword/anchor stages already produced
    # untouched (the documented "fall back to current behaviour" contract).
    no_match = template_mapper.extract_with_mappings(
        [page], [base_mapping()], field_patterns,
        ocr_lines_fn=lines_stub([{"text": "Unrelated", "x_norm": 0, "y_norm": 0, "w_norm": 1, "h_norm": 1}]),
        ocr_text_fn=text_queue_stub(["should never be reached"]),
    )
    if not check("anchor not located -> field omitted (fallback to existing pipeline)",
                 "invoice_number" not in no_match):
        failures += 1

    # Primary crop yields nothing; search_expansion > 0 triggers exactly one
    # retry against the expanded box, and the result is flagged + discounted
    # so engine.py's confidence-comparison still prefers a clean primary hit.
    expanding = base_mapping(search_expansion=0.05)
    expanded_result = template_mapper.extract_with_mappings(
        [page], [expanding], field_patterns,
        ocr_lines_fn=lines_stub(drifted),
        ocr_text_fn=text_queue_stub([None, "INV-2026-002"]),
    )
    if not check("empty primary crop + search_expansion -> retried at expanded box",
                 expanded_result.get("invoice_number", {}).get("value") == "INV-2026-002"
                 and expanded_result["invoice_number"]["method"] == "template_mapping_expanded"):
        failures += 1
    if not check("expanded-retry confidence is discounted below the clean-match value (90)",
                 expanded_result.get("invoice_number", {}).get("confidence", 999) < 90):
        failures += 1

    # Disabled mapping must do zero work (no OCR calls at all).
    def boom(_crop):
        raise AssertionError("OCR must not be invoked for a disabled mapping")
    disabled = template_mapper.extract_with_mappings(
        [page], [base_mapping(enabled=False)], field_patterns,
        ocr_lines_fn=boom, ocr_text_fn=boom,
    )
    if not check("disabled mapping is skipped without touching OCR", disabled == {}):
        failures += 1

    # Two mappings targeting the same field_key — first one wins, second is
    # skipped (mirrors the engine's "don't reprocess an already-resolved key").
    dup_first  = base_mapping(anchor_text="Invoice Number")
    dup_second = base_mapping(anchor_text="Should Not Run")
    dup_result = template_mapper.extract_with_mappings(
        [page], [dup_first, dup_second], field_patterns,
        ocr_lines_fn=lines_stub(drifted),
        ocr_text_fn=text_queue_stub(["INV-2026-001", "SHOULD-NOT-APPEAR"]),
    )
    if not check("duplicate field_key: only the first mapping is applied",
                 dup_result.get("invoice_number", {}).get("value") == "INV-2026-001"):
        failures += 1

    # A mapping pointing past the available pages is skipped, not a crash.
    oob = template_mapper.extract_with_mappings(
        [page], [base_mapping(page_number=3)], field_patterns,
        ocr_lines_fn=lines_stub(drifted), ocr_text_fn=text_queue_stub(["x"]),
    )
    if not check("out-of-range page_number is skipped", oob == {}):
        failures += 1

    # A mapping missing one of the eight saved coordinates is skipped (mirrors
    # the IPC-level validation in templates/handler.js::save-template-mapping —
    # belt-and-braces in case older/partial rows ever reach the engine).
    incomplete = base_mapping()
    del incomplete["target_w_norm"]
    bad_box = template_mapper.extract_with_mappings(
        [page], [incomplete], field_patterns,
        ocr_lines_fn=lines_stub(drifted), ocr_text_fn=text_queue_stub(["x"]),
    )
    if not check("incomplete box coordinates -> field omitted, not a crash", bad_box == {}):
        failures += 1

    # No mappings / no page images -> no-op (every template without drawn
    # mappings must take this exact zero-cost path).
    if not check("no mappings -> {}", template_mapper.extract_with_mappings([page], [], field_patterns) == {}):
        failures += 1
    if not check("no page images -> {}", template_mapper.extract_with_mappings([], [base_mapping()], field_patterns) == {}):
        failures += 1

    print()
    return failures


def main():
    failures = 0
    failures += test_geometry_helpers()
    failures += test_locate_anchor()
    failures += test_extract_with_mappings()

    if failures:
        print(f"{failures} check(s) failed — template_mapper regressed.")
        return 1
    print("All checks passed — template_mapper anchor/target mapping behaves as expected.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
