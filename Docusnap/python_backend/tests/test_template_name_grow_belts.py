"""Pins for the NAME-GROW BELTS (2026-09-08; owner exhibit doc 14 'Willowbrook Nurserie:' — 007 + gary → Oracle
SEND BACK → redirected; spec docs/designs/KEYWORD_SUPERSTRING_GROW_2026-09-08.md §6 steps 0-2 + belt 2(a)).
  0. Census instrumentation: 'entered' at guard entry, 'nolines', 'nocut', the decline row carries `new`, and
     NAMEGROW_CENSUS_DIR is created (an absent dir silently swallowed every line — "no census" was never evidence).
  1. TEMPLATE_NAME_GROW_BAND_PICK: the GROWN re-read commits only the ONE line in the taught box's band; 0 or ≥2
     in-band lines decline; the tight read is untouched.
  2. TEMPLATE_NAME_CUT_DEFER_CAP: a geometrically PROVEN right cut whose heal fails takes the deferred ≤70 +
     _EDGE_CUT_NOTE + '_edgecut' floor instead of a silent None. OFF ⇒ byte-identical to v1.
Fixture = the v1 mold (tests/test_template_name_edge_grow.py): 'Bramblewood Joinery Ltd', a box cutting 'Ltd'.
Run: py -3.12 python_backend/tests/test_template_name_grow_belts.py
"""
import copy
import glob
import importlib
import json
import os
import sys
import tempfile
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

def make_lines(last_text="Ltd"):
    words = [
        {"text": "Bramblewood", "x_norm": 0.10, "y_norm": 0.20, "w_norm": 0.11, "h_norm": 0.02},
        {"text": "Joinery",     "x_norm": 0.22, "y_norm": 0.20, "w_norm": 0.06, "h_norm": 0.02},
        {"text": last_text,     "x_norm": 0.30, "y_norm": 0.20, "w_norm": 0.03, "h_norm": 0.02},
    ]
    return [{"text": "Bramblewood Joinery " + last_text, "x_norm": 0.10, "y_norm": 0.20,
             "w_norm": 0.23, "h_norm": 0.02, "words": words}]
LINES = make_lines()
GROWN_READ = ["Bramblewood Joinery Ltd"]     # what the v1 preview-path grown re-read returns

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
            "anchor_x_norm": 0.10, "anchor_y_norm": 0.10, "anchor_w_norm": 0.10, "anchor_h_norm": 0.02,
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

CUT = box(0.095, 0.225)          # right edge 0.32 cuts 'Ltd' (v1 mold)
NOCUT = box(0.095, 0.245)        # right edge 0.34 clears 'Ltd' (no cut word)

def census_rows(d):
    rows = []
    for f in glob.glob(os.path.join(d, "ng_*.jsonl")):
        for l in open(f, encoding="utf-8"):
            if l.strip():
                rows.append(json.loads(l))
    return rows

def arm(**env):
    for k in ('TEMPLATE_NAME_EDGE_GROW', 'TEMPLATE_NAME_GROW_BAND_PICK', 'TEMPLATE_NAME_CUT_DEFER_CAP'):
        os.environ.pop(k, None)
    os.environ['TEMPLATE_ABS_EDGE_GUARD'] = '1'
    for k, v in env.items():
        os.environ[k] = v
    import extraction.template_mapper as tm
    importlib.reload(tm)
    return tm

# ── unit: the shared SHAPE half of the comparator ─────────────────────────────
tm = arm(TEMPLATE_NAME_EDGE_GROW='1')
check("shape: the exhibit 'Willowbrook Nurserie:' completes to 'Willowbrook Nurseries' (colon stripped)",
      tm._name_grow_shape_ok("Willowbrook Nurserie:", "Willowbrook Nurseries") == "nurseries")
check("shape: a glued neighbour token refuses ('… Nurseries Ltd' vs 2 tokens)",
      tm._name_grow_shape_ok("Willowbrook Nurserie:", "Willowbrook Nurseries Ltd") is None)
check("shape: the keyword-steered over-capture 'Willowbrook Nurseries Site' refuses",
      tm._name_grow_shape_ok("Willowbrook Nurserie:", "Willowbrook Nurseries Site") is None)
