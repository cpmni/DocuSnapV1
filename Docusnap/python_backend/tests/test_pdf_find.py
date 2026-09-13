"""
test_pdf_find.py — PIN for the in-document find (search-term jump/highlight) and its scanned-page OCR
word-box fallback (2026-09-13). Pure-function coverage (word/phrase matching + px→fraction) needs no
Tesseract/render; source guards pin the accepted trade-offs so a future edit can't silently break them.

Run: py -3.12 -m pytest python_backend/tests/test_pdf_find.py
"""
import os
import sys

_RENDER = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "render")
sys.path.insert(0, _RENDER)
import pdf_find   # noqa: E402


# ── px → fraction + normalise ────────────────────────────────────────────────────
def test_clamp01_bounds():
    assert pdf_find._clamp01(-0.2) == 0.0
    assert pdf_find._clamp01(1.7) == 1.0
    assert pdf_find._clamp01(0.4) == 0.4


def test_norm_lower_and_collapse():
    assert pdf_find._norm("  Credit   NOTE ") == "credit note"
    assert pdf_find._norm(None) == ""


# ── OCR row matching (fractions already; boxes are [x0,y0,x1,y1,text_lower]) ───────
def _row(*words):
    # words: (x0,y0,x1,y1,text) — text is already normalised (lower) as the index stores it
    return [list(w) for w in words]


def test_match_single_word():
    rows = [_row((0.1, 0.1, 0.2, 0.12, "statement"), (0.3, 0.1, 0.4, 0.12, "of"))]
    out = pdf_find._match_rows(rows, "statement")
    assert len(out) == 1
    assert out[0]["x0"] == 0.1 and out[0]["x1"] == 0.2


def test_match_phrase_unions_adjacent_word_boxes():
    rows = [_row((0.10, 0.10, 0.20, 0.12, "statement"),
                 (0.22, 0.10, 0.26, 0.12, "of"),
                 (0.28, 0.10, 0.42, 0.12, "account"))]
    out = pdf_find._match_rows(rows, "statement of account")
    assert len(out) == 1
    # union spans the first word's left to the last word's right
    assert out[0]["x0"] == 0.10 and out[0]["x1"] == 0.42


def test_match_absent_term_returns_nothing():
    rows = [_row((0.1, 0.1, 0.2, 0.12, "credit"), (0.3, 0.1, 0.4, 0.12, "note"))]
    assert pdf_find._match_rows(rows, "invoice") == []


def test_match_empty_term_returns_nothing():
    rows = [_row((0.1, 0.1, 0.2, 0.12, "credit"))]
    assert pdf_find._match_rows(rows, "") == []


def test_match_two_occurrences_two_boxes():
    rows = [
        _row((0.1, 0.1, 0.2, 0.12, "total")),
        _row((0.1, 0.5, 0.2, 0.52, "total")),
    ]
    out = pdf_find._match_rows(rows, "total")
    assert len(out) == 2


# ── Accepted-trade-off guards (display-only; a future dev must not silently break them) ──
def test_display_only_no_db_or_engine_imports():
    """The find script is DISPLAY-ONLY: it must never touch the DB, the extraction engine, learning,
    or trust. It renders + OCRs a page for HIGHLIGHT boxes and returns geometry only."""
    src = open(os.path.join(_RENDER, "pdf_find.py"), encoding="utf-8").read()
    assert "--db" not in src                      # no database handle is passed in
    assert "from extraction" not in src           # never imports the extraction engine
    assert "import sqlite3" not in src
    # The ONLY python_backend import is the OCR word-box reader (geometry), lazily inside the OCR branch.
    assert "from ocr.tesseract import reconstruct_page_text" in src
    assert "from ocr.tesseract import configure" in src


def test_ocr_only_when_no_text_layer():
    """OCR runs ONLY on a pure scan: a born-digital doc whose term is absent returns without OCR
    (any_text guard), so an authoritative text layer is never second-guessed by fuzzy OCR."""
    src = open(os.path.join(_RENDER, "pdf_find.py"), encoding="utf-8").read()
    assert "if any_text:" in src
    # the OCR index build (its CALL in main) sits AFTER the any_text early-return
    assert src.index("if any_text:") < src.index("index = _get_ocr_index(")


def test_ocr_boxes_are_top_left_no_yflip():
    """Tesseract boxes are top-left origin — the OCR path must NOT y-flip (only the PDF text-layer path
    does, because PDF space is bottom-up)."""
    src = open(os.path.join(_RENDER, "pdf_find.py"), encoding="utf-8").read()
    # the y-flip (h - t)/h appears only in the text-layer function, never in the OCR index builder
    build = src[src.index("def _build_ocr_index"):src.index("def _get_ocr_index")]
    assert "(h - t)" not in build and "h -" not in build


if __name__ == "__main__":
    import pytest
    sys.exit(pytest.main([__file__, "-q"]))
