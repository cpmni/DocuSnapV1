#!/usr/bin/env python3
"""tests/test_identity_variant.py — pins the supplier-identity VARIANT-CORROBORATION
predicate (2026-07-10 night, the 'pplies Ltd' case).

The wandered-relocate class produced a clipped letterhead fragment ('pplies Ltd' from
"Northgate Su|pplies Ltd") that is multi-word and name-plausible, so the junk-shaped bar
passes it; the identity-fusion conflict flag caught the mismatch (text_led = the gazetteer
canonical) but only flagged. The variant layer adopts the canonical WHEN AND ONLY WHEN the
resolved value is a clipped contiguous fragment of it — different real names can never
collapse, ambiguity stays flag-only.

    py -3.12 tests/test_identity_variant.py    (from python_backend/)
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from extraction.engine import ExtractionEngine

fails = 0


def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond:
        fails += 1


V = ExtractionEngine._is_degraded_variant

print("ADOPT — clipped contiguous fragments of the canonical:")
check("'pplies Ltd' subset of 'Northgate Supplies Ltd' (the live case)",
      V("pplies Ltd", "Northgate Supplies Ltd") is True)
# 'oplies Ltd' (the sibling fragment from the queue) is NOT a strict contiguous fragment —
# its 'o' is OCR noise for the 'u' of 'Supplies', and no 'oplies' run exists in the
# canonical. It deliberately stays FLAG-ONLY (the safe-side miss class, same as '0plies').
check("'oplies Ltd' is NOT a strict fragment (OCR-noise class -> flag-only, by design)",
      V("oplies Ltd", "Northgate Supplies Ltd") is False)
check("mid-word clip 'orthgate Supplies L'",
      V("orthgate Supplies L", "Northgate Supplies Ltd") is True)
check("case/punctuation insensitive ('SUPPLIES LTD.')",
      V("SUPPLIES LTD.", "Northgate Supplies Ltd") is True)

print("NEVER COLLAPSE — different real names / weak evidence:")
check("'Northgate Support Ltd' vs 'Northgate Supplies Ltd' -> False",
      V("Northgate Support Ltd", "Northgate Supplies Ltd") is False)
check("equal strings -> False (no self-swap)",
      V("Northgate Supplies Ltd", "Northgate Supplies Ltd") is False)
check("fragment LONGER than canonical -> False",
      V("Northgate Supplies Ltd", "Supplies Ltd") is False)
check("tiny scrap 'td' -> False (<4 alpha)", V("td", "Northgate Supplies Ltd") is False)
check("'Ltd' alone -> False (<4 alpha)", V("Ltd", "Northgate Supplies Ltd") is False)
check("OCR-noised '0plies Ltd' -> False (strict containment, flag-only)",
      V("0plies Ltd", "Northgate Supplies Ltd") is False)
check("empty/None inputs -> False",
      V("", "Northgate Supplies Ltd") is False and V("pplies Ltd", None) is False)

# ── swap wiring (_adopt_identity_variant) — gary's unit set ─────────────────────────────
A = ExtractionEngine._adopt_identity_variant

def res(sup_val, sup_conf=82, extra=None):
    r = {"supplier_name": {"value": sup_val, "confidence": sup_conf, "method": "anchor_crop_relocated"},
         "_supplier_name": sup_val}
    r.update(extra or {})
    return r

IDV = {"text_led": "Northgate Supplies Ltd", "resolved": "pplies Ltd", "conflict": True}

print("swap wiring:")
r = res("pplies Ltd")
ok = A(r, IDV)
check("happy path adopts (returns True)", ok is True)
check("field value = canonical", r["supplier_name"]["value"] == "Northgate Supplies Ltd")
check("BOTH stamps updated and equal", r["_supplier_name"] == r["supplier_name"]["value"])
check("confidence capped at 70", r["supplier_name"]["confidence"] == 70)
check("needs_review forced", r.get("_needs_review") is True)
check("method marks the lineage", r["supplier_name"]["method"] == "identity_variant_adopt")
note = r["supplier_name"]["validation_note"]
check("note carries BOTH names (reviewer can judge/restore)",
      "pplies Ltd" in note and "Northgate Supplies Ltd" in note)

r2 = res("pplies Ltd", sup_conf=60)
A(r2, IDV)
check("a lower incumbent confidence is kept (min)", r2["supplier_name"]["confidence"] == 60)

# non-variant conflict → byte-identical flag-only fallthrough (returns False, results untouched)
r3 = res("Completely Different Co")
before = dict(r3["supplier_name"])
check("non-variant conflict → no swap",
      A(r3, {"text_led": "Northgate Supplies Ltd", "resolved": "Completely Different Co"}) is False)
check("... and the field is untouched", r3["supplier_name"] == before and r3["_supplier_name"] == "Completely Different Co")

# FRAGMENT-CARRIER GUARD (gary G1): the supplier FIELD must itself carry the fragment —
# a customer-carrying type where the fragment lives elsewhere must NOT have its supplier
# field overwritten (nor may the swap ever touch customer_name).
r4 = res("Someone Else Ltd")
check("carrier mismatch (field != resolved) -> no swap", A(r4, IDV) is False)
check("... field untouched", r4["supplier_name"]["value"] == "Someone Else Ltd")
r5 = {"customer_name": {"value": "pplies Ltd", "confidence": 82, "method": "keyword"},
      "_supplier_name": "pplies Ltd"}
check("no supplier field → no swap (customer_name is NEVER written)", A(r5, IDV) is False)
check("... customer field untouched", r5["customer_name"]["value"] == "pplies Ltd")

check("empty/None verdict values → no swap",
      A(res("pplies Ltd"), {"text_led": "", "resolved": "pplies Ltd"}) is False)

print()
print(f"{fails} FAILED" if fails else "All identity-variant checks passed")
sys.exit(1 if fails else 0)
