"""Shared, deterministic fixtures — the SINGLE source of truth for doc types, field
keys, companies/customers and content pools.

Critical design point: the ground-truth field KEYS must match the keys the project's
ExtractionEngine emits, or field-accuracy metrics compare apples to oranges. So the
generator renders these keys, the OCR agent passes DOC_TYPES as --doc-types-file, and
the metrics agent compares against them — one definition, no drift.

No real customer data — every name is invented.
"""
from __future__ import annotations

# ── Doc types (canonical) ──────────────────────────────────────────────────────
# Each: name (as it appears in the header, so name-detection can fire), slug,
# ref/date field keys, the identity/company key, and the field set with engine types.
# field type ∈ {text, date, currency, alphanumeric, number}.
DOC_TYPES = [
    {"name": "Invoice", "slug": "invoice",
     "ref_field_key": "invoice_number", "date_field_key": "invoice_date",
     "company_key": "supplier_name", "has_total": True,
     "fields": [
         {"key": "supplier_name", "label": "From", "type": "text"},
         {"key": "customer_name", "label": "Invoice To", "type": "text"},
         {"key": "invoice_number", "label": "Invoice No", "type": "alphanumeric"},
         {"key": "invoice_date", "label": "Invoice Date", "type": "date"},
         {"key": "total_amount", "label": "Total", "type": "currency"},
     ]},
    {"name": "Purchase Order", "slug": "purchase_order",
     "ref_field_key": "po_number", "date_field_key": "po_date",
     "company_key": "supplier_name", "has_total": True,
     "fields": [
         {"key": "supplier_name", "label": "Supplier", "type": "text"},
         {"key": "customer_name", "label": "Deliver To", "type": "text"},
         {"key": "po_number", "label": "PO Number", "type": "alphanumeric"},
         {"key": "po_date", "label": "Order Date", "type": "date"},
         {"key": "total_amount", "label": "Order Total", "type": "currency"},
     ]},
    {"name": "Sales Order", "slug": "sales_order",
     "ref_field_key": "sales_order_number", "date_field_key": "order_date",
     "company_key": "customer_name", "has_total": True,
     "fields": [
         {"key": "customer_name", "label": "Customer", "type": "text"},
         {"key": "supplier_name", "label": "Supplied By", "type": "text"},
         {"key": "sales_order_number", "label": "Order No", "type": "alphanumeric"},
         {"key": "order_date", "label": "Order Date", "type": "date"},
         {"key": "total_amount", "label": "Total", "type": "currency"},
     ]},
    {"name": "Receipt", "slug": "receipt",
     "ref_field_key": "receipt_number", "date_field_key": "receipt_date",
     "company_key": "supplier_name", "has_total": True,
     "fields": [
         {"key": "supplier_name", "label": "Merchant", "type": "text"},
         {"key": "receipt_number", "label": "Receipt No", "type": "alphanumeric"},
         {"key": "receipt_date", "label": "Date", "type": "date"},
         {"key": "total_amount", "label": "Amount Paid", "type": "currency"},
     ]},
    {"name": "Statement", "slug": "statement",
     "ref_field_key": "statement_number", "date_field_key": "statement_date",
     "company_key": "supplier_name", "has_total": True,
     "fields": [
         {"key": "supplier_name", "label": "From", "type": "text"},
         {"key": "customer_name", "label": "Account", "type": "text"},
         {"key": "statement_number", "label": "Statement No", "type": "alphanumeric"},
         {"key": "statement_date", "label": "Statement Date", "type": "date"},
         {"key": "total_amount", "label": "Balance Due", "type": "currency"},
     ]},
    {"name": "Delivery Note", "slug": "delivery_note",
     "ref_field_key": "delivery_number", "date_field_key": "delivery_date",
     "company_key": "supplier_name", "has_total": False,
     "fields": [
         {"key": "supplier_name", "label": "From", "type": "text"},
         {"key": "customer_name", "label": "Deliver To", "type": "text"},
         {"key": "delivery_number", "label": "Delivery No", "type": "alphanumeric"},
         {"key": "delivery_date", "label": "Delivery Date", "type": "date"},
     ]},
    {"name": "Remittance Advice", "slug": "remittance_advice",
     "ref_field_key": "remittance_number", "date_field_key": "remittance_date",
     "company_key": "customer_name", "has_total": True,
     "fields": [
         {"key": "customer_name", "label": "From", "type": "text"},
         {"key": "supplier_name", "label": "To", "type": "text"},
         {"key": "remittance_number", "label": "Remittance No", "type": "alphanumeric"},
         {"key": "remittance_date", "label": "Date", "type": "date"},
         {"key": "total_amount", "label": "Amount Paid", "type": "currency"},
     ]},
    {"name": "Letter", "slug": "letter",
     "ref_field_key": "reference", "date_field_key": "letter_date",
     "company_key": "supplier_name", "has_total": False,
     "fields": [
         {"key": "supplier_name", "label": "From", "type": "text"},
         {"key": "customer_name", "label": "To", "type": "text"},
         {"key": "reference", "label": "Our Ref", "type": "alphanumeric"},
         {"key": "letter_date", "label": "Date", "type": "date"},
     ]},
    {"name": "Order Form", "slug": "order_form",
     "ref_field_key": "form_number", "date_field_key": "form_date",
     "company_key": "supplier_name", "has_total": True,
     "fields": [
         {"key": "supplier_name", "label": "Company", "type": "text"},
         {"key": "customer_name", "label": "Name", "type": "text"},
         {"key": "form_number", "label": "Form No", "type": "alphanumeric"},
         {"key": "form_date", "label": "Date", "type": "date"},
         {"key": "total_amount", "label": "Total", "type": "currency"},
     ]},
]

