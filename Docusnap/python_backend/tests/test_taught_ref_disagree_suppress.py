"""
test_taught_ref_disagree_suppress.py — the pure record-transform pins for TAUGHT_REF_DISAGREE_SUPPRESS
(mig 186, 2026-09-19; gary -> Oracle SIGN-OFF-W/COND). Tests engine._suppress_taught_ref_disagree_record
directly: it moves an OFF-learned-shape ref competitor out of disagree/discounted into a NEW
`suppressed_taught_role` key, but ONLY when the winner is an authoritative taught read that itself
matches the learned shape. off_shape() is injected, so these pins lock the MOVE LOGIC and the
accepted-trade-off holds (garbled winner / same-shape competitor / non-taught winner => NO move => the
doc still HOLDS, fail-toward-review). The real off_shape / ref-only scoping / date-exclusion live at the
engine call site and are exercised by the realdoc harness.

Run:  py -3.12 python_backend/tests/test_taught_ref_disagree_suppress.py
"""
import os
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from extraction.engine import _suppress_taught_ref_disagree_record, _is_stage05_located  # noqa: E402

_fail = 0


def ok(name, cond):
    global _fail
    print(("  ok  " if cond else "  FAIL ") + name)
    if not cond:
        _fail += 1


# A stand-in for "value is off the scope's learned shape": the learned shape is CJB-#### (letters+digits),
# so the taught winner CJB-1578 is ON-shape and the "Job Ref" competitor JB-2554 is OFF-shape (shorter
# letter run). This mirrors the real format_anomaly_checker shape test the call site injects, and pins the
# CJB-vs-JB letter-length discrimination the OCR note calls out.
def off_shape_cjb(v):
    v = str(v or "").strip()
    if not v:
        return False
    return not v.startswith("CJB-")   # JB-2554 -> True (off shape); CJB-1600 -> False (same shape)


print("1. TAUGHT WINS: an off-shape keyword competitor is moved out of disagree into suppressed_taught_role")
rec = {"winner_family": "mapping", "agree": [], "disagree": [{"family": "keyword", "value": "JB-2554"}],
       "independent_agree": False}
moved = _suppress_taught_ref_disagree_record(rec, True, True, off_shape_cjb)
ok("one entry moved", moved == 1)
ok("disagree emptied", rec["disagree"] == [])
ok("suppressed_taught_role carries the competitor", rec.get("suppressed_taught_role") == [{"family": "keyword", "value": "JB-2554"}])

print("\n2. SAFETY — garbled taught box (winner_shape_ok False): NO move, the doc still HOLDS")
rec = {"winner_family": "mapping", "agree": [], "disagree": [{"family": "keyword", "value": "JB-2554"}], "independent_agree": False}
moved = _suppress_taught_ref_disagree_record(rec, True, False, off_shape_cjb)
ok("nothing moved", moved == 0)
ok("disagree untouched (still holds)", rec["disagree"] == [{"family": "keyword", "value": "JB-2554"}])
ok("no suppressed key added", "suppressed_taught_role" not in rec)

print("\n3. SAFETY — non-taught winner (winner_taught False): NO move")
rec = {"winner_family": "keyword", "agree": [], "disagree": [{"family": "keyword", "value": "JB-2554"}], "independent_agree": False}
ok("nothing moved", _suppress_taught_ref_disagree_record(rec, False, True, off_shape_cjb) == 0)
ok("disagree untouched", rec["disagree"] == [{"family": "keyword", "value": "JB-2554"}])

print("\n4. SAFETY — SAME-shape competitor (genuine same-field ambiguity): NOT moved, still holds")
rec = {"winner_family": "mapping", "agree": [], "disagree": [{"family": "keyword", "value": "CJB-1600"}], "independent_agree": False}
moved = _suppress_taught_ref_disagree_record(rec, True, True, off_shape_cjb)
ok("nothing moved (CJB-1600 is same shape as the taught CJB-1578)", moved == 0)
ok("same-shape rival stays in disagree (still holds)", rec["disagree"] == [{"family": "keyword", "value": "CJB-1600"}])

print("\n5. Oracle C2 — a competitor already in `discounted` is moved too (else the hold stays live)")
rec = {"winner_family": "mapping", "agree": [], "disagree": [],
       "discounted": [{"family": "keyword", "value": "JB-2554", "reason": "alphanumeric_format_invalid"}], "independent_agree": False}
moved = _suppress_taught_ref_disagree_record(rec, True, True, off_shape_cjb)
ok("one entry moved from discounted", moved == 1)
ok("discounted emptied", rec["discounted"] == [])
ok("moved entry keeps its reason in suppressed_taught_role",
   rec.get("suppressed_taught_role") == [{"family": "keyword", "value": "JB-2554", "reason": "alphanumeric_format_invalid"}])

print("\n6. MIXED — only the off-shape competitor moves; a same-shape rival is left holding")
rec = {"winner_family": "mapping", "agree": [],
       "disagree": [{"family": "keyword", "value": "JB-2554"}, {"family": "crop", "value": "CJB-1600"}], "independent_agree": False}
moved = _suppress_taught_ref_disagree_record(rec, True, True, off_shape_cjb)
ok("only the off-shape entry moved", moved == 1)
ok("the same-shape crop rival stays in disagree (still holds)", rec["disagree"] == [{"family": "crop", "value": "CJB-1600"}])
ok("suppressed carries only the off-shape competitor", rec.get("suppressed_taught_role") == [{"family": "keyword", "value": "JB-2554"}])

print("\n7. NO-OP — an empty/agreeing record is byte-identical (returns 0, adds no key)")
rec = {"winner_family": "mapping", "agree": ["crop"], "disagree": [], "independent_agree": True}
before = dict(rec)
ok("nothing moved", _suppress_taught_ref_disagree_record(rec, True, True, off_shape_cjb) == 0)
ok("record unchanged", rec == before)

print("\n8. _is_stage05_located gate — authoritative taught methods only")
ok("template_mapping is Stage-0.5 located", _is_stage05_located("template_mapping") is True)
ok("template_mapping_inline (suffix) is located", _is_stage05_located("template_mapping_inline") is True)
ok("template_registration_expanded is located", _is_stage05_located("template_registration_expanded") is True)
ok("keyword is NOT located", _is_stage05_located("keyword") is False)
ok("template_fixed (auto-learned) is NOT located", _is_stage05_located("template_fixed") is False)
ok("None is NOT located", _is_stage05_located(None) is False)

print("\n" + ("ALL PASS" if _fail == 0 else f"{_fail} FAILED"))
sys.exit(1 if _fail else 0)
