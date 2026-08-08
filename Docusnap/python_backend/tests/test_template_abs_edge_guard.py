"""Pins for Slice C — TEMPLATE_ABS_EDGE_GUARD (Oracle 2026-08-05, C-C0..C-C5; fork
RULED for 007's GROW). The jitter-crater class: a cut taught box on an undamaged
page reads a CLEAN PARTIAL that passes the type gate and commits silently at 78-90;
no shipped heal fires because they all key on page-vs-taught DISAGREEMENT. The guard
interrogates page WORD GEOMETRY at the absolute rung: a word cut by the read box's
edge -> grow the READ crop (never the stored mapping), full-res re-read, per-type
comparator, consent ladder; fail-toward-review floor.

Run: py -3.12 python_backend/tests/test_template_abs_edge_guard.py
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
        return box  # (x1, y1, x2, y2) px — the stub OCR fns key off this


PAGE = FakePage()

# One value word 'VXC1536' at x 0.30-0.40 (7 glyphs, g ~ 0.0143), row y 0.20-0.22.
WORD = {"text": "VXC1536", "x_norm": 0.30, "y_norm": 0.20, "w_norm": 0.10, "h_norm": 0.02}
LINES = [{"text": "VXC1536", "x_norm": 0.30, "y_norm": 0.20, "w_norm": 0.10, "h_norm": 0.02,
          "words": [WORD]}]


def ocr_text_stub(crop):
    """Partial read when the crop's right edge cuts the word; full read when it covers it."""
    x1, y1, x2, y2 = crop
    if y2 < 150 or y1 > 280:
        return None
    if x2 >= 398:
        return "VXC1536"
    if x2 >= 330:
        return "VXC153"
    return None


def box(x, w, y=0.195, h=0.03):
    return {"x_norm": x, "y_norm": y, "w_norm": w, "h_norm": h}


def mapping(target, anchor_text="Credit Note No:"):
    return {"field_key": "ref", "anchor_text": anchor_text, "page_number": 0, "enabled": 1,
            "anchor_x_norm": 0.10, "anchor_y_norm": 0.195, "anchor_w_norm": 0.12,
            "anchor_h_norm": 0.03,
            "target_x_norm": target["x_norm"], "target_y_norm": target["y_norm"],
            "target_w_norm": target["w_norm"], "target_h_norm": target["h_norm"]}


FP = {"ref": {"validation": "alphanumeric"}}
VAL = {"alphanumeric": [r"[A-Za-z0-9][A-Za-z0-9\-\/\.]{2,20}"],
       "date": [r"(?<!\d)\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}(?!\d)"]}


def run_one(tm, target, prov=None, fmt=None, lines=LINES, anchor_text="Credit Note No:"):
    lc = {(id(PAGE), 0.0, 0.0, 1.0, 1.0): lines}
    m = mapping(target, anchor_text)
    before = copy.deepcopy(m)
    r = tm._extract_one(PAGE, m, FP, lambda img: [], ocr_text_stub, located=None,
                        validation_patterns=VAL, format_lookup=fmt, line_cache=lc,
                        provisional_lookup=prov)
    return r, (m == before)


CUT = box(0.29, 0.07)        # right edge at 0.36 — cuts VXC1536 mid-word (reads 'VXC153')
FULL = box(0.29, 0.115)      # right edge at 0.405 — word fully inside (reads 'VXC1536')

# ── default OFF: byte-identical (C kill switch) ──────────────────────────────
os.environ.pop('TEMPLATE_ABS_EDGE_GUARD', None)
import extraction.template_mapper as tm
importlib.reload(tm)
check("kill switch default OFF", tm._ABS_EDGE_GUARD_ON is False)
r, unmut = run_one(tm, CUT)
check("OFF: the clean partial still commits silently (today's behaviour)",
      r and r["value"] == "VXC153" and r["method"] == "template_mapping"
      and r["confidence"] == 90 and "validation_note" not in r)
check("OFF: stored mapping unmutated", unmut)

