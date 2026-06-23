#!/usr/bin/env python3
"""
tests/test_freetext_conf_rescue.py
----------------------------------
Stage B — OCR-confidence-gated free-text strictness.

A free-text rigid crop whose garbage clears the loose credibility floor but reads
at LOW OCR confidence ("Danirmant fara WMamac" @ 34) must be treated as NOT strictly
credible, so the rescue trigger fires and the label-located harvest can displace it.
Clean reads (conf >= 60), structured fields (regex-validated), and callers that
don't thread a conf stay byte-identical.

No Tesseract: exercises the gate helpers directly.
Usage: py -3.12 python_backend/tests/test_freetext_conf_rescue.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import anchor  # noqa: E402
from extraction import template_mapper as tm  # noqa: E402

fail = 0


def check(label, cond):
    global fail
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fail += 1


GARBAGE = "Danirmant fara WMamac lt td. Galaarm"   # passes the loose free-text floor
CLEAN   = "Beaumont Care Homes Ltd - Galgorm"
REF_PATS = {"alphanumeric": [r"\d{4}-\d{4}-\d"]}

print(f"_FREE_TEXT_RESCUE_CONF = {anchor._FREE_TEXT_RESCUE_CONF}")

print("\n_strict_credible: free-text low conf -> not credible (routes to rescue)")
check("garbage @ conf 34 -> NOT strictly credible",
      anchor._strict_credible(GARBAGE, None, {}, ocr_conf=34) is False)
check("clean @ conf 93 -> strictly credible (clean fast path)",
      anchor._strict_credible(CLEAN, None, {}, ocr_conf=93) is True)
check("clean @ conf=None -> strictly credible (byte-identical, no conf threaded)",
      anchor._strict_credible(CLEAN, None, {}) is True)
check("loose floor still rejects pure debris regardless of conf",
      anchor._strict_credible(">.. ", None, {}, ocr_conf=93) is False)

print("\n_strict_credible: structured fields IGNORE the conf floor (regex is the trust signal)")
check("valid ref @ conf 13 (alphanumeric) -> still credible",
      anchor._strict_credible("2602-0768-1", "alphanumeric", REF_PATS, ocr_conf=13) is True)

print("\n_should_replace: low-conf incumbent is displaceable; clean incumbent is protected")
check("low-conf garbage incumbent replaced by clean candidate",
      anchor._should_replace(GARBAGE, CLEAN, None, {}, inc_ocr_conf=34) is True)
check("clean high-conf incumbent NOT displaced (protects the correct anchor_crop docs)",
      anchor._should_replace(CLEAN, "Some Other Name Ltd", None, {}, inc_ocr_conf=93) is False)
check("no inc_ocr_conf threaded -> clean incumbent still protected (byte-identical)",
      anchor._should_replace(CLEAN, "Some Other Name Ltd", None, {}) is False)
check("empty incumbent always takes the candidate",
      anchor._should_replace("", CLEAN, None, {}, inc_ocr_conf=10) is True)

print("\nStage C: template_mapper._gate_value applies the SAME free-text conf floor")
# field_key="" isolates the floor (skips the name-quality guard, which would also
# reject a garbled name regardless of conf).
check("low-conf free-text drawn-box read -> rejected (defers to relocation/registration)",
      tm._gate_value(CLEAN, None, "", {}, None, shape_mode='ignore', ocr_conf=34)[0] is None)
check("clean high-conf drawn-box read -> kept (fast path unchanged)",
      tm._gate_value(CLEAN, None, "", {}, None, shape_mode='ignore', ocr_conf=93)[0] == CLEAN)
check("no ocr_conf threaded (derived/inline/registration rungs) -> kept, byte-identical",
      tm._gate_value(CLEAN, None, "", {}, None, shape_mode='ignore')[0] == CLEAN)
check("structured value @ low conf -> kept (regex is the trust signal, no floor)",
      tm._gate_value("2602-0768-1", "alphanumeric", "", REF_PATS, None,
                     shape_mode='ignore', ocr_conf=13)[0] == "2602-0768-1")

print("\n%s" % ("All free-text conf-rescue checks passed." if not fail else f"{fail} FAILED"))
sys.exit(1 if fail else 0)
