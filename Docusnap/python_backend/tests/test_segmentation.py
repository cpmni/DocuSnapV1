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

# 9. mig 179 segment_known_supplier_change (2026-09-17; gary → Oracle SIGN-OFF-W/COND C1-C3) — admission, the band read,
#    same_supplier, the witness. All pure.
print("known-supplier rule: admission, band, same_supplier, witness")
check("admit: two content tokens", seg.admit_known_name("Copperfield Electrical") and seg.admit_known_name("Thornbury Fasteners Ltd"))
check("admit: one token of >= 8 letters; a short single token never", seg.admit_known_name("Copperfield") and not seg.admit_known_name("Acme Ltd"))
check("admit: 'PT' / 'ME' / 'new' / 'test' / 'wp' / '' never enter", not any(seg.admit_known_name(x) for x in ("PT", "ME", "new", "test", "wp", "", None)))
check("admit: 'Chris Docs' / 'Sales Invoice' die to the chrome / stop-word / short-token strip",
      not seg.admit_known_name("Chris Docs") and not seg.admit_known_name("Sales Invoice"))
check("admit (documented): an 8-letter single token such as 'Finances' IS admitted by the rule — the >= 3 human-confirm bar of the population is what keeps a one-off test name out",
      seg.admit_known_name("Finances"))
check("admit: 'Print Tracker Doc' keeps its two content tokens; 'Nordwind Refrigeration Ltd' its two", seg.admit_known_name("Print Tracker Doc") and seg.admit_known_name("Nordwind Refrigeration Ltd"))
known = seg.prepare_known_suppliers(["Copperfield Electrical", "Thornbury Fasteners Ltd", "PT", "Print Tracker Doc", "copperfield electrical ltd", None, ""])
check("prepare: admitted only, deduped on the suffix-stripped key, longest names first",
      [e["name"] for e in known] == ["Print Tracker Doc", "Copperfield Electrical", "Thornbury Fasteners Ltd"])
P1 = "COPPERFIELD ELECTRICAL LTD\nUnit 7 Riverside Estate\nBristol BS2 0QY\n\nINVOICE\nInvoice To:\nThornbury Fasteners\n12 Trade Park\nInvoice No: INV-3321\nInvoice Date: 12/08/2026\nDescription Qty Unit Amount\nCable clips 12 4.20 50.40\n"
check("band: the issuer is named; the recipient under 'Invoice To:' is NOT (the ONE band definition cuts before the counterparty block)",
      seg.known_names_in_band(P1, known) == ["Copperfield Electrical"])
check("band: the page's legal suffix is tolerated ('… LTD' matches the stripped key)", seg.known_names_in_band("Copperfield Electrical Ltd\nitems", known) == ["Copperfield Electrical"])
check("band: word boundaries — 'Copperfield Electricals' / 'Thornbury Fastenersx' never match", seg.known_names_in_band("Copperfield Electricals\nThornbury Fastenersx\n", known) == [])
check("band: a 'c/o <known>' line never counts, nor the line UNDER a bare 'c/o'",
      seg.known_names_in_band("c/o Thornbury Fasteners\nInvoice No: 1\n", known) == [] and seg.known_names_in_band("c/o\nThornbury Fasteners\n", known) == [])
check("band: 'Delivered by' / 'via' / 'FAO' / 'Attn:' / 'Collected by' / 'To:' contexts never count",
      all(seg.known_names_in_band(f"{c} Thornbury Fasteners\n", known) == [] for c in ("Delivered by", "via", "FAO", "Attn:", "Collected by", "To:")))
check("band: a line carrying a money amount is a line item, never a letterhead", seg.known_names_in_band("Description\nPrint Tracker Doc licence 1 240.00 240.00\n", known) == [])
check("band: the item-table header ends the band (a known name in an item line below it never counts)",
      seg.known_names_in_band("Some Header\nDescription Qty Unit Amount\nPrint Tracker Doc\n", known) == [])
