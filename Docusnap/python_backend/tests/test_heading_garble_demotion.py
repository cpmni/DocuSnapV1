#!/usr/bin/env python3
"""tests/test_heading_garble_demotion.py — pins the HEADING-GARBLE NAME DEMOTION
(Oracle 2026-07-12): the DN-82792 customer_name class, where a taught customer anchor's
RELOCATED read landed on a document CAPTION ("Deliver To" / "Deliver lo") and won the
engine Tier-A gate over the clean Stage-1 keyword name ("Primrose Childcare"). A relocated
read is unconditionally `located=True` AND the relocate path NULLS its OCR-quality signal,
so it bypassed the Tier-A garble gate. The fix DEMOTES such a read (located_ok -> False ->
the existing ≤50 cap) so the keyword wins the EXISTING merge; with no keyword it shows
≤50 + a review note. Demotion-only -> never a silent-wrong value.

Pinned here at the PREDICATE + protective-token level (the located_ok -> False -> conf≤50
-> Tier-A-loss path is EXISTING engine behaviour — anchor.py:`if not located_ok: conf =
min(conf, 50)` + engine.py Tier-A gate requires `located` True; this change only adds a
new condition that sets located_ok False, proven end-to-end by the corpus M=0 gate + the
DN-82792 real-doc E2E, exactly as the located-gate itself was validated).

The CRUX pins are (3)/(4): a legit company whose distinctive token is chrome-shaped
("Delivery Solutions Ltd") must NOT be demoted — that is what a wrong design (gating on the
whole name_structure_flag WITHOUT the protective-token exclusion) gets wrong, and it is the
false-positive class Oracle sent the first design back over.

    py -3.12 tests/test_heading_garble_demotion.py    (from python_backend/)
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from extraction.anchor import _reads_like_heading_garble as demote
from extraction import wordness

fails = 0


def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond:
        fails += 1


# The whole guard is inert without the shipped char-trigram model; skip loudly rather than
# green-wash (a dead guard would pass every "-> False" row for the wrong reason).
if not wordness.available():
    print("SKIP — char-trigram model absent (wordness unavailable); guard is inert by design")
    sys.exit(0)

FK = "customer_name"

print("1/2 — the incident garbles ARE demoted on a name field:")
check("'Deliver lo' (clean-rigid heading garble) -> demote",
      demote("Deliver lo", FK) is True)
check("'Deliver To RRS' (junk-rigid heading garble) -> demote",
      demote("Deliver To RRS", FK) is True)

print("\n3/4 — CRUX: a legit company with a chrome-shaped distinctive token is NOT demoted")
print("       (fails on the whole-name_structure_flag design Oracle sent back):")
check("'Delivery Solutions Ltd' -> NOT demoted ('Solutions'/'Ltd' protect it)",
      demote("Delivery Solutions Ltd", FK) is False)
check("'Shipping Systems Ltd' -> NOT demoted ('Systems'/'Ltd' protect it)",
      demote("Shipping Systems Ltd", FK) is False)

print("\n5 — real customer names are inert:")
check("'Halcyon Leisure Group' -> NOT demoted", demote("Halcyon Leisure Group", FK) is False)
check("'Primrose Childcare' -> NOT demoted", demote("Primrose Childcare", FK) is False)

print("\n6 — supplier_name (the Document Issuer) is in scope too (C3 variant):")
check("'Deliver To RRS' on supplier_name -> demote (issuer is name-like)",
      demote("Deliver To RRS", "supplier_name") is True)
check("'Halcyon Leisure Group' on supplier_name -> NOT demoted",
      demote("Halcyon Leisure Group", "supplier_name") is False)

print("\n7 — structured (non-name) fields are inert (is_name_like_field False):")
check("'Deliver To RRS' on invoice_number -> NOT demoted", demote("Deliver To RRS", "invoice_number") is False)
check("'Deliver To RRS' on order_date -> NOT demoted", demote("Deliver To RRS", "order_date") is False)

print("\n8 — kill switch HEADING_GARBLE_GUARD=0 disables the guard entirely:")
os.environ["HEADING_GARBLE_GUARD"] = "0"
check("kill switch off -> 'Deliver To RRS' NOT demoted", demote("Deliver To RRS", FK) is False)
del os.environ["HEADING_GARBLE_GUARD"]
check("kill switch removed -> demotion active again", demote("Deliver To RRS", FK) is True)

print("\n9 — empty / no-substantial-token values are never demoted (no basis):")
check("'' -> NOT demoted", demote("", FK) is False)
check("None -> NOT demoted", demote(None, FK) is False)
check("'NY' (no substantial token) -> NOT demoted", demote("NY", FK) is False)

print("\n10 — has_no_protective_token pins WHY 3/4 are saved (a dev can't drop the exclusion):")
check("'Delivery Solutions Ltd' HAS a protective token -> False",
      wordness.has_no_protective_token("Delivery Solutions Ltd") is False)
check("'Shipping Systems Ltd' HAS a protective token -> False",
      wordness.has_no_protective_token("Shipping Systems Ltd") is False)
check("'Deliver To RRS' has NO protective token -> True",
      wordness.has_no_protective_token("Deliver To RRS") is True)
check("'Deliver lo' has NO protective token -> True",
      wordness.has_no_protective_token("Deliver lo") is True)
check("'' has no substantial token -> False (no basis)",
      wordness.has_no_protective_token("") is False)

print("\n11 — the guard is gated on a REAL name flag (not a no-op): the garbles DO flag,")
print("      the real names do NOT (so removing the flag path can't silently disable the guard):")
check("name_structure_flag('Deliver To RRS') is a flag", wordness.name_structure_flag("Deliver To RRS") is not None)
check("name_structure_flag('Deliver lo') is a flag", wordness.name_structure_flag("Deliver lo") is not None)
check("name_structure_flag('Primrose Childcare') is None", wordness.name_structure_flag("Primrose Childcare") is None)

print(f"\n{'ALL PASS' if fails == 0 else str(fails) + ' FAILED'}")
sys.exit(1 if fails else 0)
