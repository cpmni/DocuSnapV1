#!/usr/bin/env python3
"""
tests/test_ref_digit_guard.py
-----------------------------
The DIGIT-PARITY resurrection guard (reggie's fix). The Stage 2 anchor rungs
(registration + relocate) QUALIFY a credible read against the learned shape and, when
the shape veto rejects it, RESURRECT the value anyway — to keep a legitimately-variable
CODE (a new MAC/serial that differs in shape from history). That resurrection must NOT
keep a DIGIT-FREE word read off a neighbouring row (e.g. "Field"/"Booking") on a field
whose every confirmed value carries digits (NNNN-NNNN-N), so the inline-harvest can seat
the real value instead.

Covers format_anomaly_checker.shape_requires_digit + anchor._digit_free_on_digit_field.

    py -3.12 python_backend/tests/test_ref_digit_guard.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction.format_anomaly_checker import shape_requires_digit, DIGITS_ONLY, ALPHANUM_SEP, FREETEXT  # noqa: E402
from extraction.anchor import _digit_free_on_digit_field  # noqa: E402

FAILS = 0


def check(label, cond):
    global FAILS
    if not cond:
        FAILS += 1
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return bool(cond)


# ── shape_requires_digit ──────────────────────────────────────────────────────
print("shape_requires_digit:")
DIGITDASH = {"class": ALPHANUM_SEP, "shapes": frozenset({"####-####-#"})}
check("uniform digit-dash shape -> True", shape_requires_digit(DIGITDASH) is True)
check("digits_only class -> True", shape_requires_digit({"class": DIGITS_ONLY}) is True)
check("alpha-only shapes -> False", shape_requires_digit({"class": "upper_alphanum", "shapes": frozenset({"@@@@"})}) is False)
# A field with BOTH a digit-bearing and an alpha-only confirmed shape is not uniformly
# digit-bearing -> guard must be OFF (don't refuse a legit alpha value).
check("mixed shapes (one alpha) -> False", shape_requires_digit({"class": ALPHANUM_SEP, "shapes": frozenset({"####-####-#", "@@@@@"})}) is False)
check("no shapes -> False", shape_requires_digit({"class": ALPHANUM_SEP, "shapes": frozenset()}) is False)
check("no entry -> False", shape_requires_digit(None) is False)
check("freetext, no shapes -> False", shape_requires_digit({"class": FREETEXT}) is False)

# ── _digit_free_on_digit_field ────────────────────────────────────────────────
print("_digit_free_on_digit_field:")
digit_lookup = lambda _k: DIGITDASH                       # field history is all NNNN-NNNN-N
alpha_lookup = lambda _k: {"class": "upper_alphanum", "shapes": frozenset({"@@@@"})}
none_lookup  = lambda _k: None                            # thin/varied history -> no learned shape

# The bug: a digit-free wrong-row word on a digit-bearing field -> REFUSE resurrection.
check("'Field' on digit-dash field -> refuse", _digit_free_on_digit_field("Field", "reference_number", digit_lookup) is True)
check("'Booking' on digit-dash field -> refuse", _digit_free_on_digit_field("Booking", "reference_number", digit_lookup) is True)
# Digit-bearing reads (the real ref, a serial, a MAC) are NEVER refused -> variable codes preserved.
check("real ref keeps (has digits)", _digit_free_on_digit_field("2605-0769-1", "reference_number", digit_lookup) is False)
check("serial keeps (has digits)", _digit_free_on_digit_field("H571Y07217", "serial_number", digit_lookup) is False)
check("MAC keeps (has digits)", _digit_free_on_digit_field("D4:F0:C9:25:9B:64", "mac_address", digit_lookup) is False)
# Alpha-only history -> guard OFF (an alpha reference scheme is never constrained).
check("alpha value on alpha-only field -> keep", _digit_free_on_digit_field("ABCD", "reference_number", alpha_lookup) is False)
# Thin/varied history (no learned shape) -> byte-identical to today.
check("no learned shape -> keep", _digit_free_on_digit_field("Field", "reference_number", none_lookup) is False)
check("no format_lookup -> keep", _digit_free_on_digit_field("Field", "reference_number", None) is False)
check("empty value -> keep", _digit_free_on_digit_field("", "reference_number", digit_lookup) is False)

print(f"\n{'ALL PASS' if FAILS == 0 else str(FAILS) + ' FAILED'}")
sys.exit(1 if FAILS else 0)
