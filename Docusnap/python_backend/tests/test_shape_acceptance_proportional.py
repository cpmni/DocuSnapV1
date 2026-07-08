#!/usr/bin/env python3
"""
Anti-poisoning: corpus-size-PROPORTIONAL shape acceptance in classify_format.

A within-class shape is TRUSTED (joins the learned `shapes` set, stops being flagged) only
when it clears the absolute escape (_SHAPE_ACCEPT_ABS) OR both the floor (_SHAPE_ACCEPT_MIN)
AND a fraction (_SHAPE_ACCEPT_RATIO) of the confirmed corpus N. So a couple of bad
confirmations can't poison a large corpus, while a genuine new format still establishes with
proportional support. Identical to the old flat "count >= 3" for corpora up to ~30 docs.

Usage: py -3.12 python_backend/tests/test_shape_acceptance_proportional.py
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction.format_anomaly_checker import (
    classify_format, _SHAPE_ACCEPT_MIN, _SHAPE_ACCEPT_RATIO, _SHAPE_ACCEPT_ABS,
)

fails = []
def check(name, cond):
    print(f"  {'OK ' if cond else 'FAIL'} {name}")
    if not cond: fails.append(name)

def shapes_of(value_counts):
    # values newest-first; dominant digit-shape first so the class sample is digits_only.
    return classify_format(list(value_counts.keys()), value_counts).get('shapes') or frozenset()

print(f"constants: floor={_SHAPE_ACCEPT_MIN} ratio={_SHAPE_ACCEPT_RATIO} abs={_SHAPE_ACCEPT_ABS}")

# The proportional gate operates on the SHAPE families classify_format learns. Pure-numeric
# shapes are FOLDED length-invariant (a number's digit-count/thousands grouping is variable —
# see test_numeric_shape_fold), so poison suppression here is exercised with STRUCTURED shapes
# ('##-####' etc.), where the separator layout is meaningful and a wrong structure IS poison.

# 1) Poison suppressed on a large corpus: 3 of 100 minority '#-#' vs dominant '###-###'.
big = {"100-001": 48, "100-002": 49, "1-2": 1, "3-4": 1, "5-6": 1}   # N=100
s = shapes_of(big)
check("large corpus: dominant '###-###' trusted", "###-###" in s)
check("large corpus: 3-of-100 minority '#-#' SUPPRESSED (poison-resistant)", "#-#" not in s)

# 2) Same absolute count (3), corpus decides: 3 of 10 accepted (small-corpus equivalence).
small = {"100-001": 4, "100-002": 3, "1-2": 1, "3-4": 1, "5-6": 1}    # N=10
s2 = shapes_of(small)
check("small corpus (N=10): 3-of-10 minority '#-#' ACCEPTED (== old flat rule)", "#-#" in s2)

# 3) Cold-start unaffected: 3 of 12 still trusted (thr = max(3, ceil(0.1*12)) = 3).
cold = {"100-001": 3, "100-002": 3, "100-003": 3, "1-2": 1, "3-4": 1, "5-6": 1}   # N=12
check("N=12: minority at count 3 trusted (byte-identical to old behaviour)", "#-#" in shapes_of(cold))

# 4) Legitimate 2nd series kept via the absolute escape: 8 of 100 (8% < ratio, but >= ABS).
two_series = {"100-001": 46, "100-002": 46, "1000-0001": 8}      # N=100, '####-####'=8
s4 = shapes_of(two_series)
check("legit 2nd series '####-####' at 8-of-100 TRUSTED (absolute escape)", "####-####" in s4)
check("...and dominant '###-###' still trusted", "###-###" in s4)

# 5) A 2nd series just below the escape (7 of 100) is NOT yet trusted (flagged, not rejected).
near = {"100-001": 47, "100-002": 46, "10-00000": 7}             # N=100, '##-#####'=7
check("2nd series at 7-of-100 NOT yet trusted (below ABS, below ratio thr=10)",
      "##-#####" not in shapes_of(near))

if fails:
    print(f"\n{len(fails)} FAILED"); sys.exit(1)
print("\nAll proportional shape-acceptance checks passed.")
