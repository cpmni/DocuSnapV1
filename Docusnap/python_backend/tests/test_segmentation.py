#!/usr/bin/env python3
"""
tests/test_segmentation.py
--------------------------
Batch document SEPARATION (Stage 1) — the boundary logic and the conservative first-page
guard. Pure logic; no Tesseract / no PDF needed (template match is stubbed).

    py -3.12 python_backend/tests/test_segmentation.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from ocr import segmentation as seg
from extraction import template_matcher

fail = 0


def check(label, cond):
    global fail
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fail += 1


# 1. segment_pages — the conservative boundary rule.
print("segment_pages: a later first-page flag starts a new document; a continuation attaches")
check("empty -> []", seg.segment_pages([]) == [])
check("single page -> one segment", seg.segment_pages([True]) == [(0, 0)])
check("3-page INVOICE (1 first + 2 continuations) -> ONE segment",
      seg.segment_pages([True, False, False]) == [(0, 2)])
check("10 independent first pages (the PT.pdf batch) -> TEN segments",
      seg.segment_pages([True] * 10) == [(i, i) for i in range(10)])
check("mixed batch [doc, doc(2pp), doc] -> three segments",
      seg.segment_pages([True, True, False, True]) == [(0, 0), (1, 2), (3, 3)])
check("page 0 is always a boundary even if flagged False",
      seg.segment_pages([False, False]) == [(0, 1)])
print()

# 2. fingerprint_overlap — fraction of the TEMPLATE's signature present on the page.
print("fingerprint_overlap: fraction of template words on the page; empty template -> 0")
check("full overlap = 1.0", seg.fingerprint_overlap(["a", "b", "c"], ["a", "b", "c"]) == 1.0)
check("half overlap = 0.5", seg.fingerprint_overlap(["a", "b"], ["a", "x"]) == 0.5)
check("empty template -> 0.0 (never a boundary)", seg.fingerprint_overlap(["a"], []) == 0.0)
print()

# 3. page_is_first — the conservative guard: a LOGO-only continuation page (low
#    fingerprint overlap) is NOT a new document; a real first page IS.
print("page_is_first: requires BOTH a template match AND first-page fingerprint overlap")
_orig_id = template_matcher.identify_template
_orig_fp = template_matcher.extract_keyword_fingerprint
TMPL = {"id": 7, "keyword_fingerprint": ["print", "tracker", "alert", "supply"]}
try:
    # No template match at all -> not a first page.
    template_matcher.identify_template = lambda img, txt, tmpls: None
    template_matcher.extract_keyword_fingerprint = lambda txt, **k: txt.split()
    ok, info = seg.page_is_first("anything here", None, [TMPL])
    check("no template match -> not a first page", ok is False)

    # Logo matched (same letterhead) but the page lacks the first-page fingerprint
    # (an invoice's continuation page) -> NOT a new document.
    template_matcher.identify_template = lambda img, txt, tmpls: {"template": TMPL, "confidence": 88, "method": "logo"}
    ok, info = seg.page_is_first("continued line items 3 of 4", None, [TMPL])
    check("logo-only continuation page -> NOT a boundary", ok is False)
    check("  reason names it a continuation", "continuation" in info.get("reason", ""))

    # Page carries the template's first-page fingerprint -> a new document.
    ok, info = seg.page_is_first("Print Tracker alert supply level low", None, [TMPL])
    check("first-page fingerprint present -> IS a boundary", ok is True)
    check("  fp_overlap reported >= floor", (info.get("fp_overlap") or 0) >= seg.FIRST_PAGE_FP_FLOOR)
finally:
    template_matcher.identify_template = _orig_id
    template_matcher.extract_keyword_fingerprint = _orig_fp
print()

# 4. is_document_start — a generic new-document header (for UNKNOWN types with no template).
print("is_document_start: an email/invoice header opens a document; a continuation page does not")
check("email header (From+Sent+Subject) -> document start",
      seg.is_document_start("From: alerts@x.com Sent: 12 June 2026 To: Service Subject: Toner low") is True)
check("invoice header (Invoice To + Invoice No + Invoice Date) -> document start",
      seg.is_document_start("Invoice  Invoice To St Marks  Invoice No. 152888  Invoice Date 15/06/2026") is True)
check("line-item continuation page -> NOT a document start",
      seg.is_document_start("12  Widget blue  3  4.50  13.50\n13  Bracket  1  2.00  2.00") is False)
check("a lone repeated 'Invoice No.' header is NOT enough (no addressing block)",
      seg.is_document_start("Invoice No. 152888   page 2 of 3") is False)
print()

# 5. decide_boundary — the (a)/(b)/(c) rule that walks the pages.
print("decide_boundary: first-page signature / different template / generic doc-start")
check("(a) same template, fingerprint over floor -> boundary",
      seg.decide_boundary(10, 10, 0.55, False) is True)
check("(b) a DIFFERENT known template -> boundary (mixed known-type batch)",
      seg.decide_boundary(9, 10, 0.10, False) is True)
check("(c) no template match but a doc-start header -> boundary (the trailing invoice)",
      seg.decide_boundary(None, 10, 0.0, True) is True)
check("continuation: no match, no header -> NOT a boundary (multi-page invoice body)",
      seg.decide_boundary(None, 10, 0.0, False) is False)
check("a logo-only same-template continuation (overlap under floor, no header) -> NOT a boundary",
      seg.decide_boundary(10, 10, 0.20, False) is False)
print()

if fail:
    print(f"{fail} check(s) failed — segmentation regressed.")
    sys.exit(1)
print("All segmentation checks passed.")
sys.exit(0)
