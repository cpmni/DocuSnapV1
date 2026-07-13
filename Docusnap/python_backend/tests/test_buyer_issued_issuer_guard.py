#!/usr/bin/env python3
"""tests/test_buyer_issued_issuer_guard.py — pins the BUYER-ISSUED ISSUER GUARD (Oracle-signed
2026-07-12, DROP over flag): on a Purchase Order, a supplier_name (Document Issuer) keyword read
that matched a "Supplier"/"Vendor"/"Seller" caption names the VENDOR (the party the buyer orders
from), not the issuer (the un-captioned letterhead buyer). It is DROPPED before the Stage-1 merge
so it never becomes the resolved filing/learning scope — the issuer falls to logo/letterhead/hint
or empty→review, like every other type on a cold-start DB. DROP (not flag) because the value drives
SCOPE (engine.py:2259 reads .value), so a careless confirm on a flagged value would file under a
real-but-wrong company AND learn its logo under that name (poison spreads); DROP fails to
Unknown-Company + no learning (visible, non-poisoning).

Battery on the pure `_suppress_buyer_seller_issuer` + inspect wiring pins + engine E2E fixtures
(Oracle's load-bearing `_supplier_name` scope pins). Run: py -3.12 tests/test_buyer_issued_issuer_guard.py
"""
import inspect
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from extraction.engine import ExtractionEngine

CONFIG = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                      "config", "keyword_patterns.json")
fails = 0


def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1


NORM = lambda v: " ".join(str(v or "").strip().lower().split())   # mirrors ExtractionEngine._accept_norm
SUP = ExtractionEngine._suppress_buyer_seller_issuer


def sn(value="Sandpiper Hotels", method="keyword", label="Supplier"):
    return {"supplier_name": {"value": value, "confidence": 45, "method": method, "label": label}}


def run(kw, buyer_issued=True, accepted=None):
    dropped = SUP(kw, buyer_issued, set(accepted or []), NORM)
    return dropped, ("supplier_name" in kw)


print("Pure suppressor — drops a seller caption on a buyer-issued type:")
for lbl in ("Supplier", "Vendor", "Seller"):
    d, present = run(sn(label=lbl))
    check(f"label '{lbl}' → DROPPED (returns the value, key removed)",
          d == "Sandpiper Hotels" and not present)

print("\nGenuine issuer captions on a PO are NOT dropped:")
for lbl in ("Company Name", "Issued By", "Bill From", "Business Name"):
    d, present = run(sn(label=lbl))
    check(f"label '{lbl}' → kept", d is None and present)

print("\nLearned / manual / admin methods are exempt (only plain 'keyword' is dropped):")
for meth in ("keyword_override", "logo", "template_fixed", "template_fixed_locked", "anchor_crop", "manual", "hint_text_match"):
    d, present = run(sn(method=meth))
    check(f"method '{meth}' → kept", d is None and present)

print("\nSeller-issued type (buyer_issued=False) — the Invoice case — NOT dropped:")
d, present = run(sn(), buyer_issued=False)
check("Invoice 'Supplier: Acme' style keyword read → kept (byte-identical)", d is None and present)

print("\nOperator allowlist (accepted_issuers/accepted_names) — NOT dropped (Oracle C4):")
d, present = run(sn(value="Sandpiper Hotels"), accepted=["sandpiper hotels"])
check("value in accepted set → kept", d is None and present)

print("\nKill switch + degenerate inputs:")
os.environ["BUYER_ISSUED_ISSUER_GUARD"] = "0"
d, present = run(sn())
check("BUYER_ISSUED_ISSUER_GUARD=0 → not dropped (byte-identical)", d is None and present)
del os.environ["BUYER_ISSUED_ISSUER_GUARD"]
check("guard re-enabled → drops again", run(sn())[0] == "Sandpiper Hotels")
check("no supplier_name in kw_results → None, no crash", SUP({}, True, set(), NORM) is None)
check("supplier_name not a dict → None", SUP({"supplier_name": "x"}, True, set(), NORM) is None)
check("empty label → kept (no caption attribution)", run(sn(label=""))[0] is None)

