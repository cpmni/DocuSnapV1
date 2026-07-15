"""c2 — TAUGHT-FIELD OWNERSHIP GUARD (DIRECTION_SUPREMACY, Oracle-signed 2026-07-11).

engine._flag_taught_field_ownership: a NON-identity field whose FINAL read is a plain 'keyword'
match, while the user AUTHORITATIVELY taught that field's position for this scope, is a generic-
caption stand-in for a taught position that couldn't be confirmed on this page -> HOLD-ONLY cap 69
+ note (never touches the value). Plus the shared caption vocabulary (keyword.build_caption_vocab /
value_is_caption) it and G3b share.

Pins the Oracle conditions: customer_name (a RECIPIENT field post-migration-44) IS armed (NOT
excluded via _IDENTITY_FIELD_KEYS, which still lists it); anchor_admissible ADMITS a '__unknown__'
anchor so the explicit fallback-scope exclusion is load-bearing; _apply_hints variability parity;
caption-hint poison-loop deny; kill switch.

Run:  py -3.12 tests/test_taught_field_ownership.py   (from python_backend/)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from extraction.engine import ExtractionEngine
from extraction import engine as engine_mod
from extraction import keyword, anchor

CONFIG = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                      "config", "keyword_patterns.json")
fails = 0


def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1


# ── shared caption vocabulary ─────────────────────────────────────────────────
print("-- caption vocab (shared with G3b) --")
FP = {'customer_name': {'labels': ['Customer', {'text': 'Bill To'}]},
      'sales_order_number': {'labels': ['Order Number', 'SO #', 'S.O.No.']}}
FIELDS = [
    {"key": "supplier_name",      "label": "Document Issuer",    "type": "text", "required": 1},
    {"key": "customer_name",      "label": "Customer",           "type": "text", "required": 0},
    {"key": "sales_order_number", "label": "Sales Order Number", "type": "text", "required": 1, "is_variable": 1},
    {"key": "account_terms",      "label": "Terms",              "type": "text", "required": 0},
]
VOCAB = keyword.build_caption_vocab(FP, FIELDS)
check("'SO #' IS a caption (rule 1 token-tuple)", keyword.value_is_caption('SO #', VOCAB) is True)
check("bare 'SO' dies by rule 1 (SO # -> ('so',))", keyword.value_is_caption('SO', VOCAB) is True)
check("'S.O.No.' matches 'SO No'? no such label — but 'Order Number' joined survives",
      keyword.value_is_caption('Order Solutions Ltd', VOCAB) is False)
check("'S.O.No.' IS a caption (rule 2 joined, punctuated)", keyword.value_is_caption('S.O.No.', VOCAB) is True)
check("containment does NOT match ('Total Office Supplies')",
      keyword.value_is_caption('Total Office Supplies', VOCAB) is False)
check("a real name survives", keyword.value_is_caption('Cavehill Joinery', VOCAB) is False)
check("'#'-only value never matches (empty content tuple)", keyword.value_is_caption('#', VOCAB) is False)
check("field DISPLAY label armed ('Document Issuer')", keyword.value_is_caption('Document Issuer', VOCAB) is True)


# ── ownership guard ───────────────────────────────────────────────────────────
def eng():
    return ExtractionEngine(config_path=CONFIG)


# field_anchors.document_type stores the SLUG (verified vs the live DB) — anchors here MUST use
# the slug, or the test would pass in a self-consistent-but-wrong NAME frame (the "dead guard
# greens every test" trap that hid the real slug/name admission bug).
def anc(field_key, sup='Bramble & Finch Ltd', slug='sales_order', auth='2026-07-11 10:00:00'):
    return {"field_key": field_key, "supplier_name": sup, "document_type": slug,
            "last_authoritative_at": auth, "anchor_label": "x", "direction": "below"}


def kw(value, conf=83, method='keyword', note=None):
    d = {"value": value, "confidence": conf, "method": method}
    if note:
        d["validation_note"] = note
    return d


def run(results, anchors=None, hints=None, fields=None, sup='Bramble & Finch Ltd',
        slug='sales_order', vocab=None):
    eng()._flag_taught_field_ownership(results, fields or FIELDS, sup, anchors or [],
                                       hints or [], slug, VOCAB if vocab is None else vocab)
    return results


print("-- ownership guard --")

# 1. customer_name (RECIPIENT, armed) keyword caption read + authoritative teach -> capped + note
r = run({"customer_name": kw('SO #')}, anchors=[anc('customer_name')])
cn = r["customer_name"]
check("customer_name capped to 69", cn["confidence"] == 69)
check("customer_name got the taught-position note", 'taught position' in (cn.get("validation_note") or ''))
check("customer_name VALUE untouched (hold-only)", cn["value"] == 'SO #')
# PIN the slug/name frame (the bug that showed as 0 caps in the first A/B): field_anchors stores
# the SLUG, so admission must use the slug. A NAME-framed call leaves `owned` empty -> no cap.
check("PIN: anchor admitted by SLUG, NOT by NAME (frame must match field_anchors)",
      anchor.anchor_admissible(anc('customer_name'), 'Bramble & Finch Ltd', 'sales_order') is True
      and anchor.anchor_admissible(anc('customer_name'), 'Bramble & Finch Ltd', 'Sales Order') is False)

# 2. keyword_override is exempt BY CONSTRUCTION (method != 'keyword')
r = run({"customer_name": kw('SO #', method='keyword_override')}, anchors=[anc('customer_name')])
check("keyword_override NOT capped", r["customer_name"]["confidence"] == 83 and not r["customer_name"].get("validation_note"))

# 3. empty/None value is skipped (no confusing cap on a withheld field)
r = run({"customer_name": kw(None)}, anchors=[anc('customer_name')])
check("empty value not capped / no note", not r["customer_name"].get("validation_note"))

# 4. supplier_name (IDENTITY) excluded — handled by the recipient/rescue guards
r = run({"supplier_name": kw('Order Number')}, anchors=[anc('supplier_name')])
check("supplier_name NOT capped by c2 (identity excluded)",
      r["supplier_name"]["confidence"] == 83 and not r["supplier_name"].get("validation_note"))

# 5. __unknown__ fallback-scope anchor is NOT ownership — and the wrapper ADMITS it (load-bearing pin)
check("PIN: anchor_admissible ADMITS a '__unknown__' anchor (why the a_sup exclusion is needed)",
      anchor.anchor_admissible(anc('customer_name', sup='__unknown__'), 'Bramble & Finch Ltd', 'sales_order') is True)
r = run({"customer_name": kw('SO #')}, anchors=[anc('customer_name', sup='__unknown__')])
check("__unknown__ anchor does NOT trigger ownership cap", not r["customer_name"].get("validation_note"))

# 6. a PASSIVE (non-authoritative) anchor is not ownership
r = run({"customer_name": kw('SO #')}, anchors=[anc('customer_name', auth='')])
check("passive (no last_authoritative_at) anchor -> no cap", not r["customer_name"].get("validation_note"))

# 7. hint-agreement exemption (STABLE field): keyword value agrees with a usage>=2 single-value hint
HINT = lambda v, u=3, k='account_terms': {"field_key": k, "hint_value": v, "usage_count": u,
                                          "supplier_name": "Bramble & Finch Ltd", "document_type": "sales_order"}
r = run({"account_terms": kw('Net 30')}, anchors=[anc('account_terms')], hints=[HINT('Net 30')])
check("owned STABLE field exempt when a confirmed hint agrees", r["account_terms"]["confidence"] == 83)

# 8. variability-by-evidence (>=2 distinct confirmed values) DENIES the exemption (parity w/ _apply_hints)
r = run({"account_terms": kw('Net 30')}, anchors=[anc('account_terms')],
        hints=[HINT('Net 30'), HINT('Net 60')])
check("variable-by-evidence field NOT exempt -> capped", r["account_terms"]["confidence"] == 69)

# 9. caption-hint poison loop: hint AGREES but is itself a caption -> deny exemption -> capped
r = run({"customer_name": kw('SO #')}, anchors=[anc('customer_name')],
        hints=[HINT('SO #', k='customer_name')])
check("caption-valued hint does NOT grant exemption (poison loop closed)",
      r["customer_name"]["confidence"] == 69)

# 10. an existing note is preserved; the cap still applies
r = run({"customer_name": kw('SO #', note='earlier note')}, anchors=[anc('customer_name')])
check("existing note preserved", r["customer_name"]["validation_note"] == 'earlier note')
check("cap still applied over an existing note", r["customer_name"]["confidence"] == 69)

# 11. kill switch off -> byte-identical (no cap)
_saved = engine_mod.TAUGHT_FIELD_OWNERSHIP_ENABLED
try:
    engine_mod.TAUGHT_FIELD_OWNERSHIP_ENABLED = False
    r = run({"customer_name": kw('SO #')}, anchors=[anc('customer_name')])
    check("kill switch OFF -> not capped", r["customer_name"]["confidence"] == 83 and not r["customer_name"].get("validation_note"))
finally:
    engine_mod.TAUGHT_FIELD_OWNERSHIP_ENABLED = _saved


# ── corroboration exemption (gary+Oracle SIGN-OFF-WITH-CONDITIONS 2026-07-15) ──────────────────
# The ownership cap is DECLINED when the taught position ITSELF corroborated the value: a same-field
# candidate that is authoritative (the ⊕ teach) / located / Stage-0.5 read the EXACT SAME non-caption
# value the keyword winner did. Oracle C1: a BLIND non-authoritative anchor may NOT vouch.
print("-- corroboration exemption --")
NAME = 'Fernbank Veterinary Clinic'

def cand(value, method='anchor_crop', authoritative=False, located=False):
    return {"value": value, "method": method, "confidence": 50,
            "authoritative": authoritative, "located": located}

def run_c(results, candidates, anchors=None):
    e = eng()
    e._field_candidates = candidates or {}
    e._flag_taught_field_ownership(results, FIELDS, 'Bramble & Finch Ltd', anchors or [],
                                   [], 'sales_order', VOCAB)
    return results

# T1 INCIDENT: keyword@75 name + admissible taught anchor + AUTHORITATIVE (blind, located=False)
# candidate reading the SAME name -> NOT capped (the taught position corroborated).
r = run_c({"customer_name": kw(NAME, conf=75)},
          {"customer_name": [cand(NAME, method='anchor_crop', authoritative=True, located=False)]},
          anchors=[anc('customer_name')])
check("T1 incident: authoritative anchor agrees -> NOT capped (conf 75 kept)", r["customer_name"]["confidence"] == 75)
check("T1 incident: no taught-position note added", not r["customer_name"].get("validation_note"))

# T1b LOCATED variant (located=True, not authoritative) also corroborates.
r = run_c({"customer_name": kw(NAME, conf=75)},
          {"customer_name": [cand(NAME, method='anchor_crop_relocated', authoritative=False, located=True)]},
          anchors=[anc('customer_name')])
check("T1b located anchor agrees -> NOT capped",
      r["customer_name"]["confidence"] == 75 and not r["customer_name"].get("validation_note"))

# T2 CAPTION-BOTH: both keyword and anchor read a CAPTION ('SO #') -> STILL capped (agreement on a
# caption is not corroboration of a real value; pins the bug can't be restored).
r = run_c({"customer_name": kw('SO #')},
          {"customer_name": [cand('SO #', authoritative=True)]},
          anchors=[anc('customer_name')])
check("T2 caption both sides -> STILL capped @69", r["customer_name"]["confidence"] == 69)
check("T2 caption both sides -> note present", 'taught position' in (r["customer_name"].get("validation_note") or ''))

# T3 (pins Oracle C1): a BLIND NON-authoritative candidate (passive/global/late-rescue) matching the
# value may NOT vouch -> STILL capped.
r = run_c({"customer_name": kw(NAME, conf=75)},
          {"customer_name": [cand(NAME, method='anchor_crop', authoritative=False, located=False)]},
          anchors=[anc('customer_name')])
check("T3 blind non-authoritative anchor -> STILL capped @69 (Oracle C1)", r["customer_name"]["confidence"] == 69)

# T4 different anchor value -> STILL capped.
r = run_c({"customer_name": kw(NAME, conf=75)},
          {"customer_name": [cand('Someone Else Ltd', authoritative=True)]},
          anchors=[anc('customer_name')])
check("T4 anchor read a DIFFERENT value -> STILL capped @69", r["customer_name"]["confidence"] == 69)

# T5 sub kill-switch off on the T1 setup -> capped again.
_savedc = engine_mod.TAUGHT_OWNERSHIP_CORROBORATE
try:
    engine_mod.TAUGHT_OWNERSHIP_CORROBORATE = False
    r = run_c({"customer_name": kw(NAME, conf=75)},
              {"customer_name": [cand(NAME, authoritative=True)]},
              anchors=[anc('customer_name')])
    check("T5 TAUGHT_OWNERSHIP_CORROBORATE=0 -> capped again @69", r["customer_name"]["confidence"] == 69)
finally:
    engine_mod.TAUGHT_OWNERSHIP_CORROBORATE = _savedc

# T6 BASELINE empty ledger -> STILL capped @69 (byte-identical to pre-change).
r = run_c({"customer_name": kw(NAME, conf=75)}, {}, anchors=[anc('customer_name')])
check("T6 empty ledger -> STILL capped @69 (byte-identical)", r["customer_name"]["confidence"] == 69)

# T7 candidate matches but method is 'hint' (not anchor/located/stage-0.5) -> STILL capped.
r = run_c({"customer_name": kw(NAME, conf=75)},
          {"customer_name": [cand(NAME, method='hint', authoritative=False, located=False)]},
          anchors=[anc('customer_name')])
check("T7 non-anchor candidate (hint) agrees -> STILL capped @69", r["customer_name"]["confidence"] == 69)

print()
if fails:
    print(f"FAILED: {fails}")
    sys.exit(1)
print("All taught-field-ownership (c2) checks passed")
