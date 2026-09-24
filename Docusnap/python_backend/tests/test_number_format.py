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


# ── has_currency_code_prefix (2026-09-24, Chris teach-round card 2a; reggie → Oracle C1-C4) ────────────
# A KNOWN ISO code, a real gap, then an amount. Label bleeds / misread codes / the glued form are NOT a prefix.
ck("prefix: 'GBP 1.00' True",        N.has_currency_code_prefix("GBP 1.00"), True)
ck("prefix: 'gbp 1.00' True (case)", N.has_currency_code_prefix("gbp 1.00"), True)
ck("prefix: 'GBP 11,066.95' True",   N.has_currency_code_prefix("GBP 11,066.95"), True)
ck("prefix: 'GBP -1.00' True (sign)", N.has_currency_code_prefix("GBP -1.00"), True)
ck("prefix: 'GBP (1,000.00)' True (parens)", N.has_currency_code_prefix("GBP (1,000.00)"), True)
ck("prefix: 'EUR 1.234,56' True",    N.has_currency_code_prefix("EUR 1.234,56"), True)
ck("prefix: 'GBP1.00' False (glued — strip_currency's \\b would not strip it at Stage 4)", N.has_currency_code_prefix("GBP1.00"), False)
ck("prefix: 'VAT 1.00' False (label bleed)", N.has_currency_code_prefix("VAT 1.00"), False)
ck("prefix: 'NET 9,222.46' False (label bleed)", N.has_currency_code_prefix("NET 9,222.46"), False)
ck("prefix: 'SBP 1.00' False (misread code stays review-bound)", N.has_currency_code_prefix("SBP 1.00"), False)
ck("prefix: 'GBP' False (no amount)", N.has_currency_code_prefix("GBP"), False)
ck("prefix: 'GBP Total' False (a word, not an amount)", N.has_currency_code_prefix("GBP Total"), False)
ck("prefix: '' False", N.has_currency_code_prefix(""), False)
ck("prefix: None False", N.has_currency_code_prefix(None), False)
ck("ONE alternation: strip_currency + _CODE_STRIP_RE + the prefix share _ISO_CODES", N._ISO_CODES in N._CODE_STRIP_RE.pattern and N._ISO_CODES in N._CODE_PREFIX_RE.pattern, True)

print("\n" + (f"{fail} FAILED" if fail else "all number-format checks passed"))
sys.exit(1 if fail else 0)
