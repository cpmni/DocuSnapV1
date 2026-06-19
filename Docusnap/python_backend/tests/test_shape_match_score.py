#!/usr/bin/env python3
"""
tests/test_shape_match_score.py
-------------------------------
Phase 2 ADDITIVE shape helpers: shape_match_score (1.0/0.8/0.0) and the shape
families view. These must NOT change classify_format / check_value contracts or any
Stage 4.5 decision — only add diagnostic helpers + an additive index key.

    py -3.12 python_backend/tests/test_shape_match_score.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import format_anomaly_checker as fac  # noqa: E402


def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return bool(cond)


def main():
    f = 0
    REF = {"shapes": frozenset({"####-####-#"})}
    MULTI = {"shapes": frozenset({"####-####-#", "@@##"})}

    print("shape_match_score")
    f += not check("exact match -> 1.0", fac.shape_match_score("1234-5678-9", REF) == 1.0)
    f += not check("column-bleed substring -> 0.8",
                   fac.shape_match_score("1234-5678-9 Work Address", REF) == 0.8)
    f += not check("no match -> 0.0", fac.shape_match_score("ABCDEF", REF) == 0.0)
    f += not check("multi-shape: matches second pattern -> 1.0", fac.shape_match_score("AB12", MULTI) == 1.0)
    f += not check("multi-shape: matches first pattern -> 1.0", fac.shape_match_score("1111-2222-3", MULTI) == 1.0)
    f += not check("no learned shapes -> 0.0", fac.shape_match_score("anything", {"shapes": frozenset()}) == 0.0)
    f += not check("empty value -> 0.0", fac.shape_match_score("", REF) == 0.0)

    print("\nshape_families: fold separator-run dups, sum counts, sort, cap")
    fams = fac.shape_families({"1234-5678-9": 3, "1234--5678-9": 2, "12345-678-9": 4})
    by_shape = {fm["shape"]: fm for fm in fams}
    f += not check("'--' folded into the '-' family (count 3+2=5)",
                   by_shape.get("####-####-#", {}).get("count") == 5)
    f += not check("different group-length stays separate (count 4)",
                   by_shape.get("#####-###-#", {}).get("count") == 4)
    f += not check("folded family lists both raw variants",
                   set(by_shape.get("####-####-#", {}).get("variants", [])) == {"####-####-#", "####--####-#"})
    f += not check("sorted by count desc (5 before 4)", fams[0]["count"] == 5)
    cap = fac.shape_families({f"{i:04d}": 3 for i in range(8)} | {f"{i:05d}": 3 for i in range(2)})
    f += not check("families capped at MAX_SHAPE_FAMILIES (6)", len(cap) <= fac.MAX_SHAPE_FAMILIES)
    f += not check("empty value_counts -> []", fac.shape_families({}) == [])

    print("\nadditive index key (no contract change)")
    cf = fac.classify_format(["1234-5678-9", "2345-6789-0", "3456-7890-1"],
                             {"1234-5678-9": 3, "2345-6789-0": 3, "3456-7890-1": 3})
    f += not check("classify_format return keys unchanged (no shape_families/name_lexicon)",
                   set(cf.keys()) == {"class", "separators", "shapes"})
    idx = fac.build_format_class_index([{
        "supplier_name": "", "document_type": "invoice", "field_key": "invoice_number",
        "sample_values": ["1234-5678-9", "2345-6789-0", "3456-7890-1"],
        "value_counts": {"1234-5678-9": 3, "2345-6789-0": 3, "3456-7890-1": 3},
    }])
    entry = idx.get(("", "invoice", "invoice_number"))
    f += not check("index entry still exposes class/separators/shapes",
                   entry and all(k in entry for k in ("class", "separators", "shapes")))
    f += not check("index entry gains additive 'shape_families'", bool(entry and entry.get("shape_families")))

    if f:
        print(f"\n{f} FAILED")
        return 1
    print("\nAll shape-family / shape_match_score checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
