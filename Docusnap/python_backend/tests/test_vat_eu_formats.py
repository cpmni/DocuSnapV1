"""test_vat_eu_formats.py — pins for VAT_EU_FORMATS (2026-08-10).

Run: py -3.12 python_backend/tests/test_vat_eu_formats.py

THE DEFECT. `vat_no` gained a real format on 2026-08-09 (`92c7013`) and the shipped patterns are UK
ONLY. That was a deliberate precision choice, but it has a cost the entry recorded and nobody had
paid down: a UK business receiving an Irish, German or French invoice gets `vat_no` EMPTY and a
review, and an operator who types the correct 'IE1234567FA' by hand gets an on-blur warning telling
them their right value is wrong. Same class as the `iban` defect of 2026-08-08 — backend and
renderer disagreeing about a conventionally-printed value.

WHY NOT A GENERIC RULE. A "two letters plus 8-12 characters" arm would readmit the measured OCR
garbles, because 'CO' and 'EE' are themselves real country codes. The answer is a MORE specific
rule, not a looser one: per-country structures with exact element counts.

MEASURED on the live install (56 distinct vat_no values ever committed, matched with the pipeline's
own re.search/IGNORECASE coverage test): 10 accepted before and after, 46 refused before and after,
**0 values flipped refused -> accepted**. The precision cost on real data is zero.

THE LIMIT, stated because format alone cannot fix it: a garble that happens to match a real
country's structure exactly IS accepted — 'ee053510429' (nine digits, a valid Estonian shape) passes.
The measured garble 'ee05351042' has eight and is refused. This is the same lesson the serials entry
records: a format gate cannot separate two strings of the same shape, and pretending otherwise is
how a plausible wrong value gets committed at high confidence.

THE ANTI-LOOSEN CONTRACT:
  * Every ON case has an OFF twin, so "default OFF is safe" is asserted rather than assumed.
  * The garbles that justified the UK-only decision must STILL be refused when armed — otherwise
    this change has simply undone `92c7013`.
  * UK values must be byte-identical in both states.
  * The merge must not mutate the loaded config in place: the same dict is threaded into every stage.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from extraction.keyword import _apply_vat_eu, load_patterns  # noqa: E402

FLAG = "VAT_EU_FORMATS"
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CONFIG = os.path.join(ROOT, "config", "keyword_patterns.json")

passed = 0


def ok(name):
    global passed
    passed += 1
    print(f"  ok  {name}")


def accepts(value, pats, thresh=0.9):
    """The pipeline's acceptance leg: longest IGNORECASE search match over the whitespace-stripped
    value (anchor._pattern_coverage). The patterns are anchored, so this is a full match."""
    v = re.sub(r"\s+", "", str(value or ""))
    if not v:
        return False
    best = 0
    for p in pats:
        for m in re.finditer(p, v, re.IGNORECASE):
            best = max(best, len(m.group(0)))
    return best / len(v) >= thresh


def gb(armed):
    if armed:
        os.environ[FLAG] = "1"
    else:
        os.environ.pop(FLAG, None)
    return load_patterns(CONFIG)["validation_patterns"]["vat_gb"]


NON_UK = ["IE1234567FA", "IE 1234567 FA", "IE1S23456L", "DE123456789", "DE 123 456 789",
          "FR12345678901", "NL123456789B01", "IT12345678901", "ESA1234567B", "BE0123456789",
          "PL1234567890", "SE123456789012", "CHE123456789MWST", "NO123456789MVA", "ATU12345678",
          "DK12345678", "EL123456789", "PT123456789", "FI12345678", "LU12345678"]
# The garbles that justified the UK-only decision (2026-08-09). 'CO' and 'EE' are real country codes,
# which is precisely why a generic prefix rule is not acceptable.
GARBLES = ["comsssie42", "ee05351042", "VAT", "3PL", "1RE", "co12345678", "IE12345", "DE1234567"]
UK = ["GB651002784", "GB 651 0027 84", "GBGD123", "GBHA456", "651 0027 84", "GB123456789012"]

# ── 1. OFF is today's behaviour ─────────────────────────────────────────────
off = gb(armed=False)
for v in NON_UK:
    assert not accepts(v, off), f"OFF must still refuse {v!r} (that is the defect, not the fix)"
ok("OFF: every non-UK VAT number is still refused (today's behaviour, byte-identical)")

# ── 2. ARMED accepts real non-UK numbers ────────────────────────────────────
on = gb(armed=True)
for v in NON_UK:
    assert accepts(v, on), f"armed must accept {v!r}"
ok(f"ARMED: all {len(NON_UK)} real non-UK forms accepted, spaced and unspaced")

# ── 3. The garbles stay refused in BOTH states ──────────────────────────────
for v in GARBLES:
    assert not accepts(v, off), f"OFF wrongly accepts {v!r}"
    assert not accepts(v, on), f"ARMED wrongly accepts {v!r} — the widening has undone 92c7013"
ok("the OCR garbles that justified the UK-only decision are refused in BOTH states")

# ── 4. UK values are untouched by the widening ──────────────────────────────
for v in UK:
    assert accepts(v, off) == accepts(v, on) is True, f"UK value {v!r} changed verdict"
ok("UK numbers accepted identically in both states")

# ── 5. The Romanian floor is a DEVIATION and is pinned as one ───────────────
# Officially RO is 2-10 digits, which would accept a 2-digit garble in a filing field. It ships
# floored at SIX. Pinned so the deviation is a decision a future dev must revisit deliberately.
assert not accepts("RO12", on), "RO must not accept a 2-digit body"
assert not accepts("RO12345", on), "RO must not accept a 5-digit body"
assert accepts("RO123456", on), "RO accepts from six digits"
assert accepts("RO1234567890", on), "RO accepts the full ten"
ok("RO floored at six digits — the deliberate deviation from the official 2-10 spec")

# ── 6. The merge does not mutate the loaded config ──────────────────────────
src = json.load(open(CONFIG, encoding="utf-8"))
before = list(src["validation_patterns"]["vat_gb"])
os.environ[FLAG] = "1"
merged = _apply_vat_eu(src)
assert src["validation_patterns"]["vat_gb"] == before, "the source config was mutated in place"
assert len(merged["validation_patterns"]["vat_gb"]) > len(before), "the merge did not apply"
os.environ.pop(FLAG, None)
ok("the merge copies — the config dict threaded into every stage is never mutated in place")

# ── 7. CONTROL: the EU list is inert on its own ─────────────────────────────
# Without this, tests 1 and 2 could both pass while `vat_eu` was being read by something else too.
raw = json.load(open(CONFIG, encoding="utf-8"))["validation_patterns"]
assert raw.get("vat_eu"), "the vat_eu list exists in the shipped config"
assert not any(p in raw["vat_gb"] for p in raw["vat_eu"]), "vat_eu must NOT be pre-merged on disk"
ok("CONTROL: vat_eu ships as a separate inert list — the flag is what merges it")

# ── 8. WIRING: both consumers widen from the same setting ───────────────────
# The renderer validates typed values against its OWN copy of these patterns. If only the Python
# side widened, an operator typing a correct Irish number would still be warned — the exact defect.
js = open(os.path.join(ROOT, "src", "modules", "review", "handler.js"), encoding="utf-8").read()
assert "vat_eu_formats" in js and "vat_eu" in js, "the renderer's pattern source widens too"
proc = open(os.path.join(ROOT, "src", "modules", "processing", "handler.js"), encoding="utf-8").read()
assert "VAT_EU_FORMATS" in proc, "the extraction env bridge exists"
ok("WIRING: pipeline and renderer both widen, from one setting (the iban lesson)")

print(f"\n{passed} checks passed")
