"""
tests/test_branding_distinctive_tokens.py — slice 2 of the distinctive-token train
(BRANDING_DISTINCTIVE_TOKENS, Oracle-signed 2026-07-20).

The engine's branding banks kept 'INV'-class fragments (split off "INV-12345" at harvest, digit-free
so the digit filter never saw them). For a WRONG supplier those junk tokens are the likeliest page
hits — on the live doc-161 page ('INVOIC E' garble + 'INV-76642') they inflate own_ratio above the
0.25 present-bar and SUPPRESS _flag_branding_conflict: the same defeat class as the Stage-0 gate,
through the other door. Banks now use the SHARED template_matcher._distinctive_tokens (Oracle
condition D: one definition, gate and flag can't drift — the parity pin below is the condition).

    py -3.12 tests/test_branding_distinctive_tokens.py    (from python_backend/)
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from extraction import engine                                    # noqa: E402
from extraction import template_matcher as tm                    # noqa: E402
from extraction.engine import ExtractionEngine                   # noqa: E402

fails = 0


def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond:
        fails += 1


NORM = staticmethod(lambda v: " ".join(str(v or "").strip().lower().split())).__func__

# Real-shaped: a Copperfield fingerprint carrying the harvest junk 'INV' + the OCR-clipped 'INVOIC'.
COPPER_T = {"name": "Copperfield Electrical",
            "keyword_fingerprint": ["Copperfield", "Electrical", "Faraday", "INV", "INVOIC"]}
# Doc 161's live shape: the page contains 'INVOIC E' and 'INV-76642' — both junk tokens HIT.
NORTHGATE_PAGE = ("Northgate Textiles\nNorthgate Mill, 14 Weavers Way\nPreston PR1 3QX\n"
                  "INVOIC E\nInvoice No. INV-76642\nBill To\nAldermoor Engineering")


class FakeSelf:
    accepted_issuers = set()
    _accept_norm = staticmethod(lambda v: " ".join(str(v or "").strip().lower().split()))


def run_flag(env):
    os.environ["BRANDING_DISTINCTIVE_TOKENS"] = env
    try:
        results = {"supplier_name": {"value": "Copperfield Electrical", "confidence": 98,
                                     "method": "template_fixed"},
                   "_needs_review": False}
        ExtractionEngine._flag_branding_conflict(FakeSelf(), results, "Copperfield Electrical",
                                                 [COPPER_T], NORTHGATE_PAGE)
        return results
    finally:
        os.environ.pop("BRANDING_DISTINCTIVE_TOKENS", None)


print("§1 the other door — junk tokens must not suppress the conflict flag")
r_old = run_flag("0")
check("RED PROOF: legacy banks — 'INV'+'INVOIC' hit (own 2/5=0.4 > 0.25) and the flag is SUPPRESSED",
      not (r_old["supplier_name"].get("validation_note")))
r_new = run_flag("1")
check("distinctive banks — junk stripped, own 0/3 => the wrong supplier IS flagged",
      bool(r_new["supplier_name"].get("validation_note")) and r_new["_needs_review"] is True)
check("flag stays FLAG-ONLY (value untouched)", r_new["supplier_name"]["value"] == "Copperfield Electrical")

print("\n§2 bank contents + the parity pin (Oracle condition D)")
banks_new = engine._branding_banks([COPPER_T], FakeSelf._accept_norm)
bank = banks_new["copperfield electrical"]["words"]
check("'inv' and 'invoic' are stripped from the bank", "inv" not in bank and "invoic" not in bank)
check("real branding tokens survive", {"copperfield", "electrical", "faraday"} <= bank)
check("PARITY PIN: the engine bank IS template_matcher._distinctive_tokens (one definition, no drift)",
      bank == tm._distinctive_tokens(COPPER_T["keyword_fingerprint"]))

os.environ["BRANDING_DISTINCTIVE_TOKENS"] = "0"
banks_old = engine._branding_banks([COPPER_T], FakeSelf._accept_norm)
os.environ.pop("BRANDING_DISTINCTIVE_TOKENS", None)
check("=0 revert: legacy bank keeps 'inv'/'invoic' (byte-identical pre-change filter)",
      {"inv", "invoic"} <= banks_old["copperfield electrical"]["words"])

print("\n§3 unjudgeability stays fail-safe")
tiny = {"name": "Two Word", "keyword_fingerprint": ["Two", "Word", "INV"]}
banks_tiny = engine._branding_banks([tiny], FakeSelf._accept_norm)
check("a bank reduced below K=3 by the strip is UNJUDGEABLE downstream (words < 3), never 'absent'",
      len(banks_tiny["two word"]["words"]) < engine._BRANDING_MIN_WORDS)

print(("\nFAIL" if fails else "\nPASS") + f" — {fails} failed check(s)")
sys.exit(1 if fails else 0)
