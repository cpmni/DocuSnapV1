#!/usr/bin/env python3
"""
tests/test_namefix_pollution_xfield.py
--------------------------------------
Two reusable name-field fixes:

1. LEXICON POLLUTION MERGE (name_match.build_token_lexicon): confirmed OCR misreads of
   a 3-char business suffix ("Lid" for "Ltd") used to dilute the canonical's doc_freq
   below the 0.9 short-token-repair threshold, so the repair stopped firing. The lexicon
   now folds 3-char single-substitution garbles into the dominant token (canonical surface
   prefers the real suffix), so the repair is robust to confirmed misreads. Scoped to
   3-char alpha tokens so legitimately-varying codes/postcodes never merge.

2. CROSS-FIELD CODE GUARD (anchor._name_field_code_reject): a NAME-LIKE field must never
   accept a reference/code-shaped value (no 3+ letter run) — a merged OCR row can put the
   ticket reference on the "Work Address" line and the relocation would read it into cust.

No Tesseract.
Usage: py -3.12 python_backend/tests/test_namefix_pollution_xfield.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import name_match as nm   # noqa: E402
from extraction import anchor             # noqa: E402

fail = 0


def check(label, cond):
    global fail
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fail += 1


print("1. lexicon pollution merge (Lid -> Ltd robust to confirmed misreads)")
vc = {
    "Beaumont Care Homes Ltd - Comber": 6, "Beaumont Care Homes Ltd - Belmont": 5,
    "Beaumont Care Homes Ltd - Galgorm": 4, "Beaumont Care Homes Ltd - Croagh": 5,
    "Beaumont Care Homes Lid - Parkview": 5, "Beaumont Care Homes Lid - Tennent": 3,
}
lex = nm.build_token_lexicon(vc, confirmed_count=sum(vc.values()))
p3 = lex["positions"].get(3, {})
check("suffix doc_freq >= 0.9 after merge (was 0.71)", p3.get("doc_freq", 0) >= 0.9)
check("canonical surface 'Ltd' (not the misread)", p3.get("surface") == "Ltd")
r = nm.repair_name_value("Beaumont Care Homes Lid - Newsite", lex)
check(f"'Lid' repairs -> {r!r}", r and "Ltd" in r and "Newsite" in r)

print("\n   safety: distinct tokens / codes never merge")
lx2 = nm.build_token_lexicon({"North Region Office": 10, "South Region Office": 9}, confirmed_count=19)
check("North/South not merged (no false stable token)",
      (lx2["positions"].get(0) or {}).get("doc_freq", 0) < 0.9)
lx3 = nm.build_token_lexicon({"AB12 site": 10, "AB13 site": 9}, confirmed_count=19)
check("AB12/AB13 codes not merged", (lx3["positions"].get(0) or {}).get("doc_freq", 0) < 0.9)
# clean corpus unchanged: a single canonical suffix stays canonical
lx4 = nm.build_token_lexicon({"Acme Holdings Ltd": 10}, confirmed_count=10)
check("clean corpus: 'Ltd' still canonical", (lx4["positions"].get(2) or {}).get("surface") == "Ltd")

print("\n2. cross-field code guard (name field rejects a reference-shaped value)")
check("'2602-0926-1 \\\\' rejected for cust (name-like)",
      anchor._name_field_code_reject("2602-0926-1 \\", "cust") is True)
check("'2602-0926-1' rejected for cust", anchor._name_field_code_reject("2602-0926-1", "cust") is True)
check("real name NOT rejected", anchor._name_field_code_reject("Beaumont Care Homes Ltd -", "cust") is False)
check("code KEPT for reference_number (not name-like)",
      anchor._name_field_code_reject("2602-0926-1", "reference_number") is False)
check("empty -> not rejected", anchor._name_field_code_reject("", "cust") is False)

print("\n%s" % ("All pollution-merge + cross-field checks passed." if not fail else f"{fail} FAILED"))
sys.exit(1 if fail else 0)