check("band: the position bound (Oracle C2) — the 7th non-empty line never counts, the 6th does",
      seg.known_names_in_band("a\nb\nc\nd\ne\nf\nCopperfield Electrical\n", known) == [] and seg.known_names_in_band("a\n\nb\nc\nd\ne\nCopperfield Electrical\n", known) == ["Copperfield Electrical"])
check("band: earliest first when two known names share the band (reading order)",
      seg.known_names_in_band("Thornbury Fasteners\nCopperfield Electrical\n", known) == ["Thornbury Fasteners Ltd", "Copperfield Electrical"])
check("band: a 'Supplier: <known>' counterparty line cuts the band (buyer-issued PO shape)", seg.known_names_in_band("Vellum & Crane\nSupplier: Thornbury Fasteners\n", known) == [])
check("band: empty / None / no known list → []", seg.known_names_in_band("", known) == [] and seg.known_names_in_band(None, known) == [] and seg.known_names_in_band(P1, []) == [])
check("same_supplier: equality, suffix-blind, prefix either way",
      seg.same_supplier("Print Tracker", "Print Tracker Ltd") and seg.same_supplier("Copperfield Electrical Services", "Copperfield Electrical")
      and seg.same_supplier("Copperfield Electrical", "Copperfield Electrical Services") and seg.same_supplier("Acme UK Ltd", "ACME"))
check("same_supplier: different names differ; empty never same", not seg.same_supplier("Copperfield Electrical", "Thornbury Fasteners") and not seg.same_supplier("", "Thornbury"))
check("PIN (Oracle Q4): prefix tolerance is SUPPRESS-ONLY — a genuinely different 'Copperfield Electrical Services Ltd' is a documented MISS (today's behaviour), never a false cut",
      seg.same_supplier("Copperfield Electrical", "Copperfield Electrical Services Ltd"))
check("witness: a LABELLED number / date marker", seg.has_first_page_witness("Docket No: DN-4471") and seg.has_first_page_witness("x\nInvoice Date: 1/2/26") and seg.has_first_page_witness("Our ref: 55"))
check("witness: a bare 'No.' / 'Date ' / 'Part No.' / 'Registered No.' is NOT a witness (Oracle C1)",
      not seg.has_first_page_witness("Part No. 5\nDate 1/2/26 items") and not seg.has_first_page_witness("Registered No. 12345 Date 01/01/2026"))
check("witness: a trusted title counts only when the title arm read one", seg.has_first_page_witness("WORKSHEET\nitems", True) and not seg.has_first_page_witness("WORKSHEET\nitems", False))
check("witness third arm (Oracle 2026-09-17): a recipient block AND a real date shape (the marker-poor delivery docket: 'Date 11/11/2026' + 'Deliver To')",
      seg.has_first_page_witness("Saltmarsh Seafoods\nDate 11/11/2026\nDeliver To\nAldermoor Engineering\nitems") and seg.has_first_page_witness("Bill To: X\n3rd Aug 2026\n"))
check("witness third arm PIN: a c/o continuation with a bare date but NO recipient block is NOT a witness",
      not seg.has_first_page_witness("c/o Thornbury Fasteners\nDate 11/11/2026\nitems 12.00"))
check("witness third arm: a recipient block with no date shape / a partial '12/08' / a bare digit run is NOT a witness",
      not seg.has_first_page_witness("Deliver To\nX\nitems") and not seg.has_first_page_witness("Deliver To\nRef 12/08\n") and not seg.has_first_page_witness("Deliver To\nAccount 20261111\n"))
check("witness third arm uses the separator's OWN recipient tuple (one definition)", "any(m in low for m in _RECIPIENT_MARKERS) and _DATE_SHAPE_RE.search(low)" in Path(__file__).parent.parent.joinpath("ocr", "segmentation.py").read_text(encoding="utf-8"))
check("witness: empty / None → False", not seg.has_first_page_witness("") and not seg.has_first_page_witness(None))
print()

