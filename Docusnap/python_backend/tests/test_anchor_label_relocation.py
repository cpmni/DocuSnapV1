"""
Part B drift recovery: _relocate_value_by_label must re-derive the value crop
from where the label ACTUALLY sits, so the value follows the label when the page
registration drifts. OCR is stubbed (template_mapper._locate_anchor monkeypatched)
so the GEOMETRY is tested deterministically without Tesseract — mirroring the
codebase convention of testing extraction logic directly.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from extraction import anchor
from extraction import template_mapper


class _StubLocate:
    """Stand-in for template_mapper._locate_anchor returning a fixed located box
    (label top-left x/y + size, page-normalised), regardless of search args."""
    def __init__(self, box):
        self.box = box
        self.calls = 0

    def __call__(self, *args, **kwargs):
        self.calls += 1
        return dict(self.box) if self.box else None


def _patch(monkey_box):
    template_mapper._locate_anchor = _StubLocate(monkey_box)


# Taught value box: centres (cx, cy) + size (w, h), page-normalised.
VBOX = (0.30, 0.20, 0.10, 0.02)   # cx, cy, vw, vh


def test_no_drift_recovers_taught_position():
    # Label located exactly where expected (left of value, same row).
    _patch({"x_norm": 0.15, "y_norm": 0.19, "w_norm": 0.10, "h_norm": 0.02})
    relo = anchor._relocate_value_by_label(object(), "Date Logged", "right", VBOX)
    assert relo is not None
    cx, cy, w, h = relo
    assert abs(cy - 0.20) < 1e-6, "value row aligns to located label row"
    assert abs(cx - 0.304) < 1e-6, "value sits just right of the label"
    assert (w, h) == (0.10, 0.02), "value keeps its taught size"


def test_value_follows_label_drift_up():
    # Page registered higher: the label moved UP by 0.05. Value must follow up.
    _patch({"x_norm": 0.15, "y_norm": 0.14, "w_norm": 0.10, "h_norm": 0.02})
    relo = anchor._relocate_value_by_label(object(), "Date Logged", "right", VBOX)
    cx, cy, w, h = relo
    assert abs(cy - 0.15) < 1e-6, "value row follows the label's upward drift (0.20 -> 0.15)"


def test_below_direction_places_value_under_label():
    # 'below' anchor: label ABOVE the value; located label drifted up by 0.04.
    _patch({"x_norm": 0.25, "y_norm": 0.13, "w_norm": 0.10, "h_norm": 0.02})
    relo = anchor._relocate_value_by_label(object(), "Total", "below", VBOX)
    cx, cy, w, h = relo
    # value bottom-of-label + gap + half height = 0.13 + 0.02 + 0.004 + 0.01
    assert abs(cy - 0.164) < 1e-6, "value sits just below the located label"
    assert abs(cx - 0.30) < 1e-6, "value centred under the label"


def test_offset_path_places_value_at_label_plus_offset():
    # Stored drift-invariant offset = value-centre − label-top-left.
    _patch({"x_norm": 0.15, "y_norm": 0.19, "w_norm": 0.10, "h_norm": 0.02})
    relo = anchor._relocate_value_by_label(object(), "Date Logged", "right", VBOX,
                                           offset=(0.10, 0.005))
    cx, cy, w, h = relo
    assert abs(cx - (0.15 + 0.10)) < 1e-9, "value-centre x = label-left + offset_dx"
    assert abs(cy - (0.19 + 0.005)) < 1e-9, "value-centre y = label-top + offset_dy"


def test_offset_path_is_drift_invariant():
    # THE headline invariant: the SAME stored offset, applied to a label that has
    # DRIFTED, moves the value by exactly the label's displacement — so a teach on
    # a clipped/shifted scan yields the same result as on a clean page.
    off = (0.10, 0.005)
    _patch({"x_norm": 0.15, "y_norm": 0.19, "w_norm": 0.10, "h_norm": 0.02})
    clean = anchor._relocate_value_by_label(object(), "Date", "right", VBOX, offset=off)
    _patch({"x_norm": 0.15, "y_norm": 0.14, "w_norm": 0.10, "h_norm": 0.02})  # label drifted up 0.05
    drifted = anchor._relocate_value_by_label(object(), "Date", "right", VBOX, offset=off)
    assert abs((clean[1] - drifted[1]) - 0.05) < 1e-9, \
        "value follows the label's drift by exactly the displacement (offset is invariant)"


def test_offset_overrides_geometric_guess():
    # With an offset present, the coarse adjacency guess must NOT be used.
    _patch({"x_norm": 0.15, "y_norm": 0.19, "w_norm": 0.10, "h_norm": 0.02})
    guess = anchor._relocate_value_by_label(object(), "Date", "right", VBOX)              # no offset
    exact = anchor._relocate_value_by_label(object(), "Date", "right", VBOX, offset=(0.10, 0.005))
    assert guess[0] != exact[0] or guess[1] != exact[1], "offset path differs from the guess"
    assert abs(exact[0] - 0.25) < 1e-9


def test_zero_offset_falls_back_to_guess():
    # A (0,0) offset is treated as "no offset" → geometric guess (no division by
    # the degenerate vector); legacy/blank rows behave as before.
    _patch({"x_norm": 0.15, "y_norm": 0.19, "w_norm": 0.10, "h_norm": 0.02})
    relo = anchor._relocate_value_by_label(object(), "Date", "right", VBOX, offset=(0.0, 0.0))
    assert abs(relo[0] - 0.304) < 1e-6, "zero offset uses the adjacency guess"


def test_label_not_found_returns_none():
    _patch(None)
    assert anchor._relocate_value_by_label(object(), "Date", "right", VBOX) is None


def test_blank_label_or_zero_box_is_noop():
    _patch({"x_norm": 0.15, "y_norm": 0.19, "w_norm": 0.10, "h_norm": 0.02})
    assert anchor._relocate_value_by_label(object(), "", "right", VBOX) is None
    assert anchor._relocate_value_by_label(object(), "Date", "right", (0.3, 0.2, 0, 0)) is None


if __name__ == "__main__":
    test_no_drift_recovers_taught_position()
    test_value_follows_label_drift_up()
    test_below_direction_places_value_under_label()
    test_offset_path_places_value_at_label_plus_offset()
    test_offset_path_is_drift_invariant()
    test_offset_overrides_geometric_guess()
    test_zero_offset_falls_back_to_guess()
    test_label_not_found_returns_none()
    test_blank_label_or_zero_box_is_noop()
    print("All anchor label-relocation (drift recovery) checks passed")
