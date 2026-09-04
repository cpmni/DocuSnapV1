"""test_ref_positional_consensus.py — PINs for the Phase-2 code re-slice witness + positional consensus
(gary integration → Oracle Phase 2, REVIEW-BOUND; leg-a of the single-glyph reference resolver).

Pins the PURE pieces in reslice.py: read_code_witnesses (two distinct BINARISATION recipes on one crop),
positional_consensus (>=3 distinct pixel sources, equal length, strict per-position majority, no
synthesis), and source_key (same box+recipe collapse to one vote; a binarisation witness is a new source;
a region-less read is the single page source). Efficacy — whether a binarisation actually FLIPS a live
misread — is corpus/live-only (HYPOTHESIS); these pin the plumbing + the safety invariants.

Run:  PYTHONIOENCODING=utf-8 py -3.12 python_backend/tests/test_ref_positional_consensus.py
"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from PIL import Image, ImageDraw, ImageFont
from extraction import reslice as rs
from extraction import anchor

# Dev Tesseract lives at the standard path; wire it so the read-content assertions can run. Where it is
# absent (a CI box), the read-content checks are SKIPPED and only the Tesseract-free plumbing is pinned.
_TESS = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
_HAVE_TESS = False
try:
    import pytesseract
    if os.path.exists(_TESS):
        pytesseract.pytesseract.tesseract_cmd = _TESS
    _probe = Image.new('L', (400, 120), 255)
    _d = ImageDraw.Draw(_probe)
    try:    _pf = ImageFont.truetype("arial.ttf", 72)
    except Exception: _pf = ImageFont.load_default()
    _d.text((20, 20), "AB12", fill=0, font=_pf)
    _HAVE_TESS = 'AB' in pytesseract.image_to_string(_probe, config='--oem 3 --psm 7')
except Exception:
    _HAVE_TESS = False

_P = _F = 0
def check(name, ok):
    global _P, _F
    if ok: _P += 1; print(f"  ok  {name}")
    else:  _F += 1; print(f"  FAIL {name}")

# ── a synthetic single-token CODE crop on a page-sized white image ──
def synth_page(text='AB1234567X'):
    W, H = 900, 120
    img = Image.new('L', (W, H), 255)
    d = ImageDraw.Draw(img)
    try:    font = ImageFont.truetype("arial.ttf", 48)
    except Exception: font = ImageFont.load_default()
    d.text((40, 30), text, fill=0, font=font)
    return img
# the box (normalised) enclosing the token, generously
BOX = {'x_norm': 0.02, 'y_norm': 0.15, 'w_norm': 0.55, 'h_norm': 0.6}

print("1a. binarisation image-ops (Tesseract-free plumbing)")
_crop, _band = rs._crop_padded(synth_page('AB1234567X'), BOX, 0.5, 0.5)
_base = rs.prep(_crop)
_ots, _ada = rs._otsu_binarise(_base), rs._adaptive_binarise(_base)
check("otsu -> an 'L' image with both ink and paper (0 and 255)", _ots.mode == 'L' and _ots.getextrema() == (0, 255))
check("adaptive -> an 'L' image, same size as the crop", _ada.mode == 'L' and _ada.size == _base.size)
check("code_witness_max default 2, clamped", rs.code_witness_max() == 2)
check("blank crop -> [] (never raises, Tesseract or not)",
      rs.read_code_witnesses(Image.new('L', (900, 120), 255), {'x_norm':0.0,'y_norm':0.0,'w_norm':0.001,'h_norm':0.001}, anchor._read_lines_full) == [])

print("1b. read_code_witnesses read-content" + ("" if _HAVE_TESS else " — SKIPPED (no Tesseract on PATH)"))
if _HAVE_TESS:
    w = rs.read_code_witnesses(synth_page('AB1234567X'), BOX, anchor._read_lines_full, k=2)
    check("returns 1-2 witnesses", 1 <= len(w) <= 2)
    check("recipe_keys are the two binarisations, distinct",
          {x['recipe_key'] for x in w}.issubset({'otsu', 'adaptive'}) and len({x['recipe_key'] for x in w}) == len(w))
    check("each witness carries a value + a conf", all(x['value'] and 'conf' in x for x in w))
    check("at least one recipe reads a code-shaped token",
          any(len((x['value'] or '')) >= 6 for x in w))

print("\n2. source_key — pixel-source identity (Oracle Q3)")
b1 = {'x_norm': 0.10, 'y_norm': 0.20, 'w_norm': 0.30, 'h_norm': 0.05}
check("same box + same recipe -> SAME key (crop+mapping collapse to one vote)",
      rs.source_key(b1, 'gray-ladder') == rs.source_key(dict(b1), 'gray-ladder'))
check("same box, DIFFERENT recipe -> DIFFERENT key (a witness is a new source)",
      rs.source_key(b1, 'gray-ladder') != rs.source_key(b1, 'otsu'))
check("otsu vs adaptive -> two distinct sources", rs.source_key(b1, 'otsu') != rs.source_key(b1, 'adaptive'))
check("region-less read (box None) -> the single ('page','text-pass') source",
      rs.source_key(None) == ('page', 'text-pass') and rs.source_key({}) == ('page', 'text-pass'))
check("a box 1% away quantises to the SAME key (coarse merge)",
      rs.source_key({'x_norm':0.104,'y_norm':0.203,'w_norm':0.30,'h_norm':0.05}, 'otsu') == rs.source_key(b1, 'otsu'))

print("\n3. positional_consensus — the safety invariants")
def V(val, conf, sk): return {'value': val, 'conf': conf, 'source_key': sk}
box_gray = rs.source_key(b1, 'gray-ladder'); box_otsu = rs.source_key(b1, 'otsu'); page_sk = ('page', 'text-pass')
check("3 distinct sources, one-glyph minority -> majority heals, result IS a real read",
      rs.positional_consensus([V('752923124N3M2', 90, box_gray), V('752923124N3M2', 80, box_otsu),
                               V('782923124N3M2', 60, page_sk)]) == '752923124N3M2')
check("only 2 distinct sources (1-1 tie) -> None",
      rs.positional_consensus([V('752923124N3M2', 90, box_gray), V('782923124N3M2', 60, page_sk)]) is None)
check("3 reads but only 2 DISTINCT sources (a dup collapses) -> None",
      rs.positional_consensus([V('752923124N3M2', 90, box_gray), V('752923124N3M2', 70, box_gray),
                               V('782923124N3M2', 60, page_sk)]) is None)
check("unequal length -> None",
      rs.positional_consensus([V('752923124N3M2', 90, box_gray), V('75292312N3M2', 80, box_otsu),
                               V('782923124N3M2', 60, page_sk)]) is None)
check("a tied position (no strict majority) -> None",
      rs.positional_consensus([V('A52', 90, box_gray), V('B52', 80, box_otsu), V('C52', 60, page_sk)]) is None)
check("NEVER synthesises a novel token (majority-per-position string equals no real read) -> None",
      rs.positional_consensus([V('AXC', 90, box_gray), V('AYD', 80, box_otsu), V('BYC', 60, page_sk)]) is None)
check("PROPERTY: consensus is always None or exactly one of the input reads",
      (lambda r: r is None or r in ('752923124N3M2', '782923124N3M2'))(
          rs.positional_consensus([V('752923124N3M2', 90, box_gray), V('752923124N3M2', 80, box_otsu),
                                   V('782923124N3M2', 60, page_sk)])))

print(f"\n{'ALL PASS' if _F == 0 else str(_F) + ' FAILED'}  ({_P} ok)")
sys.exit(1 if _F else 0)
