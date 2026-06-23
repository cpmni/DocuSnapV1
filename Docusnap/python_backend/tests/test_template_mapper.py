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
from extraction import format_anomaly_checker  # noqa: E402


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


# Real date validation patterns (mirrors config/keyword_patterns.json
# validation_patterns.date) — the SAME strict patterns _crop_is_credible trusts.
DATE_PATTERNS = {
    "date": [
        r"\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}",
        r"\d{4}[/\-]\d{2}[/\-]\d{2}",
        r"\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4}",
        r"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{2,4}",
    ]
}


def page_words_stub(words):
    """Crop-aware `ocr_lines_fn`: `words` are placed in PAGE-normalised coords on a
    1000x1000 FakePage; the stub returns any word fully inside the requested crop,
    reported in crop-relative coords (mirrors real image_to_data over a crop)."""
    def stub(crop):
        _, (x1, y1, x2, y2) = crop
        cw, ch = (x2 - x1) / 1000.0, (y2 - y1) / 1000.0
        if cw <= 0 or ch <= 0:
            return []
        cx, cy = x1 / 1000.0, y1 / 1000.0
        out = []
        for w in words:
            if (w["x"] >= cx - 1e-9 and w["y"] >= cy - 1e-9
                    and w["x"] + w["w"] <= cx + cw + 1e-9
                    and w["y"] + w["h"] <= cy + ch + 1e-9):
                out.append({"text": w["text"],
                            "x_norm": (w["x"] - cx) / cw, "y_norm": (w["y"] - cy) / ch,
                            "w_norm": w["w"] / cw, "h_norm": w["h"] / ch})
        return out
    return stub


