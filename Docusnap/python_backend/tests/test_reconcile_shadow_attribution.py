#!/usr/bin/env python3.12
# RECONCILE_SHADOW_ATTRIBUTION (gary design -> Oracle SIGN-OFF-W/COND C1-C5, 2026-08-12).
# The Stage-4 reconcile charges every contradiction to the TOTAL unconditionally, yet the total
# can be the DOUBLY-WITNESSED side while every operand is an invisible shadow_reconcile read
# (Silverbeck 0016: shadow subtotal 387.75 misread 3875.75 -> the CORRECT total capped to 50).
# Armed + corroborated + all-shadow operands: the note stays (fail-toward-review, the auto-file
# block) but names the evidence neutrally, and the 50-cap is skipped. Everything else = today.
# Run: py -3.12 python_backend/tests/test_reconcile_shadow_attribution.py
import os, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

fail = 0
def check(label, cond):
    global fail
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fail += 1

FIELDS = [{"key": "total_amount", "type": "currency"},
          {"key": "subtotal",     "type": "currency"},
          {"key": "vat_tax",      "type": "currency"}]

def fresh_validator():
    # RELOAD (not re-import) so the module-level flag re-reads the env for each arm — after a
    # bare `del sys.modules[...]`, `from extraction import validator` returns the parent
    # package's STALE attribute without re-executing the module.
    import importlib
    from extraction import validator
    return importlib.reload(validator)

def exhibit(sub_method="shadow_reconcile", corrob=None, total_conf=90, sub_key="subtotal"):
    v = fresh_validator()
    ex = {
        "total_amount": {"value": "465.30", "confidence": total_conf, "method": "template_mapping"},
        sub_key:        {"value": "3875.75", "confidence": 60, "method": sub_method},
    }
    kwargs = {} if corrob is None else {"corroboration": corrob}
    r = v.validate_and_adjust(ex, FIELDS, **kwargs)
    t = r.get("total_amount", {})
    return t.get("confidence"), t.get("validation_note")

CORROB_YES = {"total_amount": {"winner_family": "mapping", "agree": ["keyword"],
                               "disagree": [], "independent_agree": True}}
# C5: the true-positive control must carry a record whose agree is EMPTY (not merely absent) —
# a guard mis-built to fire without independent_agree goes red here.
CORROB_NO = {"total_amount": {"winner_family": "mapping", "agree": [],
                              "disagree": [], "independent_agree": False}}

print("1. OFF => byte-identical (today's flag + cap), even with a corroborating record")
os.environ.pop("RECONCILE_SHADOW_ATTRIBUTION", None)
c, n = exhibit(corrob=CORROB_YES)
check("OFF: capped to 50", c == 50)
check("OFF: today's note text", bool(n) and "less than the subtotal" in n)
c, n = exhibit(corrob=None)
check("OFF + no kwarg (the 2-arg call shape): identical", c == 50 and "less than the subtotal" in n)

print("2. ON + corroborated + all-shadow => note PRESENT (reworded), cap SKIPPED, value untouched")
os.environ["RECONCILE_SHADOW_ATTRIBUTION"] = "1"
c, n = exhibit(corrob=CORROB_YES)
check("ON: confidence stays earned (90, uncapped)", c == 90)
check("ON: a note is PRESENT (never silent — the auto-file block)", bool(n))
check("ON: note names the evidence, not a verdict on the total",
      bool(n) and "two" in n and "independent" in n and "3875.75" in n)
check("ON: note is NOT today's copy", bool(n) and "less than the subtotal" not in n)

print("3. ON + UNcorroborated total => exactly today (fail-toward-review pin)")
c, n = exhibit(corrob=CORROB_NO)
check("uncorroborated: capped 50 + today's note", c == 50 and "less than the subtotal" in n)

print("4. Trade-off pin: a REAL visible operand (non-shadow) => today, even corroborated")
# C4: alias-keyed real field — 'sub_total' is a subtotal ROLE alias, so the guard must judge
# the RESOLVED operand the maths used, not just the canonical key.
from extraction.keyword import ROLE_KEY_ALIASES
alias = next((k for k in ROLE_KEY_ALIASES.get("subtotal", ()) if k != "subtotal"), None)
if alias:
    c, n = exhibit(sub_method="keyword", corrob=CORROB_YES, sub_key=alias)
    check(f"alias-keyed real operand ('{alias}', method keyword): capped 50 + today's note",
          c == 50 and bool(n) and "less than the subtotal" in n)
else:
    check("subtotal role has an alias to pin (ROLE_KEY_ALIASES)", False)
c, n = exhibit(sub_method="keyword", corrob=CORROB_YES)
check("canonical real operand (method keyword): capped 50 + today's note",
      c == 50 and "less than the subtotal" in n)

print("5. Mixed operands (shadow subtotal + real valued tax) => today")
v = fresh_validator()
ex = {"total_amount": {"value": "465.30", "confidence": 90, "method": "template_mapping"},
      "subtotal":     {"value": "3875.75", "confidence": 60, "method": "shadow_reconcile"},
      "vat_tax":      {"value": "77.55",  "confidence": 85, "method": "keyword"}}
r = v.validate_and_adjust(ex, FIELDS, corroboration=CORROB_YES)
t = r.get("total_amount", {})
check("mixed: capped + today's note family", t.get("confidence") == 50 and bool(t.get("validation_note")))

print("6. True positive intact: wrong single-family total + correct shadow subtotal => flag + cap")
v = fresh_validator()
ex = {"total_amount": {"value": "3.17",   "confidence": 90, "method": "keyword"},
      "subtotal":     {"value": "105.96", "confidence": 60, "method": "shadow_reconcile"}}
r = v.validate_and_adjust(ex, FIELDS, corroboration=CORROB_NO)
t = r.get("total_amount", {})
check("wrong total still flagged + capped (the class the reconcile exists for)",
      t.get("confidence") == 50 and "less than the subtotal" in (t.get("validation_note") or ""))

os.environ.pop("RECONCILE_SHADOW_ATTRIBUTION", None)
print(f"\n{'ALL PASS' if fail == 0 else str(fail) + ' FAILED'}")
sys.exit(0 if fail == 0 else 1)
