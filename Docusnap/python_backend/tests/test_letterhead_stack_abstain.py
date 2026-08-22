"""P1 of the two-line wordmark slice (2026-08-22, gary → Oracle SEND BACK (mechanism fix) → built):
LETTERHEAD_STACK_ABSTAIN (vertical-stack abstain) + LETTERHEAD_DEPTH_GUARD (the text arm's
_MAX_BAND_INDEX applied to single-token geometry winners). Both DARK.

THE EXHIBIT (owner's real scans, stacked wordmark "DOCUMENT" over "SOLUTIONS"): the cold geometry
pick prefilled "TIONS" (the garbled second line) and "Patrick" (the tail of a work address five band
lines down). The CLEAN stack already returns None (both words generic — the distinctive-core gate);
the garbled stack is what rule (a) catches, the deep single word is what (b′) catches.

Run:  py -3.12 tests/test_letterhead_stack_abstain.py   (from python_backend/)
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
    lines = [t for (t, _h) in lines_heights]
    rows = []
    for i, (t, hs) in enumerate(lines_heights):
        rows.append([(10 + 60 * j, 10 + 100 * i, 50, hs.get(tok, med_h), tok, 90)
                     for j, tok in enumerate(t.split())])
    return {"lines": lines, "rows": rows, "med_h": med_h, "words": [], "size": (2480, 3508)}


TYPES = ["invoice", "sales order", "purchase order", "service worksheet", "statement"]


def pick(ocr, g, stack=False, depth=False, frag=True):
    os.environ["LETTERHEAD_FRAGMENT_ABSTAIN"] = "1" if frag else "0"
    os.environ["LETTERHEAD_STACK_ABSTAIN"] = "1" if stack else "0"
    os.environ["LETTERHEAD_DEPTH_GUARD"] = "1" if depth else "0"
    try:
        return lh.pick_issuer_geometry(ocr, g, type_phrases=TYPES)
    finally:
        for k in ("LETTERHEAD_FRAGMENT_ABSTAIN", "LETTERHEAD_STACK_ABSTAIN", "LETTERHEAD_DEPTH_GUARD"):
            os.environ.pop(k, None)


print("-- (a) the garbled stack: OFF reproduces the exhibit, ON abstains --")
G1 = "SERVICE WORKSHEET\nDOCUMENT\nTIONS\nTicket 1234\nLocation"
g1 = geom([("SERVICE WORKSHEET", {"SERVICE": 23, "WORKSHEET": 23}), ("DOCUMENT", {"DOCUMENT": 20}),
           ("TIONS", {"TIONS": 20}), ("Ticket 1234", {}), ("Location", {})])
check("OFF: 'TIONS' wins on height (the exhibit, positive control)", pick(G1, g1) == "TIONS")
check("ON: DOCUMENT / TIONS → None (a bare generic word on its own letterhead-sized line is the stack signature)",
      pick(G1, g1, stack=True) is None)
G2 = "SERVICE WORKSHEET\nJMENT\nJTIONS\nTicket 1234\nLocation"
g2 = geom([("SERVICE WORKSHEET", {"SERVICE": 23, "WORKSHEET": 23}), ("JMENT", {"JMENT": 18}),
           ("JTIONS", {"JTIONS": 22}), ("Ticket 1234", {}), ("Location", {})])
check("OFF: JMENT / JTIONS → 'JTIONS' (positive control)", pick(G2, g2) == "JTIONS")
check("ON: JMENT / JTIONS → None (name-shaped neighbour)", pick(G2, g2, stack=True) is None)
check("NO RE-JOIN: never the joined span", pick(G1, g1, stack=True) != "DOCUMENT TIONS" and pick(G2, g2, stack=True) != "JMENT JTIONS")

print("\n-- the clean stack is already None (documents why the obvious pin is vacuous) --")
G3 = "SERVICE WORKSHEET\nDOCUMENT\nSOLUTIONS\nTicket 1234\nLocation"
g3 = geom([("SERVICE WORKSHEET", {"SERVICE": 23, "WORKSHEET": 23}), ("DOCUMENT", {"DOCUMENT": 20}),
           ("SOLUTIONS", {"SOLUTIONS": 20}), ("Ticket 1234", {}), ("Location", {})])
check("DOCUMENT / SOLUTIONS → None with the flag OFF (both generic — distinctive-core gate)", pick(G3, g3) is None)
check("…and ON", pick(G3, g3, stack=True) is None)

print("\n-- (a) negative controls --")
G4 = "Superstore\nINVOICE\n12 High Street"
g4 = geom([("Superstore", {"Superstore": 13}), ("INVOICE", {"INVOICE": 29}), ("12 High Street", {})])
check("a one-word company over an excluded type phrase still picks ('Superstore' / INVOICE)", pick(G4, g4, stack=True) == "Superstore")
G5 = "Superstore\nStatement\n12 High Street"
g5 = geom([("Superstore", {"Superstore": 13}), ("Statement", {"Statement": 29}), ("12 High Street", {})])
check("…'Statement' is in GENERIC_SINGLES but not a generic COMPANY word nor a stack neighbour → still picks", pick(G5, g5, stack=True) == "Superstore")
G6 = "Acme\n14 Bastion Way, FB1 9AA\nTel 01234 567890"
g6 = geom([("Acme", {"Acme": 20}), ("14 Bastion Way, FB1 9AA", {"14": 20, "Bastion": 20, "Way,": 20, "FB1": 20, "9AA": 20}), ("Tel 01234 567890", {})])
check("a one-word company over an ADDRESS line still picks (an address is disqualified, never a neighbour)", pick(G6, g6, stack=True) == "Acme")
G7 = "Acme\nWidgets    Ltd\n1 High Street, Town, TN1 1AA"
g7 = geom([("Acme", {"Acme": 24}), ("Widgets    Ltd", {"Widgets": 20, "Ltd": 20}), ("1 High Street, Town, TN1 1AA", {})])
check("a column-broken neighbour row is never consulted ('Acme' over 'Widgets    Ltd' still picks)", pick(G7, g7, stack=True) == "Acme")
G8 = "Acme\nSolutions\n1 High Street, Town, TN1 1AA"
g8 = geom([("Acme", {"Acme": 20}), ("Solutions", {"Solutions": 10}), ("1 High Street, Town, TN1 1AA", {})])
check("a BODY-sized neighbour never triggers (size floor) — 'Acme' picks", pick(G8, g8, stack=True) == "Acme")
G9 = "ACME\nLtd\n1 High Street, Town, TN1 1AA"
g9 = geom([("ACME", {"ACME": 20}), ("Ltd", {"Ltd": 20}), ("1 High Street, Town, TN1 1AA", {})])
check("ACME over a letterhead-sized 'Ltd' → None (stacked legal suffix)", pick(G9, g9, stack=True) is None)
G10 = "Acme Widgets\nSolutions\n1 High Street, Town, TN1 1AA"
g10 = geom([("Acme Widgets", {"Acme": 20, "Widgets": 20}), ("Solutions", {"Solutions": 20}), ("1 High Street, Town, TN1 1AA", {})])
check("a MULTI-token winner is never a stack fragment ('Acme Widgets' picks)", pick(G10, g10, stack=True) == "Acme Widgets")

print("\n-- (b′) the depth guard — a single word deep in the band is never a candidate --")
GP = ("SERVICE WORKSHEET\nDOCUMENT\nSOLUTIONS\nTicket    Location\n"
      "Ticket No.    2601-0371-1    Work Address    Beaumont Care Homes Ltd - Croagh\nPatrick")
gp = geom([("SERVICE WORKSHEET", {"SERVICE": 23, "WORKSHEET": 23}), ("DOCUMENT", {"DOCUMENT": 20}),
           ("SOLUTIONS", {"SOLUTIONS": 20}), ("Ticket    Location", {}),
           ("Ticket No.    2601-0371-1    Work Address    Beaumont Care Homes Ltd - Croagh", {}),
           ("Patrick", {"Patrick": 14})])
check("OFF: 'Patrick' (band index 5) wins — the exhibit, positive control", pick(GP, gp) == "Patrick")
check("ON: 'Patrick' at band index 5 is not a candidate → None", pick(GP, gp, depth=True) is None)
GQ = "Superstore\n# 32104\nDate: Dec 30 2012"
gq = geom([("Superstore", {"Superstore": 13}), ("# 32104", {}), ("Date: Dec 30 2012", {})])
check("the same kind of single token at band index 0 still picks (the frame is the BAND index)", pick(GQ, gq, depth=True) == "Superstore")
GR = "SERVICE WORKSHEET\nTicket\nLocation\nRef\nBeaumont Care Homes Ltd"
gr = geom([("SERVICE WORKSHEET", {"SERVICE": 23, "WORKSHEET": 23}), ("Ticket", {}), ("Location", {}), ("Ref", {}),
           ("Beaumont Care Homes Ltd", {"Beaumont": 16, "Care": 16, "Homes": 16, "Ltd": 16})])
check("a MULTI-token candidate deep in the band is untouched by the depth guard", pick(GR, gr, depth=True) == "Beaumont Care Homes Ltd")

print("\n-- kill switches --")
check("stack: unset/0 disarmed, 1 armed",
      lh._stack_abstain_enabled() is False and (os.environ.__setitem__("LETTERHEAD_STACK_ABSTAIN", "1") or lh._stack_abstain_enabled() is True))
os.environ.pop("LETTERHEAD_STACK_ABSTAIN", None)
check("depth: unset/0 disarmed, 1 armed",
      lh._depth_guard_enabled() is False and (os.environ.__setitem__("LETTERHEAD_DEPTH_GUARD", "1") or lh._depth_guard_enabled() is True))
os.environ.pop("LETTERHEAD_DEPTH_GUARD", None)

print()
if fails:
    print("FAILED: %d check(s)" % fails)
    sys.exit(1)
print("ALL PASS")