# ── armed ────────────────────────────────────────────────────────────────────
os.environ['TEMPLATE_ABS_EDGE_GUARD'] = '1'
importlib.reload(tm)
check("switch arms", tm._ABS_EDGE_GUARD_ON is True)

# Predicate geometry matrix (thresholds per the Oracle-signed table).
lc, rc = tm._find_edge_cut_words(LINES, CUT)
check("predicate: right edge through the word -> right cut", rc is WORD and lc is None)
lc, rc = tm._find_edge_cut_words(LINES, FULL)
check("predicate: word fully inside -> no fire (clean-arm byte-identity mechanism)",
      lc is None and rc is None)
lc, rc = tm._find_edge_cut_words(LINES, box(0.29, 0.107))   # right edge 0.397: overhang 0.003
check("predicate: pad-nick (+0.003 overhang) -> no fire", lc is None and rc is None)
lc, rc = tm._find_edge_cut_words(LINES, box(0.29, 0.015))   # right edge 0.305: f=0.05 < 0.12
check("predicate: barely-entering neighbour word (f < 0.12) -> no fire",
      lc is None and rc is None)
far = [{"text": "X", "x_norm": 0.30, "y_norm": 0.60, "w_norm": 0.10, "h_norm": 0.02,
        "words": [{"text": "VXC1536", "x_norm": 0.30, "y_norm": 0.60, "w_norm": 0.10,
                   "h_norm": 0.02}]}]
lc, rc = tm._find_edge_cut_words(far, CUT)
check("predicate: word on another row -> no fire (row-band discipline)",
      lc is None and rc is None)
lw = {"text": "VXC1536", "x_norm": 0.20, "y_norm": 0.20, "w_norm": 0.10, "h_norm": 0.02}
lc, rc = tm._find_edge_cut_words([{"text": "VXC1536", "x_norm": 0.20, "y_norm": 0.20,
                                   "w_norm": 0.10, "h_norm": 0.02, "words": [lw]}],
                                 box(0.26, 0.10))
check("predicate: LEFT edge mirror fires", lc is lw and rc is None)

# Consent ladder outcomes (codes).
r, unmut = run_one(tm, CUT, prov=lambda fk, v: True)
check("heal: provisional consent -> CLEAN commit of the grown read, method _edgegrow",
      r and r["value"] == "VXC1536" and r["method"] == "template_mapping_edgegrow"
      and "validation_note" not in r)
check("heal: stored mapping unmutated (C-C3 pin)", unmut)

r, _ = run_one(tm, CUT)      # no history either way
check("no-history: grown value FLAGGED <=70 pre-filled for review",
      r and r["value"] == "VXC1536" and r["confidence"] <= 70
      and r["method"].endswith("_edgegrow") and r.get("validation_note"))

_orig_consents = tm._shape_consents
tm._shape_consents = lambda *a, **k: 'refused'
r, _ = run_one(tm, CUT)
tm._shape_consents = _orig_consents
check("PIN sub-token protection: shape REFUSED -> rigid partial kept SILENTLY, no flag",
      r and r["value"] == "VXC153" and r["method"] == "template_mapping"
      and "validation_note" not in r)

# Fail floor: grown read is a DIFFERENT value -> comparator refuses -> DEFERRED cap
# (fall-through contract: the guard returns defer_cap, the flow continues — the inline
# reconcile may still heal; nothing healed here, so the final commit wears the cap).
_orig_crop = tm._crop_and_ocr


def _wrong_grow(page, bx, vt, fn, capture=None, meta=None):
    x2 = (bx["x_norm"] + bx["w_norm"]) * 1000
    if x2 >= 398:
        return "ZZZ9999"                 # the grow read a neighbouring value
    return _orig_crop(page, bx, vt, fn, capture=capture, meta=meta)


tm._crop_and_ocr = _wrong_grow
r, _ = run_one(tm, CUT)
tm._crop_and_ocr = _orig_crop
check("floor: comparator refuses a different grown value -> rigid capped <=70 + note (_edgecut)",
      r and r["value"] == "VXC153" and r["confidence"] <= 70
      and r["method"].endswith("_edgecut") and r.get("validation_note"))

