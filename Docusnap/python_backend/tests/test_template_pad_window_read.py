"""Pins for TEMPLATE_PAD_WINDOW_READ — Slice 1 of the date-crop read root fix (Oracle
SIGN-OFF-W/COND 2026-08-06). A taught DATE box clips the leading glyph on a sibling scan and
the still-parses misread commits silently; a wider row-bounded read cross-checks it and FLAGS a
confident disagreement (never silent-swaps). Neighbour rejection is GEOMETRIC-ONLY for dates
(Oracle C2). Default OFF = byte-identical.

Deterministic: pytesseract.image_to_data is monkeypatched (no Tesseract binary needed);
validator.parse_date is real. Run: py -3.12 python_backend/tests/test_template_pad_window_read.py
"""
import importlib
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from PIL import Image

FAILED = []


def check(name, cond):
    print(("PASS  " if cond else "FAIL  ") + name)
    if not cond:
        FAILED.append(name)


os.environ.pop('TEMPLATE_PAD_WINDOW_READ', None)
import extraction.template_mapper as M
importlib.reload(M)
check("switch default OFF", M._PAD_WINDOW_READ_ON is False)

DATE_BOX = {"x_norm": 0.80, "y_norm": 0.166, "w_norm": 0.09, "h_norm": 0.0155}


class FakePage:
    """Records the crop box the helper builds (row-bound pin) and returns a real image so
    _prep + image_to_data run."""
    def __init__(self, w=1000, h=1000):
        self.size = (w, h)
        self.last_crop = None

    def crop(self, box):
        self.last_crop = box
        return Image.new("L", (400, 60), 255)


def _data(words, confs, lefts, widths):
    return {"text": words, "conf": confs, "left": lefts, "width": widths,
            "top": [0] * len(words), "height": [30] * len(words)}


def _patch_itd(monkey_data):
    import pytesseract
    pytesseract.image_to_data = lambda *a, **k: monkey_data


# ── _maybe_pad_date_flag decision pins (monkeypatch the pad read) ───────────────────
os.environ['TEMPLATE_PAD_WINDOW_READ'] = '1'
importlib.reload(M)
check("switch arms", M._PAD_WINDOW_READ_ON is True)

_RESULT = lambda: {"value": "01-04-2026", "confidence": 90, "method": "template_mapping",
                   "anchor": "Invoice Date"}

# Case 3 — confident disagreement → FLAG, value UNCHANGED, note carries the suggestion, capped.
M._read_pad_window_date = lambda page, box: ("02-04-2026", 92.0)
out = M._maybe_pad_date_flag(FakePage(), DATE_BOX, 'date', _RESULT(), 60.0)
check("Case3 flag: value stays committed (never silent-swap)", out["value"] == "01-04-2026")
check("Case3 flag: confidence capped <=70", out["confidence"] <= 70)
check("Case3 flag: validation_note set (auto-file block)", bool(out.get("validation_note")))
check("Case3 flag: suggestion '02-04-2026' embedded in note", "02-04-2026" in out.get("validation_note", ""))
check("Case3 flag: method tagged _paddisagree", out["method"].endswith("_paddisagree"))

# Case 2 — calendar-equal (3/04 vs 03/04) → no-op, byte-identical.
M._read_pad_window_date = lambda page, box: ("01-04-2026", 92.0)
out = M._maybe_pad_date_flag(FakePage(), DATE_BOX, 'date', _RESULT(), 60.0)
check("Case2 agree: result unchanged (no note, conf 90)",
      out.get("validation_note") is None and out["confidence"] == 90)

# Weak disagreement (pad conf below tight+margin) → NO flag (fail toward max auto-file).
M._read_pad_window_date = lambda page, box: ("02-04-2026", 70.0)   # 70 < 60+15 = 75
out = M._maybe_pad_date_flag(FakePage(), DATE_BOX, 'date', _RESULT(), 60.0)
check("weak disagreement: no flag", out.get("validation_note") is None and out["confidence"] == 90)

# Confident disagreement fires the flag (pins the residual-catcher can't be quietly disabled).
M._read_pad_window_date = lambda page, box: ("02-04-2026", 76.0)   # 76 >= 60+15
out = M._maybe_pad_date_flag(FakePage(), DATE_BOX, 'date', _RESULT(), 60.0)
check("confident disagreement: flag fires", bool(out.get("validation_note")))

