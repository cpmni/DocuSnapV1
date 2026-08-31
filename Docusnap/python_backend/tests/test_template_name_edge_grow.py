"""Pins for TEMPLATE_NAME_EDGE_GROW v1 (flush-edge clip class, 2026-08-11 — revived under the
Oracle-RECORDED conditions; see the _NAME_EDGE_GROW_ON flag block). The class: the teach snap's
trailing pad (~0.002 for a single-line name) is thinner than sibling drift (0.003-0.005), so a
stored name box sits flush against its last glyph and a drifted sibling shears it ('Ltd' reads
'Ltc'). The leg: RIGHT-edge cut only, last-token-only repair, PAGE-PRESENT witness with NO
short-token skip, FLAG-ONLY commit (<=70 + note), every decline SILENT (None — arming can only
ADD the healed-flagged outcome).

Run: py -3.12 python_backend/tests/test_template_name_edge_grow.py
"""
import copy
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
        return box


PAGE = FakePage()

# Row: 'Bramblewood' 0.10-0.21 · 'Joinery' 0.22-0.28 · 'Ltd' 0.30-0.33 (3 glyphs, g=0.01).
def make_lines(last_text="Ltd"):
    words = [
        {"text": "Bramblewood", "x_norm": 0.10, "y_norm": 0.20, "w_norm": 0.11, "h_norm": 0.02},
        {"text": "Joinery",     "x_norm": 0.22, "y_norm": 0.20, "w_norm": 0.06, "h_norm": 0.02},
        {"text": last_text,     "x_norm": 0.30, "y_norm": 0.20, "w_norm": 0.03, "h_norm": 0.02},
    ]
    return [{"text": "Bramblewood Joinery " + last_text, "x_norm": 0.10, "y_norm": 0.20,
             "w_norm": 0.23, "h_norm": 0.02, "words": words}]


LINES = make_lines()

# The stub OCR keys off the crop's right edge in px: a crop cutting 'Ltd' reads the sheared
# 'Ltc'; a crop past the word's far edge reads the true 'Ltd'. GROWN_READ lets a test vary
# what the grown re-read produces without rebuilding the stub.
GROWN_READ = ["Bramblewood Joinery Ltd"]


def ocr_text_stub(crop):
    x1, y1, x2, y2 = crop
    if y2 < 150 or y1 > 280:
        return None
    if x2 >= 330:
        return GROWN_READ[0]
    if x2 >= 250:
        return "Bramblewood Joinery Ltc"
    return None


def box(x, w, y=0.195, h=0.03):
    return {"x_norm": x, "y_norm": y, "w_norm": w, "h_norm": h}


def mapping(target):
    return {"field_key": "customer_name", "anchor_text": None, "page_number": 0, "enabled": 1,
            "anchor_x_norm": 0.10, "anchor_y_norm": 0.10, "anchor_w_norm": 0.10,
            "anchor_h_norm": 0.02,
            "target_x_norm": target["x_norm"], "target_y_norm": target["y_norm"],
            "target_w_norm": target["w_norm"], "target_h_norm": target["h_norm"]}


FP = {"customer_name": {"validation": "text"}}
VAL = {"alphanumeric": [r"[A-Za-z0-9][A-Za-z0-9\-\/\.]{2,20}"]}


def run_one(tm, target, lines=None):
    lc = {(id(PAGE), 0.0, 0.0, 1.0, 1.0): (lines if lines is not None else LINES)}
    m = mapping(target)
    before = copy.deepcopy(m)
    r = tm._extract_one(PAGE, m, FP, lambda img: [], ocr_text_stub, located=None,
                        validation_patterns=VAL, format_lookup=None, line_cache=lc,
                        provisional_lookup=None)
    return r, (m == before)


# Right edge at 0.32: cuts 'Ltd' (inside 0.02 >= g, overhang 0.01 >= 0.6g, fraction 0.67).
CUT = box(0.095, 0.225)

# ── default OFF: byte-identical ──────────────────────────────────────────────
os.environ.pop('TEMPLATE_NAME_EDGE_GROW', None)
os.environ['TEMPLATE_ABS_EDGE_GUARD'] = '1'          # parent guard armed, name leg dark
import extraction.template_mapper as tm
importlib.reload(tm)
check("kill switch default OFF", tm._NAME_EDGE_GROW_ON is False)
r, unmut = run_one(tm, CUT)
check("OFF: sheared name commits untouched (today's behaviour — wordness flag is the net)",
      r and r["value"] == "Bramblewood Joinery Ltc" and r["method"] == "template_mapping"
      and "validation_note" not in r)
check("OFF: stored mapping unmutated", unmut)

# ── scope admission (unit) ───────────────────────────────────────────────────
os.environ['TEMPLATE_NAME_EDGE_GROW'] = '1'
importlib.reload(tm)
check("switch arms", tm._NAME_EDGE_GROW_ON is True)
check("scope: name-like field admitted", tm._name_grow_scope("customer_name", "text") is True)
check("scope: code field stays with the code leg", tm._name_grow_scope("ref", "alphanumeric") is False)
check("scope: currency stays with the currency leg", tm._name_grow_scope("total", "currency") is False)

