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
    m = base_mapping()
    # Label OCR'd tight-centred inside the anchor crop (crop-relative): left 0.15
    # of width 0.70 -> page-relative tight left 0.10+0.15*0.20=0.13, width 0.14,
    # so per-side inset (0.20-0.14)/2 = 0.03.
    # The label sits at a FIXED page bbox (tight-centred in the anchor box):
    # x=0.13, w=0.14 (per-side inset 0.03), y=0.21. A crop-aware stub reports it
    # relative to whatever search crop it is given, so the assertion holds whether
    # or not the production min_search floor widens that crop.
    def centred_label(crop):
        _, (x1, y1, x2, y2) = crop
        cw, ch = (x2 - x1) / 1000.0, (y2 - y1) / 1000.0
        if cw <= 0 or ch <= 0:
            return []
        cx, cy = x1 / 1000.0, y1 / 1000.0
        px, py, pw, ph = 0.13, 0.21, 0.14, 0.02
        return [{"text": "Invoice Number",
                 "x_norm": (px - cx) / cw, "y_norm": (py - cy) / ch,
                 "w_norm": pw / cw, "h_norm": ph / ch}]
    captured = {}
    def recording_text(crop):
        captured["box"] = crop[1]   # FakePage.crop -> ("crop", (x1,y1,x2,y2))
        return "PROFILE CONSTRUCTION"
    res = template_mapper.extract_with_mappings(
        [page], [m],
        ocr_lines_fn=centred_label, ocr_text_fn=recording_text,
    )
    x1 = captured.get("box", (None,))[0]
    # Drawn target left = 0.25 * 1000 = 250. The pre-fix bug cropped at 280
    # (0.13 tight + 0.15 offset = 0.28), dropping the leading "P".
    if not check(f"derived crop left lands on the drawn target (250), not inset-shifted (got {x1})",
                 x1 == 250):
        failures += 1
    if not check("full value resolved, leading character intact",
                 res.get("invoice_number", {}).get("value") == "PROFILE CONSTRUCTION"):
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


def test_consensus_drift():
    """Pure consensus rule: reliability gate, quorum, median-seed outlier
    rejection, re-quorum, weighted mean, sanity bound. Never a naive average."""
    failures = 0
    print("consensus drift: weighted, outlier-robust landmark agreement")
    cd = template_mapper._consensus_drift

    # Landmarks are (dx, dy, weight, x, y). Distinct (x,y) zones below, so the
    # zone-fair step is neutral (one landmark per zone) and these assert the
    # unchanged gate/median/outlier/sanity behaviour.
    # Two agreeing landmarks -> weighted mean.
    c = cd([(0.050, 0.020, 0.9, 0.1, 0.1), (0.052, 0.018, 0.8, 0.9, 0.9)])
    if not check("two agreeing distinct-zone landmarks -> weighted-mean drift",
                 c is not None and abs(c[0] - 0.0510) < 2e-3 and abs(c[1] - 0.0191) < 2e-3):
        failures += 1

    # An obvious outlier is rejected, not averaged in.
    c2 = cd([(0.050, 0.020, 0.9, 0.1, 0.1), (0.052, 0.018, 0.9, 0.9, 0.9), (0.40, 0.40, 0.95, 0.5, 0.5)])
    if not check("outlier landmark rejected (drift stays near the agreeing two)",
                 c2 is not None and c2[0] < 0.10 and abs(c2[0] - 0.051) < 5e-3):
        failures += 1

    # Fewer than two RELIABLE landmarks -> None.
    if not check("single reliable landmark -> None (quorum)", cd([(0.05, 0.02, 0.9, 0.1, 0.1)]) is None):
        failures += 1
    if not check("all weights below gate -> None (reliability)",
                 cd([(0.05, 0.02, 0.5, 0.1, 0.1), (0.05, 0.02, 0.6, 0.9, 0.9)]) is None):
        failures += 1

    # Two landmarks that DISAGREE -> rejected, None (no naive midpoint).
    if not check("two disagreeing landmarks -> None (no naive average)",
                 cd([(0.05, 0.02, 0.9, 0.1, 0.1), (0.40, 0.40, 0.9, 0.9, 0.9)]) is None):
        failures += 1

    # Agreeing but implausibly large -> ignored by the sanity bound.
    if not check("agreeing-but-implausible drift -> None (sanity bound)",
                 cd([(0.50, 0.50, 0.9, 0.1, 0.1), (0.51, 0.49, 0.9, 0.9, 0.9)]) is None):
        failures += 1

    print()
    return failures


