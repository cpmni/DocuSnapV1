"""Slice 0 of the teach→file arc — LETTERHEAD FRAGMENT ABSTAIN (2026-08-21, gary → Oracle
SIGN-OFF-W/COND S0-C1..C3; DARK behind LETTERHEAD_FRAGMENT_ABSTAIN / `letterhead_fragment_abstain`).

THE EXHIBIT (Chris r12 card #2, reproduced through the REAL OCR path at the app's 200 DPI):
  row 0: 'Silverbeck' h=1.76 | 'Cleaning' h=2.24 | 'Supplies' h=2.24
'Supplies' fails the distinctive-core gate (generic), 'Cleaning' out-ranks 'Silverbeck' on height, and
'Cleaning' was PRE-FILLED as the company. Same class: 'Security' for 'Castellan Security Systems'.

Pins:
  OFF is byte-identical   — the exhibit still yields 'Cleaning' with the flag unset.
  exhibit abstains        — ON: a single-token winner beside a letterhead-sized, name-shaped,
                            non-excluded segment on its own row → None (the text arm runs).
  SuperStore still picks  — 'Superstore    INVOICE': INVOICE is an excluded type phrase, so it is not
                            name-shaped for the neighbour test.
  two-column trade-off    — 'Acme    Widgets Ltd' both letterhead-sized → None (pinned, accepted).
  body-sized neighbour    — a wordmark beside a BODY-sized column keeps picking (S0-C3 size floor).
  not adjacent            — a big name-shaped segment two columns away does not trigger.
  multi-token winner      — 'Pelican Office Interiors' is never a fragment.
  superset first          — a recurring full name still wins over the abstain.
  no re-join              — the assert path NEVER returns the joined span (Oracle, twice).

Run:  py -3.12 tests/test_letterhead_fragment_abstain.py   (from python_backend/)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from extraction import letterhead as lh

fails = 0


def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1


def geom(lines_heights, med_h=10):
    """lines_heights = [(line_text, {token: height})] — one word per token, positional pairing as
    reconstruct_page_text emits it; tokens absent from the dict are body-sized (= med_h)."""
    lines = [t for (t, _h) in lines_heights]
    rows = []
    for i, (t, hs) in enumerate(lines_heights):
        rows.append([(10 + 60 * j, 10 + 100 * i, 50, hs.get(tok, med_h), tok, 90)
                     for j, tok in enumerate(t.split())])
    return {"lines": lines, "rows": rows, "med_h": med_h, "words": [], "size": (2480, 3508)}


TYPES = ["invoice", "sales order", "purchase order", "service worksheet", "statement"]
BIG = {"Silverbeck": 17.6, "Cleaning": 22.4, "Supplies": 22.4}
SILVERBECK = "Silverbeck    Cleaning    Supplies\nBrightworks House, 7 Lather Lane - Suddsfield, SF2 6NN\nVAT Reg No GB 821 4458 39\nSALES ORDER NO    ORDER DATE"
SB_GEOM = geom([("Silverbeck    Cleaning    Supplies", BIG),
                ("Brightworks House, 7 Lather Lane - Suddsfield, SF2 6NN", {}),
                ("VAT Reg No GB 821 4458 39", {}),
                ("SALES ORDER NO    ORDER DATE", {})])


def pick(ocr, g, flag):
    os.environ["LETTERHEAD_FRAGMENT_ABSTAIN"] = "1" if flag else "0"
    try:
        return lh.pick_issuer_geometry(ocr, g, type_phrases=TYPES)
    finally:
        os.environ.pop("LETTERHEAD_FRAGMENT_ABSTAIN", None)


print("-- OFF is byte-identical (the exhibit reproduces) --")
check("flag OFF: the fragment still wins on height ('Cleaning')", pick(SILVERBECK, SB_GEOM, False) == "Cleaning")
check("flag unset (default) == OFF", lh.pick_issuer_geometry(SILVERBECK, SB_GEOM, type_phrases=TYPES) == "Cleaning")

print("\n-- ON: the exhibit abstains --")
check("Silverbeck exhibit → None (empty beats a guess; the text arm runs)", pick(SILVERBECK, SB_GEOM, True) is None)
CAST = "cs\nCastellan    Security    Systems\nKeep House, 14 Bastion Way - Fortbridge, FB1 9AA\nSERVICE    WORKSHEET"
C_GEOM = geom([("cs", {}), ("Castellan    Security    Systems", {"Castellan": 19.4, "Security": 23.8, "Systems": 23.1}),
               ("Keep House, 14 Bastion Way - Fortbridge, FB1 9AA", {}), ("SERVICE    WORKSHEET", {"SERVICE": 20, "WORKSHEET": 19.4})])
check("Castellan exhibit: OFF → 'Security'", pick(CAST, C_GEOM, False) == "Security")
check("Castellan exhibit: ON → None", pick(CAST, C_GEOM, True) is None)
check("NO RE-JOIN in the assert path — never the joined span",
      pick(SILVERBECK, SB_GEOM, True) != "Silverbeck Cleaning Supplies" and pick(CAST, C_GEOM, True) != "Castellan Security Systems")

print("\n-- the conditions (S0-C3) --")
SS = "Superstore    INVOICE\n# 32104\nDate: Dec 30 2012"
SS_GEOM = geom([("Superstore    INVOICE", {"Superstore": 12.6, "INVOICE": 28.7}), ("# 32104", {}), ("Date: Dec 30 2012", {})])
check("SuperStore still picks — INVOICE is an excluded type phrase, not a name-shaped neighbour",
      pick(SS, SS_GEOM, True) == "Superstore" and pick(SS, SS_GEOM, False) == "Superstore")
ACME = "Acme    Widgets Ltd\n1 High Street, Town, TN1 1AA\nTel 01234 567890"
A_GEOM = geom([("Acme    Widgets Ltd", {"Acme": 20, "Widgets": 20, "Ltd": 20}), ("1 High Street, Town, TN1 1AA", {}), ("Tel 01234 567890", {})])
check("PINNED TRADE-OFF: a genuine two-column 'Acme    Widgets Ltd' (both big) → None", pick(ACME, A_GEOM, True) is None)
BODY = "Acme    Customer Services Dept\n1 High Street, Town, TN1 1AA\nTel 01234 567890"
B_GEOM = geom([("Acme    Customer Services Dept", {"Acme": 20}), ("1 High Street, Town, TN1 1AA", {}), ("Tel 01234 567890", {})])
check("a BODY-sized neighbour column never triggers (size floor) — 'Acme' keeps picking", pick(BODY, B_GEOM, True) == "Acme")
FAR = "Acme    12 Main Road    Supplies\n1 High Street, Town, TN1 1AA\nTel 01234 567890"
F_GEOM = geom([("Acme    12 Main Road    Supplies", {"Acme": 20, "Supplies": 20}), ("1 High Street, Town, TN1 1AA", {}), ("Tel 01234 567890", {})])
check("only ADJACENT segments count — a big name-shaped (generic) segment two columns away does not trigger",
      pick(FAR, F_GEOM, True) == "Acme" and pick(FAR, F_GEOM, False) == "Acme")
PEL = "Pelican Office Interiors\n82 Wharfside Business Park - Easthaven, EH11 3PL\nSALES INVOICE"
P_GEOM = geom([("Pelican Office Interiors", {"Pelican": 20.6, "Office": 20.6, "Interiors": 20.6}),
               ("82 Wharfside Business Park - Easthaven, EH11 3PL", {}), ("SALES INVOICE", {"SALES": 23.3, "INVOICE": 23.3})])
check("a multi-token winner is never a fragment — 'Pelican Office Interiors' picks with the flag ON", pick(PEL, P_GEOM, True) == "Pelican Office Interiors")
SUP = "Cloud    Services\nCloud VPS Ltd\n1 High Street, Town, TN1 1AA"
S_GEOM = geom([("Cloud    Services", {"Cloud": 35, "Services": 30}), ("Cloud VPS Ltd", {"Cloud": 17, "VPS": 17, "Ltd": 17}), ("1 High Street, Town, TN1 1AA", {})])
check("the superset rule still runs FIRST — a recurring full name beats the abstain", pick(SUP, S_GEOM, True) == "Cloud VPS Ltd")

print("\n-- kill switch semantics --")
os.environ["LETTERHEAD_FRAGMENT_ABSTAIN"] = "1"
check("_fragment_abstain_enabled reads the env", lh._fragment_abstain_enabled() is True)
os.environ["LETTERHEAD_FRAGMENT_ABSTAIN"] = "0"
check("…and '0' disarms it", lh._fragment_abstain_enabled() is False)
os.environ.pop("LETTERHEAD_FRAGMENT_ABSTAIN", None)
check("…unset disarms it", lh._fragment_abstain_enabled() is False)

print()
if fails:
    print("FAILED: %d check(s)" % fails)
    sys.exit(1)
print("ALL PASS")
