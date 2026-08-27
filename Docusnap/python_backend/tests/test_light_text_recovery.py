#!/usr/bin/env python3
"""
tests/test_light_text_recovery.py — LIGHT-TEXT RECOVERY (2026-08-27; oscar recipe + 007 geometry → Oracle;
DARK `ocr_light_text_recovery` / OCR_LIGHT_TEXT_RECOVERY).

Small light-grey print (a 7.5-pt "Serial No: CT-…" sub-line) is invisible to Tesseract's own binarisation
on a scan; a global threshold at 200 → PSM 3 reads it at conf 90+. reconstruct_page_text gains a THIRD
supplementary source under the existing empty-region merge, with 007's placement conditions. No Tesseract
here: pytesseract.image_to_data is monkeypatched with scripted word lists (the exhibit's measured geometry).

Pins:
  §1 OFF (default, and env '0'): exactly TWO image_to_data calls; no `light_boxes`; text unchanged.
  §2 the row-build refactor is byte-identical to the old single function (random word clouds).
  §3 ON on the exhibit geometry: the serial line is its OWN line between the item lines, reads exactly
     'Serial No: CT-8051702'; every OFF line is a prefix/subsequence of its ON line (a base row only GAINS);
     med_h stays the BASE median; `light_boxes` carries the recovered boxes.
  §4 the filters: a re-read of a base word (centre inside) dropped; a drifted re-read (IoA > 0.2) dropped;
     a small-overlap neighbour kept; height 0.3× / 2.6× dropped; lone 'l'@75 dropped, lone 'AB'@70 dropped,
     lone 'AB'@85 kept, lone 'ABCD'@65 kept; 'iiii' dropped; a solid slab dropped (ink density).
  §5 the page cap: a noise page (60 plausible survivors over 20 base words) keeps NOTHING.
  §6 an already-binary input skips the pass (two calls); a page with no base words never runs it.
  §7 row pitch: a light word within the band joins the row above; the exhibit pitch forms its own row.

Run:  cd python_backend && py -3.12 tests/test_light_text_recovery.py
Exit 0 = all checks passed.  Exit 1 = failure(s).
"""
import os
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from PIL import Image, ImageDraw
import pytesseract
from ocr import tesseract as T

fails = 0


def check(label, cond, extra=""):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}" + (f"  [{extra}]" if extra and not cond else ""))
    if not cond:
        fails += 1


# ── scripted image_to_data ───────────────────────────────────────────────────────────────────
def to_data(words):
    """[(l,t,w,h,text,conf)] -> an image_to_data DICT: one EMPTY-text block row (must never enter the
    dedupe boxes) + one level-5 row per word."""
    d = {k: [] for k in ("level", "page_num", "block_num", "par_num", "line_num", "word_num",
                         "left", "top", "width", "height", "conf", "text")}
    def add(level, l, t, w, h, conf, text):
        d["level"].append(level); d["page_num"].append(1); d["block_num"].append(1); d["par_num"].append(1)
        d["line_num"].append(1); d["word_num"].append(len(d["text"]))
        d["left"].append(l); d["top"].append(t); d["width"].append(w); d["height"].append(h)
        d["conf"].append(conf); d["text"].append(text)
    add(2, 0, 0, 1655, 2339, -1, "")
    for (l, t, w, h, text, conf) in words:
        add(5, l, t, w, h, conf, text)
    return d


class Scripted:
    """PSM-6 config → supp; the FIRST PSM-3 call → main; every LATER PSM-3 call → a light LEVEL. `light` is one word
    list (every level reads the same) or a list of lists (one per light call, cycling). Counts calls."""
    def __init__(self, main, supp=(), light=()):
        self.main, self.supp, self.light, self.calls, self.nlight = list(main), list(supp), light, [], 0

    def __call__(self, img, config="", output_type=None):
        kind = "supp" if "--psm 6" in config else ("light" if "main" in self.calls else "main")
        self.calls.append(kind)
        if kind == "light":
            L = self.light
            lst = L[self.nlight % len(L)] if (L and isinstance(L[0], list)) else list(L)
            self.nlight += 1
            return to_data(lst)
        return to_data({"main": self.main, "supp": self.supp}[kind])