def test_drift_fallback():
    """End-to-end via extract_with_mappings: a consensus drift from >=2 agreeing
    anchors pre-shifts a field whose OWN anchor failed; a field whose own anchor
    succeeds ignores the consensus; no consensus -> field omitted (unchanged)."""
    failures = 0
    print("drift fallback: consensus pre-shift only when local relocation fails")
    page = FakePage()
    const_text = lambda _crop: "VAL"

    def m(field, anchor_text, **ov):
        d = {"field_key": field, "page_number": 0, "enabled": True,
             "anchor_text": anchor_text, "search_expansion": 0.0,
             "anchor_x_norm": 0.10, "anchor_y_norm": 0.20,
             "anchor_w_norm": 0.20, "anchor_h_norm": 0.04,
             "target_x_norm": 0.25, "target_y_norm": 0.20,
             "target_w_norm": 0.15, "target_h_norm": 0.04,
             "offset_dx_norm": 0.15, "offset_dy_norm": 0.0}
        d.update(ov)
        return d

    # Two landmark anchors locate "Invoice Number" (agree -> consensus); a third
    # field's anchor "Bill To" is NOT present, so its local relocation fails.
    lines = lines_stub([{"text": "Invoice Number", "x_norm": 0.6, "y_norm": 0.25,
                         "w_norm": 0.3, "h_norm": 0.5}])
    res = template_mapper.extract_with_mappings(
        [page],
        [m("ref_a", "Invoice Number"), m("ref_b", "Invoice Number"),
         m("customer", "Bill To", target_x_norm=0.55)],
        {"customer": {"validation": "text"}},
        ocr_lines_fn=lines, ocr_text_fn=const_text,
    )
    if not check("field whose own anchor failed is recovered via consensus pre-shift",
                 res.get("customer", {}).get("value") == "VAL"
                 and res["customer"]["method"] == "template_mapping_drift"):
        failures += 1
    if not check("drift-fallback confidence is weaker than a located anchor (<78)",
                 res.get("customer", {}).get("confidence", 999) < 78):
        failures += 1
    if not check("a field whose own anchor located uses the local path (not drift)",
                 res.get("ref_a", {}).get("method") == "template_mapping"):
        failures += 1

    # No consensus (single failing anchor) -> field omitted; drift never applied.
    res2 = template_mapper.extract_with_mappings(
        [page], [m("customer", "Bill To")],
        {"customer": {"validation": "text"}},
        ocr_lines_fn=lines, ocr_text_fn=const_text,
    )
    if not check("no consensus -> field omitted (today's behaviour unchanged)",
                 "customer" not in res2):
        failures += 1

    print()
    return failures


