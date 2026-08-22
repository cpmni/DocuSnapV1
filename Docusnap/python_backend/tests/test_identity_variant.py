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

# ── SUGGESTION = CANONICAL (slice 2 of the garbled-issuer arc, 2026-08-22 evening; Oracle C2.1–C2.5) ──
# The owner's live run: the flag-only conflict note named "DOCUMENT SOLUTIONS" while a Stage-4.5 TOKEN
# repair left corrected_to='DOCUMENT' → the Review window offered `Use “DOCUMENT”` — a third wrong scope.
from extraction import engine as E
S = ExtractionEngine._suggest_identity_canonical
print()
print("suggest-canonical (flag-only path):")
E._IDENTITY_SUGGEST_CANONICAL_ON = False
f = {"value": "NOCUMENT", "confidence": 70, "corrected_to": "DOCUMENT"}
check("OFF: inert — corrected_to token repair survives, no suggested_supplier (byte-identical)",
      S(f, {"text_led": "DOCUMENT SOLUTIONS", "resolved": "NOCUMENT"}) is False
      and f["corrected_to"] == "DOCUMENT" and "suggested_supplier" not in f)
E._IDENTITY_SUGGEST_CANONICAL_ON = True
f = {"value": "NOCUMENT", "confidence": 70, "corrected_to": "DOCUMENT"}
check("ON, garble-kind ('NOCUMENT' one edit from DOCUMENT): suggested_supplier = canonical, corrected_to cleared",
      S(f, {"text_led": "DOCUMENT SOLUTIONS", "resolved": "NOCUMENT"}) is True
      and f["suggested_supplier"] == "DOCUMENT SOLUTIONS" and f["corrected_to"] is None)
check("... value / confidence untouched (the human checkpoint survives)", f["value"] == "NOCUMENT" and f["confidence"] == 70)
f = {"value": "Quillstone Print & Packaging", "confidence": 70, "corrected_to": "Quillstone Print"}
check("NOT garble-kind (buyer-issued PO: whole-token disagreement with the letterhead) → inert, no ripple of the wrong company",
      S(f, {"text_led": "Bramblewood Joinery Ltd", "resolved": "Quillstone Print & Packaging"}) is False
      and f["corrected_to"] == "Quillstone Print" and "suggested_supplier" not in f)
f = {"value": "MENT", "confidence": 70}
check("a 4-char scrap ('MENT') is below the C2 floor → inert (not garble-kind)",
      S(f, {"text_led": "DOCUMENT SOLUTIONS", "resolved": "MENT"}) is False and "suggested_supplier" not in f)
f = {"value": "", "confidence": 70}
check("empty value → inert", S(f, {"text_led": "DOCUMENT SOLUTIONS", "resolved": "NOCUMENT"}) is False)
check("_identity_garble_of: equal folds are not a garble; two edits on one token are not; None-safe",
      E._identity_garble_of("DOCUMENT SOLUTIONS", "DOCUMENT SOLUTIONS") is False
      and E._identity_garble_of("NOCUMEMT", "DOCUMENT SOLUTIONS") is False
      and E._identity_garble_of(None, "X") is False)
check("_identity_garble_of: 'Nocument Solutons' (one edit per token) IS garble-kind",
      E._identity_garble_of("Nocument Solutons", "DOCUMENT SOLUTIONS") is True)
print("suggest-canonical (adopt path, C2.2):")
r = res("pplies Ltd", extra=None)
r["supplier_name"]["corrected_to"] = "plies Ltd"
check("ON: adopt clears a stale token repair (value IS the canonical)",
      A(r, IDV) is True and r["supplier_name"]["corrected_to"] is None)
E._IDENTITY_SUGGEST_CANONICAL_ON = False
r = res("pplies Ltd", extra=None)
r["supplier_name"]["corrected_to"] = "plies Ltd"
check("OFF: adopt leaves corrected_to alone (byte-identical)", A(r, IDV) is True and r["supplier_name"]["corrected_to"] == "plies Ltd")
src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "extraction", "engine.py"), encoding="utf-8").read()
check("the flag reads IDENTITY_SUGGEST_CANONICAL, default OFF", "os.environ.get('IDENTITY_SUGGEST_CANONICAL', '0') != '0'" in src)
check("the flag-only path calls the helper for supplier_name only",
      '_idk == "supplier_name" and' in src and "ExtractionEngine._suggest_identity_canonical(_f, _idv)" in src)
check("C2.5: _is_degraded_variant is NOT widened to garble ('NOCUMENT' is not a clipped fragment)",
      ExtractionEngine._is_degraded_variant("NOCUMENT", "DOCUMENT SOLUTIONS") is False)

print()
print(f"{fails} FAILED" if fails else "All identity-variant checks passed")
sys.exit(1 if fails else 0)
