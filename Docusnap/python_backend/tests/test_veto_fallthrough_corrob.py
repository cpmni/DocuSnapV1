#!/usr/bin/env python3
"""
tests/test_veto_fallthrough_corrob.py
-------------------------------------
G1/G2 corroboration guards for the identity-veto fall-through (gary design + Oracle
SIGN-OFF-WITH-CONDITIONS, 2026-07-26). G1: on a fall-through-matched doc a CRITICAL-field winner must
be corroborated — (i) an independent-FAMILY rail read agrees, or (ii) boundary-guarded presence in the
page text — else a validation_note holds the doc (trust.js flagged gate; no value/conf change).
G2 (in-engine): a non-authoritative anchor_crop at INVERTED confidence never silently displaces a
disagreeing keyword read on a fall-through doc (keep keyword + note); an AGREEING one keeps the
incumbent with NO note (C6). This file pins the PURE predicates + the fall-through tag; the G2
behaviour + red-first proofs are system-level (the #456/#472 traces, naked-C c1f9a3f vs guarded).

Usage: py -3.12 python_backend/tests/test_veto_fallthrough_corrob.py
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import engine as eng            # noqa: E402
from extraction import template_matcher as tm   # noqa: E402
from PIL import Image                            # noqa: E402

corrob = eng._fallthrough_critical_corroborated
pagep  = eng._page_presence_corroborated
fam    = eng._method_family


def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return cond


def main():
    fails = 0

    # ── Arm (ii): page presence — the boundary lookarounds are LOAD-BEARING (Oracle C2) ─────────
    fails += not check("C2 boundary pin: '4/10/2026' NOT corroborated by a page printing '14/10/2026'",
                       pagep("4/10/2026", "Invoice Date 14/10/2026 due") is False)
    fails += not check("separator-tolerant: 'DN-38472' found in page 'DN 38472'",
                       pagep("DN-38472", "Delivery Note No. DN 38472") is True)
    fails += not check("exact: 'PO-98093' found; 'PO-38093' NOT (the #472 page)",
                       pagep("PO-98093", "Order No. PO-98093") is True
                       and pagep("PO-38093", "Order No. PO-98093") is False)
    # C3 bounds: core 4..48; outside → uncorroborated (fail-toward-review), never a crash.
    fails += not check("C3: 3-char core -> False (too ambiguous)", pagep("AB1", "AB1 AB1") is False)
    fails += not check("C3: 49-char core -> False (hold)", pagep("A" * 49, "A" * 60) is False)
    fails += not check("C3: 48-char core at the edge -> True", pagep("A" * 48, "x " + "A" * 48 + " y") is True)
    fails += not check("no crash on regex-hostile value", pagep("a.b(c)d", "x a.b(c)d y") in (True, False))

    # ── Arm (i): independent-family rail agreement ───────────────────────────────────────────────
    W_INLINE = {"value": "DN-93407", "method": "anchor_inline", "confidence": 85}
    KW_RAIL  = [{"value": ". DN-93407", "method": "keyword_override", "confidence": 85}]
    fails += not check("Saltmarsh-shape: keyword rail read corroborates the anchor winner (alnum-core equal)",
                       corrob(W_INLINE, KW_RAIL, "", False) is True)
    # S5 pin (Oracle): same-family agreement counts for NOTHING — anchor can never corroborate anchor.
    AC_RAIL = [{"value": "DN-93407", "method": "anchor_crop", "confidence": 85}]
    fails += not check("S5 pin: an AGREEING anchor_crop does NOT corroborate an anchor_inline winner",
                       corrob(W_INLINE, AC_RAIL, "", False) is False)
    fails += not check("family map: keyword_override/keyword one family; anchor_* one family",
                       fam("keyword_override") == fam("keyword") and fam("anchor_crop") == fam("anchor_inline")
                       and fam("keyword") != fam("anchor_crop"))
    # Date parse gate: an unparseable 'agreement' never corroborates a date.
    WD = {"value": "garbled", "method": "anchor_inline", "confidence": 85}
    fails += not check("date parse gate: unparseable equal values do NOT corroborate a date",
                       corrob(WD, [{"value": "garbled", "method": "keyword"}], "", True) is False)
    # Date raw-form arm (C2): display '04-10-2026' + own-family RAW rail '4/10/2026' + page '4/10/2026'
    # -> corroborated through the SAME boundary-guarded matcher (bare substring is forbidden).
    WDD = {"value": "04-10-2026", "method": "anchor_crop", "confidence": 85}
    RAW = [{"value": "4/10/2026", "method": "anchor_crop", "confidence": 85}]
    fails += not check("C2 raw arm: date display form fails page test but own-family RAW capture passes",
                       corrob(WDD, RAW, "Invoice Date 4/10/2026", True) is True)
    fails += not check("C2 raw arm boundary: raw '4/10/2026' vs page '14/10/2026' still NOT corroborated",
                       corrob(WDD, RAW, "Invoice Date 14/10/2026", True) is False)

    # ── The #472 shape + the C4 authoritative pin ────────────────────────────────────────────────
    W472 = {"value": "PO-38093", "method": "anchor_inline", "confidence": 85}
    PAGE472 = "PURCHASE ORDER Order No. PO-98093\nOrder Date 27/05/2026"
    fails += not check("#472-shape: lone page-absent winner is UNCORROBORATED",
                       corrob(W472, [], PAGE472, False) is False)
    W472A = {**W472, "authoritative": True}
    fails += not check("C4 pin: authoritative winner gets NO exemption (still uncorroborated)",
                       corrob(W472A, [], PAGE472, False) is False)
    # Trade-off pin (accepted cost): a genuinely-correct lone read the page OCR missed is HELD.
    fails += not check("trade-off pin: correct-but-page-absent lone read stays uncorroborated (held)",
                       corrob({"value": "PO-11111", "method": "anchor_inline"}, [], "degraded page text", False)
                       is False)

    # ── Oracle revised-C8 pin (accepted cost (c), 2026-07-26): the AUTHORITATIVE #456 shape ──────
    # A ⊕-taught (authoritative) anchor_crop at inverted confidence DISPLACES a disagreeing keyword
    # (G2 exempts authoritative BY RULING — extending G2 would make taught corrections structurally
    # unable to beat a wrong keyword, re-imposing the bug the operator taught around). The wrong
    # value is then stored WRONG-BUT-HELD: G1 must find it uncorroborated (the raw arm's boundary
    # guard refuses '4/10/2026' against a page '14/10/2026') so the note + needs_review land.
    # This pin locks BOTH halves at the predicate level: red if someone exempts authoritative from
    # G1. (The displacement-occurs half is pinned by the live #456 trace + the corpus enumeration —
    # the merge branch is not unit-drivable in isolation.)
    W456A = {"value": "04-10-2026", "method": "anchor_crop", "confidence": 98, "authoritative": True}
    RAW456 = [{"value": "4/10/2026", "method": "anchor_crop", "confidence": 85}]
    fails += not check("revised-C8 pin: authoritative #456-shape stays UNCORROBORATED (G1 note path)",
                       corrob(W456A, RAW456, "INVOICE Invoice Date 14/10/2026", True) is False)

    # ── Fix A (#183) inline-harvest absence hold — pure predicate (gary + Oracle C1-C5 2026-07-26) ──
    # _inline_absence_should_hold = (method=='anchor_inline') AND NOT _fallthrough_critical_corroborated.
    # The crop-box requirement was DROPPED (Oracle C2): keyed on the CORROBORATION invariant, a pure
    # function of the RESULT — no anchors-list correlation, and it closes the label-less/positional-anchor
    # synthesis hole a crop-box test would have exempted (residual-a). OFF byte-identical + the G1
    # composition (one-note skip, no double-note) are SYSTEM-level (the realdoc A/B), per this file's
    # convention that block behaviour is system-proven while the PURE predicate is unit-pinned here.
    iah = eng._inline_absence_should_hold
    P183 = "PURCHASE ORDER  Order No.\nOrder Date 11/03/2026\nOrder Total 1,240.00"   # true ref line lost to skew
    fails += not check("#183 regression: page-absent anchor_inline ref (no rail) -> HELD",
                       iah({"value": "PO-20008", "method": "anchor_inline"}, [], P183, False) is True)
    # Accepted-trade-off pin: a page-PRESENT inline value is trusted -> NOT held (stops a future 'restore
    # #183' by loosening, and stops over-holding a correct inline read the page actually carries).
    fails += not check("trade-off pin: page-present anchor_inline value -> NOT held",
                       iah({"value": "PO-60906", "method": "anchor_inline"}, [], "Order No. PO-60906", False) is False)
    # Method filter: a SUCCEEDED anchor_crop (the 'column-only crop reads right' class) is EXEMPT even when
    # page-absent — direct pixel evidence from the taught box, must not be held.
    fails += not check("method filter: succeeded anchor_crop, page-absent -> NOT held",
                       iah({"value": "PO-20008", "method": "anchor_crop"}, [], "degraded page text", False) is False)
    # Cross-family corroboration: a keyword-family rail agreeing on the value -> NOT held (arm i).
    fails += not check("cross-family rail agrees -> NOT held",
                       iah({"value": "PO-20008", "method": "anchor_inline"},
                           [{"value": "PO-20008", "method": "keyword"}], "degraded page text", False) is False)
    # Out of scope: a keyword winner is never the synthesis class -> NOT held.
    fails += not check("keyword winner -> NOT held (only anchor_inline is in scope)",
                       iah({"value": "PO-20008", "method": "keyword"}, [], "degraded page text", False) is False)
    # Residual-(a) CLOSED (Oracle C2, crop-box dropped): a LABEL-LESS/positional anchor_inline synthesis
    # (the blind-po_date class) that is page-absent + uncorroborated -> HELD. A crop-box requirement would
    # have EXEMPTED it (the value has no crop box), leaving the exact #183 chain open on that class.
    fails += not check("residual-a closed: positional/label-less anchor_inline, page-absent -> HELD",
                       iah({"value": "SO-77777", "method": "anchor_inline"}, [], "SALES ORDER\nDate 01/01/2026", False) is True)
    # Date scope: a page-absent anchor_inline DATE with no parseable cross-family agreement -> HELD.
    fails += not check("date: page-absent anchor_inline date -> HELD",
                       iah({"value": "31-12-2026", "method": "anchor_inline"}, [], "Order Date 01/01/2026", True) is True)

    # ── The fall-through tag (matcher side) ──────────────────────────────────────────────────────
    Q = "aa" * 8
    WRONG = {"id": 1, "name": "T", "dominant_supplier": "Thornbury Fasteners",
             "document_type_slug": "delivery_note", "keyword_fingerprint": ["delivery", "docket", "note"],
             "logo_phashes": [Q], "logo_detail_hashes": []}
    RIGHT = {"id": 3, "name": "S", "dominant_supplier": "Saltmarsh Seafoods",
             "document_type_slug": "delivery_note",
             "keyword_fingerprint": ["saltmarsh", "seafoods", "harbour", "fisher", "quay", "grimsby"],
             "logo_phashes": ["55" * 8], "logo_detail_hashes": []}
    OCR = ("Saltmarsh Seafoods\nThe Harbour, Fisher Quay\nGrimsby\nDELIVERY DOCKET Delivery Note No. DN-1\n")
    saved = tm.compute_logo_hash
    old = os.environ.get("TEMPLATE_VETO_FALLTHROUGH")
    try:
        tm.compute_logo_hash = lambda img: Q
        os.environ["TEMPLATE_VETO_FALLTHROUGH"] = "1"
        r = tm.identify_template(Image.new("RGB", (64, 64), "white"), OCR, [WRONG, RIGHT],
                                 detected_slug="delivery_note", title_trusted=False)
        fails += not check("tag: fall-through result carries veto_fallthrough=True",
                           bool(r and r.get("veto_fallthrough")) is True)
        # A NORMAL accept (no veto) must NOT carry the tag.
        SOLO = {**RIGHT, "logo_phashes": [Q]}
        r2 = tm.identify_template(Image.new("RGB", (64, 64), "white"), OCR, [SOLO],
                                  detected_slug="delivery_note", title_trusted=False)
        fails += not check("tag: a normal (non-vetoed) accept carries NO tag",
                           bool(r2) and not r2.get("veto_fallthrough"))
        # OFF pin: kill switch EXPLICITLY off (default flipped ON 2026-07-26) ⇒ veto site returns
        # None ⇒ the tag can never exist ⇒ the guards are structurally dead.
        os.environ["TEMPLATE_VETO_FALLTHROUGH"] = "0"
        r3 = tm.identify_template(Image.new("RGB", (64, 64), "white"), OCR, [WRONG, RIGHT],
                                  detected_slug="delivery_note", title_trusted=False)
        fails += not check("OFF pin: switch=0 -> None (tag structurally impossible; guards dead)",
                           r3 is None)
    finally:
        tm.compute_logo_hash = saved
        if old is None:
            os.environ.pop("TEMPLATE_VETO_FALLTHROUGH", None)
        else:
            os.environ["TEMPLATE_VETO_FALLTHROUGH"] = old

    print()
    print(f"{fails} FAILED" if fails else "All veto-fallthrough corroboration checks passed")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
