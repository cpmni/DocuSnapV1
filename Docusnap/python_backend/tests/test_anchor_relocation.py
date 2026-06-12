#!/usr/bin/env python3
"""
tests/test_anchor_relocation.py
-------------------------------
Regression coverage for GAP 1 (NORTH STAR restoration): Stage 2 taught-anchor
extraction now RELOCATES to the live anchor label at extraction time and derives
the value box from the label's CURRENT position, instead of replaying the
absolute saved value coordinates. Mirrors the Stage 0.5 (template_mapper)
relocation model.

These checks exercise the relocation geometry and the live-label search with an
injected OCR-lines stub (the same convention template_mapper's own tests use),
so no Tesseract is required. They prove:
  • the value box is derived from the live label position per direction;
  • when the same family drifts (label OCR'd at a different position), the
    derived value box TRACKS the label rather than the stale absolute box;
  • when the label appears more than once, the candidate nearest the stored
    position wins (absolute coords are a tie-breaker only);
  • when the label can't be relocated, relocation returns None so the caller
    falls back to the legacy absolute crop (no regression).

Usage:
    py -3.12 python_backend/tests/test_anchor_relocation.py

Exit code 0 = behaves as expected. Exit code 1 = regression.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from PIL import Image                          # noqa: E402
from extraction import anchor, template_mapper  # noqa: E402

EPS = 1e-6


def check(label, condition):
    print(f"  {'OK ' if condition else 'BAD'} {label}")
    return condition


def section(title):
    print(f"\n{title}")


def approx(a, b, eps=1e-4):
    return abs(a - b) <= eps


# A page just needs .size and .crop for template_mapper._crop; contents are
# irrelevant because the OCR-lines function is stubbed.
PAGE = Image.new("RGB", (1000, 1400), "white")


def _search_box(stored):
    """Replicate the search region _best_value_box computes, so tests can map a
    stub line's crop-relative coords to the page coords it will produce."""
    return template_mapper._clamp_box(
        template_mapper._expand_box(stored, anchor._RELOCATE_EXPANSION))


def _line(text, x, y, w, h):
    return {"text": text, "x_norm": x, "y_norm": y, "w_norm": w, "h_norm": h}


def _stub(lines):
    return lambda _crop: list(lines)


