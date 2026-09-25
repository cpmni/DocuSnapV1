#!/usr/bin/env python3
"""tests/test_keyword_label_tail_bound.py — KEYWORD_LABEL_TAIL_BOUND (mig 219, 2026-09-25; Chris 09-24
card-4 class; Oracle C6, DARK default OFF).

_label_pattern gives a single-word ALPHABETIC label a trailing bound but leaves a MULTI-WORD label
("Credit No", "Delivery No") without one, so it PREFIX-HITS its own printed heading ("CREDIT NOTE",
"DELIVERY NOTE") and the below-walk then adopts the next line as the value (the incident: "Credit No"
-> "Meadowvale" @80). The switch adds the SCALAR twin of LIST_CAPTION_TAIL_BOUND — a letter-only
lookahead (?![a-z]) on the multi-word-alpha-tail scalar label. A digit-glued value still matches;
"Credit Note"/"Delivery Note" no longer do. Default OFF => byte-identical.

    py -3.12 tests/test_keyword_label_tail_bound.py   (from python_backend/)
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from extraction import keyword                                            # noqa: E402

fails = 0


def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond:
        fails += 1


def setflag(v):
    if v is None:
        os.environ.pop("KEYWORD_LABEL_TAIL_BOUND", None)
    else:
        os.environ["KEYWORD_LABEL_TAIL_BOUND"] = v


def find(lines, label):
    return keyword._search_for_label(lines, label, ["right", "below"])


# ── 1. the arming predicate ──────────────────────────────────────────────
print("1. _label_tail_boundable (multi-word, alphabetic last word):")
check("'Credit No' -> True", keyword._label_tail_boundable("Credit No") is True)
check("'Delivery No' -> True", keyword._label_tail_boundable("Delivery No") is True)
check("'Total' (single word) -> False", keyword._label_tail_boundable("Total") is False)
check("'Order No 5' (digit last word) -> False", keyword._label_tail_boundable("Order No 5") is False)
check("'' -> False", keyword._label_tail_boundable("") is False)
check("None -> False", keyword._label_tail_boundable(None) is False)

# ── 2. the card-4 layout: "Credit No" under a "CREDIT NOTE" heading ──────
# OFF: the label prefix-hits the heading and the below-walk adopts the issuer line (the bug).
# ON:  the tail bound refuses the heading; the real "Credit No: CN-88213" is read.
lines = [
    "CREDIT NOTE",
    "Meadowvale Dairy Wholesale",
    "Credit No: CN-88213",
    "Date: 01/09/2026",
]
print("\n2. card-4 layout (multi-word label vs its own heading):")
setflag("0")
off = find(lines, "Credit No")
check("OFF: byte-identical bug preserved — below-walk yields 'Meadowvale Dairy Wholesale'",
      off is not None and off[0] == "Meadowvale Dairy Wholesale" and off[1] == "below")
setflag("1")
on = find(lines, "Credit No")
check("ON: the real 'Credit No: CN-88213' is read (heading no longer prefix-hit)",
      on is not None and on[0] == "CN-88213")
check("ON: the value is NOT the heading/issuer line", on is not None and "Meadowvale" not in str(on[0]))

# unset behaves as OFF (default OFF; the != idiom trap does NOT apply — explicit == '1')
setflag(None)
unset = find(lines, "Credit No")
check("UNSET == OFF (default OFF, empty is not '1')", unset == off)

# ── 3. Delivery No vs its own DELIVERY NOTE heading ─────────────────────
dlines = [
    "DELIVERY NOTE",
    "Greyburn Plant Services",
    "Delivery No  DN-4471",
]
print("\n3. 'Delivery No' vs its 'DELIVERY NOTE' heading:")
setflag("0")
doff = find(dlines, "Delivery No")
check("OFF: prefix-hits the heading -> below-walk = 'Greyburn Plant Services'",
      doff is not None and doff[0] == "Greyburn Plant Services")
setflag("1")
don = find(dlines, "Delivery No")
check("ON: reads 'DN-4471'", don is not None and don[0] == "DN-4471")

# ── 4. digit-glued value still matches ON (the accepted-loss guard) ─────
print("\n4. digit-glued value still matches ON:")
glued = ["Credit No1234 issued"]
setflag("1")
g = find(glued, "Credit No")
check("ON: 'Credit No1234' still matches (letter-only lookahead)", g is not None and "1234" in str(g[0]))

# ── 5. a single-word label is UNAFFECTED by the switch (helper is False) ─
print("\n5. single-word label unaffected (byte-identical ON vs OFF):")
tlines = ["Total 123.45", "Subtotal 100.00"]
setflag("0")
t_off = find(tlines, "Total")
setflag("1")
t_on = find(tlines, "Total")
check("'Total' reads the same ON and OFF (the switch never touches single-word labels)", t_off == t_on)

# ── 6. currency exclusion: a money label glued to a currency-code value is NOT bounded ──
# The owner's-727 label-hit census found "Total DueGBP 21,778.54" (OCR glued the amount as a currency
# CODE) would be REFUSED by the letter-only lookahead — a real balance lost. The card-4 class is
# REFERENCE labels, never money, so val_type='currency' skips the bound.
print("\n6. currency exclusion (val_type='currency' skips the bound):")
mlines = ["Total DueGBP 21,778.54"]
setflag("1")
m_cur = keyword._search_for_label(mlines, "Total Due", ["right", "below"], val_type="currency")
check("ON + currency: 'Total DueGBP…' still reads the glued amount (bound skipped)",
      m_cur is not None and "21,778.54" in str(m_cur[0]))
m_alnum = keyword._search_for_label(mlines, "Total Due", ["right", "below"], val_type="alphanumeric")
check("ON + non-currency: the same glued line IS refused (letter-glued -> the accepted tradeoff)",
      m_alnum is None)

setflag(None)
print(("\n%d FAILED" % fails) if fails else "\nALL OK")
sys.exit(1 if fails else 0)