# PIN the fall-through contract itself: on comparator refusal the guard returns
# {'defer_cap': True}, NEVER a result — returning a result here amputated the inline
# reconcile and turned healable partials into capped partials on the clean arm
# ('PP-808' -> 'QPP-8083' class; the t300s->t300c diff).
tm._crop_and_ocr = _wrong_grow
lcx = {(id(PAGE), 0.0, 0.0, 1.0, 1.0): LINES}
eg = tm._abs_edge_guard(PAGE, CUT, False, 0.0, "VXC153", "alphanumeric", "ref",
                        lambda img: [], ocr_text_stub, VAL, None, None, lcx, None, None, 0)
tm._crop_and_ocr = _orig_crop
check("PIN: comparator refusal returns defer_cap (fall-through), never a result",
      eg == {"defer_cap": True})

# LEFT-cut SUFFIX heal (the '5S-1108' -> 'CSS-1108' class + the j120L crater): the cut
# glyph is the fragment's FIRST glyph — suffix discipline with one leading-glyph slack.
LWORD = {"text": "CSS-1108", "x_norm": 0.20, "y_norm": 0.20, "w_norm": 0.10, "h_norm": 0.02}
LLINES = [{"text": "CSS-1108", "x_norm": 0.20, "y_norm": 0.20, "w_norm": 0.10, "h_norm": 0.02,
           "words": [LWORD]}]


def _left_stub(crop):
    x1, y1, x2, y2 = crop
    if y2 < 150 or y1 > 280:
        return None
    if x1 <= 202:
        return "CSS-1108"                # full word covered
    if x1 <= 270:
        return "5S-1108"                 # left-clipped, cut glyph misread C -> 5
    return None


m = mapping(box(0.26, 0.10))             # left edge at 0.26 cuts CSS-1108
before = copy.deepcopy(m)
r = tm._extract_one(PAGE, m, FP, lambda img: [], _left_stub, located=None,
                    validation_patterns=VAL, format_lookup=None,
                    line_cache={(id(PAGE), 0.0, 0.0, 1.0, 1.0): LLINES},
                    provisional_lookup=lambda fk, v: True)
check("LEFT-cut suffix heal: '5S-1108' grows to 'CSS-1108' (leading-glyph slack)",
      r and r["value"] == "CSS-1108" and r["method"].endswith("_edgegrow"))
check("LEFT-cut heal: stored mapping unmutated", m == before)

# Date COMPLETE-read skip: an abs read that already parses as an un-suspect calendar
# date is never a partial — an edge overhang is box-overshoot noise, and a grown
# re-read can only corrupt it ('13-02-2026' -> '13-02-2096', observed on the clean arm).
def _full_date_stub(crop):
    x1, y1, x2, y2 = crop
    if y2 < 150 or y1 > 280:
        return None
    return "07-01-2026"


m = {"field_key": "d", "anchor_text": "Date:", "page_number": 0, "enabled": 1,
     "anchor_x_norm": 0.10, "anchor_y_norm": 0.195, "anchor_w_norm": 0.08, "anchor_h_norm": 0.03,
     "target_x_norm": 0.29, "target_y_norm": 0.195, "target_w_norm": 0.07, "target_h_norm": 0.03}
DW2 = {"text": "07-01-2026", "x_norm": 0.30, "y_norm": 0.20, "w_norm": 0.10, "h_norm": 0.02}
r = tm._extract_one(PAGE, m, {"d": {"validation": "date"}}, lambda img: [], _full_date_stub,
                    located=None, validation_patterns=VAL, format_lookup=None,
                    line_cache={(id(PAGE), 0.0, 0.0, 1.0, 1.0):
                                [{"text": "07-01-2026", "x_norm": 0.30, "y_norm": 0.20,
                                  "w_norm": 0.10, "h_norm": 0.02, "words": [DW2]}]},
                    provisional_lookup=None)
check("date complete-read SKIP: a full parsed date never fires the guard (no grow, no cap)",
      r and r["value"] == "07-01-2026" and r["method"] == "template_mapping"
      and r["confidence"] == 90 and "validation_note" not in r)

