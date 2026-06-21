#!/usr/bin/env python3
"""
tests/test_value_quality.py
---------------------------
name_quality must separate REAL names/companies from OCR garbage/fragments for
name-like fields, WITHOUT a dictionary dependency and WITHOUT false-rejecting
legitimate proper nouns. Threshold for "plausible" is 0.5 (see keyword.py).

    py -3.12 python_backend/tests/test_value_quality.py
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import value_quality as vq  # noqa: E402

T = 0.5  # plausibility threshold the pipeline uses


def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return bool(cond)


# (value, should_be_good_name)
CASES = [
    ("City Office NI",            True),
    ("Polychemtex Inc",          True),
    ("Beaumont Care Homes Ltd",  True),
    ("Greenfield Packaging Co",  True),
    ("Acme Limited",             True),
    ("Boucher Holdings",         True),
    ("Tudordale Services",       True),
    # garbage / fragments — must score below threshold
    ("Fr eanehae Crane",         False),
    ("67 Boucher Cre",           False),
    ("St OMe WM cenant",         False),
    ("br boucherc rescent",      False),
]


def main():
    f = 0
    print("name_quality: real names score high, OCR garbage scores low")
    for val, good in CASES:
        q = vq.name_quality(val)
        ok = (q >= T) if good else (q < T)
        f += not check(f"{'GOOD' if good else 'BAD '} q={q:.2f}  {val!r}", ok)

    print("\nis_name_like_field")
    f += not check("supplier_name is name-like", vq.is_name_like_field("supplier_name", "Supplier Name"))
    f += not check("customer is name-like", vq.is_name_like_field("customer", "Customer"))
    f += not check("address is name-like", vq.is_name_like_field("work_address", "Work Address"))
    f += not check("invoice_number is NOT name-like", not vq.is_name_like_field("invoice_number", "Invoice No"))
    f += not check("total_amount is NOT name-like", not vq.is_name_like_field("total_amount", "Total"))

    print("\nstrip_name_edges: drop leading non-alnum + trailing junk, keep interior/allowed")
    TEXT = "-'&(),."   # config field_charsets 'text' allowed_extra
    EDGE = [
        # (value, allowed_extra, expected)
        ("--« Beaumont Care Homes Ltd -", TEXT, "Beaumont Care Homes Ltd -"),  # leading OCR junk; keep trailing '-'
        ("Beaumont Care Homes Ltd - Jordanstown", TEXT, "Beaumont Care Homes Ltd - Jordanstown"),  # clean unchanged
        ("Acme Inc.", TEXT, "Acme Inc."),               # trailing '.' is allowed → kept
        ("  Beaumont  ", TEXT, "Beaumont"),             # edge whitespace
        ("Smith & Jones", TEXT, "Smith & Jones"),       # internal '&' preserved
        ("Beaumont Ltd «", TEXT, "Beaumont Ltd"),  # trailing disallowed '«' stripped
        ("«»--", TEXT, "«»--"),     # all-junk → unchanged (over-strip guard)
        ("", TEXT, ""),                                  # empty
    ]
    for val, spec, exp in EDGE:
        got = vq.strip_name_edges(val, spec)
        f += not check(f"{val!r} -> {got!r}", got == exp)

    if f:
        print(f"\n{f} check(s) failed — name_quality classification is off.")
        return 1
    print("\nAll checks passed — name_quality separates real names from OCR garbage.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
