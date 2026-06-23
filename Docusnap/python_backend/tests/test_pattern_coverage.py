#!/usr/bin/env python3
"""
tests/test_pattern_coverage.py
------------------------------
Match-COVERAGE credibility (anchor._pattern_coverage / _crop_is_credible): a typed
value must match MOST of its validation pattern, so a clean-but-wrong value the
pattern only matches on a sub-run (a colon-laden MAC) is rejected instead of
committing on a substring hit. Free-text / date / currency are unaffected.

    py -3.12 python_backend/tests/test_pattern_coverage.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction.anchor import _pattern_coverage, _crop_is_credible, _CREDIBLE_COVERAGE_MIN  # noqa: E402

FAILS = 0


def check(label, cond):
    global FAILS
    if not cond:
        FAILS += 1
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return bool(cond)


cfg = json.loads((Path(__file__).parent.parent.parent / "config" / "keyword_patterns.json").read_text(encoding="utf-8"))
VP = cfg["validation_patterns"]
alnum = VP["alphanumeric"] if isinstance(VP["alphanumeric"], list) else [VP["alphanumeric"]]

print(f"_pattern_coverage (threshold {_CREDIBLE_COVERAGE_MIN}):")
check("clean serial -> 1.0", _pattern_coverage("H7R5326676", alnum) == 1.0)
check("clean ref -> 1.0", _pattern_coverage("2602-0926-1", alnum) == 1.0)
mac = _pattern_coverage("D4:F0:0C9:29:9B:04", alnum)
check(f"MAC coverage low ({mac:.2f} < 0.5)", mac < 0.5)
check("empty -> 0.0", _pattern_coverage("", alnum) == 0.0)

print("_crop_is_credible (alphanumeric):")
check("serial H7R5326676 credible", _crop_is_credible("H7R5326676", "alphanumeric", VP))
check("ref 2602-0926-1 credible", _crop_is_credible("2602-0926-1", "alphanumeric", VP))
check("INV-001 credible", _crop_is_credible("INV-001", "alphanumeric", VP))
check("PO/2024/55 credible", _crop_is_credible("PO/2024/55", "alphanumeric", VP))
check("SO12345 credible", _crop_is_credible("SO12345", "alphanumeric", VP))
check("MAC NOT credible (the bug)", not _crop_is_credible("D4:F0:0C9:29:9B:04", "alphanumeric", VP))
check("one-stray-colon ref reviews (not credible)", not _crop_is_credible("2602:0926-1", "alphanumeric", VP))

print("scope guard — free-text / date / currency UNAFFECTED:")
check("free-text name credible (no val_type)", _crop_is_credible("Beaumont Care Homes Ltd", None, VP))
check("free-text multiline credible", _crop_is_credible("91 Galgorm Road", "multiline_text", VP))
check("clean date credible (substring path kept)", _crop_is_credible("27-05-2026", "date", VP))

print(f"\n{'ALL PASS' if FAILS == 0 else str(FAILS) + ' FAILED'}")
sys.exit(1 if FAILS else 0)
