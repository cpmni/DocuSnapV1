"""Stage 2.6 LATE-ANCHOR RESCUE (2026-07-10) — guards engine.py's rescue block + the
anchor.anchor_admissible delta.

The bug class: on a doc whose supplier resolves LATE (no template/logo — Stage 2.5a text
scan), Stage 2 runs with supplier=None, so _anchor_matches cannot admit that supplier's OWN
positional anchors (only identity anchors ride the type-match branch) — the user's teaching
is silently ignored on exactly the docs that need it most (MP_wor_48 'customer'). The rescue
re-runs anchor extraction over the DELTA OF ADMISSION after 2.5a resolves the supplier:
fill-empty-only, conf capped 85, kill-switched.

Hermetic: keyword.extract_fields + anchor.extract_with_anchors are stubbed, so supplier
resolution comes ONLY from the 2.5a hint text-scan and no OCR runs.

    py -3.12 tests/test_late_anchor_rescue.py    (from python_backend/)
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from PIL import Image

from extraction import engine as eng
from extraction import anchor as anc
from extraction import keyword

fails = 0


def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond:
        fails += 1


MER = "Meridian Print & Copy"

def _a(field_key, supplier, dtype, **kw):
    base = dict(field_key=field_key, supplier_name=supplier, document_type=dtype,
                anchor_label=kw.pop("label", "Label"), direction="right",
                x_norm=0.15, y_norm=0.26, w_norm=0.25, h_norm=0.017,
                usage_count=1, confidence=1.0)
    base.update(kw)
    return base


ANCHORS = [
    _a("customer", MER, "worksheet", label="ie), Oo Sp",
       last_authoritative_at="2026-07-10"),                    # the poisoned taught anchor
    _a("supplier_name", MER, "worksheet", label="Document Issuer"),   # identity
    _a("reference_number", "__global__", "worksheet"),               # global
    _a("customer", "Other Corp", "worksheet"),                       # foreign positional
    _a("date", MER, "invoice"),                                      # own anchor, WRONG type
    _a("date", MER, None),                                           # legacy NULL-type row (Oracle C4)
]


def rescue_delta(anchors, supplier, slug):
    """MIRRORS the engine's Stage-2.6 delta expression (incl. the same-type tightening)."""
    return [a for a in anchors
            if (a.get("document_type") or "") == (slug or "")
            and anc.anchor_admissible(a, supplier, slug)
            and not anc.anchor_admissible(a, None, slug)]


# ── 1 · the delta of admission is EXACTLY the resolved supplier's own SAME-TYPE
#        positional anchors ──
delta = rescue_delta(ANCHORS, MER, "worksheet")
check("delta contains the supplier's own positional anchor only",
      [a["field_key"] for a in delta] == ["customer"] and delta[0]["supplier_name"] == MER)
check("identity anchor excluded (already admitted under None)",
      not any(a["field_key"] == "supplier_name" for a in delta))
check("__global__ anchor excluded (already admitted under None)",
      not any(a["supplier_name"] == "__global__" for a in delta))
check("a DIFFERENT named supplier's positional anchor excluded (fails under both)",
      not any(a["supplier_name"] == "Other Corp" for a in delta))
check("own anchor of a DIFFERENT doc type excluded",
      not any(a["document_type"] == "invoice" for a in delta))
check("legacy NULL-type row excluded by the same-type tightening (Oracle C4)",
      not any(a["document_type"] is None for a in delta))

# ── engine-level harness ─────────────────────────────────────────────────────────────────
FIELD_DEFS = [
    {"key": "supplier_name",    "label": "Document Issuer",  "type": "text",      "document_type_id": 7},
    {"key": "customer",         "label": "Customer",         "type": "text",      "document_type_id": 7},
    {"key": "reference_number", "label": "Reference number", "type": "reference", "document_type_id": 7},
    {"key": "date",             "label": "Date",             "type": "date",      "document_type_id": 7},
]
HINTS = [{"field_key": "supplier_name", "hint_value": MER, "usage_count": 5,
          "supplier_name": MER, "document_type": "worksheet"}]
OCR = "WORKSHEET\nSite / Customer\nFormby & Sons\n" + MER + "\n"
PAGE = [Image.new("L", (80, 100), 255)]


def run(stage2_returns=None, rescue_returns=None, hints=HINTS, kw_returns=None):
    """Run engine.extract with keyword + anchor stages stubbed. Returns (results, calls)
    where calls = list of (supplier_name_arg, [field_keys of anchors passed])."""
    calls = []

    def fake_anchor_extract(ocr_text, anchors, supplier_name, document_type, **kwargs):
        calls.append((supplier_name, sorted(a.get("field_key") for a in anchors)))
        if supplier_name == MER:
            return dict(rescue_returns or {})
        return dict(stage2_returns or {})

    def fake_keyword_extract(*a, **k):
        return dict(kw_returns or {})

    real_anchor, real_kw = anc.extract_with_anchors, keyword.extract_fields
    anc.extract_with_anchors = fake_anchor_extract
    keyword.extract_fields = fake_keyword_extract
    try:
        e = eng.ExtractionEngine(mode="smart", config_path=None)
        results = e.extract(OCR, PAGE, "MP_wor_48.pdf", FIELD_DEFS,
                            hints, list(ANCHORS), [],
                            document_type="Worksheet", document_slug="worksheet")
        return results, calls
    finally:
        anc.extract_with_anchors = real_anchor
        keyword.extract_fields = real_kw


