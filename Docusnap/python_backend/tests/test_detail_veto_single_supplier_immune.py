#!/usr/bin/env python3
"""
tests/test_detail_veto_single_supplier_immune.py
------------------------------------------------
LOGO_DETAIL_VETO_SINGLE_SUPPLIER_IMMUNE (2026-08-23; iris forensic -> Oracle SIGN-OFF-WITH-CONDITIONS).

THE BUG: logo_detail._region crops the top-LEFT quadrant, so a CENTRE-top diamond logo is clipped and
_mark_bbox isolates a wordmark LETTER. A 256-bit hash of a letterform is colourway-unstable (blue sample
vs black scan) and collides with any round glyph, so a document's own mark "disagrees with its own set"
(>72) while a rival lands MARGINALLY (Nordwind 62) -> veto_by_detail false-abstains a dist-2 single-
supplier lock whose own keyword branding is all over the page (Oakhaven docs 543/544).

THE FIX (call-site immunity, veto functions untouched): suppress the detail veto ONLY when the pick is a
corroborated single-supplier lock tripped by a MARGINAL rival. A DECISIVE rival (detail dist <= the
confident distance 48 -- the doc-193 / buyer-issued class) STILL vetoes.

Pins:
  1. HEAL: ON + single-supplier cluster + own branding + tight lock + MARGINAL rival (48<m<=72) -> immune.
  2. OFF byte-identical: the same shape -> NOT immune (the veto stands, exactly as before).
  3. COUNTER-PIN: ON but a DECISIVE rival (<=48) -> NOT immune (doc-193 / buyer-issued still vetoes).
     (Drop the decisive-rival clause and THIS pin goes RED -- it reproduces the misfile it guards.)
  4. Branding absent -> NOT immune (never immunise a lock whose letterhead is not on the page).
  5. >=2-supplier cohort -> NOT immune (a genuine same-letterhead two-company ambiguity keeps the veto).
  6. Not a tight lock (best_dist>6) -> NOT immune.
  7. Source contract: the call site gates the veto on `and not _detail_veto_single_supplier_immune(`.

Usage: py -3.12 python_backend/tests/test_detail_veto_single_supplier_immune.py
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import template_matcher as tm   # noqa: E402

Q = "00" * 32                       # the scanned mark (256 zero bits)


def hd(nbits):                      # a 256-bit hex hash with exactly nbits set => Hamming distance nbits from Q
    f = nbits // 4                  # keep nbits a multiple of 4
    return "f" * f + "0" * (64 - f)


OAK_FP = ["Oakhaven", "Electrical", "Wholesale", "Conduit"]
OAK_OCR = "goods delivery note oakhaven electrical wholesale 19 conduit row ampfield am4 7gb"
NO_BRAND_OCR = "goods delivery note 19 some road town aa1 1aa qty description"


def T(name, sup, details, fp):
    return {"id": abs(hash(name)) % 100000, "name": name, "dominant_supplier": sup,
            "document_type_slug": "delivery_note", "keyword_fingerprint": fp,
            "logo_detail_hashes": details}


BEST = T("Oakhaven delivery", "Oakhaven", [hd(256)], OAK_FP)      # own set irrelevant to immunity (call runs post-veto)


def immune(env_on, cluster, best, ocr, rival_dist, best_dist=2, extra_all=None):
    rival = T("Nordwind delivery", "Nordwind", [hd(rival_dist)], ["Nordwind", "Refrigeration"])
    all_t = [best, rival] + (extra_all or [])
    old = os.environ.get("LOGO_DETAIL_VETO_SINGLE_SUPPLIER_IMMUNE")
    os.environ["LOGO_DETAIL_VETO_SINGLE_SUPPLIER_IMMUNE"] = "1" if env_on else "0"
    try:
        return tm._detail_veto_single_supplier_immune(
            [(best, 2)], cluster, best, best_dist, ocr, Q, all_templates=all_t)
    finally:
        if old is None:
            os.environ.pop("LOGO_DETAIL_VETO_SINGLE_SUPPLIER_IMMUNE", None)
        else:
            os.environ["LOGO_DETAIL_VETO_SINGLE_SUPPLIER_IMMUNE"] = old


def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return cond


def main():
    fails = 0
    # 1. HEAL — the Oakhaven shape
    fails += not check("ON + single-supplier + branding + tight lock + MARGINAL rival (60) => immune",
                       immune(True, [BEST], BEST, OAK_OCR, 60) is True)
    # 2. OFF byte-identical
    fails += not check("OFF => NOT immune (the veto stands, byte-identical)",
                       immune(False, [BEST], BEST, OAK_OCR, 60) is False)
    # 3. COUNTER-PIN — a DECISIVE rival still vetoes
    fails += not check("ON but DECISIVE rival (40 <= 48) => NOT immune (doc-193 / buyer-issued still vetoes)",
                       immune(True, [BEST], BEST, OAK_OCR, 40) is False)
    # boundary: exactly at the confident distance is decisive (not > 48)
    fails += not check("ON, rival exactly at 48 => NOT immune (boundary is decisive)",
                       immune(True, [BEST], BEST, OAK_OCR, 48) is False)
    # 4. branding absent
    fails += not check("ON but the pick's own branding is NOT on the page => NOT immune",
                       immune(True, [BEST], BEST, NO_BRAND_OCR, 60) is False)
    # 5. >=2-supplier cohort (a same-fingerprint template of a DIFFERENT supplier in the cluster)
    SIB = T("Impostor delivery", "Impostor Co", [hd(256)], OAK_FP)   # same fingerprint, different supplier
    fails += not check("ON but the cohort spans two suppliers => NOT immune (genuine ambiguity keeps the veto)",
                       immune(True, [BEST, SIB], BEST, OAK_OCR, 60, extra_all=[SIB]) is False)
    # 6. not a tight lock
    fails += not check("ON but best_dist > 6 => NOT immune",
                       immune(True, [BEST], BEST, OAK_OCR, 60, best_dist=8) is False)
    # 7. source contract — the call site gates the veto on the immunity
    src = (Path(__file__).parent.parent / "extraction" / "template_matcher.py").read_text(encoding="utf-8")
    fails += not check("call site gates the detail veto on `and not _detail_veto_single_supplier_immune(`",
                       "and not _detail_veto_single_supplier_immune(" in src)
    fails += not check("the veto primitives are untouched (immunity is a SEPARATE call-site function)",
                       "def _detail_veto_single_supplier_immune(" in src and "def _logo_detail_veto(" in src)

    print(f"\n{'PASS' if not fails else str(fails) + ' FAILED'}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