# 10. walk_boundaries — the PURE walk: OFF byte-identical to the old inline walk; the rule; the two PINS.
print("walk_boundaries: OFF = today's walk; the rule; the veto beats it; unknown->known never; the first-page SET")
CP, TF = "Copperfield Electrical", "Thornbury Fasteners"
def sig(mid=None, ov=0.0, ds=False, sc=False, names=(), wit=False, wide=None):
    return (mid, ov, ds, sc, list(names), wit, list(names) if wide is None else list(wide))
legacy = [(4, 0.9, False, False), (4, 0.2, False, False), (5, 0.6, False, False), (None, 0.0, True, False), (4, 0.9, False, True)]
f, r = seg.walk_boundaries(legacy, 0.5)
check("OFF: legacy 4-tuple signals walk exactly as before (fingerprint / different template / doc-start / veto) with the same reasons",
      f == [True, False, True, True, False] and r == ["document start", "continuation", "different template", "document-start header", "self-declared continuation"])
f2, r2 = seg.walk_boundaries([sig(4, .9, names=[CP], wit=True), sig(None, 0, names=[TF], wit=True)], known_rule=False)
check("known_rule False: names + witness present but IGNORED (today's walk)", f2 == [True, False] and r2 == ["document start", "continuation"])
f3, r3 = seg.walk_boundaries([sig(4, .9, names=[CP], wit=True), sig(None, 0, names=[TF], wit=True)], known_rule=True)
check("ON: a DIFFERENT known name + a witness → 'known supplier change'", f3 == [True, True] and r3[1] == "known supplier change")
f4, _ = seg.walk_boundaries([sig(names=[CP]), sig(names=[TF], wit=False)], known_rule=True)
check("ON: no witness → no cut", f4 == [True, False])
f5, _ = seg.walk_boundaries([sig(names=[CP]), sig(names=[CP + " Ltd"], wit=True)], known_rule=True)
check("ON: the same supplier (a suffix variant) → no cut", f5 == [True, False])
f6, r6 = seg.walk_boundaries([sig(names=[CP]), sig(names=[TF], wit=True, sc=True)], known_rule=True)
check("PIN: the continuation veto beats the rule ('Page 2 of 2' + a different known name → no cut)", f6 == [True, False] and r6[1] == "self-declared continuation")
f7, r7 = seg.walk_boundaries([sig(names=[]), sig(names=[TF], wit=True)], known_rule=True)
check("PIN: unknown -> known is NEVER a boundary (the current document named nobody known)", f7 == [True, False] and r7[1] == "continuation")
f8, _ = seg.walk_boundaries([sig(names=[TF, CP]), sig(names=[CP], wit=True)], known_rule=True)
check("FIRST-PAGE SET: an unlabelled recipient above the issuer on page 1 — page 2's issuer letterhead is IN the set → no cut", f8 == [True, False])
f9, _ = seg.walk_boundaries([sig(names=[CP]), sig(names=[TF, CP], wit=True)], known_rule=True)
check("the cut page's EARLIEST band name is the one tested (a stranger first → cut)", f9 == [True, True])
f10, _ = seg.walk_boundaries([sig(names=[CP]), sig(names=[CP, TF], wit=True)], known_rule=True)
check("… the issuer first → no cut even with a stranger later in the band", f10 == [True, False])
f11, r11 = seg.walk_boundaries([sig(names=[CP]), sig(5, .9, names=[TF], wit=True)], known_rule=True)
check("a boundary already decided keeps its own reason (the rule only ADDS cuts)", f11 == [True, True] and r11[1] == "different template")
f12, _ = seg.walk_boundaries([sig(names=[CP]), sig(names=[TF], wit=True), sig(names=[TF], wit=True), sig(names=[CP], wit=True)], known_rule=True)
check("after a cut the SET resets to the new document's first page (TF → TF no cut → CP cut)", f12 == [True, True, False, True])
f13, _ = seg.walk_boundaries([sig(names=[CP]), sig(names=[], wit=True), sig(names=[TF], wit=True)], known_rule=True)
check("a page naming nobody stays attached and does NOT reset the set (the next stranger still cuts)", f13 == [True, False, True])
f14, _ = seg.walk_boundaries([sig(names=[TF], wide=[TF, CP]), sig(names=[CP], wit=True)], known_rule=True)
check("the SET is the WIDE read: page 1's strict band names only the recipient, its wide read also the issuer → page 2's issuer letterhead is in the set → no cut", f14 == [True, False])
f15, _ = seg.walk_boundaries([sig(names=[CP]), sig(5, .9, names=[], wide=[]), sig(names=[TF], wit=True)], known_rule=True)
check("a base cut into a document naming nobody EMPTIES the set (unknown → known stays dropped one level on: the next stranger is a miss, never a garbled-letterhead false cut)", f15 == [True, True, False])
f16, _ = seg.walk_boundaries([(None, 0.0, False, False, [CP], True), (None, 0.0, False, False, [TF], True)], known_rule=True)
check("a 6-tuple signal (no wide read) uses its strict names as the set", f16 == [True, True])
check("empty signals → ([], [])", seg.walk_boundaries([], 0.5) == ([], []))
WIDE = "Thornbury Fasteners\n12 Trade Park\nDescription Qty Unit Amount\nCable clips 12 4.20 50.40\n" + "x\n" * 8 + "COPPERFIELD ELECTRICAL\nInvoice No: 1\n"
check("known_names_on_page: the wide read finds a name beyond the table header + the 6-line bound (the Tesseract right-block order)",
      seg.known_names_on_page(WIDE, known) == ["Thornbury Fasteners Ltd", "Copperfield Electrical"] and seg.known_names_in_band(WIDE, known) == ["Thornbury Fasteners Ltd"])