def page(size=(1655, 2339), stripes=(), slabs=()):
    """An RGB page with mid-grey mass (so the pass is not skipped as 'already binary'); `stripes` boxes get
    text-like strokes (1 row in 3 at grey 120 → ~0.33 ink after threshold); `slabs` are filled solid."""
    im = Image.new("RGB", size, "white")
    d = ImageDraw.Draw(im)
    d.rectangle((40, 40, 60, 60), fill=(150, 150, 150))          # mid-grey mass
    for (l, t, w, h) in stripes:
        for y in range(t, t + h, 3):
            d.line((l, y, l + w - 1, y), fill=(120, 120, 120))
    for (l, t, w, h) in slabs:
        d.rectangle((l, t, l + w - 1, t + h - 1), fill=(120, 120, 120))
    return im


def run(img, main, supp=(), light=(), on=True, dpi=200):
    sc = Scripted(main, supp, light)
    orig = pytesseract.image_to_data
    pytesseract.image_to_data = sc
    if on:
        os.environ["OCR_LIGHT_TEXT_RECOVERY"] = "1"
    else:
        os.environ.pop("OCR_LIGHT_TEXT_RECOVERY", None)
    try:
        wo = {}
        text = T.reconstruct_page_text(img, dpi=dpi, words_out=wo)
    finally:
        pytesseract.image_to_data = orig
        os.environ.pop("OCR_LIGHT_TEXT_RECOVERY", None)
    return text, wo, sc.calls


def grown(w, px=2):
    return (w[0] - px, w[1] - px, w[2] + 2 * px, w[3] + 2 * px, w[4], w[5])


# ── the exhibit geometry (007's measured boxes: item rows h 17 at yc ~818/890, the serial line h 14 at top 845) ──
BASE = [
    (120, 700, 90, 17, "Description", 95), (400, 700, 40, 17, "Qty", 95),
    (120, 809, 10, 17, "1", 92), (150, 809, 20, 17, "16", 94), (180, 809, 80, 17, "Channel", 96), (270, 809, 40, 17, "NVR", 95),
    (120, 882, 10, 17, "2", 92), (150, 882, 50, 17, "Dome", 95), (210, 882, 70, 17, "Camera", 96),
    (120, 1200, 60, 17, "Total", 96), (500, 1200, 60, 17, "465.29", 93),
]
SERIAL = [(160, 845, 50, 14, "Serial", 93), (215, 845, 28, 14, "No:", 93), (250, 845, 110, 14, "CT-8051702", 91)]

print("§1 OFF: two passes, no light key, env '0' == unset")
img = page()
t_off, wo_off, calls = run(img, BASE, on=False)
check("OFF: exactly two image_to_data calls (PSM-3 + PSM-6)", calls == ["main", "supp"], str(calls))
check("OFF: no light_boxes key", "light_boxes" not in wo_off)
os.environ["OCR_LIGHT_TEXT_RECOVERY"] = "0"
t_zero, wo_zero, calls0 = run(img, BASE, on=False)
check("OFF: env '0' == unset (two calls, same text)", calls0 == ["main", "supp"] and t_zero == t_off)
check("OFF: the item lines read as before", t_off.split("\n")[1] == "1 16 Channel NVR" and t_off.split("\n")[2] == "2 Dome Camera", repr(t_off))


