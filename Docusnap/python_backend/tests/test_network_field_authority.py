#!/usr/bin/env python3
"""
tests/test_network_field_authority.py
-------------------------------------
First-class MAC/IP fields + the type-authority gate. A value that MATCHES its
field's nature must not be second-guessed by the generic charset / learned-SHAPE
heuristics:

  * mac_address / ip_address are recognised by KEY and given a PRECISE validation
    pattern (value_quality.network_address_validation + config validation_patterns),
    so a MAC's ':' is type-VALID (not "unexpected characters") and a new IP with
    different octet lengths is not a "format differs" SHAPE anomaly.
  * A value that FULLY matches a PRECISE pattern is type-authoritative — the shape
    veto (_qualify_against_format) is skipped for it. The GENERIC 'alphanumeric'
    pattern is NOT precise (a drifted "Bookinc" matches it too), so it stays gated.
  * Stage 4.5 clean-NAME relax: a well-formed name in a field with NO learned
    stable-prefix identity (different customers) is not flagged for a mere shape
    difference; a GARBLED name still is.

Hermetic — no Tesseract. Stubs keyword/anchor/validator like test_stage45_text_preserve.
    py -3.12 python_backend/tests/test_network_field_authority.py
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import engine as engine_mod
from extraction import value_quality, anchor
from extraction.engine import ExtractionEngine

CONFIG = str(Path(__file__).parent.parent.parent / "config" / "keyword_patterns.json")
fail = 0


def check(label, cond):
    global fail
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fail += 1


def _run(kw_results, formats, fields):
    eng = ExtractionEngine(mode="fast", config_path=CONFIG if os.path.exists(CONFIG) else None)
    eng.set_formats(formats)
    orig_kw, orig_an, orig_va = (engine_mod.keyword.extract_fields,
                                 engine_mod.anchor.extract_with_anchors,
                                 engine_mod.validator.validate_and_adjust)
    engine_mod.keyword.extract_fields = lambda *a, **k: {kk: dict(vv) for kk, vv in kw_results.items()}
    engine_mod.anchor.extract_with_anchors = lambda *a, **k: {}
    engine_mod.validator.validate_and_adjust = lambda results, field_defs: results
    try:
        return eng.extract(ocr_text="stub", page_images=[], filename="t.pdf",
                           field_defs=fields, hints=[], anchors=[], logos=[], templates=[],
                           document_type="PrintTracker", document_slug="printtracker")
    finally:
        engine_mod.keyword.extract_fields = orig_kw
        engine_mod.anchor.extract_with_anchors = orig_an
        engine_mod.validator.validate_and_adjust = orig_va


def _f(r, k):
    return r.get(k) or {}


# 1. KEY-based detection (reusable, no false positives on similar words).
print("network_address_validation: key -> precise validation type")
check("mac_address -> mac_address",        value_quality.network_address_validation("mac_address") == "mac_address")
check("ip_address -> ip_address",          value_quality.network_address_validation("ip_address") == "ip_address")
check("hardware_address -> mac_address",   value_quality.network_address_validation("hardware_address") == "mac_address")
check("customer -> None (not a network field)", value_quality.network_address_validation("customer") is None)
check("ship_to -> None",                   value_quality.network_address_validation("ship_to") is None)
check("description -> None",               value_quality.network_address_validation("description") is None)
print()

# 2. _qualify_against_format precise-pattern authority. A poison format_lookup proves
#    the shape veto is SKIPPED (never consulted) for an authoritative mac/ip value, and
#    CONSULTED (so still gated) for a generic-alphanumeric value.
print("_qualify_against_format: precise pattern is authoritative; generic stays gated")
import json
_vp = json.load(open(CONFIG))["validation_patterns"]


def _poison(_k):
    raise AssertionError("format_lookup must NOT be consulted for an authoritative value")


q = anchor._qualify_against_format("00:17:C8:BF:B9:92", "mac_address", _poison,
                                   None, "mac_address", _vp)
check("MAC short-circuits the shape veto (value kept, lookup not consulted)",
      q == "00:17:C8:BF:B9:92")
q = anchor._qualify_against_format("192.168.16.21", "ip_address", _poison,
                                   None, "ip_address", _vp)
check("IP short-circuits the shape veto", q == "192.168.16.21")

# Generic 'alphanumeric' is NOT precise: the veto MUST be consulted (so a real lookup
# that flags a conflicting shape still trims/drops). "Bookinc" must remain gated.
from extraction.format_anomaly_checker import build_format_class_index
_idx = build_format_class_index([
    {"supplier_name": "", "document_type": "printtracker", "field_key": "reference_number",
     "sample_values": ["2602-0768-1", "7602-1354-4", "1234-5678-9"], "confirmed_count": 6}])
_entry = _idx.get(("", "printtracker", "reference_number"))


def _lookup(_k):
    return _entry


q = anchor._qualify_against_format("Bookinc", "reference_number", _lookup,
                                   None, "alphanumeric", _vp)
check("generic 'alphanumeric' is NOT authoritative — drifted 'Bookinc' still vetoed (None)",
      q is None)
print()

# 3. Stage 4.5 end-to-end: a MAC's ':' is not charset-flagged; a new IP's octet length
#    is not shape-flagged. ip_address has a learned shape from .1.100-style history that
#    the new value would otherwise trip.
print("Stage 4.5: mac/ip accepted clean (no charset / no shape flag)")
NET_FIELDS = [{"key": "mac_address", "type": "text"}, {"key": "ip_address", "type": "text"}]
NET_FORMATS = [
    {"supplier_name": "", "document_type": "printtracker", "field_key": "ip_address",
     "sample_values": ["192.168.1.100", "192.168.1.101", "192.168.1.102"], "confirmed_count": 6},
    {"supplier_name": "", "document_type": "printtracker", "field_key": "mac_address",
     "sample_values": ["00:17:C8:C0:51:D3", "00:17:C8:C0:51:D4", "00:17:C8:C0:51:D5"], "confirmed_count": 6},
]
r = _run({"mac_address": {"value": "00:17:C8:BF:B9:92", "confidence": 80, "method": "keyword"},
          "ip_address":  {"value": "192.168.16.21",     "confidence": 80, "method": "keyword"}},
         NET_FORMATS, NET_FIELDS)
check("MAC value kept",            _f(r, "mac_address").get("value") == "00:17:C8:BF:B9:92")
check("MAC ':' NOT flagged 'unexpected characters'",
      "unexpected" not in (_f(r, "mac_address").get("validation_note") or ""))
check("MAC not flagged at all",    not _f(r, "mac_address").get("validation_note"))
check("IP value kept",             _f(r, "ip_address").get("value") == "192.168.16.21")
check("IP different-octet NOT shape-flagged",
      not _f(r, "ip_address").get("validation_note"))
print()

# 4. A genuinely VARIABLE (multi-company) customer field has NO shape constraint, so a
#    different clean customer is kept clean. (The stable-prefix side — a truncated /
#    wrong-prefix name in a single-identity history is STILL flagged via the
#    _has_stable_prefix gate — is guarded by test_stage45_text_preserve.)
print("Stage 4.5: a different clean customer in a variable field is kept unflagged")
VARIED = ["Keenan Seafood", "Dunroamin Park", "Apex Joinery"]   # distinct tokens -> freetext
CUST_FORMATS = [{"supplier_name": "", "document_type": "printtracker", "field_key": "customer",
                 "sample_values": VARIED, "confirmed_count": 6,
                 "value_counts": {v: 2 for v in VARIED}}]
CUST_FIELDS = [{"key": "customer", "type": "text"}]
r = _run({"customer": {"value": "McMahon Associates", "confidence": 80, "method": "keyword"}},
         CUST_FORMATS, CUST_FIELDS)
check("different clean customer kept", _f(r, "customer").get("value") == "McMahon Associates")
check("different clean customer NOT flagged (variable field)",
      not _f(r, "customer").get("validation_note"))
print()


if fail:
    print(f"{fail} check(s) failed — network-field / type-authority regressed.")
    sys.exit(1)
print("All network-field / type-authority checks passed.")
sys.exit(0)
