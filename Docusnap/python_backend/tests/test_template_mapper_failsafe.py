#!/usr/bin/env python3
"""
tests/test_template_mapper_failsafe.py
--------------------------------------
Covers the UNIVERSAL extraction-time failsafe + relocation added to
extraction.template_mapper (Stage 0.5):

  1. Manual-anchor precedence (supersedes the old learned-shape "drop" failsafe):
     a learned-SHAPE mismatch ALONE no longer drops a manual mapping — the drawn
     box is trusted, so a type-valid off-shape value (e.g. "Booking" where history
     is a "2603-1351-1" job reference) is KEPT (dropping it silently let the wrong
     auto/keyword value win on reprocess). The real failsafe still in force is the
     field's REGEX/TYPE: a value that fails it (e.g. "Booking" for a DATE field) is
     rejected even for a manual mapping. (The learned-shape check now only FLAGS, not
     drops, on the DERIVED relocation/registration rungs — see test_template_mapper.py
     test_gate_value_shape_modes / test_template_mapper_drift.)
  2. A value that matches the learned shape is committed normally.
  3. CONSERVATIVE / universal: with no learned format (new template/field, thin
     history) nothing is rejected — the value passes through. So the failsafe
     only bites once the field has genuinely learned its shape, and helps ANY
     future document/field without per-field config.
  4. Page-wide relocation — when the label sits outside the drawn box ± local
     margin (a cropped/shifted scan), the whole-page search still finds it and
     the value is derived from the label's ACTUAL position.
  5. Nearest-match tie-break — when the label repeats on the page, the instance
     nearest the original anchor position is chosen, not a far duplicate.

OCR is injected via the same `ocr_lines_fn`/`ocr_text_fn` stubs the sibling
test_template_mapper.py uses — no Tesseract needed.

Usage: py -3.12 python_backend/tests/test_template_mapper_failsafe.py
Exit 0 = behaves correctly, 1 = regression.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import template_mapper                       # noqa: E402
from extraction.format_anomaly_checker import classify_format  # noqa: E402


def check(label, condition):
    print(f"  {'OK ' if condition else 'BAD'} {label}")
    return condition


class FakePage:
    def __init__(self, size=(1000, 1000)):
        self.size = size

    def crop(self, box):
        return ("crop", box)


def text_queue_stub(values):
    queue = list(values)

    def stub(crop):
        return queue.pop(0) if queue else None
    return stub


def ref_mapping(**overrides):
    """A generic 'reference' field — anchor 'Reference' with the value to its
    right. Mirrors saveMapping's stored relative offset (target - anchor)."""
    anchor = {"anchor_x_norm": 0.10, "anchor_y_norm": 0.20,
              "anchor_w_norm": 0.18, "anchor_h_norm": 0.04}
    target = {"target_x_norm": 0.32, "target_y_norm": 0.20,
              "target_w_norm": 0.16, "target_h_norm": 0.04}
    m = {
        "field_key": "reference",
        "page_number": 0,
        "anchor_text": "Reference",
        "search_expansion": 0.0,
        "enabled": True,
        **anchor, **target,
        "offset_dx_norm": target["target_x_norm"] - anchor["anchor_x_norm"],
        "offset_dy_norm": target["target_y_norm"] - anchor["anchor_y_norm"],
    }
    m.update(overrides)
    return m


# A realistic learned format for the 'reference' field: three confirmed values
# all shaped "####-####-#", each seen >=3 times -> the shape is accepted.
LEARNED = classify_format(
    ["2603-1351-1", "2604-0511-1", "2602-0768-1"],
    value_counts={"2603-1351-1": 3, "2604-0511-1": 3, "2602-0768-1": 3},
)
FMT_LOOKUP = lambda fk: LEARNED if fk == "reference" else None


