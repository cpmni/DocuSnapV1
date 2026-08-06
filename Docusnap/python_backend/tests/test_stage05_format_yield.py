#!/usr/bin/env python3
"""tests/test_stage05_format_yield.py — TEMPLATE_FORMAT_FAIL_YIELD (gary -> Oracle SIGN-OFF-W/COND 2026-08-06).

Owner rule: teaching must never make a field WORSE than not teaching. On the stable-template corpus,
teaching HELPS most fields but HURTS total/po_ref — an authoritative Stage-0.5 template_mapping read that
lands on the wrong row / adjacent field / clips / garbles ("Account" for po_ref, "L922.14" for a total)
keeps authoritative precedence over the CORRECT keyword read at the Stage-1 merge. The fix yields such a
FORMAT-FAILING taught read to a confident, format-PASSING, disagreeing keyword read (swap + cap + note).

THE SEAM THIS PINS: the pure trigger `engine._stage05_format_fails`. The load-bearing guarantee is that a
VALID taught read PASSES (returns False) so the carve-out never fires on it — that is what protects the
teaching gains (ref +30 / date +15 / issuer +76). The garbles FAIL (return True). Oracle C2: L3 must NOT
false-fire on legitimate regional/credit amounts (-£662.18 / £-662.18 / continental / swiss).

Run: py -3.12 python_backend/tests/test_stage05_format_yield.py
"""
import os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import engine as E
from extraction import template_mapper

fails = 0
def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond: fails += 1

FF = E._stage05_format_fails

# ── L1: a derived rung already shape-flagged it ────────────────────────────────
check("L1 shapewarn: po_ref 'Account' (template_mapping_shapewarn) FAILS",
      FF("Account", "po_number", "text", {}, "template_mapping_shapewarn") is True)
check("empty taught value FAILS", FF("", "po_number", "text", {}, "template_mapping") is True)

# ── L3: strict currency validity (leading-glyph + parse) ───────────────────────
check("L3 'L922.14' (leading letter the substring let through) FAILS",
      FF("L922.14", "total_amount", "currency", {}, "template_mapping") is True)
check("L3 'O.00' garble FAILS", FF("O.00", "total_amount", "currency", {}, "template_mapping") is True)
# Oracle C2 — legitimate amounts must PASS (return False) so they are NEVER swapped:
for good in ["922.14", "1,234.00", "£-662.18", "-£662.18", "£1,758.72", "1.234,56", "1'234.56"]:
    check(f"L3 legitimate amount '{good}' PASSES (not swapped)",
          FF(good, "total_amount", "currency", {}, "template_mapping") is False)
check("L3 accepted residual: bare '2' PASSES (magnitude, not format; left to NET_MISREAD_TOTAL_FLAG)",
      FF("2", "total_amount", "currency", {}, "template_mapping") is False)

# ── PROTECT THE TEACHING GAINS: a VALID taught read must PASS (never fires) ─────
check("valid taught po_ref 'PO-77219' (no learned shape) PASSES — a good teach is never overridden",
      FF("PO-77219", "po_number", "text", {}, "template_mapping") is False)
check("valid taught net total '551.82' PASSES — left to NET_MISREAD_TOTAL_FLAG, not this yield",
      FF("551.82", "total_amount", "currency", {}, "template_mapping") is False)
# a keyword challenger that is ITSELF a garble must PASS the FAIL check as True (so the branch's
# 'keyword PASSES format' leg is False -> no swap): proven by the same L3 rows above.

# ── L2 WIRING: the learned-shape leg delegates to template_mapper._format_rejects ─
_orig = template_mapper._format_rejects
try:
    template_mapper._format_rejects = lambda text, key, lk: (text == "24511" and key == "po_number")
    check("L2 wiring: a value the learned shape REJECTS ('24511' clipped PO-prefix) FAILS",
          FF("24511", "po_number", "text", {"po_number": "shape"}, "template_mapping") is True)
    check("L2 wiring: a value the learned shape ACCEPTS PASSES",
          FF("PO-56863", "po_number", "text", {"po_number": "shape"}, "template_mapping") is False)
finally:
    template_mapper._format_rejects = _orig

# ── Flag default OFF (module constant) ─────────────────────────────────────────
check("TEMPLATE_FORMAT_FAIL_YIELD defaults OFF (byte-identical unless enabled)",
      E.TEMPLATE_FORMAT_FAIL_YIELD is False or os.environ.get("TEMPLATE_FORMAT_FAIL_YIELD") == "1")
check("_FORMAT_FAIL_KW_FLOOR is 88 (Oracle C1 — not 90)", E._FORMAT_FAIL_KW_FLOOR == 88)

print()
print(f"{fails} FAILED" if fails else "All TEMPLATE_FORMAT_FAIL_YIELD helper pins passed")
sys.exit(1 if fails else 0)
