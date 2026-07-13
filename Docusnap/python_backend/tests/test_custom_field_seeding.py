"""RC1 + RC5 (2026-07-10): a CUSTOM ref/date field (no shipped pattern, no admin override) is
attemptable at Stage 1 from its own DB label + role short-forms, and a seeded ref caption can't
be cross-filled by a buyer/seller party reference. Pins the auto-tier + no-regression guarantees.

RC1 SLICE 2 (2026-07-10 late): custom FREE-TEXT fields are now seeded too — own DB label only,
base 75, role_caption='party' arming the G1 (caption look-alike) / G2 (compound-caption tail) /
G3 (interleaved caption-fragment value) guards. The old "free-text NOT seeded" pin below was
DELIBERATELY flipped for this slice; the new pins are the guard set + the 75/keyword tier.
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

# 1 — ref + date seeded; auto-tier confidence below the auto-file floor
check("reference_number seeded as a ref caption", "reference_number" in fp and fp["reference_number"].get("role_caption") == "ref")
check("date seeded",                              "date" in fp)
check("seeded confidence is 80 (below auto-file floor 88)", fp["reference_number"]["base_confidence"] == 80)
check("seeded ref carries the alphanumeric gate", fp["reference_number"].get("validation") == "alphanumeric")

# 1b — SLICE 2: free-text 'customer' IS seeded now (the slice-1 "NOT seeded" pin was
# deliberately flipped): own label only, base 75, party guards armed, NO format validation.
check("free-text 'customer' seeded (slice 2)",   "customer" in fp)
check("free-text seeds at 75 (below seeded ref/date 80)", fp["customer"]["base_confidence"] == 75)
check("free-text seed arms the party guards",    fp["customer"].get("role_caption") == "party")
check("free-text seed carries NO validation key", "validation" not in fp["customer"])
check("free-text seed hunts the DB label only",  fp["customer"]["labels"] == ["Customer"])

# 2 — the REAL Worksheet case: printed caption ("Reference No." / bare "Date") != the DB label
text = "Site / Customer\nGreenfield Nurseries\n\nReference No.    WS438527\nDate    20-01-2026\n"
res = keyword.extract_fields(text, ["reference_number", "date", "customer"], seeded)
check("ref read from a caption that differs from the DB label", res.get("reference_number", {}).get("value") == "WS438527")
check("seeded read is method 'keyword' (auto tier, not override)", res.get("reference_number", {}).get("method") == "keyword")
check("date read from a bare 'Date' caption", "20-01-2026" in (res.get("date", {}).get("value") or ""))
check("customer read from the compound 'Site / Customer' caption (below)",
      res.get("customer", {}).get("value") == "Greenfield Nurseries")
check("customer seeded read is method 'keyword' at 75",
      res.get("customer", {}).get("method") == "keyword" and res.get("customer", {}).get("confidence") == 75)

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

# ── SLICE 2 — the party guard battery (reggie-designed; each case pins a guard) ──────────

# T-real: the MP_wor_48 COLUMN INTERLEAVE — the line after the caption in reading order is the
# RIGHT column's reference row; G3 must skip it and take the true value on the line after.
t_real = ("Site / Customer\nReference No.    WS408618\nFormby & Sons\n"
          "Work Date    10.04.2026\n133 High St\nBelfast\n")
r = keyword.extract_fields(t_real, ["customer", "reference_number", "date"], seeded)
check("T-real interleave: customer = 'Formby & Sons' (G3 skips the ref row)",
      r.get("customer", {}).get("value") == "Formby & Sons")
check("T-real interleave: the ref still reads from its own caption",
      r.get("reference_number", {}).get("value") == "WS408618")

# G1 — caption look-alikes must leave the field EMPTY (review as missing), never swallow a code
for bad in ("Customer Reference No. WS12345\n", "Customer Ref: 4118\n", "Customer No. 55\n",
            "Customer #55\n", "Customer Account 004512\n", "CUSTOMER COPY\n",
            "Customer Signature: ____\n", "Customer Services: 0800 123 456\n",
            "Customer Order No\nSO12345\n"):
    rr = keyword.extract_fields(bad, ["customer"], seeded)
    check(f"G1 leaves customer empty for {bad.splitlines()[0]!r}",
          not rr.get("customer", {}).get("value"))

# G1 address/contact family (Oracle C3): captions for OTHER data must fail-EMPTY.
for bad in ("Customer Site Address\n12 Main Street\n", "Customer Tel: 028 9022 3344\n",
            "Customer Email: info@acme.co.uk\n", "Customer Address\nBelfast\n"):
    rr = keyword.extract_fields(bad, ["customer"], seeded)
    check(f"G1 (C3) leaves customer empty for {bad.splitlines()[0]!r}",
          not rr.get("customer", {}).get("value"))

# G1 negative space: 'Customer Name' is a caption CONTINUATION — the below-direction value reads.
rn = keyword.extract_fields("Customer Name\nDunroamin Caravan Park\n", ["customer"], seeded)
check("G1 lets 'Customer Name' keep reading (below)",
      rn.get("customer", {}).get("value") == "Dunroamin Caravan Park")

# G2 — compound caption with the label FIRST: the tail is not a value; below wins.
rg2 = keyword.extract_fields("Customer / Site\nOrmeau Bakery Supplies\n", ["customer"], seeded)
check("G2 compound-caption tail never read as the value",
      rg2.get("customer", {}).get("value") == "Ormeau Bakery Supplies")

# G3-right — both captions interleaved onto ONE line: the right-read fragment is rejected,
# below's first column is the value.
rg3 = keyword.extract_fields("Customer    Reference No.\nFormby & Sons    WS408618\n",
                             ["customer"], seeded)
check("G3-right rejects the interleaved caption fragment",
      rg3.get("customer", {}).get("value") == "Formby & Sons")

# Plain reads still work (right + colon, punctuation-rich name survives).
rp = keyword.extract_fields("Customer: Beaumont Care Homes Ltd - Jordanstown\n", ["customer"], seeded)
check("plain 'Customer:' right-read survives punctuation",
      rp.get("customer", {}).get("value") == "Beaumont Care Homes Ltd - Jordanstown")

# Seeding hygiene: label under 3 chars / non-text types never seed; kill switch honoured.
fp2 = keyword.seed_field_labels(CFG, [{"key": "recipient", "label": "To", "type": "text"}])
check("label under 3 chars is not seeded",
      "recipient" not in (fp2.get("field_patterns") or {}) or fp2 is CFG)
fp3 = keyword.seed_field_labels(CFG, [{"key": "notes_blob", "label": "Notes", "type": "multiline_text"}])
check("non-'text' DB type is not seeded",
      "notes_blob" not in (fp3.get("field_patterns") or {}) or fp3 is CFG)
_old = keyword.SEED_FREE_TEXT_ENABLED
try:
    keyword.SEED_FREE_TEXT_ENABLED = False
    fp4 = keyword.seed_field_labels(CFG, [{"key": "customer", "label": "Customer", "type": "text"}])
    check("kill switch off -> free-text not seeded",
          "customer" not in (fp4.get("field_patterns") or {}) or fp4 is CFG)
finally:
    keyword.SEED_FREE_TEXT_ENABLED = _old

# Same-type sibling DEDUPE: a type carrying customer_name (shipped labels include "Customer")
# must NOT double-seed a custom 'customer' with the same caption; a type WITHOUT that sibling
# seeds freely (the global config bank alone must not block it — the Worksheet case).
fp5 = keyword.seed_field_labels(CFG, [
    {"key": "customer_name", "label": "Customer Name", "type": "text", "document_type_id": 9},
    {"key": "customer",      "label": "Customer",      "type": "text", "document_type_id": 9},
])
check("same-type sibling owning the caption blocks the seed",
      "customer" not in (fp5.get("field_patterns") or {}))
fp6 = keyword.seed_field_labels(CFG, [
    {"key": "customer", "label": "Customer", "type": "text", "document_type_id": 7},
    {"key": "customer_name", "label": "Customer Name", "type": "text", "document_type_id": 3},
])
check("a sibling on a DIFFERENT type does not block the seed",
      "customer" in (fp6.get("field_patterns") or {}))

print("\n" + ("%d FAILED" % fails if fails else "All custom-field seeding checks passed"))
sys.exit(1 if fails else 0)
