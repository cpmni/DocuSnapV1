#!/usr/bin/env python3
"""tests/test_buyer_issued_convention_note.py — BUYER_ISSUED_CONVENTION_NOTE (gary lever 1,
2026-08-31, DEFAULT OFF).

The Hard Set warm measurement: all 7 buyer_issued_po docs filled the BUYER as issuer via a
learned path with NO note — correct by the 07-12 doctrine, but the silence was licensed by ANY
maturity. When armed, a learned-path fill on a buyer-issued doc stays silent only with SAME-TYPE
convention evidence (a supplier_name hint for that company on that document type, usage >= 3);
otherwise the field carries a both-parties note and the doc is review-bound. Value never
rewritten; the 07-12 vendor drop and the letterhead-scope guard untouched.

    py -3.12 tests/test_buyer_issued_convention_note.py   (from python_backend/)
"""
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from extraction.engine import ExtractionEngine                            # noqa: E402

fails = 0


def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond:
        fails += 1


norm = lambda s: re.sub(r'[^a-z0-9]+', '', str(s or '').lower())
lic = ExtractionEngine._buyer_issued_convention_licensed

H = lambda dt, val, use: {"field_key": "supplier_name", "document_type": dt,
                          "hint_value": val, "usage_count": use}

# ── The pure licence (both sides of the trade-off pinned) ────────────────────────────────────────
print("licence truth table:")
check("same-type hint usage>=3 -> LICENSED (silent, today's behaviour kept)",
      lic("Bramblewood Joinery Ltd", "purchase_order",
          [H("purchase_order", "Bramblewood Joinery Ltd", 4)], norm))
check("usage 2 -> NOT licensed (a young convention pays one extra confirm)",
      not lic("Bramblewood Joinery Ltd", "purchase_order",
              [H("purchase_order", "Bramblewood Joinery Ltd", 2)], norm))
check("WRONG type (invoice-only history) -> NOT licensed (the risk cohort)",
      not lic("Bramblewood Joinery Ltd", "purchase_order",
              [H("invoice", "Bramblewood Joinery Ltd", 40)], norm))
check("different company's hint -> NOT licensed",
      not lic("Bramblewood Joinery Ltd", "purchase_order",
              [H("purchase_order", "Quillstone Ltd", 9)], norm))
check("normalised compare (case/punct tolerant)",
      lic("BRAMBLEWOOD JOINERY LTD.", "purchase_order",
          [H("purchase_order", "Bramblewood Joinery Ltd", 3)], norm))
check("no hints / empty resolved -> NOT licensed",
      not lic("X", "purchase_order", [], norm) and not lic("", "purchase_order",
                                                           [H("purchase_order", "X", 9)], norm))
check("wrong field_key hint never licenses",
      not lic("X", "purchase_order",
              [{"field_key": "invoice_number", "document_type": "purchase_order",
                "hint_value": "X", "usage_count": 9}], norm))

# ── Source contract on the engine hook (the arm is a late, additive, value-preserving block) ─────
print()
print("source contract:")
src = open(os.path.join(os.path.dirname(__file__), "..", "extraction", "engine.py"),
           encoding="utf-8").read()
i0 = src.find("BUYER-ISSUED CONVENTION NOTE (gary lever 1")
check("the hook block exists", i0 > -1)
blk = src[i0:i0 + 3200]
check("dark gate: BUYER_ISSUED_CONVENTION_NOTE default '0' (the != '0' idiom)",
      "os.environ.get(\"BUYER_ISSUED_CONVENTION_NOTE\", \"0\") != \"0\"" in blk)
check("armed only on _buyer_issued", "_buyer_issued)" in blk)
check("learned-path methods tuple exact (letterhead_prefill excluded — it carries its own note)",
      "(\"template_fixed\", \"hint_text_match\")" in blk)
check("skips a row already noted", "not _sn_f.get(\"validation_note\")" in blk)
check("operator-accepted issuers exempt", "self.accepted_issuers" in blk)
check("both-parties wording names the suppressed vendor",
      "letterhead but names" in blk and "_suppressed_issuer" in blk)
check("generic wording when no vendor was captured",
      "usually files under the buyer" in blk)
check("review-bound", "results[\"_needs_review\"] = True" in blk)
check("VALUE NEVER REWRITTEN inside the block (no _sn_f[\"value\"] assignment)",
      "_sn_f[\"value\"] =" not in blk and "_sn_f['value'] =" not in blk)
check("the hook sits AFTER the final _overall_confidence write (late, sees the settled fill)",
      i0 > src.find("results[\"_overall_confidence\"]   = overall_conf"))
check("the 07-12 vendor DROP is untouched (still pops the caption read)",
      "kw_results.pop(\"supplier_name\", None)" in src)

print()
print("FAILED: %d" % fails if fails else "ALL PASS")
sys.exit(1 if fails else 0)