# No geometry -> fail-inert byte-identity (the honest no-word-boxes pin).
r, _ = run_one(tm, CUT, lines=[])
check("no word geometry -> byte-identical silent commit (fail-inert)",
      r and r["value"] == "VXC153" and r["method"] == "template_mapping"
      and r["confidence"] == 90)

# Cut-glyph comparator slack: last partial glyph misread ('VXC15Z' of VXC1536).
lcache = {(id(PAGE), 0.0, 0.0, 1.0, 1.0): LINES}


def _misread_partial(crop):
    x1, y1, x2, y2 = crop
    if y2 < 150 or y1 > 280:
        return None
    if x2 >= 398:
        return "VXC1536"
    if x2 >= 330:
        return "VXC15Z"                  # the cut glyph misread
    return None


m = mapping(CUT)
r = tm._extract_one(PAGE, m, FP, lambda img: [], _misread_partial, located=None,
                    validation_patterns=VAL, format_lookup=None, line_cache=lcache,
                    provisional_lookup=lambda fk, v: True)
check("comparator slack: <=1 trailing-glyph misread still heals ('VXC15Z' -> 'VXC1536')",
      r and r["value"] == "VXC1536" and r["method"].endswith("_edgegrow"))

# Dates: self-consent on a complete un-suspect parse; Slice-B composition (C-C1) —
# B armed rejects the fragment, C still fires off geometry and heals.
os.environ['TEMPLATE_DATE_CLIP_GATE'] = '1'
importlib.reload(tm)
DWORD = {"text": "07-01-2026", "x_norm": 0.30, "y_norm": 0.20, "w_norm": 0.10, "h_norm": 0.02}
DLINES = [{"text": "07-01-2026", "x_norm": 0.30, "y_norm": 0.20, "w_norm": 0.10, "h_norm": 0.02,
           "words": [DWORD]}]


def _date_stub(crop):
    x1, y1, x2, y2 = crop
    if y2 < 150 or y1 > 280:
        return None
    if x2 >= 398:
        return "07-01-2026"
    if x2 >= 330:
        return "07-01-20-"               # the clipped fragment (B rejects it)
    return None


m = {"field_key": "d", "anchor_text": "Date:", "page_number": 0, "enabled": 1,
     "anchor_x_norm": 0.10, "anchor_y_norm": 0.195, "anchor_w_norm": 0.08, "anchor_h_norm": 0.03,
     "target_x_norm": 0.29, "target_y_norm": 0.195, "target_w_norm": 0.07, "target_h_norm": 0.03}
r = tm._extract_one(PAGE, m, {"d": {"validation": "date"}}, lambda img: [], _date_stub,
                    located=None, validation_patterns=VAL, format_lookup=None,
                    line_cache={(id(PAGE), 0.0, 0.0, 1.0, 1.0): DLINES},
                    provisional_lookup=None)
check("C-C1 composition: B rejects the fragment, C's geometry still heals the date",
      r is not None and r["value"] == "07-01-2026" and r["method"].endswith("_edgegrow"))
os.environ.pop('TEMPLATE_DATE_CLIP_GATE', None)

# WITNESS SCOPE pin (live Larkspur exhibit 2026-08-05): a taught box narrower than its
# value word, overlapping the label tail — left_cut = the LABEL word ('No.'), excluded
# from the grow by the label bound. An unabsorbed cut word makes no claim in the grown
# value and must NOT veto the witness; the heal commits.
LBL = {"text": "No.", "x_norm": 0.24, "y_norm": 0.20, "w_norm": 0.03, "h_norm": 0.02}
VW = {"text": "DN-98447", "x_norm": 0.30, "y_norm": 0.20, "w_norm": 0.10, "h_norm": 0.02}
NARROW_LINES = [{"text": "No. DN-98447", "x_norm": 0.24, "y_norm": 0.20, "w_norm": 0.16,
                 "h_norm": 0.02, "words": [LBL, VW]}]


def _narrow_stub(crop):
    x1, y1, x2, y2 = crop
    if y2 < 150 or y1 > 280:
        return None
    if x1 <= 302 and x2 >= 398:
        return "DN-98447"                # grown box covers the whole value word
    if x2 >= 330:
        return "N-9844"                  # narrow box: both edges inside the value word
    return None


