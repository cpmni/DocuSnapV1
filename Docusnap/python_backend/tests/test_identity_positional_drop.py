"""IDENTITY POSITIONAL-READ DROP (cross-supplier issuer-bleed fix; gary+Oracle-signed 2026-07-15,
NARROWED by Oracle SEND-BACK the same day).

engine._drop_positional_identity_read blanks an identity read placed by landmark GEOMETRY —
method `anchor_registration`, the ONE identity method flagged located_ok=True by fiat, so it alone
bypasses anchor._is_blind_cross_supplier_anchor. That is the exact vector by which a different
supplier's position-only ⊕ ISSUER teach, admitted cross-supplier by _anchor_matches' identity
branch, reads another supplier's page at a foreign landmark position → junk ("Item"/"Ship To:").
A live audit found ZERO confirmed docs resolve the issuer positionally, so the drop removes no win.

WHY NARROW (the original broad `startswith('anchor') or _is_stage05_located` was SENT BACK):
  - a content-LOCATED own-caption anchor read (Greenfield's 'Supplier:' line) MUST be KEPT — it
    corrects a wrong template guess (test_supplier_identity_stability), an invariant
    _is_blind_cross_supplier_anchor preserves by name;
  - an admin-curated Stage-0.5 template_mapping identity read MUST be KEPT — template-scoped, never
    cross-applied (test_supplier_name_precedence);
  - a blind rigid anchor_crop is already handled by the existing guard (located_ok=False).
The two RE-BROADENING TRIPWIRES below fail the instant a future dev restores `startswith('anchor')`
or `_is_stage05_located` to the predicate.

Run:  py -3.12 tests/test_identity_positional_drop.py   (from python_backend/)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from extraction.engine import (ExtractionEngine, _identity_key_for_type,
                               _is_positional_identity_read)

CONFIG = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                      "config", "keyword_patterns.json")
fails = 0


def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1


def eng():
    return ExtractionEngine(config_path=CONFIG)


# Field-def shapes (only 'key' is read by the derivation; label/type are decoration).
SUPPLIER_FIELDS = [{"key": "supplier_name", "label": "Document Issuer", "type": "text"},
                   {"key": "invoice_number", "label": "Invoice No", "type": "text"}]
DUAL_FIELDS     = [{"key": "supplier_name", "label": "Document Issuer", "type": "text"},
                   {"key": "customer_name", "label": "Customer",        "type": "text"},
                   {"key": "invoice_number", "label": "Invoice No",     "type": "text"}]
CUSTOMER_ONLY   = [{"key": "customer_name", "label": "Document Issuer", "type": "text"},
                   {"key": "invoice_number", "label": "Invoice No",     "type": "text"}]


def read(value="Item", method="anchor_registration", conf=78):
    return {"value": value, "confidence": conf, "method": method}


# ── _identity_key_for_type — per-type derivation ─────────────────────────────────
print("-- _identity_key_for_type --")
check("supplier_name preferred on a dual-key type",
      _identity_key_for_type(DUAL_FIELDS) == "supplier_name")
check("supplier_name on a supplier-only type",
      _identity_key_for_type(SUPPLIER_FIELDS) == "supplier_name")
check("customer_name is the identity on a customer-ONLY type",
      _identity_key_for_type(CUSTOMER_ONLY) == "customer_name")
check("None when the type carries neither identity key",
      _identity_key_for_type([{"key": "invoice_number"}]) is None)
check("None on empty field_defs", _identity_key_for_type([]) is None)
check("None on None field_defs", _identity_key_for_type(None) is None)


# ── _is_positional_identity_read — NARROW: anchor_registration ONLY ──────────────
print("-- _is_positional_identity_read: DROP (True) — geometry-placed only --")
for m in ("anchor_registration", "anchor_registration_expanded",
          "anchor_registration_salvaged"):
    check(f"'{m}' IS a positional (geometry) identity read", _is_positional_identity_read(m) is True)

print("-- _is_positional_identity_read: KEEP (False) --")
# RE-BROADENING TRIPWIRE 1: content-located Stage-2 anchor reads off a REAL caption (Greenfield's
# 'Supplier:' line) MUST be kept — these fail the instant a dev restores `startswith('anchor')`.
for m in ("anchor", "anchor_inline", "anchor_crop", "anchor_crop_relocated",
          "anchor_crop_recovered", "anchor_crop_slipfix", "anchor_crop_crosscheck",
          "anchor_vetoed"):
    check(f"located/blind anchor read '{m}' is KEPT (not geometry-placed) [tripwire: startswith('anchor')]",
          _is_positional_identity_read(m) is False)
# RE-BROADENING TRIPWIRE 2: admin-curated Stage-0.5 mappings MUST be kept — these fail the instant
# a dev restores `_is_stage05_located` to the predicate.
for m in ("template_mapping", "template_mapping_expanded", "template_mapping_salvaged",
          "template_registration", "template_registration_expanded"):
    check(f"Stage-0.5 curated read '{m}' is KEPT (template-scoped) [tripwire: _is_stage05_located]",
          _is_positional_identity_read(m) is False)
# content-anchored identity origins — always kept
for m in ("logo", "template_fixed", "template_fixed_locked", "template_identity",
          "template_anchor", "keyword", "keyword_override", "hint_text_match", "manual",
          "type_ambiguity", "unknown", "", None):
    check(f"'{m}' is NOT a positional read", _is_positional_identity_read(m) is False)


# ── _drop_positional_identity_read — the seam behaviour ──────────────────────────
print("-- drop: an anchor_registration supplier_name read is BLANKED --")
e = eng()
r = {"supplier_name": read("Item", "anchor_registration"),
     "invoice_number": {"value": "INV-9", "confidence": 95, "method": "keyword"}}
e._drop_positional_identity_read(r, SUPPLIER_FIELDS)
check("value blanked to None", r["supplier_name"]["value"] is None)
check("confidence dropped to 0", r["supplier_name"]["confidence"] == 0)
check("carries a review note", bool(r["supplier_name"].get("validation_note")))
check("dict kept (key still present)", "supplier_name" in r)
check("sibling field untouched", r["invoice_number"]["value"] == "INV-9")

print("-- PIN: a LOCATED own-caption anchor read (Greenfield 'Supplier:') is KEPT --")
# This is the invariant the broad predicate wrongly regressed. It MUST survive the drop, so the
# supplier's own-caption identity read still corrects a wrong template guess.
e = eng()
r = {"supplier_name": {"value": "Greenfield Logistics Ltd", "confidence": 95, "method": "anchor",
                       "anchor": "Supplier"}}
e._drop_positional_identity_read(r, SUPPLIER_FIELDS)
check("located 'anchor' issuer read survives the drop",
      r["supplier_name"]["value"] == "Greenfield Logistics Ltd")

print("-- PIN: an admin-drawn Stage-0.5 template_mapping read is KEPT --")
e = eng()
r = {"supplier_name": {"value": "City Office NI", "confidence": 90, "method": "template_mapping"}}
e._drop_positional_identity_read(r, SUPPLIER_FIELDS)
check("template_mapping issuer read survives the drop",
      r["supplier_name"]["value"] == "City Office NI")

print("-- PIN: a customer_name registration read on a DUAL-key type is UNAFFECTED --")
e = eng()
r = {"supplier_name": {"value": "Northgate Textiles", "confidence": 96, "method": "logo"},
     "customer_name":  read("Dunroamin Caravan Park", "anchor_registration")}
e._drop_positional_identity_read(r, DUAL_FIELDS)
check("customer_name (recipient) left intact",
      r["customer_name"]["value"] == "Dunroamin Caravan Park")
check("supplier_name (logo) left intact", r["supplier_name"]["value"] == "Northgate Textiles")

print("-- customer_name IS the identity on a customer-only type → registration read dropped --")
e = eng()
r = {"customer_name": read("Item", "anchor_registration")}
e._drop_positional_identity_read(r, CUSTOMER_ONLY)
check("customer-only identity registration read blanked", r["customer_name"]["value"] is None)

print("-- a blind rigid anchor_crop identity read is KEPT here (existing blind guard handles it) --")
e = eng()
r = {"supplier_name": read("SomeVendor", "anchor_crop")}
e._drop_positional_identity_read(r, SUPPLIER_FIELDS)
check("anchor_crop issuer read is not touched by THIS drop",
      r["supplier_name"]["value"] == "SomeVendor")

print("-- EXCLUDED content-anchored identity reads survive --")
for m in ("logo", "template_fixed", "template_identity", "template_anchor",
          "keyword", "keyword_override", "hint_text_match", "manual"):
    e = eng()
    r = {"supplier_name": read("Real Supplier Co", m)}
    e._drop_positional_identity_read(r, SUPPLIER_FIELDS)
    check(f"'{m}' issuer read kept", r["supplier_name"]["value"] == "Real Supplier Co")

print("-- kill switch off → byte-identical (no drop) --")
os.environ["IDENTITY_POSITIONAL_DROP"] = "0"
try:
    e = eng()
    r = {"supplier_name": read("Item", "anchor_registration")}
    e._drop_positional_identity_read(r, SUPPLIER_FIELDS)
    check("kill switch preserves the value", r["supplier_name"]["value"] == "Item")
finally:
    del os.environ["IDENTITY_POSITIONAL_DROP"]

print("-- no-ops: empty/None value, no identity key --")
e = eng()
r = {"supplier_name": read(None, "anchor_registration")}
e._drop_positional_identity_read(r, SUPPLIER_FIELDS)
check("None-valued registration read is a no-op (nothing to drop)",
      r["supplier_name"]["value"] is None and "validation_note" not in r["supplier_name"])
e = eng()
r = {"invoice_number": {"value": "INV-9", "confidence": 95, "method": "keyword"}}
e._drop_positional_identity_read(r, [{"key": "invoice_number"}])
check("no identity key → untouched", r["invoice_number"]["value"] == "INV-9")


print()
if fails:
    print(f"FAILED: {fails} check(s)")
    sys.exit(1)
print("ALL PASS")
