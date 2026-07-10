"""RC1 + RC5 (2026-07-10): a CUSTOM ref/date field (no shipped pattern, no admin override) is
attemptable at Stage 1 from its own DB label + role short-forms, and a seeded ref caption can't
be cross-filled by a buyer/seller party reference. Pins the auto-tier + no-regression guarantees.
    py -3.12 tests/test_custom_field_seeding.py    (from python_backend/)
"""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from extraction import keyword

CFG = json.load(open(os.path.join(os.path.dirname(__file__), "..", "..", "config",
                                  "keyword_patterns.json"), encoding="utf-8"))

fails = 0
def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond:
        fails += 1

# Custom Worksheet-like fields: reference_number/date/customer — NONE are shipped keys.
field_defs = [
    {"key": "reference_number", "label": "Reference number", "type": "reference"},
    {"key": "date",             "label": "Date",             "type": "date"},
    {"key": "customer",         "label": "Customer",         "type": "text"},
]
seeded = keyword.seed_field_labels(CFG, field_defs)
fp = seeded["field_patterns"]

# 1 — ref + date seeded; free-text NOT; auto-tier confidence below the auto-file floor
check("reference_number seeded as a ref caption", "reference_number" in fp and fp["reference_number"].get("role_caption") == "ref")
check("date seeded",                              "date" in fp)
check("free-text 'customer' NOT seeded",          "customer" not in fp)
check("seeded confidence is 80 (below auto-file floor 88)", fp["reference_number"]["base_confidence"] == 80)
check("seeded ref carries the alphanumeric gate", fp["reference_number"].get("validation") == "alphanumeric")

# 2 — the REAL Worksheet case: printed caption ("Reference No." / bare "Date") != the DB label
text = "Site / Customer\nGreenfield Nurseries\n\nReference No.    WS438527\nDate    20-01-2026\n"
res = keyword.extract_fields(text, ["reference_number", "date", "customer"], seeded)
check("ref read from a caption that differs from the DB label", res.get("reference_number", {}).get("value") == "WS438527")
check("seeded read is method 'keyword' (auto tier, not override)", res.get("reference_number", {}).get("method") == "keyword")
check("date read from a bare 'Date' caption", "20-01-2026" in (res.get("date", {}).get("value") or ""))

# 3 — party guard: a buyer-side "Customer Reference" must NOT win over the doc's own reference
text2 = "Customer Reference: CUST-999\nReference No.  WS111238\n"
res2 = keyword.extract_fields(text2, ["reference_number"], seeded)
check("party guard: reads the doc's own ref, not the customer ref", res2.get("reference_number", {}).get("value") == "WS111238")

# 4 — party guard alone: only a "Customer Reference" present → seeded ref does NOT cross-fill
text3 = "Customer Reference: CUST-999\n"
res3 = keyword.extract_fields(text3, ["reference_number"], seeded)
check("party guard: a customer-ref alone does not fill the doc ref", not res3.get("reference_number", {}).get("value"))

# 5 — additive + pure: nothing to seed → same object; shipped patterns unaffected
check("seed_field_labels(cfg, []) returns the input unchanged", keyword.seed_field_labels(CFG, []) is CFG)
inv = keyword.extract_fields("Invoice No: INV-1001\n", ["invoice_number"], seeded)
check("shipped invoice_number still reads normally", inv.get("invoice_number", {}).get("value") == "INV-1001")

print("\n" + ("%d FAILED" % fails if fails else "All custom-field seeding checks passed"))
sys.exit(1 if fails else 0)
