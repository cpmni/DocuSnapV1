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

from extraction.anchor import _recover_clean_token, _matches_learned_shape

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

# ── _matches_learned_shape — the CONFIRMED-shape corroboration that lets a debris-recovered read
# commit CONFIDENT (drop the "please verify" flag). Class-level (length-agnostic digit/letter runs,
# separators kept), matching how the format model stores shapes ('#' = digits, any length). ──
def fmt(shapes):
    return lambda fk: {'shapes': set(shapes)}

print("\n_matches_learned_shape (confident-recovery corroboration):")
check("6-digit value matches learned digit class '#' (drop the flag)",
      _matches_learned_shape("317437", "invoice_number", fmt({'#'})) is True)
check("letter-bearing 'AC431' does NOT match digit class '#' (keep the flag)",
      _matches_learned_shape("AC431", "invoice_number", fmt({'#'})) is False)
check("structured '2602-0768-1' matches learned '####-####-#' (class '#-#-#')",
      _matches_learned_shape("2602-0768-1", "ref", fmt({'####-####-#'})) is True)
check("wrong-structure '260207681' does NOT match '####-####-#' (keep the flag)",
      _matches_learned_shape("260207681", "ref", fmt({'####-####-#'})) is False)
check("no learned shapes → False (keep the flag — conservative)",
      _matches_learned_shape("317437", "invoice_number", fmt(set())) is False)
check("no format_lookup → False", _matches_learned_shape("317437", "invoice_number", None) is False)
check("empty value → False", _matches_learned_shape("", "invoice_number", fmt({'#'})) is False)

# ── _exact_text_corroborates — the born-digital provenance SEAM (Oracle condition #4). A debris-
# recovered read is lifted to auto-file-eligible ONLY when the INDEPENDENT vector text layer carries
# the SAME token on the value's OWN taught row. page_text_lines is None for scanned (same-pixel
# agreement), so this can NEVER fire there — pinning the born-digital-vs-scanned distinction. ──
from extraction.anchor import _exact_text_corroborates
# A born-digital text line: the header row "INVOICE NUMBER 317437" at y≈0.385 (value's taught row).
LINES = [
    {"text": "DELIVERY ADDRESS  INVOICE NUMBER 317437", "y_norm": 0.380, "h_norm": 0.012},
    {"text": "Some other body text here",                "y_norm": 0.520, "h_norm": 0.012},
]
ANCH = {"h_norm": 0.014}   # taught value box height

print("\n_exact_text_corroborates (born-digital provenance seam):")
check("born-digital: token on the value's taught row → corroborated (auto-file eligible)",
      _exact_text_corroborates("317437", ANCH, 0.379, LINES) is True)
check("SCANNED (page_text_lines None) → NOT corroborated (checkpoint stays, capped 87)",
      _exact_text_corroborates("317437", ANCH, 0.379, None) is False)
check("empty page_text_lines → not corroborated",
      _exact_text_corroborates("317437", ANCH, 0.379, []) is False)
check("token present but on a FAR row (off the taught position) → not corroborated",
      _exact_text_corroborates("317437", ANCH, 0.900, LINES) is False)
check("a DIFFERENT value not in the vector text → not corroborated",
      _exact_text_corroborates("999999", ANCH, 0.379, LINES) is False)
check("bounded whole-token only: '31743' (substring of 317437) → not corroborated",
      _exact_text_corroborates("31743", ANCH, 0.379, LINES) is False)
check("None value → not corroborated",
      _exact_text_corroborates(None, ANCH, 0.379, LINES) is False)

print(f"\n{'ALL PASS' if fail == 0 else str(fail) + ' FAILED'}")
sys.exit(1 if fail else 0)
