"""
tests/test_teach_angle_compose_null_abstain.py — TEACH_ANGLE_COMPOSE_NULL_ABSTAIN (2026-09-07, 007 → Oracle C6-C8).

The Stage-0.5 SCAN compose reads a taught box at net = θ_teach − θ_scan and read a NULL θ_teach as 0.0 (a HALF
compose). With the switch ON a NULL sample tilt is UNKNOWN: no compose, mappings AND landmarks stay where they
were stored. A known angle is byte-identical either way.
  #1 the pure decision helper (NULL+ON → abstain; NULL+OFF → −θ_scan; known → θ_t−θ_s; the band)
  #2 the geometry pin over 007's 10-sibling measurement (fixtures/dateclip_siblings_20260907.json): the
     half-applied compose (NULL→0) cuts the first glyph ≥ 8 px on 30/90 teach→scan pairs, the FULL compose on
     10/90, and the exhibit pair (teach invoice_01 → scan invoice_04, the '5/03/2026' read) is cut under the
     half compose and clean under the full one. This pin FAILS on the NULL→0 path by construction.
  #3 source pins: the abstain skips both compose calls and logs its own line; the bridge; mig 129 seeds OFF.
Run:  py -3.12 tests/test_teach_angle_compose_null_abstain.py   (from python_backend/)
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from extraction import engine as E                                     # noqa: E402

fails = 0


def check(label, cond, extra=""):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}{('  ' + extra) if (extra and not cond) else ''}")
    if not cond:
        fails += 1


LO, HI = E._COMPOSE_SCAN_MIN_NET, E._COMPOSE_SCAN_MAX_NET
D = E._compose_scan_decision

print("#1 the decision helper")
check("NULL sample tilt + switch ON → abstain (no compose)", D(None, 1.5, True, LO, HI) == (None, 'abstain'))
net, why = D(None, 1.5, False, LO, HI)
check("NULL sample tilt + switch OFF → today's half compose by −θ_scan", why == 'null_as_0' and abs(net - (-1.5)) < 1e-9)
net, why = D(1.2, 1.5, True, LO, HI)
check("known tilt → θ_teach − θ_scan regardless of the switch", why == 'compose' and abs(net - (-0.3)) < 1e-9 and D(1.2, 1.5, False, LO, HI) == (net, 'compose'))
check("|net| below the floor → no compose (either switch)", D(1.2, 1.3, True, LO, HI)[0] is None and D(1.2, 1.3, False, LO, HI)[0] is None)
check("|net| above the ceiling → no compose", D(8.0, 0.0, False, LO, HI) == (None, 'above'))
check("a measured LEVEL sample (0.0) is NOT null — composes by −θ_scan even with the switch ON", D(0.0, 1.5, True, LO, HI)[1] == 'compose')

print("#2 the 10-sibling geometry pin (007, 2026-09-07)")
fx = json.load(open(os.path.join(os.path.dirname(__file__), "fixtures", "dateclip_siblings_20260907.json")))
S = {r['doc']: r for r in fx['siblings']}
docs = sorted(S)


def snap_box(r):
    h = r['value_h'] / r['H']
    pad = min(0.004, h * 0.15)                     # shared/boxSnap.js left pad
    x1 = r['value_left'] / r['W']
    x2 = r['value_right'] / r['W']
    y1 = r['value_top'] / r['H']
    return {"x": x1 - pad, "y": y1 - pad, "w": (x2 + 0.004) - (x1 - pad), "h": h + 2 * pad}


def cut_px(teach, scan, mode):
    """+ = the composed box starts INSIDE the value (first glyph cut); − = slack to its left."""
    b = snap_box(S[teach])
    Wj, Hj = S[scan]['W'], S[scan]['H']
    th_t = S[teach]['skew_deg'] if mode == 'full' else (0.0 if mode == 'half' else None)
    if mode == 'stationary':
        nx = b['x']
    else:
        net, why = D(th_t, S[scan]['skew_deg'], False, LO, HI)
        nx = E._compose_box_to_level(b['x'], b['y'], b['w'], b['h'], net, Wj, Hj)[0] if net is not None else b['x']
    return nx * Wj - S[scan]['value_left']


def count(mode):
    return sum(1 for i in docs for j in docs if i != j and cut_px(i, j, mode) >= 8)


half, full, stat = count('half'), count('full'), count('stationary')
check(f"half compose (NULL read as 0.0) cuts the first glyph on 30/90 pairs (got {half})", half == 30)
check(f"full compose (angle known) cuts on 10/90 pairs (got {full}) — paper placement, not tilt", full == 10)
check(f"stationary read cuts on 30/90 pairs (got {stat}) — abstain is not a free lunch, it is honest", stat == 30)
ex_half, ex_full = cut_px('01', '04', 'half'), cut_px('01', '04', 'full')
check(f"the exhibit pair (teach 01 → scan 04): half compose cut {ex_half:+.1f} px ≥ 8 (the '5/03/2026' read)", ex_half >= 8)
check(f"…and clean under the full compose ({ex_full:+.1f} px < 8)", ex_full < 8)
# the abstain path == the stationary read: the box is exactly the stored box
b = snap_box(S['01'])
net, why = D(None, S['04']['skew_deg'], True, LO, HI)
check("abstain leaves the stored box untouched (net None → x unchanged)", net is None and why == 'abstain')

print("#3 source pins")
root = os.path.join(os.path.dirname(__file__), "..")
eng = open(os.path.join(root, "extraction", "engine.py"), encoding="utf-8").read()
m = re.search(r"if _tt_raw is None and TEACH_ANGLE_COMPOSE_NULL_ABSTAIN:(.*?)else:", eng, re.S)
check("the abstain branch logs its own line + trace and calls NEITHER compose helper",
      bool(m) and "stationary read" in m.group(1) and "compose_scan_abstain" in m.group(1)
      and "_compose_mappings_to_level" not in m.group(1) and "_compose_landmarks_to_level" not in m.group(1))
check("the flag defaults OFF (env absent → today's NULL→0.0)", "TEACH_ANGLE_COMPOSE_NULL_ABSTAIN = os.environ.get('TEACH_ANGLE_COMPOSE_NULL_ABSTAIN', '0') != '0'" in eng)
check("the compose branch routes through the pure decision (pinned above)", "_compose_scan_decision(" in eng.split("def _compose_scan_decision")[1])
hnd = open(os.path.join(root, "..", "src", "modules", "processing", "handler.js"), encoding="utf-8").read()
check("the bridge maps the setting to the env", "teach_angle_compose_null_abstain', 'false') === 'true') env.TEACH_ANGLE_COMPOSE_NULL_ABSTAIN = '1'" in hnd)
dbi = open(os.path.join(root, "..", "database", "index.js"), encoding="utf-8").read()
check("mig 129 seeds OFF and there is NO force-ON twin yet", "VALUES ('teach_angle_compose_null_abstain', 'false')" in dbi
      and "VALUES ('teach_angle_compose_null_abstain', 'true')" not in dbi)

print(f"\n{'PASS' if not fails else 'FAIL'} -- {fails} failure(s)")
sys.exit(1 if fails else 0)
