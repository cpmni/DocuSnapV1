#!/usr/bin/env python3
"""tests/test_anchor_name_lock_guard.py — pins the NAME-GUARD Layers A+B (007+gary,
2026-07-10): the MP_sal_35 'Sso'@91 class, where a below-direction anchor's label-lock
inline harvest (cross-column BY CONSTRUCTION) replaced a correct rigid name read with
junk that cleared every gate at synthetic 87-92 confidence, unflagged.

Pinned here at the predicate + branch-semantics level (the full label-lock path needs a
real page + locate; the real-document E2E on doc 2204 is the integration proof):
  a/b) _name_junk_shaped verdicts — junk on the NON-ALNUM-STRIPPED form ('Sso#' can't
       evade via the '#'), single-token <4 letters, name_quality floor.
  d)   TRADE-OFF PIN (the 2026-07-06 drift-fix class): a credible multi-word relocate
       candidate is NOT junk-shaped — Layer A/B can never trip on it, so the drift fix
       keeps replacing at full confidence. A future dev silencing review noise by
       widening the bar breaks THIS row first.
  e)   Ref fields are inert (is_name_like_field False — doubly gated in the branches).
  f)   TRADE-OFF PIN: a legit <=3-alpha brand ('IBM', '3M') IS junk-shaped by design —
       it flags into review via these wandered-read paths (fail-toward-review); the
       escape hatch is plumbing accepted-names into anchor.py, NOT widening the bar.
  g)   KEY-ONLY predicate: the field KEY decides name-likeness, never the caption
       (pinned by the signature taking no caption at all + a ref-key row).

    py -3.12 tests/test_anchor_name_lock_guard.py    (from python_backend/)
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from extraction.anchor import _name_junk_shaped

fails = 0


def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond:
        fails += 1


print("a/b — junk shapes on a name-like field (customer_name):")
check("'Sso' is junk (single token, 3 letters)",
      _name_junk_shaped("Sso", "customer_name") is True)
check("'Sso#' is junk — '#' can't push it past the bar (stripped form)",
      _name_junk_shaped("Sso#", "customer_name") is True)
check("'SO #' as a value is junk on a name field",
      _name_junk_shaped("SO #", "customer_name") is True)
check("bare digits are junk on a name field",
      _name_junk_shaped("12345", "customer_name") is True)
check("empty/None is not judged", _name_junk_shaped("", "customer_name") is False
      and _name_junk_shaped(None, "customer_name") is False)

print("d — the drift-fix class stays replaceable (TRADE-OFF PIN):")
check("'Formby & Sons' is NOT junk (real multi-word name)",
      _name_junk_shaped("Formby & Sons", "customer_name") is False)
check("'Beaumont Care Homes Ltd - Jordanstown' is NOT junk",
      _name_junk_shaped("Beaumont Care Homes Ltd - Jordanstown", "customer_name") is False)
check("single clean >=4-letter token is NOT junk ('Jordanstown')",
      _name_junk_shaped("Jordanstown", "customer_name") is False)

print("e — ref/code fields are inert (is_name_like_field False):")
check("'344' on sales_order_number not judged",
      _name_junk_shaped("344", "sales_order_number") is False)
check("'Sso#' on po_number not judged",
      _name_junk_shaped("Sso#", "po_number") is False)
check("'x' on reference_number not judged",
      _name_junk_shaped("x", "reference_number") is False)

print("f — deliberate residual (TRADE-OFF PIN): short brands flag on wandered reads:")
check("'IBM' IS junk-shaped by design (flags into review; accepted-names is the escape)",
      _name_junk_shaped("IBM", "customer_name") is True)
check("'3M' likewise", _name_junk_shaped("3M", "customer_name") is True)

print("g — key-only predicate (gary S2 residual, pinned as deliberate):")
# The predicate takes NO caption argument (key-only by signature). A custom field whose KEY
# carries a name token but which actually holds codes ('customer_order_ref') therefore gets
# judged name-like: a code read via a wandered path flags into review — NOISE, never a
# silent wrong value. Same misclassification class _name_field_code_reject already carries.
check("code on a customer-KEYED field is junk-shaped (review-noise residual, deliberate)",
      _name_junk_shaped("CO4418", "customer_order_ref") is True)

print()
print(f"{fails} FAILED" if fails else "All name-lock guard checks passed")
sys.exit(1 if fails else 0)
