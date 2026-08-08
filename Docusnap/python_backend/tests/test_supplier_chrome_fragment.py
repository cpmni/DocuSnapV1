"""
test_supplier_chrome_fragment.py — DOCUMENT-CHROME near-form supplier reject (2026-07-14 night;
Phillip+oscar SLICE 1). A big page TITLE ("INVOICE"/"STATEMENT"/…) OCR-garbles into a short token
("INi","INGE","IN \") that slipped the case-SENSITIVE short-fragment guard (isupper() only) and won
the supplier field, filing whole batches under a phantom "INi"/"INGE" sender. This guard demotes such
a fragment to IMPLAUSIBLE (fail-toward-review) so the letterhead read / Stage-2.5a hint recovery wins.

Load-bearing pins:
  - The three LIVE garbles ("INi","INGE","IN \") are now implausible (case-insensitive; len>3; spaces).
  - Real company names (incl. short brands + names CONTAINING a chrome word as a longer/multi-word
    form) stay PLAUSIBLE — the guard is length-scoped + prefix-near-form only.
  - Kill switch SUPPLIER_CHROME_FRAGMENT_GUARD=0 restores the pre-guard behaviour.

  cd python_backend && PYTHONUTF8=1 py -3.12 tests/test_supplier_chrome_fragment.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from extraction import keyword
from extraction.keyword import _is_plausible_supplier_name, _is_doc_chrome_fragment

fails = 0
def check(label, cond):
    global fails
    print(("OK  " if cond else "BAD ") + label)
    if not cond:
        fails += 1

def main():
    # ── The LIVE garbles must be IMPLAUSIBLE now ─────────────────────────────
    for g in ["INi", "INGE", "IN \\", "IN", "INV", "Ini", "inge", "in"]:
        check(f"garble {g!r} -> implausible", _is_plausible_supplier_name(g) is False)

    # ── Whole title words read as a supplier -> implausible ──────────────────
    for w in ["Invoice", "invoice", "Statement", "Worksheet", "Order", "Quote", "Bill", "Receipt"]:
        check(f"title word {w!r} -> implausible", _is_plausible_supplier_name(w) is False)

    # ── Chrome abbreviations / short fragments -> implausible ─────────────────
    for a in ["PO", "SO", "DN", "Stat", "Del", "Rec", "Cred"]:
        check(f"chrome fragment {a!r} -> implausible", _is_plausible_supplier_name(a) is False)

    # ── REAL supplier names must STAY plausible (no false demotion) ──────────
    for s in ["SuperStore", "Cascade Water Systems", "Northgate Textiles", "DOCUMENT SOLUTIONS",
              "City Office NI", "Profile Construction", "Invoice Ninja", "Order Systems Ltd",
              "Statement Financial Group", "Intel", "3M", "Polychemtex Inc.",
              "ACME LIMITED", "Cloud VPS"]:
        check(f"real name {s!r} -> plausible", _is_plausible_supplier_name(s) is True)

    # ── PRE-EXISTING boundary (NOT my guard): short all-caps brands are flagged
    #    not-uniquely-plausible BY SHAPE (line ~993, isupper()<=3) — the caller's
    #    "unless uniquely supported" rule keeps them usable. Prove my guard is NOT
    #    the cause by asserting they stay implausible with the kill switch OFF.
    for s in ["IBM", "DHL"]:
        check(f"short all-caps {s!r} implausible by pre-existing shape rule", _is_plausible_supplier_name(s) is False)
    os.environ["SUPPLIER_CHROME_FRAGMENT_GUARD"] = "0"
    try:
        for s in ["IBM", "DHL"]:
            check(f"{s!r} STILL implausible with my guard off (pre-existing, not mine)",
                  _is_plausible_supplier_name(s) is False)
    finally:
        os.environ.pop("SUPPLIER_CHROME_FRAGMENT_GUARD", None)

    # ── Predicate boundaries (pin the near-form logic) ───────────────────────
    check("'ini' is a chrome fragment (invoice prefix, edit<=1)", _is_doc_chrome_fragment("ini") is True)
    check("'inge' is a chrome fragment (invoice prefix, edit<=2)", _is_doc_chrome_fragment("inge") is True)
    check("'intel' NOT a chrome fragment (edit 3 vs 'invoi')", _is_doc_chrome_fragment("intel") is False)
    check("'ibm' NOT a chrome fragment", _is_doc_chrome_fragment("ibm") is False)
    check("6+ char core never judged as a prefix-fragment (only exact word)",
          _is_doc_chrome_fragment("superst") is False)

    # ── BASE vs FULL: the chrome layer lives ONLY in the full predicate ──────
    check("base: 'INi' NOT demoted by base (chrome is full-only)", keyword._is_plausible_supplier_name_base("INi") is True)
    check("full: 'INi' demoted by chrome", _is_plausible_supplier_name("INi") is False)
    check("base: real short 'Dell' plausible (protected)", keyword._is_plausible_supplier_name_base("Dell") is True)
    check("base: real short 'Sage' plausible (protected)", keyword._is_plausible_supplier_name_base("Sage") is True)
    check("base: 'IN' still implausible (all-caps<=3, independent of chrome)", keyword._is_plausible_supplier_name_base("IN") is False)

    # ── ORACLE BLOCKING FIX (the value-flip seam): the chrome demotion must NOT
    #    license a confidence-blind 'take' that overwrites a REAL short incumbent
    #    in engine._supplier_identity_decision (incumbent judged by _base). ──────
    from extraction.engine import _supplier_identity_decision as decide
    check("decision: real 'Dell' incumbent NOT overwritten by a plausible wrong challenger",
          decide({"value": "Dell", "method": "logo"}, {"value": "Wrongco Ltd", "method": "keyword"}) != "take")
    check("decision: real 'Sage' incumbent NOT overwritten by a plausible wrong challenger",
          decide({"value": "Sage", "method": "logo"}, {"value": "Other Company", "method": "keyword"}) != "take")
    check("decision: a chrome GARBLE challenger 'INi' does NOT displace real 'Dell' (candidate keeps full)",
          decide({"value": "Dell", "method": "logo"}, {"value": "INi", "method": "keyword"}) == "keep")
    check("decision: INTENDED — a stale all-caps 'IN' incumbent IS replaced by a real name",
          decide({"value": "IN", "method": "template_fixed"}, {"value": "Real Company Ltd", "method": "keyword"}) == "take")

    # ── Kill switch restores prior behaviour (mixed-case 'INi' was plausible) ─
    os.environ["SUPPLIER_CHROME_FRAGMENT_GUARD"] = "0"
    try:
        check("kill switch off: 'INi' plausible again (pre-guard)", _is_plausible_supplier_name("INi") is True)
        check("kill switch off: real name still plausible", _is_plausible_supplier_name("SuperStore") is True)
        # the ORIGINAL all-caps <=3 guard still fires (independent of the new guard)
        check("kill switch off: all-caps 'IN' still implausible (original guard)",
              _is_plausible_supplier_name("IN") is False)
    finally:
        os.environ.pop("SUPPLIER_CHROME_FRAGMENT_GUARD", None)

    print(f"\n{'ALL PASS' if fails == 0 else str(fails) + ' FAILED'}")
    return 1 if fails else 0

if __name__ == "__main__":
    sys.exit(main())