check("shape: a changed leading token refuses", tm._name_grow_shape_ok("Willowbrook Nurserie:", "Willowbrook Nurseries") is not None
      and tm._name_grow_shape_ok("Willowbrooke Nurserie:", "Willowbrook Nurseries") is None)
check("shape: a digit-bearing completion refuses", tm._name_grow_shape_ok("Acme Lt", "Acme Ltd4") is None)
check("comparator still needs the page-word witness (v1 contract intact)",
      tm._name_grow_comparator("Bramblewood Joinery Ltc", "Bramblewood Joinery Ltd", {"text": "Ltd"}) is True
      and tm._name_grow_comparator("Bramblewood Joinery Ltc", "Bramblewood Joinery Ltd", {"text": "Etd"}) is False)

# ── 0. census instrumentation ────────────────────────────────────────────────
with tempfile.TemporaryDirectory() as td:
    d = os.path.join(td, "sub", "ng")           # absent subdir: makedirs must create it
    os.environ['NAMEGROW_CENSUS_DIR'] = d
    tm = arm(TEMPLATE_NAME_EDGE_GROW='1')
    r, _ = run_one(tm, CUT)
    rows = census_rows(d)
    outs = [x["outcome"] for x in rows]
    check("census: the dir is created and 'entered' is written at guard entry (positive control)",
          os.path.isdir(d) and "entered" in outs)
    check("census: the v1 heal still fires on the mold cut ('healed_flagged')", "healed_flagged" in outs
          and r and r["value"] == "Bramblewood Joinery Ltd" and r.get("validation_note") == tm._NAME_GROW_NOTE)
    for f in glob.glob(os.path.join(d, "ng_*.jsonl")): os.remove(f)
    r, _ = run_one(tm, NOCUT)
    rows = census_rows(d)
    outs = [x["outcome"] for x in rows]
    check("census: a box that clears the last word logs 'entered' + 'nocut' (no longer a silent exit)",
          "entered" in outs and "nocut" in outs)
    nc = next((x for x in rows if x["outcome"] == "nocut"), {})
    check("census: the 'nocut' row explains itself — the read box + the row-band words near its right edge (the in-app "
          "doc-14 finding: a drift-placed box cutting 'Nurseries' by 0.0042 sat 0.0003 under the 0.6·g floor)",
          isinstance(nc.get("box"), dict) and abs(nc["box"]["x2"] - 0.34) < 1e-6
          and any(w["t"] == "Ltd" and w["rowband"] for w in nc.get("near", [])))
    for f in glob.glob(os.path.join(d, "ng_*.jsonl")): os.remove(f)
    r, _ = run_one(tm, CUT, lines=[])
    outs = [x["outcome"] for x in census_rows(d)]
    check("census: no locate lines logs 'entered' + 'nolines'", "entered" in outs and "nolines" in outs)
    for f in glob.glob(os.path.join(d, "ng_*.jsonl")): os.remove(f)
    GROWN_READ[0] = "Greenacres Mill Lane"       # the exhibit's failure: the grown read is the address line
    r, _ = run_one(tm, CUT)
    rows = census_rows(d)
    dec = [x for x in rows if x["outcome"] == "declined"]
    check("census: the comparator decline row now carries `new` (the grown read that was refused)",
          dec and dec[0].get("new") == "Greenacres Mill Lane" and dec[0].get("old") == "Bramblewood Joinery Ltc")
    check("v1 OFF-belts: that decline still commits the sheared name SILENTLY (today's behaviour)",
          r and r["value"] == "Bramblewood Joinery Ltc" and "validation_note" not in r and r["method"] == "template_mapping")
    GROWN_READ[0] = "Bramblewood Joinery Ltd"
    os.environ.pop('NAMEGROW_CENSUS_DIR', None)

# ── 2(a). TEMPLATE_NAME_CUT_DEFER_CAP ────────────────────────────────────────
GROWN_READ[0] = "Greenacres Mill Lane"
tm = arm(TEMPLATE_NAME_EDGE_GROW='1', TEMPLATE_NAME_CUT_DEFER_CAP='1')
check("defer-cap switch arms", tm._NAME_CUT_DEFER_CAP_ON is True)
r, unmut = run_one(tm, CUT)
check("defer-cap: a PROVEN cut whose heal fails commits capped <=70 with the edge-cut note + '_edgecut'",
      r and r["value"] == "Bramblewood Joinery Ltc" and r["confidence"] <= 70
      and r.get("validation_note") == tm._EDGE_CUT_NOTE and r["method"].endswith("_edgecut"))
