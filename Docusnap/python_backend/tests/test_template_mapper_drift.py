#!/usr/bin/env python3
"""
tests/test_template_mapper_drift.py
-----------------------------------
Stage 0.5 DRIFT GUARD: a template mapping must follow a shifted page (e.g. a
mapping taught on a CROPPED scan, then applied to the UNCROPPED reprocess where
every row moves down). Previously the absolute drawn box read a credible-but-WRONG
neighbouring line ("41-43 Somerton Road") and short-circuited relocation; now,
when the anchor LABEL is found displaced, the value is re-derived from the label's
actual position (the drift-invariant stored offset) and "Beaumont Care Homes Ltd -
Lansdowne" is read instead.

OCR is stubbed via the injectable ocr_lines_fn / ocr_text_fn — no Tesseract.
    py -3.12 python_backend/tests/test_template_mapper_drift.py
Exit 0 = behaves. Exit 1 = regression.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import template_mapper  # noqa: E402


def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return bool(cond)


class FakePage:
    def __init__(self, size=(1000, 1000)):
        self.size = size
    def crop(self, box):
        return ("crop", box)


def page_words_stub(words):
    """Crop-aware ocr_lines_fn: returns any PAGE-normalised word fully inside the
    requested crop, in crop-relative coords (mirrors image_to_data over a crop)."""
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


GOLDEN = "Beaumont Care Homes Ltd - Lansdowne"
WRONG  = "41-43 Somerton Road"
SHIFT  = 0.12   # the restored top band pushes every row down by this much


def cust_mapping(**ov):
    """customer (free-text) mapping: value sits ~0.15 right of the 'Location'
    label, level with it. Offset is target-anchor (as saveMapping records it)."""
    m = {"field_key": "customer", "page_number": 0, "anchor_text": "Location",
         "ocr_type": "text", "search_expansion": 0.0, "enabled": True,
         "anchor_x_norm": 0.10, "anchor_y_norm": 0.20, "anchor_w_norm": 0.20, "anchor_h_norm": 0.04,
         "target_x_norm": 0.25, "target_y_norm": 0.20, "target_w_norm": 0.18, "target_h_norm": 0.04,
         "offset_dx_norm": 0.15, "offset_dy_norm": 0.0}
    m.update(ov)
    return m


def _band_text(absolute_val, relocated_val):
    """ocr_text_fn keyed on the crop's vertical centre: the stored (absolute)
    target band ~y0.22 reads absolute_val; the shifted/relocated band (~y0.33)
    reads relocated_val."""
    def stub(crop):
        _, (x1, y1, x2, y2) = crop
        cy = (y1 + y2) / 2.0 / 1000.0
        return absolute_val if cy < 0.27 else relocated_val
    return stub


def test_drift_follows_label_when_anchor_text_present():
    print("drift: shifted page + anchor label -> value tracks the label, not the stale box")
    f = 0
    page = FakePage()
    # 'Location' label drifted DOWN by SHIFT (out of the local search band).
    lines = page_words_stub([{"text": "Location", "x": 0.12, "y": 0.20 + SHIFT, "w": 0.14, "h": 0.02}])
    res = template_mapper.extract_with_mappings(
        [page], [cust_mapping()], {"customer": {}},
        ocr_lines_fn=lines, ocr_text_fn=_band_text(WRONG, GOLDEN))
    val = res.get("customer", {}).get("value")
    f += not check(f"customer tracks the relocated label -> {GOLDEN!r} (got {val!r})", val == GOLDEN)
    f += not check("the stale absolute line is NOT committed", WRONG not in (val or ""))
    print()
    return f


def test_clean_page_uses_absolute_fast_path_unchanged():
    print("clean: undrifted page reads the absolute drawn box at full confidence (fast path intact)")
    f = 0
    page = FakePage()
    # Label at its taught spot (inside the anchor box) -> no drift.
    lines = page_words_stub([{"text": "Location", "x": 0.12, "y": 0.21, "w": 0.14, "h": 0.02}])
    res = template_mapper.extract_with_mappings(
        [page], [cust_mapping()], {"customer": {}},
        ocr_lines_fn=lines, ocr_text_fn=_band_text(GOLDEN, "SHOULD-NOT-REACH"))
    c = res.get("customer", {})
    f += not check("clean page reads the golden value via the absolute box", c.get("value") == GOLDEN)
    f += not check("absolute fast path: method=template_mapping, confidence=90",
                   c.get("method") == "template_mapping" and c.get("confidence") == 90)
    print()
    return f


def test_null_anchor_text_legacy_behaviour_unchanged():
    print("legacy: a NULL-anchor_text mapping on a shifted page still reads the absolute box (unchanged)")
    f = 0
    page = FakePage()
    lines = page_words_stub([{"text": "Location", "x": 0.12, "y": 0.20 + SHIFT, "w": 0.14, "h": 0.02}])
    res = template_mapper.extract_with_mappings(
        [page], [cust_mapping(anchor_text=None)], {"customer": {}},
        ocr_lines_fn=lines, ocr_text_fn=_band_text(WRONG, GOLDEN))
    val = res.get("customer", {}).get("value")
    f += not check(f"null label -> no drift tracking, absolute box wins (got {val!r})", val == WRONG)
    print()
    return f


def test_label_drift_helper_per_axis():
    print("helper: _label_drifted is per-axis and ignores proximity-only locates")
    f = 0
    box = {"x_norm": 0.10, "y_norm": 0.20, "w_norm": 0.20, "h_norm": 0.04}  # centre (0.20,0.22) tol (0.10,0.02)
    within   = {"x_norm": 0.14, "y_norm": 0.21, "w_norm": 0.12, "h_norm": 0.02, "matched_text": "Location"}
    y_far    = {"x_norm": 0.14, "y_norm": 0.29, "w_norm": 0.12, "h_norm": 0.02, "matched_text": "Location"}
    x_far    = {"x_norm": 0.34, "y_norm": 0.21, "w_norm": 0.12, "h_norm": 0.02, "matched_text": "Location"}
    no_match = {"x_norm": 0.14, "y_norm": 0.29, "w_norm": 0.12, "h_norm": 0.02, "matched_text": None}
    f += not check("within tolerance on both axes -> not drifted", template_mapper._label_drifted(box, within) is False)
    f += not check("y displacement beyond tolerance -> drifted", template_mapper._label_drifted(box, y_far) is True)
    f += not check("x displacement beyond tolerance -> drifted", template_mapper._label_drifted(box, x_far) is True)
    f += not check("proximity-only match (matched_text None) -> never drifted", template_mapper._label_drifted(box, no_match) is False)
    f += not check("None located -> not drifted", template_mapper._label_drifted(box, None) is False)
    print()
    return f


def test_drifted_but_relocation_fails_falls_through():
    print("resilience: drift detected but relocated crop reads nothing -> falls through, not None")
    f = 0
    page = FakePage()
    lines = page_words_stub([{"text": "Location", "x": 0.12, "y": 0.20 + SHIFT, "w": 0.14, "h": 0.02}])
    # Absolute band credible; relocated band empty -> _relocate_and_read returns None.
    res = template_mapper.extract_with_mappings(
        [page], [cust_mapping()], {"customer": {}},
        ocr_lines_fn=lines, ocr_text_fn=_band_text(WRONG, None))
    val = res.get("customer", {}).get("value")
    f += not check("field not dropped to None — falls through to the absolute read", "customer" in res and val == WRONG)
    print()
    return f


def test_merged_row_match_not_relocated():
    print("safety: a whole-ROW (cross-column merged) match is refused, not relocated off")
    f = 0
    box = {"x_norm": 0.50, "y_norm": 0.15, "w_norm": 0.09, "h_norm": 0.01}   # tight drawn anchor
    tight = {"x_norm": 0.50, "y_norm": 0.30, "w_norm": 0.12, "h_norm": 0.01, "matched_text": "Work Address"}
    wide  = {"x_norm": 0.05, "y_norm": 0.15, "w_norm": 0.54, "h_norm": 0.01, "matched_text": "Ticket No. 2605-0769-1 ) Work Address Beaumont..."}
    f += not check("a tight located label is NOT flagged too-wide", template_mapper._located_too_wide(box, tight) is False)
    f += not check("a half-page merged-row match IS flagged too-wide", template_mapper._located_too_wide(box, wide) is True)
    # _relocate_and_read must refuse the wide match without even OCR'ing.
    called = {"n": 0}
    def boom(_crop):
        called["n"] += 1
        return "wrong-column garbage"
    m = cust_mapping(anchor_x_norm=0.50, anchor_y_norm=0.15, anchor_w_norm=0.09, anchor_h_norm=0.01)
    out = template_mapper._relocate_and_read(FakePage(), m, box,
            {"x_norm": 0.64, "y_norm": 0.15, "w_norm": 0.30, "h_norm": 0.02},
            wide, None, boom, 0.0, None, None, None, 0, "customer")
    f += not check("relocation refused on a merged-row match (returns None)", out is None)
    f += not check("no OCR attempted on the refused merged-row crop", called["n"] == 0)
    print()
    return f


def test_ocr_debris_rejected_for_free_text():
    print("safety: fragmented OCR debris is rejected for free-text; a real name passes")
    f = 0
    f += not check("debris helper flags 'aan EE ..... 4 4.3 Fs . J... .'",
                   template_mapper._is_ocr_debris("aan EE ..... 4 4.3 Fs . J... .") is True)
    f += not check("debris helper flags a value with the OCR replacement char",
                   template_mapper._is_ocr_debris("Beaumont � Care") is True)
    f += not check("debris helper passes a real company name",
                   template_mapper._is_ocr_debris("Beaumont Care Homes Ltd - Belmont") is False)
    f += not check("debris helper does not judge a short value",
                   template_mapper._is_ocr_debris("41-43 Somerton Road") is False)
    # Through the shared gate (free-text, shape_mode='ignore' = the absolute path).
    g_junk = template_mapper._gate_value("aan EE ..... 4 4.3 Fs . J... .", None, "customer", {}, None, shape_mode='ignore')
    f += not check("gate REJECTS the debris read on the absolute path", g_junk[0] is None)
    g_ok = template_mapper._gate_value("Beaumont Care Homes Ltd - Belmont", None, "customer", {}, None, shape_mode='ignore')
    f += not check("gate KEEPS the real name on the absolute path", g_ok[0] == "Beaumont Care Homes Ltd - Belmont")
    print()
    return f


def test_slice_capture_reports_relocated_target():
    print("overlay: slice_capture reports the RELOCATED target box (what resolve_geometry returns)")
    f = 0
    page = FakePage()
    lines = page_words_stub([{"text": "Location", "x": 0.12, "y": 0.20 + SHIFT, "w": 0.14, "h": 0.02}])
    targets = []
    def cap(_fk, _stage, _pi, bbox, _img, kind):
        if kind == "target" and bbox:
            targets.append(bbox)
    res = template_mapper.extract_with_mappings(
        [page], [cust_mapping()], {"customer": {}},
        ocr_lines_fn=lines, ocr_text_fn=_band_text(WRONG, GOLDEN), slice_capture=cap)
    f += not check("value relocated to the golden line", res.get("customer", {}).get("value") == GOLDEN)
    f += not check("a target crop was captured for the overlay", len(targets) >= 1)
    last_y = targets[-1][1] if targets else None
    f += not check(f"captured target tracks the shift (y~{round(0.20 + SHIFT, 2)}, not the stored 0.20; got {last_y})",
                   last_y is not None and last_y > 0.20 + SHIFT / 2)
    print()
    return f


def main():
    fails = 0
    fails += test_drift_follows_label_when_anchor_text_present()
    fails += test_clean_page_uses_absolute_fast_path_unchanged()
    fails += test_null_anchor_text_legacy_behaviour_unchanged()
    fails += test_label_drift_helper_per_axis()
    fails += test_drifted_but_relocation_fails_falls_through()
    fails += test_merged_row_match_not_relocated()
    fails += test_ocr_debris_rejected_for_free_text()
    fails += test_slice_capture_reports_relocated_target()
    if fails:
        print(f"{fails} check(s) failed — Stage 0.5 drift guard regressed.")
        return 1
    print("All checks passed — Stage 0.5 mapping follows a shifted page via the anchor label.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