check("known_names_on_page: still cut at a counterparty marker (a labelled 'Bill To' recipient never joins the set); empty / no known → []",
      seg.known_names_on_page("Copperfield Electrical\nBill To\nThornbury Fasteners\n", known) == ["Copperfield Electrical"]
      and seg.known_names_on_page("", known) == [] and seg.known_names_on_page(WIDE, []) == [])
print()

# 11. detect_segments plumbing (source-level, like §8's tail) + segment_docs.py.
print("detect_segments: the rule is armed by `known` only; names/witness computed only when armed; the walk is the pure one")
check("names + witness are computed only when `known` is set",
      "names = known_names_in_band(text, known) if known else []" in src and "witness = has_first_page_witness(text, bool(title and title[1])) if known else False" in src)
check("the walk is walk_boundaries(known_rule=bool(known))", "flags, reasons = walk_boundaries(signals, fp_floor, known_rule=bool(known))" in src)
check("the title is read ONCE per page and shared by the cascade + the witness",
      "title = page_title(text, title_ctx) if title_ctx else None" in src and 'page_match(img, text or "", templates, title_ctx, title)' in src)
check("the position bound is 6 lines and the walk tests the EARLIEST name against the SET", "KNOWN_NAME_TOP_LINES = 6" in src and "same_supplier(names[0], c) for c in cur_names" in src)
check("the SET is fed by the WIDE read (set_names) and reset from it on every boundary",
      "set_names = known_names_on_page(text, known) if known else []" in src and "cur_names = list(set_names or [])" in src and "cur_names = list(s0[6] or [])" in src)
check("the witness constants are LABELLED markers (no bare 'no.' / 'date ' entries — Oracle C1)",
      '"no."' not in src.split("_WITNESS_NUMBER_MARKERS")[1].split(")")[0] and '"date "' not in src.split("_WITNESS_DATE_MARKERS")[1].split(")")[0])
