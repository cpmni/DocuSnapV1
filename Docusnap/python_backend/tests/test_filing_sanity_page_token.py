#!/usr/bin/env python3
"""
tests/test_filing_sanity_page_token.py — the Gate-C "doesn't appear on this page as written" note names what the
page ACTUALLY read (owner 2026-08-27: the invoice number 'PI/26/9687' was printed and read correctly by the taught
box, yet the note said it "doesn't appear" — the full-page pass had read 'P1/26/9687', a 1 for the I).

Pins:
  1. _nearest_confusable_page_token finds the one-glyph confusable page token ('P1/26/9687' for 'PI/26/9687'),
     ignores same-text tokens, unrelated tokens and short values, and tolerates surrounding punctuation.
  2. The composed note keeps the shared MARK (three consumers match it as a substring) and adds the page form;
     without a page form the plain constant is used unchanged.

Run:  cd python_backend && py -3.12 tests/test_filing_sanity_page_token.py
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
from extraction import engine as E

fails = 0
def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond: fails += 1

PAGE = ("Invoice Number Date Your PO Account No\n"
        "P1/26/9687    16-07-2026    PO-83204 PO.    04    ACC-2291\n"
        "Payment terms: Due on receipt. Please quote P1/26/9687 on all remittances.")
check("finds the I/1 page form", E._nearest_confusable_page_token(PAGE, "PI/26/9687") == "P1/26/9687")
check("a value the page carries as written yields '' (no false 'page reads it as')", E._nearest_confusable_page_token("ref P1/26/9687 here", "P1/26/9687") == "")
check("an unrelated page yields ''", E._nearest_confusable_page_token("Total 2,535.80 VAT 507.16", "PI/26/9687") == "")
check("two-glyph differences are not offered", E._nearest_confusable_page_token("P1/26/9681", "PI/26/9687") == "")
check("short values are never judged", E._nearest_confusable_page_token("A1 B2", "AI") == "")
check("surrounding punctuation is stripped", E._nearest_confusable_page_token("quote (P1/26/9687).", "PI/26/9687") == "P1/26/9687")
check("O/0 class works too", E._nearest_confusable_page_token("ORD-0O123 xyz", "ORD-00123") == "ORD-0O123")

near = E._nearest_confusable_page_token(PAGE, "PI/26/9687")
note = f"'PI/26/9687' {E._FILING_SANITY_ABSENT_MARK} — the page reads it as '{near}' — please check the reference before filing."
check("the composed note keeps the MARK verbatim", E._FILING_SANITY_ABSENT_MARK in note)
check("…and names the page form", "the page reads it as 'P1/26/9687'" in note)
check("the plain constant is unchanged for the no-page-form case", E._FILING_SANITY_ABSENT_NOTE.format("X-1") == "'X-1' doesn't appear on this page as written — please check the reference before filing.")

print("\nAll checks passed." if not fails else f"\n{fails} check(s) failed.")
sys.exit(1 if fails else 0)