# ── comparator + page-present witness (unit) — the C3 short-token pin ────────
W_LTD = {"text": "Ltd"}
check("comparator: 'Ltc' repairs to 'Ltd' when the page word testifies 'Ltd' (3-char token "
      "TESTED — no short-token skip; skipping short cores is the NAME_UNCLIP-C3 defect)",
      tm._name_grow_comparator("Bramblewood Joinery Ltc", "Bramblewood Joinery Ltd", W_LTD) is True)
check("comparator: completion 'Lt' -> 'Ltd' accepted",
      tm._name_grow_comparator("Bramblewood Joinery Lt", "Bramblewood Joinery Ltd", W_LTD) is True)
check("witness: a garbled locate word REFUSES the grow (page-present defence)",
      tm._name_grow_comparator("Bramblewood Joinery Ltc", "Bramblewood Joinery Ltd",
                               {"text": "Etd"}) is False)
check("comparator: a changed LEADING token refuses (grow may only touch the tail)",
      tm._name_grow_comparator("Bramblewood Joinery Ltc", "Brambleween Joinery Ltd", W_LTD) is False)
check("comparator: a digit-bearing grown tail refuses",
      tm._name_grow_comparator("Bramblewood Joinery Ltc", "Bramblewood Joinery Ltd4",
                               {"text": "Ltd4"}) is False)
check("comparator: token-count change refuses (no neighbour absorption)",
      tm._name_grow_comparator("Bramblewood Joinery Ltc", "Bramblewood Joinery Ltd Unit",
                               W_LTD) is False)
check("comparator: shrunken grown tail refuses",
      tm._name_grow_comparator("Bramblewood Joinery Ltc", "Bramblewood Joinery L",
                               {"text": "L"}) is False)

# ── armed heal: FLAG-ONLY commit ─────────────────────────────────────────────
GROWN_READ[0] = "Bramblewood Joinery Ltd"
r, unmut = run_one(tm, CUT)
check("heal: grown value commits FLAGGED <=70, method _namegrow, note present — never clean",
      r and r["value"] == "Bramblewood Joinery Ltd"
      and r["method"].endswith("_namegrow") and r["confidence"] <= 70
      and r.get("validation_note") == tm._NAME_GROW_NOTE)
check("heal: stored mapping unmutated (C-C3 discipline)", unmut)

# ── declines are SILENT (no defer-cap, no note — the arming-only-adds pin) ───
r, _ = run_one(tm, CUT, lines=make_lines("Etd"))     # locate tier garbled -> witness refuses
check("decline (witness): rigid read commits EXACTLY as when dark — no cap, no note",
      r and r["value"] == "Bramblewood Joinery Ltc" and r["method"] == "template_mapping"
      and "validation_note" not in r and not r["method"].endswith("_edgecut"))

GROWN_READ[0] = "Bramblewood Joinery Ltc"            # grown re-read unchanged -> no-op
r, _ = run_one(tm, CUT)
check("decline (no-op): an unchanged grown read leaves the rigid commit untouched",
      r and r["value"] == "Bramblewood Joinery Ltc" and "validation_note" not in r)

GROWN_READ[0] = "Brambleween Joinery Ltd"            # leading token drifted -> comparator refuses
r, _ = run_one(tm, CUT)
check("decline (comparator): leading-token change keeps the rigid read silently",
      r and r["value"] == "Bramblewood Joinery Ltc" and "validation_note" not in r)
GROWN_READ[0] = "Bramblewood Joinery Ltd"

# ── LEFT cut declined (v1 right-only) ────────────────────────────────────────
# Box starting inside 'Bramblewood' (left edge 0.15 cuts it) and ending past 'Ltd'.
LEFT_CUT = box(0.15, 0.20)                            # right edge 0.35 — 'Ltd' fully inside
r, _ = run_one(tm, LEFT_CUT)
check("left cut: declined silently (v1 is right-edge only)",
      r is None or (r and "namegrow" not in r.get("method", "")))

# ── nesting: parent guard OFF keeps the leg dark even when armed ─────────────
os.environ.pop('TEMPLATE_ABS_EDGE_GUARD', None)
importlib.reload(tm)
check("nesting: parent guard off -> leg inert", tm._ABS_EDGE_GUARD_ON is False)
r, _ = run_one(tm, CUT)
check("nesting: sheared name commits untouched with the parent off",
      r and r["value"] == "Bramblewood Joinery Ltc" and "validation_note" not in r)

os.environ.pop('TEMPLATE_NAME_EDGE_GROW', None)
print()
if FAILED:
    print(f"{len(FAILED)} FAILED"); sys.exit(1)
print("all name-edge-grow pins green")