segsrc = Path(__file__).parent.parent.joinpath("segment_docs.py").read_text(encoding="utf-8")
check("segment_docs.py arms the rule only with --known-supplier-change AND a non-empty names list",
      '"--known-supplier-change"' in segsrc and "if isinstance(names, list) and names:" in segsrc and "known=known" in segsrc)
print()

# 12. header_band_lines = the ONE band definition; header_band_text is its join (byte-identical).
print("header_band_lines: the lines header_band_text joins")
T = "Copperfield Electrical\n27 Faraday Park\nInvoice To:\nSomeone\n"
check("header_band_text == ' '.join(header_band_lines)",
      template_matcher.header_band_text(T) == " ".join(template_matcher.header_band_lines(T)) == "Copperfield Electrical 27 Faraday Park")
check("empty / None → '' (the raw lines of '' are [''] — the join is what has always been pinned)",
      " ".join(template_matcher.header_band_lines("")) == "" and template_matcher.header_band_text(None) == "" and template_matcher.header_band_text("") == "")
print()

# 13. boundary_class / boundary_classes — the WEAK (template-only) vs STRONG class the JS pair belt consumes
#     (2026-09-17; gary → Oracle SIGN-OFF-W/COND C1-C12). Segments are byte-identical; the class is metadata.
print("boundary_class: WEAK = a template-only cut with no doc-start; STRONG = doc-start / known change / cross-supplier")
ID = {4: "Copperfield Electrical", 5: "Copperfield Electrical Ltd", 6: "Thornbury Fasteners", 7: ""}
bc = seg.boundary_class
check("A: the same template's fingerprint, no doc-start → weak", bc(4, 4, 0.9, False, "first-page fingerprint", 0.5, ID) == "weak")
check("PIN (the real_34 shape): the same fingerprint WITH a doc-start (an email header) → STRONG — never weak",
      bc(4, 4, 1.0, True, "first-page fingerprint", 0.5, ID) == "strong")
check("B: no template → a template (page 1 unmatched at 150 DPI), no doc-start → weak", bc(4, None, 0.9, False, "different template", 0.5, ID) == "weak")
check("C: a same-SUPPLIER sibling switch (identity equal after the suffix strip) → weak", bc(5, 4, 0.2, False, "different template", 0.5, ID) == "weak")
check("PIN: a CROSS-supplier template switch → STRONG", bc(6, 4, 0.9, False, "different template", 0.5, ID) == "strong")
check("PIN: an unjudgeable identity ('' — no dominant issuer, no frozen name) → C False → STRONG", bc(7, 4, 0.9, False, "different template", 0.5, ID) == "strong")
check("PIN: no identity map at all (legacy caller) → C False → STRONG", bc(5, 4, 0.9, False, "different template", 0.5, None) == "strong")
check("a known-supplier change → STRONG; a document-start header → STRONG",
      bc(None, 4, 0.0, False, "known supplier change", 0.5, ID) == "strong" and bc(None, 4, 0.0, True, "document-start header", 0.5, ID) == "strong")
check("a doc-start on a 'different template' cut → STRONG (the switch control shape)", bc(6, None, 0.9, True, "different template", 0.5, ID) == "strong")
check("the identity is template_matcher._template_identity, never `name` (Oracle C4): dominant issuer → frozen supplier_name → ''",
      seg.template_identity({"name": "Purchase Order Template", "dominant_supplier": "Copperfield Electrical"}) == "Copperfield Electrical"
      and seg.template_identity({"name": "Invoice Template", "fields": [{"field_key": "supplier_name", "is_variable": 0, "fixed_value": "Thornbury Fasteners"}]}) == "Thornbury Fasteners"
      and seg.template_identity({"name": "Invoice Template"}) == "" and seg.template_identity(None) == "")
