# -*- coding: utf-8 -*-
"""
tests/test_number_format.py
Region number-format normaliser + currency strip (Phase 2 + currency-strip + mixed-inbox guard).
Run: py -3.12 python_backend/tests/test_number_format.py
"""
import sys, os
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from extraction import number_format as N

fail = 0
def ck(label, got, want):
    global fail
    ok = got == want
    print(("OK  " if ok else "BAD ") + label + (f"  got={got!r}" if not ok else ""))
    if not ok:
        fail += 1

C = N.to_canonical

# ── anglo / indian: UNCHANGED (byte-identical) ──────────────────────────────────
ck("anglo 1,234.56 unchanged", C("1,234.56", "anglo"), "1,234.56")
ck("anglo $12,268.80 unchanged", C("$12,268.80", "anglo"), "$12,268.80")
ck("indian 12,34,567.89 unchanged", C("12,34,567.89", "indian"), "12,34,567.89")

# ── continental / french / swiss: convert when region-shaped ────────────────────
ck("continental 1.234,56 -> 1234.56", C("1.234,56", "continental"), "1234.56")
ck("continental €1.234.567,89", C("€1.234.567,89", "continental"), "€1234567.89")
ck("french 1 234,56 -> 1234.56", C("1 234,56", "french"), "1234.56")
ck("french NBSP 1 234,56 -> 1234.56", C("1 234,56", "french"), "1234.56")
ck("french thin 1 234,56 -> 1234.56", C("1 234,56", "french"), "1234.56")
ck("swiss 1'234.56 -> 1234.56", C("1'234.56", "swiss"), "1234.56")

# ── MIXED-INBOX GUARD (B1a): an anglo value under a non-anglo region must NOT corrupt ─
ck("continental on anglo 1,234.56 LEFT (not 1.23456)", C("1,234.56", "continental"), "1,234.56")
ck("continental on anglo 12,268.80 LEFT", C("12,268.80", "continental"), "12,268.80")
ck("french on anglo 1,234.56 LEFT", C("1,234.56", "french"), "1,234.56")
ck("swiss on anglo 1,234.56 LEFT (no apostrophe)", C("1,234.56", "swiss"), "1,234.56")
ck("continental on bare 500 unchanged", C("500", "continental"), "500")
ck("continental on 1234.56 (already canonical) unchanged", C("1234.56", "continental"), "1234.56")

# ── non-numeric / None passthrough ──────────────────────────────────────────────
ck("text passthrough", C("Acme Ltd", "continental"), "Acme Ltd")
ck("None passthrough", C(None, "continental"), None)

# ── strip_currency ──────────────────────────────────────────────────────────────
ck("strip $12,268.80 -> 12,268.80", N.strip_currency("$12,268.80"), "12,268.80")
ck("strip GBP 118.83 -> 118.83", N.strip_currency("GBP 118.83"), "118.83")
ck("strip €1234.56 -> 1234.56", N.strip_currency("€1234.56"), "1234.56")
ck("strip bare 99.03 unchanged", N.strip_currency("99.03"), "99.03")
ck("strip non-amount unchanged", N.strip_currency("Acme Ltd"), "Acme Ltd")

# ── process-wide set_format / canonical ─────────────────────────────────────────
N.set_format("continental")
ck("canonical() uses set format", N.canonical("1.234,56"), "1234.56")
ck("canonical() guard on anglo", N.canonical("1,234.56"), "1,234.56")
N.set_format("anglo")
ck("canonical() anglo no-op", N.canonical("1,234.56"), "1,234.56")
ck("unknown format falls back to anglo", C("1.234,56", "klingon"), "1.234,56")

print("\n" + (f"{fail} FAILED" if fail else "all number-format checks passed"))
sys.exit(1 if fail else 0)
