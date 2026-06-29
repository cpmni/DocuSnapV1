#!/usr/bin/env python3
"""
tests/test_multiline_continue.py
--------------------------------
Multi-line continuation (Phase 1) — the PURE pieces that decide and assemble a wrapped value:
  * name_match.should_continue_line — trailing-dash + history-guarded predicate
  * anchor.join_continuation        — dash / word-break / plain-wrap join semantics
  * anchor._lines_adjacent          — the geometry guard (don't swallow an unrelated row)
  * anchor._continuation_ok         — post-join validation

    py -3.12 python_backend/tests/test_multiline_continue.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction.name_match import should_continue_line  # noqa: E402
from extraction.text_normalise import normalise_for_tokens  # noqa: E402
from extraction.anchor import join_continuation, _lines_adjacent, _continuation_ok, _x_overlap  # noqa: E402

FAILS = 0
def check(label, cond):
    global FAILS
    if not cond:
        FAILS += 1
    print(f"  {'OK ' if cond else 'BAD'} {label}")


def lexicon(prefix_tokens, expected_len):
    return {"expected_len": expected_len,
            "positions": {i: {"norm": normalise_for_tokens(t)} for i, t in enumerate(prefix_tokens)}}


# History: "Beaumont Care Homes Ltd - <Site>" → 5 content tokens, prefix Beaumont/Care/Homes/Ltd.
LEX5 = lexicon(["Beaumont", "Care", "Homes", "Ltd"], 5)
# A supplier whose value legitimately ends "Ltd -" with NO site → expected_len 4 (the precision case).
LEX4 = lexicon(["Beaumont", "Care", "Homes", "Ltd"], 4)
# History "Stonebridge Joinery" → expected_len 2, stable prefix "Stonebridge".
LEXJOIN = lexicon(["Stonebridge"], 2)

print("should_continue_line:")
check("trailing dash, no history -> continue (cold)", should_continue_line("Beaumont Care Homes Ltd -") is True)
check("trailing en-dash -> continue", should_continue_line("Comber Road –") is True)
check("no dash, no history -> no continue", should_continue_line("Beaumont Care Homes Ltd") is False)
check("trailing dash + history says TRUNCATED -> continue", should_continue_line("Beaumont Care Homes Ltd -", None, LEX5) is True)
check("trailing dash + history says COMPLETE (no-site) -> suppress", should_continue_line("Beaumont Care Homes Ltd -", None, LEX4) is False)
check("complete value, reaches expected_len -> no continue", should_continue_line("Beaumont Care Homes Ltd - Comber", None, LEX5) is False)
check("no dash but data-truncated -> continue", should_continue_line("Stonebridge", None, LEXJOIN) is True)
check("no dash, complete vs history -> no continue", should_continue_line("Stonebridge Joinery", None, LEXJOIN) is False)
check("empty line -> no continue", should_continue_line("") is False)

print("join_continuation:")
check("separator dash keeps ' - '", join_continuation("Beaumont Care Homes Ltd -", "Comber") == "Beaumont Care Homes Ltd - Comber")
check("space-before dash normalised", join_continuation("Beaumont Care Homes Ltd  -  ", "Comber") == "Beaumont Care Homes Ltd - Comber")
check("word-break hyphen de-hyphenates", join_continuation("Indus-", "try") == "Industry")
check("hyphen + uppercase line2 = separator", join_continuation("Ltd-", "Comber") == "Ltd - Comber")
check("plain wrap single space", join_continuation("12 Main Street", "Comber") == "12 Main Street Comber")
check("empty continuation returns line1", join_continuation("Ltd -", "") == "Ltd -")

print("_lines_adjacent (geometry guard):")
L1 = {"left": 100, "top": 100, "width": 220, "height": 20}
check("same column, small gap -> adjacent", _lines_adjacent(L1, {"left": 104, "top": 122, "width": 140, "height": 20}) is True)
check("different column (far right) -> NOT adjacent", _lines_adjacent(L1, {"left": 520, "top": 122, "width": 150, "height": 20}) is False)
check("large vertical gap (new block) -> NOT adjacent", _lines_adjacent(L1, {"left": 104, "top": 210, "width": 140, "height": 20}) is False)
check("x-overlap >=50% counts as same column", _lines_adjacent(L1, {"left": 160, "top": 122, "width": 120, "height": 20}) is True)
check("_x_overlap fraction sane", abs(_x_overlap(L1, {"left": 100, "top": 0, "width": 220, "height": 20}) - 1.0) < 1e-9)

print("_continuation_ok (post-join validation):")
ok = lambda *_: True
no = lambda *_: False
check("longer + verify pass + not-truncated -> ok", _continuation_ok("Beaumont Care Homes Ltd - Comber", "Beaumont Care Homes Ltd -", ok, LEX5) is True)
check("verify fail -> rejected", _continuation_ok("Beaumont Care Homes Ltd - Comber", "Beaumont Care Homes Ltd -", no, LEX5) is False)
check("not longer -> rejected", _continuation_ok("Beaumont Care Homes Ltd -", "Beaumont Care Homes Ltd -", ok, LEX5) is False)
check("runaway length -> rejected", _continuation_ok("Beaumont Care Homes Ltd - A B C D E F G", "Beaumont Care Homes Ltd -", ok, LEX5) is False)
check("no history -> accept on credible+longer", _continuation_ok("12 Main Street Comber", "12 Main Street", ok, None) is True)

print(f"\n{'ALL PASS' if FAILS == 0 else str(FAILS) + ' FAILED'}")
sys.exit(1 if FAILS else 0)
