#!/usr/bin/env python3
"""
tests/test_anchor_selection_scope.py — guards _filter_anchors' SUPPLIER-AWARE authoritative
priority (gary Slice 2, 2026-07-09). A NAMED cross-supplier authoritative teach must NOT
out-rank THIS supplier's own anchor (else supplier A's teach dominates supplier B's doc — the
cross-supplier bleed). A same-supplier teach still wins on its own doc; a __global__ teach still
sorts first everywhere (the opt-in shared-layout escape hatch).

Run:  py -3.12 python_backend/tests/test_anchor_selection_scope.py
"""
import sys
from pathlib import Path
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

fail = 0
def check(label, cond):
    global fail
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fail += 1

from extraction.anchor import _filter_anchors, _located_at_taught_position

def anchor(supplier, label, auth_at=None, usage=1):
    return {"supplier_name": supplier, "document_type": "invoice", "field_key": "invoice_number",
            "anchor_label": label, "direction": "right", "x_norm": 0.5, "y_norm": 0.3,
            "usage_count": usage, "last_authoritative_at": auth_at}

anconia_auth = anchor("Anconia Corp", "INVOICE NUMBER", auth_at="2026-07-09 09:00:56")
city_passive = anchor("City Office NI", "Invoice No", usage=20)   # own, passive, high usage
glob_auth    = anchor("__global__", "INVOICE NUMBER", auth_at="2026-07-09 10:00:00")

print("Slice 2 — cross-supplier authoritative must not out-rank own anchor:")
top_city = _filter_anchors([anconia_auth, city_passive], "City Office NI", "invoice")[0]
check("on a City Office doc, City Office's OWN passive anchor is selected (not Anconia's teach)",
      top_city.get("supplier_name") == "City Office NI")

top_anconia = _filter_anchors([anconia_auth, city_passive], "Anconia Corp", "invoice")[0]
check("on an Anconia doc, Anconia's OWN authoritative teach is selected",
      top_anconia.get("supplier_name") == "Anconia Corp")

print("invariant — same-supplier authoritative still beats a same-supplier passive:")
anconia_passive_new = anchor("Anconia Corp", "Inv No", usage=99)
top = _filter_anchors([anconia_auth, anconia_passive_new], "Anconia Corp", "invoice")[0]
check("Anconia's authoritative teach beats its own high-usage passive anchor",
      top.get("anchor_label") == "INVOICE NUMBER")

print("__global__ opt-in — a global teach still sorts first on any supplier's doc:")
top_glob = _filter_anchors([glob_auth, city_passive], "City Office NI", "invoice")[0]
check("__global__ authoritative teach sorts first (shared-layout opt-in preserved)",
      top_glob.get("supplier_name") == "__global__")

print("cross-supplier admission is IDENTITY-ONLY (positional not admitted — user direction):")
only_cross = _filter_anchors([anconia_auth], "City Office NI", "invoice")
check("Anconia's INVOICE_NUMBER (positional) teach is NOT admitted on a City Office doc",
      len(only_cross) == 0)
id_anchor = {"supplier_name": "Anconia Corp", "document_type": "invoice", "field_key": "supplier_name",
             "anchor_label": "Supplier", "direction": "right", "x_norm": 0.1, "y_norm": 0.1,
             "usage_count": 1, "last_authoritative_at": "2026-07-09 09:00:56"}
id_cross = _filter_anchors([id_anchor], "City Office NI", "invoice")
check("a supplier_name (identity) teach IS still admitted cross-supplier (re-resolution preserved)",
      len(id_cross) == 1 and id_cross[0].get("field_key") == "supplier_name")

print("007① placement gate — located caption must be at the TAUGHT position:")
# taught: value centre (0.844, 0.384), offset value_centre − label_top_left = (0.185, 0.002)
# → expected label top-left = (0.659, 0.382).
VX, VY, ODX, ODY = 0.844, 0.384, 0.185, 0.002
def loc(lx, ly): return {"label_box": {"x_norm": lx, "y_norm": ly, "w_norm": 0.12, "h_norm": 0.01}}
check("caption AT the taught position → True (same layout)",
      _located_at_taught_position(loc(0.659, 0.382), VX, VY, ODX, ODY) is True)
check("caption at a DIFFERENT X (top-left corner) → False (cross-layout false-locate)",
      _located_at_taught_position(loc(0.10, 0.382), VX, VY, ODX, ODY) is False)
check("caption at a DIFFERENT Y (mid page) → False",
      _located_at_taught_position(loc(0.659, 0.70), VX, VY, ODX, ODY) is False)
check("within X tolerance (Δ0.09 < 0.10) → True",
      _located_at_taught_position(loc(0.659 + 0.09, 0.382), VX, VY, ODX, ODY) is True)
check("beyond X tolerance (Δ0.15 > 0.10) → False",
      _located_at_taught_position(loc(0.659 + 0.15, 0.382), VX, VY, ODX, ODY) is False)
check("NO offset → False (can't verify placement → low-trust)",
      _located_at_taught_position(loc(0.659, 0.382), VX, VY, None, None) is False)
check("no located label box → False",
      _located_at_taught_position(None, VX, VY, ODX, ODY) is False)

print(f"\n{'ALL PASS' if fail == 0 else str(fail) + ' FAILED'}")
sys.exit(1 if fail else 0)