def run():
    ok = True

    # ── Pure geometry: value box derived relative to the live label ──────────
    section("_derive_value_box places the value relative to the live label")
    stored = {"x_norm": 0.40, "y_norm": 0.40, "w_norm": 0.10, "h_norm": 0.03}
    lbl = {"x_norm": 0.10, "y_norm": 0.50, "w_norm": 0.06, "h_norm": 0.02}

    below = anchor._derive_value_box(lbl, "below", stored)
    ok &= check("below: value y sits just under the label",
                approx(below["y_norm"], lbl["y_norm"] + lbl["h_norm"]))
    ok &= check("below: value x keeps the stored x (horizontal is stable)",
                approx(below["x_norm"], stored["x_norm"]))

    above = anchor._derive_value_box(lbl, "above", stored)
    ok &= check("above: value y sits a value-height above the label",
                approx(above["y_norm"], lbl["y_norm"] - stored["h_norm"]))

    right = anchor._derive_value_box(lbl, "right", stored)
    ok &= check("right: value x begins just past the label's right edge",
                approx(right["x_norm"], lbl["x_norm"] + lbl["w_norm"]))
    ok &= check("right: value y is centred on the label's row",
                approx(right["y_norm"], lbl["y_norm"] + lbl["h_norm"] / 2 - stored["h_norm"] / 2))

    # ── Drift tolerance: derived box tracks the label, not the absolute box ──
    section("Derived value box follows the label when the layout drifts")
    sb = _search_box(stored)

    def page_y_of(ly, lh):
        # page y of a stub line at crop-relative (ly, lh)
        return sb["y_norm"] + ly * sb["h_norm"], lh * sb["h_norm"]

    box_hi = anchor._best_value_box(PAGE, "Date", stored, "below",
                                    ocr_lines_fn=_stub([_line("Date", 0.10, 0.40, 0.12, 0.05)]))
    box_lo = anchor._best_value_box(PAGE, "Date", stored, "below",
                                    ocr_lines_fn=_stub([_line("Date", 0.10, 0.80, 0.12, 0.05)]))
    ok &= check("label found higher -> value box higher", box_hi is not None and box_lo is not None)
    if box_hi and box_lo:
        ok &= check("a label that drifted DOWN pushes the value box DOWN too",
                    box_lo["y_norm"] > box_hi["y_norm"] + 0.02)
        # And it genuinely tracks the live label (matches the derivation),
        # rather than returning the stored absolute y.
        ly, lh = 0.80, 0.05
        py, ph = page_y_of(ly, lh)
        ok &= check("derived y equals live-label bottom (relocated, not stored y)",
                    approx(box_lo["y_norm"], py + ph))
        ok &= check("derived y is NOT the stale stored value y",
                    not approx(box_lo["y_norm"], stored["y_norm"], eps=0.02))

    # ── Multiple occurrences: stored position breaks the tie ────────────────
    section("When the label repeats, the nearest-to-stored candidate wins")
    # One occurrence whose derived value lands on the stored position, one far.
    # below: derived y = page_y(ly)+page_h(lh); we want that ~= stored bottom.
    target_y = stored["y_norm"]            # derived y we want for the "near" hit
    # solve page_y(ly)+ph = target_y with lh small
    lh = 0.01
    ph = lh * sb["h_norm"]
    ly = (target_y - ph - sb["y_norm"]) / sb["h_norm"]
    near = _line("Date", 0.10, ly, 0.12, lh)
    far  = _line("Date", 0.10, 0.95, 0.12, 0.05)
    chosen = anchor._best_value_box(PAGE, "Date", stored, "below",
                                    ocr_lines_fn=_stub([far, near]))
    ok &= check("tie-break selects the occurrence nearest the stored position",
                chosen is not None and approx(chosen["y_norm"], target_y, eps=2e-3))

    # ── No label found -> None (caller falls back to absolute crop) ─────────
    section("Unrelocatable label returns None (legacy absolute crop fallback)")
    none_box = anchor._best_value_box(PAGE, "Date", stored, "below",
                                      ocr_lines_fn=_stub([_line("Quantity", 0.1, 0.5, 0.1, 0.03)]))
    ok &= check("no matching label -> None", none_box is None)
    ok &= check("_relocate_and_read with empty label -> None",
                anchor._relocate_and_read(PAGE, {"anchor_label": ""}, None) is None)

    # ── Merged inline line guard (direction=right) ──────────────────────────
    section("direction=right: a merged 'label value' line is skipped, not mis-cropped")
    # A single OCR line spanning label+value, extending past the stored value
    # centre — deriving "just past the label" would overshoot the value.
    merged = _line("Job No 2605-0805-1", 0.05, 0.50, 0.90, 0.04)
    guard = anchor._best_value_box(PAGE, "Job No", stored, "right",
                                   ocr_lines_fn=_stub([merged]))
    ok &= check("merged inline right-line yields no relocated box (text search handles it)",
                guard is None)

    # ── Stored center -> top-left conversion ────────────────────────────────
    section("_stored_value_box converts the saved CENTRE back to a top-left box")
    sv = anchor._stored_value_box({"x_norm": 0.50, "y_norm": 0.30, "w_norm": 0.10, "h_norm": 0.04})
    ok &= check("top-left x = centre - w/2", approx(sv["x_norm"], 0.45))
    ok &= check("top-left y = centre - h/2", approx(sv["y_norm"], 0.28))

    ok &= run_word_reader()
    return ok


# ── Word-box value reader (the PRIMARY relocation path) ──────────────────────

def _w(text, x0, x1, h, y0=200.0, row=(0, 0, 0)):
    """Build a pixel-space word box as the reader sees it post-projection."""
    return {"text": text, "x0": x0, "x1": x1, "y0": y0, "y1": y0 + h, "h": h, "row": row}


