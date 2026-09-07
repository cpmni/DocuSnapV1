"""
tests/test_template_date_left_clip_grow.py — TEMPLATE_DATE_LEFT_CLIP_GROW (2026-09-07, gary A1 → Oracle C9-C11).

Slice C's H3 exemption ("a complete 4-digit-year date is never a partial") returned before computing any cut.
A taught box that landed a glyph to the right reads `5/03/2026` (25/03/2026) @90 — format-valid, un-salvaged,
undefended. With the switch ON a 4-digit-year date whose FIRST component is ONE digit lets the geometry decide:
  #1 a full-glyph LEFT cut → the grow re-reads '25/03/2026' → `template_mapping_edgegrow`, clean (no note)
  #2 OFF → byte-identical to today (H3: the clipped '5/03/2026' commits @90 as template_mapping)
  #3 a 2-digit first component ('13-02-2026') stays H3-exempt even with a left cut
  #4 a rigid '9/03/2026' whose grown read is '25/03/2026' → floor (the strict one-digit comparator), never a heal
  #5 MM/DD: '1/25/2026' probes too (first component, not "day")
  #6 right-only cut on a 1-digit date → no fire (H3 stands)
  #7 the [8,10) px dead band: a sub-floor overhang never fires (pinned accepted miss — the pad-window flag is the net)
  #8 a legit unpadded '5/03/2026' with NO cut word → None (a 1-digit first component alone is never evidence)
Run:  py -3.12 tests/test_template_date_left_clip_grow.py   (from python_backend/)
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
        return box          # (x1, y1, x2, y2) px — the stub OCR fns key off this


PAGE = FakePage()
VAL = {"date": [r"(?<!\d)\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}(?!\d)"]}
FP = {"d": {"validation": "date"}}


def mapping(tx, tw):
    return {"field_key": "d", "anchor_text": "Invoice Date", "page_number": 0, "enabled": 1,
            "anchor_x_norm": 0.10, "anchor_y_norm": 0.195, "anchor_w_norm": 0.12, "anchor_h_norm": 0.03,
            "target_x_norm": tx, "target_y_norm": 0.195, "target_w_norm": tw, "target_h_norm": 0.03}


def word(text, x=0.30, w=0.10):
    return {"text": text, "x_norm": x, "y_norm": 0.20, "w_norm": w, "h_norm": 0.02}


def lines_for(wd):
    return [{"text": wd["text"], "x_norm": wd["x_norm"], "y_norm": 0.20, "w_norm": wd["w_norm"], "h_norm": 0.02, "words": [wd]}]


def stub(full, clipped, full_from_px=302):
    """The abs crop (starting INSIDE the word) reads the clipped text; a crop whose left edge reaches back to
    the word's start (<= full_from_px) reads the full text."""
    def _ocr(crop):
        x1, y1, x2, y2 = crop
        if y2 < 150 or y1 > 280:
            return None
        return full if x1 <= full_from_px else clipped
    return _ocr


def run(tm, m, wd, ocr):
    before = dict(m)
    r = tm._extract_one(PAGE, m, FP, lambda img: [], ocr, located=None, validation_patterns=VAL,
                        format_lookup=None, line_cache={(id(PAGE), 0.0, 0.0, 1.0, 1.0): lines_for(wd)},
                        provisional_lookup=None)
    assert m == before, "the stored mapping must never be mutated"
    return r


os.environ['TEMPLATE_ABS_EDGE_GUARD'] = '1'
os.environ['TEMPLATE_DATE_LEFT_CLIP_GROW'] = '1'
import extraction.template_mapper as tm          # noqa: E402
importlib.reload(tm)

# The value word spans x 0.30..0.40 (100 px); the taught box starts 17 px INSIDE it (a full glyph) → left cut.
W = word("25/03/2026")
CUT = mapping(0.317, 0.09)

print("#1 a full-glyph LEFT cut on a 1-digit-first-component date grows and heals cleanly")
r = run(tm, dict(CUT), W, stub("25/03/2026", "5/03/2026"))
check("value '25/03/2026' via template_mapping_edgegrow, no note, conf 90",
      r is not None and r["value"] == "25/03/2026" and r["method"].endswith("_edgegrow")
      and "validation_note" not in r and r["confidence"] == 90)
check("census tag date_left_healed recorded", any(f[2] == 'date_left_healed' for f in tm._EDGE_GUARD_FIRES))

print("#2 switch OFF = today: H3 lets the clipped date commit @90")
os.environ['TEMPLATE_DATE_LEFT_CLIP_GROW'] = '0'
importlib.reload(tm)
r = run(tm, dict(CUT), W, stub("25/03/2026", "5/03/2026"))
check("OFF: '5/03/2026' commits as template_mapping @90 (byte-identical to today)",
      r is not None and r["value"] == "5/03/2026" and r["method"] == "template_mapping" and r["confidence"] == 90)
