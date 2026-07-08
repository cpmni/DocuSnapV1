#!/usr/bin/env python3.12
# Stage 1: the KEYWORD currency path must rejoin an OCR-split thousands separator
# ("$15 707.84" -> "$15,707.84") BEFORE the contiguous currency pattern truncates it to
# "$15". Previously only anchor.py's crop/inline paths did this, so the two paths drifted
# and a labelled total read via keyword lost everything past the space.
# Run: py -3.12 python_backend/tests/test_keyword_currency_rejoin.py
import os, sys
# abspath so the inserted path has no unresolved '..' — keyword.load_patterns() walks
# __file__ parents to find config/, and an unresolved '..' in the import path breaks it.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from extraction import keyword, number_format

fail = 0
def check(label, cond):
    global fail
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fail += 1

# Function-level (shared helper, now in number_format): the rejoin itself.
check("helper rejoins '$15 707.84'", number_format.normalise_currency_spacing("$15 707.84") == "$15,707.84")
check("helper leaves contiguous value", number_format.normalise_currency_spacing("$109.13") == "$109.13")

# Integration: the real shipped config through keyword.extract_fields.
patterns = keyword.load_patterns()
res = keyword.extract_fields("SuperStore\nTotal: $15 707.84\n", ["total_amount"], patterns)
val = (res.get("total_amount") or {}).get("value")
check(f"keyword total NOT truncated at the space (got {val!r})",
      val is not None and "707" in str(val) and str(val) not in ("$15", "15"))

res2 = keyword.extract_fields("Total: $109.13\n", ["total_amount"], patterns)
val2 = (res2.get("total_amount") or {}).get("value")
check(f"contiguous total unchanged (got {val2!r})", val2 is not None and "109" in str(val2))

print("\n" + ("FAILED" if fail else "All keyword currency-rejoin checks passed."))
sys.exit(1 if fail else 0)
