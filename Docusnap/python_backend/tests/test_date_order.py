# -*- coding: utf-8 -*-
"""
tests/test_date_order.py
Region date-ordering for ambiguous numeric dates (Phase 1). dmy default is byte-identical.
Run: py -3.12 python_backend/tests/test_date_order.py
"""
import sys, os
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from extraction import validator as V

fail = 0
def ck(label, cond):
    global fail
    print(("OK  " if cond else "BAD ") + label)
    if not cond:
        fail += 1

def d(s):
    r = V.parse_date(s)
    return r.strftime("%d-%m-%Y") if r else None

# ── dmy (default, UK/EU) — byte-identical to the historical list ─────────────────
V.set_date_order("dmy")
ck("dmy 03/04/2026 -> 3 Apr", d("03/04/2026") == "03-04-2026")
ck("dmy 06/08/2026 -> 6 Aug (not 8 Jun)", d("06/08/2026") == "06-08-2026")
ck("DATE_FORMATS constant is the dmy list", V.DATE_FORMATS[0] == "%d/%m/%Y")

# ── mdy (US) ────────────────────────────────────────────────────────────────────
V.set_date_order("mdy")
ck("mdy 03/04/2026 -> 4 Mar", d("03/04/2026") == "04-03-2026")
ck("mdy 12/25/2026 -> 25 Dec", d("12/25/2026") == "25-12-2026")

# ── ymd (ISO-first regions) ─────────────────────────────────────────────────────
V.set_date_order("ymd")
ck("ymd 2026-08-06 -> 6 Aug", d("2026-08-06") == "06-08-2026")
ck("ymd 2026/04/03 -> 3 Apr", d("2026/04/03") == "03-04-2026")

# ── day-value > 12 is UNAMBIGUOUS in ANY mode (falls back to the only valid order) ─
for mode in ("dmy", "mdy", "ymd"):
    V.set_date_order(mode)
    ck(f"{mode}: 25/12/2026 -> 25 Dec (day>12 unambiguous)", d("25/12/2026") == "25-12-2026")

# ── month-NAME + ISO always parse regardless of order ───────────────────────────
for mode in ("dmy", "mdy", "ymd"):
    V.set_date_order(mode)
    ck(f"{mode}: 'August 6, 2026' -> 6 Aug", d("August 6, 2026") == "06-08-2026")
    ck(f"{mode}: '6 August 2026' -> 6 Aug", d("6 August 2026") == "06-08-2026")

# ── garbage never crashes ───────────────────────────────────────────────────────
V.set_date_order("mdy")
ck("mdy garbage -> None", d("2026/13/40") is None)
ck("empty -> None", V.parse_date("") is None)

# ── 'auto' and unknown fall back to dmy ─────────────────────────────────────────
V.set_date_order("auto")
ck("auto behaves as dmy (03/04 -> 3 Apr)", d("03/04/2026") == "03-04-2026")
V.set_date_order("klingon")
ck("unknown order falls back to dmy", d("06/08/2026") == "06-08-2026")

# reset so a later import in the same process is byte-identical
V.set_date_order("dmy")

print("\n" + (f"{fail} FAILED" if fail else "all date-order checks passed"))
sys.exit(1 if fail else 0)
