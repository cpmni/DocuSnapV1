#!/usr/bin/env python3
"""test_drift_override_guard.py -- TEMPLATE_DRIFT_OVERRIDE_GUARD (mig 157, DARK; 007 -> Oracle SIGN-OFF-W/COND).

The Stage-0.5 drift override DISCARDS a credible absolute read and relocates off the located label. When a
fuzzy cross-word stranger (the address line "Chester" scores 0.667 vs "Customer", above the 0.6 threshold)
is located ~2.5 lines below the taught anchor, that is a PHANTOM drift that relocates customer_name onto the
postcode line (Vellum & Crane #243: the correct "Larch & Hollow Cafe Co" @95 thrown away for "CH1 2HU").

The guard: a drift-override that discards the absolute read requires the TAUGHT label (exact/inline) OR
_locate_anchor match_score >= _DRIFT_OVERRIDE_MATCH_FLOOR. This pins:
  1. the floor value + that it sits above the 0.6 fuzzy-locate threshold that admits the stranger today;
  2. _label_is_the_taught_one rejecting the cross-word match (so #243 falls to the score floor);
  3. the C1 STRUCTURE (Oracle) -- the relocate/return is INSIDE `if _do_strong`, the whole thing is env-gated
     (OFF => byte-identical), and (the SEAM pin P3) the weak-match case does NOT set anchor_stable=True: it
     falls through so the independent registration arbiter still arbitrates a genuinely-drifted page.

The floor (0.8) is placed against _locate_anchor's COMPOSITE match_score (Oracle: spurious cross-word 0.667;
genuine garble 0.824), NOT the raw _label_score helper. The LIVE #243 confirm (guard ON -> the 0.667 relocate
is refused -> the absolute "Larch & Hollow Cafe Co" @95 stands; #245/#249 unchanged) proves the floor rejects
the real cross-word score; the mig-157 census (C2) places it on real data.

    py -3.12 python_backend/tests/test_drift_override_guard.py
"""
import sys, os, re
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "python_backend"))
from extraction.template_mapper import (_label_is_the_taught_one,
                                        _DRIFT_OVERRIDE_MATCH_FLOOR, _FUZZY_MATCH_THRESHOLD)

fails = 0
def check(label, cond):
    global fails
    print(("  OK  " if cond else "  BAD ") + label)
    if not cond:
        fails += 1

print("the floor + the fuzzy-locate threshold it sits above:")
check("the override floor is 0.8", abs(_DRIFT_OVERRIDE_MATCH_FLOOR - 0.8) < 1e-9)
check("0.8 sits well above the 0.6 fuzzy-locate threshold that admits the cross-word stranger today",
      _DRIFT_OVERRIDE_MATCH_FLOOR > _FUZZY_MATCH_THRESHOLD)

print("_label_is_the_taught_one -- the exact/inline disjunct:")
check("('Customer','Chester') is NOT the taught label (so #243 falls to the score floor)",
      _label_is_the_taught_one("Customer", "Chester") is False)
check("('Customer','Customer') IS the taught label", bool(_label_is_the_taught_one("Customer", "Customer")))

print("C1 structure (Oracle) -- source-scan of _extract_one's drift-override branch:")
src = open(os.path.join(ROOT, "python_backend", "extraction", "template_mapper.py"), encoding="utf-8").read()
m = re.search(r"if \(drift_located and drift_located\.get\(\"matched_text\"\).*?\n\s*elif drift_located:\s*\n\s*anchor_stable = True",
              src, re.S)
check("the drift-override branch + its `elif drift_located: anchor_stable = True` is present", m is not None)
branch = m.group(0) if m else ""
check("env-gated (TEMPLATE_DRIFT_OVERRIDE_GUARD off => _do_strong True => byte-identical)",
      'os.environ.get("TEMPLATE_DRIFT_OVERRIDE_GUARD", "0") == "0"' in branch)
check("the override requires the taught label OR match_score >= the floor",
      '_label_is_the_taught_one(anchor_text, drift_located.get("matched_text"))' in branch
      and 'drift_located.get("match_score") or 0.0) >= _DRIFT_OVERRIDE_MATCH_FLOOR' in branch)
check("the relocate/return is INSIDE `if _do_strong:` (a weak match does not relocate)",
      re.search(r"if _do_strong:\s*\n\s*relocated = _relocate_and_read", branch) is not None)
# THE SEAM PIN (Oracle P3): the weak-match case must NOT set anchor_stable=True inside the drift branch -- it
# falls through with anchor_stable False so the registration arbiter still fires. The ONLY `anchor_stable =
# True` is in the `elif drift_located` (NOT-drifted) arm, after the `if _do_strong` block.
body_before_elif = branch.rsplit("elif drift_located:", 1)[0]
check("SEAM (P3): the weak-match fall-through does NOT set anchor_stable=True (reg arbiter stays live)",
      "anchor_stable = True" not in body_before_elif)

print("\n" + (f"FAILED: {fails}" if fails else "ALL PASS"))
sys.exit(1 if fails else 0)
