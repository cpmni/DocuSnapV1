"""Caption-punctuation debris strip on STRUCTURED keyword reads (owner live report
2026-08-05 — the Larkspur '. DN-98447' class). A label list carries both the dotless
and dotted caption forms ('Delivery Note No' tried before 'Delivery Note No.'); the
dotless form matches first against the printed 'Delivery Note No. DN-98447' and the
caption's own '. ' rode into the committed value — on shipped, seeded and override
labels alike. Structured validators all require an alnum start, so a leading
punctuation run is always caption debris. The seeded-ref path keeps its stronger
'No/Number' token strip; the widened path strips PUNCTUATION ONLY (a genuine
'NO-1234' code must never be mangled). Free-text reads untouched.

Run: py -3.12 tests/test_override_caption_strip.py    (from python_backend/)
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

# The live class: shipped delivery_number labels, dotted caption on the page.
text = "DELIVERY DOCKET\nDelivery Note No. DN-98447\nDate 16-08-2026\n"
res = keyword.extract_fields(text, ["delivery_number"], CFG)
check("shipped label: caption's '. ' stripped ('. DN-98447' -> 'DN-98447')",
      res.get("delivery_number", {}).get("value") == "DN-98447")

# No debris -> byte-identical.
res2 = keyword.extract_fields("Delivery Note No DN-98447\n", ["delivery_number"], CFG)
check("no caption debris -> value unchanged",
      res2.get("delivery_number", {}).get("value") == "DN-98447")

# PIN: the widened strip is PUNCTUATION-ONLY — a genuine code starting with the token
# 'NO' survives whole (the seeded-ref 'No/Number' token strip must NOT widen here).
res3 = keyword.extract_fields("Delivery Note No. NO-1234\n", ["delivery_number"], CFG)
check("PIN: 'NO-1234' code survives the widened strip whole",
      res3.get("delivery_number", {}).get("value") == "NO-1234")

# Date lane gets the same strip.
res4 = keyword.extract_fields("Invoice Date . 16-08-2026\nInvoice Number INV-1\n",
                              ["invoice_date"], CFG)
v4 = res4.get("invoice_date", {}).get("value") or ""
check("date read: leading '. ' stripped", not v4.startswith(".") and "16-08-2026" in v4)

# Seeded-ref path unchanged (its stronger token strip still fires).
field_defs = [{"key": "reference_number", "label": "Reference number", "type": "reference"}]
seeded = keyword.seed_field_labels(CFG, field_defs)
res5 = keyword.extract_fields("Reference No.  WS111238\n", ["reference_number"], seeded)
check("seeded ref path unchanged ('No.' token still stripped)",
      res5.get("reference_number", {}).get("value") == "WS111238")

print()
if fails:
    print(f"{fails} FAILED")
    sys.exit(1)
print("All caption-strip checks passed.")
