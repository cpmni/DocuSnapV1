"""
Key/value placement precision (Gary's design): in a "label <big gap> value" row
the OCR groups label+value into ONE line, so the located LINE box spans both and
geometric placement seats the value crop PAST the value. The fix surfaces per-word
boxes, returns the matched LABEL-word box, and harvests the value straight off the
located line. OCR-stubbed (no Tesseract), mirroring the repo convention.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from extraction import template_mapper as tm
from extraction import anchor

fails = []
def check(name, got, exp):
    if got == exp: print(f"  OK  {name}")
    else: print(f"  FAIL {name}: got={got!r} exp={exp!r}"); fails.append(name)
def approx(name, got, exp, tol=0.02):
    if got is not None and abs(got - exp) <= tol: print(f"  OK  {name} ({got:.3f})")
    else: print(f"  FAIL {name}: got={got} exp~={exp}"); fails.append(name)


# ── A real key/value line, word boxes from the Print Tracker evidence (page-norm)
SERIAL_LINE = {
    "text": "Serial number H573429242",
    "x_norm": 0.121, "y_norm": 0.50, "w_norm": 0.578, "h_norm": 0.012,
    "words": [
        {"text": "Serial",     "x_norm": 0.121, "y_norm": 0.50, "w_norm": 0.050, "h_norm": 0.012},
        {"text": "number",     "x_norm": 0.178, "y_norm": 0.50, "w_norm": 0.069, "h_norm": 0.012},
        {"text": "H573429242", "x_norm": 0.586, "y_norm": 0.50, "w_norm": 0.113, "h_norm": 0.012},
    ],
}
DEPLETION_LINE = {
    "text": "Estimated depletion June 27, 2026 (11 days remaining)",
    "x_norm": 0.123, "y_norm": 0.30, "w_norm": 0.768, "h_norm": 0.012,
    "words": [
        {"text": "Estimated",  "x_norm": 0.123, "y_norm": 0.30, "w_norm": 0.089, "h_norm": 0.012},
        {"text": "depletion",  "x_norm": 0.219, "y_norm": 0.30, "w_norm": 0.083, "h_norm": 0.012},
        {"text": "June",       "x_norm": 0.587, "y_norm": 0.30, "w_norm": 0.042, "h_norm": 0.012},
        {"text": "27,",        "x_norm": 0.636, "y_norm": 0.30, "w_norm": 0.025, "h_norm": 0.012},
        {"text": "2026",       "x_norm": 0.668, "y_norm": 0.30, "w_norm": 0.042, "h_norm": 0.012},
        {"text": "(11",        "x_norm": 0.717, "y_norm": 0.30, "w_norm": 0.024, "h_norm": 0.012},
        {"text": "days",       "x_norm": 0.751, "y_norm": 0.30, "w_norm": 0.041, "h_norm": 0.012},
        {"text": "remaining)", "x_norm": 0.798, "y_norm": 0.30, "w_norm": 0.093, "h_norm": 0.012},
    ],
}

class _FakePage:
    size = (1000, 1000)
    def crop(self, *a, **k): return self

def _stub_lines(lines):
    return lambda *_a, **_k: [dict(l) for l in lines]


print("Fix: _locate_anchor returns the LABEL-word box (not the whole line) + inline value:")
# _locate_anchor crops the search box then OCRs via ocr_lines_fn; stub it.
orig_ocr_lines = tm._ocr_lines
orig_crop = tm._crop
tm._crop = lambda page, box: _FakePage()
try:
    res = tm._locate_anchor(_FakePage(), {"x_norm": 0.0, "y_norm": 0.49, "w_norm": 1.0, "h_norm": 0.05},
                            "Serial number", 0.0, _stub_lines([SERIAL_LINE]))
    lb = res.get("label_box")
    approx("label box left edge = label start (0.121)", lb["x_norm"], 0.121)
    approx("label box right edge = label end (~0.247), NOT line end 0.699",
           lb["x_norm"] + lb["w_norm"], 0.247)
    check("inline value harvested from the line", res.get("inline_value"), "H573429242")

    res2 = tm._locate_anchor(_FakePage(), {"x_norm": 0.0, "y_norm": 0.29, "w_norm": 1.0, "h_norm": 0.05},
                             "Estimated depletion", 0.0, _stub_lines([DEPLETION_LINE]))
    check("multi-word label harvests the date+trailer",
          res2.get("inline_value"), "June 27, 2026 (11 days remaining)")
finally:
    tm._crop = orig_crop

print("Fix: relocation HARVESTS the inline value (no crop needed) and gates it:")
VP = {"date": [r"\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}", r"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{2,4}"],
      "alphanumeric": [r"[A-Za-z0-9][A-Za-z0-9\-\/\.]{2,20}"]}

def run_extract(line, field_key, val_type, label):
    # Anchor whose RIGID box is off the value (forces relocation); page_images set
    # so the crop path is attempted first (stubbed to junk), then harvest fires.
    anchors = [{"field_key": field_key, "anchor_label": label, "direction": "right",
                "x_norm": 0.30, "y_norm": line["y_norm"], "w_norm": 0.12, "h_norm": 0.012,
                "supplier_name": "", "document_type": "report", "usage_count": 1, "confidence": 0.8}]
    fp = {field_key: {"validation": val_type}}
    # Stub: rigid/relocate crop OCR returns junk (so harvest is the winner);
    # _locate_for_relocation uses tm._locate_anchor over the stubbed line.
    anchor._crop_and_ocr = lambda *a, **k: None
    tm._crop = lambda page, box: _FakePage()
    tm._ocr_lines = _stub_lines([line])
    return anchor.extract_with_anchors("Serial number H573429242", anchors, "", "report",
                                       page_images=[_FakePage()], field_patterns=fp,
                                       validation_patterns=VP)

orig_cao = anchor._crop_and_ocr
try:
    r = run_extract(SERIAL_LINE, "serial_number", "alphanumeric", "Serial number")
    check("serial harvested via anchor_inline", r.get("serial_number", {}).get("value"), "H573429242")
    check("method is anchor_inline", r.get("serial_number", {}).get("method"), "anchor_inline")

    r2 = run_extract(DEPLETION_LINE, "estimated_depletion", "date", "Estimated depletion")
    # date pattern narrows "June 27, 2026 (11 days remaining)" -> "June 27, 2026"
    check("depletion date narrowed (trailer dropped)",
          r2.get("estimated_depletion", {}).get("value"), "June 27, 2026")
finally:
    anchor._crop_and_ocr = orig_cao
    tm._ocr_lines = orig_ocr_lines

print("Born-digital: locate + harvest straight from the text layer (no OCR):")
# A real page0 so the rung runs; SERIAL_LINE supplied as the exact text layer.
loc = anchor._locate_for_relocation(object(), "Serial number", "right",
                                    (0.62, 0.50, 0.12, 0.012), page_text_lines=[dict(SERIAL_LINE)])
check("located from text layer", loc is not None, True)
check("inline value harvested exactly from text layer", loc.get("inline_value"), "H573429242")
approx("label box right edge = label end (0.247)",
       loc["label_box"]["x_norm"] + loc["label_box"]["w_norm"], 0.247)
# End-to-end via page_text_lines: rigid OCR returns junk, harvest reads the layer.
def _boom(*a, **k):
    raise AssertionError("OCR (_ocr_lines) must NOT be called on the born-digital path")
_saved_ocr = tm._ocr_lines
anchor._crop_and_ocr = lambda *a, **k: None      # rigid read fails -> relocation fires
tm._ocr_lines = _boom                            # asserts the locate uses the text layer, not OCR
try:
    anchors = [{"field_key": "serial_number", "anchor_label": "Serial number", "direction": "right",
                "x_norm": 0.30, "y_norm": 0.50, "w_norm": 0.12, "h_norm": 0.012,
                "supplier_name": "", "document_type": "report", "usage_count": 1, "confidence": 0.8}]
    rb = anchor.extract_with_anchors("Serial number H573429242", anchors, "", "report",
                                     page_images=[_FakePage()],
                                     field_patterns={"serial_number": {"validation": "alphanumeric"}},
                                     validation_patterns=VP, page_text_lines=[dict(SERIAL_LINE)])
    check("born-digital harvest commits exact serial", rb.get("serial_number", {}).get("value"), "H573429242")
    check("method is anchor_inline (text layer)", rb.get("serial_number", {}).get("method"), "anchor_inline")
finally:
    anchor._crop_and_ocr = orig_cao
    tm._ocr_lines = _saved_ocr

if fails:
    print(f"\n{len(fails)} FAILED"); sys.exit(1)
print("\nAll key/value placement+harvest checks passed.")
