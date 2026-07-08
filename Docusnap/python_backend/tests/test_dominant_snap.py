#!/usr/bin/env python3
"""Guards the Stage-2.5d dominant-value SNAP (ocr_corrector.snap_to_dominant / build_dominant_index).

Fixes OCR artifacts try_correct can't — an inserted space (length change) and a slip on a field
whose consensus template was polluted by a mis-confirmed artifact — by snapping to the confirmed
DOMINANT literal (count-weighted, ≥5 and ≥80%). Precision-first: a 1x pollutant can never be the
target and a variable field self-excludes.

    py -3.12 tests/test_dominant_snap.py
"""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from extraction import ocr_corrector as oc   # noqa: E402

FAIL = 0


def check(label, cond):
    global FAIL
    print(("  OK  " if cond else "  BAD ") + label)
    if not cond:
        FAIL += 1


print("snap_to_dominant — match rules")
check("SPACE artifact snaps (branch A, 0 subs)", oc.snap_to_dominant("1 102V03NL1", "1102V03NL1") == ("1102V03NL1", 0))
check("O->0 slip snaps (branch B, 1 sub)",       oc.snap_to_dominant("11O2V03NL1", "1102V03NL1") == ("1102V03NL1", 1))
check("space + slip combined snaps",             oc.snap_to_dominant("1 1O2V03NL1", "1102V03NL1") == ("1102V03NL1", 1))
check("already the dominant -> no-op",           oc.snap_to_dominant("1102V03NL1", "1102V03NL1") == (None, 0))
check("two differing chars -> no snap",          oc.snap_to_dominant("11OZV03NL1", "1102V03NL1")[0] is None)
check("non-confusion diff (2 vs 9) -> no snap",  oc.snap_to_dominant("1192V03NL1", "1102V03NL1")[0] is None)
check("length change beyond whitespace -> none", oc.snap_to_dominant("1102V03NL", "1102V03NL1")[0] is None)
check("kill-switch off -> whitespace still on",  oc.snap_to_dominant("1 102V03NL1", "1102V03NL1", allow_substitution=False) == ("1102V03NL1", 0))
check("kill-switch off -> substitution off",     oc.snap_to_dominant("11O2V03NL1", "1102V03NL1", allow_substitution=False)[0] is None)

print("\nbuild_dominant_index — dominance + scope guards")
polluted = [{"supplier_name": "Document Solutions", "document_type": "worksheet", "field_key": "item",
             "value_counts": {"1102V03NL1": 31, "11O2V03NL1": 1, "1 102V03NL1": 1}, "confirmed_count": 33}]
idx = oc.build_dominant_index(polluted)
rec = idx.get(("document solutions", "worksheet", "item"))
check("polluted corpus -> dominant is the 31x value", rec and rec["dominant"] == "1102V03NL1")
check("known set carries the artifacts",              rec and "11O2V03NL1" in rec["known"])

def _elig(counts):
    return oc.build_dominant_index([{"supplier_name": "X", "document_type": "y", "field_key": "c",
                                     "value_counts": counts}]).get(("x", "y", "c"))
check("share 60% (3 vs 2) -> NOT eligible",  _elig({"AAA1": 3, "BBB2": 2}) is None)
check("count 4 (<5) -> NOT eligible",        _elig({"AAA1": 4}) is None)
check("variable field (all 1x) -> NOT elig", _elig({"A1": 1, "B2": 1, "C3": 1, "D4": 1, "E5": 1, "F6": 1}) is None)
check("no-digit dominant -> NOT eligible",   _elig({"HELLO": 10}) is None)
check("whitespace in dominant -> NOT elig",  _elig({"AB 12": 10}) is None)
check("strong clean code -> eligible",       _elig({"1102V03NL1": 8, "X": 1}) is not None)

print("\nlookup_dominant — scope")
check("exact scope hit", oc.lookup_dominant(idx, "item", "Document Solutions", "worksheet")["dominant"] == "1102V03NL1")
check("miss returns None", oc.lookup_dominant(idx, "item", "Someone Else", "invoice") is None)

print("\nderive_template — count-weighted consensus (no longer poisoned by a 1x artifact)")
_t = oc.derive_template(["1102V03NL1", "11O2V03NL1"], confirmed_count=32,
                        value_counts={"1102V03NL1": 31, "11O2V03NL1": 1})
check("dominant position stays 'D' (31x vs 1x)", _t and _t[2] == "D")
_c, _b = oc.try_correct("11O2V03NL1", _t)
check("try_correct then fixes O->0 through the clean template", _c == "1102V03NL1" and _b > 0)
# Backward-compat: no value_counts -> equal votes -> position collapses to 'A' exactly as before.
_tb = oc.derive_template(["1102V03NL1", "11O2V03NL1"], confirmed_count=2)
check("no counts -> position 2 is 'A' (byte-identical old behaviour)", _tb and _tb[2] == "A")
# A genuinely mixed position (digit vs letter, 50/50 by weight) must NOT be force-picked.
_tm = oc.derive_template(["1002", "10X2"], confirmed_count=10, value_counts={"1002": 5, "10X2": 5})
check("genuine 50/50 digit-vs-letter position stays 'A'", _tm and _tm[2] == "A")

print("\nbuild_known_index / is_known_value — guards try_correct from coercing a confirmed variant")
kidx = oc.build_known_index([{"supplier_name": "Acme", "document_type": "invoice", "field_key": "code",
                              "value_counts": {"1102V03NL1": 31, "1102VO3NL1": 4}}])
check("a confirmed variant is 'known' (skips correction)", oc.is_known_value(kidx, "code", "Acme", "invoice", "1102VO3NL1") is True)
check("the dominant is 'known'",                           oc.is_known_value(kidx, "code", "Acme", "invoice", "1102V03NL1") is True)
check("an unseen artifact is NOT known (correctable)",     oc.is_known_value(kidx, "code", "Acme", "invoice", "11O2V03NL1") is False)
check("wrong supplier (no cross-supplier union) -> not known", oc.is_known_value(kidx, "code", "Other", "invoice", "1102VO3NL1") is False)
_kg = oc.build_known_index([{"supplier_name": "", "document_type": "invoice", "field_key": "code", "value_counts": {"GLOBAL1": 3}}])
check("doc-type-scoped ('' supplier) learning known for any supplier", oc.is_known_value(_kg, "code", "Any Supplier", "invoice", "GLOBAL1") is True)
check("empty index -> not known (no crash)",               oc.is_known_value({}, "code", "Acme", "invoice", "x") is False)

print("\n" + ("All dominant-snap checks passed" if FAIL == 0 else f"{FAIL} FAILED"))
sys.exit(1 if FAIL else 0)
