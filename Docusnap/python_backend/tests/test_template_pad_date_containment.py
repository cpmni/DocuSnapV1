"""
tests/test_template_pad_date_containment.py — TEMPLATE_PAD_DATE_CONTAINMENT_FLAG (2026-09-07, gary A2 → Oracle C12).

The pad-window date cross-check (`_maybe_pad_date_flag`) needs the padded read to beat the tight read by +15
confidence; a CLEAN first-glyph clip reads as a confident 5/9, so `5/03/2026` @91 vs padded `25/03/2026` @92
never flagged. The containment sub-case flags WITHOUT the margin when the committed raw date has a one-digit
first component and the padded date restores exactly one leading digit: ≤70, the note, `corrected_to` = the
padded value, value UNCHANGED (never a swap).
  #1 containment fire: tight '5/03/2026' @91 + pad ('25-03-2026', 92) → flag + corrected_to, value kept
  #2 a different day ('26-03-2026') → the margin rule only (no flag at 92 < 91+15)
  #3 a 2-digit tight ('15/03/2026') → the margin rule only
  #4 a salvaged tight read → skipped (the containment leg never runs on a salvage)
  #5 Case 2 (calendar-equal '05-03-2026') → no-op
  #6 OFF → byte-identical (no flag)
  #7 an existing note (C5) is never stacked
Run:  py -3.12 tests/test_template_pad_date_containment.py   (from python_backend/)
"""
import importlib
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

FAILED = []


def check(name, cond):
    print(("PASS  " if cond else "FAIL  ") + name)
    if not cond:
        FAILED.append(name)


class FakePage:
    size = (1000, 1000)

    def crop(self, box):
        from PIL import Image
        return Image.new("L", (400, 60), 255)


BOX = {"x_norm": 0.80, "y_norm": 0.166, "w_norm": 0.09, "h_norm": 0.0155}
os.environ['TEMPLATE_PAD_WINDOW_READ'] = '1'
os.environ['TEMPLATE_PAD_DATE_CONTAINMENT_FLAG'] = '1'
import extraction.template_mapper as M          # noqa: E402
importlib.reload(M)
check("both switches armed", M._PAD_WINDOW_READ_ON is True and M._PAD_DATE_CONTAINMENT_ON is True)


def res(value, method="template_mapping", note=None):
    r = {"value": value, "confidence": 90, "method": method, "anchor": "Invoice Date"}
    if note:
        r["validation_note"] = note
    return r


print("#1 containment fire")
M._read_pad_window_date = lambda page, box: ("25-03-2026", 92.0)
out = M._maybe_pad_date_flag(FakePage(), BOX, 'date', res("5/03/2026"), 91.0)
check("value stays '5/03/2026' (never a swap)", out["value"] == "5/03/2026")
check("capped ≤70", out["confidence"] <= 70)
check("note names the padded read", "25-03-2026" in (out.get("validation_note") or ""))
check("corrected_to = the padded value (one click)", out.get("corrected_to") == "25-03-2026")
check("method tagged _padcontain", out["method"].endswith("_padcontain"))

print("#2 a different day → the margin rule only")
M._read_pad_window_date = lambda page, box: ("26-03-2026", 92.0)
out = M._maybe_pad_date_flag(FakePage(), BOX, 'date', res("5/03/2026"), 91.0)
check("no containment flag; 92 < 91+15 → no margin flag either", out.get("validation_note") is None and out["confidence"] == 90 and "corrected_to" not in out)
out = M._maybe_pad_date_flag(FakePage(), BOX, 'date', res("5/03/2026"), 60.0)
check("…but the margin rule still fires at 92 ≥ 60+15 (_paddisagree, no corrected_to)", out["method"].endswith("_paddisagree") and "corrected_to" not in out)

print("#3 a 2-digit tight read → the margin rule only")
M._read_pad_window_date = lambda page, box: ("25-03-2026", 92.0)
out = M._maybe_pad_date_flag(FakePage(), BOX, 'date', res("15/03/2026"), 91.0)
check("'15/03/2026' vs '25-03-2026' at 92: no flag (margin), no containment", out.get("validation_note") is None and "corrected_to" not in out)

print("#4 a salvaged tight read is skipped by the containment leg")
out = M._maybe_pad_date_flag(FakePage(), BOX, 'date', res("5/03/2026", method="template_mapping_salvaged"), 91.0)
check("salvaged: no containment flag", "corrected_to" not in out and not str(out["method"]).endswith("_padcontain"))

print("#5 Case 2 calendar-equal → no-op")
M._read_pad_window_date = lambda page, box: ("05-03-2026", 92.0)
out = M._maybe_pad_date_flag(FakePage(), BOX, 'date', res("5/03/2026"), 91.0)
check("'5/03/2026' vs '05-03-2026' → unchanged", out.get("validation_note") is None and out["confidence"] == 90)

print("#6 OFF → byte-identical")
os.environ['TEMPLATE_PAD_DATE_CONTAINMENT_FLAG'] = '0'
importlib.reload(M)
M._read_pad_window_date = lambda page, box: ("25-03-2026", 92.0)
out = M._maybe_pad_date_flag(FakePage(), BOX, 'date', res("5/03/2026"), 91.0)
check("OFF: no flag (the margin rule alone: 92 < 91+15)", out.get("validation_note") is None and out["confidence"] == 90 and "corrected_to" not in out)
os.environ['TEMPLATE_PAD_DATE_CONTAINMENT_FLAG'] = '1'
importlib.reload(M)

print("#7 C5: an existing note is never stacked")
M._read_pad_window_date = lambda page, box: ("25-03-2026", 92.0)
out = M._maybe_pad_date_flag(FakePage(), BOX, 'date', res("5/03/2026", note="some earlier note"), 91.0)
check("existing note untouched, no corrected_to", out["validation_note"] == "some earlier note" and "corrected_to" not in out)

print("#8 source pins")
src = open(Path(__file__).resolve().parents[1] / "extraction" / "template_mapper.py", encoding="utf-8").read()
check("flag defaults OFF", "_PAD_DATE_CONTAINMENT_ON = os.environ.get('TEMPLATE_PAD_DATE_CONTAINMENT_FLAG', '0') != '0'" in src)
check("the sub-case runs BEFORE the margin rule and only when not salvaged", src.index("_PAD_DATE_CONTAINMENT_ON and not str(result.get(\"method\")") < src.index("if pad_conf is None or pad_conf < base + _PAD_DISAGREE_MARGIN"))
check("exactly-one-digit containment comparator", "do and dn.endswith(do) and len(dn) == len(do) + 1" in src)

os.environ.pop('TEMPLATE_PAD_DATE_CONTAINMENT_FLAG', None)
os.environ.pop('TEMPLATE_PAD_WINDOW_READ', None)
print(f"\n{'PASS' if not FAILED else 'FAIL'} -- {len(FAILED)} failure(s)")
sys.exit(1 if FAILED else 0)
