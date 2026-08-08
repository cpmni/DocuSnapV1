"""ISO date-clip fix (reggie diagnosis, 2026-07-29). keyword._clean_value clips a date value to the
FIRST validation_patterns.date regex that re.search-matches. The DD/MM pattern (formerly first) matched
the tail SUBSTRING of an ISO date — "2026-11-01" -> "26-11-01" -> parsed 26 Nov 2001 (a SILENT wrong
date). Fix (config/keyword_patterns.json): ISO pattern moved FIRST + the DD/MM pattern gained a
`(?<!\\d)` boundary so it can never begin inside a 4-digit year.

Pins the fix against the REAL keyword._clean_value + the shipped config, so a future reorder of
validation_patterns.date (or dropping the lookbehind) re-breaks this test.

Run:  py -3.12 tests/test_iso_date_clip.py   (from python_backend/)
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from extraction import keyword

CFG = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                   "config", "keyword_patterns.json")
VAL = json.load(open(CFG, encoding="utf-8"))["validation_patterns"]

fails = 0


def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1


def clip(v):
    return keyword._clean_value(v, "date", VAL)


print("-- ISO dates clip to the FULL value (no year/day transposition) --")
for iso in ["2026-11-01", "2025-11-03", "2024-07-19"]:
    check(f"{iso!r} -> {iso!r} (full ISO, not the transposed tail)", clip(iso) == iso)
check("labelled 'Date 2026-11-01' still yields the full ISO", clip("Date 2026-11-01") == "2026-11-01")

print("-- DD/MM and month-name formats unchanged --")
check("'13/12/2024' -> '13/12/2024'", clip("13/12/2024") == "13/12/2024")
check("'24-01-2024' -> '24-01-2024'", clip("24-01-2024") == "24-01-2024")
check("'3/6/2026  FREIGHT' -> '3/6/2026' (column-bleed clip still works)", clip("3/6/2026  FREIGHT") == "3/6/2026")
check("'13 Sep 2024' -> '13 Sep 2024'", clip("13 Sep 2024") == "13 Sep 2024")
check("'04/15/2026' (US) -> '04/15/2026' (clip unchanged; validator picks m/d)", clip("04/15/2026") == "04/15/2026")

print("-- the (?<!\\d) boundary: DD/MM can't start inside a longer digit run --")
# an ISO value must never surface a DD/MM substring that begins mid-year
check("no DD/MM substring is returned for an ISO date", clip("2026-11-01") == "2026-11-01")

# ── Oracle C2: BOTH numeric patterns carry (?<!\d)...(?!\d) — no clip inside a longer digit run ──
print("-- C2: ISO/DD-MM can't clip inside a longer digit run (trailing/leading digit) --")
check("'2026-11-011' does NOT clip to '2026-11-01' (trailing digit — held instead)", clip("2026-11-011") != "2026-11-01")
check("'12026-11-01' does NOT clip to '2026-11-01' (leading digit)", clip("12026-11-01") != "2026-11-01")
check("'13/12/20241' does NOT clip to '13/12/2024' (trailing digit)", clip("13/12/20241") != "13/12/2024")

# ── Oracle C5: pin the ACCEPTED TRADE-OFF of the reorder — ISO now wins over a DD/MM neighbour, so a
# future dev can't silently restore DD/MM-first. (A DD/MM date + a bled ISO-shaped token -> ISO.) ──
print("-- C5: reorder trade-off (ISO wins a mixed string) is PINNED as accepted --")
check("'01/11/2026  2024-03-15' -> '2024-03-15' (ISO-first, the accepted mirror-case)",
      clip("01/11/2026  2024-03-15") == "2024-03-15")

print()
if fails:
    print(f"FAILED: {fails} check(s)")
    sys.exit(1)
print("ALL PASS")
