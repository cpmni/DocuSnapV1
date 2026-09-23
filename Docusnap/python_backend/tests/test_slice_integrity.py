"""PIN — extraction/slice_integrity.py (S1 of Part A, Oracle C2/C3, 2026-09-23 night). Pure geometry on drawn
word boxes; the second reader's crop rect is snapped to the page word boxes on its own row band.

Run: PYTHONIOENCODING=utf-8 py -3.12 -m tests.test_slice_integrity  (from python_backend/)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from extraction.slice_integrity import snap_rect_to_words

def W(text, x, y, w, h):
    return {"text": text, "x_norm": x, "y_norm": y, "w_norm": w, "h_norm": h}

def L(*words):
    return {"words": list(words), "text": " ".join(w["text"] for w in words)}

R = lambda x, y, w, h: {"x_norm": x, "y_norm": y, "w_norm": w, "h_norm": h}
VALUE = W("SO-82482", 0.60, 0.30, 0.10, 0.02)            # 8 glyphs, g = 0.0125
LABEL = W("No:", 0.55, 0.30, 0.03, 0.02)                  # left neighbour, 0.02 gap
NEXT_LINE = W("12/04/2026", 0.60, 0.33, 0.10, 0.02)       # the line below (centre 0.34 vs 0.31)
LINES = [L(LABEL, VALUE), L(NEXT_LINE)]


def test_clean_when_rect_is_the_word():
    r = snap_rect_to_words(R(0.60, 0.30, 0.10, 0.02), LINES)
    assert r["integrity"] == "clean" and r["n_words"] == 1 and not r["grown"]
    assert abs(r["rect"]["x_norm"] - 0.60) < 1e-9 and abs(r["rect"]["w_norm"] - 0.10) < 1e-9


def test_left_cut_glyph_is_restored():
    # the taught box starts 55 % into the first glyph (the census's synthetic clip; `5O-` for `SO-`)
    r = snap_rect_to_words(R(0.60 + 0.0125 * 0.55, 0.30, 0.10 - 0.0125 * 0.55, 0.02), LINES)
    assert r["integrity"] == "healed" and r["edges"]["left"] and r["grown"]
    assert abs(r["rect"]["x_norm"] - 0.60) < 1e-9 and abs(r["rect"]["w_norm"] - 0.10) < 1e-9


def test_right_cut_glyph_is_restored():
    r = snap_rect_to_words(R(0.60, 0.30, 0.10 - 0.0125 * 0.5, 0.02), LINES)
    assert r["integrity"] == "healed" and r["edges"]["right"]
    assert abs(r["rect"]["x_norm"] + r["rect"]["w_norm"] - 0.70) < 1e-9


def test_next_line_bleed_is_removed():
    # a box 0.3×h too tall on both sides (the quiet-zone bleed): tightens to the word's own height
    r = snap_rect_to_words(R(0.60, 0.294, 0.10, 0.032), LINES)
    assert r["integrity"] == "healed" and abs(r["rect"]["y_norm"] - 0.30) < 1e-9 and abs(r["rect"]["h_norm"] - 0.02) < 1e-9
    assert r["n_words"] == 1, "the line below is another row — never admitted"


def test_touched_neighbour_is_left_out():
    # an over-wide (+20 px parity) rect that reaches 1/3 of a glyph into the label: the label stays out
    r = snap_rect_to_words(R(0.60 - 0.02 - 0.01 / 3 * 0.3, 0.30, 0.10 + 0.03, 0.02), LINES)
    assert r["n_words"] == 1 and abs(r["rect"]["x_norm"] - 0.60) < 1e-9, r
    assert r["integrity"] == "healed"                       # tightened back to the value word


def test_glued_neighbour_is_admitted_and_traced():
    # the rect genuinely covers half of the label's last glyph too → both words admitted (the reader will see
    # both; the hold's length compare then abstains — Oracle C3: no note, no cap)
    r = snap_rect_to_words(R(0.575, 0.30, 0.125, 0.02), LINES)
    assert r["n_words"] == 2 and r["integrity"] == "healed" and abs(r["rect"]["x_norm"] - 0.55) < 1e-9


def test_no_lines_and_no_words_leave_the_rect_alone():
    r = snap_rect_to_words(R(0.60, 0.30, 0.10, 0.02), None)
    assert r["integrity"] == "no_lines" and r["rect"] == R(0.60, 0.30, 0.10, 0.02)
    r = snap_rect_to_words(R(0.10, 0.80, 0.10, 0.02), LINES)
    assert r["integrity"] == "no_words" and r["rect"] == R(0.10, 0.80, 0.10, 0.02)


def test_cap_refuses_a_nick_on_a_long_line():
    long_word = W("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 0.10, 0.50, 0.60, 0.02)
    r = snap_rect_to_words(R(0.64, 0.50, 0.10, 0.02), [L(long_word)])
    assert r["integrity"] == "unhealed" and r["rect"] == R(0.64, 0.50, 0.10, 0.02)


def test_value_text_filter_keeps_the_label_out():
    """S1 v3: with the committed value known, a rect that covers the label too (the mapping rung's expanded read
    area) yields the VALUE word only; the page pass's own one-glyph misread of the value still counts as the value."""
    from extraction.slice_integrity import word_is_value
    r = snap_rect_to_words(R(0.55, 0.30, 0.15, 0.02), LINES, committed="SO-82482")
    assert r["n_words"] == 1 and abs(r["rect"]["x_norm"] - 0.60) < 1e-9, r
    misread = [L(LABEL, W("S0-82482", 0.60, 0.30, 0.10, 0.02))]
    r = snap_rect_to_words(R(0.55, 0.30, 0.15, 0.02), misread, committed="SO-82482")
    assert r["n_words"] == 1 and abs(r["rect"]["x_norm"] - 0.60) < 1e-9, "the page's misread of the value is still the value's ink"
    glued = [L(W("No:SO-82482", 0.55, 0.30, 0.15, 0.02))]
    assert snap_rect_to_words(R(0.60, 0.30, 0.10, 0.02), glued, committed="SO-82482")["n_words"] == 1
    split = [L(W("PO", 0.60, 0.30, 0.02, 0.02), W("12345", 0.63, 0.30, 0.06, 0.02))]
    assert snap_rect_to_words(R(0.60, 0.30, 0.09, 0.02), split, committed="PO-12345")["n_words"] == 2
    assert not word_is_value("No.", "DN-98358") and not word_is_value("DeliveryNoteNo.", "DN-98358")
    assert word_is_value("DN-98358", "DN-98358") and word_is_value("DN.98358", "DN-98358")
    # without a committed value the geometric rule alone still applies (label admitted when covered)
    assert snap_rect_to_words(R(0.55, 0.30, 0.15, 0.02), LINES)["n_words"] == 2


def test_never_raises_and_clamps():
    assert snap_rect_to_words(None, LINES)["integrity"] == "no_lines"
    assert snap_rect_to_words({"x_norm": "x"}, LINES)["integrity"] == "no_lines"
    r = snap_rect_to_words(R(0.0, 0.30, 0.05, 0.02), [L(W("AB", -0.01, 0.30, 0.06, 0.02))])
    assert r["rect"]["x_norm"] == 0.0 and r["integrity"] == "healed"


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn(); print(f"  ok {fn.__name__}")
    print(f"\n{len(fns)}/{len(fns)} passed")