# Already-flagged (edge-cut / shape-warn) → DON'T stack (C5).
M._read_pad_window_date = lambda page, box: ("02-04-2026", 92.0)
pre = _RESULT(); pre["validation_note"] = "some earlier note"
out = M._maybe_pad_date_flag(FakePage(), DATE_BOX, 'date', pre, 60.0)
check("C5: existing note not overwritten", out["validation_note"] == "some earlier note")

# Non-date val_type → no-op.
out = M._maybe_pad_date_flag(FakePage(), DATE_BOX, 'alphanumeric', _RESULT(), 60.0)
check("non-date: no-op", out.get("validation_note") is None)

# Unparseable committed value → no-op.
bad = _RESULT(); bad["value"] = "not a date"
out = M._maybe_pad_date_flag(FakePage(), DATE_BOX, 'date', bad, 60.0)
check("unparseable committed: no-op", out.get("validation_note") is None)

# OFF byte-identical: switch off, a disagreeing pad read must NOT touch the result.
os.environ['TEMPLATE_PAD_WINDOW_READ'] = '0'
importlib.reload(M)
M._read_pad_window_date = lambda page, box: ("02-04-2026", 92.0)
out = M._maybe_pad_date_flag(FakePage(), DATE_BOX, 'date', _RESULT(), 60.0)
check("OFF: byte-identical (no flag even on disagreement)",
      out.get("validation_note") is None and out["confidence"] == 90)
os.environ['TEMPLATE_PAD_WINDOW_READ'] = '1'
importlib.reload(M)

# ── _read_pad_window_date geometry pins (monkeypatch image_to_data; parse_date real) ─
# _prep upscales a 400px-wide crop x2 → 800px frame; place words by left/width in that frame.
# Nearest-to-centre: tcx ≈ 0.5 (target centre lands mid-window). A date at cx 0.5 wins over cx 0.025.
_patch_itd(_data(["03/04/2026", "01/01/2020"], [92.0, 90.0], [340, 0], [120, 40]))
fp = FakePage()
got = M._read_pad_window_date(fp, DATE_BOX)
check("geometry: picks the date NEAREST the box centre", got is not None and got[0] == "03-04-2026")

# Row-bound pin: vertical growth <= 0.5*box_h each side, horizontal <= min(0.8*box_w, 0.06) each side.
b = fp.last_crop
pw = ph = 1000
vext = (b[3] - b[1]) / ph; hext = (b[2] - b[0]) / pw
check("row-bound: vertical extent <= box_h + 2*(0.5*box_h)",
      vext <= DATE_BOX["h_norm"] * 2.0 + 1e-9)
check("row-bound: horizontal extent <= box_w + 2*min(0.8*box_w, 0.06)",
      hext <= DATE_BOX["w_norm"] + 2 * min(0.8 * DATE_BOX["w_norm"], 0.06) + 1e-9)

# Abstain: two DIFFERENT dates near-equidistant from centre (cx 0.45 vs 0.55) → None (Oracle C2).
_patch_itd(_data(["03/04/2026", "05/04/2026"], [92.0, 91.0], [300, 380], [120, 120]))
got = M._read_pad_window_date(FakePage(), DATE_BOX)
check("abstain: two equidistant different dates → None (geometric neighbour guard)", got is None)

# Same date twice near-equidistant → NOT ambiguous (pick it).
_patch_itd(_data(["03/04/2026", "03/04/2026"], [92.0, 91.0], [300, 380], [120, 120]))
got = M._read_pad_window_date(FakePage(), DATE_BOX)
check("same date twice: not treated as ambiguous", got is not None and got[0] == "03-04-2026")

# No single-word date, but a single distinct salvageable date in the joined window → recovered.
_patch_itd(_data(["Invoice", "Date", "03/04/2026"], [80.0, 82.0, 90.0], [10, 120, 340], [90, 90, 120]))
got = M._read_pad_window_date(FakePage(), DATE_BOX)
check("salvage fallback: single distinct date recovered", got is not None and got[0] == "03-04-2026")

# Two distinct salvageable dates, no clean single-word winner geometry → abstain (distinct>1).
_patch_itd(_data(["03/04/2026abc", "def05/04/2026"], [88.0, 87.0], [300, 380], [140, 140]))
got = M._read_pad_window_date(FakePage(), DATE_BOX)
check("salvage fallback: >1 distinct date → abstain", got is None)

os.environ.pop('TEMPLATE_PAD_WINDOW_READ', None)
importlib.reload(M)

print()
if FAILED:
    print(f"{len(FAILED)} FAILED")
    sys.exit(1)
print("All TEMPLATE_PAD_WINDOW_READ checks passed.")
