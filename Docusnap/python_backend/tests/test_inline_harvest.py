#!/usr/bin/env python3
"""
tests/test_inline_harvest.py
----------------------------
Stage 0.5 `_relocate_and_read` INLINE HARVEST + label_box geometry (parity with
Stage 2 anchor.py). In a key/value row ("Ticket No.  2605-0769-1") the value shares
the located label's OCR line, so it must be read STRAIGHT off the line — not via a
geometric crop the old code REFUSED (whole-line too-wide) or derived off the wrong
(line) origin, which handed the field to the registration transform and read the row
ABOVE ("the anchor and data point aren't linked" drift).

No Tesseract: `_relocate_and_read` is driven with a hand-built `located` dict.
    py -3.12 python_backend/tests/test_inline_harvest.py
Exit 0 = fixed, 1 = regressed.
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
    size = (1000, 1000)

    def crop(self, box):
        return ("crop", box)


VPS = {"alphanumeric": [r"[A-Za-z0-9][A-Za-z0-9\-\/\.]{2,20}"]}


def _mapping():
    return {"field_key": "reference_number", "anchor_text": "Ticket No",
            "anchor_x_norm": 0.10, "anchor_y_norm": 0.40, "anchor_w_norm": 0.08, "anchor_h_norm": 0.02,
            "target_x_norm": 0.25, "target_y_norm": 0.40, "target_w_norm": 0.10, "target_h_norm": 0.02,
            "offset_dx_norm": 0.15, "offset_dy_norm": 0.0}


def _located(**ov):
    # The WHOLE-LINE box is wide (0.40) — the OLD code's _located_too_wide refused it
    # (0.40 > max(0.30, 0.08*2.5)) and returned None -> field fell to registration.
    d = {"x_norm": 0.10, "y_norm": 0.40, "w_norm": 0.40, "h_norm": 0.02,
         "matched_text": "Ticket No",
         "label_box":   {"x_norm": 0.10, "y_norm": 0.40, "w_norm": 0.08, "h_norm": 0.02},
         "inline_value": "2605-0769-1",
         "inline_box":  {"x_norm": 0.25, "y_norm": 0.40, "w_norm": 0.12, "h_norm": 0.02}}
    d.update(ov)
    return d


def _run(located, ocr_text_fn):
    m = _mapping()
    return tm._relocate_and_read(
        FakePage(), m, tm._norm_box(m, "anchor"), tm._norm_box(m, "target"),
        located, "alphanumeric", ocr_text_fn, 0.0, VPS, None, None, 0, "reference_number")


# 1. Inline value harvested off the located line WINS (old too-wide refusal is gone).
out = _run(_located(), lambda crop: "WRONG-ROW-NEIGHBOUR")
check("inline value '2605-0769-1' harvested off the line (NOT a wrong-row crop)",
      (out or {}).get("value") == "2605-0769-1")
check("method is a template_mapping tier", (out or {}).get("method", "").startswith("template_mapping"))

# 2. No inline value (label-above layout): geometric derivation off the TIGHT label_box.
out = _run(_located(inline_value=None, inline_box=None), lambda crop: "INV-DERIVED-9")
check("geometric fallback (no inline) reads via the label_box-derived crop",
      (out or {}).get("value") == "INV-DERIVED-9")

# 3. Inline value that FAILS the gate (junk) falls through to the geometric crop.
out = _run(_located(inline_value="!!"), lambda crop: "INV-FALLBACK-7")
check("junk inline value falls through to the geometric crop",
      (out or {}).get("value") == "INV-FALLBACK-7")

print("\n%s" % ("All inline-harvest checks passed." if not fail else f"{fail} FAILED"))
sys.exit(1 if fail else 0)
