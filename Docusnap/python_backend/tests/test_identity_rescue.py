"""
IDENTITY RESCUE slice 1 (gary's design, Oracle-signed 2026-07-10 with conditions C1-C6)
— engine._rescue_identity_from_scope.

The doc-1878 class: the type's IDENTITY field (customer_name, "Document Issuer") holds
quality-failed junk from a plain keyword read ('SO #'), while the supplier scope resolved
STRUCTURALLY (logo @85) and the user has confirmed the same issuer into this scope's
hints twice. No path could fix it (hints fill empty-only; a positional teach loses blind
at 50; the caption guard flags but never repairs) — the user re-typed the issuer forever.

THE PIN (C2 — fail-toward-review contract): whenever the rescue fires, confidence < 70
(the per-field review threshold DEFAULT — validator.needs_review trips on <70; note the
dependency on that default), the note is non-empty AND QUOTES THE REPLACED READ VERBATIM
(the handler persists the final value into raw/display alike, so the note is the ONLY
durable record of the original), and validator.needs_review() is True. trust.js:344-350
refusing any noted doc is the independent second auto-file lock. A future dev raising the
confidence to >=70 or dropping/trimming the note in slice 1 MUST fail this file — slice-2
graduation ships with its own adversarially-reviewed test, never by editing this one.

Run:  py -3.12 tests/test_identity_rescue.py   (from python_backend/)
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


SO_FIELDS = [
    {"key": "customer_name",      "label": "Document Issuer",    "type": "text", "required": 1},
    {"key": "order_date",         "label": "Order Date",         "type": "date", "required": 1, "is_variable": 1},
    {"key": "sales_order_number", "label": "Sales Order Number", "type": "text", "required": 1, "is_variable": 1},
]
BOTH_FIELDS = SO_FIELDS + [{"key": "supplier_name", "label": "Supplier", "type": "text"}]

BF = "Bramble & Finch Ltd"


def hints_for(value=BF, usage=2, supplier=BF, dtype="sales_order", extra=None):
    rows = [{"supplier_name": supplier, "document_type": dtype,
             "field_key": "customer_name", "hint_value": value, "usage_count": usage}]
    return rows + (extra or [])


def r1878(cn_method="keyword", cn_value="SO #", cn_conf=69,
          cn_note="unexpected characters (#) - please verify",
          sn_method="logo", sn_value=BF):
    res = {
        "order_date":         {"value": "05-05-2026", "confidence": 98, "method": "anchor_crop"},
        "sales_order_number": {"value": "0-55005",    "confidence": 85, "method": "anchor_crop"},
    }
    if cn_method is not None:
        res["customer_name"] = {"value": cn_value, "confidence": cn_conf, "method": cn_method,
                                **({"validation_note": cn_note} if cn_note else {})}
    if sn_method is not None:
        res["supplier_name"] = {"value": sn_value, "confidence": 85, "method": sn_method}
    return res


def rescue(res, hints, supplier=BF, fields=SO_FIELDS, slug="sales_order"):
    engine()._rescue_identity_from_scope(res, fields, supplier, slug, hints)
    return res


print("The doc-1878 replica — corroborated junk replaced, review-forced:")
res = rescue(r1878(), hints_for())
cn = res["customer_name"]
check("value replaced with the confirmed issuer", cn["value"] == BF)
check("method 'identity_rescue' (traceable, exempt-able)", cn["method"] == "identity_rescue")
check("PIN: confidence < 70 (review threshold default — dependency noted)", cn["confidence"] < 70)
check("PIN: note non-empty and QUOTES the replaced read verbatim ('SO #')",
      "SO #" in str(cn.get("validation_note") or ""))
check("PIN: validator.needs_review() is True", validator.needs_review(res, SO_FIELDS) is True)
check("C6: note does not summon the issuer-conflict UI",
      not __import__("re").search(r"letterhead may read|confirm the issuer",
                                  cn["validation_note"], __import__("re").I))

print("\nC1 — base-method comparison (suffix stripped; overrides never admitted):")
res = rescue(r1878(cn_method="keyword+corrected"), hints_for())
check("'keyword+corrected' incumbent IS rescuable (base method keyword)",
      res["customer_name"]["method"] == "identity_rescue")
res = rescue(r1878(cn_method="keyword_override", cn_conf=50), hints_for())
check("'keyword_override' (authoritative) NEVER rescued", res["customer_name"]["value"] == "SO #")

print("\nNegative cases — every leg of the predicate:")
for m in ("anchor_crop", "manual", "template_fixed_locked", "hint", "identity_rescue"):
    res = rescue(r1878(cn_method=m, cn_conf=50), hints_for())
    check(f"non-keyword incumbent '{m}' untouched", res["customer_name"]["value"] == "SO #")

res = rescue(r1878(cn_value="Bramble & FINCH ltd", cn_note=None, cn_conf=60), hints_for())
check("incumbent already equals the identity (case variant) — untouched",
      res["customer_name"]["value"] == "Bramble & FINCH ltd")

res = rescue(r1878(cn_value="Dunroamin Caravan Park", cn_note=None, cn_conf=85), hints_for())
check("HEALTHY read (85, no note) — never touched even with corroboration",
      res["customer_name"]["value"] == "Dunroamin Caravan Park")

res = rescue(r1878(), hints_for(usage=1))
check("hint usage < 2 — no rescue", res["customer_name"]["value"] == "SO #")

res = rescue(r1878(), hints_for(extra=[{"supplier_name": BF, "document_type": "sales_order",
                                        "field_key": "customer_name",
                                        "hint_value": "Someone Else Ltd", "usage_count": 3}]))
check("variable-IN-FACT scope (2 distinct confirmed values) — no rescue (guard inherited)",
      res["customer_name"]["value"] == "SO #")

res = rescue(r1878(), hints_for(value="Ormeau Bakery Supplies", usage=4))
check("hint disagrees with the resolved supplier — conflicting evidence, no rescue",
      res["customer_name"]["value"] == "SO #")

print("\nC3 — structural-origin gate on the resolved identity:")
res = rescue(r1878(sn_method=None), hints_for())
check("results['supplier_name'] ABSENT (no logo/template) — byte-identical no-op",
      res["customer_name"]["value"] == "SO #")
# THE REAL BF_sal_20 STATE (found by the E2E, missed by every fixture): the logo resolved
# the scope but Stage 4.5's format gate WITHHELD the field's display value (None + note).
# Structural origin is the METHOD; the corroborated value is the RESOLVED SCOPE — the
# rescue must still fire (the hint-agreement leg protects against a garbage scope).
res = rescue(r1878(sn_method="logo", sn_value=None), hints_for())
check("structural origin with WITHHELD field value (logo + format-gate None) — rescued",
      res["customer_name"]["method"] == "identity_rescue"
      and res["customer_name"]["value"] == BF)
# Oracle RIDER 1 (ratification of the withheld-value amendment): with the dict no longer
# guaranteeing a value, the RESOLVED-SCOPE ARG must carry the explicit floor — non-empty
# AND plausible — applied to the ARG, not the dict value. Pinned:
res = rescue(r1878(sn_method="logo", sn_value=None), hints_for(), supplier="")
check("RIDER 1: withheld dict + EMPTY resolved-scope arg — no fire", res["customer_name"]["value"] == "SO #")
res = rescue(r1878(sn_method="logo", sn_value=None), hints_for(supplier="IN"), supplier="IN")
check("RIDER 1: withheld dict + IMPLAUSIBLE resolved-scope arg ('IN') — no fire",
      res["customer_name"]["value"] == "SO #")
res = rescue(r1878(sn_method="hint_text_match"), hints_for())
check("hint-derived identity ('hint_text_match') — single-source, no rescue",
      res["customer_name"]["value"] == "SO #")
res = rescue(r1878(sn_method="keyword"), hints_for())
check("keyword-derived identity — no rescue", res["customer_name"]["value"] == "SO #")
res = rescue(r1878(sn_method="template_identity"), hints_for())
check("template_identity origin — rescuable", res["customer_name"]["method"] == "identity_rescue")

print("\nC3 — the hint scope compares the real document_type slug:")
res = rescue(r1878(), hints_for(dtype="Sales Order"))   # type NAME, not slug → must NOT match
check("hint stored under the type NAME (not slug) — scope mismatch, no rescue",
      res["customer_name"]["value"] == "SO #")
res = rescue(r1878(), hints_for(dtype=""))               # type-less hint applies to any slug
check("type-less hint (document_type '') still corroborates",
      res["customer_name"]["method"] == "identity_rescue")

print("\nWithheld incumbent (value None + note, method keyword) — rescue fills:")
res = rescue(r1878(cn_value=None, cn_conf=0), hints_for())
check("withheld value rescued", res["customer_name"]["value"] == BF)
check("note quotes 'nothing usable' as the original", "nothing usable" in res["customer_name"]["validation_note"])

print("\nOperator allowlists and both-keys types:")
e = engine(); e.set_accepted_names(["SO #"])
res = r1878(); e._rescue_identity_from_scope(res, SO_FIELDS, BF, "sales_order", hints_for())
check("accepted_names value — no rescue", res["customer_name"]["value"] == "SO #")
res = rescue(r1878(), hints_for(), fields=BOTH_FIELDS)
check("type with BOTH company keys — customer_name is a recipient field, no rescue",
      res["customer_name"]["value"] == "SO #")

print("\nComposition with the recipient-caption guard (one note, guard survives no-corroboration):")
e = engine()
res = r1878(cn_conf=78, cn_note=None)                     # pre-guard state: healthy-looking junk
e._flag_recipient_caption_issuer(res, SO_FIELDS, BF)
check("guard fired first (cap 69 + its note)", res["customer_name"]["confidence"] == 69
      and "recipient caption" in res["customer_name"]["validation_note"])
e._rescue_identity_from_scope(res, SO_FIELDS, BF, "sales_order", hints_for())
cn = res["customer_name"]
check("rescue then replaced it with exactly ONE note (the rescue's)",
      cn["method"] == "identity_rescue" and "replaced with this supplier's confirmed issuer" in cn["validation_note"]
      and "recipient caption" not in cn["validation_note"])
e = engine()
res = r1878(cn_conf=78, cn_note=None)
e._flag_recipient_caption_issuer(res, SO_FIELDS, BF)
e._rescue_identity_from_scope(res, SO_FIELDS, BF, "sales_order", [])   # NO corroboration
check("no corroboration — the guard's flagged behaviour survives byte-identical",
      res["customer_name"]["value"] == "SO #" and res["customer_name"]["confidence"] == 69)

print("\nKill-switch + wiring pin:")
import extraction.engine as _em
_em.IDENTITY_RESCUE_ENABLED = False
try:
    res = rescue(r1878(), hints_for())
    check("kill-switch off — byte-identical no-op", res["customer_name"]["value"] == "SO #")
finally:
    _em.IDENTITY_RESCUE_ENABLED = True
import inspect
src = inspect.getsource(ExtractionEngine.extract)
guard_at  = src.find("self._flag_recipient_caption_issuer(")
rescue_at = src.find("self._rescue_identity_from_scope(")
boost_at  = src.find("LEARNED-AGREEMENT")
check("wired in extract() AFTER the caption guard", rescue_at != -1 and guard_at != -1 and rescue_at > guard_at)
check("... and BEFORE the learned-agreement boost", boost_at != -1 and rescue_at < boost_at)

print(f"\n{fails} FAILED" if fails else "\nAll identity-rescue checks passed.")
sys.exit(1 if fails else 0)
