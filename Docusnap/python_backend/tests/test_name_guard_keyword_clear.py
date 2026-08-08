"""Unit pins for the NAME-GUARD KEYWORD CLEAR (Oracle SEND-BACK redirect 2026-07-24).

engine._name_guard_keyword_clears decides whether the anchor.py :586 name-guard PHANTOM note
("caption disagreed with the taught position") clears — ONLY when the Stage-2 read carries the
`_name_guard_clearable` marker (set EXCLUSIVELY at that clean-rigid-name-vs-off-page-junk site) AND
an INDEPENDENT Stage-1 keyword incumbent normalises-equal to the KEPT value.

THE LOAD-BEARING PIN is the RESIDUAL (Oracle C2): a STALE-but-clean rigid name whose keyword read
DISAGREES must STILL be held — so a future dev cannot drop the note without keyword corroboration and
silently auto-file a stale/wrong name (the same-supplier-drift hole that sank the raw-OCR-witness
approach). M=0 on the corpus does NOT prove this (the corpus likely lacks the doc); this pin does.

Run: PYTHONUTF8=1 py -3.12 python_backend/tests/test_name_guard_keyword_clear.py
"""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
os.environ['NAME_GUARD_KEYWORD_CLEAR'] = '1'   # enable to exercise the clear LOGIC (shipped DEFAULT is OFF, Oracle 2026-07-24)
from extraction import engine

NOTE = ("The value found beside this document's own caption disagreed with the taught position "
        "— please verify.")


def marked(value, method='anchor_crop'):
    return {"value": value, "confidence": 70, "method": method,
            "validation_note": NOTE, "_name_guard_clearable": True}


def kw(value):
    return {"value": value, "confidence": 78, "method": "keyword"}


fails = []


def check(label, got, expect):
    ok = (got == expect)
    if not ok:
        fails.append(label)
    print(f"  [{'ok  ' if ok else 'FAIL'}] {label} -> {got} (expect {expect})")


clears = engine._name_guard_keyword_clears
print("=== NAME-GUARD KEYWORD CLEAR ===")

# INCIDENT: marker + an agreeing INDEPENDENT keyword -> CLEARS the phantom note
check("incident: Halcyon==Halcyon + marker -> clears",
      clears(marked("Halcyon Leisure Group"), kw("Halcyon Leisure Group"), "customer_name"), True)
check("normalised (case/whitespace) still clears",
      clears(marked("Halcyon  Leisure Group"), kw("halcyon leisure group"), "customer_name"), True)

# ── Oracle C2 RESIDUAL PIN (the non-negotiable one) ──────────────────────────────────────────
# A clean STALE rigid name whose keyword DISAGREES must STAY HELD (never auto-file the stale name).
check("C2 residual: stale clean name, keyword DISAGREES -> HELD",
      clears(marked("Stalebrook Interiors"), kw("Redwood Construction"), "customer_name"), False)
# NO-KEYWORD variant: an uncorroborated lone rigid read (no Stage-1 incumbent) -> HELD
check("no keyword incumbent -> HELD",
      clears(marked("Halcyon Leisure Group"), None, "customer_name"), False)
# incumbent is NOT an independent keyword (e.g. another anchor read) -> HELD
check("non-keyword incumbent -> HELD",
      clears(marked("Halcyon Leisure Group"),
             {"value": "Halcyon Leisure Group", "method": "anchor"}, "customer_name"), False)

# ── Oracle C4 SCOPE PIN: the OTHER _relocate_guard_note sites carry NO marker -> never cleared ──
_nomark = {"value": "Halcyon Leisure Group", "confidence": 70, "method": "anchor_crop",
           "validation_note": NOTE}
check("C4 scope: no _name_guard_clearable marker -> HELD (other note sites keep flagging)",
      clears(_nomark, kw("Halcyon Leisure Group"), "customer_name"), False)

# supplier_name EXCLUDED (the filing identity — mirrors _name_relocate_should_hold)
check("supplier_name excluded -> HELD",
      clears(marked("Halcyon Leisure Group"), kw("Halcyon Leisure Group"), "supplier_name"), False)

# kill switch OFF -> byte-identical (nothing clears)
os.environ['NAME_GUARD_KEYWORD_CLEAR'] = '0'
check("kill switch OFF -> HELD (byte-identical)",
      clears(marked("Halcyon Leisure Group"), kw("Halcyon Leisure Group"), "customer_name"), False)
os.environ.pop('NAME_GUARD_KEYWORD_CLEAR', None)
# DEFAULT OFF (Oracle 2026-07-24): with the env UNSET, nothing clears -> byte-identical to pre-fix.
# The clear ships DARK until the ref-hold precondition lands (#259 delivery-docket canary: a valid-
# shaped crop-vs-full-page single-digit ref disagreement must flag before this can safely go ON).
check("default (unset) -> HELD (shipped DEFAULT OFF)",
      clears(marked("Halcyon Leisure Group"), kw("Halcyon Leisure Group"), "customer_name"), False)

if fails:
    print(f"\n{len(fails)} FAIL(s): {fails}")
    sys.exit(1)
print("\nALL PASS")
