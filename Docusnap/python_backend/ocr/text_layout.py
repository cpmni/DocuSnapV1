"""Shared OCR reading-order layout marker — the single source of truth for the COLUMN BREAK.

reconstruct_page_text (ocr/tesseract.py) and the born-digital text layer (ocr/born_digital.py) group
words into visual ROWS and emit this marker between two words separated by a wide intra-row x-gap — i.e.
a distinct COLUMN on the same visual line ("WORKSHEET <gap> Date 25/11/2026", a right-aligned totals
block, a two-column key/value row). A normal word gap is a single space. Downstream consumers
(keyword.py: the heading test + the caption/column-interleave guards) split reading lines back into
column segments on this marker, so the PRODUCERS and the CONSUMERS must agree on its exact width — a
silent divergence would mis-pair columns or (Oracle 2026-07-12) silently reintroduce the stuck-WORKSHEET
type bug. One constant + a pinned contract test (test_column_break_contract.py) keeps them in lockstep.

A leaf module (no heavy deps) so extraction/keyword.py can import it without pulling in Tesseract/PIL.
"""

COLUMN_BREAK = "    "                    # 4 spaces = one column break
COLUMN_BREAK_MIN = len(COLUMN_BREAK)     # split threshold: a run of THIS-many-or-more spaces (adjacent
                                         # columns compound, e.g. 8 spaces, so consumers match ' {4,}')