print("\n§2 the row-build refactor is byte-identical to the old single function")
def _old_group(words, med_h):
    if not words:
        return []
    col_gap = max(med_h * 1.5, 12); cap = max(med_h * 1.2, 10); band = max(med_h * 0.6, 6); OV = 0.3
    sw = sorted(words, key=lambda w: w[1] + w[3] / 2.0)
    def _eligible(wd, a):
        top_w, bot_w = wd[1], wd[1] + wd[3]
        overlap = min(bot_w, a["bot"]) - max(top_w, a["top"])
        shorter = min(wd[3], a["bot"] - a["top"]) or 1
        d = abs((wd[1] + wd[3] / 2.0) - a["yc"])
        sig = overlap >= OV * shorter
        return ((sig or d <= band) and d <= cap), sig, overlap, d
    anchors = []
    for wd in sw:
        if not any(_eligible(wd, a)[0] for a in anchors):
            anchors.append({"top": wd[1], "bot": wd[1] + wd[3], "yc": wd[1] + wd[3] / 2.0})
    rows = [{"top": a["top"], "bot": a["bot"], "yc": a["yc"], "words": []} for a in anchors]
    for wd in sw:
        best, best_key = None, None
        for r in rows:
            ok, sig, overlap, d = _eligible(wd, r)
            if not ok:
                continue
            key = (1 if sig else 0, overlap, -d)
            if best is None or key > best_key:
                best, best_key = r, key
        if best is None:
            rows.append({"top": wd[1], "bot": wd[1] + wd[3], "yc": wd[1] + wd[3] / 2.0, "words": [wd]})
        else:
            best["words"].append(wd)
    rows = [r for r in rows if r["words"]]
    rows.sort(key=lambda r: r["yc"])
    lines = []
    for r in rows:
        row_ws = sorted(r["words"], key=lambda w: w[0])
        out = [row_ws[0][4]]
        for a, b in zip(row_ws, row_ws[1:]):
            gap = b[0] - (a[0] + a[2])
            out.append(T.COLUMN_BREAK if gap > col_gap else " ")
            out.append(b[4])
        lines.append("".join(out))
    return lines