def main():
    fails = 0
    page = FakePage()

    # Anchor label always findable locally for tests 1-3.
    lines_local = lambda crop: [
        {"text": "Reference", "x_norm": 0.0, "y_norm": 0.5, "w_norm": 0.4, "h_norm": 0.3}
    ]

    # 1. Manual-anchor precedence: a learned-SHAPE mismatch ALONE no longer drops a
    #    manual mapping — the drawn box is trusted, so a type-valid off-shape value is
    #    KEPT (the old drop-failsafe silently lost a type-valid manual value to the
    #    wrong auto value on reprocess). The learned-shape check now only FLAGS on the
    #    DERIVED rungs, never drops (covered by test_template_mapper.py).
    print("1. learned-shape mismatch ALONE does not drop a manual mapping (kept; precedence)")
    res = template_mapper.extract_with_mappings(
        [page], [ref_mapping()],
        ocr_lines_fn=lines_local, ocr_text_fn=text_queue_stub(["Booking"]),
        format_lookup=FMT_LOOKUP)
    fails += not check("type-valid off-shape 'Booking' is KEPT (not dropped on learned shape)",
                       res.get("reference", {}).get("value") == "Booking")

    # 1b. The real failsafe still in force: a value FAILING the field's regex/TYPE is
    #     rejected even for a manual mapping (shape_mode='ignore' still enforces type).
    print("1b. a value failing the field REGEX/TYPE is rejected (the real failsafe)")
    DATE_VPS = {"date": [r"\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}"]}
    res = template_mapper.extract_with_mappings(
        [page], [ref_mapping()],
        field_patterns={"reference": {"validation": "date"}},
        validation_patterns=DATE_VPS,
        ocr_lines_fn=lines_local, ocr_text_fn=text_queue_stub(["Booking"]),
        format_lookup=FMT_LOOKUP)
    fails += not check("'Booking' rejected for a DATE-typed field (regex/type gate)",
                       "reference" not in res)

    # 2. Correctly-shaped value passes the failsafe.
    print("2. a value matching the learned shape is committed")
    res = template_mapper.extract_with_mappings(
        [page], [ref_mapping()],
        ocr_lines_fn=lines_local, ocr_text_fn=text_queue_stub(["2603-1351-1"]),
        format_lookup=FMT_LOOKUP)
    fails += not check("'2603-1351-1' committed",
                       res.get("reference", {}).get("value") == "2603-1351-1")

    # 3. No learned format -> nothing rejected (conservative / universal).
    print("3. with NO learned format, the value passes through (no over-reject)")
    res_none = template_mapper.extract_with_mappings(
        [page], [ref_mapping()],
        ocr_lines_fn=lines_local, ocr_text_fn=text_queue_stub(["Booking"]),
        format_lookup=None)
    fails += not check("format_lookup=None -> 'Booking' passes through",
                       res_none.get("reference", {}).get("value") == "Booking")
    res_empty = template_mapper.extract_with_mappings(
        [page], [ref_mapping()],
        ocr_lines_fn=lines_local, ocr_text_fn=text_queue_stub(["Booking"]),
        format_lookup=lambda fk: None)
    fails += not check("lookup returns None (thin history) -> passes through",
                       res_empty.get("reference", {}).get("value") == "Booking")

    # 4. Page-wide relocation: label only present once the search covers the page.
    print("4. page-wide relocation finds a label outside the local box")

    def lines_pagewide_only(crop):
        x1, _y1, x2, _y2 = crop[1]          # ("crop", (x1,y1,x2,y2)) pixel box
        if (x2 - x1) / 1000.0 > 0.8:        # only the whole-page search sees it
            return [{"text": "Reference", "x_norm": 0.10, "y_norm": 0.70,
                     "w_norm": 0.18, "h_norm": 0.04}]
        return [{"text": "unrelated header", "x_norm": 0.0, "y_norm": 0.0,
                 "w_norm": 0.3, "h_norm": 0.05}]

    res = template_mapper.extract_with_mappings(
        [page], [ref_mapping()],
        ocr_lines_fn=lines_pagewide_only, ocr_text_fn=text_queue_stub(["2605-0769-1"]),
        format_lookup=FMT_LOOKUP)
    fails += not check("value recovered via whole-page relocation",
                       res.get("reference", {}).get("value") == "2605-0769-1")

    # 5. Nearest-match tie-break when the label repeats (direct _locate_anchor).
    print("5. repeated label -> nearest instance to the original anchor wins")
    anchor_box = {"x_norm": 0.10, "y_norm": 0.20, "w_norm": 0.18, "h_norm": 0.04}
    # Two identical-text lines: one near the anchor (y~0.21), one far (y~0.85).
    dup_lines = lambda crop: [
        {"text": "Reference", "x_norm": 0.10, "y_norm": 0.85, "w_norm": 0.18, "h_norm": 0.04},
        {"text": "Reference", "x_norm": 0.10, "y_norm": 0.21, "w_norm": 0.18, "h_norm": 0.04},
    ]
    located = template_mapper._locate_anchor(
        page, anchor_box, "Reference", 1.0, dup_lines,
        min_search=template_mapper._ANCHOR_SEARCH_MIN)
    fails += not check("located the NEAR duplicate (y~0.21, not 0.85)",
                       located is not None and abs(located["y_norm"] - 0.21) < 0.05)

    print()
    print(f"{fails} FAILED" if fails else "All template-mapper failsafe checks passed")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
