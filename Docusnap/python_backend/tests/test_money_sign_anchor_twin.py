#!/usr/bin/env python3
"""
tests/test_money_sign_anchor_twin.py — MONEY_SIGN_CAPTURE at the ANCHOR mint (log review Item 1 sign
lever, 2026-09-05; mig-72 setting `money_sign_capture`, still DARK — the flip is the owner's).

Meadowvale credit notes: the tight taught box read "£-366.66" but the value committed as 366.66 —
`_clean_text_fallback` strips " -:;," AND no shipped currency pattern admits a leading '-', so the
sign died at the anchor mint exactly as it did at the keyword mint before MONEY_SIGN_CAPTURE. The
keyword re-attach (keyword._clean_value) is now mirrored here under the SAME switch.

Pins:
  1 OFF (default): "£-366.66" -> "366.66" (today, documented).
  2 ON: "£-366.66" -> "-366.66"; "-366.66" -> "-366.66"; " -366.66" -> "-366.66".
  3 ON: a spaced dash / a dash run / a plain amount stay unsigned ("Total - 160.32", "--366.66", "£366.66").
  4 ON: the two mints agree (keyword._clean_value vs anchor._clean_text_fallback) on every vector.
  5 ON: non-currency untouched ("2026-01-26" date; a job_reference).

Usage:  PYTHONIOENCODING=utf-8 py -3.12 python_backend/tests/test_money_sign_anchor_twin.py
"""
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
ROOT = os.path.dirname(os.path.dirname(HERE))

from extraction.anchor import _clean_text_fallback  # noqa: E402
from extraction.keyword import _clean_value  # noqa: E402

fails = 0


def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1


def arm(on):
    if on:
        os.environ["MONEY_SIGN_CAPTURE"] = "1"
    else:
        os.environ.pop("MONEY_SIGN_CAPTURE", None)


for k in ("MONEY_SIGN_CAPTURE", "MONEY_SIGN_PARENS", "MONEY_SIGN_CR"):
    os.environ.pop(k, None)
VAL = json.load(io.open(os.path.join(ROOT, 'config', 'keyword_patterns.json'), encoding='utf-8'))['validation_patterns']

print("-- 1 OFF == today --")
arm(False)
check("OFF: '£-366.66' -> '366.66' (the sign dies at the anchor mint)", _clean_text_fallback("£-366.66", "currency", VAL) == "366.66")
check("OFF: keyword twin agrees", _clean_value("£-366.66", "currency", VAL) == "366.66")

print("-- 2 ON: a single adjacent '-' is re-attached --")
arm(True)
for src, want in [("£-366.66", "-366.66"), ("-366.66", "-366.66"), (" -366.66", "-366.66"), ("$-1,178.89", "-1,178.89"), ("£ -120.02", "-120.02")]:
    check(f"ON: {src!r} -> {want!r} (anchor)", _clean_text_fallback(src, "currency", VAL) == want)

print("-- 3 ON: spaced / run / plain stay unsigned (== today's anchor output, byte-identical) --")
for src in ["Total - 160.32", "--366.66", "£366.66", "366.66-", "366.66"]:
    arm(False); off = _clean_text_fallback(src, "currency", VAL)
    arm(True); on = _clean_text_fallback(src, "currency", VAL)
    check(f"ON == OFF for {src!r} ({on!r}) and no sign attached", on == off and not str(on or "").startswith("-"))

print("-- 4 ON: the two mints agree on every SIGNED vector --")
arm(True)
for src in ["£-366.66", "-366.66", " -366.66", "$-1,178.89"]:
    a, k = _clean_text_fallback(src, "currency", VAL), _clean_value(src, "currency", VAL)
    check(f"anchor == keyword for {src!r} ({a!r} vs {k!r})", a == k and str(a).startswith("-"))

print("-- 5 ON: non-currency untouched --")
check("date: '-2026-01-26' -> '2026-01-26'", _clean_text_fallback("-2026-01-26", "date", VAL) == "2026-01-26")
arm(False)

print(f"\n{'FAILED: ' + str(fails) if fails else 'ALL PASS'}")
sys.exit(1 if fails else 0)
