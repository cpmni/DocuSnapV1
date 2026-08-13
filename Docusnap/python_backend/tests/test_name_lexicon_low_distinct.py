"""test_name_lexicon_low_distinct.py — B5/B6/B7 of the teach-poisoning arc.

THE FOUR-LINE ROOT CAUSE. format_anomaly_checker's `if len(samples) < 3: continue` sits on the
DISTINCT value set, while learning.js deliberately EMITS a group when `_values.size >= 3` OR
`_count >= 3` — so Python discarded exactly the groups JavaScript went out of its way to send. A
name scope whose confirmed history is ONE dominant literal (38x 'Bramblewood Joinery Ltd', the
strongest evidence this system holds) got NO lexicon in either scope, which is why the 'Lid' ->
'Ltd' repair was silent. Census E measured it as the norm, not a corner: 33 of 36 name-like scopes
on the live install have exactly one distinct value.

AND WHY IT MUST BE WEAK-ONLY (Oracle O2). In a single-distinct-value scope every position has
doc_freq == 1.0 BY CONSTRUCTION, so `_STRONG_FREQ = 0.9` is satisfied automatically and guards
nothing. All that would then stand between a garble and a SILENT whole-value rewrite is `_close`,
and 'Southgate' vs 'Northgate' is 2 edits at ratio 0.778 — which `_close` accepts. The design's own
pin: Southgate against a Northgate lexicon must NOT auto-apply, and it must FAIL on the naive fix.

  PYTHONIOENCODING=utf-8 py -3.12 tests/test_name_lexicon_low_distinct.py
"""
import importlib
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

fails = 0


def check(label, cond):
    global fails
    print(("  ok  " if cond else "  FAIL ") + label)
    if not cond:
        fails += 1


def build(entries, armed):
    """Rebuild the index under a given flag state (the module reads the env at import).

    RELOAD, not delete-and-reimport: `from extraction import format_anomaly_checker` returns the
    PACKAGE ATTRIBUTE, which still points at the stale module object after a sys.modules delete —
    so the flag change silently would not take, and the armed arm would look inert.
    """
    os.environ["NAME_LEXICON_LOW_DISTINCT"] = "1" if armed else "0"
    fac = importlib.reload(importlib.import_module("extraction.format_anomaly_checker"))
    return fac.build_format_class_index(entries)


ONE_DISTINCT = [{
    "supplier_name": "bramblewood joinery ltd",
    "document_type": "purchase_order",
    "field_key": "supplier_name",
    "sample_values": ["Bramblewood Joinery Ltd"],          # ONE distinct value...
    "value_counts": {"Bramblewood Joinery Ltd": 38},       # ...backed by 38 confirms
    "confirmed_count": 38,
}]

print("\n1. the discarded population is admitted, and ONLY as a name lexicon")
off = build(ONE_DISTINCT, armed=False)
check("OFF: the scope is dropped exactly as before (byte-identical)", off == {})

on = build(ONE_DISTINCT, armed=True)
key = ("bramblewood joinery ltd", "purchase_order", "supplier_name")
check("ARMED: the scope now yields an entry", key in on)
entry = on.get(key, {})
check("...carrying a name lexicon", bool(entry.get("name_lexicon")))
check("...marked low_distinct, which is what makes it weak-only", entry.get("low_distinct") is True)
check("...and NOTHING else: no learned shape", "shapes" not in entry)
check("...no separator", "sep_uniform" not in entry)
check("...no charset", "charset" not in entry)
check("...no support boost", "support" not in entry)

print("\n2. weight is still required — one confirm is not a history")
thin = build([{**ONE_DISTINCT[0], "value_counts": {"Bramblewood Joinery Ltd": 2}, "confirmed_count": 2}], armed=True)
check("a scope with fewer than 3 CONFIRMS is still dropped", thin == {})

nonname = build([{
    "supplier_name": "acme", "document_type": "invoice", "field_key": "invoice_number",
    "sample_values": ["INV-1042"], "value_counts": {"INV-1042": 9}, "confirmed_count": 9,
}], armed=True)
check("a NON-name field is not admitted by this door", nonname == {})

print("\n3. the repair itself: the garble is fixed, the different company is not")
from extraction import name_match

lex = on[key]["name_lexicon"]
rep, strong = name_match.repair_name_value("Bramblewood Joinery Lid", lex, details=True)
check("the 'Lid' -> 'Ltd' class is repaired at all (it never was before)", rep == "Bramblewood Joinery Ltd")
check("...and the lexicon itself reports STRONG, which is exactly the trap", strong is True)

NORTH = [{
    "supplier_name": "northgate motors ltd", "document_type": "invoice", "field_key": "supplier_name",
    "sample_values": ["Northgate Motors Ltd"],
    "value_counts": {"Northgate Motors Ltd": 3},
    "confirmed_count": 3,
}]
nkey = ("northgate motors ltd", "invoice", "supplier_name")
north = build(NORTH, armed=True)
nlex = north[nkey]["name_lexicon"]
rep2, strong2 = name_match.repair_name_value("Southgate Motors Ltd", nlex, details=True)
check("THE PIN: a 3-doc Northgate lexicon DOES rewrite 'Southgate' (2 edits, ratio 0.778)",
      rep2 == "Northgate Motors Ltd")
check("...and reports itself STRONG — so _STRONG_FREQ guards nothing here (Oracle O2)", strong2 is True)
check("...which is why the entry must be marked low_distinct for the engine to refuse it",
      north[nkey].get("low_distinct") is True)

print("\n4. the engine's refusal, and the evidence marker (source pins)")
eng = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "extraction", "engine.py"),
           encoding="utf-8").read()
check("engine forces WEAK for a low_distinct lexicon",
      "if strong and fmt_entry.get('low_distinct'):" in eng and "strong = False" in eng)
check("the STRONG branch marks its own output so it cannot feed itself (B7)",
      "+name_repair" in eng and "'method': f\"{data.get('method') or 'unknown'}+name_repair\"" in eng)
check("...on the `method` key, which is the one that reaches the DB column",
      "'extraction_method': f\"{data.get('method')" not in eng)

lrn = open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "..", "..", "database", "modules", "learning.js"), encoding="utf-8").read()
check("getFieldFormats excludes a repaired value from its own evidence, UNCONDITIONALLY",
      "NOT LIKE '%+name\\\\_repair'" in lrn)
check("...and not behind a flag (it sits with the CONFADOPT clause, not in the armed branch)",
      lrn.index("+name\\\\_repair") < lrn.index("const groups = {}"))

print(f"\n{'FAILED: ' + str(fails) if fails else 'All B5/B6/B7 checks passed'}")
sys.exit(1 if fails else 0)
