#!/usr/bin/env python3
"""tests/test_money_sign_parens_cr.py — MONEY_SIGN_PARENS / MONEY_SIGN_CR (reggie 2026-08-31, DARK).

The Hard Set credit_sign class: four of five negative-total notations read POSITIVE because the
mint (keyword `_clean_value` / anchor `_clean_text_fallback`) extracts the bare amount match and
amputates the marker. This slice captures the two STRONG accounting notations — a whole-segment
balanced-parens amount "(£908.16)" and a trailing CR marker "£908.16 CR" — via ONE shared helper
(`number_format.signed_money_capture`), each behind its own DARK flag, at BOTH mints (the anchor
twin is what keeps corroboration's `money_cents` sign agreement alive). Bare leading/trailing
minus stays note-only by design (the scan dash-leader class); `£-x` already heals via the shipped
MONEY_SIGN_CAPTURE leg.

    py -3.12 tests/test_money_sign_parens_cr.py   (from python_backend/)
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from extraction import anchor, keyword, number_format                     # noqa: E402

CFG = json.load(open(os.path.join(os.path.dirname(__file__), "..", "..", "config",
                                 "keyword_patterns.json"), encoding="utf-8"))
VP = CFG["validation_patterns"]
fails = 0


def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond:
        fails += 1


def setflag(name, v):
    if v is None:
        os.environ.pop(name, None)
    else:
        os.environ[name] = v


# ── The helper's truth table (flag-independent — the flags live at the call sites) ───────────────
print("signed_money_capture truth table:")
cap = number_format.signed_money_capture
check("(£908.16)   -> ('-908.16', 'parens')", cap("(£908.16)") == ("-908.16", "parens"))
check("( 908.16 )  -> ('-908.16', 'parens')", cap("( 908.16 )") == ("-908.16", "parens"))
check("(£1,753.20) -> ('-1753.20' bare of separators? NO — grouping kept)",
      cap("(£1,753.20)") == ("-1,753.20", "parens"))
check("£908.16 CR  -> ('-908.16', 'cr')", cap("£908.16 CR") == ("-908.16", "cr"))
check("908.16 CR.  -> ('-908.16', 'cr')", cap("908.16 CR.") == ("-908.16", "cr"))
check("(10%) refused (not money)", cap("(10%)") is None)
check("(see note 3) refused", cap("(see note 3)") is None)
check("908.16 CREDIT refused (CR boundary)", cap("908.16 CREDIT") is None)
check("unbalanced '(£908.16' refused", cap("(£908.16") is None)
check("garble '(£9 32632.76)' refused (strict shape)", cap("(£9 32632.76)") is None)
check("embedded 'fee (£10.00) waived' refused (fullmatch)", cap("fee (£10.00) waived") is None)
check("plain '908.16' refused (no marker)", cap("908.16") is None)
check("trailing minus '908.16-' NOT captured (note-only by design)", cap("908.16-") is None)
check("leading minus '-£908.16' NOT captured (note-only by design)", cap("-£908.16") is None)

# ── The keyword mint ─────────────────────────────────────────────────────────────────────────────
print()
print("keyword._clean_value mint:")
for f in ("MONEY_SIGN_PARENS", "MONEY_SIGN_CR"):
    setflag(f, None)
check("OFF: '(£908.16)' loses the sign (today's behaviour, pinned)",
      keyword._clean_value("(£908.16)", "currency", VP) == "£908.16")
check("OFF: '£908.16 CR' loses the sign", keyword._clean_value("£908.16 CR", "currency", VP) == "£908.16")
setflag("MONEY_SIGN_PARENS", "1")
check("PARENS on: '(£908.16)' -> '-908.16'",
      keyword._clean_value("(£908.16)", "currency", VP) == "-908.16")
check("PARENS on: '£908.16 CR' still loses the sign (per-notation flags)",
      keyword._clean_value("£908.16 CR", "currency", VP) == "£908.16")
setflag("MONEY_SIGN_CR", "1")
check("CR on: '£908.16 CR' -> '-908.16'",
      keyword._clean_value("£908.16 CR", "currency", VP) == "-908.16")
check("ON: a plain amount is untouched", keyword._clean_value("£118.83", "currency", VP) == "£118.83")
check("ON: '(10%)' never becomes money (falls through to the pattern mint)",
      keyword._clean_value("Discount (10%): 231.81", "currency", VP) in ("231.81", "10"))

# end-to-end through extract_fields (right-leg read of a boxed credit total)
line = "Total:    (£908.16)\n"
v = (keyword.extract_fields(line, ["total_amount"], CFG).get("total_amount") or {}).get("value")
check("ON: extract_fields reads 'Total: (£908.16)' -> '-908.16'", v == "-908.16")
for f in ("MONEY_SIGN_PARENS", "MONEY_SIGN_CR"):
    setflag(f, None)
v = (keyword.extract_fields(line, ["total_amount"], CFG).get("total_amount") or {}).get("value")
check("OFF: the same line reads positive (byte-identical today)", v == "£908.16")

# ── The anchor twin ──────────────────────────────────────────────────────────────────────────────
print()
print("anchor._clean_text_fallback twin:")
check("OFF: '(£908.16)' -> positive", anchor._clean_text_fallback("(£908.16)", "currency", VP) == "£908.16")
setflag("MONEY_SIGN_PARENS", "1")
setflag("MONEY_SIGN_CR", "1")
check("ON: '(£908.16)' -> '-908.16'", anchor._clean_text_fallback("(£908.16)", "currency", VP) == "-908.16")
check("ON: '908.16 CR' -> '-908.16'", anchor._clean_text_fallback("908.16 CR", "currency", VP) == "-908.16")
check("ON: a plain amount untouched", anchor._clean_text_fallback("£118.83", "currency", VP) == "£118.83")

# ── The seam that motivated the twin: sign-aware agreement ───────────────────────────────────────
print()
print("money_cents sign agreement:")
check("money_cents('-908.16') == (90816, True)", number_format.money_cents("-908.16") == (90816, True))
check("money_cents('£908.16') == (90816, False)", number_format.money_cents("£908.16") == (90816, False))
check("signed keyword read vs signed anchor read AGREE",
      number_format.money_cents("-908.16") == number_format.money_cents(
          anchor._clean_text_fallback("(£908.16)", "currency", VP)))
check("money_strict_shape accepts the captured '-1,753.20'",
      number_format.money_strict_shape("-1,753.20"))

# Oracle C2 — the capture/arm-3 HANDOFF: a captured negative on a NON-credit type must still
# draw the manufactured-minus note (validator arm 3) — the safety the C1 co-residency force in
# _reconcileEnv keeps armed. If this row breaks, the capture is minting silent negatives.
from extraction import validator                                          # noqa: E402
_signed = number_format.signed_money_capture("(£908.16)")[0]
check("C2 handoff: arm 3 notes the captured negative on a non-credit type",
      validator.credit_sign_note(_signed, None, False) is not None)

for f in ("MONEY_SIGN_PARENS", "MONEY_SIGN_CR"):
    setflag(f, None)
print()
print("FAILED: %d" % fails if fails else "ALL PASS")
sys.exit(1 if fails else 0)
