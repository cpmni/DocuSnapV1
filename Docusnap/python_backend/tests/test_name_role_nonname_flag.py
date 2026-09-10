#!/usr/bin/env python3
"""test_name_role_nonname_flag.py — the NAME_ROLE_NONNAME_FLAG deterministic non-name guard (mig 156, DARK;
reggie+gary -> Oracle SIGN-OFF-W/COND).

A name-role field whose WHOLE value is a bare postcode/email/GB-VAT/IBAN is a wrong-type read (a template
zone drifted onto the postcode line of a multi-line customer block). This pins:
  1. the pure predicate value_quality.nonname_structured_match — the exact positive set + the anti-over-hold
     negatives (a real name, incl. one that CONTAINS a postcode, is never flagged), and the excluded loose
     shapes (bare number / reference_code) never match;
  2. the engine wiring (source-scan): env-gated, whole-value only, appends `+nonname_flag` to the method
     (never a new key -> the template_mapping/anchor_* prefix survives for _method_family), caps <=69, exempts
     curated/human methods + accepted_names, defers to an existing note, and OFF is byte-identical.

The engine INTEGRATION (CH1 2HU on the live Vellum & Crane doc -> value kept, note, +nonname_flag, conf 69)
is proven by the live reprocess in the session log.

    py -3.12 python_backend/tests/test_name_role_nonname_flag.py
"""
import sys, os, json, re
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "python_backend"))
from extraction.value_quality import nonname_structured_match, _NONNAME_STRUCTURED_TYPES

fails = 0
def check(label, cond):
    global fails
    print(("  OK  " if cond else "  BAD ") + label)
    if not cond:
        fails += 1

vp = json.load(open(os.path.join(ROOT, "config", "keyword_patterns.json"), encoding="utf-8"))["validation_patterns"]

print("predicate — positives (a name-role field can never legitimately be one of these):")
check("CH1 2HU -> postcode_uk",           nonname_structured_match("CH1 2HU", vp) == "postcode_uk")
check("SW1A 1AA -> postcode_uk",          nonname_structured_match("SW1A 1AA", vp) == "postcode_uk")
check("CH12HU (no space) -> postcode_uk", nonname_structured_match("CH12HU", vp) == "postcode_uk")
check("info@acme.co.uk -> email",         nonname_structured_match("info@acme.co.uk", vp) == "email")
check("GB123456789 -> vat_gb",            nonname_structured_match("GB123456789", vp) == "vat_gb")
check("a GB IBAN -> iban",                nonname_structured_match("GB29 NWBK 6016 1331 9268 19", vp) == "iban")
check("leading/trailing space tolerated", nonname_structured_match("  CH1 2HU  ", vp) == "postcode_uk")

print("predicate — negatives (real company names must NEVER flag):")
for name in ["Studio54", "Plan9", "3M", "B&Q", "A1 Storage Ltd", "Meadowbrook Vets",
             "Corvus Security Services", "Vellum & Crane Ltd", "Halcyon Leisure Group"]:
    check(f"{name!r} -> None", nonname_structured_match(name, vp) is None)
# The anti-over-hold anchor: a name that CONTAINS a postcode is not a bare postcode (whole-value match).
check("'Beaumont Care CH1 2HU' (contains a postcode) -> None (whole-value anchor)",
      nonname_structured_match("Beaumont Care CH1 2HU", vp) is None)
check("'SW1A 1AA Ltd' (postcode + suffix) -> None", nonname_structured_match("SW1A 1AA Ltd", vp) is None)
check("empty -> None", nonname_structured_match("", vp) is None)

print("predicate — excluded loose shapes (Oracle: never in the set):")
check("bare number '100234' -> None (bare-number leg dropped)", nonname_structured_match("100234", vp) is None)
check("reference 'INV-45152' -> None", nonname_structured_match("INV-45152", vp) is None)
check("the type set is exactly postcode/email/vat/iban",
      tuple(_NONNAME_STRUCTURED_TYPES) == ("postcode_uk", "email", "vat_gb", "iban"))

print("engine wiring (source-scan of engine.py):")
esrc = open(os.path.join(ROOT, "python_backend", "extraction", "engine.py"), encoding="utf-8").read()
check("env-gated NAME_ROLE_NONNAME_FLAG (byte-identical OFF)",
      'os.environ.get("NAME_ROLE_NONNAME_FLAG", "0") != "0"' in esrc)
check("gated on is_name_like_field", "value_quality.is_name_like_field(key)" in esrc and "nonname_structured_match" in esrc)
check("appends +nonname_flag to method (never a new key)",
      "+nonname_flag" in esrc and re.search(r"\{data\.get\('method'\) or 'unknown'\}\+nonname_flag", esrc) is not None)
check("caps confidence <= 69", "min(data.get('confidence') or 0, 69)" in esrc)
check("exempts curated/human methods (template_fixed/override/manual/+confirmed_adopt/+name_snap)",
      "_nn_curated" in esrc and "'template_fixed', 'override', 'fixed', 'manual', '+confirmed_adopt', '+name_snap'" in esrc)
check("exempts accepted_names (a supplier's legitimate recurring value never stalls its batch)",
      "self._accept_norm(val) not in self.accepted_names" in esrc)
check("defers to an existing note (one-note-per-field)",
      "not str(data.get('validation_note') or '').strip()" in esrc)
check("does NOT exempt template_mapping / anchor_* (the non-exemption IS the fix)",
      "template_mapping" not in esrc.split("_nn_curated = any")[1].split("if not _nn_curated")[0])

print("\n" + (f"FAILED: {fails}" if fails else "ALL PASS"))
sys.exit(1 if fails else 0)
