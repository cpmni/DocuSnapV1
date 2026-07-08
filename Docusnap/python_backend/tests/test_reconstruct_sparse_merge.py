#!/usr/bin/env python3
"""
Guards the sparse-column-recovery MERGE logic in ocr/tesseract.reconstruct_page_text: a second
"uniform block" pass (PSM 6) recovers a sparse right-aligned column (a totals block whose AMOUNTS
PSM 3's page segmentation drops) and merges back ONLY the high-confidence words that land where the
main pass left an EMPTY region. The image-level behaviour is verified on real scanned docs; this
unit-guards the two pure helpers so the merge can't silently import duplicates/noise or drop words.

Run: py -3.12 python_backend/tests/test_reconstruct_sparse_merge.py   (exit 0 = pass)
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from ocr.tesseract import _words_from_data, _center_in_any

fails = []
def check(label, cond):
    if not cond:
        fails.append(label)
    print(f"  {'OK ' if cond else 'BAD'} {label}")

# ── _words_from_data: parse (left, top, w, h, text, conf); skip empty tokens ──────
data = {
    "text":  ["", "Net", "84.40", "   "],
    "left":  [0, 100, 500, 700],
    "top":   [0,  10,  10,  10],
    "width": [0,  40,  60,  10],
    "height":[0,  20,  20,  20],
    "conf":  ["-1", "96", "95", "40"],
}
words = _words_from_data(data)
check("skips empty / whitespace-only tokens (2 real words)", len(words) == 2)
check("parses (left, top, w, h, text, conf)", words[0] == (100, 10, 40, 20, "Net", 96.0))
check("carries the confidence", words[1][5] == 95.0)
# a missing conf column -> -1 (never crashes)
check("missing conf column -> -1.0",
      _words_from_data({"text": ["A"], "left": [0], "top": [0], "width": [5], "height": [5]})[0][5] == -1.0)

# ── _center_in_any: a word whose CENTRE sits inside a base box is already recognised ──
base_boxes = [(100, 10, 40, 20)]                       # the "Net" box: x 100-140, y 10-30
check("centre inside a base box -> True (duplicate, don't merge)",
      _center_in_any((108, 12, 30, 16, "Net", 90), base_boxes) is True)
check("word in an EMPTY region -> False (merge it)",
      _center_in_any((500, 10, 60, 20, "84.40", 95), base_boxes) is False)
check("empty base -> nothing is a duplicate",
      _center_in_any((100, 10, 40, 20, "x", 90), []) is False)

if fails:
    print(f"\n{len(fails)} FAILED"); sys.exit(1)
print("\nAll reconstruct sparse-merge helper checks passed.")
