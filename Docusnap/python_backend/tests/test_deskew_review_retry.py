"""Pins the SAFETY invariants of the review-bound whole-page straighten retry
(DESKEW_SLICE_REREAD_2026-08-30, revised — see process_docs.py). A future dev must not be able to quietly:
  - drop the "only on a doc already review-bound" gate (which is what stops it demoting a clean auto-file),
  - run it on an already-deskewed run or a reprocess, and
  - loosen the adopt comparison from STRICTLY-higher (a tie/drop must keep the raw read — no regression).
Pure-function pins only (no OCR); the corpus heal rate is proven by the Nordwind census, not here."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from process_docs import _deskew_retry_should_run, _deskew_retry_adopt

fails = []
def check(name, cond):
    if not cond: fails.append(name)

# ── gate: runs ONLY when enabled AND review-bound AND not deskewed AND not reextract AND has pages ──
check("all-true runs",        _deskew_retry_should_run(True,  True,  False, False, True)  is True)
check("disabled  -> no",      _deskew_retry_should_run(False, True,  False, False, True)  is False)
check("auto-file -> no",      _deskew_retry_should_run(True,  False, False, False, True)  is False)  # never demote a clean auto-file
check("already-deskew -> no", _deskew_retry_should_run(True,  True,  True,  False, True)  is False)
check("reextract  -> no",     _deskew_retry_should_run(True,  True,  False, True,  True)  is False)
check("no pages   -> no",     _deskew_retry_should_run(True,  True,  False, False, False) is False)

# ── adopt: STRICTLY higher overall only ──
check("higher  -> adopt",     _deskew_retry_adopt(90, 97) is True)
check("equal   -> keep raw",  _deskew_retry_adopt(97, 97) is False)
check("lower   -> keep raw",  _deskew_retry_adopt(97, 80) is False)
check("from 0  -> adopt",     _deskew_retry_adopt(0, 60)  is True)
check("None base tolerant",   _deskew_retry_adopt(None, 50) is True)
check("None both -> keep",    _deskew_retry_adopt(None, None) is False)
check("garbage -> keep raw",  _deskew_retry_adopt("x", "y") is False)

if fails:
    print("FAIL:", ", ".join(fails)); sys.exit(1)
print("test_deskew_review_retry: 13/13 OK")
