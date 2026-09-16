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

# 6. is_continuation_page — the self-declared continuation veto (mig 177 segment_continuation_veto, DARK).
print("is_continuation_page: a page that declares itself a continuation is never a cut")
ic = seg.is_continuation_page
check('"Page 2 of 2" (footer) -> True', ic("Copperfield Electrical\nline items\nTotal 866.04\nPage 2 of 2"))
check('"Page 1 of 2" -> False (n=1 never suppresses)', not ic("INVOICE\nPage 1 of 2\nitems"))
check('"Page 2/3" -> True', ic("items\npage 2/3"))
check('"Page 3" alone (n>=2) -> True', ic("Page 3\nitems"))
check('"Page 1" alone -> False', not ic("Page 1\nitems"))
check('"(continued)" in the top band -> True', ic("Copperfield Electrical\n27 Faraday Industrial Park\n(continued)\nDescription Qty"))
check('"INVOICE (cont.)" -> True', ic("Acme Ltd\nINVOICE (cont.)\nDescription"))
check('"continued on page 2" (the footer of the page BEFORE) -> False', not ic("INVOICE\nitems\ncontinued on page 2"))
check('"Brought forward 721.70" in the top band -> True', ic("Acme Ltd\nBrought forward 721.70\nitems"))
check('"B/F 721.70" -> True', ic("Acme Ltd\nB/F 721.70\nitems"))
check('"Carried forward" -> False (marks the page before)', not ic("Acme Ltd\nitems\nCarried forward 721.70"))
check('"continued" deep in the body (line 30) -> False (top band only)', not ic("Acme Ltd\n" + "line\n" * 28 + "continued"))
check('empty / None -> False', not ic("") and not ic(None))
print()

# 7. keyword.title_signal — the process_docs title recipe for the pre-pass (mig 178 segment_title_slug, DARK).
print("title_signal: installed slug + trusted heading only; (None, False) on any doubt")
from extraction import keyword as K
pats = K.load_patterns(None)
DT = [{"name": "Invoice", "slug": "invoice"}, {"name": "Purchase Order", "slug": "purchase_order"},
      {"name": "Sales Order", "slug": "sales_order"}, {"name": "Quick Form", "slug": "quick_form", "reading_mode": "none"}]
po_page = "Copperfield Electrical\n27 Faraday Industrial Park\nCoventry CV3 4LF\n\nPURCHASE ORDER\n\nSupplier\nFernbank Veterinary Clinic\nOrder No. PO-1001\nOrder Date 02/10/2026\nDescription Qty Unit Amount\n"
s, t = K.title_signal(po_page, pats, DT)
check("a standalone PURCHASE ORDER heading -> ('purchase_order', True)", s == "purchase_order" and t is True)
s, t = K.title_signal("Dear Sir,\nplease raise a purchase order for the goods below and we will invoice you.\nRegards", pats, DT)
check("a mention with no heading -> trusted False", t is False)
s, t = K.title_signal(po_page, pats, [{"name": "Purchase Order", "slug": "purchase_order", "reading_mode": "none"}])
check("a reading_mode='none' type is never a candidate -> (None, False)", s is None and t is False)
s, t = K.title_signal("Acme Ltd\nSTATEMENT\nAccount 1234\n", pats, [{"name": "Invoice", "slug": "invoice"}])
check("an UNINSTALLED heading -> (None, False) (the pinned divergence: no uninstalled-name slug fallback)", s is None and t is False)
s, t = K.title_signal("Acme Ltd\nWORKS ORDER\nJob 55\nDate 01/02/2026\n", pats, [{"name": "Works Order", "slug": "works_order", "title_aliases": '["Works Order"]'}])
check("a title alias stored as a JSON string still resolves the installed slug", s == "works_order")
check("None / empty inputs -> (None, False)", K.title_signal("", pats, DT) == (None, False) and K.title_signal(po_page, None, DT) == (None, False) and K.title_signal(po_page, pats, None) == (None, False))
print()

