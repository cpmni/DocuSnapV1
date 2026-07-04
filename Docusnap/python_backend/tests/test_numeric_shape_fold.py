#!/usr/bin/env python3
"""
Numeric shape folding — the fix for two field-format failures both rooted in the
accepted-shape veto encoding EXACT digit-count / thousands-grouping:

  1. A currency total that crosses into the thousands ('4,699.20') in a supplier
     whose confirmed amounts are mostly sub-£1,000 was judged a format anomaly and
     TRUNCATED to its 3-digit tail ('699.20') by extract_accepted_shape.
  2. A 6-digit invoice number ('152567') in a corpus dominated by 5-digit refs was
     judged a format anomaly and WITHHELD ('format' reject), so a wrong keyword read
     that happened to match the corpus shape won instead.

_fold_shape collapses a PURELY-NUMERIC shape to a length- and grouping-invariant
family ('#####'/'######' -> '#'; '###.##'/'#,###.##' -> '#.#'), so all same-class
numbers form ONE family that clears the proportional bar together — no legitimate
amount/reference is an anomaly, and no valid number is ever truncated. Structured
shapes carrying letters or non-numeric separators ('####-####-#') are untouched.

Usage: py -3.12 python_backend/tests/test_numeric_shape_fold.py
Exit 0 = all checks passed.  Exit 1 = failure(s).
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction.format_anomaly_checker import (
    classify_format, check_value, extract_accepted_shape,
    _fold_shape, shape_signature,
)

fails = []
def check(name, cond):
    print(f"  {'OK ' if cond else 'FAIL'} {name}")
    if not cond:
        fails.append(name)


# ── _fold_shape unit behaviour ────────────────────────────────────────────────
print("_fold_shape")
check("'#####' and '######' fold to the same '#'",
      _fold_shape('#####') == '#' and _fold_shape('######') == '#')
check("'###.##' and '#,###.##' fold to the same '#.#'",
      _fold_shape('###.##') == '#.#' and _fold_shape('#,###.##') == '#.#')
check("space-thousands '# ###.##' folds to '#.#'", _fold_shape('# ###.##') == '#.#')
check("structured '####-####-#' is UNCHANGED (separator is meaningful)",
      _fold_shape('####-####-#') == '####-####-#')
check("code '@@##' with letters is UNCHANGED", _fold_shape('@@##') == '@@##')


# ── Scenario 1: currency crossing into thousands is never an anomaly/truncated ─
print("\nScenario 1 — currency, mostly sub-thousand history")
# 76-ish docs, overwhelmingly sub-£1,000, a handful in the thousands.
sub = {f"{i}.{i%100:02d}": 1 for i in range(20, 90)}         # ~70 sub-thousand amounts
sub.update({"1,857.06": 1, "2,318.11": 1, "1,151.84": 2})   # a few thousands amounts
sub_entry = classify_format(list(sub), sub)
check("accepted shape folds to the single money family '#.#'",
      sub_entry.get('shapes') == frozenset({'#.#'}))
check("'4,699.20' is NOT an anomaly", check_value('4,699.20', sub_entry) is None)
check("'2,923.13' is NOT an anomaly", check_value('2,923.13', sub_entry) is None)
check("a sub-thousand '699.20' still passes", check_value('699.20', sub_entry) is None)
# Even a $-carrying read is recovered WHOLE, never truncated to the 3-digit tail.
check("extract_accepted_shape('$4,699.20') recovers '4,699.20', NOT '699.20'",
      extract_accepted_shape('$4,699.20', sub_entry) == '4,699.20')
check("a non-number 'notanumber' is still flagged",
      check_value('notanumber', sub_entry) is not None)


# ── Scenario 2: a longer numeric reference than the corpus norm is accepted ────
print("\nScenario 2 — invoice number, mostly 5-digit history")
inv = {str(40000 + i): 1 for i in range(70)}                # 70 five-digit refs
inv.update({"282184": 1, "282183": 1, "152568": 2})         # a few six-digit refs
inv_entry = classify_format(list(inv), inv)
check("accepted shape folds to the single digit family '#'",
      inv_entry.get('shapes') == frozenset({'#'}))
check("'152567' (6 digits) is NOT an anomaly (was rejected before the fix)",
      check_value('152567', inv_entry) is None)
check("an unseen 7-digit '1234567' is NOT an anomaly either",
      check_value('1234567', inv_entry) is None)
check("a word 'Aurora' on the numeric field is STILL flagged",
      check_value('Aurora', inv_entry) is not None)
# extract_accepted_shape recovers a bleed-wrapped number of any length.
check("bleed '152567 Work Address' recovers '152567'",
      extract_accepted_shape('152567 Work Address', inv_entry) == '152567')


if fails:
    print(f"\n{len(fails)} FAILED"); sys.exit(1)
print("\nAll numeric-shape-fold checks passed.")