DOC_TYPE_BY_SLUG = {d["slug"]: d for d in DOC_TYPES}

# Visual templates (>= 8 required). invoice_a / invoice_b are NEAR-DUPLICATES (same
# logo family, tiny layout diff) to stress template confusion / near-duplicate matching.
TEMPLATES = [
    ("invoice_a", "invoice"), ("invoice_b", "invoice"),
    ("po_a", "purchase_order"), ("sales_a", "sales_order"),
    ("receipt_a", "receipt"), ("statement_a", "statement"),
    ("delivery_a", "delivery_note"), ("remittance_a", "remittance_advice"),
    ("letter_a", "letter"), ("form_a", "order_form"),
]

# Companies (issuers) + a unique logo identity each. Logos vary in shape + placement.
COMPANIES = [
    "Northgate Supplies Ltd", "Brightline Utilities", "Meridian Office Co",
    "Harbourview Trading", "Ashfield Logistics", "Crestwave Systems",
    "Oakmount Services", "Pinnacle Print Group", "Vellum Stationers",
    "Tideway Marine", "Granite Hardware", "Lumen Electrical",
]
CUSTOMERS = [
    "Riverside Dental Practice", "Greenfield Academy", "McMahon Associates",
    "Lakeside Garden Centre", "Summit Fitness Club", "Coral Bay Hotel",
    "Westbrook Veterinary", "Stonebridge Joinery", "Aurora Web Studio",
    "Maple Court Surgery", "Beacon Hill School", "Carlton & Reeve LLP",
]

PRODUCTS = [
    "Toner cartridge", "Service call", "A4 paper box", "Maintenance contract",
    "Licence renewal", "Delivery charge", "Spare part kit", "Cleaning supplies",
    "Network cable 5m", "USB hub", "Desk lamp", "Filing cabinet",
    "Ink ribbon", "Label roll", "Safety gloves", "Hand sanitiser 5L",
]
CURRENCIES = [("GBP", "£"), ("GBP", "£"), ("GBP", "£"),
              ("USD", "$"), ("EUR", "€")]   # weighted toward GBP


def doc_types_payload():
    """The --doc-types-file payload for process_docs.py (engine field defs + detection)."""
    return [
        {"name": d["name"], "slug": d["slug"],
         "ref_field_key": d["ref_field_key"], "date_field_key": d["date_field_key"],
         "fields": [dict(f) for f in d["fields"]]}
        for d in DOC_TYPES
    ]
