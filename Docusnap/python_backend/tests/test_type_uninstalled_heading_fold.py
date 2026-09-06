#!/usr/bin/env python3
"""
tests/test_type_uninstalled_heading_fold.py — TYPE_UNINSTALLED_HEADING_FOLD (log review Item 4b,
2026-09-05; herald → Oracle SIGN-OFF-W/COND; DARK, mig 122 `type_uninstalled_heading_fold`).

Ironclad statements typed INVOICE @31 (20 docs): a table-cell "Invoice" on line 9 (inside the top
band) earned the strong heading weight while the legible "STATEMENT" scored NOTHING — the shipped
Statement bucket carries no bare name and only INSTALLED names fold. When armed, every shipped-but-
uninstalled bucket's bare name competes as a STRICT standalone TOP-BAND heading only.

Pins:
  1 OFF (default): the exhibit types Invoice — documents the bug, and OFF == today.
  2 ON: the exhibit types Statement, heading=True (the strict 2.0 test), Invoice out-scored.
  3 ON: a MENTION never scores — "VAT statement" on an invoice stays Invoice (no Statement score at all).
  4 ON: a standalone "STATEMENT" DEEP in the body (past the top band) never scores.
  5 ON: an INSTALLED Statement is untouched (the fold is for uninstalled names only — same result as OFF).
  6 ON: a bare name ALREADY in its bucket keeps ordinary scoring (never demoted to heading-only).
  7 ON: known_types=None → no fold (nothing is "uninstalled").
  8 ON: a caption-word segment ("Statement Date") is not a heading.

Usage:  PYTHONIOENCODING=utf-8 py -3.12 python_backend/tests/test_type_uninstalled_heading_fold.py
"""
import copy
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
ROOT = os.path.dirname(os.path.dirname(HERE))

from extraction import keyword  # noqa: E402

fails = 0


def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1


def arm(on):
    if on:
        os.environ["TYPE_UNINSTALLED_HEADING_FOLD"] = "1"
    else:
        os.environ.pop("TYPE_UNINSTALLED_HEADING_FOLD", None)


for k in ("TYPE_UNINSTALLED_HEADING_FOLD",):
    os.environ.pop(k, None)

PATTERNS = json.load(io.open(os.path.join(ROOT, 'config', 'keyword_patterns.json'), encoding='utf-8'))
INSTALLED = ['Invoice', 'Purchase Order', 'Sales Order', 'Delivery Note']     # Statement NOT installed
assert 'Statement' in PATTERNS['document_type_keywords'], 'the shipped Statement bucket must exist'
assert 'statement' not in {p.lower() for p in PATTERNS['document_type_keywords']['Statement']}, \
    'the bug premise: the shipped Statement bucket carries no bare name'


def detect(text, known=INSTALLED, on=False):
    arm(on)
    try:
        return keyword.detect_document_type(text, copy.deepcopy(PATTERNS), known, None)
    finally:
        arm(False)


# the Ironclad shape: letterhead, a legible standalone STATEMENT title, an account block, then a
# line-item table whose first column cell is the word "Invoice" (inside the 15-line top band).
EXHIBIT = "\n".join([
    "Ironclad Supplies Ltd",
    "STATEMENT",
    "Unit 4, Forge Lane, Sheffield",
    "Account: IRN-0042",
    "Statement Date: 31/08/2026",
    "Customer: Beaumont Care Homes",
    "",
    "Date    Type    Reference    Debit    Credit    Balance",
    "01/08/2026    Invoice    INV-1001    120.00        120.00",
    "08/08/2026    Invoice    INV-1007    80.00        200.00",
    "15/08/2026    Payment    PAY-77        150.00    50.00",
    "22/08/2026    Invoice    INV-1019    45.00        95.00",
    "",
    "Balance Due    95.00",
    "Please remit within 30 days.",
])

print("-- 1 OFF == today: the exhibit types Invoice --")
r_off = detect(EXHIBIT, on=False)
check(f"OFF: type == 'Invoice' (got {r_off and r_off.get('type')!r})", r_off is not None and r_off.get("type") == "Invoice")

print("-- 2 ON: the legible STATEMENT wins as the uninstalled name --")
r_on = detect(EXHIBIT, on=True)
check(f"ON: type == 'Statement' (got {r_on and r_on.get('type')!r})", r_on is not None and r_on.get("type") == "Statement")
check("ON: heading=True (the strict standalone test)", bool(r_on and r_on.get("heading")))
check(f"ON: confidence >= 70 so title_trusted can arm downstream (got {r_on and r_on.get('confidence')})",
      bool(r_on and (r_on.get("confidence") or 0) >= 70))

print("-- 3 ON: a mention never scores --")
MENTION = "\n".join([
    "Acme Widgets Ltd",
    "INVOICE",
    "Invoice No: INV-2201",
    "Invoice Date: 12/08/2026",
    "This VAT statement covers the period to 31/08/2026",
    "Bill To: Beaumont Care Homes",
    "Total: 120.00",
])
m_off, m_on = detect(MENTION, on=False), detect(MENTION, on=True)
check("mention: ON == OFF (Invoice)", m_off == m_on and m_on and m_on.get("type") == "Invoice")

print("-- 4 ON: a deep standalone heading never scores --")
DEEP = "\n".join(["Acme Widgets Ltd", "INVOICE", "Invoice No: INV-2201"] + [f"line {i}" for i in range(40)] + ["STATEMENT", "Balance 95.00"])
d_off, d_on = detect(DEEP, on=False), detect(DEEP, on=True)
check("deep heading: ON == OFF (Invoice)", d_off == d_on and d_on and d_on.get("type") == "Invoice")

print("-- 5 ON: an INSTALLED Statement is untouched --")
INST = INSTALLED + ['Statement']
i_off, i_on = detect(EXHIBIT, known=INST, on=False), detect(EXHIBIT, known=INST, on=True)
check("installed Statement: ON == OFF", i_off == i_on)
check("…and it already typed Statement when installed (the owner action 4a)", i_off and i_off.get("type") == "Statement")

print("-- 6 ON: a bare name already in its bucket keeps ordinary scoring --")
P2 = copy.deepcopy(PATTERNS)
P2['document_type_keywords']['Statement'].append('Statement')          # now a scoring phrase (a mention counts)
arm(True)
try:
    r6 = keyword.detect_document_type(MENTION, P2, INSTALLED, None)
finally:
    arm(False)
check("with the bare name already a phrase, the mention still contributes a Statement score (not demoted)",
      r6 is not None and 'Statement' in (r6.get('scores') or {}) if isinstance(r6.get('scores'), dict) else r6 is not None)

print("-- 7 ON: known_types=None → no fold --")
n_off, n_on = detect(EXHIBIT, known=None, on=False), detect(EXHIBIT, known=None, on=True)
check("no type list: ON == OFF", n_off == n_on)

print("-- 8 ON: a caption-word segment is not a heading --")
CAP = "\n".join(["Acme Widgets Ltd", "INVOICE", "Invoice No: INV-2201", "Statement Date 31/08/2026", "Total: 120.00"])
c_off, c_on = detect(CAP, on=False), detect(CAP, on=True)
check("'Statement Date' caption: ON == OFF (Invoice)", c_off == c_on and c_on and c_on.get("type") == "Invoice")

print(f"\n{'FAILED: ' + str(fails) if fails else 'ALL PASS'}")
sys.exit(1 if fails else 0)
