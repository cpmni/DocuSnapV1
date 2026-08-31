"""
tests/test_logo_text_gate.py — the TEXT-AGREEMENT GATE (identity text-first, slice 1b).

A logo match must AGREE with the page text to assert an identity; it may SUGGEST when the text
can't judge; it is DROPPED when the text positively contradicts it. Born from the 2026-07-19
Larkspur incident (20 docs from a never-enrolled supplier -> 4 assigned Ridgeway, 1 Copperfield)
and the measurement behind it: the 64-bit logo phash has ZERO separating power on scans
(cross-supplier MIN hamming 2 vs same-supplier min 6) while the printed branding separates cleanly.

Drives the PURE decision (engine.decide_logo_text_gate) — no engine instantiation, mirroring
test_branding_conflict.py's fake-self style.

    py -3.12 tests/test_logo_text_gate.py     (from python_backend/)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from extraction.engine import (  # noqa: E402
    decide_logo_text_gate, _branding_banks, _identity_text_sufficient,
    _IDENTITY_MIN_BAND_TOKENS, _IDENTITY_MIN_PAGE_TOKENS,
)

fails = 0


def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1


NORM = lambda v: " ".join(str(v or "").strip().lower().split())   # noqa: E731 (mirrors _accept_norm)

# Two enrolled suppliers with distinctive branding banks; Larkspur is the NEW sender (no bank).
TEMPLATES = [
    {"name": "Ridgeway Plant Hire", "dominant_supplier": "Ridgeway Plant Hire",
     "keyword_fingerprint": ["ridgeway", "plant", "hire", "quarry", "aggregates"]},
    {"name": "Copperfield Electrical", "dominant_supplier": "Copperfield Electrical",
     "keyword_fingerprint": ["copperfield", "electrical", "switchgear", "contractors"]},
]
BANKS = _branding_banks(TEMPLATES, NORM)

# A realistic Larkspur docket: enough text to judge, and it says LARKSPUR, not Ridgeway.
LARKSPUR_PAGE = (
    "Larkspur Interiors\nThe Design Rooms, 3 Chapel Lane\nHarrogate HG1 2PZ\nT 01423 560118\n"
    "DELIVERY DOCKET   Delivery Note No. DN-62624   Date 10/09/2026\n"
    "Deliver To\nBrightwater Dental Practice\n5 St Aldate's Chambers\nOxford OX1 1BN\n"
    "Description\nDrum 25L\nCartons assorted\nCrate hardware\nPallet mixed goods\nBox spares\n"
    "Received in good condition\nName Signature\n"
)
# A genuine Ridgeway page (its own branding present).
RIDGEWAY_PAGE = (
    "Ridgeway Plant Hire\nQuarry Road Industrial Estate\nAggregates and plant hire\n"
    "DELIVERY NOTE   DN-70099   Date 02/09/2026\nDeliver To\nSome Customer Ltd\n"
    "Items supplied as per order\nDriver signature\nReceived in good condition\n"
) + "filler line for token count\n" * 6
THIN_PAGE = "Ridgeway\nDN-1\nsigned"          # below the C2 sufficiency floor

print("§1 the three branches")
check("CORROBORATED -> accept (a genuine Ridgeway page keeps today's behaviour byte-identical)",
      decide_logo_text_gate("Ridgeway Plant Hire", BANKS, RIDGEWAY_PAGE, NORM) == 'accept')
check("THE INCIDENT: logo says Ridgeway, page says Larkspur -> ABSTAIN (identity dropped)",
      decide_logo_text_gate("Ridgeway Plant Hire", BANKS, LARKSPUR_PAGE, NORM) == 'abstain')
check("same page, the OTHER wrong pool (Copperfield) -> ABSTAIN too",
      decide_logo_text_gate("Copperfield Electrical", BANKS, LARKSPUR_PAGE, NORM) == 'abstain')
check("UNJUDGEABLE: a supplier with NO >=K-word bank (template-less) -> suggest, never abstain",
      decide_logo_text_gate("Larkspur Interiors", BANKS, LARKSPUR_PAGE, NORM) == 'suggest')

print("\n§2 Oracle C2 — the text-sufficiency floor (a destructive gate must not fire on mush)")
check("a page below the floor is NOT judged sufficient", not _identity_text_sufficient(THIN_PAGE))
check("a real page IS judged sufficient", _identity_text_sufficient(RIDGEWAY_PAGE))
check("TEXT-POOR page + a banked supplier -> suggest (NOT abstain): a bad scan must never "
      "delete a correct identity",
      decide_logo_text_gate("Ridgeway Plant Hire", BANKS, THIN_PAGE, NORM) == 'suggest')
check("empty text -> suggest (fail-safe, never destructive)",
      decide_logo_text_gate("Ridgeway Plant Hire", BANKS, "", NORM) == 'suggest')
check("the floor sits BELOW every real page measured on the live corpus (band 18 / page 76 was "
      "the thinnest; re-measure before moving these)",
      _IDENTITY_MIN_BAND_TOKENS < 18 and _IDENTITY_MIN_PAGE_TOKENS < 76)

print("\n§3 Oracle C3 — the operator allowlist outranks the text check")
check("an accepted-issuer supplier NEVER abstains (the human already ruled on this identity)",
      decide_logo_text_gate("Ridgeway Plant Hire", BANKS, LARKSPUR_PAGE, NORM,
                            accepted_issuers={NORM("Ridgeway Plant Hire")}) == 'suggest')
check("the allowlist does NOT upgrade a corroborated read (still accept)",
      decide_logo_text_gate("Ridgeway Plant Hire", BANKS, RIDGEWAY_PAGE, NORM,
                            accepted_issuers={NORM("Ridgeway Plant Hire")}) == 'accept')

print("\n§4 PINNED TRADE-OFFS (a future dev must not 'fix' these back)")
# The whole point of the slice: a logo alone — however close the hash — cannot assert identity.
check("PIN: a template-less supplier (perfect hash match implied) NEVER reaches 'accept' — "
      "logo-alone assertion must stay impossible",
      decide_logo_text_gate("Larkspur Interiors", BANKS, LARKSPUR_PAGE, NORM) != 'accept')
check("PIN: no banks at all (fresh install, zero templates) -> suggest, never abstain — "
      "a first-ever import must not lose every identity",
      decide_logo_text_gate("Anyone", {}, RIDGEWAY_PAGE, NORM) == 'suggest')
check("PIN: an empty logo supplier is never asserted", decide_logo_text_gate("", BANKS, RIDGEWAY_PAGE, NORM) == 'abstain')

print("\n§5 kill switch semantics (the gate is opt-out; OFF = pre-slice behaviour)")
check("the decision function itself is pure/env-free — LOGO_TEXT_GATE is honoured at the CALL "
      "SITE only (engine), so this function's verdict never changes with the env",
      decide_logo_text_gate("Ridgeway Plant Hire", BANKS, LARKSPUR_PAGE, NORM) == 'abstain')

print("\n§6 name-presence ACCEPT arm (geometry witness; Oracle C1-C5) — the SuperStore class")
# A minimalist single-word wordmark: thin top band (< 10 tokens) + a full body. Neither branding arm
# can judge it (band too thin AND SuperStore has no >=3-word bank), so it holds forever today.
SS_THINBAND = (
    "SuperStore\nINVOICE\n# 33526\nDate: Mar 30 2012\n"
    "Bill To: Ship To:\nAlex Russell\n19143 Philadelphia Pennsylvania United States\n"
    "Item Quantity Rate Amount\nClearSounds CSC500 Amplified Spirit Phone Corded phone\n"
    "Phones Technology TEC-PH-3827\nSubtotal 1511.78 Discount 604.71 Shipping 28.56 Total 935.63\n"
)
# Same brand but a FAT letterhead (band >= 10 tokens) — passes the sufficiency floor, but SuperStore
# still has no >=3-word distinctive bank, so own_ratio is None (the second unjudgeable branch).
SS_RICHBAND = (
    "SuperStore\n12 Market Parade\nCentral Retail Park\nManchester M1 4AB\n"
    "Tel 0161 555 0142   VAT GB 123 4567 89\nINVOICE # 33526   Date Mar 30 2012\n"
    "Bill To\nAlex Russell\n19143 Philadelphia Pennsylvania United States\n"
    "Item Quantity Rate Amount\nGoods supplied as per order\nSubtotal Total 935.63\n"
) + "body filler line for token count\n" * 6
SS = NORM("SuperStore")

check("thin band + geometry witness AGREES -> ACCEPT (the fix: a permanent hold clears)",
      decide_logo_text_gate("SuperStore", BANKS, SS_THINBAND, NORM, geom_issuer_norm=SS) == 'accept')
check("  band insufficient WITHOUT a witness -> suggest (default/switch-off = byte-identical)",
      decide_logo_text_gate("SuperStore", BANKS, SS_THINBAND, NORM, geom_issuer_norm=None) == 'suggest')
check("rich band, no >=3-word bank, witness AGREES -> ACCEPT (second unjudgeable branch)",
      decide_logo_text_gate("SuperStore", BANKS, SS_RICHBAND, NORM, geom_issuer_norm=SS) == 'accept')
check("  same rich band WITHOUT a witness -> suggest (inert)",
      decide_logo_text_gate("SuperStore", BANKS, SS_RICHBAND, NORM, geom_issuer_norm=None) == 'suggest')

print("\n§7 PINNED — the witness never confirms the WRONG identity (Oracle C1/C5 shapes 7 + compose)")
check("SHAPE 7 (recipient-bleed): geometry picked SOMEONE ELSE than the logo supplier -> HOLD, "
      "never accept (a marker-less recipient cannot confirm itself)",
      decide_logo_text_gate("SuperStore", BANKS, SS_THINBAND, NORM,
                            geom_issuer_norm=NORM("Alex Russell")) == 'suggest')
check("PIN: a witness NEVER rescues a POSITIVELY-CONTRADICTED identity — the abstain path is "
      "unreachable by the arm (rival branding decisively present still wins)",
      decide_logo_text_gate("Ridgeway Plant Hire", BANKS, LARKSPUR_PAGE, NORM,
                            geom_issuer_norm=NORM("Ridgeway Plant Hire")) == 'abstain')
check("PIN: witness present but empty logo supplier is still never asserted",
      decide_logo_text_gate("", BANKS, SS_THINBAND, NORM, geom_issuer_norm=SS) == 'abstain')

print(f"\n{'FAIL' if fails else 'PASS'} — {fails} failed check(s)")
sys.exit(1 if fails else 0)
