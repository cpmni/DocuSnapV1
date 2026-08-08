#!/usr/bin/env python3
"""
tests/test_title_pick.py -- Auto-Title battery (Generic Document design #5/#7 + reggie's
FP catalogue). PINs: EMPTY BEATS JUNK (an all-garble page returns None, never a
low-scoring pick); pick_title is pure/deterministic; the letterhead is never crowned;
`title` is excluded from free-text seeding (Oracle C2, via keyword.seed_field_labels).

Run: cd python_backend && py -3.12 tests/test_title_pick.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from extraction.title_pick import pick_title  # noqa: E402

fails = 0


def check(label, cond, extra=""):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}" + (f"  [{extra}]" if extra and not cond else ""))
    if not cond:
        fails += 1


def T(*lines):
    return "\n".join(lines)


print("#1 the happy paths")
r = pick_title(T("ACME HEATING SERVICES LTD", "12 Furnace Road, Belfast BT1 1AA", "",
                 "BOILER SERVICE CERTIFICATE", "", "Engineer: J Smith", "Date: 15/07/2026"))
check("picks the standalone heading, Title-Cased from caps",
      r and r["title"] == "Boiler Service Certificate", r and r["title"])
r = pick_title(T("Northwood Lettings", "", "Tenancy Agreement", "", "This agreement is made..."))
check("Title Case heading with a TITLE_NOUN", r and r["title"] == "Tenancy Agreement", r and r["title"])
r = pick_title(T("SOMECO", "", "WARRANTY CERTIFICATE No. W-2081", "", "Covered item: dishwasher"))
check("trailing reference code stripped", r and r["title"] == "Warranty Certificate", r and r["title"])
r = pick_title(T("EPC SURVEYS", "", "EPC CERTIFICATE", "", "Rating: C"))
check("<=3-char caps token preserved in display case", r and r["title"] == "EPC Certificate", r and r["title"])

print("#2 the FP catalogue — each classic wrong answer is refused")
r = pick_title(T("ALDER POINT JOINERY LTD", "Unit 4, Mill Lane", "Belfast BT2 3CD", "",
                 "Thank you for your custom."))
check("letterhead + address block => None (company name never crowned)", r is None, r and r["title"])
r = pick_title(T("Page 1 of 2", "", "15/07/2026", "", "Dear Sir,", "please find enclosed..."))
check("page markers / date lines / salutations => None", r is None, r and r["title"])
r = pick_title(T("Title:", "Mr", "", "Surname: Smith"))
check("colon-captions never become the title", r is None, r and r["title"])
r = pick_title(T("Section B", "", "Applicant details"))
check("structural section markers refused", r is None, r and r["title"])
r = pick_title(T("www.example.com  |  tel: 028 9000 0000", "", "info@example.com"))
check("contact chrome refused", r is None, r and r["title"])
sup = pick_title(T("GLENARM ROOFING", "", "GLENARM ROOFING", "", "some body text..."),
                 supplier_name="Glenarm Roofing")
check("supplier-name duplicate refused (token overlap)", sup is None, sup and sup["title"])

print("#3 PIN: empty beats junk")
r = pick_title(T("xqzt vprw kkjq", "", "zzgh wqpx mnvv bbkr", "", "qqq zzz xxx"))
check("all-garble page => None, never a low-scoring pick", r is None, r and r["title"])
r = pick_title("")
check("empty text => None", r is None)
r = pick_title(T("REF: INV-2024-0091", "", "1002 33.50 44.10"))
check("codes/numbers-only page => None", r is None, r and r["title"])

print("#4 purity/determinism + boundaries")
page = T("SOMECO LTD", "", "SERVICE AGREEMENT", "", "body text here")
check("deterministic across calls", (pick_title(page) or {}).get("title") == (pick_title(page) or {}).get("title"))
long_head = "A" * 80
check("over-60-char line refused", pick_title(T(long_head, "", "x")) is None)

print("#5 Oracle C2 — `title` never free-text seeded")
from extraction import keyword  # noqa: E402
seeded = keyword.seed_field_labels(
    {"field_patterns": {}},
    [{"key": "title", "label": "Title", "type": "text", "document_type_id": 1},
     {"key": "customer", "label": "Customer", "type": "text", "document_type_id": 1}])
fp = ((seeded or {}).get("field_patterns")) or {}
check("title absent from seeded patterns", "title" not in fp, sorted(fp.keys()))
check("a normal free-text field still seeds (guard is key-scoped)", "customer" in fp, sorted(fp.keys()))

print(f"\n{'PASS' if not fails else 'FAIL'} -- {fails} failure(s)")
sys.exit(1 if fails else 0)