check("PIN: a cosmetic RENAME does not change the class (two same-issuer templates with different names → weak)",
      bc(5, 4, 0.2, False, "different template", 0.5, seg.identity_map([{"id": 4, "name": "Invoice Template", "dominant_supplier": "Copperfield Electrical"},
                                                                          {"id": 5, "name": "Purchase Order Template", "dominant_supplier": "Copperfield Electrical Ltd"}])) == "weak")
sigs = [sig(4, .9, names=[CP]), sig(4, .9, names=[CP]), sig(4, .9, ds=True, names=[CP]), sig(None, 0, names=[TF], wit=True), sig(6, .8), sig(6, .3), sig(4, .9)]
fl, rs = seg.walk_boundaries(sigs, 0.5, known_rule=True)
cls = seg.boundary_classes(sigs, fl, rs, 0.5, ID)
check("boundary_classes re-tracks the walk: page 0 None; A weak; A + doc-start strong; the known change strong; a template after None → weak (B); a continuation None; TF→CP cross-supplier strong",
      fl == [True, True, True, True, True, False, True] and cls == [None, "weak", "strong", "strong", "weak", None, "strong"])
check("empty → []; a legacy 4-tuple walk classifies too (4→5 is a same-supplier sibling switch → weak; the doc-start header → strong; a vetoed page → None)",
      seg.boundary_classes([], [], []) == []
      and seg.boundary_classes(legacy, *seg.walk_boundaries(legacy, 0.5), 0.5, ID) == [None, None, "weak", "strong", None])
check("detect_segments emits `weak_pages` unconditionally (additive metadata; the segments are untouched)",
      '"weak_pages": weak_pages,' in src and "classes = boundary_classes(signals, flags, reasons, fp_floor, identity_map(templates))" in src)
check("segment_docs.py's slips path emits weak_pages: [] (sheet-bounded cuts are never weak)", '"weak_pages": [],' in segsrc)
print()

# 10. compose_segments — the page-1 separator-sheet override (opt-in-split slice 1b, 2026-09-21).
print("compose_segments: sheets are HARD boundaries; inter-sheet runs subdivided at heuristic first-pages")
check("sheet at page 0 + a heuristic cut inside the run -> the sub-cut is weak",
      seg.compose_segments(5, [0], [0, 2]) == ([[1, 1], [2, 4]], [2]))
check("multiple sheets partition; each run subdivided independently",
      seg.compose_segments(6, [0], [0, 2, 4]) == ([[1, 1], [2, 3], [4, 5]], [2, 4]))
check("a run start (right after a sheet) is STRONG, never weak (its first-page flag is ignored)",
      seg.compose_segments(6, [0, 3], [1, 4]) == ([[1, 2], [4, 5]], []))
check("sheet at the END; the run before it subdivides",
      seg.compose_segments(4, [3], [0, 1]) == ([[0, 0], [1, 2]], [1]))
check("no heuristic cuts -> one segment per inter-sheet run, no weak (graceful no-op on an untaught install)",
      seg.compose_segments(4, [0], [0]) == ([[1, 3]], []))
check("out-of-range / duplicate inputs tolerated",
      seg.compose_segments(3, [0, 9], [2, 2, -1]) == ([[1, 1], [2, 2]], [2]))
check("empty page_count -> ([], [])", seg.compose_segments(0, [0], [1]) == ([], []))
# segment_docs.py contracts: the --auto-split gate + the page-1 override wiring.
check("segment_docs adds --auto-split", '"--auto-split"' in segsrc and 'action="store_true"' in segsrc)
check("segment_docs composes on a page-0 sheet (if 0 in seps -> compose_segments)",
      "if 0 in seps:" in segsrc and "compose_segments(" in segsrc)
check("segment_docs gates the whole-file split on --auto-split (opt-in OFF -> single whole-document)",
      "if not args.auto_split:" in segsrc)
print()

if fail:
    print(f"{fail} check(s) failed — segmentation regressed.")
    sys.exit(1)
print("All segmentation checks passed.")
sys.exit(0)