check("defer-cap: the value is NEVER swapped (fail-toward-review, not a heal)", r and r["value"] == "Bramblewood Joinery Ltc")
check("defer-cap: stored mapping unmutated", unmut)
# ── 2(a) SEAM PIN (2026-09-08 belts gate, realdoc doc 67): a NAME defer-cap must NEVER reach the edge-cut
# relocate. Before the belt a name never defer-capped, so that road was unreachable for names; routed
# through it, the relocate's shape-consent ladder judges free text as always consenting and CLEAN-committed
# a re-seated garble ('Kingfisher Print Stv' @90) over the deferred cap, beating the correct keyword read.
_relo_calls = []
_orig_relo = tm._edge_cut_relocate
tm._edge_cut_relocate = lambda *a, **k: (_relo_calls.append(1),
                                        {"value": "Bramblewood Joinery Ltv", "confidence": 90, "method": "template_mapping"})[1]
try:
    r, _ = run_one(tm, CUT)
finally:
    tm._edge_cut_relocate = _orig_relo
check("SEAM: a name defer-cap skips the edge-cut relocate entirely (never called)", not _relo_calls)
check("SEAM: a re-seated name garble can never clean-commit over the deferred cap (<=70 + note, value unswapped)",
      r and r["value"] == "Bramblewood Joinery Ltc" and r["confidence"] <= 70
      and r.get("validation_note") == tm._EDGE_CUT_NOTE and r["method"].endswith("_edgecut"))
GROWN_READ[0] = "Bramblewood Joinery Ltd"     # the stub keys off the crop's right edge: a no-cut box reads the true name
r, _ = run_one(tm, NOCUT)
check("defer-cap: an UNPROVEN cut (box clears the word) never caps — the belt needs the geometry",
      r and r["value"] == "Bramblewood Joinery Ltd" and "validation_note" not in r and r["method"] == "template_mapping")
r, _ = run_one(tm, CUT)
check("defer-cap: a SUCCESSFUL v1 heal is untouched (flagged fuller value, not the cap)",
      r and r["value"] == "Bramblewood Joinery Ltd" and r["method"].endswith("_namegrow"))

# ── 1. TEMPLATE_NAME_GROW_BAND_PICK ──────────────────────────────────────────
tm = arm(TEMPLATE_NAME_EDGE_GROW='1', TEMPLATE_NAME_GROW_BAND_PICK='1')
check("band-pick switch arms", tm._NAME_GROW_BAND_PICK_ON is True)
GROWN_READ[0] = "Greenacres Mill Lane"          # the preview path would still read the address line…
tm._NAME_BAND_READ_HOOK = lambda page, box, vt: ("Bramblewood Joinery Ltd", 91, 1)   # …the in-band line is the name
r, unmut = run_one(tm, CUT)
check("band-pick: ONE in-band line -> the grown re-read is that line, the v1 heal fires (flagged <=70 + note)",
      r and r["value"] == "Bramblewood Joinery Ltd" and r["confidence"] <= 70
      and r.get("validation_note") == tm._NAME_GROW_NOTE and r["method"].endswith("_namegrow"))
check("band-pick: stored mapping unmutated", unmut)
tm._NAME_BAND_READ_HOOK = lambda page, box, vt: ("Greenacres Mill Lane", 95, 2)      # 2 lines in band (over-tall box)
r, _ = run_one(tm, CUT)
check("band-pick: TWO in-band lines -> abstain; with the defer-cap OFF this is today's silent commit",
      r and r["value"] == "Bramblewood Joinery Ltc" and "validation_note" not in r)
tm = arm(TEMPLATE_NAME_EDGE_GROW='1', TEMPLATE_NAME_GROW_BAND_PICK='1', TEMPLATE_NAME_CUT_DEFER_CAP='1')
tm._NAME_BAND_READ_HOOK = lambda page, box, vt: ("Greenacres Mill Lane", 95, 2)
r, _ = run_one(tm, CUT)
check("band-pick + defer-cap: TWO in-band lines -> decline -> capped <=70 + edge-cut note (review, never the address line)",
      r and r["value"] == "Bramblewood Joinery Ltc" and r["confidence"] <= 70 and r.get("validation_note") == tm._EDGE_CUT_NOTE)
