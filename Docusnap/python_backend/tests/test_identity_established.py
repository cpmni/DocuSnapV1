#!/usr/bin/env python3
"""Guards the "multiple commits determine it's OK" fallback on the identity-conflict flag.

A letterhead can legitimately carry a DIFFERENT known name than the issuer (a recipient /
customer / printer name in the header — e.g. Print Tracker docs). Once the RESOLVED supplier is
ESTABLISHED (logo match_count / hint / anchor usage_count >= IDENTITY_ESTABLISHED_MIN) the flag
must NOT fire; a brand-new supplier with little history still flags.

    py -3.12 tests/test_identity_established.py
"""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from extraction.engine import ExtractionEngine, IDENTITY_FUSION_AVAILABLE, IDENTITY_ESTABLISHED_MIN  # noqa: E402

FAIL = 0


def check(label, cond):
    global FAIL
    print(("  OK  " if cond else "  BAD ") + label)
    if not cond:
        FAIL += 1


if not IDENTITY_FUSION_AVAILABLE:
    print("identity_fusion (rapidfuzz) unavailable — skipping (feature inert without it)")
    sys.exit(0)

RESOLVED = "Print Tracker Ltd"
HEADER_NAME = "Beaumont Care Homes Ltd"   # a customer name that is ALSO a known supplier
# Letterhead chrome that clearly reads the customer/recipient name (before any recipient marker).
CHROME = f"{HEADER_NAME}\nInvoice\n123 Somewhere Road\nBelfast BT1 1AA\n"

eng = ExtractionEngine()


def verdict(resolved_match_count):
    # gazetteer: both names known; the resolved supplier has `resolved_match_count` logo hits.
    logos = [
        {"supplier_name": RESOLVED, "match_count": resolved_match_count},
        {"supplier_name": HEADER_NAME, "match_count": 9},
    ]
    hints = [{"supplier_name": HEADER_NAME, "usage_count": 9}]
    return eng._compute_identity_verdict(CHROME, logos, hints, [], RESOLVED)


# Sanity: the header name must actually be picked as a conflict candidate when NOT established,
# else the test proves nothing.
v_new = verdict(1)
check("new supplier (match_count 1): letterhead picks the customer name", v_new and v_new.get("text_led") == HEADER_NAME)
check("new supplier (< MIN): conflict FIRES",                              v_new and v_new.get("conflict") is True)
check("new supplier: established is False",                                v_new and v_new.get("established") is False)

v_est = verdict(IDENTITY_ESTABLISHED_MIN)
check(f"established supplier (match_count {IDENTITY_ESTABLISHED_MIN} >= MIN): established True", v_est and v_est.get("established") is True)
check("established supplier: conflict SUPPRESSED (no flag)",               v_est and v_est.get("conflict") is False)
check("established supplier: text_led still recorded (measurement intact)", v_est and v_est.get("text_led") == HEADER_NAME)

# Just below the threshold still flags (boundary).
v_below = verdict(IDENTITY_ESTABLISHED_MIN - 1)
check("one below MIN: still NOT established -> conflict fires",            v_below and v_below.get("conflict") is True)

# Explicit "Issuer is correct" button: accepting the resolved supplier suppresses the flag even
# with NO history (match_count 1), and is orthogonal to established.
eng.set_accepted_issuers([RESOLVED])
v_accepted = verdict(1)
check("accepted issuer (button): accepted_issuer True",                   v_accepted and v_accepted.get("accepted_issuer") is True)
check("accepted issuer (button): conflict SUPPRESSED even with no history", v_accepted and v_accepted.get("conflict") is False)
check("accepted issuer: NOT falsely marked established",                  v_accepted and v_accepted.get("established") is False)
eng.set_accepted_issuers([])  # reset — a DIFFERENT supplier is not covered by the allowlist
check("allowlist is exact: a new supplier still flags after reset",       verdict(1).get("conflict") is True)

print("\n" + ("All identity-established checks passed" if FAIL == 0 else f"{FAIL} FAILED"))
sys.exit(1 if FAIL else 0)
