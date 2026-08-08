"""
Repeated-label anchoring where OCR GARBLES the real row's label: a section header
"Item Information" (clean "Item", score 1.0) echoes the row label, but the real row
"ttem 1102V03NL1" OCRs its "Item" as "ttem" (fuzzy 0.75) — so the header OUTSCORES the
row and the label-lock would relocate onto it, inline-harvest "Information", and wrongly
override the rigid crop that read the correct "1102V03NL1" at the taught box.

Fix — VALUE AGREEMENT (DPI-stable where the label OCR is not): when the rigid read is
strictly credible, the locate prefers the label occurrence whose LINE CARRIES that value
(the garbled row) over a higher-scoring header whose neighbour is a different word. If NO
occurrence carries the value (a genuinely DRIFTED rigid read), selection is unchanged and
relocation still fixes the drift. Plus reggie's digit-free-word backstop for the residual.

OCR is stubbed (no Tesseract); the REAL selection/label-lock logic runs. Mirrors the
repo's script-style extraction tests (see tests/test_relocate_keyvalue.py).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from extraction import anchor
from extraction import template_mapper as tm

fails = []
def check(name, got, exp):
    if got == exp: print(f"  OK  {name}")
    else: print(f"  FAIL {name}: got={got!r} exp={exp!r}"); fails.append(name)


class _FakePage:
    size = (1000, 1000)
    def crop(self, *a, **k): return self

def _stub_lines(lines):
    return lambda *_a, **_k: [dict(l) for l in lines]


# ── Fixtures. Header "Item" is clean (score 1.0); the real row's "Item" is OCR-garbled
# to "ttem" (fuzzy ~0.75) yet its line carries the taught value "1102V03NL1".
HEADER = {"text": "Item Information", "x_norm": 0.30, "y_norm": 0.478, "w_norm": 0.22, "h_norm": 0.016,
          "words": [{"text": "Item",        "x_norm": 0.30, "y_norm": 0.478, "w_norm": 0.04, "h_norm": 0.016},
                    {"text": "Information", "x_norm": 0.36, "y_norm": 0.478, "w_norm": 0.16, "h_norm": 0.016}]}
ROW    = {"text": "ttem 1102V03NL1", "x_norm": 0.30, "y_norm": 0.508, "w_norm": 0.22, "h_norm": 0.014,
          "words": [{"text": "ttem",       "x_norm": 0.30, "y_norm": 0.508, "w_norm": 0.04, "h_norm": 0.014},
                    {"text": "1102V03NL1", "x_norm": 0.42, "y_norm": 0.508, "w_norm": 0.10, "h_norm": 0.014}]}
LBOX = {"x_norm": 0.0, "y_norm": 0.47, "w_norm": 1.0, "h_norm": 0.06}
V_CX, V_CY, V_W, V_H = 0.47, 0.497, 0.10, 0.014
VP = {}

# Sanity: the header really does outscore the garbled row (so value-agreement, not score,
# is what must break the tie).
print("Preconditions:")
check("header 'Item' scores 1.0", tm._label_score(tm._normalise("Item"), tm._normalise(HEADER["text"])), 1.0)
_rs = tm._label_score(tm._normalise("Item"), tm._normalise(ROW["text"]))
check("garbled row scores below the header but above the fuzzy floor",
      0.6 <= _rs < 1.0, True)


print("Layer 1 — born-digital locate prefers the value-carrying row (confirm_value):")
loc = anchor._locate_in_text_lines([dict(HEADER), dict(ROW)], LBOX, "Item", confirm_value="1102V03NL1")
check("with confirm_value -> row picked (inline = the code)", (loc or {}).get("inline_value"), "1102V03NL1")
loc0 = anchor._locate_in_text_lines([dict(HEADER), dict(ROW)], LBOX, "Item")
check("without confirm_value -> higher-scoring header wins (the bug)", (loc0 or {}).get("inline_value"), "Information")


print("Layer 1 — OCR locate (_locate_anchor) prefers the value-carrying row:")
_orig_crop = tm._crop
tm._crop = lambda page, box: _FakePage()
try:
    full = {"x_norm": 0.0, "y_norm": 0.0, "w_norm": 1.0, "h_norm": 1.0}
    r = tm._locate_anchor(_FakePage(), full, "Item", 0.0, _stub_lines([HEADER, ROW]), confirm_value="1102V03NL1")
    check("OCR: confirm_value -> row (inline = code)", r.get("inline_value"), "1102V03NL1")
    r0 = tm._locate_anchor(_FakePage(), full, "Item", 0.0, _stub_lines([HEADER, ROW]))
    check("OCR: no confirm_value -> header wins", r0.get("inline_value"), "Information")
finally:
    tm._crop = _orig_crop


def _anchor(**over):
    a = {"field_key": "item", "anchor_label": "Item", "direction": "right",
         "x_norm": V_CX, "y_norm": V_CY, "w_norm": V_W, "h_norm": V_H,
         "offset_dx_norm": 0.17, "offset_dy_norm": -0.011,
         "supplier_name": "", "document_type": "worksheet", "usage_count": 1, "confidence": 0.8}
    a.update(over)
    return [a]

def _extract(text_lines, rigid, **kw):
    anchor._crop_and_ocr = lambda *a, **k: rigid
    tm._crop = lambda page, box: _FakePage()
    return anchor.extract_with_anchors(
        "worksheet", _anchor(), "", "worksheet",
        page_images=[_FakePage()], field_patterns={"item": {"validation": "text"}},
        validation_patterns=VP, text_field_keys=["item"],
        page_text_lines=[dict(l) for l in text_lines], **kw)

_saved_cao = anchor._crop_and_ocr
try:
    print("End-to-end — garbled label + credible rigid keeps the code (no history needed):")
    r = _extract([HEADER, ROW], "1102V03NL1", format_lookup=None)
    check("item kept as the code", r.get("item", {}).get("value"), "1102V03NL1")
    check("method stays anchor_crop (not relocated)", r.get("item", {}).get("method"), "anchor_crop")
    check("r: clean rigid carries NO caption-guard note -> auto-files unflagged (Oracle cond 4)",
          "heading on the page" not in (r.get("item", {}).get("validation_note") or ""), True)

    print("Drift fix preserved — a WRONG rigid read (not beside any label) still relocates:")
    r2 = _extract([ROW], "WRONGXY", format_lookup=None)
    check("wrong rigid -> relocation reads the real value", r2.get("item", {}).get("value"), "1102V03NL1")

    print("Backstop (reggie) — header only, digit-free word vs code on a digit-bearing field:")
    r3 = _extract([HEADER], "1102V03NL1", format_lookup=lambda _fk: {"shapes": ["####@##@@#"]})
    check("digit-bearing history -> keep the code", r3.get("item", {}).get("value"), "1102V03NL1")
    print("Caption guard (FIX 1) — header-only: the harvested caption word never commits:")
    r4 = _extract([HEADER], "1102V03NL1", format_lookup=None)
    check("no learned shape -> caption 'Information' is NULLED, not committed (was the bug)",
          r4.get("item", {}).get("value"), None)
    check("r4: empty field carries a review note -> held, never a silent-blank auto-file (Oracle cond 2)",
          bool(r4.get("item", {}).get("validation_note")), True)
    os.environ["ANCHOR_CAPTION_HARVEST_GUARD"] = "0"
    try:
        r4off = _extract([HEADER], "1102V03NL1", format_lookup=None)
        check("OFF (ANCHOR_CAPTION_HARVEST_GUARD=0): legacy 'Information' restored -> byte-identical",
              r4off.get("item", {}).get("value"), "Information")
    finally:
        del os.environ["ANCHOR_CAPTION_HARVEST_GUARD"]
finally:
    anchor._crop_and_ocr, tm._crop = _saved_cao, _orig_crop


if fails:
    print(f"\n{len(fails)} FAILED"); sys.exit(1)
print("\nAll value-agreement anchoring checks passed.")
