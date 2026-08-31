#!/usr/bin/env python3
"""
tests/test_type_heading_tokens.py
---------------------------------
Parity pin for template_matcher._type_heading_tokens — the Python twin of
database/modules/typePresence.js `typeHeadingTokens`. Both compute the distinctive [a-z0-9]{3,}
tokens of a type NAME (∪ its title aliases) minus TYPE_GENERIC_TOKENS (= namePresence.
GENERIC_NAME_TOKENS ∪ {note, document}). The keyword-path type-presence gate (Slice 1b, process_docs)
and the JS-threaded template-path veto MUST score the IDENTICAL token set — if these drift, a type is
gated on one path and not the other. Vectors are the verbatim output of the JS spec.

    py -3.12 python_backend/tests/test_type_heading_tokens.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction.template_matcher import _type_heading_tokens

CASES = [
    ("Invoice", None, ["invoice"]),
    ("Purchase Order", None, ["purchase", "order"]),
    ("Sales Order", None, ["sales", "order"]),
    ("Delivery Note", None, ["delivery"]),                 # 'note' is a type-generic
    ("Credit Note", None, ["credit"]),
    ("Remittance Advice", None, ["remittance", "advice"]),
    ("Goods Received Note", None, ["goods", "received"]),  # 'note' dropped
    ("Worksheet", None, ["worksheet"]),
    ("Purchase Order", ["Order Confirmation", "PO"],       # 'po' len<3, 2nd 'order' de-duped
     ["purchase", "order", "confirmation"]),
    ("The Document", None, []),                            # both generic
    ("Co Ltd Services", None, []),                         # all corporate generics
    ("", None, []),
    (None, None, []),
]


def main():
    f = 0
    for name, aliases, expected in CASES:
        got = _type_heading_tokens(name, aliases)
        ok = got == expected
        print(f"  {'OK ' if ok else 'BAD'} {name!r} + {aliases!r} -> {got}"
              + ("" if ok else f"   (expected {expected})"))
        if not ok:
            f += 1
    print(f"\n{'ALL PASS' if f == 0 else str(f) + ' FAILED'}")
    sys.exit(1 if f else 0)


main()