def test_anchor_search_floor():
    """A tight/misaligned drawn anchor box whose label sits just outside it
    relocates only once the min_search FLOOR widens the search region; the
    default min_search=0.0 leaves the search (and all existing callers) unchanged."""
    failures = 0
    print("anchor search floor: widen the search so a just-outside label is found")
    page = FakePage((1000, 1000))
    tiny = {"x_norm": 0.40, "y_norm": 0.40, "w_norm": 0.04, "h_norm": 0.02}

    # Stub returns the label ONLY when the search crop is wide (floor applied):
    # the tight box (~40px wide) yields nothing; the floored box (~160px) yields it.
    def floor_aware(crop):
        _, (x1, _, x2, _) = crop
        if (x2 - x1) > 100:
            return [{"text": "Work Address", "x_norm": 0.5, "y_norm": 0.5, "w_norm": 0.3, "h_norm": 0.3}]
        return []

    without = template_mapper._locate_anchor(page, tiny, "Work Address", 0.0, floor_aware, min_search=0.0)
    if not check("tight box + no floor -> label outside box, not located", without is None):
        failures += 1
    withfloor = template_mapper._locate_anchor(page, tiny, "Work Address", 0.0, floor_aware, min_search=0.06)
    if not check("same box + search floor -> label now found",
                 withfloor is not None and withfloor.get("matched_text") == "Work Address"):
        failures += 1
    default = template_mapper._locate_anchor(page, tiny, "Work Address", 0.0, floor_aware)
    if not check("default min_search=0.0 -> unchanged tight behaviour", default is None):
        failures += 1
    print()
    return failures


def test_consensus_drift_spatial():
    """Zone-fair aggregation (final step only): a tight CLUSTER of landmarks does
    not dominate a distinct-zone landmark, and distinct-zone landmarks reproduce
    the plain weighted mean (no regression). All deltas agree within the
    (unchanged) outlier tolerance so the comparison is purely about weighting."""
    failures = 0
    print("consensus drift: spatial-diversity (zone-fair) aggregation")
    cd = template_mapper._consensus_drift

    # 3 landmarks clustered in one top-left zone at delta 0.020, plus ONE
    # distinct-zone landmark at 0.035 (within outlier tol of the 0.020 median).
    # Naive weighted mean = (0.020*3 + 0.035)/4 = 0.02375 (cluster dominates).
    # Zone-fair: cluster -> one vote (0.020), spread -> one vote (0.035) -> 0.0275.
    cluster_spread = [
        (0.020, 0.0, 0.9, 0.05, 0.05), (0.020, 0.0, 0.9, 0.08, 0.06),
        (0.020, 0.0, 0.9, 0.10, 0.04), (0.035, 0.0, 0.9, 0.90, 0.90),
    ]
    cs = cd(cluster_spread)
    if not check("cluster does NOT dominate: zone-fair ~0.0275 (> naive 0.02375)",
                 cs is not None and abs(cs[0] - 0.0275) < 1e-3 and cs[0] > 0.025):
        failures += 1

    # Distinct zones, one landmark each -> identical to the plain weighted mean.
    distinct = [(0.020, 0.0, 0.9, 0.1, 0.1), (0.025, 0.0, 0.9, 0.5, 0.1),
                (0.030, 0.0, 0.9, 0.9, 0.1)]
    dz = cd(distinct)
    if not check("distinct-zone landmarks -> plain mean 0.025 (no regression)",
                 dz is not None and abs(dz[0] - 0.025) < 1e-3):
        failures += 1

    # A noisy local cluster biased high (0.030 x3) vs a cleaner spread point at
    # the true 0.010: naive = (0.030*3+0.010)/4 = 0.025; zone-fair pulls to 0.020.
    noisy = [
        (0.030, 0.0, 0.9, 0.05, 0.05), (0.030, 0.0, 0.9, 0.08, 0.06),
        (0.030, 0.0, 0.9, 0.10, 0.04), (0.010, 0.0, 0.9, 0.90, 0.90),
    ]
    nz = cd(noisy)
    if not check("noisy cluster down-weighted: zone-fair ~0.020 (< naive 0.025)",
                 nz is not None and abs(nz[0] - 0.020) < 1e-3 and nz[0] < 0.025):
        failures += 1

    print()
    return failures


