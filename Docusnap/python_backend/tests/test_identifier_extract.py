"""test_identifier_extract.py — slice 1a of the identifier-registry arc. Pins the extractor +
the UK VAT mod-97 checksum (Python twin of trust.js _validVatGb). Script-style, no pytest.

  py -3.12 python_backend/tests/test_identifier_extract.py
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from extraction.identifier_extract import valid_vat_gb, extract_identifiers, match_issuer

fails = 0
def check(label, cond):
    global fails
    print(("  OK  " if cond else "  BAD ") + label)
    if not cond: fails += 1

# ── checksum (parity with trust.js _validVatGb; GB980780684 is checksum-valid, classic method) ──
check("valid VAT passes the mod-97 checksum", valid_vat_gb("GB 980 7806 84") is True)
check("a one-digit-off VAT FAILS (the confusable detector — never fold it)", valid_vat_gb("GB 980 7806 85") is False)
check("GD/HA government form bypasses the checksum", valid_vat_gb("GBGD001") is True and valid_vat_gb("GBHA500") is True)
check("a random 9-digit run fails", valid_vat_gb("123456789") is False)
check("12-digit branch trader uses the first 9", valid_vat_gb("GB980780684123") is True)

# ── extraction: a letterhead header with a valid VAT + a captioned company number ──
HEADER = ("Castellan Security Systems\n"
          "VAT Reg No GB 980 7806 84\n"
          "Registered in England No 04123456\n"
          "Tel: 0161 496 0248\n"
          "Fax: 0161 496 0249\n"
          "SERVICE WORKSHEET\n"
          "BILL TO\nBramblewood Joinery Ltd  VAT Reg GB 512 8846 27\n")
ids = extract_identifiers(HEADER)
def one(kind, vn):
    return [i for i in ids if i["kind"] == kind and i["value_norm"] == vn]
check("VAT extracted + canonicalised to GB+digits", bool(one("vat", "GB980780684")))
check("VAT carries checksum_passed=True + entropy 'decisive'",
      bool(one("vat", "GB980780684")) and one("vat", "GB980780684")[0]["checksum_passed"] is True
      and one("vat", "GB980780684")[0]["entropy"] == "decisive")
check("captioned company number extracted + zero-padded to 8", bool(one("company_no", "04123456")))
check("phone extracted (supporting)", any(i["kind"] == "phone" and i["value_norm"] == "01614960248" for i in ids))
check("FAX is NOT extracted as a phone identity", not any(i["kind"] == "phone" and i["value_norm"] == "01614960249" for i in ids))
# the recipient's VAT (under BILL TO) is captured as a candidate but tagged near_recipient/body — the
# registry (gary) drops non-issuer regions; here we just assert it is NOT in the header region.
rec = [i for i in ids if i["kind"] == "vat" and i["value_norm"] == "GB512884627"]
check("a recipient VAT under BILL TO is NOT tagged header region (registry drops it)",
      (not rec) or all(i["position"]["region"] != "header" for i in rec))

# ── money veto: a currency line does not mint a VAT ──
check("a money line does not mint a VAT", not extract_identifiers("Total VAT GB 540 63 due  £540.63\n"))

# ── slice 1b MATCH (match_issuer) ──
REG = {("vat", "GB980780684"): {"Castellan Security Systems"}}
check("match: a header VAT resolves to the sole learned supplier", match_issuer(REG, HEADER) == "Castellan Security Systems")
check("match: empty registry → None", match_issuer({}, HEADER) is None)
check("match: a VAT mapping to >=2 suppliers ABSTAINS (empty beats a guess)",
      match_issuer({("vat", "GB980780684"): {"A Ltd", "B Ltd"}}, HEADER) is None)
check("match: a header carrying no registered VAT → None",
      match_issuer({("vat", "GB111111111"): {"X Ltd"}}, HEADER) is None)
check("match: company_no alone never suggests (C4 — VAT is the only single key)",
      match_issuer({("company_no", "04123456"): {"Castellan Security Systems"}}, HEADER) is None)

# ── engine arm contract (suggest-only, honest note, arms the Use-X button) ──
import os as _os
_eng = open(_os.path.join(_os.path.dirname(__file__), "..", "extraction", "engine.py"), encoding="utf-8").read()
check("engine arm calls match_issuer + is suggest-only (sets suggested_supplier, never a value)",
      "match_issuer(self._id_registry, ocr_text)" in _eng and '_ifld["suggested_supplier"] = _idsup' in _eng
      and 'A VAT number on this page is registered to' in _eng)
check("engine note arms the renderer Use-X button via 'confirm the correct company' (no letterhead claim)",
      "please confirm the correct company" in _eng)

print(("\n%d FAILED" % fails) if fails else "\nAll identifier-extract pins passed")
sys.exit(1 if fails else 0)