print("\nWIRING PINS (inspect) — the guard is actually called in extract() at the right place:")
src = inspect.getsource(ExtractionEngine.extract)
i_remember = src.find("_remember_candidates('1_keyword'")
i_call = src.find("_suppress_buyer_seller_issuer(")
i_merge = src.find("for key, data in kw_results.items()")
check("extract() calls _suppress_buyer_seller_issuer", i_call != -1)
check("…AFTER _remember_candidates (dropped read stays in the trace — Oracle C3)",
      i_remember != -1 and i_call > i_remember)
check("…and BEFORE the Stage-1 merge loop (so the vendor never reaches results)",
      i_merge != -1 and i_call < i_merge)
check("buyer_issued = ref role po_number OR trusted purchase_order title (Oracle C5)",
      "ref_field_key == 'po_number'" in src and "purchase_order" in src and "title_trusted" in src)
check("threads the suppressed value to the 2.5a re-adopt guard (C1)",
      "_suppressed_issuer" in src)
check("2.5a skips a hint equal to the suppressed caption (C1)",
      "_suppressed_norm" in src)

print("\nENGINE E2E (Oracle load-bearing scope pins — _supplier_name, not just the field):")
FIELDS = [{"key": "supplier_name", "label": "Document Issuer", "type": "text", "required": 1},
          {"key": "po_number", "label": "Order No.", "type": "alphanumeric", "required": 0}]
INV_FIELDS = [{"key": "supplier_name", "label": "Document Issuer", "type": "text", "required": 1},
              {"key": "invoice_number", "label": "Invoice No.", "type": "alphanumeric", "required": 0}]
PO_OCR = ("Cascade Water Systems\nSpringfield Works, Reservoir Rd\nReading RG1 8EQ\n"
          "PURCHASE ORDER   Order No. PO-84196\nSupplier\nSandpiper Hotels\n1 Esplanade Terrace\n"
          "Description   Unit Qty Amount\nCable 53.70 24 1288.80")
INV_OCR = ("INVOICE   Invoice No. INV-00123\nSupplier\nAcme Ltd\n5 High Street\nBill To\nBuyer Co")


def extract(ocr, fields, slug, ref_key, title=True):
    eng = ExtractionEngine(config_path=CONFIG)
    return eng.extract(ocr_text=ocr, page_images=[], filename="d.pdf", field_defs=fields,
                       hints=[], anchors=[], logos=[], templates=[], document_type=slug,
                       document_slug=slug, detected_slug=slug, title_trusted=title,
                       ref_field_key=ref_key, supplier_name=None)


try:
    # (a) PO with only a "Supplier:" caption source → issuer scope is None + doc routed to review.
    r = extract(PO_OCR, FIELDS, "purchase_order", "po_number")
    check("(a) PO 'Supplier: Sandpiper' → _supplier_name is None (vendor never becomes the scope)",
          r.get("_supplier_name") is None)
    check("(a) …and _needs_review is True (empty required issuer → review, like every other type)",
          r.get("_needs_review") is True)
    # (b) Invoice: the same 'Supplier:' caption legitimately names the issuer → KEPT (byte-identical).
    r = extract(INV_OCR, INV_FIELDS, "invoice", "invoice_number", title=False)
    check("(b) Invoice 'Supplier: Acme Ltd' → _supplier_name == 'Acme Ltd' (seller-issued kept)",
          (r.get("_supplier_name") or "").startswith("Acme"))
except Exception as e:
    check(f"engine E2E ran without error (got {type(e).__name__}: {e})", False)

print("\nPROCESS_DOCS threading pins:")
pd = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "process_docs.py"),
          encoding="utf-8").read()
check("ref_field_key threaded into engine.extract()", "ref_field_key = _ref_key" in pd)
check("_ref_key hoisted (Oracle C2 — no NameError when the type block is skipped)",
      "_ref_key = None" in pd)

print(f"\n{'ALL PASS' if fails == 0 else str(fails) + ' FAILED'}")
sys.exit(1 if fails else 0)
