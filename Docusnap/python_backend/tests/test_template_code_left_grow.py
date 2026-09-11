"""Pins for Arc A — page-absent code left-grow (mig 161 template_code_left_grow, DARK).

Monkeypatches `_full_page_lines` (the independent full-page words — Oracle C1) and `_read_pad_window_code`
(the wider re-read) so the real decision logic runs against controlled geometry: shape-VALID + page-ABSENT
tight, recovered page-PRESENT + single-side 'L' clip + row-aligned + exact shape + placement-certified.
#1 is the worksheet_07 regression PIN (VS-72672→WS-73673). Each guard is proven to FAIL with it removed.
Run: py -3.12 tests/test_template_code_left_grow.py
"""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from extraction import format_anomaly_checker as F
from extraction import template_mapper as TM

# ── a real learned entry: all WS-##### (so VS-72672 AND WS-73673 both fold shape-valid) ──
CONFIRMED = [{"field_key": "reference_number", "supplier_name": "Ridgeway Plant Hire",
              "document_type": "worksheet",
              "sample_values": ["WS-73601", "WS-73588", "WS-73512", "WS-73490"],
              "value_counts": {"WS-73601": 3, "WS-73588": 2, "WS-73512": 2, "WS-73490": 2}}]
FCI = F.build_format_class_index(CONFIRMED)
ENTRY = FCI.get(("ridgeway plant hire", "worksheet", "reference_number"))

def _lookup(_key):
    return ENTRY

# taught box (top-right code slot); the recovered token overhangs its LEFT edge (an 'L' clip)
TARGET = {"x_norm": 0.80, "y_norm": 0.150, "w_norm": 0.08, "h_norm": 0.020}
PAD_BOX = {"x_norm": 0.78, "y_norm": 0.150, "w_norm": 0.10, "h_norm": 0.020, "text": "WS-73673"}
def _lines(page_present="WS-73673", extra_words=()):
    words = [{"x_norm": 0.78, "y_norm": 0.150, "w_norm": 0.10, "h_norm": 0.020, "text": page_present}]
    for w in extra_words:
        words.append(w)
    # a couple of unrelated page words so the token set is non-trivial
    words += [{"x_norm": 0.10, "y_norm": 0.05, "w_norm": 0.20, "h_norm": 0.02, "text": "WORKSHEET"},
              {"x_norm": 0.10, "y_norm": 0.15, "w_norm": 0.14, "h_norm": 0.02, "text": "Reference"}]
    return [{"words": words}]

class _P:  # a page stub; never actually cropped (we monkeypatch _full_page_lines)
    size = (1723, 2387)

def _patch(pad_ret, lines):
    TM._full_page_lines = lambda *a, **k: lines
    TM._read_pad_window_code = lambda *a, **k: pad_ret

def _run(env_on, tight, pad_ret, lines, entry=ENTRY):
    if env_on:
        os.environ["TEMPLATE_CODE_LEFT_GROW"] = "1"
    else:
        os.environ.pop("TEMPLATE_CODE_LEFT_GROW", None)
    _patch(pad_ret, lines)
    return TM._grow_code_left_read(_P(), TARGET, tight, "reference_number", "Reference No.",
                                   {"reference_code": None}, (lambda k: entry), (lambda c: lines), {})


def test_0_premise_vs_is_shape_valid():
    # The whole reason read-widen misses it: VS-72672 folds to the SAME shape as WS-##### → shape 1.0.
    assert F.shape_match_score("VS-72672", ENTRY) == 1.0, F.shape_match_score("VS-72672", ENTRY)
    assert F.shape_match_score("WS-73673", ENTRY) == 1.0


def test_1_recover_adopt_regression_pin():
    r = _run(True, "VS-72672", ("WS-73673", 88, dict(PAD_BOX)), _lines())
    assert r == ("WS-73673", 88), r


def test_2_off_byte_identical():
    assert _run(False, "VS-72672", ("WS-73673", 88, dict(PAD_BOX)), _lines()) is None


def test_3_clean_box_page_present_tight():
    # tight value IS on the page (page-present) → not the clip case → None
    assert _run(True, "WS-73673", ("WS-73673", 88, dict(PAD_BOX)), _lines()) is None


def test_4_recovery_not_on_page():
    # recovered token not printed as a whole token → decline
    assert _run(True, "VS-72672", ("WS-99999", 88, dict(PAD_BOX)), _lines(page_present="WS-73673")) is None


def test_5_right_or_contained_clip_declines():
    # recovered token fits INSIDE the box (no left overhang) → _clip_edges != 'L' → None
    inside = {"x_norm": 0.81, "y_norm": 0.150, "w_norm": 0.06, "h_norm": 0.020, "text": "WS-73673"}
    lines = _lines()
    lines[0]["words"][0] = inside
    assert _run(True, "VS-72672", ("WS-73673", 88, inside), lines) is None


def test_6_neighbour_swallow_refused():
    # a LEFT-COLUMN neighbour code, page-present + shape-valid, but its right edge is far left of the box
    # → _snap_union_witness un-cut-edge anchor fails → decline (the headline false-positive guard)
    neigh = {"x_norm": 0.66, "y_norm": 0.150, "w_norm": 0.10, "h_norm": 0.020, "text": "PO-11111"}
    lines = _lines(page_present="PO-11111")
    lines[0]["words"][0] = neigh
    assert _run(True, "VS-72672", ("PO-11111", 88, neigh), lines) is None


def test_7_shape_invalid_recovery_declines():
    # recovered doesn't match the confirmed shape → defer to read-widen → None
    bad = {"x_norm": 0.78, "y_norm": 0.150, "w_norm": 0.10, "h_norm": 0.020, "text": "ZZZZ"}
    lines = _lines(page_present="ZZZZ")
    lines[0]["words"][0] = bad
    assert _run(True, "VS-72672", ("ZZZZ", 88, bad), lines) is None


def test_8_shape_invalid_tight_defers():
    # tight read is shape-INVALID → read-widen's job, Arc A abstains
    assert _run(True, "garble words", ("WS-73673", 88, dict(PAD_BOX)), _lines()) is None


def test_9_cold_start_no_shapes_abstains():
    assert _run(True, "VS-72672", ("WS-73673", 88, dict(PAD_BOX)), _lines(), entry={"shapes": None}) is None


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    fails = 0
    for fn in fns:
        try:
            fn()
            print(f"  PASS {fn.__name__}")
        except AssertionError as e:
            fails += 1
            print(f"  FAIL {fn.__name__}: {e}")
        except Exception as e:
            fails += 1
            print(f"  ERROR {fn.__name__}: {type(e).__name__}: {e}")
    print(f"\n{len(fns) - fails}/{len(fns)} passed")
    sys.exit(1 if fails else 0)
