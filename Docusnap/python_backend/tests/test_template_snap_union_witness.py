"""Pins for TEMPLATE_SNAP_UNION_WITNESS — the snap-union GEOMETRY WITNESS in the
_abs_edge_guard consent ladder (Oracle SIGN-OFF-W/COND 2026-08-06, docs/oracle_log.md).

The class: a taught CODE box, transferred to a sibling, clips the value so the rigid read
garbles ('VIN-O0U5D' of DN-58038). The edge-guard grows + re-reads the true value, but the
glyph comparator _frag_matches can't connect the garbled clip to the fuller read (zero shared
glyphs) -> it floors and the correct value ships FLAGGED @70. When the LOCATE-tier words inside
the grown box reconstruct the grown read EXACTLY + CONTIGUOUSLY + edge-ANCHORED to the un-cut side
of the TAUGHT box, that independent geometry stands in for the missing shape history (teach-once)
and licenses a CLEAN heal. It SKIPS ONLY _frag_matches — the negative cut-word veto and the
`refused` protection still gate. Codes only; both-cut (no un-cut edge) never promotes in v1.

Run: py -3.12 python_backend/tests/test_template_snap_union_witness.py
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
        return box                       # (x1, y1, x2, y2) px — stub OCR fns key off this


PAGE = FakePage()
FP = {"ref": {"validation": "alphanumeric"}}
VAL = {"alphanumeric": [r"[A-Za-z0-9][A-Za-z0-9\-\/\.]{2,20}"],
       "date": [r"(?<!\d)\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}(?!\d)"]}


def word(text, x, w, y=0.20, h=0.02):
    return {"text": text, "x_norm": x, "y_norm": y, "w_norm": w, "h_norm": h}


def line(text, x, w, words, y=0.20, h=0.02):
    return [{"text": text, "x_norm": x, "y_norm": y, "w_norm": w, "h_norm": h, "words": words}]


def mapping(x, w, y=0.195, h=0.03, anchor_text="Delivery Note No."):
    return {"field_key": "ref", "anchor_text": anchor_text, "page_number": 0, "enabled": 1,
            "anchor_x_norm": 0.10, "anchor_y_norm": y, "anchor_w_norm": 0.12, "anchor_h_norm": h,
            "target_x_norm": x, "target_y_norm": y, "target_w_norm": w, "target_h_norm": h}


def run(tm, m, lines, ocr_text_fn, fmt=None, prov=None):
    lc = {(id(PAGE), 0.0, 0.0, 1.0, 1.0): lines}
    before = copy.deepcopy(m)
    r = tm._extract_one(PAGE, m, FP, lambda img: [], ocr_text_fn, located=None,
                        validation_patterns=VAL, format_lookup=fmt, line_cache=lc,
                        provisional_lookup=prov)
    return r, (m == before)


# ── The canonical heal geometry: value word 'DN-58038' at x 0.30-0.40 (8 glyphs, g=0.0125),
#    taught box 0.30-0.37 (right edge cuts the word -> single RIGHT cut, value LEFT edge anchored
#    at the taught left). Narrow box garbles ('VINO0U5D'); grown box (to 0.404) reads the truth. ──
DN_LINES = line("DN-58038", 0.30, 0.10, [word("DN-58038", 0.30, 0.10)])


def stub_accept(crop):
    x1, y1, x2, y2 = crop
    if y2 < 150 or y1 > 280:
        return None
    if x2 >= 402:
        return "DN-58038"                # grown box covers the full word
    if x2 >= 360:
        return "VINO0U5D"                # narrow taught box: garbled clip (frag can't rescue)
    return None


# ── OFF: byte-identical — the garbled clip floors to a FLAG, exactly as the edge-guard alone ──
os.environ['TEMPLATE_ABS_EDGE_GUARD'] = '1'
os.environ.pop('TEMPLATE_SNAP_UNION_WITNESS', None)
import extraction.template_mapper as tm
importlib.reload(tm)
check("witness kill switch default OFF", tm._SNAP_UNION_WITNESS_ON is False)
r, unmut = run(tm, mapping(0.30, 0.07), DN_LINES, stub_accept)
check("OFF: garbled clip floors -> rigid FLAGGED <=70 + note (today's edge-guard behaviour)",
      r and r["value"] != "DN-58038" and r["confidence"] <= 70
      and r["method"].endswith("_edgecut") and r.get("validation_note"))
check("OFF: stored mapping unmutated", unmut)

# ── ARMED ──
os.environ['TEMPLATE_SNAP_UNION_WITNESS'] = '1'
importlib.reload(tm)
check("witness switch arms", tm._SNAP_UNION_WITNESS_ON is True)

# ACCEPT: independent geometry reconstructs DN-58038 at the taught slot -> CLEAN heal.
r, unmut = run(tm, mapping(0.30, 0.07), DN_LINES, stub_accept)
check("ACCEPT: garbled clip heals CLEAN to 'DN-58038' (method _edgegrow, no flag, uncapped)",
      r and r["value"] == "DN-58038" and r["method"].endswith("_edgegrow")
      and r["confidence"] > 70 and "validation_note" not in r)
check("ACCEPT: census tag is 'healed_witness'",
      tm._EDGE_GUARD_FIRES and tm._EDGE_GUARD_FIRES[-1][2] == "healed_witness")
check("ACCEPT: stored mapping unmutated (C-C3)", unmut)

# ── REJECT the STRADDLE (the load-bearing neighbour guard). Value word displaced 0.35*W right of
#    the taught left edge: OCCUPANCY passes (0.65 >= 0.6) but the directional anchor FAILS
#    (0.035 > 0.25*0.10). MUST flag, not heal. This test FAILS if the guard is ever loosened to
#    occupancy-only — the whole reason 007's un-cut-edge anchor is in. ──
STRADDLE_LINES = line("DN-58038", 0.335, 0.10, [word("DN-58038", 0.335, 0.10)])


def stub_straddle(crop):
    x1, y1, x2, y2 = crop
    if y2 < 150 or y1 > 280:
        return None
    if x2 >= 437:
        return "DN-58038"                # grown box (to 0.439) reads the displaced value
    if x2 >= 395:
        return "VINO0U5D"                # narrow taught box (to 0.40) garbles
    return None


r, _ = run(tm, mapping(0.30, 0.10), STRADDLE_LINES, stub_straddle)
check("REJECT straddle: value displaced 0.35*W (occupancy passes, anchor fails) -> FLAG not heal",
      r and r["value"] != "DN-58038" and r["confidence"] <= 70
      and r["method"].endswith("_edgecut"))

# ── REJECT both-cut (LR): no un-cut edge to anchor -> never a v1 clean promotion. Taught box
#    0.32-0.38 sits INSIDE the value word 0.30-0.40 (both edges cut). ──
LR_LINES = line("DN-58038", 0.30, 0.10, [word("DN-58038", 0.30, 0.10)])


def stub_lr(crop):
    x1, y1, x2, y2 = crop
    if y2 < 150 or y1 > 280:
        return None
    if x1 <= 298 and x2 >= 402:
        return "DN-58038"                # grown box covers the whole word
    if x2 >= 375:
        return "VINO0U5D"                # narrow inner box garbles
    return None


# sanity: the predicate really did see a both-cut geometry
lc, rc = tm._find_edge_cut_words(LR_LINES, {"x_norm": 0.32, "y_norm": 0.195,
                                            "w_norm": 0.06, "h_norm": 0.03})
check("LR predicate: both edges cut the value word (edges == 'LR')", lc is not None and rc is not None)
r, _ = run(tm, mapping(0.32, 0.06), LR_LINES, stub_lr)
check("REJECT LR: both-cut has no un-cut edge -> FLAG not heal (pins the v1 conservatism)",
      r and r["value"] != "DN-58038" and r["confidence"] <= 70
      and r["method"].endswith("_edgecut"))

# ── REFUSED shape beats the witness: a confirmed sub-token teach means the operator meant the
#    cut. Same accept geometry, but _shape_consents -> 'refused' -> keep the rigid read SILENTLY
#    (no flag, no clean swap). Pins that the new witness path preserves the 1762 protection. ──
_orig = tm._shape_consents
tm._shape_consents = lambda *a, **k: 'refused'
r, _ = run(tm, mapping(0.30, 0.07), DN_LINES, stub_accept)
tm._shape_consents = _orig
check("REFUSED beats witness: rigid clip kept SILENTLY (method template_mapping, no swap, no flag)",
      r and r["value"] != "DN-58038" and r["method"] == "template_mapping"
      and "validation_note" not in r)

# ── helper-level pins (direct, tolerance-exact) ──
GROWN = {"x_norm": 0.30, "y_norm": 0.195, "w_norm": 0.104, "h_norm": 0.03}
TB = {"x_norm": 0.30, "w_norm": 0.07}
check("helper ACCEPT: exact union, R-cut, anchored -> True",
      tm._snap_union_witness(DN_LINES, GROWN, 0.30, 0.404, "DN-58038", TB, 'R') is True)
check("helper SUPERSET union -> False (extra neighbour token breaks exact equality)",
      tm._snap_union_witness(line("DN-58038 REF", 0.30, 0.16,
                                  [word("DN-58038", 0.30, 0.10), word("REF", 0.41, 0.05)]),
                             {"x_norm": 0.30, "y_norm": 0.195, "w_norm": 0.17, "h_norm": 0.03},
                             0.30, 0.47, "DN-58038", TB, 'R') is False)
check("helper LR -> False (no un-cut edge)",
      tm._snap_union_witness(DN_LINES, GROWN, 0.30, 0.404, "DN-58038", TB, 'LR') is False)
check("helper cross-column STITCH -> False (adjacent gap > 1.5*g)",
      tm._snap_union_witness(line("DN 58038", 0.30, 0.30,
                                  [word("DN", 0.30, 0.03), word("58038", 0.55, 0.06)]),
                             {"x_norm": 0.30, "y_norm": 0.195, "w_norm": 0.32, "h_norm": 0.03},
                             0.30, 0.62, "DN-58038", TB, 'R') is False)

os.environ.pop('TEMPLATE_SNAP_UNION_WITNESS', None)
os.environ.pop('TEMPLATE_ABS_EDGE_GUARD', None)
importlib.reload(tm)

print()
if FAILED:
    print(f"{len(FAILED)} FAILED")
    sys.exit(1)
print("All snap-union witness checks passed.")
