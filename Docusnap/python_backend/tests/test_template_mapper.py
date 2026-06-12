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
        # Text-validated anchors now search an asymmetric drift margin around the
        # drawn box (mx=_MIN_RELOCATE_MARGIN_X=0.01, my=_MIN_RELOCATE_MARGIN_Y=
        # 0.05), so the crop box is x0=0.09,w=0.22 / y0=0.15,h=0.14 and the
        # crop-relative word translates against THAT box.
        expect_x = 0.09 + 0.5 * 0.22   # crop_box.x + word.x_norm * crop_box.w
        expect_y = 0.15 + 0.25 * 0.14
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


def test_derived_target_no_leading_inset_clip():
    """Regression: the box-based offset must be applied to the located anchor's
    BOX origin, not its tight OCR bbox — otherwise the derived target is shifted
    right/down by the anchor's drawn margin and clips leading glyphs
    ("PROFILE" -> "ROFILE"). With the label tight-centred inside the drawn anchor
    box and no drift, the derived crop must land exactly on the DRAWN target."""
    failures = 0
    print("derived target: box-origin offset removes leading-character inset clip")
    page = FakePage((1000, 1000))
    # base_mapping: anchor box x=0.10 w=0.20; target box x=0.25 w=0.15; dx=0.15.
    # Use a non-reference field (customer_name) for this geometry test — the value
    # below ("PROFILE CONSTRUCTION") is a name with no digit, which the numeric
    # shape-gate would legitimately reject on a `..._number`/`..._no` field. This
    # is also truer to the original bug, which was a name field clipped to "ROFILE".
    m = base_mapping(field_key="customer_name")
    # Label OCR'd tight-centred inside the anchor crop (crop-relative): left 0.15
    # of width 0.70 -> page-relative tight left 0.10+0.15*0.20=0.13, width 0.14,
    # so per-side inset (0.20-0.14)/2 = 0.03.
    centred = [{"text": "Invoice Number", "x_norm": 0.15, "y_norm": 0.25,
                "w_norm": 0.70, "h_norm": 0.50}]
    captured = {}
    def recording_text(crop):
        captured["box"] = crop[1]   # FakePage.crop -> ("crop", (x1,y1,x2,y2))
        return "PROFILE CONSTRUCTION"
    res = template_mapper.extract_with_mappings(
        [page], [m],
        ocr_lines_fn=lines_stub(centred), ocr_text_fn=recording_text,
    )
    x1 = captured.get("box", (None,))[0]
    # Drawn target left = 0.25 * 1000 = 250. The pre-fix bug cropped at 280
    # (0.13 tight + 0.15 offset = 0.28), dropping the leading "P".
    if not check(f"derived crop left lands on the drawn target (250), not inset-shifted (got {x1})",
                 x1 == 250):
        failures += 1
    if not check("full value resolved, leading character intact",
                 res.get("customer_name", {}).get("value") == "PROFILE CONSTRUCTION"):
        failures += 1
    print()
    return failures


def test_locate_anchor_padded_box():
    """An anchor box drawn deliberately WIDER than its label (margin for future
    variability) captures the label plus padding/neighbouring words on the same
    OCR line. Relocation must still succeed there — full-line ratio() used to
    sink below threshold purely because the line was longer — while a genuinely
    different nearby label stays rejected."""
    failures = 0
    print("_locate_anchor: tolerant of a padded anchor box (label + extra on the line)")
    page = FakePage()
    anchor_box = {"x_norm": 0.10, "y_norm": 0.20, "w_norm": 0.30, "h_norm": 0.04}

    # 1. Tight line still locates (baseline contract preserved).
    tight = [{"text": "Invoice Number", "x_norm": 0.1, "y_norm": 0.25, "w_norm": 0.5, "h_norm": 0.5}]
    if not check("text-tight anchor still locates",
                 template_mapper._locate_anchor(page, anchor_box, "Invoice Number", 0.0, lines_stub(tight)) is not None):
        failures += 1

    # 2. Wider box: the label rides on a line with trailing text. Old full-line
    #    ratio() would drop below 0.6 from the extra length; containment locates.
    padded_line = "Invoice Number Issued On 14 March 2026 Reference 998877"
    import difflib as _d
    old_ratio = _d.SequenceMatcher(None, "invoice number", padded_line.lower()).ratio()
    padded = [{"text": padded_line, "x_norm": 0.05, "y_norm": 0.25, "w_norm": 0.9, "h_norm": 0.5}]
    located = template_mapper._locate_anchor(page, anchor_box, "Invoice Number", 0.0, lines_stub(padded))
    if not check(f"padded anchor box still locates the label (old ratio {old_ratio:.2f} < 0.6 would have failed)",
                 located is not None and located.get("matched_text") == padded_line):
        failures += 1

    # 3. A different nearby label in the same region is NOT chosen as the match.
    mixed = [
        {"text": "Bill To Account Holder", "x_norm": 0.05, "y_norm": 0.10, "w_norm": 0.6, "h_norm": 0.3},
        {"text": padded_line,              "x_norm": 0.05, "y_norm": 0.60, "w_norm": 0.9, "h_norm": 0.3},
    ]
    picked = template_mapper._locate_anchor(page, anchor_box, "Invoice Number", 0.0, lines_stub(mixed))
    if not check("the correct padded label is preferred over a different nearby label",
                 picked is not None and picked.get("matched_text") == padded_line):
        failures += 1

    # 4. A region containing ONLY a different label still reports None (fallback).
    wrong_only = [{"text": "Bill To Account Holder", "x_norm": 0.1, "y_norm": 0.1, "w_norm": 0.6, "h_norm": 0.3}]
    if not check("only a different label present -> None (clean fallback)",
                 template_mapper._locate_anchor(page, anchor_box, "Invoice Number", 0.0, lines_stub(wrong_only)) is None):
        failures += 1

    print()
    return failures


def main():
    failures = 0
    failures += test_geometry_helpers()
    failures += test_locate_anchor()
    failures += test_extract_with_mappings()
    failures += test_derived_target_no_leading_inset_clip()
    failures += test_locate_anchor_padded_box()

    if failures:
        print(f"{failures} check(s) failed — template_mapper regressed.")
        return 1
    print("All checks passed — template_mapper anchor/target mapping behaves as expected.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
