"""Tests for extraction/wordness.py — free-text NAME structure signals.

Run: py -3.12 -m tests.test_wordness   (from python_backend/, so `import keyword`
resolves to the stdlib, not the project's extraction/keyword.py).

Calibration (synthetic corpus, supplier_name/customer_name reads, interpolated model):
threshold -3.3 gave 0% false-flag on correct names and converted 9 previously-silent
wrong reads to flagged, on top of the chrome + ref-bleed catches.
"""
from __future__ import annotations
import sys, os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from extraction import wordness as W

PASS = FAIL = 0


def ok(cond, msg):
    global PASS, FAIL
    if cond:
        PASS += 1; print(f"  OK   {msg}")
    else:
        FAIL += 1; print(f"  FAIL {msg}")


print("0. model loads")
ok(W.available(), "char_trigrams.json table is present and loads")

print("\n1. real names / words are NOT flagged — the cardinal risk (false flags)")
GOOD = ["Beaumont", "Stonebridge", "Joinery", "Vellum Stationers", "Crestwave Systems",
        "Tideway Marine", "Northgate Supplies Ltd", "Greenfield Academy", "Oakmount Services",
        "Summit Fitness Club", "Riverside Dental Practice", "Carlton & Reeve LLP",
        "Pinnacle Print Group", "Lumen Electrical", "Meridian Office Co", "Ashfield Logistics"]
for g in GOOD:
    ok(not W.looks_like_garble(g), f"{g!r} not flagged")

print("\n2. multi-word real names NOT flagged (measured corpus names, 0% false-flag)")
ok(not W.looks_like_garble("Tideway Marine"), "Tideway Marine kept")
ok(not W.looks_like_garble("Crestwave Systems"), "Crestwave Systems kept")

print("\n3. document-chrome captured into a name field IS flagged (stoplist)")
for bad in ["INVOI", "INVO", "NOTE", "urgent", "Total", "Statement", "Remittance"]:
    ok(W.looks_like_garble(bad), f"{bad!r} flagged as chrome")

print("\n4. reference/code captured into a name field IS flagged (ref-bleed)")
for bad in ["INV-2026021", "REM-2026037", "PO 884512", "123456"]:
    ok(W.looks_like_garble(bad), f"{bad!r} flagged as ref/code")

print("\n5. no scorable token / OCR garble IS flagged")
for bad in ["NY", "4.3", "dsggds", "cvp", "Vatum Stagoness", "Aabiield Logistics"]:
    ok(W.looks_like_garble(bad), f"{bad!r} flagged")

print("\n6. flag-only contract + documented LIMITS")
d = W.name_wordness("Beaumont Care Homes") if hasattr(W, "name_wordness") else None
ok(W.name_structure_flag("") is None, "empty value -> no flag (no-signal)")
ok(W.name_structure_flag("Summit Fitness Club", word_like=False) is None,
   "word_like=False (history says code-like) -> language checks disabled")
# Honest limits: clean real-word substitution / truncation are NOT this signal's job
# (they need the per-supplier lexicon / history). Asserted as known misses, not failures.
ok(not W.looks_like_garble("Summit Fitness Chub"),
   "LIMIT: clean real-word misread (Club->Chub) not caught by character stats")

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