def test_geometry_seeded_fallback():
    """Stage-1 geometry prior: when local relocation has failed AND the absolute
    drift-shifted seed reads nothing, the fallback re-seeds the target from the
    page-geometry landmark nearest the taught anchor (landmark + stored offset +
    consensus drift) and can recover the value. It is purely ADDITIVE — a
    successful absolute seed is returned unchanged and the geometry branch is
    never reached, so existing drift-fallback behaviour cannot regress."""
    failures = 0
    print("geometry-seeded drift fallback: landmark + offset + drift recovers a shifted target")
    from extraction import page_geometry
    page = FakePage((1000, 1000))

    # Customer mapping: taught anchor at (0.10,0.20), stored offset +0.15 right, so
    # the ABSOLUTE target sits at (0.25,0.20). Its own anchor ("Bill To") is absent
    # on this page (local relocation fails), so _extract_one routes to _drift_fallback.
    mapping = {"field_key": "customer", "page_number": 0, "enabled": True,
               "anchor_text": "Bill To", "search_expansion": 0.0,
               "anchor_x_norm": 0.10, "anchor_y_norm": 0.20,
               "anchor_w_norm": 0.20, "anchor_h_norm": 0.04,
               "target_x_norm": 0.25, "target_y_norm": 0.20,
               "target_w_norm": 0.15, "target_h_norm": 0.04,
               "offset_dx_norm": 0.15, "offset_dy_norm": 0.0}
    target_box = template_mapper._norm_box(mapping, "target")
    fps   = {"customer": {"validation": "text"}}
    drift = (0.02, 0.0)

    # Nearest landmark to the taught anchor (0.10,0.20) is the centred-75% corner.
    (lx, ly), _ = page_geometry.nearest_landmark(0.10, 0.20)
    if not check(f"landmark nearest the anchor is the 75% box corner (got {lx},{ly})",
                 abs(lx - 0.125) < 1e-9 and abs(ly - 0.125) < 1e-9):
        failures += 1
    abs_x1 = int((target_box["x_norm"] + drift[0]) * 1000)        # 270 — absolute seed
    geo_x1 = int((lx + 0.15 + drift[0]) * 1000)                   # 295 — landmark seed
    if not check(f"absolute and geometry seeds land on different crops ({abs_x1} vs {geo_x1})",
                 abs_x1 != geo_x1):
        failures += 1

    # Stub: the value lives only at the LANDMARK-seeded crop; the absolute drift
    # crop reads nothing -> raw-absolute seeding MISSES, geometry recovers.
    def value_at_landmark(crop):
        _, (x1, _y1, _x2, _y2) = crop
        return "AcmeLtd" if x1 == geo_x1 else None
    out = template_mapper._drift_fallback(page, mapping, target_box, 0.0, drift,
                                          fps, value_at_landmark)
    if not check("geometry-seeded fallback recovers a value raw-absolute seeding missed",
                 out is not None and out.get("value") == "AcmeLtd"):
        failures += 1
    if not check("recovered value keeps the UNCHANGED drift method + confidence (60)",
                 out and out.get("method") == "template_mapping_drift" and out.get("confidence") == 60):
        failures += 1

    # Additive guarantee: when the ABSOLUTE seed reads a value, that value is
    # returned and the geometry branch is never reached (stub raises if it runs).
    def absolute_hits(crop):
        _, (x1, _y1, _x2, _y2) = crop
        if x1 == geo_x1:
            raise AssertionError("geometry branch must not run when the absolute seed hit")
        return "ABS" if x1 == abs_x1 else None
    out2 = template_mapper._drift_fallback(page, mapping, target_box, 0.0, drift,
                                           fps, absolute_hits)
    if not check("successful absolute seed returned unchanged (geometry not reached)",
                 out2 is not None and out2.get("value") == "ABS"):
        failures += 1

    # No consensus drift -> None; the geometry prior never fires without drift.
    if not check("no drift -> None (geometry prior never fires without consensus)",
                 template_mapper._drift_fallback(page, mapping, target_box, 0.0, None,
                                                 fps, value_at_landmark) is None):
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
    failures += test_consensus_drift()
    failures += test_drift_fallback()
    failures += test_anchor_search_floor()
    failures += test_consensus_drift_spatial()
    failures += test_geometry_seeded_fallback()

    if failures:
        print(f"{failures} check(s) failed — template_mapper regressed.")
        return 1
    print("All checks passed — template_mapper anchor/target mapping behaves as expected.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
