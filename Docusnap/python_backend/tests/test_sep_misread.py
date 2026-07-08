#!/usr/bin/env python3
"""
tests/test_sep_misread.py
-------------------------
Guards the misread-separator recover-and-flag (reggie). A structured ref whose OCR swapped
the DASH for a DOT ("PO-20011" -> "PO.20011") passes the charset AND the (deliberately
separator-folded) shape check, so it would file SILENTLY. `learn_ref_separator` derives the
field's DOMINANT learned separator from RAW value_counts (the fold erases it downstream);
`propose_sep_fix` suggests a fix when a value's separator deviates from it via a KNOWN
confusion (dot<->dash) — while staying INERT on a genuinely MIXED-separator field (the fold's
intent), a dot-native field, and a numeric-family money field.

    py -3.12 python_backend/tests/test_sep_misread.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import format_anomaly_checker as F  # noqa: E402

FAILS = 0


def check(label, cond):
    global FAILS
    if not cond:
        FAILS += 1
    print(f"  {'OK ' if cond else 'BAD'} {label}")


def fmt_for(value_counts):
    """A format_class_index entry built the way the engine builds it, for a po_number history."""
    idx = F.build_format_class_index([{
        "supplier_name": "", "document_type": "invoice", "field_key": "po_number",
        "sample_values": list(value_counts.keys()), "value_counts": value_counts,
        "confirmed_count": sum(value_counts.values()),
    }])
    return idx.get(("", "invoice", "po_number")) or {}


UNIFORM_DASH = {"PO-20011": 4, "PO-20012": 4, "PO-20013": 4}
UNIFORM_DOT  = {"PO.20011": 4, "PO.20012": 4, "PO.20013": 4}
MIXED        = {"AB-126": 5, "AB/126": 5, "AB-127": 4}          # no separator ≥90% dominant
MONEY        = {"1,299.50": 4, "842.30": 4, "2,004.99": 4}      # numeric-family: '.' is a decimal
MULTI_DASH   = {"2605-0769-1": 3, "2605-0770-1": 3, "2605-0771-1": 3}

f_dash, f_dot, f_mix, f_money, f_multi = (fmt_for(x) for x in
                                          (UNIFORM_DASH, UNIFORM_DOT, MIXED, MONEY, MULTI_DASH))

print("learn_ref_separator (dominant separator from raw value_counts):")
check("uniform dash  -> sep_uniform '-'", f_dash.get("sep_uniform") == "-")
check("uniform dot   -> sep_uniform '.'", f_dot.get("sep_uniform") == ".")
check("MIXED seps    -> sep_uniform None (the fold-intent regression guard)", f_mix.get("sep_uniform") is None)
check("numeric money -> sep_uniform None (its '.' is a decimal)", f_money.get("sep_uniform") is None)

print("\npropose_sep_fix (flag a misread separator vs the field's learned one):")
# 1. the reported class: dash field, dotted read -> suggest the dash form.
check("1. dash field, 'PO.20011' -> 'PO-20011'", F.propose_sep_fix("PO.20011", f_dash) == "PO-20011")
check("   multi-run '2605.0769.1' (dash history) -> '2605-0769-1'",
      F.propose_sep_fix("2605.0769.1", f_multi) == "2605-0769-1")
# 2. a correct read is never touched.
check("2. correct 'PO-20011' -> None", F.propose_sep_fix("PO-20011", f_dash) is None)
# 3. a dot-native field reading a dot matches its OWN norm -> no flag.
check("3. dot-native field, 'PO.20011' -> None", F.propose_sep_fix("PO.20011", f_dot) is None)
# 4. a genuinely mixed field is inert (no dominant separator learned).
check("4. mixed field, 'PO.20011' -> None (inert)", F.propose_sep_fix("PO.20011", f_mix) is None)
# 5. a MISSING separator is the shape check's job, not this path.
check("5. missing sep 'PO20011' -> None (left to the shape check)", F.propose_sep_fix("PO20011", f_dash) is None)
# 6. a '/' deviation on a dash field is NOT a known confusion -> no over-firing.
check("6. 'PO/20011' on a dash field -> None (not a known confusion)", F.propose_sep_fix("PO/20011", f_dash) is None)
# money field never suggests (numeric-family excluded upstream).
check("   money '842.30' -> None", F.propose_sep_fix("842.30", f_money) is None)

if FAILS:
    print(f"\n{FAILS} FAILED")
    sys.exit(1)
print("\nAll misread-separator checks passed")
sys.exit(0)