RESCUE_VAL = {"customer": {"value": "Formby & Sons", "confidence": 96, "method": "anchor_crop"}}

# ── 2 · THE PIN: a supplier-scoped anchor fills after late resolution ─────────────────────
res, calls = run(rescue_returns=RESCUE_VAL)
cust = res.get("customer") or {}
check("supplier resolved late via 2.5a text scan",
      (res.get("supplier_name") or {}).get("value") == MER)
check("rescue call ran under the RESOLVED supplier",
      any(s == MER for s, _ in calls))
check("rescued anchors = the delta only (the poisoned customer anchor)",
      any(s == MER and ks == ["customer"] for s, ks in calls))
check("customer FILLED by the rescue", cust.get("value") == "Formby & Sons")
check("rescued confidence capped at 85", (cust.get("confidence") or 0) <= 85)
check("rescued read keeps its normal method string", cust.get("method") == "anchor_crop")

# ── 3 · fill-empty-only: an incumbent is never displaced, rescue set excludes it ─────────
res3, calls3 = run(
    stage2_returns={},  # Stage 2 under None returns nothing…
    kw_returns={"customer": {"value": "Incumbent Ltd", "confidence": 90, "method": "keyword"}},
    rescue_returns=RESCUE_VAL)
check("incumbent value never displaced by the rescue",
      (res3.get("customer") or {}).get("value") == "Incumbent Ltd")
check("a filled field is excluded from the rescue set (no MER call or empty set)",
      not any(s == MER and "customer" in ks for s, ks in calls3))

# ── 4 · the GATE: no rescue when Stage 2 already SAW a supplier (template/logo path) ─────
# Stage-0-resolved docs can't be driven hermetically (template/logo internals), so the gate
# is a pure pinned function; the corpus A/B proves the population at scale (those docs must
# be byte-identical → corpus-neutral).
check("gate OFF when Stage 2 saw the supplier", eng._late_rescue_applicable(MER, MER) is False)
check("gate ON for unresolved-then-resolved", eng._late_rescue_applicable(None, MER) is True)
check("gate OFF when still unresolved", eng._late_rescue_applicable(None, None) is False)
check("gate OFF for an implausible fragment", eng._late_rescue_applicable(None, "IN") is False)

# ── 4b · a Stage-1 KEYWORD identity is promoted only AFTER Stage 2 — the same seam, so the
# rescue runs for it too (intended: Stage 2 ran blind either way). Pinned as designed.
res4, calls4 = run(
    kw_returns={"supplier_name": {"value": MER, "confidence": 95, "method": "keyword"}},
    rescue_returns=RESCUE_VAL)
check("keyword-resolved supplier still gets the rescue (Stage 2 ran blind)",
      any(s == MER for s, _ in calls4) and (res4.get("customer") or {}).get("value") == "Formby & Sons")
check("keyword-promoted rescue keeps the 85 cap",
      ((res4.get("customer") or {}).get("confidence") or 0) <= 85)

# ── 4c · S1 COMPOSE (gary, 2026-07-10): a rescued read that arrives ALREADY capped+noted
# by anchor.py's name-guard (Layer B: junk name @70 + validation_note) keeps BOTH through
# the rescue merge — min(85, 70) = 70 and the note is copied verbatim (fill-empty copies
# the dict, adding only late_rescue).
res4c, _ = run(rescue_returns={"customer": {"value": "Sso", "confidence": 70,
                                            "method": "anchor_crop_relocated",
                                            "validation_note": "junk name — please verify"}})
c4c = res4c.get("customer") or {}
check("S1: pre-capped 70 survives the rescue min()-cap", c4c.get("confidence") == 70)
check("S1: the name-guard validation_note survives the merge",
      c4c.get("validation_note") == "junk name — please verify")

# ── 5 · no rescue when the supplier never resolves ────────────────────────────────────────
res5, calls5 = run(hints=[], rescue_returns=RESCUE_VAL)
check("unresolved supplier -> single Stage-2 call only",
      len(calls5) == 1 and calls5[0][0] is None)
check("unresolved supplier -> customer stays empty",
      not (res5.get("customer") or {}).get("value"))

# ── 6 · kill switch off is byte-identical (no rescue call, field empty) ──────────────────
_old = eng.LATE_ANCHOR_RESCUE_ENABLED
try:
    eng.LATE_ANCHOR_RESCUE_ENABLED = False
    res6, calls6 = run(rescue_returns=RESCUE_VAL)
    check("kill switch off -> no rescue call",
          not any(s == MER for s, _ in calls6))
    check("kill switch off -> customer stays empty",
          not (res6.get("customer") or {}).get("value"))
finally:
    eng.LATE_ANCHOR_RESCUE_ENABLED = _old

print("\n" + ("%d FAILED" % fails if fails else "All late-anchor-rescue checks passed"))
sys.exit(1 if fails else 0)