def value_at_stub(value, vx, vy, vw, vh):
    """Region-aware `ocr_text_fn`: returns `value` only when the requested crop
    covers the value's centre (PAGE-normalised), else None."""
    mx, my = vx + vw / 2.0, vy + vh / 2.0
    def stub(crop):
        _, (x1, y1, x2, y2) = crop
        return value if (x1 / 1000.0 <= mx <= x2 / 1000.0
                         and y1 / 1000.0 <= my <= y2 / 1000.0) else None
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

    # Absolute drawn box reads nothing credible AND the anchor can't be located
    # anywhere -> field omitted entirely (no consensus drift on a single mapping),
    # so engine.py's merge leaves whatever keyword/anchor stages already produced
    # untouched (the documented "fall back to current behaviour" contract).
    no_match = template_mapper.extract_with_mappings(
        [page], [base_mapping()], field_patterns,
        ocr_lines_fn=lines_stub([{"text": "Unrelated", "x_norm": 0, "y_norm": 0, "w_norm": 1, "h_norm": 1}]),
        ocr_text_fn=lambda _crop: None,
    )
    if not check("absolute box empty + anchor not located -> field omitted",
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
    """Relocation + inset regression (now reached only AFTER the absolute fast
    path fails). On a DRIFTED page the drawn box reads nothing, so extraction
    relocates the label and derives the value crop from where it landed. The
    box-based offset must be applied to the located anchor's BOX origin, not its
    tight OCR bbox — otherwise the derived target shifts right/down by the drawn
    margin and clips leading glyphs ("PROFILE" -> "ROFILE")."""
    failures = 0
    print("derived target: drift relocation derives an inset-corrected crop")
    page = FakePage((1000, 1000))
    # base_mapping: anchor box x=0.10 w=0.20; target box x=0.25 w=0.15; dx=0.15.
    m = base_mapping()
    # The label has DRIFTED to page x=0.43 (tight width 0.14, per-side inset 0.03).
    # Inset-corrected derived target = 0.43 - 0.03 + 0.15 = 0.55 -> x1 550.
    # The pre-fix bug would crop at 0.43 + 0.15 = 0.58 -> x1 580, clipping "P".
    def drifted_label(crop):
        _, (x1, y1, x2, y2) = crop
        cw, ch = (x2 - x1) / 1000.0, (y2 - y1) / 1000.0
        if cw <= 0 or ch <= 0:
            return []
        cx, cy = x1 / 1000.0, y1 / 1000.0
        px, py, pw, ph = 0.43, 0.21, 0.14, 0.02
        return [{"text": "Invoice Number",
                 "x_norm": (px - cx) / cw, "y_norm": (py - cy) / ch,
                 "w_norm": pw / cw, "h_norm": ph / ch}]
    captured = {}
    def recording_text(crop):
        x1 = crop[1][0]
        if x1 == 250:            # the ABSOLUTE drawn box -> empty, force relocation
            return None
        captured["box"] = crop[1]
        return "PROFILE-CONSTRUCTION"
    res = template_mapper.extract_with_mappings(
        [page], [m], {"invoice_number": {"validation": "alphanumeric"}},
        ocr_lines_fn=drifted_label, ocr_text_fn=recording_text,
        validation_patterns={"alphanumeric": [r"[A-Za-z0-9][A-Za-z0-9\-\/\.]{2,20}"]},
    )
    x1 = captured.get("box", (None,))[0]
    if not check(f"relocated derived crop left lands inset-corrected (550), not shifted (got {x1})",
                 x1 == 550):
        failures += 1
    if not check("full value resolved via relocation, leading character intact",
                 res.get("invoice_number", {}).get("value") == "PROFILE-CONSTRUCTION"):
        failures += 1
    print()
    return failures


def test_absolute_target_first():
    """Fix: Stage 0.5 reads the EXACT drawn target box FIRST (matching the live
    'targeted selection' the operator sees), and only relocates if that read fails
    the gates. On a clean page the absolute box wins and the anchor is never even
    located — the regression for "why doesn't it read it right the first time"."""
    failures = 0
    print("absolute target fast path: read the drawn box first, skip relocation when clean")
    page = FakePage((1000, 1000))
    m = base_mapping()   # target x=0.25 -> x1 250; derived (if reached) differs
    fps = {"invoice_number": {"validation": "alphanumeric"}}
    vps = {"alphanumeric": [r"[A-Za-z0-9][A-Za-z0-9\-\/\.]{2,20}"]}

    # Absolute box (x1 250) reads the right value; any other crop would read WRONG.
    def region_text(crop):
        return "INV-2026-001" if crop[1][0] == 250 else "WRONG"
    # Locating the anchor must NOT happen — the absolute read short-circuits it.
    def boom_lines(_crop):
        raise AssertionError("anchor relocation must not run when the drawn box reads cleanly")

    out = template_mapper._extract_one(
        page, m, fps, boom_lines, region_text,
        located=template_mapper._UNSET, validation_patterns=vps)
    if not check("clean page: absolute drawn box read, value correct",
                 out is not None and out.get("value") == "INV-2026-001"):
        failures += 1
    if not check("absolute read reports method=template_mapping at full confidence (90)",
                 out and out.get("method") == "template_mapping" and out.get("confidence") == 90):
        failures += 1

    # Absolute box empty -> the gate fails -> relocation DOES run (anchor located
    # at its taught spot here, so the derived crop also lands on x1 250).
    located_calls = {"n": 0}
    def counting_lines(crop):
        located_calls["n"] += 1
        _, (x1, y1, x2, y2) = crop
        cw, ch = (x2 - x1) / 1000.0, (y2 - y1) / 1000.0
        if cw <= 0 or ch <= 0:
            return []
        cx, cy = x1 / 1000.0, y1 / 1000.0
        px, py, pw, ph = 0.13, 0.21, 0.14, 0.02   # taught spot, no drift
        return [{"text": "Invoice Number",
                 "x_norm": (px - cx) / cw, "y_norm": (py - cy) / ch,
                 "w_norm": pw / cw, "h_norm": ph / ch}]
    reads = {"n": 0}
    def empty_then_value(crop):
        reads["n"] += 1
        return None if reads["n"] == 1 else "INV-2026-001"   # 1st = absolute (empty)
    out2 = template_mapper._extract_one(
        page, m, fps, counting_lines, empty_then_value,
        located=template_mapper._UNSET, validation_patterns=vps)
    if not check("absolute read empty -> relocation runs and recovers the value",
                 out2 is not None and out2.get("value") == "INV-2026-001"
                 and located_calls["n"] > 0):
        failures += 1

    print()
    return failures


def test_gate_value_shared():
    """The shared _gate_value helper used by all three crop paths: clean value
    passes (not salvaged), a typed value failing its pattern is rejected, and a
    junk-wrapped date is salvaged+normalised (Fix C1) — one gate, one behaviour."""
    failures = 0
    print("_gate_value: shared credibility / date-salvage / format gate")
    vps = {"date": DATE_PATTERNS["date"],
           "alphanumeric": [r"[A-Za-z0-9][A-Za-z0-9\-\/\.]{2,20}"]}
    # _gate_value now returns a 3-tuple (value, salvaged, shape_warn); shape_warn
    # is only ever True under shape_mode='flag' with a learned format present (None
    # lookup here → always False), so these regex/type-only cases are unaffected.
    g = lambda text, vt: template_mapper._gate_value(text, vt, "k", vps, None)

    if not check("clean alphanumeric passes unchanged, not salvaged",
                 g("INV-001", "alphanumeric") == ("INV-001", False, False)):
        failures += 1
    if not check("non-date text rejected for a date field",
                 g("Booking", "date") == (None, False, False)):
        failures += 1
    if not check("spaced date salvaged + normalised, salvaged flag set",
                 g("27 -05- 2026", "date") == ("27-05-2026", True, False)):
        failures += 1
    if not check("empty text rejected", g(None, "date") == (None, False, False)):
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
def test_date_salvage_fallback():
    """Stage 0.5 date salvage (Fix C1): a date crop that FAILS the strict
    credibility gate — because OCR put whitespace around its separators or wrapped
    it in junk — is rescued and normalised via validator.salvage_date instead of
    being dropped (the observed worksheet "Date: Not found"). A crop that already
    passes the gate is left untouched and keeps its full confidence, and a crop
    with no date at all is still omitted. Reuses the validator, so this generalises
    to every template's date field — not the worksheet layout in particular."""
    failures = 0
    print("date salvage fallback: rescue gate-failing dates, leave clean ones alone")
    page = FakePage()
    fps  = {"date": {"validation": "date"}}
    # "Ticket Logged" relocates so _extract_one takes the LOCATED path.
    label = lines_stub([{"text": "Ticket Logged", "x_norm": 0.4, "y_norm": 0.25,
                         "w_norm": 0.3, "h_norm": 0.5}])

    def run(ocr_value):
        return template_mapper.extract_with_mappings(
            [page], [base_mapping(field_key="date", anchor_text="Ticket Logged")],
            fps, ocr_lines_fn=label, ocr_text_fn=text_queue_stub([ocr_value]),
            validation_patterns=DATE_PATTERNS,
        )

    # 1. Clean date passes the gate untouched: full confidence, no salvage tag.
    clean = run("27-05-2026").get("date", {})
    if not check("clean date passes the gate unchanged (method=template_mapping)",
                 clean.get("value") == "27-05-2026" and clean.get("method") == "template_mapping"):
        failures += 1
    if not check("clean date keeps full located confidence (90, NOT salvage-capped)",
                 clean.get("confidence") == 90):
        failures += 1

    # 2. OCR spacing around the separators fails the gate -> salvaged + normalised.
    spaced = run("27 -05- 2026").get("date", {})
    if not check("spaced-separator date salvaged to DD-MM-YYYY",
                 spaced.get("value") == "27-05-2026"):
        failures += 1
    if not check("salvaged date is tagged template_mapping_salvaged",
                 spaced.get("method") == "template_mapping_salvaged"):
        failures += 1
    if not check("salvaged date confidence capped at 70 (weaker than a clean crop)",
                 spaced.get("confidence") == 70):
        failures += 1

    # 3. A date wrapped in surrounding junk (with spacing) is recovered too.
    junk = run("Logged 16 / 03 / 2026").get("date", {})
    if not check("date embedded in junk text is salvaged to DD-MM-YYYY",
                 junk.get("value") == "16-03-2026" and junk.get("method") == "template_mapping_salvaged"):
        failures += 1

    # 4. No date present -> salvage returns nothing -> field omitted (unchanged).
    if not check("non-date crop ('Booking') is still omitted, never fabricated",
                 "date" not in run("Booking")):
        failures += 1

    print()
    return failures


def test_clean_crop_segment_shape_aware():
    """Shared crop-segment cleaning (Fix B1): the free-text postcode/year trim is
    now SHAPE-AWARE — it only fires when >=2 alphabetic words precede the digit
    run, so a genuine name/address with its own number is no longer amputated to a
    fragment (the worksheet `name` failures). Column-gap split, city-comma cut and
    non-text digit preservation are unchanged. Exercises template_mapper._clean_value
    (which delegates to anchor.clean_crop_segment), proving both crop paths share
    one rule."""
    failures = 0
    print("clean_crop_segment: shape-aware free-text trim (no value amputation)")
    cv = template_mapper._clean_value

    # Postcode boundary WITH >=2 leading alpha words -> trimmed (existing good case).
    if not check("'Ann Blume 10115 Berlin' (text) -> 'Ann Blume' (postcode trimmed)",
                 cv("Ann Blume 10115 Berlin", "text") == "Ann Blume"):
        failures += 1
    # Value's OWN number (only 1 leading alpha word) -> kept whole (the B1 fix:
    # previously the blanket \\s+\\d{4,} split amputated this to "Unit 4").
    if not check("'Unit 4 1024 Park' (text) -> kept whole (not amputated)",
                 cv("Unit 4 1024 Park", "text") == "Unit 4 1024 Park"):
        failures += 1
    if not check("'Site 4012' (text) -> kept whole (single alpha word before digits)",
                 cv("Site 4012", "text") == "Site 4012"):
        failures += 1
    # Clean name with no digit run -> unchanged.
    if not check("'Beaumont Care Homes Ltd - Galgorm' (text) -> unchanged",
                 cv("Beaumont Care Homes Ltd - Galgorm", "text") == "Beaumont Care Homes Ltd - Galgorm"):
        failures += 1
    # A lone 4-digit value (no preceding word) is never trimmed to empty.
    if not check("'2026' (text) -> kept (never amputated to empty)",
                 cv("2026", "text") == "2026"):
        failures += 1
    # Non-text fields keep their digits (the column-gap split still applies).
    if not check("'INV 12345' (alphanumeric) -> digits preserved",
                 cv("INV 12345", "alphanumeric") == "INV 12345"):
        failures += 1
    # Column gap (4+ spaces) splits for every type.
    if not check("'Acme Ltd    99887' -> 'Acme Ltd' (column-gap split)",
                 cv("Acme Ltd    99887", "text") == "Acme Ltd"):
        failures += 1
    # City-comma cut after 2+ words is preserved.
    if not check("'John Smith, Belfast, BT1' -> 'John Smith' (city-comma cut)",
                 cv("John Smith, Belfast, BT1", "text") == "John Smith"):
        failures += 1

    print()
    return failures


def test_registration_rung():
    """P4 end-to-end: with taught landmarks + registration_enabled, a SHIFTED page
    (where the drawn target box no longer covers the value) is registered via the
    landmark transform and the value is read at the mapped box. Registration is now
    the FALLBACK rung — the field's own anchor+offset link takes precedence when its
    label is findable — so this test isolates registration by giving the mapping a
    label NOT present on the page (anchor+offset cannot fire). With registration off,
    the transform rung never fires."""
    failures = 0
    print("registration rung: taught landmarks register a shifted page and read the value")
    page = FakePage((1000, 1000))
    SHIFT = (0.10, 0.05)
    taught_lms = [
        {"label_text": "ALPHA", "x_norm": 0.10, "y_norm": 0.10, "w_norm": 0.08, "h_norm": 0.03, "page_number": 0},
        {"label_text": "BETA",  "x_norm": 0.70, "y_norm": 0.15, "w_norm": 0.08, "h_norm": 0.03, "page_number": 0},
        {"label_text": "GAMMA", "x_norm": 0.40, "y_norm": 0.60, "w_norm": 0.08, "h_norm": 0.03, "page_number": 0},
    ]
    # On the incoming scan every landmark (and the value) has shifted by SHIFT.
    run_words = [{"text": l["label_text"],
                  "x": l["x_norm"] + SHIFT[0], "y": l["y_norm"] + SHIFT[1],
                  "w": l["w_norm"], "h": l["h_norm"]} for l in taught_lms]
    lines = page_words_stub(run_words)
    text_fn = value_at_stub("INV-REG-001", 0.30 + SHIFT[0], 0.30 + SHIFT[1], 0.12, 0.04)
    mapping = {
        "field_key": "invoice_number", "page_number": 0, "enabled": True,
        # A label NOT present on the page, so the field's own anchor+offset link
        # cannot fire — isolating the registration FALLBACK rung this test targets.
        "anchor_text": "INVOICELABEL", "search_expansion": 0.0,
        "anchor_x_norm": 0.10, "anchor_y_norm": 0.10, "anchor_w_norm": 0.08, "anchor_h_norm": 0.03,
        "target_x_norm": 0.30, "target_y_norm": 0.30, "target_w_norm": 0.12, "target_h_norm": 0.04,
        "offset_dx_norm": 0.20, "offset_dy_norm": 0.20,
    }
    fps = {"invoice_number": {"validation": "alphanumeric"}}
    vps = {"alphanumeric": [r"[A-Za-z0-9][A-Za-z0-9\-\/\.]{2,20}"]}

    res = template_mapper.extract_with_mappings(
        [page], [mapping], fps, ocr_lines_fn=lines, ocr_text_fn=text_fn,
        validation_patterns=vps, template_landmarks=taught_lms, registration_enabled=True)
    got = res.get("invoice_number", {})
    if not check("shifted-page value recovered via registration",
                 got.get("value") == "INV-REG-001"):
        failures += 1
    if not check(f"resolved by the registration rung (got method={got.get('method')})",
                 (got.get("method") or "").startswith("template_registration")):
        failures += 1
    if not check(f"registration confidence is meaningful (got {got.get('confidence')})",
                 isinstance(got.get("confidence"), int) and got.get("confidence") >= 55):
        failures += 1

    # Control: registration OFF -> the transform rung must NOT be the resolver.
    res_off = template_mapper.extract_with_mappings(
        [page], [mapping], fps, ocr_lines_fn=lines, ocr_text_fn=text_fn,
        validation_patterns=vps, template_landmarks=taught_lms, registration_enabled=False)
    if not check("registration OFF -> not resolved via template_registration",
                 not (res_off.get("invoice_number", {}).get("method") or "").startswith("template_registration")):
        failures += 1
    print()
    return failures


def _invoice_shape_lookup():
    """A learned-format lookup for invoice_number shaped AAA-##-#### (from confirmed
    history). Used to prove a type-valid but off-shape manual value's handling."""
    idx = format_anomaly_checker.build_format_class_index([{
        "supplier_name": "", "document_type": "invoice", "field_key": "invoice_number",
        "sample_values": ["HLC-26-0309", "HLC-25-0211", "HLC-24-0190", "HLC-23-0050"],
    }])
    entry = idx.get(("", "invoice", "invoice_number"))
    return (lambda fk: entry if fk == "invoice_number" else None), entry


def test_gate_value_shape_modes():
    """Part A core: _gate_value's shape_mode governs how a LEARNED-SHAPE mismatch is
    handled — 'ignore' (absolute manual read) keeps a type-valid value with no warn;
    'flag' (derived rungs) keeps it but signals shape_warn for review; 'drop' (legacy)
    rejects it. Regex/type failure is rejected in EVERY mode."""
    failures = 0
    print("_gate_value: shape_mode = manual-vs-derived learned-shape severity")
    vps = {"alphanumeric": [r"[A-Za-z0-9][A-Za-z0-9\-\/\.]{2,20}"]}
    lookup, entry = _invoice_shape_lookup()

    if not check("precondition: off-shape value really fails the learned shape",
                 entry is not None
                 and template_mapper._format_rejects("GB374998618", "invoice_number", lookup)):
        failures += 1

    g = lambda v, mode: template_mapper._gate_value(
        v, "alphanumeric", "invoice_number", vps, lookup, shape_mode=mode)

    if not check("ignore: off-shape but type-valid value kept, no shape_warn",
                 g("GB374998618", "ignore") == ("GB374998618", False, False)):
        failures += 1
    if not check("flag: off-shape value kept WITH shape_warn (review, not drop)",
                 g("GB374998618", "flag") == ("GB374998618", False, True)):
        failures += 1
    if not check("drop (legacy): off-shape value rejected",
                 g("GB374998618", "drop") == (None, False, False)):
        failures += 1
    if not check("ignore: a value failing the field REGEX/TYPE is still rejected",
                 g("!", "ignore") == (None, False, False)):
        failures += 1
    print()
    return failures


def test_manual_anchor_shape_precedence():
    """Part A end-to-end: the ABSOLUTE drawn-box read of a manual mapping WINS on the
    field's regex/type even when the value differs from the learned shape (the
    operator's explicit override of history) — the exact bug where a type-valid
    manual value was silently dropped and the wrong auto value won. A value that
    fails the field's regex/type is still dropped (falls through)."""
    failures = 0
    print("extract_with_mappings: manual anchor qualified on regex/type, not learned shape")
    page = FakePage()
    field_patterns = {"invoice_number": {"validation": "alphanumeric"}}
    vps = {"alphanumeric": [r"[A-Za-z0-9][A-Za-z0-9\-\/\.]{2,20}"]}
    lookup, _ = _invoice_shape_lookup()

    res = template_mapper.extract_with_mappings(
        [page], [base_mapping()], field_patterns,
        ocr_lines_fn=lines_stub([]),
        ocr_text_fn=value_at_stub("GB374998618", 0.25, 0.20, 0.15, 0.04),
        validation_patterns=vps, format_lookup=lookup)
    got = res.get("invoice_number")
    if not check("absolute manual read WINS on regex/type despite shape mismatch",
                 got is not None and got["value"] == "GB374998618"
                 and got["method"] == "template_mapping"):
        failures += 1

    res_bad = template_mapper.extract_with_mappings(
        [page], [base_mapping()], field_patterns,
        ocr_lines_fn=lines_stub([]),
        ocr_text_fn=value_at_stub("!", 0.25, 0.20, 0.15, 0.04),
        validation_patterns=vps, format_lookup=lookup)
    if not check("regex/type failure still drops the manual value (falls through)",
                 "invoice_number" not in res_bad):
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
    failures += test_anchor_search_floor()
    failures += test_date_salvage_fallback()
    failures += test_clean_crop_segment_shape_aware()
    failures += test_absolute_target_first()
    failures += test_gate_value_shared()
    failures += test_gate_value_shape_modes()
    failures += test_manual_anchor_shape_precedence()
    failures += test_registration_rung()

    if failures:
        print(f"{failures} check(s) failed — template_mapper regressed.")
        return 1
    print("All checks passed — template_mapper anchor/target mapping behaves as expected.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
