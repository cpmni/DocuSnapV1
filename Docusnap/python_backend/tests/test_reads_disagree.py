#!/usr/bin/env python3
"""Pin _reads_disagree (anchor cross-check): a format-only DATE difference is NOT a disagreement,
even when the field's val_type didn't resolve to 'date' at the call site — the "needless cross-check
flag on a format-only date difference" fix (04/06/2026 vs 04-06-2026). Kill switch OFF => legacy.

    py -3.12 python_backend/tests/test_reads_disagree.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from extraction.anchor import _reads_disagree   # noqa: E402

fails = 0


def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1


# val_type == 'date' (behaviour unchanged)
check("date field, format-only diff -> AGREE", _reads_disagree("04/06/2026", "04-06-2026", "date") is False)
check("date field, genuinely different dates -> DISAGREE", _reads_disagree("04/06/2026", "05/06/2026", "date") is True)
check("date field, one read unparseable -> AGREE (never flag)", _reads_disagree("04/06/2026", "garbled", "date") is False)

# val_type NOT 'date' -- THE FIX: both parse as dates => compare the calendar dates, not the strings
check("val_type None, format-only date diff -> AGREE (FIX)", _reads_disagree("04/06/2026", "04-06-2026", None) is False)
check("val_type None, dotted vs slashed same date -> AGREE (FIX)", _reads_disagree("04.06.2026", "04/06/2026", None) is False)
check("val_type None, different dates -> DISAGREE", _reads_disagree("04/06/2026", "05/06/2026", None) is True)
check("val_type None, non-date strings -> string compare (unchanged)", _reads_disagree("ABC-1", "ABC-2", None) is True)
check("val_type None, case-only diff -> AGREE (unchanged)", _reads_disagree("Acme Ltd", "acme ltd", None) is False)
check("val_type None, one date one not -> string compare -> DISAGREE", _reads_disagree("04/06/2026", "hello", None) is True)

# OFF => byte-identical (legacy string compare for a non-date val_type)
os.environ["DATE_AWARE_CROSSCHECK"] = "0"
check("OFF: val_type None, format-only date diff -> DISAGREE (legacy string compare)",
      _reads_disagree("04/06/2026", "04-06-2026", None) is True)
check("OFF: date field still date-aware", _reads_disagree("04/06/2026", "04-06-2026", "date") is False)
del os.environ["DATE_AWARE_CROSSCHECK"]

print("\n" + ("ALL PASS" if fails == 0 else f"{fails} FAILED"))
sys.exit(1 if fails else 0)
