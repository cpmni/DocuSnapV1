#!/usr/bin/env python3
"""
tests/test_candidate_resolver.py
--------------------------------
Phase 3 gated post-merge candidate resolver (engine._resolve_candidates).
Default OFF = no change; suggest = corrected_to only; auto = value only for opted-in
field types. Protected winners (authoritative / Stage 0.5 located / keyword_override)
are never changed; defers to a pre-existing note. Deterministic + idempotent.

    py -3.12 python_backend/tests/test_candidate_resolver.py
"""
import copy
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction.engine import ExtractionEngine  # noqa: E402

SHAPED = {("", "invoice", "invoice_number"): {"class": "alphanum_sep",
                                              "shapes": frozenset({"####-####-#"})}}
NUM_DEFS = [{"key": "invoice_number", "type": "alphanumeric"}]
NAME_DEFS = [{"key": "supplier_name", "type": "text"}]


def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return bool(cond)


def _engine(mode, fields=None, fmt_index=None, ledger=None):
    e = ExtractionEngine(mode="fast", config_path=None)
    e.set_candidate_override(mode, fields)
    e.format_class_index = fmt_index or {}
    e._field_candidates = ledger or {}
    return e


def _shaped_case(mode, fields=None, incumbent=None):
    e = _engine(mode, fields, SHAPED,
                {"invoice_number": [{"value": "7602-1354-4", "method": "anchor_crop",
                                     "confidence": 80, "authoritative": False, "located": False}]})
    results = {"invoice_number": incumbent or {"value": "Booking", "method": "keyword", "confidence": 90}}
    e._resolve_candidates(results, NUM_DEFS, "", "invoice")
    return results["invoice_number"]


def main():
    f = 0

    print("default OFF -> no change")
    before = {"invoice_number": {"value": "Booking", "method": "keyword", "confidence": 90}}
    after = copy.deepcopy(before)
    _engine("off", fmt_index=SHAPED,
            ledger={"invoice_number": [{"value": "7602-1354-4", "method": "anchor_crop",
                                        "confidence": 80, "authoritative": False, "located": False}]}
            )._resolve_candidates(after, NUM_DEFS, "", "invoice")
    f += not check("off mode leaves results byte-identical", after == before)

    print("\nsuggest: shape-matching challenger -> corrected_to only (value unchanged)")
    r = _shaped_case("suggest")
    f += not check("value NOT replaced", r["value"] == "Booking")
    f += not check("corrected_to set to the shape-matching candidate", r.get("corrected_to") == "7602-1354-4")
    f += not check("confidence capped <=70", (r.get("confidence") or 0) <= 70)

    print("\nauto + opted-in field type -> value replaced + overridden flag")
    r = _shaped_case("auto", ["alphanumeric"])
    f += not check("value replaced", r["value"] == "7602-1354-4")
    f += not check("overridden flag set", r.get("overridden") is True)

    print("\nauto but field type NOT opted-in -> suggest-only")
    r = _shaped_case("auto", ["serial"])
    f += not check("value NOT replaced (not opted-in)", r["value"] == "Booking")
    f += not check("corrected_to set instead", r.get("corrected_to") == "7602-1354-4")

    print("\nprotected winners are never changed (suggest mode, strong challenger present)")
    f += not check("authoritative incumbent untouched",
                   _shaped_case("suggest", incumbent={"value": "Booking", "method": "anchor_crop",
                                                      "confidence": 90, "authoritative": True}).get("corrected_to") is None)
    f += not check("Stage 0.5 located mapping incumbent untouched",
                   _shaped_case("suggest", incumbent={"value": "Booking", "method": "template_mapping",
                                                      "confidence": 90}).get("corrected_to") is None)
    f += not check("keyword_override (admin label) incumbent untouched",
                   _shaped_case("suggest", incumbent={"value": "Booking", "method": "keyword_override",
                                                      "confidence": 90}).get("corrected_to") is None)

    print("\ndefer if a note / corrected_to already exists (one note per field)")
    f += not check("pre-existing validation_note -> deferred",
                   _shaped_case("suggest", incumbent={"value": "Booking", "method": "keyword",
                                                      "confidence": 90, "validation_note": "x"}).get("corrected_to") is None)

    print("\nno override when incumbent already credible / challenger weak")
    f += not check("incumbent already shape-matches -> no change",
                   _shaped_case("suggest", incumbent={"value": "1111-2222-3", "method": "keyword",
                                                      "confidence": 90}).get("corrected_to") is None)
    weak = _engine("suggest", fmt_index=SHAPED,
                   ledger={"invoice_number": [{"value": "also junk", "method": "anchor_crop",
                                               "confidence": 80, "authoritative": False, "located": False}]})
    rj = {"invoice_number": {"value": "Booking", "method": "keyword", "confidence": 90}}
    weak._resolve_candidates(rj, NUM_DEFS, "", "invoice")
    f += not check("non-shape-matching challenger -> no override", rj["invoice_number"].get("corrected_to") is None)

    print("\nname-like field: low-quality incumbent + high-quality challenger")
    e = _engine("suggest", fmt_index={},
                ledger={"supplier_name": [{"value": "City Office NI", "method": "hint",
                                           "confidence": 70, "authoritative": False, "located": False}]})
    rn = {"supplier_name": {"value": "67 Boucher Cre", "method": "anchor_crop", "confidence": 50}}
    e._resolve_candidates(rn, NAME_DEFS, "", "invoice")
    f += not check("name corrected_to the higher-quality candidate", rn["supplier_name"].get("corrected_to") == "City Office NI")
    f += not check("name value NOT replaced (suggest)", rn["supplier_name"]["value"] == "67 Boucher Cre")

    print("\ndeterminism / idempotency")
    a = _shaped_case("suggest"); b = _shaped_case("suggest")
    f += not check("same input -> same corrected_to", a.get("corrected_to") == b.get("corrected_to"))
    # second pass over an already-suggested result is a no-op (note present -> deferred)
    e2 = _engine("suggest", fmt_index=SHAPED,
                 ledger={"invoice_number": [{"value": "7602-1354-4", "method": "anchor_crop",
                                             "confidence": 80, "authoritative": False, "located": False}]})
    r2 = {"invoice_number": {"value": "Booking", "method": "keyword", "confidence": 90}}
    e2._resolve_candidates(r2, NUM_DEFS, "", "invoice")
    snap = copy.deepcopy(r2)
    e2._resolve_candidates(r2, NUM_DEFS, "", "invoice")
    f += not check("second resolver pass is a no-op", r2 == snap)

    print("\nledger not built when override is off (zero overhead/behaviour)")
    eoff = ExtractionEngine(mode="fast", config_path=None)
    eoff._field_candidates = {}
    eoff._remember_candidates("1_keyword", {"invoice_number": {"value": "X", "method": "keyword", "confidence": 90}})
    f += not check("_remember_candidates is a no-op when off", eoff._field_candidates == {})

    if f:
        print(f"\n{f} FAILED")
        return 1
    print("\nAll candidate-resolver checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
