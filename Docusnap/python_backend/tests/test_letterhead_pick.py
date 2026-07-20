"""
test_letterhead_pick.py — the cold-start letterhead ISSUER reader (extraction/letterhead.py).

Run:  py -3.12 tests/test_letterhead_pick.py     (from python_backend/)

WHAT IT GUARDS. `field_patterns.supplier_name` finds the issuer only by a CAPTION, and real
letterheads carry none — so on first contact the issuer was unreadable (measured: 0 of 270
documents identified cold, one of them with its own company name as OCR line 1). This reader
SUGGESTS the letterhead name; it never assigns one.

THE CARDINAL RULE, mirroring title_pick's: **empty beats a guess.** A wrong issuer is far worse
than none — supplier_name is the scope key for hints, anchors, logo fingerprints and template
identity, so a wrong one plants a poisoned scope that then attracts future documents, while an
empty one is just a blank box on a review screen.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import json

from extraction.letterhead import pick_issuer
from extraction import title_pick
from extraction.engine import _letterhead_type_phrases

# Build type_phrases EXACTLY the way the engine seam does. An earlier version of this file passed a
# hand-written ["Delivery Note"], which greened on an argument the caller never supplies while the
# real caller passed only the bucket KEYS — so "TAX INVOICE" was eligible to be read as a company
# and the pin could not see it. Always exercise the production argument.
_CFG = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '..', 'config',
                    'keyword_patterns.json')
with open(os.path.normpath(_CFG), encoding='utf-8') as _f:
    PROD_TYPE_PHRASES = _letterhead_type_phrases(json.load(_f))

fails = 0


def check(label, cond):
    global fails
    print(("  OK  " if cond else "  BAD ") + label)
    if not cond:
        fails += 1


# The two documents whose failure prompted this module, verbatim from a cold pipeline trace.
VELLUM = ("Vellum & Crane Stationers\nVC    8 Paternoster Court\nYork YO1 7HH\n"
          "T 01904 337261\nInvoice No. INV-61770\nINVOICE    Invoice Date 13/10/2026\n"
          "Bill To:\nHalcyon Leisure Group\nThe Pavilion, Marine Parade\nTorquay\n")
MARLOWE_PO = ("Marlowe Medical Supplies\nWren House, 40 Infirmary Road\nSheffield S6 3DA\n"
              "T 0114 270 9931\nPURCHASE ORDER    Order No. PO-59590\nOrder Date 13/08/2026\n"
              "Supplier\nLarch & Hollow Cafe Co\n12 Market Cross\nChester\n")

print("-- the documents that motivated this --")
check("reads the issuer off a real letterhead (was: null)",
      pick_issuer(VELLUM, detected_title="Invoice") == "Vellum & Crane Stationers")
check("does NOT pick the 'Bill To' recipient", pick_issuer(VELLUM) != "Halcyon Leisure Group")
# On a BUYER-issued document the letterhead belongs to the buyer, who IS the issuer, while the
# "Supplier:" caption names the counterparty. Position beats caption here — which is exactly the
# case the caption-driven path gets wrong.
check("on a purchase order reads the BUYER's letterhead, not the 'Supplier:' caption",
      pick_issuer(MARLOWE_PO, detected_title="Purchase Order") == "Marlowe Medical Supplies")

print("\n-- empty beats a guess --")
check("no letterhead (a bare worksheet) -> None",
      pick_issuer("WORKSHEET 38\nJob 4471-2201-9\nQty 4\nSigned ......\n") is None)
check("empty / whitespace input -> None", pick_issuer("") is None and pick_issuer("   \n\n") is None)
check("a document title is never a company",
      pick_issuer("INVOICE\n12 Market Cross\nChester CH1 2HU\n", detected_title="Invoice") is None)
check("a type-vocabulary phrase is never a company",
      pick_issuer("Delivery Note\n12 Market Cross\nChester CH1 2HU\n",
                  type_phrases=PROD_TYPE_PHRASES) is None)
check("an address line is not a company", pick_issuer("8 Paternoster Court\nYork YO1 7HH\n") is None)
check("a phone line is not a company", pick_issuer("T 01904 337261\nYork YO1 7HH\n") is None)
check("a garbled name is rejected by the shared plausibility gate",
      pick_issuer("Fr eanehae Crane\n8 Mill Road\nYork YO1 7HH\n") is None)
check("a caption line ending in ':' is never a company",
      pick_issuer("Remit To:\n8 Mill Road\nYork YO1 7HH\n") is None)

print("\n-- corroboration is required (a capitalised phrase alone is not a letterhead) --")
check("a bare name with NO address block and NO legal suffix -> None",
      pick_issuer("Quarterly Summary\nSome free text follows here\nand more text\n") is None)
check("a legal suffix alone is sufficient corroboration",
      pick_issuer("Copperfield Electrical Ltd\nyour reference below\nthanks\n")
      == "Copperfield Electrical Ltd")
check("an address block alone is sufficient corroboration",
      pick_issuer("Northgate Textiles\n14 Mill Street\nLeeds LS1 4DF\n") == "Northgate Textiles")

print("\n-- abstain rather than choose between two companies --")
# A garbled recipient marker can leak the other party into the band. Two plausible companies means
# we cannot tell which issued the document, so we say nothing.
check("two distinct companies in the band -> None (leaked recipient / ambiguous)",
      pick_issuer("Northgate Textiles Ltd\nBi11 To:\nHalcyon Leisure Group Ltd\n"
                  "The Pavilion, Marine Parade\nTorquay TQ2 5TR\n") is None)

print("\n-- position: the issuer sits at the TOP of the band --")
check("a name below the top of the band is never taken, even alone",
      pick_issuer("Statement of account for the period\nplease see below\nthanks\n"
                  "Northgate Textiles Ltd\n14 Mill Street, Leeds LS1 4DF\n") is None)
# PIN FLIPPED 2026-07-20 (Oracle SEND-BACK). This used to assert that a correct top-of-band issuer
# WINS over a second company lower down. That is precisely the rule that made the uncaptioned
# recipient-first layout return the CUSTOMER: from inside the text there is no way to tell
# "issuer, then a company mentioned below" from "recipient, then the issuer". Distinguishing them
# needs word HEIGHT, which this module deliberately does not have. So it now abstains on both, and
# the cost is real: a letterhead that names a second company in its top lines yields nothing.
# Do NOT restore the old expectation to recover that yield — restore the geometry instead.
check("two companies in the band -> None, even when the FIRST one is the true issuer (ACCEPTED)",
      pick_issuer("Northgate Textiles\n14 Mill Street\nLeeds LS1 4DF\nT 0113 000 0000\n"
                  "Halcyon Leisure Group Ltd\n") is None)

print("\n-- Oracle SEND-BACK 2026-07-20: the two wrong-suggestion classes (these FAILED on build 1) --")
# F2 — UNCAPTIONED recipient-first (window-envelope) layout. There is NO "Bill To" caption, so
# nothing truncates the band: the CUSTOMER sits at index 0 with its own address beneath it
# (corroboration satisfied, single candidate in the top 3 lines) and the real issuer sits at
# index 4, unseen. Build 1 suggested the customer. The fix scans the WHOLE band for candidates,
# so the second company now triggers the abstain.
# ⚠ Text position CANNOT solve this class — only word height can ("the biggest text in the top
# band"). Abstaining is the correct answer here; if you find yourself relaxing the band index to
# rescue it, restore the word geometry instead (see letterhead.py's stop rule).
check("uncaptioned recipient-first layout -> None (was: suggested the CUSTOMER)",
      pick_issuer("Halcyon Leisure Group\nUnit 7, Marine Parade\nTorquay TQ2 5TR\n"
                  "T 01803 555 111\nNorthgate Textiles Ltd\n14 Mill Street, Leeds LS1 4DF\n") is None)

# F3 — logo-only branding: the company name is in the LOGO IMAGE, so the only text at the top is
# the printed type heading. "TAX INVOICE" is multi-word (GENERIC_SINGLES misses it) and 10 chars
# (the chrome-fragment guard only judges 2-5 char cores), so it passed every shape test. Build 1
# suggested it as the company because the engine passed only the bucket KEYS.
_LOGO_ONLY = "TAX INVOICE\n8 Paternoster Court\nYork YO1 7HH\nT 01904 337261\n"
check("logo-only letterhead: a printed type PHRASE is never a company (was: 'TAX INVOICE')",
      pick_issuer(_LOGO_ONLY, type_phrases=PROD_TYPE_PHRASES) is None)
check("...and the defect is real: with only the bucket KEYS it IS wrongly suggested",
      pick_issuer(_LOGO_ONLY, type_phrases=["Invoice", "Sales Order"]) == "TAX INVOICE")
check("the engine seam supplies PHRASES, not just keys (many more than the ~10 bucket names)",
      len(PROD_TYPE_PHRASES) > 40 and any(" " in p and p.lower() != p.title().lower()
                                          or "tax invoice" == p.lower() for p in PROD_TYPE_PHRASES))

print("\n-- the COMPLEMENT invariant (do not let these two modules drift apart) --")
# title_pick REJECTS a line as a document title precisely because it is a company name or sits
# above an address block. Those rejection reasons are the POSITIVE evidence for a letterhead
# issuer. If a future edit to title_pick's regexes breaks this, the two modules have diverged.
for name, body in (("Copperfield Electrical Ltd", "Copperfield Electrical Ltd\nx\ny\n"),
                   ("Northgate Textiles", "Northgate Textiles\n14 Mill Street\nLeeds LS1 4DF\n")):
    lines = [l for l in body.splitlines() if l.strip()]
    reason = title_pick._reject(name, lines, 0, None)
    check("title_pick rejects '%s' as a title (reason=%s) AND letterhead accepts it"
          % (name, reason), reason in ("company-name", "address-block") and pick_issuer(body) == name)

print("\n-- purity: no I/O, no env reads, deterministic --")
_before = dict(os.environ)
check("repeated calls agree", pick_issuer(VELLUM) == pick_issuer(VELLUM))
check("reads no environment", os.environ == _before)

print()
if fails:
    print("FAILED: %d check(s)" % fails)
    sys.exit(1)
print("ALL PASS")