# 8. page_match — the cascade (trusted -> untrusted slug -> today's call), never losing today's boundary.
print("page_match: OFF = the 3-arg call; ON = cascade with fallback on None / type_refused")
calls = []
def _stub_factory(script):
    # script: list of return values per call, consumed in order
    def stub(img, text, templates, *args):
        calls.append(args)
        return script.pop(0) if script else None
    return stub
REFUSE = {"template": None, "type_refused": True, "detected_slug": "worksheet", "refused_slug": "worksheet"}
TPL = {"template": {"id": 4, "keyword_fingerprint": ["copperfield", "electrical"]}, "confidence": 88, "method": "logo"}
orig_identify, orig_title = template_matcher.identify_template, K.title_signal
try:
    calls.clear(); template_matcher.identify_template = _stub_factory([TPL])
    seg.page_match(None, "text", [{"id": 4}], None)
    check("OFF (title_ctx None): exactly one call with NO slug args", calls == [()])
    K.title_signal = lambda text, p, d: ("sales_order", True)
    calls.clear(); template_matcher.identify_template = _stub_factory([TPL])
    m = seg.page_match(None, "text", [{"id": 4}], {"patterns": {}, "doc_types": [{}]})
    check("ON + trusted: first call carries (slug, True) and a template answer ends the cascade", calls == [("sales_order", True)] and (m or {}).get("template", {}).get("id") == 4)
    calls.clear(); template_matcher.identify_template = _stub_factory([REFUSE, REFUSE, TPL])
    m = seg.page_match(None, "text", [{"id": 4}], {"patterns": {}, "doc_types": [{}]})
    check("ON + trusted: refuse -> untrusted-slug call -> refuse -> today's call wins (a page never loses today's boundary)",
          calls == [("sales_order", True), ("sales_order", False), ()] and (m or {}).get("template", {}).get("id") == 4)
    K.title_signal = lambda text, p, d: ("sales_order", False)
    calls.clear(); template_matcher.identify_template = _stub_factory([TPL])
    seg.page_match(None, "text", [{"id": 4}], {"patterns": {}, "doc_types": [{}]})
    check("ON + untrusted slug: the first call is the untrusted-slug call (the matching branch needs no trust)", calls == [("sales_order", False)])
    calls.clear(); template_matcher.identify_template = _stub_factory([REFUSE, REFUSE])
    m = seg.page_match(None, "text", [{"id": 4}], {"patterns": {}, "doc_types": [{}]})
    check("every step refuses -> no template -> decide_boundary is False (Q2 deferral PINNED: a type_refused is NOT a boundary signal)",
          not (m or {}).get("template") and seg.decide_boundary(None, 7, 0.0, False) is False)
    K.title_signal = lambda text, p, d: (None, False)
    calls.clear(); template_matcher.identify_template = _stub_factory([TPL])
    seg.page_match(None, "text", [{"id": 4}], {"patterns": {}, "doc_types": [{}]})
    check("ON but no title on the page: exactly one 3-arg call (identical to OFF)", calls == [()])
finally:
    template_matcher.identify_template, K.title_signal = orig_identify, orig_title
src = Path(__file__).parent.parent.joinpath("ocr", "segmentation.py").read_text(encoding="utf-8")
check("detect_segments applies the veto only when armed AND never on page 0", "bool(continuation_veto and i > 0 and is_continuation_page(text))" in src)
check("detect_segments suppresses an otherwise-decided boundary on a self-declared continuation", "if boundary and self_cont:" in src and 'boundary = False' in src)
check("decide_boundary itself is untouched (the veto sits in the walk, not the rule)", "first_signature = matched_id is not None and fp_overlap >= fp_floor" in src)
print()

if fail:
    print(f"{fail} check(s) failed — segmentation regressed.")
    sys.exit(1)
print("All segmentation checks passed.")
sys.exit(0)
