"""test_hidden_field_drop.py — a field declared absent for a layout is never FILLED.

Run: py -3.12 python_backend/tests/test_hidden_field_drop.py

THE DEFECT (owner, 2026-08-11, live): "i already have some unneeded fields incorrectly filled …
When i remove them and reprocess, they return again." `template_hidden_fields` (migration 54) was
consumed ONLY by the document-score exclusion — nothing stopped any fill stage writing a declared-
absent key, and the reprocess merge resurrected the stored fill besides (that half is pinned in
src/modules/processing/test_reprocess_annotated_empty.js §1c).

WHAT THIS FILE PINS:
  * the resolver semantics the drop shares with the scoring consumer — ONE function
    (hidden_fields_for_scope), one protected-keys strip; behavioural pins on the pure function.
  * the WIRING of the engine choke point: one block, before Stage 4, gated by
    TEMPLATE_HIDDEN_FIELD_DROP, using that same resolver + the same protected set. A wiring pin
    is honest about what it is: the merge battery is the behavioural gate for the reprocess half,
    and the corpus arm is the gate for the engine half (the choke sits mid-extract() and cannot
    be unit-called in isolation).
  * THE TRADE-OFF, pinned so nobody "fixes the data loss": a VALUED declared-absent field is
    dropped by design — a value in a field the operator declared this layout does not print is by
    definition a read of something else on the page. Human data stays sacred on the JS side
    (corrected_to survives the merge).
"""
import os
import re
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from extraction.template_matcher import hidden_fields_for_scope  # noqa: E402

passed = 0


def ok(name):
    global passed
    passed += 1
    print(f"  ok  {name}")


TPLS = [
    {"id": 4, "name": "Nordwind Refrigeration Ltd", "document_type_slug": "quote",
     "hidden_fields": ["account_no", "po_ref"]},
    {"id": 5, "name": "Ironclad Tool Hire", "document_type_slug": "quote",
     "hidden_fields": ["serials"]},
]

# ── 1. Resolver: right scope, right keys ─────────────────────────────────────
r = hidden_fields_for_scope(TPLS, "Nordwind Refrigeration Ltd", "quote")
assert r["keys"] == {"account_no", "po_ref"}, r
ok("the declaring supplier+type resolves exactly its own declared keys")

r = hidden_fields_for_scope(TPLS, "Ironclad Tool Hire", "quote")
assert r["keys"] == {"serials"}, r
ok("a sibling supplier's declarations never bleed across")

# ── 2. Unknown supplier -> NO drop (fail toward display -> review) ───────────
assert hidden_fields_for_scope(TPLS, None, "quote")["keys"] == set()
assert hidden_fields_for_scope(TPLS, "??", "quote")["keys"] == set()
ok("an unknown/short supplier resolves NOTHING — a cold document fills normally")

# ── 3. Protected keys are stripped at consumption ────────────────────────────
prot = {"supplier_name", "customer_name", "account_no"}   # account_no as a re-pointed ref role
r = hidden_fields_for_scope(TPLS, "Nordwind Refrigeration Ltd", "quote", protected_keys=prot)
assert r["keys"] == {"po_ref"}, r
ok("a protected (structural/identity) key can never be dropped, even when a stale row hides it")

# ── 4. WIRING: the engine choke point exists, gated, before Stage 4 ──────────
_eng = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                         "extraction", "engine.py"), encoding="utf-8").read()
i_choke = _eng.index('TEMPLATE_HIDDEN_FIELD_DROP')
i_stage4 = _eng.index("Stage 4: Validation", i_choke)
window = _eng[i_choke:i_stage4]
assert 'hidden_fields_for_scope' in window, \
    'the drop must use the SAME resolver as the scoring consumer — one semantics, never two'
assert '"supplier_name", "customer_name"' in window and 'ref_field_key' in window, \
    'the drop must strip the same protected keys the scoring consumer strips'
assert re.search(r'os\.environ\.get\("TEMPLATE_HIDDEN_FIELD_DROP", "0"\)', _eng), \
    'DEFAULT OFF — the flag must be opt-in'
assert 'hidden_field_drop' in window, 'the drop must emit its trace event'
ok("WIRING: one choke point, before Stage 4, same resolver + protected strip, default OFF, traced")

# ── 5. The scoring consumer is untouched (its own suite is the real pin) ─────
assert 'HIDDEN_FIELD_SCORING' in _eng
ok("the empty-scoring exclusion still exists alongside the drop (test_hidden_field_scoring.py pins it)")

print(f"\n{passed} checks passed")