m = mapping(box(0.25, 0.095))            # left edge inside 'No.', right edge inside 'DN-98447'
loc = {"matched_text": "Delivery Note No.",
       "label_box": {"x_norm": 0.18, "y_norm": 0.20, "w_norm": 0.092, "h_norm": 0.02}}
r = tm._extract_one(PAGE, m, FP, lambda img: [], _narrow_stub, located=loc,
                    validation_patterns=VAL, format_lookup=None,
                    line_cache={(id(PAGE), 0.0, 0.0, 1.0, 1.0): NARROW_LINES},
                    provisional_lookup=lambda fk, v: True)
check("witness scope: unabsorbed left-cut label word never vetoes — 'N-9844' heals to 'DN-98447'",
      r is not None and r["value"] == "DN-98447" and r["method"].endswith("_edgegrow"))

# INDEPENDENT-WITNESS pin: the grown re-read must CONTAIN each ABSORBED cut word's
# locate-pass text — a corrupted extension ('VXC1536' word but grown read 'VXC1596')
# falls through (defer_cap), never a clean commit (the '13-02-2096'/'POH-49938' class).
def _corrupt_grow(crop):
    x1, y1, x2, y2 = crop
    if y2 < 150 or y1 > 280:
        return None
    if x2 >= 398:
        return "VXC1596"                 # tail corrupted vs the word text 'VXC1536'
    if x2 >= 330:
        return "VXC153"
    return None


m = mapping(CUT)
r = tm._extract_one(PAGE, m, FP, lambda img: [], _corrupt_grow, located=None,
                    validation_patterns=VAL, format_lookup=None,
                    line_cache={(id(PAGE), 0.0, 0.0, 1.0, 1.0): LINES},
                    provisional_lookup=lambda fk, v: True)
check("PIN witness: corrupted grow extension -> defer_cap floor, never a clean commit",
      r and r["value"] == "VXC153" and r["confidence"] <= 70
      and r["method"].endswith("_edgecut"))

# Junk-wrapped COMPLETE date skip: 'TE 13-02-2026' contains a 4-digit-year match ->
# the guard never fires (Stage-4 normalise owns the junk); a clean 2-digit-year read
# still fires (it may be a cut 4-digit year — geometry is the judge, pinned trade-off).
def _junk_date_stub(crop):
    x1, y1, x2, y2 = crop
    if y2 < 150 or y1 > 280:
        return None
    return "TE 13-02-2026"


m = {"field_key": "d", "anchor_text": "Date:", "page_number": 0, "enabled": 1,
     "anchor_x_norm": 0.10, "anchor_y_norm": 0.195, "anchor_w_norm": 0.08, "anchor_h_norm": 0.03,
     "target_x_norm": 0.29, "target_y_norm": 0.195, "target_w_norm": 0.07, "target_h_norm": 0.03}
DW3 = {"text": "13-02-2026", "x_norm": 0.30, "y_norm": 0.20, "w_norm": 0.10, "h_norm": 0.02}
r = tm._extract_one(PAGE, m, {"d": {"validation": "date"}}, lambda img: [], _junk_date_stub,
                    located=None, validation_patterns=VAL, format_lookup=None,
                    line_cache={(id(PAGE), 0.0, 0.0, 1.0, 1.0):
                                [{"text": "13-02-2026", "x_norm": 0.30, "y_norm": 0.20,
                                  "w_norm": 0.10, "h_norm": 0.02, "words": [DW3]}]},
                    provisional_lookup=None)
check("junk-wrapped complete 4-digit-year date -> guard never fires",
      r and r["value"] == "TE 13-02-2026" and r["method"] == "template_mapping"
      and "validation_note" not in r)

os.environ.pop('TEMPLATE_ABS_EDGE_GUARD', None)
importlib.reload(tm)

print()
if FAILED:
    print(f"{len(FAILED)} FAILED")
    sys.exit(1)
print("All abs edge-guard checks passed.")