tm._NAME_BAND_READ_HOOK = lambda page, box, vt: (None, None, 0)
r, _ = run_one(tm, CUT)
check("band-pick: ZERO in-band lines -> decline (capped under the belt)", r and r["value"] == "Bramblewood Joinery Ltc" and r["confidence"] <= 70)
tm._NAME_BAND_READ_HOOK = None
_src = open(tm.__file__, encoding="utf-8").read()
_guard = _src[_src.index("def _abs_edge_guard("):_src.index("def _abs_edge_guard(") + 12000]
check("band-pick: the in-band read is called ONCE, inside the guard, only on the name_grow + BAND_PICK branch (the tight read is untouched)",
      _src.count("_name_band_read(page, grown") == 1 and "if name_grow and _NAME_GROW_BAND_PICK_ON:" in _guard
      and _guard.index("if name_grow and _NAME_GROW_BAND_PICK_ON:") < _guard.index("_name_band_read(page, grown")
      and "_name_band_read(page, target_box" not in _src)

# ── the in-band pick, pure (oscar re-audit 2026-09-08: the merged-line hole) ────────
L = lambda top, height, text: {"top": top, "height": height, "text": text, "mean_conf": 90}
band = (120, 140)                                    # a 20 px taught band in the prepped frame
ln_, n_ = tm._pick_band_line([L(100, 18, "Deliver To"), L(121, 19, "Bramblewood Joinery Ltd"), L(142, 18, "Unit 4, Sawpit Lane")], band)
check("pick: ONE line in the band -> picked, n=1", ln_ is not None and ln_["text"] == "Bramblewood Joinery Ltd" and n_ == 1)
ln_, n_ = tm._pick_band_line([L(118, 21, "Bramblewood Joinery Ltd"), L(130, 20, "Unit 4, Sawpit Lane")], band)
check("pick: TWO lines overlapping the band -> decline, n=2", ln_ is None and n_ == 2)
ln_, n_ = tm._pick_band_line([L(120, 40, "Bramblewood Joinery Ltd Unit 4, Sawpit Lane")], band)
check("pick: a MERGED line (2 rows fused by PSM 6, 2x the band, exactly 50% overlap) -> declined by the height guard",
      ln_ is None and n_ == 2)
ln_, n_ = tm._pick_band_line([L(119, 24, "Bramblewood Joinery Ltd")], band)
check("pick: a slightly taller single row (<=1.5x band) still picks", ln_ is not None and n_ == 1)
ln_, n_ = tm._pick_band_line([L(10, 18, "Deliver To")], band)
check("pick: no line in the band -> n=0", ln_ is None and n_ == 0)
ln_, n_ = tm._pick_band_line([{"top": None, "height": 18, "text": "x"}], band)
check("pick: a line without geometry is skipped", ln_ is None and n_ == 0)
check("_name_band_read routes through _pick_band_line (one pick rule)", "_pick_band_line(lines, (band[0] + _rs.BORDER_PX" in open(tm.__file__, encoding="utf-8").read())

# ── OFF: byte-identical to v1 ────────────────────────────────────────────────
GROWN_READ[0] = "Greenacres Mill Lane"
tm = arm(TEMPLATE_NAME_EDGE_GROW='1')
check("kill switches default OFF", tm._NAME_GROW_BAND_PICK_ON is False and tm._NAME_CUT_DEFER_CAP_ON is False)
r_off, _ = run_one(tm, CUT)
check("OFF: the exhibit-shaped decline commits exactly as v1 did (silent, uncapped, un-noted)",
      r_off and r_off["value"] == "Bramblewood Joinery Ltc" and r_off["confidence"] > 70 and "validation_note" not in r_off)
GROWN_READ[0] = "Bramblewood Joinery Ltd"
for k in ('TEMPLATE_NAME_EDGE_GROW', 'TEMPLATE_NAME_GROW_BAND_PICK', 'TEMPLATE_NAME_CUT_DEFER_CAP', 'TEMPLATE_ABS_EDGE_GUARD', 'NAMEGROW_CENSUS_DIR'):
    os.environ.pop(k, None)
print()
if FAILED:
    print(f"{len(FAILED)} FAILED"); sys.exit(1)
print("all name-grow-belt pins green")
