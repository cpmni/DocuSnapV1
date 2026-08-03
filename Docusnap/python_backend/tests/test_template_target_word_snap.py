"""test_template_target_word_snap.py — Slice B target WORD-SNAP pins
(fork design note + Oracle SIGN-OFF-W/COND B-C1..C5, 2026-08-03 evening — docs/oracle_log.md).

Run: py -3.12 python_backend/tests/test_template_target_word_snap.py

WHAT THIS PINS. On the DERIVED rungs only (drift `_geometric` re-seat + registration transform),
the seated value box is snapped to the page's word geometry before the crop OCR: words
MAJORITY-INSIDE (>=50% of the word's own area) the seated box, row-band restricted, label-right-
edge cut (in the LOCATED/TRANSFORMED frame — B-C1), `cluster_value_words` gap discipline, union +
pad, <=4x area cap. The absolute rung is UNTOUCHED (teach-time WYSIWYG contract).

THE ANTI-LOOSEN CONTRACT:
  • CORE INVARIANT: the snap NEVER admits a word the seated box does not already touch — it grows
    only to FINISH nicked words. An operator's deliberately-narrow box excluding a neighbour token
    keeps excluding it. Do not "improve" this into nearest-word reach-out.
  • A word majority-OUTSIDE the box (like the label's trailing ".") is never admitted.
  • Geometry-absent (no per-word boxes / empty cache+no OCR fn) → seated box returned unchanged.
  • Scope = CODE types + date only; free-text/multiline stay box-first (over-grab class).
  • OFF (TEMPLATE_TARGET_WORD_SNAP unset) = byte-identical.
"""
import os, sys, inspect
try: sys.stdout.reconfigure(encoding='utf-8')
except Exception: pass
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(_HERE, '..')))
sys.path.insert(0, _HERE)
os.environ['TEMPLATE_TARGET_WORD_SNAP'] = '1'
from extraction import template_mapper as tm                       # noqa: E402
from test_template_mapper import FakePage                          # noqa: E402

fails = 0
def check(label, cond):
    global fails
    print(('OK  ' if cond else 'BAD ') + label)
    if not cond:
        fails += 1

def W(text, x, y, w, h):
    return {"text": text, "x_norm": x, "y_norm": y, "w_norm": w, "h_norm": h}

def snap(seated, words, val_type='alphanumeric', label_box=None, on=True, lines=None):
    page = FakePage((1000, 1000))
    if lines is None:
        lines = [{"text": " ".join(w["text"] for w in words), "x_norm": 0.0, "y_norm": 0.2,
                  "w_norm": 1.0, "h_norm": 0.04, "words": words}]
    cache = {(id(page), 0.0, 0.0, 1.0, 1.0): lines}
    saved = tm._TARGET_WORD_SNAP_ON
    tm._TARGET_WORD_SNAP_ON = on
    try:
        return tm._snap_box_to_words(page, dict(seated), val_type, None, cache,
                                     label_box=label_box)
    finally:
        tm._TARGET_WORD_SNAP_ON = saved

SEATED = {"x_norm": 0.30, "y_norm": 0.195, "w_norm": 0.10, "h_norm": 0.035}
VALUE  = W("DN-60902", 0.315, 0.20, 0.10, 0.025)      # right edge 0.415 — box (0.40) nicks it
DOT    = W(".", 0.295, 0.20, 0.008, 0.02)              # label tail: only ~37% inside the box
LABELB = {"x_norm": 0.10, "y_norm": 0.20, "w_norm": 0.19, "h_norm": 0.025}  # right edge 0.29

print("Snap grows to FINISH the nicked value word (no x-chop):")
s = snap(SEATED, [VALUE])
check("snapped right edge covers the whole word",
      s["x_norm"] + s["w_norm"] >= 0.415)
check("snapped top/bottom cover the word (no y-chop)",
      s["y_norm"] <= 0.20 and s["y_norm"] + s["h_norm"] >= 0.225)

print("\nMajority-inside + label-tail exclusion:")
s = snap(SEATED, [DOT, VALUE], label_box=LABELB)
check("label-tail '.' (minority-inside) NOT absorbed — snapped left edge starts at the value",
      s["x_norm"] + 0.001 >= 0.315 - 0.005)
s2 = snap(SEATED, [DOT, VALUE])
check("...even WITHOUT a label cut (majority-inside alone excludes it)",
      s2["x_norm"] + 0.001 >= 0.315 - 0.005)

print("\nCORE INVARIANT — zero-overlap words never admitted:")
s = snap(SEATED, [VALUE, W("COPY", 0.45, 0.20, 0.06, 0.025)])
check("adjacent same-row 'COPY' (0% overlap) stays excluded",
      s["x_norm"] + s["w_norm"] < 0.44)
NARROW = {"x_norm": 0.315, "y_norm": 0.195, "w_norm": 0.05, "h_norm": 0.035}
s = snap(NARROW, [W("AAA", 0.315, 0.20, 0.04, 0.025), W("BBB", 0.40, 0.20, 0.05, 0.025)])
check("operator's deliberately-narrow box: untouched neighbour token BBB stays excluded",
      s["x_norm"] + s["w_norm"] < 0.39)

print("\nFail-safe fallbacks (each returns the seated box unchanged):")
check("OFF -> unchanged", snap(SEATED, [VALUE], on=False) == SEATED)
check("free-text val_type -> unchanged (scope pin)",
      snap(SEATED, [VALUE], val_type='text') == SEATED)
check("no words on the row (whitespace float) -> unchanged", snap(SEATED, []) == SEATED)
check("geometry-absent (lines without word boxes) -> unchanged",
      snap(SEATED, [], lines=[{"text": "DN-60902", "x_norm": 0.0, "y_norm": 0.2,
                               "w_norm": 1.0, "h_norm": 0.04}]) == SEATED)
TINY = {"x_norm": 0.32, "y_norm": 0.205, "w_norm": 0.004, "h_norm": 0.004}
s = snap(TINY, [W("ALONGVALUETOKEN", 0.30, 0.19, 0.30, 0.05)])
check("union > 4x seated area -> snap rejected, seated box kept (B-C3 cap)", s == TINY)

print("\nWrong-row discipline:")
s = snap(SEATED, [W("DN-99999", 0.315, 0.30, 0.10, 0.025)])   # a row well below the box
check("word on another row (no y-overlap) never admitted", s == SEATED)

print("\nWiring (source) — B-C1 frames + rung scope:")
gsrc = inspect.getsource(tm._relocate_and_read)
check("drift rung snaps the derived box with the LOCATED label frame",
      '_snap_box_to_words' in gsrc and 'label_box' in gsrc)
rsrc = inspect.getsource(tm._read_registration)
check("registration rung snaps with the TRANSFORMED anchor frame (apply_box)",
      '_snap_box_to_words' in rsrc and 'apply_box' in rsrc)
asrc = inspect.getsource(tm)
fastpath = asrc[asrc.find('FAST PATH: read the EXACT box'):asrc.find('def _read_registration')]
check("absolute rung UNTOUCHED (no snap call in the fast path)",
      '_snap_box_to_words' not in fastpath)
check("switch default OFF",
      "os.environ.get('TEMPLATE_TARGET_WORD_SNAP', '0')" in asrc)
check("scope = CODE types + date", "_SNAP_VAL_TYPES" in asrc and "'date'" in
      asrc[asrc.find('_SNAP_VAL_TYPES'):asrc.find('_SNAP_VAL_TYPES') + 220])

print(f"\n{'ALL PASS' if fails == 0 else str(fails) + ' FAILURES'}")
sys.exit(1 if fails else 0)
