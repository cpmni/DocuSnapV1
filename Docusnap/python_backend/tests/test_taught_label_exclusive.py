"""test_taught_label_exclusive.py — a taught caption REPLACES the shipped keyword bank.

Run: py -3.12 python_backend/tests/test_taught_label_exclusive.py

THE DEFECT (owner-reported, 2026-08-11). A forall teach persists `anchor_label` into
`field_anchors`, which drives STAGE 2 anchoring. Stage 1 keyword carried on with the shipped caption
bank, so a correct taught `po_number` mapping coexisted with a keyword still hunting the generic
'ref'. In the owner's words: "when we draw an anchor and set the label, set that confirmed label as
the ONLY keyword on that doc for that field."

WHY ADDITIVE WAS NOT ENOUGH, which is the whole reason this file exists. An override was already
consulted FIRST — but `extract_fields` falls THROUGH to the shipped labels when the override label
is not found on the page or its value fails the field's format gate. On a document where both
'Purchase Order No' and 'Ref' are printed, that fall-through is exactly how 'Ref' kept winning.
Precedence is not exclusivity.

THE CONTRACT:
  * an override WITHOUT `exclusive` behaves exactly as it did before — prepended, shipped labels
    preserved. Any change there is a regression for every admin-typed override in the field.
  * an override WITH `exclusive` leaves the field's shipped labels gone.
  * `merge_label_overrides` stays PURE — the caller's patterns dict is threaded into every stage
    and must never be mutated.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from extraction.keyword import merge_label_overrides  # noqa: E402

passed = 0


def ok(name):
    global passed
    passed += 1
    print(f"  ok  {name}")


def labels_of(pats, key="po_number"):
    """The label bank as plain strings — an override is stored in dict form so the winning hit can
    be tagged `keyword_override`, so compare text, not object identity."""
    out = []
    for x in pats["field_patterns"][key].get("labels") or []:
        out.append(x.get("text") if isinstance(x, dict) else x)
    return out


def shipped():
    return {"field_patterns": {
        "po_number": {"labels": ["Ref", "Your PO", "Order No"],
                      "directions": ["right"], "base_confidence": 80},
        "account_no": {"labels": ["Account No"], "directions": ["right"], "base_confidence": 80},
    }}


SLUG = "invoice"

# ── 1. The pre-existing ADDITIVE behaviour is untouched ─────────────────────
pats = shipped()
add = merge_label_overrides(
    pats, [{"doc_type_slug": SLUG, "field_key": "po_number", "label": "Purchase Order No"}], SLUG)
assert labels_of(add) == ["Purchase Order No", "Ref", "Your PO", "Order No"], labels_of(add)
ok("an admin-typed override is still PREPENDED, shipped labels preserved (no regression)")

# ── 2. EXCLUSIVE replaces ───────────────────────────────────────────────────
# RED-FIRST: run this file against the commit before migration 61 and this assertion fails with
# the additive list — the behaviour it pins genuinely did not exist.
pats = shipped()
exc = merge_label_overrides(
    pats, [{"doc_type_slug": SLUG, "field_key": "po_number",
            "label": "Purchase Order No", "exclusive": 1}], SLUG)
assert labels_of(exc) == ["Purchase Order No"], labels_of(exc)
ok("an EXCLUSIVE override is the ONLY label left — 'Ref' can no longer win")

# ── 3. Exclusivity is per FIELD, not per document type ──────────────────────
assert labels_of(exc, "account_no") == ["Account No"], labels_of(exc, "account_no")
ok("a sibling field on the same doc type keeps its shipped labels")

# ── 4. TWO exclusive labels for one field both survive ──────────────────────
# The bank is cleared ONCE per field, not once per override. Clearing inside the per-override loop
# would drop the first taught label when a second arrived — silently, and only for operators who
# taught the same field twice.
pats = shipped()
two = merge_label_overrides(pats, [
    {"doc_type_slug": SLUG, "field_key": "po_number", "label": "Purchase Order No", "exclusive": 1},
    {"doc_type_slug": SLUG, "field_key": "po_number", "label": "PO Number", "exclusive": 1},
], SLUG)
assert set(labels_of(two)) == {"Purchase Order No", "PO Number"}, labels_of(two)
assert "Ref" not in labels_of(two)
ok("two taught labels for one field BOTH survive, and the shipped bank is still gone")

# ── 5. Mixed exclusive + additive on the same field ─────────────────────────
# The exclusive one clears the bank; the additive one then rides along. Recorded as a decision
# rather than an accident: exclusivity is a property of the FIELD once any taught label claims it.
pats = shipped()
mixed = merge_label_overrides(pats, [
    {"doc_type_slug": SLUG, "field_key": "po_number", "label": "Taught Caption", "exclusive": 1},
    {"doc_type_slug": SLUG, "field_key": "po_number", "label": "Admin Caption"},
], SLUG)
assert "Ref" not in labels_of(mixed), labels_of(mixed)
assert set(labels_of(mixed)) == {"Taught Caption", "Admin Caption"}, labels_of(mixed)
ok("PINNED: one exclusive label makes the FIELD exclusive; an additive sibling still applies")

# ── 6. Wrong doc type does nothing ──────────────────────────────────────────
pats = shipped()
other = merge_label_overrides(
    pats, [{"doc_type_slug": "credit_note", "field_key": "po_number",
            "label": "Purchase Order No", "exclusive": 1}], SLUG)
assert labels_of(other) == ["Ref", "Your PO", "Order No"]
ok("an override for another doc type is ignored — the bank is untouched")

# ── 7. PURITY — the caller's dict is threaded into every stage ──────────────
pats = shipped()
merge_label_overrides(pats, [{"doc_type_slug": SLUG, "field_key": "po_number",
                              "label": "Purchase Order No", "exclusive": 1}], SLUG)
assert labels_of(pats) == ["Ref", "Your PO", "Order No"], labels_of(pats)
ok("the input patterns object is NOT mutated (it is shared by every stage)")

# ── 8. CONTROL — the two paths really are different ─────────────────────────
# Without this, checks 1 and 2 could both pass against an implementation that ignored the flag.
assert labels_of(add) != labels_of(exc)
ok("CONTROL: additive and exclusive produce different banks from the same input")

print(f"\n{passed} checks passed")