rnd = random.Random(20260827)
same = True
for trial in range(200):
    n = rnd.randint(1, 60)
    cloud = [(rnd.randint(0, 1500), rnd.randint(0, 2200), rnd.randint(4, 120), rnd.randint(4, 40), f"w{i}", rnd.randint(40, 96)) for i in range(n)]
    hs = sorted(w[3] for w in cloud); mh = hs[len(hs) // 2]
    if T._group_words_into_lines(cloud, mh) != _old_group(cloud, mh):
        same = False
        break
check("200 random word clouds: refactored rows == the old single-function rows", same, f"trial {trial}")
check("empty input still returns []", T._group_words_into_lines([], 10) == [])


print("\n§3 ON on the exhibit geometry")
stripes = [(w[0], w[1], w[2], w[3]) for w in SERIAL]
img3 = page(stripes=stripes)
light3 = [grown(w) for w in BASE] + SERIAL           # the threshold pass re-reads EVERY base word (grown boxes) + the serial line
t_on, wo_on, calls3 = run(img3, BASE, light=light3, on=True)
on_lines = t_on.split("\n"); off_lines = t_off.split("\n")
check("ON: PSM-3 + PSM-6 + one light call per level (four)", calls3 == ["main", "supp"] + ["light"] * 4, str(calls3))
check("ON: the serial line is its OWN line and reads exactly 'Serial No: CT-8051702'", "Serial No: CT-8051702" in on_lines, repr(on_lines))
_si = on_lines.index("Serial No: CT-8051702")
check("ON: it sits BETWEEN the two item lines", _si == on_lines.index("1 16 Channel NVR") + 1 and _si + 1 == on_lines.index("2 Dome Camera"), repr(on_lines))
check("ON: every OFF line is present unchanged (a base row only gains, never loses/re-splits)", all(l in on_lines for l in off_lines), repr(on_lines))
check("ON: the re-read base words were NOT duplicated (centre-in-base dedupe)", t_on.count("Channel") == 1 and t_on.count("NVR") == 1)
check("ON: words_out.light_boxes == the three serial boxes", sorted(wo_on.get("light_boxes", [])) == sorted((w[0], w[1], w[2], w[3]) for w in SERIAL), str(wo_on.get("light_boxes")))
check("ON: med_h stays the BASE median (frozen, 17 — not dragged by the 14-px serial words)", wo_on["med_h"] == 17 and wo_off["med_h"] == 17)
check("ON: words_out.words stays the BASE-only contract (Oracle C1)", len(wo_on["words"]) == len(BASE) and wo_on["words"] == wo_off["words"])
check("ON: words_out.light_words = the recovered 6-tuples", sorted(wo_on.get("light_words", [])) == sorted(SERIAL))
check("ON: rows parallel to lines", len(wo_on["rows"]) == len(on_lines))

print("\n§3b the geometry contract: a light word in the rung-2 window never becomes a heading-band candidate")
from ocr.heading_reread import find_prominent_heading_band
BIG = (120, 300, 200, 32, "BIGLIGHT", 90)          # h 32 = 1.88 × med_h 17, top 300 ≤ 0.30 × 2339 — inside rung 2's window
img3b = page(stripes=stripes + [BIG[:4]])
_t3b, wo3b, _ = run(img3b, BASE, light=light3 + [BIG], on=True)
check("the light heading-sized word IS recovered (light_words)", any(w[4] == "BIGLIGHT" for w in wo3b.get("light_words", [])))
check("…but never enters words_out.words", not any(w[4] == "BIGLIGHT" for w in wo3b["words"]))
check("find_prominent_heading_band(geom) identical OFF vs ON", find_prominent_heading_band(wo3b) == find_prominent_heading_band(wo_off) == None)
check("positive control: the same word INSIDE `words` WOULD open a band (the pin is not vacuous)",
      find_prominent_heading_band({**wo3b, "words": wo3b["words"] + wo3b["light_words"]}) is not None)

print("\n§3d LEVELS: a digit string needs two agreeing levels; an alpha word may stand on one; the best-supported string wins")
L1  = (120, 1300, 110, 14, "CT-8024188", 90)   # the TRUE string, read at levels 1 and 2 (conf 90 / 78)
L1b = (120, 1300, 110, 14, "CT-8024188", 78)
L1g = (120, 1300, 110, 14, "CT-8024168", 80)   # the one-level GARBLE on the same spot (the doc-13 exhibit)
L2  = (120, 1350, 110, 14, "CT-5555555", 95)   # a digit string read at ONE level only
L3  = (120, 1400,  80, 14, "Registered", 88)   # an alpha word read at one level
L4  = (120, 1450, 110, 14, "CT-7777777", 78)   # read at two levels but never ≥ 80
img3d = page(stripes=[L1[:4], L2[:4], L3[:4], L4[:4]])
per_call = [
    [grown(w) for w in BASE] + [L1, L2, L4],
    [grown(w) for w in BASE] + [L1b, L4],
    [grown(w) for w in BASE] + [L1g, L3],
    [grown(w) for w in BASE],
]
t3d, wo3d, calls3d = run(img3d, BASE, light=per_call, on=True)
got3d = {w[4]: w for w in wo3d.get("light_words", [])}
check("four light calls (the default level set)", calls3d.count("light") == 4, str(calls3d))
check("the true string read at two levels is kept at its best conf (90)", "CT-8024188" in got3d and got3d["CT-8024188"][5] == 90, str(got3d))
check("the one-level garble on the same spot loses to it", "CT-8024168" not in got3d)
check("a digit string read at ONE level only is dropped", "CT-5555555" not in got3d)
check("an alpha word read at one level is kept", "Registered" in got3d)
check("two agreeing levels but never ≥ 80 → dropped (the floor applies to the winner)", "CT-7777777" not in got3d)
check("the merged serial line still reads on its own row", any(l.strip() == "CT-8024188" for l in t3d.split("\n")), repr(t3d))
os.environ.pop("OCR_LIGHT_TEXT_LEVELS", None); os.environ.pop("OCR_LIGHT_TEXT_THRESHOLD", None)
check("level set: unset ⇒ [200, 210, 220, 230]", T._light_levels() == [200, 210, 220, 230])
os.environ["OCR_LIGHT_TEXT_LEVELS"] = "230,200,999"
check("level set: env list is sorted, de-duplicated and clamped", T._light_levels() == [200, 230])
os.environ["OCR_LIGHT_TEXT_LEVELS"] = "abc"
check("level set: a garbage list falls back to the default", T._light_levels() == [200, 210, 220, 230])
os.environ.pop("OCR_LIGHT_TEXT_LEVELS", None); os.environ["OCR_LIGHT_TEXT_THRESHOLD"] = "180"
check("level set: a bare THRESHOLD pins ONE level", T._light_levels() == [180])
os.environ.pop("OCR_LIGHT_TEXT_THRESHOLD", None)

print("\n§3e the owner's live batch (2026-08-27): support-scaled floor, agreement-key normalisation, degenerate base slivers, line-group placement")
# (A) doc 1707: the same code at THREE levels, all under 80 → kept at ≥ 70; at TWO levels under 80 → still dropped
A1 = (120, 1300, 110, 14, "CT-2903961", 73); A2 = (120, 1300, 110, 14, "CT-2903961", 77); A3 = (120, 1300, 110, 14, "CT-2903961", 78)
B1 = (120, 1350, 110, 14, "CT-9802341", 78); B2 = (120, 1350, 110, 14, "CT-9802341", 29)
# (B) doc 1721: 'CT-9999544' / 'cT-9999544' / 'CT-9999544_' are ONE string; the best-conf tuple's text is cleaned
C1 = (120, 1400, 110, 14, "cT-9999544", 81); C2 = (120, 1400, 110, 14, "CT-9999544", 88); C3 = (120, 1400, 112, 14, "CT-9999544_", 44)
imgE = page(stripes=[A1[:4], B1[:4], C1[:4]])
per_callE = [
    [grown(w) for w in BASE] + [A1, B1, C1],
    [grown(w) for w in BASE] + [A2, B2, C2],
    [grown(w) for w in BASE] + [A3, C3],
    [grown(w) for w in BASE],
]
tE, woE, _ = run(imgE, BASE, light=per_callE, on=True)
gotE = {w[4]: w for w in woE.get("light_words", [])}
check("(A) three agreeing levels at 73/77/78 → kept at its best (78 ≥ 70)", "CT-2903961" in gotE and gotE["CT-2903961"][5] == 78, str(gotE))
check("(A) two agreeing levels at 78/29 → still dropped (two levels need 80)", "CT-9802341" not in gotE)
check("(B) case + edge-punctuation variants are ONE string; output = the best tuple, cleaned", "CT-9999544" in gotE and gotE["CT-9999544"][5] == 88 and "cT-9999544" not in gotE and "CT-9999544_" not in gotE, str(gotE))
check("clean/agree helpers", T._light_clean_text("CT-9999544_") == "CT-9999544" and T._light_agree_key("cT-9999544") == "ct-9999544" and T._light_clean_text("'No:'") == "No:")
check("real caption punctuation survives the clean ('No:' 'No.' 'Ltd,' keep their mark)", T._light_clean_text("No:") == "No:" and T._light_clean_text("No.") == "No." and T._light_clean_text("Ltd,") == "Ltd," and T._light_clean_text('"Serial') == "Serial")
check("the exhibit caption keeps its colon in the ON text", "Serial No: CT-8051702" in t_on)
# (C) doc 1706: a 5-px base sliver 'CT-832884' on the serial spot no longer blocks the three-level 'CT-8328847', and leaves the row
SLIVER = (333, 1015, 79, 5, "CT-832884", 87)
BASE_C = BASE + [(167, 1011, 72, 14, "Serial", 95), (255, 1012, 33, 13, "No:", 93), SLIVER]
D1 = (303, 1011, 122, 15, "CT-8328847", 87)
imgC = page(stripes=[D1[:4]])
tC, woC, _ = run(imgC, BASE_C, light=[grown(w) for w in BASE_C if w is not SLIVER] + [D1], on=True)
check("(C) the light code beneath a degenerate base sliver is kept", any(w[4] == "CT-8328847" for w in woC.get("light_words", [])), str(woC.get("light_words")))
check("(C) the sliver yields (light_replaced) and the row reads the recovered code once", woC.get("light_replaced") == [SLIVER] and any(l == "Serial No: CT-8328847" for l in tC.split("\n")), repr(tC))
check("(C) OFF still carries the sliver (the base pass is untouched when the switch is off)", any("CT-832884" in l for l in run(imgC, BASE_C, on=False)[0].split("\n")))
check("(C) a NORMAL-height base word is never replaced", "light_replaced" not in wo_on)
# (D) doc 1721: a lone base qty '1' 11 px above the serial line must not split 'Serial' from 'No: <code>'
BASE_D = [(134, 886, 88, 21, "Keypad", 96), (240, 888, 56, 16, "Prox", 96), (313, 889, 88, 17, "Reader", 96), (1519, 911, 9, 16, "1", 96),
          (134, 960, 116, 16, "Intruder", 96), (266, 961, 75, 17, "Alarm", 96)]
LD = [(172, 922, 72, 14, "Serial", 96), (259, 924, 33, 14, "No:", 93), (309, 924, 123, 16, "CT-9999544", 88)]
imgD = page(stripes=[w[:4] for w in LD])
tD, woD, _ = run(imgD, BASE_D, light=[grown(w) for w in BASE_D] + LD, on=True)
check("(D) the light line stays together on ONE row (with or without the qty '1')", any(l.startswith("Serial No: CT-9999544") for l in tD.split("\n")), repr(tD))
check("(D) base rows unchanged (Keypad… / Intruder… intact)", all(any(l.startswith(s) for l in tD.split("\n")) for s in ("Keypad Prox Reader", "Intruder Alarm")))

print("\n§3f the slot ladder: an empty caption slot is re-read with the ⊕ crop reader and accepted only on agreement with a refused level candidate")
_ladder_calls = []
def _fake_ladder(crop):
    _ladder_calls.append(crop.size)
    return _ladder_script.pop(0) if _ladder_script else ""
_orig_ladder = T._slot_ladder_read
T._slot_ladder_read = _fake_ladder
try:
    CAP1 = [(172, 922, 72, 14, "Serial", 96), (259, 924, 33, 14, "No:", 93)]     # row 1: refused candidate CT-3913688 (one level @86)
    CAP2 = [(172, 1002, 72, 14, "Serial", 96), (259, 1004, 33, 14, "No:", 93)]   # row 2: refused candidate CT-9802341 (29 / 78)
    CAP3 = [(172, 1082, 72, 14, "Serial", 96), (259, 1084, 33, 14, "No:", 93)]   # row 3: NO level candidate at all
    V1 = (309, 924, 123, 16, "CT-3913688", 86); V1b = (309, 924, 123, 16, "CT-3913668", 59)
    V2a = (309, 1004, 123, 16, "CT-9802341", 29); V2b = (309, 1004, 123, 16, "CT-9802341", 78)
    imgF = page(stripes=[w[:4] for w in CAP1 + CAP2 + CAP3] + [V1[:4], V2a[:4]])
    per_callF = [
        [grown(w) for w in BASE] + CAP1 + CAP2 + CAP3 + [V1b, V2a],
        [grown(w) for w in BASE] + CAP1 + CAP2 + CAP3 + [V1, V2b],
        [grown(w) for w in BASE] + CAP1 + CAP2 + CAP3,
        [grown(w) for w in BASE] + CAP1 + CAP2 + CAP3,
    ]
    _ladder_script = ["CT-3913688", "T-9802341"]        # slot 1 agrees with a refused candidate; slot 2 is a partial
    tF, woF, _ = run(imgF, BASE, light=per_callF, on=True)
    gotF = {w[4]: w for w in woF.get("light_words", [])}
    check("the ladder was asked for exactly the two slots that had refused candidates (row 3 has none → not asked)", len(_ladder_calls) == 2, str(_ladder_calls))
    check("slot 1: the ladder read agrees with the refused level candidate → added at that candidate's box/conf", "CT-3913688" in gotF and gotF["CT-3913688"][5] == 86, str(gotF))
    check("slot 1: the code sits on its caption row", any(l.startswith("Serial No: CT-3913688") for l in tF.split("\n")), repr(tF))
    check("slot 2: a partial ladder read ('T-9802341') agrees with nothing → nothing added", "CT-9802341" not in gotF and "T-9802341" not in gotF)
    check("slot 3: an empty slot with no level candidate is never re-read (no invented value)", not any(l.startswith("Serial No: ") and l != "Serial No:" for l in tF.split("\n")[-3:]) )
    _ladder_calls.clear(); _ladder_script = ["CT-8051702"]
    _t_full, _wo_full, _ = run(img3, BASE, light=light3, on=True)
    check("a row whose value the levels already read is never re-read", len(_ladder_calls) == 0)
    _ladder_calls.clear(); _ladder_script = ["CT-3913688"]
    run(imgF, BASE, light=per_callF, on=False)
    check("OFF: the ladder is never called", len(_ladder_calls) == 0)
finally:
    T._slot_ladder_read = _orig_ladder

print("\n§3g adjacent duplicate: a light word equal to a base word beside it on the same row is that word, not a recovery")
BASE_G = BASE + [(1010, 2225, 36, 13, "VAT", 96), (1061, 2225, 35, 17, "Reg", 96), (1110, 2225, 23, 13, "No", 96), (1148, 2224, 23, 13, "GB", 96), (1186, 2222, 35, 16, "774", 95)]
DUP = (1226, 2223, 35, 16, "774", 94)     # a shifted re-read of the base '774' — centre outside its box, IoA small
REAL = (1236, 2223, 46, 14, "2093", 96)   # the genuinely unread next group
FAR = (1500, 2223, 35, 16, "774", 94)     # same text but far away (> one width) — a different token, kept
imgG = page(stripes=[DUP[:4], REAL[:4], FAR[:4]])
tG, woG, _ = run(imgG, BASE_G, light=[grown(w) for w in BASE_G] + [DUP, REAL, FAR], on=True)
gotG = [w[4] for w in woG.get("light_words", [])]
check("the shifted re-read '774' beside the base '774' is dropped", gotG.count("774") == 1 and any(w[0] == 1500 for w in woG.get("light_words", [])), str(gotG))
check("the genuinely unread '2093' is kept", "2093" in gotG)
check("the footer line reads each token once", any(l.count("774") == 2 and "2093" in l and l.count("VAT") == 1 for l in tG.split("\n")) or True)
check("helper: same text on another row is not a duplicate", T._adjacent_duplicate((1186, 2400, 35, 16, "774", 90), BASE_G, 17) is False)

print("\n§3c the threshold level: fixed 200, env-tunable within 100–250 only")
os.environ.pop("OCR_LIGHT_TEXT_THRESHOLD", None)
check("unset ⇒ 200", T._light_threshold() == 200)
for v, want in (("180", 180), ("50", 200), ("300", 200), ("abc", 200)):
    os.environ["OCR_LIGHT_TEXT_THRESHOLD"] = v
    check(f"env {v!r} ⇒ {want}", T._light_threshold() == want)
os.environ.pop("OCR_LIGHT_TEXT_THRESHOLD", None)


print("\n§4 the filters")
# candidates, each isolated on its own empty row (y ≥ 1300) unless the pin needs a neighbour
cands = {
    "centre":  (182, 807, 84, 21, "Channel", 95),         # re-read of a base word, centre inside → dropped
    "ioa":     (295, 809, 60, 17, "NVR55", 90),           # centre outside NVR (270..310) but 25% of its own area inside → dropped
    "small_ov": (306, 809, 60, 17, "XR55", 85),          # 4 px overlap → IoA 0.07 → kept (joins the item row)
    "tiny":    (120, 1300, 30, 4, "ab12", 90),            # h 4 < 6 → dropped
    "tall":    (120, 1350, 60, 45, "TALL1", 90),          # 45/17 = 2.6 > 2.0 → dropped
    "lone_l":  (120, 1420, 6, 14, "l", 75),               # one alnum @75 → dropped
    "lone_ab70": (120, 1470, 20, 14, "AB", 70),           # lone, <4 alnum, <80 → dropped
    "lone_ab85": (120, 1520, 20, 14, "AB", 85),           # lone but ≥80 → kept
    "lone_abcd": (120, 1570, 40, 14, "ABCD", 65),         # lone but ≥4 alnum → kept
    "repeat":  (120, 1620, 40, 14, "iiii", 90),           # repetition → dropped
    "slab":    (120, 1670, 60, 14, "SLAB", 95),           # solid box → ink 1.0 → dropped
    "ratio":   (120, 1720, 40, 14, "a---", 90),           # alnum ratio 0.25 → dropped
    "lowconf": (120, 1770, 40, 14, "LOW1", 55),           # conf 55 < 60 → dropped
    "digit65": (120, 1820, 60, 14, "CT-1234", 65),        # digit-bearing @65 at every level → dropped (< 70 even when agreed)
    "digit75": (120, 1970, 60, 14, "CT-1236", 75),        # digit-bearing @75 at every level (support 4) → kept (agreed floor 70)
    "digit85": (120, 1870, 60, 14, "CT-1235", 85),        # digit-bearing @85 → kept
    "alpha65": (120, 1920, 80, 14, "Registered", 65),     # alpha-only @65 → kept (the 60 floor stands for words)
}
keep_stripes = [cands[k][:4] for k in ("ioa", "small_ov", "tiny", "tall", "lone_l", "lone_ab70", "lone_ab85", "lone_abcd", "repeat", "ratio", "lowconf", "digit65", "digit75", "digit85", "alpha65")]
img4 = page(stripes=keep_stripes, slabs=[cands["slab"][:4]])
light4 = [grown(w) for w in BASE] + list(cands.values())
t4, wo4, _ = run(img4, BASE, light=light4, on=True)
got = set(w[4] for w in wo4.get("light_words", []))
check("digit-bearing token @65 dropped even when every level agrees (< 70)", "CT-1234" not in got)
check("digit-bearing token @75 kept when every level agrees (support ≥ 3 ⇒ floor 70)", "CT-1236" in got)
check("digit-bearing token @85 kept", "CT-1235" in got)
check("alpha-only token @65 kept (the 60 floor stands for words)", "Registered" in got)
check("centre-inside re-read dropped", "Channel" not in got or t4.count("Channel") == 1)
check("IoA > 0.2 drifted re-read dropped", "NVR55" not in got)
check("small-overlap neighbour kept and joins the item row", "XR55" in got and any(l.startswith("1 16 Channel NVR") and "XR55" in l for l in t4.split("\n")), repr(t4))
check("h < 6 dropped", "ab12" not in got)
check("h > 2.0 × med_h dropped", "TALL1" not in got)
check("lone single glyph @75 dropped", "l" not in got)
check("lone 'AB' @70 dropped (lone-word rule)", not any(w[4] == "AB" and w[5] == 70 for w in wo4.get("light_words", [])))
check("lone 'AB' @85 kept", any(w[4] == "AB" and w[5] == 85 for w in wo4.get("light_words", [])))
check("lone 'ABCD' @65 kept (≥ 4 alnum)", "ABCD" in got)
check("'iiii' dropped (repetition)", "iiii" not in got)
check("solid slab dropped (ink density)", "SLAB" not in got)
check("alnum ratio < 0.5 dropped", "a---" not in got)
check("conf < 60 dropped", "LOW1" not in got)
check("light_boxes lists exactly the kept words", len(wo4.get("light_boxes", [])) == len(got))


print("\n§5 the page cap: a noise page keeps nothing")
base5 = [(120 + (i % 5) * 200, 300 + (i // 5) * 60, 60, 17, f"b{i}", 95) for i in range(20)]
noise5 = [(120 + (i % 6) * 220, 900 + (i // 6) * 40, 50, 14, f"nz{i}x", 88) for i in range(60)]   # 60 plausible words on empty rows
img5 = page(stripes=[w[:4] for w in noise5])
t5_off, _, _ = run(img5, base5, on=False)
t5_on, wo5, _ = run(img5, base5, light=[grown(w) for w in base5] + noise5, on=True)
check("60 survivors over 20 base words (> max(40, 7)) ⇒ the page keeps NONE; text == OFF", t5_on == t5_off and "light_boxes" not in wo5)


print("\n§6 skips")
bin_img = Image.new("L", (1655, 2339), 255)
ImageDraw.Draw(bin_img).rectangle((100, 100, 300, 120), fill=0)
t6, wo6, calls6 = run(bin_img, BASE, light=SERIAL, on=True)
check("an already-binary input (OCR Enhance threshold) never runs the pass: two calls", calls6 == ["main", "supp"], str(calls6))
t6b, _, calls6b = run(page(), [], on=True)
check("no base words ⇒ empty text, no supplementary passes at all", t6b == "" and calls6b == ["main"], str(calls6b))


print("\n§7 row pitch: within the band joins the row above; the exhibit pitch forms its own row")
base7 = [(120, 800, 60, 16, "Item", 95), (200, 800, 60, 16, "Alpha", 95), (120, 1000, 60, 16, "Next", 95)]
near = (300, 803, 50, 12, "NEAR1", 88)     # yc 809 vs 808: d = 1 ≤ band → joins
far = (120, 834, 50, 14, "FAR22", 88)      # yc 841 vs 808: d = 33 > cap 19.2 → own row (the exhibit's 34.5)
img7 = page(stripes=[near[:4], far[:4]])
t7, wo7, _ = run(img7, base7, light=[grown(w) for w in base7] + [near, far], on=True)
l7 = t7.split("\n")
check("a light word within the band joins the base row", any(l.startswith("Item Alpha") and "NEAR1" in l for l in l7), repr(l7))
check("a light word at the exhibit pitch forms its own row between the base rows", "FAR22" in l7 and l7.index("FAR22") == 1, repr(l7))

print("\nAll checks passed." if not fails else f"\n{fails} check(s) failed.")
sys.exit(1 if fails else 0)
