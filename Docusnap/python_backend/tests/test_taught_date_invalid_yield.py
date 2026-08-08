"""Pins for TEMPLATE_DATE_INVALID_YIELD (impossible-date yield) + TEMPLATE_DATE_FUTURE_YIELD
(deterministically-future-date yield) — the engine kw-merge date-precedence fixes (Oracle
SIGN-OFF-W/COND 2026-08-06). A Stage-0.5-located taught DATE that OCR-misread into an IMPOSSIBLE
value ('33/04/2026') OR an ABSURDLY-FUTURE valid value ('15/10/2096' — a glyph year-misread of
'15/10/2026') used to WIN the merge on authority over a valid, confident keyword date. The predicate
now returns a REASON ('' / 'impossible' / 'future'); the merge branch arms each reason on its OWN
switch and yields to the keyword read FLAGGED to Review (the note is the sole auto-file block).

Run: py -3.12 python_backend/tests/test_taught_date_invalid_yield.py
"""
import inspect
import os
from datetime import datetime, timedelta
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.pop('TEMPLATE_DATE_INVALID_YIELD', None)
os.environ.pop('TEMPLATE_DATE_FUTURE_YIELD', None)
import extraction.engine as E

FAILED = []


def check(name, cond):
    print(("PASS  " if cond else "FAIL  ") + name)
    if not cond:
        FAILED.append(name)


check("both switches default OFF",
      E.TEMPLATE_DATE_INVALID_YIELD is False and E.TEMPLATE_DATE_FUTURE_YIELD is False)

Y = E._invalid_taught_date_yields
NOW = datetime(2026, 10, 15)                      # injected reference so the future pins are date-stable
TOL = E.validator._FUTURE_DATE_TOLERANCE_DAYS     # 366 (kw-side guard)
YLD = E._DATE_YIELD_FUTURE_DAYS                   # 1096 (taught-side yield trigger)
def d(days):                                      # a DD/MM/YYYY string `days` from NOW
    return (NOW + timedelta(days=days)).strftime('%d/%m/%Y')

# ── the REASON discriminator ('' / 'impossible' / 'future') ───────────────────
check("reason domain: return in {'', 'impossible', 'future'}",
      Y('33/04/2026', '03/04/2026', NOW) in ('', 'impossible', 'future'))
# (a) IMPOSSIBLE arm — byte-identical to shipped 11aa400 (Oracle C5)
check("impossible taught '33/04/2026' + valid kw -> 'impossible'", Y('33/04/2026', '03/04/2026', NOW) == 'impossible')
check("whole impossible family: '31/02/2026' -> 'impossible'", Y('31/02/2026', '01/03/2026', NOW) == 'impossible')
check("VALID non-future taught -> '' (authority preserved)", Y('15-07-2026', '03/04/2026', NOW) == '')
check("kw NOT a valid date ('March') -> ''", Y('33/04/2026', 'March', NOW) == '')
check("both invalid -> ''", Y('33/04/2026', '44/44/4444', NOW) == '')
check("spaced VALID taught -> '' (salvage recovers; reggie)", Y('03 / 04 / 2026', '08/04/2026', NOW) == '')
check("junk-suffixed VALID taught -> '' (salvage recovers)", Y('03/04/2026x', '08/04/2026', NOW) == '')
check("empty taught -> ''", Y('', '03/04/2026', NOW) == '')
# (b) FUTURE arm
check("far-future taught (15/10/2096) + non-future kw -> 'future' (the invoice_14 case)",
      Y('15/10/2096', '15/10/2026', NOW) == 'future')
check("PINNED TRADE-OFF: within-tolerance future taught (now+100d) -> '' (authority preserved)",
      Y(d(100), d(0), NOW) == '')
check("band 367..1096 (now+400d) taught -> '' (flagged by Stage-4 @40, NOT swapped)",
      Y(d(400), d(0), NOW) == '')
check("far-future taught + FAR-future kw -> '' (no future->future swap; kw-guard)",
      Y(d(YLD + 400), d(TOL + 400), NOW) == '')
check("far-future taught + kw not a date -> ''", Y('15/10/2096', 'March', NOW) == '')

# ── source pins on the merge branch (Oracle conditions + C4/C6) ───────────────
src = Path(E.__file__).read_text(encoding='utf-8')
i_branch = src.find('if ((TEMPLATE_DATE_INVALID_YIELD or TEMPLATE_DATE_FUTURE_YIELD)')
i_kwdef = src.find('_kw_ok = (data.get("method") in ("keyword", "keyword_override")')
i_blind = src.find('if (_blind_reg and _kw_ok')
check("branch present, gated on the switch GROUP as FIRST conjunct + date key + _kw_ok", i_branch != -1)
check("placed AFTER _kw_ok is defined and BEFORE the _blind_reg swap (Oracle C2)",
      i_kwdef != -1 and i_blind != -1 and i_kwdef < i_branch < i_blind)
_slice = src[i_branch:i_blind]
check("arms 'impossible' ONLY under INVALID switch and 'future' ONLY under FUTURE switch (C4)",
      "_reason == 'impossible' and TEMPLATE_DATE_INVALID_YIELD" in _slice
      and "_reason == 'future' and TEMPLATE_DATE_FUTURE_YIELD" in _slice)
check("note is accurate per reason (both phrasings present, keyed on _reason)",
      "isn't a valid calendar date" in _slice and "is far in the future" in _slice)
check("commits keyword value via {**data} + validation_note (Review-bound) + own continue",
      '{**data,' in _slice and 'validation_note' in _slice and _slice.rstrip().endswith('continue'))
check("predicate uses parse_date + salvage_date + days_in_future (single clock; no new date regex)",
      all(s in inspect.getsource(E._invalid_taught_date_yields)
          for s in ('validator.parse_date', 'validator.salvage_date', 'validator.days_in_future')))
check("future trigger on its OWN constant _DATE_YIELD_FUTURE_DAYS (decoupled from the 366 flag)",
      E._DATE_YIELD_FUTURE_DAYS > TOL and '_DATE_YIELD_FUTURE_DAYS' in inspect.getsource(E._invalid_taught_date_yields))

print()
if FAILED:
    print(f"{len(FAILED)} FAILED")
    sys.exit(1)
print("All taught-date yield checks passed.")
