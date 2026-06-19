#!/usr/bin/env python3
"""
tests/test_name_match.py
------------------------
Token-level canonical repair: fix garbled KNOWN tokens, keep the variable tail
verbatim, never whole-value snap, never inject a learned token. Includes the
failure-mode guards from the Reggie/gary review.

    py -3.12 python_backend/tests/test_name_match.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction.name_match import build_token_lexicon, repair_name_value  # noqa: E402


def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return bool(cond)


# History: a supplier whose company prefix is constant and whose SITE varies.
HISTORY = {
    "Beaumont Care Homes - Tudordale": 5,
    "Beaumont Care Homes - Holywood": 4,
    "Beaumont Care Homes - Bangor": 3,
}
N = 12


def main():
    f = 0
    lex = build_token_lexicon(HISTORY, N)
    pos = lex["positions"]

    print("lexicon: stable prefix learned, variable site excluded")
    f += not check("position 0 stable = Beaumont", pos.get(0, {}).get("surface") == "Beaumont")
    f += not check("position 1 stable = Care", pos.get(1, {}).get("surface") == "Care")
    f += not check("position 2 stable = Homes", pos.get(2, {}).get("surface") == "Homes")
    f += not check("position 3 (site) NOT stable", 3 not in pos)

    print("\nrepair: garbled prefix fixed, variable tail preserved")
    r = repair_name_value("eeaument care homes - lisburn", lex)
    f += not check(f"'eeaument care homes - lisburn' -> {r!r}", r == "Beaumont Care Homes - lisburn")

    print("\nno whole-value snap / never inject a token")
    f += not check("'Beaumont Care' stays as-is (no 'Homes' injected) -> None",
                   repair_name_value("Beaumont Care", lex) is None)
    r2 = repair_name_value("eeaument care", lex)
    f += not check(f"'eeaument care' -> 'Beaumont Care' (no Homes/site added) = {r2!r}", r2 == "Beaumont Care")

    print("\npositional guard: a site that fuzzy-matches a stable word stays verbatim")
    r3 = repair_name_value("beaumont care homes - holmes", lex)
    f += not check(f"site 'holmes' NOT snapped to 'homes' -> {r3!r}", r3 == "Beaumont Care Homes - holmes")

    print("\nOCR merge/split: no wrong repair (out of Phase-1 scope)")
    r4 = repair_name_value("eeaument carehomes", lex)
    f += not check(f"merged 'carehomes' left verbatim -> {r4!r}", r4 == "Beaumont carehomes")

    print("\nidempotent: repairing an already-canonical value -> None")
    f += not check("repair(repaired) is None", repair_name_value("Beaumont Care Homes - lisburn", lex) is None)

    print("\ndoc-count floor: thin 2-of-3 evidence is NOT stable")
    thin = build_token_lexicon({"Acme Ltd": 2, "Acme Co": 1}, 3)
    f += not check("position 0 'Acme' stable (3 docs)", thin["positions"].get(0, {}).get("surface") == "Acme")
    f += not check("position 1 NOT stable (only 2 docs < floor 3)", 1 not in thin["positions"])
    f += not check("'acme co' keeps 'co' verbatim", repair_name_value("acme co", thin) == "Acme co")

    print("\ndeterminism + empties")
    f += not check("lexicon build is deterministic", build_token_lexicon(HISTORY, N) == lex)
    f += not check("empty lexicon -> no repair", repair_name_value("anything", {"positions": {}, "n_docs": 0}) is None)
    f += not check("empty value -> None", repair_name_value("", lex) is None)

    print("\nintegration: build_format_class_index attaches the lexicon for name fields")
    from extraction.format_anomaly_checker import build_format_class_index
    formats_data = [{
        "supplier_name": "", "document_type": "invoice", "field_key": "supplier_name",
        "sample_values": list(HISTORY.keys()), "value_counts": HISTORY, "confirmed_count": N,
    }]
    idx = build_format_class_index(formats_data)
    entry = idx.get(("", "invoice", "supplier_name"))
    f += not check("name field kept in index (not dropped as freetext)", entry is not None)
    f += not check("name_lexicon attached", bool(entry and entry.get("name_lexicon")))
    f += not check("repair via the attached lexicon works end-to-end",
                   bool(entry) and repair_name_value("eeaument care homes - lisburn",
                                                      entry["name_lexicon"]) == "Beaumont Care Homes - lisburn")
    # A NON-name field never gets a name_lexicon (the only invariant my change adds;
    # whether the entry is kept/dropped is the existing classify_format behaviour).
    fd2 = [{"supplier_name": "", "document_type": "invoice", "field_key": "notes",
            "sample_values": ["a free note", "another note", "third note here"], "value_counts": HISTORY}]
    e2 = build_format_class_index(fd2).get(("", "invoice", "notes"))
    f += not check("non-name field gets NO name_lexicon", not (e2 and e2.get("name_lexicon")))

    if f:
        print(f"\n{f} FAILED")
        return 1
    print("\nAll name_match checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