os.environ['TEMPLATE_DATE_LEFT_CLIP_GROW'] = '1'
importlib.reload(tm)

print("#3 a 2-digit first component stays H3-exempt even with a left cut")
W2 = word("13-02-2026")
r = run(tm, dict(CUT), W2, stub("13-02-2026", "13-02-2026"))
check("'13-02-2026' never fires (H3 kept)", r is not None and r["value"] == "13-02-2026" and r["method"] == "template_mapping")

print("#4 the strict comparator: a rigid '9/03/2026' whose grown read is '25/03/2026' FLOORS, never heals")
r = run(tm, dict(CUT), W, stub("25/03/2026", "9/03/2026"))
check("capped ≤70 with a note (fail-toward-review), value NOT rewritten to the grown read",
      r is not None and r["value"] != "25/03/2026" and r["confidence"] <= 70 and r.get("validation_note"))
check("census tag date_left_capped recorded", any(f[2] == 'date_left_capped' for f in tm._EDGE_GUARD_FIRES))

print("#5 MM/DD: a 1-digit FIRST component probes too")
W3 = word("11/25/2026")
r = run(tm, dict(CUT), W3, stub("11/25/2026", "1/25/2026"))
check("'1/25/2026' grows to '11/25/2026'", r is not None and r["value"] == "11/25/2026" and r["method"].endswith("_edgegrow"))

print("#6 a RIGHT-only cut on a 1-digit date → no fire (H3 stands)")
W4 = word("5/03/2026", x=0.30, w=0.08)                     # the word ends at 0.38; the box ends at 0.36 → right overhang
RCUT = mapping(0.295, 0.065)
tm._EDGE_GUARD_FIRES.clear()
r = run(tm, dict(RCUT), W4, stub("5/03/2026", "5/03/2026", full_from_px=0))
check("no grow, template_mapping @90, census date_left_nofire",
      r is not None and r["method"] == "template_mapping" and r["confidence"] == 90
      and any(f[2] == 'date_left_nofire' for f in tm._EDGE_GUARD_FIRES))

print("#7 the [8,10) px dead band: a sub-floor left overhang never fires (accepted miss, pinned)")
# word 0.30..0.40 (glyph ≈ 10 px); box starts 0.309 → overhang 9 px < max(4, 0.6·10)=6? → 9 ≥ 6 fires at THIS glyph
# size; the accepted miss is at a REAL 17 px glyph: overhang floor = 10.2 px. Model a 17 px glyph: word w 0.17.
W5 = word("25/03/2026", x=0.30, w=0.17)
BAND = mapping(0.309, 0.16)                                 # 9 px inside a 17-px-glyph word
tm._EDGE_GUARD_FIRES.clear()
r = run(tm, dict(BAND), W5, stub("25/03/2026", "5/03/2026", full_from_px=300))
check("a 9 px cut on a 17 px glyph does not fire (H3 stands) — the pad-window flag is the net",
      r is not None and r["value"] == "5/03/2026" and r["method"] == "template_mapping"
      and any(f[2] == 'date_left_nofire' for f in tm._EDGE_GUARD_FIRES))

print("#8 a legit unpadded '5/03/2026' with no cut word → None (never evidence on its own)")
W6 = word("5/03/2026", x=0.30, w=0.09)
FIT = mapping(0.295, 0.10)
r = run(tm, dict(FIT), W6, stub("5/03/2026", "5/03/2026", full_from_px=0))
check("unpadded date commits as-is @90", r is not None and r["value"] == "5/03/2026" and r["method"] == "template_mapping" and r["confidence"] == 90)

print("#9 source pins")
src = open(Path(__file__).resolve().parents[1] / "extraction" / "template_mapper.py", encoding="utf-8").read()
check("flag defaults OFF", "_DATE_LEFT_CLIP_GROW_ON = os.environ.get('TEMPLATE_DATE_LEFT_CLIP_GROW', '0') != '0'" in src)
check("the probe keys on a ONE-digit FIRST component (region-agnostic)", "if _DATE_LEFT_CLIP_GROW_ON and len(m4.group(1)) == 1:" in src)
check("right-only keeps H3", "if _date_left_probe and left_cut is None:" in src)
check("the strict comparator restores exactly one digit", "if not (do and dn.endswith(do) and len(dn) == len(do) + 1):" in src)

os.environ.pop('TEMPLATE_DATE_LEFT_CLIP_GROW', None)
os.environ.pop('TEMPLATE_ABS_EDGE_GUARD', None)
print(f"\n{'PASS' if not FAILED else 'FAIL'} -- {len(FAILED)} failure(s)")
sys.exit(1 if FAILED else 0)
