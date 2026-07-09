"""
Recipient-caption issuer guard (Oracle-signed, 2026-07-09) — engine._flag_recipient_caption_issuer.

A doc type whose IDENTITY field is customer_name ("Document Issuer", no supplier_name field)
must never TRUST a plain 'keyword' read of it: the shipped customer_name label bank is
entirely recipient captions ("Bill To"/"Customer"/"Client"...), so the read names the
RECIPIENT, not the issuer (the sales-order buyer "Dunroamin Caravan Park" filing under the
buyer at an unflagged 78% — the reported bug). Flag-only: cap 69 + note; never rewrites.

PINS (a future dev must not undo):
  (i)  the cap is 69, NOT the codebase-conventional 70 — validator.needs_review trips on
       < 70, so a 70 cap would NOT force review on its own;
  (ii) learned/taught methods stay exempt — the guard must never nag template_fixed /
       keyword_override / anchor / hint reads (the "intelligent methods" that legitimately
       fill the issuer on subsequent docs).

Run:  py -3.12 tests/test_issuer_caption_guard.py   (from python_backend/)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from extraction.engine import ExtractionEngine
from extraction import validator

CONFIG = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                      "config", "keyword_patterns.json")

fails = 0


def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1


def engine():
    return ExtractionEngine(config_path=CONFIG)


# The sales-order-style type: customer_name IS the identity (no supplier_name field).
SO_FIELDS = [
    {"key": "customer_name",      "label": "Document Issuer",     "type": "text", "required": 1},
    {"key": "order_date",         "label": "Order Date",          "type": "date", "required": 1},
    {"key": "sales_order_number", "label": "Sales Order Number",  "type": "text", "required": 1},
]
# A type carrying BOTH keys: supplier_name is the identity; customer_name is a genuine
# recipient field that must NOT be nagged.
BOTH_FIELDS = SO_FIELDS + [{"key": "supplier_name", "label": "Supplier", "type": "text", "required": 0}]


def so_results(method="keyword", value="Dunroamin Caravan Park", conf=78, note=None):
    return {
        "customer_name":      {"value": value, "confidence": conf, "method": method,
                               **({"validation_note": note} if note else {})},
        "order_date":         {"value": "22-04-2026", "confidence": 94, "method": "keyword"},
        "sales_order_number": {"value": "SO-69786", "confidence": 85, "method": "keyword"},
    }


print("The bug case — recipient caption read into the identity field:")
e = engine()
r = so_results()
e._flag_recipient_caption_issuer(r, SO_FIELDS, "Ashford Wholesale")
cn = r["customer_name"]
check("flagged: note planted", "recipient caption" in str(cn.get("validation_note") or ""))
check("flagged: confidence capped to 69", cn["confidence"] == 69)
check("value NEVER rewritten (flag-only)", cn["value"] == "Dunroamin Caravan Park")
check("PIN (i): 69 forces needs_review", validator.needs_review(r, SO_FIELDS) is True)

print("\nPIN (i) counterfactual — the conventional 70 cap would NOT force review:")
r70 = so_results(conf=70)
check("a 70-conf read does not trip needs_review by itself (why the cap must be 69)",
      validator.needs_review(r70, SO_FIELDS) is False)

print("\nExemptions (must NOT nag):")
for m in ("template_fixed", "template_fixed_locked", "keyword_override",
          "anchor", "anchor_crop_relocated", "template_mapping", "hint", "manual"):
    e = engine()
    r = so_results(method=m, value="Ashford Wholesale", conf=95)
    e._flag_recipient_caption_issuer(r, SO_FIELDS, "Ashford Wholesale")
    ok = r["customer_name"]["confidence"] == 95 and not r["customer_name"].get("validation_note")
    check(f"PIN (ii): learned/taught method '{m}' exempt", ok)

e = engine()
r = so_results()
e._flag_recipient_caption_issuer(r, BOTH_FIELDS, "Ashford Wholesale")
check("type with BOTH keys: customer_name is a genuine recipient field — no nag",
      r["customer_name"]["confidence"] == 78 and not r["customer_name"].get("validation_note"))

e = engine()
r = so_results(value="ASHFORD wholesale")      # case variant of the resolved supplier
e._flag_recipient_caption_issuer(r, SO_FIELDS, "Ashford Wholesale")
check("value AGREEING with the resolved supplier (case variant) — no nag",
      r["customer_name"]["confidence"] == 78 and not r["customer_name"].get("validation_note"))

# The engine identity frame (normalize_supplier_name) deliberately preserves INTERIOR
# characters — a whitespace-mangled variant ("ASHFORD  wholesale") therefore NAGS, which
# fails toward review (safe). Pinned so a future "helpful" ws-collapse is a conscious change.
e = engine()
r = so_results(value="ASHFORD  wholesale")
e._flag_recipient_caption_issuer(r, SO_FIELDS, "Ashford Wholesale")
check("interior-whitespace variant nags (engine frame is strict — fail toward review)",
      r["customer_name"]["confidence"] == 69)

e = engine()
e.set_accepted_names(["Dunroamin Caravan Park"])
r = so_results()
e._flag_recipient_caption_issuer(r, SO_FIELDS, "Ashford Wholesale")
check("accepted_names allowlist — no nag",
      r["customer_name"]["confidence"] == 78 and not r["customer_name"].get("validation_note"))

e = engine()
e.set_accepted_issuers(["Dunroamin Caravan Park"])
r = so_results()
e._flag_recipient_caption_issuer(r, SO_FIELDS, "Ashford Wholesale")
check("accepted_issuers allowlist — no nag",
      r["customer_name"]["confidence"] == 78 and not r["customer_name"].get("validation_note"))

e = engine()
r = so_results(value=None)
e._flag_recipient_caption_issuer(r, SO_FIELDS, "Ashford Wholesale")
check("empty value — no nag (empty is Review's concern, not this guard's)",
      not r["customer_name"].get("validation_note"))

e = engine()
r = so_results(note="prior stage-4 note")
e._flag_recipient_caption_issuer(r, SO_FIELDS, "Ashford Wholesale")
check("already-noted field: existing note preserved, cap still applied",
      r["customer_name"]["validation_note"] == "prior stage-4 note"
      and r["customer_name"]["confidence"] == 69)

e = engine()
r = so_results()
e._flag_recipient_caption_issuer(r, SO_FIELDS, None)    # unknown sender (first doc)
check("unknown sender (no resolved supplier): first doc flags for a human",
      r["customer_name"]["confidence"] == 69
      and "recipient caption" in str(r["customer_name"].get("validation_note") or ""))

print(f"\n{fails} FAILED" if fails else "\nAll issuer-caption guard checks passed.")
sys.exit(1 if fails else 0)
