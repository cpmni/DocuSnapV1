#!/usr/bin/env python3
"""
tests/test_recover_clean_token.py — guards anchor._recover_clean_token, the precision-first
OCR clip-debris recovery (reggie-designed). A clean single token wrapped in SHORT punctuation
debris (". = 317437" / "-R 317437") is recovered to the clean token; a bare-alnum prefix
("2 317437"), a real word ("Total:"), and a multi-value drift ("Total 250.00 317437") are REFUSED
(routed to review). Recovery is committed FLAGGED by the caller, never silently.

Run:  py -3.12 python_backend/tests/test_recover_clean_token.py
"""
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

fail = 0
def check(label, cond):
    global fail
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fail += 1

from extraction.anchor import _recover_clean_token

# The shipped alphanumeric validation pattern (single-token code, no internal whitespace).
VP = {"alphanumeric": [r"[A-Za-z0-9][A-Za-z0-9\-\/\.]{2,20}"],
      "reference_code": [r"^(?=[A-Za-z0-9][A-Za-z0-9\-/.]*\d)[A-Za-z0-9][A-Za-z0-9\-/.]{2,20}$"]}

print("recover (→ clean token):")
check('". = 317437" → 317437',  _recover_clean_token(". = 317437", "alphanumeric", VP) == "317437")
check('"-R 317437" → 317437',   _recover_clean_token("-R 317437", "alphanumeric", VP) == "317437")
check('"# 317437" → 317437',    _recover_clean_token("# 317437", "alphanumeric", VP) == "317437")
check('"317437 ." → 317437 (trailing debris)', _recover_clean_token("317437 .", "alphanumeric", VP) == "317437")

print("refuse (→ None → review):")
check('"2 317437" refused (bare-digit prefix)',        _recover_clean_token("2 317437", "alphanumeric", VP) is None)
check('"R 317437" refused (bare-alnum fragment)',      _recover_clean_token("R 317437", "alphanumeric", VP) is None)
check('"Total: 317437" refused (real word debris)',    _recover_clean_token("Total: 317437", "alphanumeric", VP) is None)
check('"Total 250.00 317437" refused (multi-value)',   _recover_clean_token("Total 250.00 317437", "alphanumeric", VP) is None)
check('"INV 2024 000123" refused (3 value tokens)',    _recover_clean_token("INV 2024 000123", "alphanumeric", VP) is None)

print("scope (only recoverable types; clean/empty untouched):")
check('clean "317437" → None (single token, judged by credibility not here)', _recover_clean_token("317437", "alphanumeric", VP) is None)
check('free-text type → None',      _recover_clean_token(". = 317437", "text", VP) is None)
check('date type → None',           _recover_clean_token("3 Aug 2012", "date", VP) is None)
check('None type → None',           _recover_clean_token(". = 317437", None, VP) is None)
check('empty → None',               _recover_clean_token("", "alphanumeric", VP) is None)
check('reference_code recovers too', _recover_clean_token(". = INV-9", "reference_code", VP) == "INV-9")

print(f"\n{'ALL PASS' if fail == 0 else str(fail) + ' FAILED'}")
sys.exit(1 if fail else 0)
