#!/usr/bin/env python3
"""
tests/test_buyer_issued_letterhead_scope.py — pins the BUYER-ISSUED LETTERHEAD SCOPE
(TEMPLATE_BUYER_ISSUED_LETTERHEAD_SCOPE, DEFAULT OFF; Chris round 6 card 1, 2026-08-27;
gary design → Oracle).

THE DEFECT, reproduced with the REAL sandbox texts + the REAL template-3 fingerprint: a layout
taught on a purchase order the OWNER issues carries the owner's own name + address as its
fingerprint, and those words print in the BILL TO / DELIVER TO block of every paper the business
RECEIVES — so the whole-page text arm claimed an Oakhaven delivery note, a Meadowvale credit note
and a Castellan worksheet as Bramblewood purchase orders at 95. The type-scope guard had no trusted
title to refuse on ("GOODS DELIVERY NOTE" is one extra real word; "CREDIT NOTE" sat inline).

THE FIX: for a `buyer_issued` template every TEXT-arm haystack is the LETTERHEAD BAND — the exact
truncation that harvested the fingerprint (header_band_text) — so hits(band) ⊆ hits(page) and a
marked template's score can only FALL. Unmarked templates and the logo arm are byte-identical.

Run: py -3.12 python_backend/tests/test_buyer_issued_letterhead_scope.py
Exit 0 = pinned behaviour holds; 1 = regression.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import template_matcher as tm  # noqa: E402


def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return cond


# ── The real sandbox texts (Chris round 6, CHRISBOT/SINGLE; stored ocr_text, first lines) ──────
DOC6_OAKHAVEN_DN = "\n".join([
    "Oakhaven Electrical Wholesale",
    "19 Conduit Row · Ampfield, AM4 7GB · VAT Reg GB 660 1173 45",
    "GOODS DELIVERY NOTE",
    "Despatch Ref OED/29786",
    "Delivery Date    22-01-2026",
    "Your PO    PO-46500",
    "CUSTOMER    DELIVER TO",
    "Bramblewood Joinery Ltd    Bramblewood Joinery Ltd",
    "Unit 4, Sawpit Lane    Unit 4, Sawpit Lane",
    "Draymarket, DM2 6QF    Draymarket, DM2 6QF",
    "Description    Qty",
    "LED Panel 600x600 40W (x4)    11",
    "Received in good condition — sign on delivery.",
    "Oakhaven Electrical Wholesale · Registered in England · VAT Reg No GB 660 1173 45",
])
DOC4_MEADOWVALE_CN = "\n".join([
    "Meadowvale Dairy Wholesale    CREDIT NOTE",
    "Meadowvale Creamery, Low Lane · Butterwick, BW7 2JD",
    "VAT Reg No GB 118 5540 63 Acct enquiries accounts@meadowvaledairy.co.uk",
    "Credit Ref    MVC-8301",
    "Date    26-01-2026",
    "Account No    MDW-315",
    "BILL TO    SHIP TO",
    "Bramblewood Joinery Ltd    Bramblewood Joinery Ltd",
    "Unit 4, Sawpit Lane    Unit 4, Sawpit Lane",
    "Draymarket, DM2 6QF    Draymarket, DM2 6QF",
    "Description    Qty    Unit    Net",
    "Whole Milk 2L (crate of 6)    10    7.68    76.80",
    "Credit against invoice MV-500441 — goods returned.",
])
DOC2_CASTELLAN_WS = "\n".join([
    "Castellan Security Systems",
    "Keep House, 14 Bastion Way · Fortbridge, FB1 9AA · VAT Reg GB 651 0027 84",
    "SERVICE WORKSHEET",
    "JOB SHEET NO CJB-9791 DATE 06-05-2026 Job Ref JB-4791",
    "BILL TO    SHIP TO",
    "Bramblewood Joinery Ltd    Bramblewood Joinery Ltd",
    "Unit 4, Sawpit Lane    Unit 4, Sawpit Lane",
    "Draymarket, DM2 6QF    Draymarket, DM2 6QF",
    "Description    Qty",
    "8-Channel NVR 2TB    1",
    "Work carried out:",
])
DOC7_OWN_PO = "\n".join([
    "Bramblewood Joinery Ltd    PURCHASE ORDER",
    "Unit 4, Sawpit Lane · Draymarket, DM2 6QF",
    "Tel 01632 962130 VAT Reg No GB 512 8846 27",
    "Purchase Order No PO-65220",
    "Order Date    06-03-2026",
    "SUPPLIER    DELIVER TO",
    "Quillstone Print & Packaging    Bramblewood Joinery Ltd",
    "Pressworks, 51 Galley Street    Unit 4, Sawpit Lane",
    "Inkerton, IK9 4YS    Draymarket, DM2 6QF",
    "Description    Qty    Unit    Net",
    "Die-Cut Mailer Box (x50)    12 94.00    1, 128.00",
    "Net Total    £4, 127.00",
])
# A customer's PO sent TO the owner — same TYPE, the owner's words in the SUPPLIER block (HYPOTHESIS
# layout: not in any corpus; pins the rescue-arm mechanism only).
INBOUND_CUSTOMER_PO = "\n".join([
    "Quillstone Print & Packaging    PURCHASE ORDER",
    "Pressworks, 51 Galley Street · Inkerton, IK9 4YS",
    "Tel 01632 445 010 VAT Reg No GB 700 2211 09",
    "Purchase Order No QP-3391",
    "Order Date    12-03-2026",
    "SUPPLIER    DELIVER TO",
    "Bramblewood Joinery Ltd    Quillstone Print & Packaging",
    "Unit 4, Sawpit Lane    Pressworks, 51 Galley Street",
    "Draymarket, DM2 6QF    Inkerton, IK9 4YS",
    "Description    Qty",
])
# Doc 7 with the counterparty marker OCR-merged into line 0 — the EMPTY-BAND trade-off case.
DOC7_MERGED_LINE0 = "Bramblewood Joinery Ltd    PURCHASE ORDER    SUPPLIER Quillstone\n" + "\n".join(DOC7_OWN_PO.split("\n")[1:])

# The real template-3 row (sandbox, after the seed prune) and doc 7's stored fingerprint.
T3_FP = ["Bramblewood", "Joinery", "Ltd", "PURCHASE", "Unit", "Sawpit", "Lane", "Draymarket", "Tel"]
DOC7_STORED_FP = ["Bramblewood", "Joinery", "Ltd", "PURCHASE", "Unit", "Sawpit", "Lane", "Draymarket", "Tel", "VAT"]


def t3(**over):
    base = {
        'id': 3, 'name': 'Bramblewood Joinery Ltd', 'document_type_slug': 'purchase_order',
        'buyer_issued': 1, 'logo_phash': None, 'keyword_fingerprint': list(T3_FP),
        'dominant_supplier': 'Bramblewood Joinery Ltd',
        'fields': [{'field_key': 'supplier_name', 'fixed_value': 'Bramblewood Joinery Ltd', 'is_variable': 0}],
        'supplier_prints_name': {'supplier': 'Bramblewood Joinery Ltd', 'ratio': 1.0, 'count': 1},
    }
    base.update(over)
    return base


class _Arm:
    """Flip the module flags for one arm; always restores."""
    def __init__(self, letterhead, on_page=None):
        self.letterhead, self.on_page = letterhead, on_page
    def __enter__(self):
        self._lh = tm._BUYER_ISSUED_LETTERHEAD_SCOPE
        self._op = tm._IDENTITY_ON_PAGE_ON
        tm._BUYER_ISSUED_LETTERHEAD_SCOPE = self.letterhead
        if self.on_page is not None:
            tm._IDENTITY_ON_PAGE_ON = self.on_page
        return self
    def __exit__(self, *a):
        tm._BUYER_ISSUED_LETTERHEAD_SCOPE = self._lh
        tm._IDENTITY_ON_PAGE_ON = self._op


def identify(text, tpls, **kw):
    """identify_template with the logo arm neutralised (no page image; stub hash → None)."""
    orig = tm.compute_logo_hash
    tm.compute_logo_hash = lambda page: None
    try:
        return tm.identify_template(object(), text, tpls, **kw)
    finally:
        tm.compute_logo_hash = orig


def main():
    ok = True
    print("\n1. the band IS the harvest (one function, two consumers)")
    band6 = tm.header_band_text(DOC6_OAKHAVEN_DN)
    ok &= check("doc 6 band = lines 0-5 (cut before 'CUSTOMER    DELIVER TO')",
                band6 == " ".join(DOC6_OAKHAVEN_DN.split("\n")[:6]))
    ok &= check("doc 7 band = lines 0-4 (cut before 'SUPPLIER    DELIVER TO')",
                tm.header_band_text(DOC7_OWN_PO) == " ".join(DOC7_OWN_PO.split("\n")[:5]))
    ok &= check("doc 2 band = lines 0-3 (cut before 'BILL TO')",
                tm.header_band_text(DOC2_CASTELLAN_WS) == " ".join(DOC2_CASTELLAN_WS.split("\n")[:4]))
    ok &= check("doc 4 band stops at 'BILL TO' (6 lines)",
                tm.header_band_text(DOC4_MEADOWVALE_CN) == " ".join(DOC4_MEADOWVALE_CN.split("\n")[:6]))
    ok &= check("the harvest reproduces doc 7's STORED fingerprint exactly (the refactor is byte-identical)",
                tm.extract_keyword_fingerprint(DOC7_OWN_PO) == DOC7_STORED_FP)
    old = os.environ.get('FINGERPRINT_COUNTERPARTY_MARKERS')
    os.environ['FINGERPRINT_COUNTERPARTY_MARKERS'] = '0'
    try:
        ok &= check("counterparty markers off: the band runs past 'SUPPLIER' (kill-switch parity kept)",
                    tm.header_band_text(DOC7_OWN_PO) == " ".join(DOC7_OWN_PO.split("\n")[:12]))
    finally:
        if old is None:
            os.environ.pop('FINGERPRINT_COUNTERPARTY_MARKERS', None)
        else:
            os.environ['FINGERPRINT_COUNTERPARTY_MARKERS'] = old
    ok &= check("empty / None text → '' (never a throw)", tm.header_band_text('') == '' and tm.header_band_text(None) == '')

    print("\n2. OFF — the positive control: the defect reproduces with the real fingerprint")
    with _Arm(False, on_page=False):
        for label, text in (("doc 6 delivery note", DOC6_OAKHAVEN_DN), ("doc 4 credit note", DOC4_MEADOWVALE_CN),
                            ("doc 2 worksheet", DOC2_CASTELLAN_WS)):
            m = tm._match_by_keywords(text, [t3()])
            ok &= check(f"{label}: template 3 wins the whole-page text arm at >= 75 (7/9 = 77)",
                        m is not None and m['confidence'] >= 75)
        r = identify(DOC6_OAKHAVEN_DN, [t3()])
        ok &= check("identify_template claims doc 6 for template 3 (the misfile road)",
                    r is not None and r['template']['id'] == 3 and r['method'] == 'keywords')

    print("\n3. ON — refused: an inbound paper never carries the buyer's words in its letterhead")
    with _Arm(True, on_page=False):
        ok &= check("doc 6: no hit in the band → not even scored (F1-C1: hits==0 never wins)",
                    tm._match_by_keywords(DOC6_OAKHAVEN_DN, [t3()]) is None)
        ok &= check("doc 2: not scored", tm._match_by_keywords(DOC2_CASTELLAN_WS, [t3()]) is None)
        m4 = tm._match_by_keywords(DOC4_MEADOWVALE_CN, [t3()])
        ok &= check("doc 4: 'Lane' alone (Low Lane) scores 1/9 — far below the bar",
                    m4 is not None and m4['confidence'] < 75)
        for label, text in (("doc 6", DOC6_OAKHAVEN_DN), ("doc 4", DOC4_MEADOWVALE_CN), ("doc 2", DOC2_CASTELLAN_WS)):
            ok &= check(f"identify_template({label}) → None (no claim, no type adopted → Review)",
                        identify(text, [t3()]) is None)

    print("\n4. ON — the owner's OWN purchase order still matches (the band holds its letterhead)")
    with _Arm(True, on_page=True):
        m7 = tm._match_by_keywords(DOC7_OWN_PO, [t3()])
        ok &= check("doc 7: 9/9 in the band → 100", m7 is not None and m7['confidence'] == 100)
        r7 = identify(DOC7_OWN_PO, [t3()])
        ok &= check("identify_template(doc 7) → template 3 via keywords, identity guard armed",
                    r7 is not None and r7['template']['id'] == 3)

    print("\n5. unmarked control — a template without the mark is byte-identical OFF and ON")
    plain = t3(buyer_issued=0)
    with _Arm(False, on_page=False):
        off = tm._match_by_keywords(DOC6_OAKHAVEN_DN, [plain])
    with _Arm(True, on_page=False):
        on = tm._match_by_keywords(DOC6_OAKHAVEN_DN, [plain])
    ok &= check("unmarked template scores the whole page under both arms (the unprotected-layout residual, named)",
                off is not None and on is not None and off['confidence'] == on['confidence'] >= 75)

    print("\n6. the identity guard is NOT band-scoped (Oracle SEND BACK → corrected): configuration B must survive")
    # Configuration B — the founding fixture of TEMPLATE_IDENTITY_ON_PAGE: an owner-issued PO taught with the
    # COUNTERPARTY as issuer. Fingerprint = the Bramblewood letterhead; identity 'Quillstone Print & Packaging'
    # printed only AFTER "SUPPLIER    DELIVER TO" — i.e. BELOW the band. It is marked (PO-ref type) like any PO.
    cfg_b = t3(name='Quillstone Print & Packaging', dominant_supplier='Quillstone Print & Packaging',
               fields=[{'field_key': 'supplier_name', 'fixed_value': 'Quillstone Print & Packaging', 'is_variable': 0}],
               supplier_prints_name={'supplier': 'Quillstone Print & Packaging', 'ratio': 1.0, 'count': 3})
    with _Arm(True, on_page=True):
        ok &= check("config B, ON: the guard still ADMITS the marked template on its own PO (identity below the band, whole page)",
                    tm._identity_refuses(cfg_b, DOC7_OWN_PO) is False)
        ok &= check("config B, ON: the marked template still MATCHES its own PO (band hits 9/9; identity guard armed)",
                    (lambda r: r is not None and r['template']['name'] == 'Quillstone Print & Packaging')(identify(DOC7_OWN_PO, [cfg_b])))
        ok &= check("config B, ON: it never claims the inbound Oakhaven paper (band hits 0 — the hits lever, not the guard)",
                    identify(DOC6_OAKHAVEN_DN, [cfg_b]) is None)
        ok &= check("the exhibit's marked template: the guard alone would still admit doc 6 (buyer named on the page) — refusal comes from the band hits",
                    tm._identity_refuses(t3(supplier_prints_name={'supplier': 'Bramblewood Joinery Ltd', 'ratio': 1.0, 'count': 3}), DOC6_OAKHAVEN_DN) is False)
        ok &= check("the guard refuses what it always refused: the marked template on a page that names nobody it knows",
                    tm._identity_refuses(t3(supplier_prints_name={'supplier': 'Bramblewood Joinery Ltd', 'ratio': 1.0, 'count': 3}), "Acme Widgets\nUnit 9 Some Road\nINVOICE\n") is True)
    with _Arm(False, on_page=True):
        ok &= check("config B, OFF: byte-identical admission on its own PO",
                    tm._identity_refuses(cfg_b, DOC7_OWN_PO) is False)

    print("\n6b. the go-forward HEAL lives on the engine honour path — its predicate is the band-hit ratio")
    ok &= check("a stale binding to the exhibit's template on doc 6: band ratio 0.00 < 0.75 → declined",
                tm._keyword_hit_ratio(t3(), tm.header_band_text(DOC6_OAKHAVEN_DN).lower()) < tm.KEYWORD_THRESHOLD)
    ok &= check("the owner's own PO: band ratio 1.00 → honoured", tm._keyword_hit_ratio(t3(), tm.header_band_text(DOC7_OWN_PO).lower()) >= tm.KEYWORD_THRESHOLD)
    ok &= check("config B on its own PO: band ratio 1.00 → honoured (config-B-safe by construction)",
                tm._keyword_hit_ratio(cfg_b, tm.header_band_text(DOC7_OWN_PO).lower()) >= tm.KEYWORD_THRESHOLD)
    eng = (Path(tm.__file__).parent / 'engine.py').read_text(encoding='utf-8')
    ok &= check("engine: the honour path declines a marked binding on band ratio < KEYWORD_THRESHOLD, switch-gated, fingerprint-guarded",
                "if (known and template_matcher._BUYER_ISSUED_LETTERHEAD_SCOPE and known.get('buyer_issued')\n                        and (known.get('keyword_fingerprint') or [])):" in eng
                and "if _band_ratio < template_matcher.KEYWORD_THRESHOLD:" in eng
                and "self._t('sticky_binding_declined', template_id=_fb_id,\n                                identity=template_matcher._template_identity(known),\n                                reason='letterhead', band_ratio=round(_band_ratio, 2))" in eng)
    ok &= check("engine: the decline sits AFTER the identity guard's own decline and BEFORE the binding is honoured",
                eng.index("template_matcher._identity_refuses(known, ocr_text)") < eng.index("reason='letterhead'") < eng.index("_fb_method = 'pinned_id' if pinned_template_id is not None else 'known_id'"))

    print("\n7. the same-type RESCUE arm — a customer's PO sent TO the owner (mechanism pin; layout is a hypothesis)")
    with _Arm(False, on_page=False):
        r = identify(INBOUND_CUSTOMER_PO, [t3()], detected_slug='purchase_order', title_trusted=True)
        ok &= check("OFF: the trusted same-type title + whole-page overlap rescues template 3 (the owner stamped as issuer)",
                    r is not None and r['template']['id'] == 3)
    with _Arm(True, on_page=False):
        ok &= check("ON: the band holds Quillstone's words → no rescue, no keyword claim → None",
                    identify(INBOUND_CUSTOMER_PO, [t3()], detected_slug='purchase_order', title_trusted=True) is None)

    print("\n8. TRADE-OFF PIN — an empty band (marker OCR-merged into line 0) fails TOWARD REVIEW, never a wrong company")
    with _Arm(True, on_page=True):
        ok &= check("band is empty", tm.header_band_text(DOC7_MERGED_LINE0) == '')
        ok &= check("no text-arm recognition of the owner's own PO (accepted: 'teach must stick' cost, logged, Review)",
                    tm._match_by_keywords(DOC7_MERGED_LINE0, [t3()]) is None)
        ok &= check("the identity guard still ADMITS it (the buyer IS named on the page — whole-page test, unchanged)",
                    tm._identity_refuses(t3(supplier_prints_name={'supplier': 'Bramblewood Joinery Ltd', 'ratio': 1.0, 'count': 3}), DOC7_MERGED_LINE0) is False)
        ok &= check("…but a remembered binding is declined by the honour path's band-ratio predicate (0.00 < 0.75) → re-identify → Review",
                    tm._keyword_hit_ratio(t3(), tm.header_band_text(DOC7_MERGED_LINE0).lower()) < tm.KEYWORD_THRESHOLD)

    print("\n9. source contract — the flag, its default, and the four touch points")
    src = Path(tm.__file__).read_text(encoding='utf-8')
    ok &= check("own flag, DEFAULT OFF",
                "_BUYER_ISSUED_LETTERHEAD_SCOPE = os.environ.get('TEMPLATE_BUYER_ISSUED_LETTERHEAD_SCOPE', '0') != '0'" in src)
    ok &= check("the type-scope guard's text is untouched (the JS pin regex-matches it)",
                "_BUYER_ISSUED_TYPE_SCOPE and t.get('buyer_issued')\n                and title_trusted and detected_slug\n                and (t.get('document_type_slug') or '') != detected_slug):\n            continue" in src)
    ok &= check("keyword arm: the haystack is chosen per template AFTER that guard",
                "hay = band_lower if (band_lower is not None and t.get('buyer_issued')) else ocr_lower" in src)
    ok &= check("rescue arm: band-scoped for a marked template",
                "_keyword_hit_ratio(t, band_lower if (band_lower is not None and t.get('buyer_issued')) else ocr_lower)" in src)
    ok &= check("identity guard: NOT band-scoped (Oracle SEND BACK, config B) — the guard never reads the band",
                "ocr_text = header_band_text(ocr_text)" not in src
                and "def _identity_refuses(cand, ocr_text) -> bool:" in src)
    ok &= check("the V1 rival pin is untouched (V2 is already band-scoped)",
                "def _rival_branding_present_v1(picked: dict, templates: list, ocr_lower: str,\n                               bar: float = 0.75) -> bool:" in src)

    print("\nALL PASS" if ok else "\nFAILURES")
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