def run_word_reader():
    ok = True

    # ── Label span location within a row ────────────────────────────────────
    section("_find_label_span finds the contiguous label words in a row")
    row = [_w("Ticket", 100, 150, 28), _w("No.", 160, 200, 28),
           _w("2603-1351-1", 240, 380, 28)]
    ok &= check("'ticket no.' span = words 0..1",
                anchor._find_label_span(row, "ticket no.") == (0, 1))
    ok &= check("absent label -> None",
                anchor._find_label_span(row, "purchase order") is None)

    # ── Right value: drop tiny-height OCR specks, stop at the column gap ─────
    section("direction=right reads the value, dropping noise and stopping at the column")
    # after the label: a noise dash (h=3), the real value (h=29), a noise speck
    # (h=3), then the next column (big gap)
    seq = [_w("-", 210, 214, 3), _w("2603-1351-1", 250, 390, 29),
           _w("oe", 430, 442, 3), _w("Work", 620, 700, 29)]
    got = anchor._collect_value_words(seq, height_ref=29.0)
    ok &= check("collected value = just the real token",
                " ".join(x["text"] for x in got) == "2603-1351-1")

    # ── Multi-word value kept together until the real column boundary ───────
    section("a multi-word value is kept whole until the column gap")
    seq2 = [_w("Beaumont", 100, 200, 28), _w("Care", 210, 270, 28),
            _w("Homes", 280, 360, 28), _w("Ltd", 370, 420, 28),
            _w("BT42", 640, 740, 28)]  # large gap before postcode column
    got2 = anchor._collect_value_words(seq2, height_ref=28.0)
    ok &= check("value spans the whole company name, not the next column",
                " ".join(x["text"] for x in got2) == "Beaumont Care Homes Ltd")

    section("a run of only noise specks yields nothing")
    seq3 = [_w(".", 210, 213, 3), _w("~", 230, 233, 4)]
    ok &= check("all-noise sequence -> empty",
                anchor._collect_value_words(seq3, height_ref=28.0) == [])

    # ── below / above read the adjacent row in the same column ──────────────
    section("direction=below reads the row directly under the label")
    label_row = [_w("Work", 100, 170, 28, y0=200), _w("Address", 180, 300, 28, y0=200)]
    rows = {
        (0, 0, 0): label_row,
        (0, 0, 1): [_w("Beaumont", 100, 250, 28, y0=240),
                    _w("Care", 260, 330, 28, y0=240)],
        (0, 0, 9): [_w("Header", 100, 200, 28, y0=120)],  # a row above (ignored)
    }
    below = anchor._read_value_for_direction(label_row, 0, 1, rows, "below")
    ok &= check("below picks the row just under the label",
                " ".join(x["text"] for x in below) == "Beaumont Care")
    above = anchor._read_value_for_direction(label_row, 0, 1, rows, "above")
    ok &= check("above picks the row just over the label",
                " ".join(x["text"] for x in above) == "Header")

    # ── Wrapper integration with a stubbed word OCR ─────────────────────────
    section("_relocate_value_words end-to-end with a stubbed OCR")
    page = Image.new("RGB", (1000, 1000), "white")
    anc = {"anchor_label": "Ticket No.", "direction": "right",
           "x_norm": 0.45, "y_norm": 0.30, "w_norm": 0.12, "h_norm": 0.03}

    def stub_words(_crop):
        # label + clean value + a tiny noise speck, all on one row
        return [
            {"text": "Ticket", "x_norm": 0.05, "y_norm": 0.45, "w_norm": 0.08, "h_norm": 0.30, "row": (0, 0, 0)},
            {"text": "No.",    "x_norm": 0.15, "y_norm": 0.45, "w_norm": 0.05, "h_norm": 0.30, "row": (0, 0, 0)},
            {"text": "2603-1351-1", "x_norm": 0.30, "y_norm": 0.45, "w_norm": 0.20, "h_norm": 0.30, "row": (0, 0, 0)},
            {"text": "x", "x_norm": 0.92, "y_norm": 0.45, "w_norm": 0.01, "h_norm": 0.03, "row": (0, 0, 0)},  # speck
        ]
    val = anchor._relocate_value_words(page, anc, None, ocr_words_fn=stub_words)
    ok &= check("end-to-end relocation reads the clean value", val == "2603-1351-1")

    def stub_absent(_crop):
        return [{"text": "Quantity", "x_norm": 0.1, "y_norm": 0.45, "w_norm": 0.1, "h_norm": 0.30, "row": (0, 0, 0)}]
    ok &= check("label not present -> None (caller falls back)",
                anchor._relocate_value_words(page, anc, None, ocr_words_fn=stub_absent) is None)

    return ok


if __name__ == "__main__":
    print("=" * 60)
    print("Stage 2 anchor relocation (GAP 1)")
    print("=" * 60)
    success = run()
    print("\n" + ("ALL PASSED" if success else "FAILURES PRESENT"))
    sys.exit(0 if success else 1)
