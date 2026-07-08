#!/usr/bin/env python3
"""
tests/test_ref_role_gate.py
---------------------------
The doc-type REFERENCE role is created as a plain "text" field, so it used to slip
past the TYPE->validation seeding and be graded as FREE TEXT. On a drifted scan the
absolute drawn box then read OCR garbage ("en rT") that PASSED the lax free-text
gate and committed, instead of failing so the anchor relocation could fire.

Phase 1 fix: engine._seed_field_patterns coerces any _is_ref_field key (incl. a
"text"-typed ref role) to the shared "alphanumeric" gate. This test guards both the
coercion table and that the alphanumeric pattern actually rejects the bug value while
accepting real references.

    py -3.12 python_backend/tests/test_ref_role_gate.py
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction.engine import _seed_field_patterns, _is_ref_field  # noqa: E402

FAILS = 0


def check(label, cond):
    global FAILS
    if not cond:
        FAILS += 1
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return bool(cond)


def val(field_patterns, key):
    e = field_patterns.get(key)
    return e.get("validation") if isinstance(e, dict) else None


# ── Coercion table (the fix) ─────────────────────────────────────────────────
print("_seed_field_patterns:")

# THE bug: a text-typed reference role must become a code gate, not free-text.
fp = _seed_field_patterns({}, [{"key": "reference_number", "type": "text"}])
check("text-typed reference_number -> alphanumeric", val(fp, "reference_number") == "alphanumeric")

# The ..._no naming convention, also text-typed.
fp = _seed_field_patterns({}, [{"key": "job_no", "type": "text"}])
check("text-typed job_no -> alphanumeric", val(fp, "job_no") == "alphanumeric")

# Free-text identity fields must stay UNCONSTRAINED (not _is_ref_field).
fp = _seed_field_patterns({}, [
    {"key": "customer_name", "type": "text"},
    {"key": "supplier_name", "type": "text"},
    {"key": "description", "type": "text"},
])
check("customer_name stays free-text (None)", val(fp, "customer_name") is None)
check("supplier_name stays free-text (None)", val(fp, "supplier_name") is None)
check("plain text 'description' stays free-text (None)", val(fp, "description") is None)

# Existing behaviour preserved: a ref field typed Number/Currency -> alphanumeric.
fp = _seed_field_patterns({}, [{"key": "invoice_number", "type": "number"}])
check("number-typed invoice_number -> alphanumeric (existing coercion)", val(fp, "invoice_number") == "alphanumeric")

# A non-ref money field keeps the currency gate.
fp = _seed_field_patterns({}, [{"key": "total_amount", "type": "currency"}])
check("currency total_amount -> currency (unchanged)", val(fp, "total_amount") == "currency")

# Date stays date.
fp = _seed_field_patterns({}, [{"key": "order_date", "type": "date"}])
check("date order_date -> date (unchanged)", val(fp, "order_date") == "date")

# The "reference" explicit field type still maps.
fp = _seed_field_patterns({}, [{"key": "ticket", "type": "reference"}])
check("reference-typed field -> alphanumeric", val(fp, "ticket") == "alphanumeric")

# Config entry must NOT be clobbered (keyword config wins).
fp = _seed_field_patterns({"invoice_number": {"validation": "job_reference"}},
                          [{"key": "invoice_number", "type": "text"}])
check("config-present key kept (not clobbered)", val(fp, "invoice_number") == "job_reference")

# Sanity on the helper used to scope the coercion.
check("_is_ref_field(reference_number)", _is_ref_field("reference_number"))
check("not _is_ref_field(customer_name)", not _is_ref_field("customer_name"))

# ── End-to-end: the alphanumeric gate rejects the bug value, accepts real refs ─
print("validation_patterns.alphanumeric (the gate the ref role now uses):")
cfg = json.loads((Path(__file__).parent.parent.parent / "config" / "keyword_patterns.json").read_text(encoding="utf-8"))
alnum_src = cfg["validation_patterns"]["alphanumeric"]
if isinstance(alnum_src, str):
    alnum_src = [alnum_src]
alnum = [re.compile(p, re.IGNORECASE) for p in alnum_src]
# Credibility = the value matches ANY of the field's validation patterns (re.search).
matches = lambda v: any(p.search(v) for p in alnum)

check("REJECTS the bug value 'en rT'", not matches("en rT"))
for ok in ("2605-0769-1", "INV-001", "PO/2024/55", "SO12345"):
    check(f"ACCEPTS real ref {ok!r}", matches(ok))

print(f"\n{'ALL PASS' if FAILS == 0 else str(FAILS) + ' FAILED'}")
sys.exit(1 if FAILS else 0)
