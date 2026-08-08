"""Validation patterns + type mapping for the supplementary field data types
(email / percentage / postcode_uk / vat_gb / reference_code / iban / website).

Guards: (a) each pattern matches real values and rejects non-values in Python `re`
with IGNORECASE (the flavour the engine uses); (b) the FLAG-ONLY types are deliberately
absent from engine._TYPE2VAL (so a non-matching read is kept + flagged, not withheld),
while reference_code IS mapped (a deliberate WITHHOLD gate). Patterns are kept aligned
with the renderer's RegExp mirror via the same JSON source.
"""
import json
import re
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction.engine import _TYPE2VAL  # noqa: E402

_CFG = json.loads((Path(__file__).parent.parent.parent / "config" / "keyword_patterns.json")
                  .read_text(encoding="utf-8"))
VP = _CFG["validation_patterns"]
CHARSETS = _CFG.get("field_charsets", {})

# (positives, negatives) per type.
CASES = {
    "email": (["john.doe@acme.co.uk", "sales@firm.ie", "a_b+tag@sub.domain.io"],
              ["john@acme", "@acme.com", "Total 12.00"]),
    "percentage": (["20%", "17.5%", "0%", "100%", "12.50 %"],
                   ["20", "20 percent", "%"]),
    "postcode_uk": (["EC1A 1BB", "SW1A 1AA", "M1 1AE", "B33 8TH", "EC1A1BB"],
                    ["12345", "LONDON", "90210"]),
    "vat_gb": (["GB123456789", "123456789", "GB 123 4567 89", "GBHA599"],
               ["12345", "GB12345678", "DE123456789"]),
    "reference_code": (["INV-001", "2024/123", "ABC123", "PO-5567"],
                       ["Total", "Reference", "Customer"]),
    # SPACED forms added 2026-08-08: the pattern used to reject every IBAN as it is actually
    # PRINTED (4-character groups). That was a live defect, not a nicety — trust.js strips
    # whitespace before its mod-97 check and ACCEPTED the value, while the renderer's on-blur
    # scored 0% coverage and WARNED on the same correct value. reggie found it; Oracle signed it.
    "iban": (["GB29NWBK60161331926819", "DE89370400440532013000", "IE29AIBK93115212345678",
              "GB29 NWBK 6016 1331 9268 19", "DE89 3704 0044 0532 0130 00"],
             ["GB29", "NWBK60161331926819"]),
    "website": (["www.acme.co.uk", "https://acme.com", "acme.io/contact"],
                ["acme", "see our site", "john@acme.com"]),
}


def _matches(key, value):
    return any(re.search(p, value, re.IGNORECASE) for p in VP[key])


def test_patterns_present():
    for k in CASES:
        assert k in VP and VP[k], f"validation_patterns.{k} missing/empty"


def test_positive_matches():
    for k, (pos, _neg) in CASES.items():
        for v in pos:
            assert _matches(k, v), f"{k}: expected MATCH for {v!r}"


def test_negative_rejects():
    for k, (_pos, neg) in CASES.items():
        for v in neg:
            assert not _matches(k, v), f"{k}: expected NO match for {v!r}"


def test_patterns_compile_anchored():
    # All supplementary patterns are whole-value anchored (precision-first) and
    # flag-independent (no reliance on IGNORECASE): explicit [A-Za-z], no inline flags.
    for k in CASES:
        for p in VP[k]:
            assert p.startswith("^") and p.endswith("$"), f"{k}: pattern not anchored: {p}"
            assert "(?i)" not in p, f"{k}: inline-flag pattern not portable to JS: {p}"
            re.compile(p)  # raises on bad regex


def test_reference_code_gates_but_others_flag_only():
    # reference_code is a deliberate WITHHOLD gate -> mapped in _TYPE2VAL.
    assert _TYPE2VAL.get("reference_code") == "reference_code"
    # The rest are FLAG-ONLY -> deliberately NOT mapped (a non-matching read is kept
    # and surfaced for review, never dropped). Regression guard for that decision.
    for k in ("email", "percentage", "postcode_uk", "vat_gb", "iban", "website"):
        assert k not in _TYPE2VAL, f"{k} must stay flag-only (out of _TYPE2VAL)"


def test_ip_address_v6_leg_rejects_clock_times_and_accepts_shorthand():
    """The IPv6 leg was wrong in BOTH directions (reggie 2026-08-08, Oracle SIGN OFF).

    It was `(?:[0-9A-Fa-f]{1,4}:){2,7}[0-9A-Fa-f]{1,4}` — two hextet groups plus a tail — so a
    CLOCK TIME matched. That is not cosmetic: `ip_address` is in `anchor._PRECISE_VAL_TYPES`, so at
    >=95% coverage a matching value is graded TYPE-AUTHORITATIVE and SKIPS the charset and
    learned-shape checks. It simultaneously REJECTED `fe80::1` — the example the type's own tooltip
    prints at doctype-editor.js:53 — because `{1,4}` demands a hex char before every colon.

    Note these two legs are deliberately NOT anchored (unlike the supplementary types in CASES,
    which `test_patterns_compile_anchored` covers), so `ip_address` stays out of CASES.

    Assert WHOLE-VALUE coverage, not merely `re.search` truthiness. A bare search is too weak to
    pin this: the first version of the fix matched only the `2001:db8::8a2e` PREFIX of
    `2001:db8::8a2e:370:7334`, which `re.search` reports as a match while the consuming surfaces
    (the renderer's >=0.8 coverage rule and `anchor._pattern_coverage`) correctly score it a partial
    and warn. The JS mirror pin caught what a search-only assertion here would have waved through.
    """
    def span(v):
        best = 0
        for p in VP["ip_address"]:
            m = re.search(p, v, re.IGNORECASE)
            if m and m.group(0):
                best = max(best, len(m.group(0)) / len(v))
        return best

    # Rejected: times and short colon runs that are not addresses.
    assert span("09:30:15") < 0.8, "a clock time must not read as an IPv6 address"
    assert span("12:45:00") < 0.8, "a clock time must not read as an IPv6 address"
    # Accepted, and matched END TO END so downstream coverage metrics agree.
    assert span("fe80::1") == 1.0, "the compressed form the UI itself advertises must match whole"
    assert span("2001:db8::8a2e:370:7334") == 1.0
    assert span("2001:0db8:0000:0000:0000:8a2e:0370:7334") == 1.0
    # The IPv4 leg is untouched.
    assert span("192.168.1.200") == 1.0


def test_charsets_present_for_symbol_types():
    # Types whose valid values carry non-alphanumeric symbols need a field_charsets
    # entry, else the default charset would false-flag them (e.g. email '_').
    for k in ("email", "percentage", "reference_code", "website"):
        assert k in CHARSETS, f"field_charsets.{k} missing (would false-flag valid values)"
