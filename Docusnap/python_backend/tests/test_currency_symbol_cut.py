"""Pins — the SYMBOL-ONLY currency cut stand-down (owner arc completion 2026-08-11,
kill CURRENCY_SYMBOL_CUT_BENIGN=0).

The customer instinctively draws the teach box around the VISIBLE NUMBER, so on
right-aligned money the edge often cuts only the CURRENCY GLYPH ('£5,016.72' ->
rigid '5,016.72'). The guard's digit-restoring comparator could never verify that
case (no digits to restore) and flagged every such read at <=70 for ever — the
Pelican totals exhibit. The stand-down returns None (rigid commits untouched) ONLY
when two independent tiers agree no digits were lost: the full-res grown re-read
carries exactly the rigid digits AND every absorbed locate-tier cut word carries
no digits beyond them.

Run: py -3.12 python_backend/tests/test_currency_symbol_cut.py
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ['TEMPLATE_ABS_EDGE_GUARD'] = '1'
os.environ['TEMPLATE_CURRENCY_EDGE_GROW'] = '1'
os.environ.pop('CURRENCY_SYMBOL_CUT_BENIGN', None)

from extraction import template_mapper as tm  # noqa: E402

FAILED = []


def check(name, cond):
    print(("PASS  " if cond else "FAIL  ") + name)
    if not cond:
        FAILED.append(name)


class FakePage:
    size = (1000, 1000)

    def crop(self, box):
        return box


PAGE = FakePage()
VAL = {"currency": [r"[0-9][0-9,]*\.[0-9]{2}"]}


def lines_for(word_text):
    w = {"text": word_text, "x_norm": 0.30, "y_norm": 0.20, "w_norm": 0.10, "h_norm": 0.02}
    return [{"text": word_text, "x_norm": 0.30, "y_norm": 0.20, "w_norm": 0.10, "h_norm": 0.02,
             "words": [w]}]


def stub(full_read, partial_read):
    """Crop whose left edge covers the word start reads FULL; a clipped left edge reads PARTIAL."""
    def _s(crop):
        x1, y1, x2, y2 = crop
        if y2 < 150 or y1 > 280:
            return None
        if x1 <= 302:
            return full_read
        if x1 <= 340:
            return partial_read
        return None
    return _s


# The taught box's LEFT edge lands just inside the word (cuts the '£'): word x 0.30-0.40,
# box x 0.312 -> overhang 0.012, intrusion 0.088 (inside-fraction 0.88).
CUT = {"x_norm": 0.312, "y_norm": 0.195, "w_norm": 0.11, "h_norm": 0.03}


def run_guard(abs_text, word_text, full_read):
    lcx = {(id(PAGE), 0.0, 0.0, 1.0, 1.0): lines_for(word_text)}
    return tm._abs_edge_guard(PAGE, CUT, False, 0.0, abs_text, "currency", "total",
                              lambda img: [], stub(full_read, abs_text), VAL,
                              None, None, lcx, None, None, 0)


def main():
    # 1. THE PIN: symbol-only cut -> None (rigid commits untouched: no cap, no note).
    eg = run_guard("5,016.72", "£5,016.72", "£5,016.72")
    check("symbol-only cut (same digits, both well-formed, witness clean) -> None (stand down)",
          eg is None)

    # 2. A genuinely digit-cutting edge whose GROW also failed cannot pass: the absorbed
    #    locate word carries the missing leading digit -> witness inequality -> defer_cap.
    eg = run_guard("0,603.44", "£10,603.44", "£0,603.44")
    check("digit cut with failed grow -> witness refuses (defer_cap, never silent)",
          eg == {"defer_cap": True})

    # 3. The digit-RESTORING heal is untouched: '0,603.44' grows to '£10,603.44'.
    eg = run_guard("0,603.44", "£10,603.44", "£10,603.44")
    check("digit-restoring grow still heals (rewrite/result, not floor)",
          isinstance(eg, dict) and ("rewrite" in eg or "result" in eg))

    # 4. A malformed grown read never stands down (well-formed gate).
    eg = run_guard("5,016.72", "£5,016.72", "£5,0l6.72")
    check("malformed grown read -> no stand-down (defer_cap)", eg == {"defer_cap": True})

    # 6. ORACLE C1 PIN — the serif 1→l channel: a LETTER prefix is ink-correlated across
    #    tiers (the P1/26 class, 5/5 across preps), so digit-only equalities are blind to it.
    #    'l5,016.72' (true £15,016.72) with grown 'l...' and witness 'l...' must NEVER stand
    #    down — the non-alphanumeric prefix class refuses letters.
    eg = run_guard("l5,016.72", "£l5,016.72", "£l5,016.72")
    check("1→l letter prefix -> NEVER benign (defer_cap; the C1 hole pinned closed)",
          eg == {"defer_cap": True})

    # 5. Kill switch restores the old always-flag behaviour.
    os.environ['CURRENCY_SYMBOL_CUT_BENIGN'] = '0'
    eg = run_guard("5,016.72", "£5,016.72", "£5,016.72")
    check("CURRENCY_SYMBOL_CUT_BENIGN=0 -> old behaviour (defer_cap)", eg == {"defer_cap": True})
    os.environ.pop('CURRENCY_SYMBOL_CUT_BENIGN', None)

    print()
    if FAILED:
        print(f"{len(FAILED)} FAILED"); sys.exit(1)
    print("ALL PASS")


main()
