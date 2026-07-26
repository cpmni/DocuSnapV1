#!/usr/bin/env python3
"""
tests/test_logo_detail_global_rivals.py
---------------------------------------
Slice A (Oracle SIGN-OFF-WITH-CONDITIONS 2026-07-26, kill LOGO_DETAIL_GLOBAL_RIVALS default OFF):
`_logo_detail_veto`'s rival universe was built ONLY from `cands` — which `_logo_candidates` cuts at
LOGO_THRESHOLD on the 64-bit COARSE hash — so the true supplier whose coarse phash drifted OUT of the
band (the doc-193 case veto_by_detail's own docstring describes, re-measured live on the Saltmarsh
dockets 2026-07-26: wrong-supplier lock at coarse d=4 while every own template sat >=14) was
structurally INVISIBLE to the veto. Armed + given `all_templates`, BOTH sides (pick set + rivals)
build from ALL templates (A1 — rival-only globalisation would asymmetrically raise the veto rate).

Pins:
  1. OFF => byte-identical: an out-of-band rival is invisible, veto False (today's behaviour).
  2. ON  => the same rival is found, veto True (positive-rival semantic intact).
  3. ON, no rival anywhere => False (mere absence NEVER abstains — the "matches Acme by logo alone"
     class stays matchable).
  4. ON, pick has NO enrolled detail (pm-None) => False (the logo_detail.py:329 KEEP pin holds in
     global mode too).
  5. ON, the mark AGREES with the pick's own set => False (a genuine single-supplier match is never
     dropped, regardless of universe size).

Usage: py -3.12 python_backend/tests/test_logo_detail_global_rivals.py
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import template_matcher as tm   # noqa: E402

# 256-bit detail hashes as 64-hex strings with KNOWN hamming distances.
Q_DETAIL   = "00" * 32                 # the scanned mark
NEAR       = Q_DETAIL                  # d=0   (<= veto threshold 72)  — a positive rival match
FAR        = "ff" * 32                 # d=256 (>  veto threshold 72)  — disagrees with the mark

def T(name, sup, details, phashes=None):
    return {"id": hash(name) % 1000, "name": name, "dominant_supplier": sup,
            "document_type_slug": "delivery_note",
            "logo_detail_hashes": details, "logo_phashes": phashes or []}

PICK  = T("Wrong Corp delivery", "Wrong Corp", [FAR])          # coarse-locked, mark disagrees
RIVAL = T("True Corp delivery", "True Corp", [NEAR])           # the real supplier — coarse OUT of band
CANDS = [(PICK, 4)]                                            # rival NOT in cands (the whole bug)
ALL   = [PICK, RIVAL]


def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return cond


def run(env_on, cands=CANDS, best=PICK, q=Q_DETAIL, all_templates=ALL):
    # DEFAULT flipped ON 2026-07-26 — OFF cases must now set '0' EXPLICITLY (popping = ON).
    old = os.environ.get("LOGO_DETAIL_GLOBAL_RIVALS")
    try:
        os.environ["LOGO_DETAIL_GLOBAL_RIVALS"] = "1" if env_on else "0"
        return tm._logo_detail_veto(cands, 4, best, q, all_templates=all_templates)
    finally:
        if old is None:
            os.environ.pop("LOGO_DETAIL_GLOBAL_RIVALS", None)
        else:
            os.environ["LOGO_DETAIL_GLOBAL_RIVALS"] = old


def main():
    fails = 0

    # 1. OFF: rival out of band => invisible => False (today, pinned).
    fails += not check("OFF: out-of-band rival invisible -> veto False (byte-identical)",
                       run(False) is False)

    # 2. ON: same setup, rival found globally => True.
    fails += not check("ON: global universe finds the rival -> veto True",
                       run(True) is True)

    # 3. ON: no rival anywhere => False (mere absence never abstains).
    fails += not check("ON: no rival anywhere -> False (absence != abstain)",
                       run(True, all_templates=[PICK]) is False)

    # 4. ON: pm-None (pick has no enrolled detail) => False — the :329 KEEP pin survives global mode.
    pick_nodetail = T("Wrong Corp bare", "Wrong Corp", [])
    fails += not check("ON: pm-None pick -> False (logo_detail.py:329 pin holds)",
                       run(True, cands=[(pick_nodetail, 4)], best=pick_nodetail,
                           all_templates=[pick_nodetail, RIVAL]) is False)

    # 5. ON: mark agrees with the pick's own set => False (genuine match never dropped).
    pick_agree = T("Right Corp delivery", "Right Corp", [NEAR])
    fails += not check("ON: mark agrees with pick -> False (genuine match kept)",
                       run(True, cands=[(pick_agree, 4)], best=pick_agree,
                           all_templates=[pick_agree, RIVAL]) is False)

    # 6. Legacy call shape (no all_templates kwarg value) behaves exactly as before, even armed.
    fails += not check("ON but all_templates=None -> cands-scoped (legacy callers byte-identical)",
                       run(True, all_templates=None) is False)

    print()
    print(f"{fails} FAILED" if fails else "All global-rivals veto checks passed")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
