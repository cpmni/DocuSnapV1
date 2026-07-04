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
check("a SINGLE running-number group folds behind a letter prefix ('@@##' -> '@@#')",
      _fold_shape('@@##') == '@@#')
check("'INV###'/'INV####' fold to one family ('@@@###' -> '@@@#')",
      _fold_shape('@@@###') == '@@@#' and _fold_shape('@@@####') == '@@@#')
check("a MULTI-group ref keeps exact structure ('####-####-#' unchanged)",
      _fold_shape('####-####-#') == '####-####-#')


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


# ── MAGNITUDE / SIGN preservation: extract_accepted_shape must NEVER corrupt a number ──
# The folded numeric-family regex must not let a space span the gap between two amounts, nor
# strip a leading sign — both silently write a WRONG number (found pressure-testing the fold).
print("\nmagnitude/sign preservation (extract_accepted_shape never corrupts an amount)")
amt = {f"{i}.{i % 100:02d}": 1 for i in range(20, 90)}          # money field, shapes == {'#.#'}
amt_entry = classify_format(list(amt), amt)
check("two amounts on one line are NOT merged ('12.50 34.00' -> '12.50', not '12.50 34')",
      extract_accepted_shape('12.50 34.00', amt_entry) == '12.50')
check("a wider space still isn't spanned ('12.50  34.00' -> '12.50')",
      extract_accepted_shape('12.50  34.00', amt_entry) == '12.50')
check("a NEGATIVE amount keeps its sign ('-84.40' stays '-84.40', never '84.40')",
      extract_accepted_shape('-84.40', amt_entry) == '-84.40')
check("a negative thousands amount keeps sign+grouping ('-1,234.56')",
      extract_accepted_shape('-1,234.56', amt_entry) == '-1,234.56')
check("a genuine thousands-grouped amount is accepted, not trimmed ('1 234.56' -> None)",
      extract_accepted_shape('1 234.56', amt_entry) is None)
check("trailing word junk is still trimmed ('84.40 credit' -> '84.40')",
      extract_accepted_shape('84.40 credit', amt_entry) == '84.40')


# ── #3 CONTINUING-CODE guard: extract_accepted_shape must not TRUNCATE a value that continues
#      as valid code past the match (a ref separator + more alnum), only genuine word/space bleed.
print("\n#3 no truncation of a continuing code (separator + more alnum)")
multi = {"shapes": frozenset({"#", "####-####-#"})}   # a field with BOTH a short + a long shape
check("'5678-1234' NOT truncated to '5678' (code continues past the match)",
      extract_accepted_shape("5678-1234", multi) is None)
check("but genuine bleed still trims ('2605-0769-1 Work Address' -> '2605-0769-1')",
      extract_accepted_shape("2605-0769-1 Work Address", {"shapes": frozenset({"####-####-#"})})
      == "2605-0769-1")


# ── #4 INTERCHANGEABLE ref separators: '-' '/' '.' fold to one family (shape AND charset), so a
#      supplier writing "AB-126" and "AB/126" isn't flagged; group STRUCTURE is still enforced.
print("\n#4 interchangeable ref separators (-, /, .)")
check("'@@-###' and '@@/###' fold to the same family",
      _fold_shape('@@-###') == _fold_shape('@@/###'))
ab_slash = {f"AB/{100 + i}": 1 for i in range(12)}
check("'AB-126' NOT flagged against an 'AB/###' corpus (separator interchange)",
      check_value('AB-126', classify_format(list(ab_slash), ab_slash)) is None)
ref_dash = {f"{1000 + i}-{2000 + i}-{i % 9}": 1 for i in range(12)}   # ####-####-#
check("a DIFFERENT structure is STILL caught ('9999-9999' missing its 3rd group)",
      check_value('9999-9999', classify_format(list(ref_dash), ref_dash)) is not None)


if fails:
    print(f"\n{len(fails)} FAILED"); sys.exit(1)
print("\nAll numeric-shape-fold checks passed.")
