"""TYPE-PRESENCE VETO (Type Slice 1, 2026-07-28) — Python consume-side pins + JS<->Python parity.

The check side of database/modules/typePresence.js. Reads the SAME shared vectors as the JS twin
(test_type_presence.js) so both sides provably score the identical token set + top band + >=0.6
whole-word match (Oracle C-a). Then pins the veto predicate _type_heading_absent (armed / not-armed /
thin scan / heading present / no tokens -> fail-toward-abstain).

Run:  py -3.12 tests/test_type_presence_matcher.py   (from python_backend/)
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# A clean env: the predicate reads TYPE_PRESENCE_* thresholds with defaults.
for _k in ("TYPE_PRESENCE_MIN_SAMPLE", "TYPE_PRESENCE_RATIO", "TYPE_PRESENCE_MIN_TOKENS"):
    os.environ.pop(_k, None)

from extraction.template_matcher import (_type_heading_present, _type_presence_top_band,
                                        _type_heading_absent)

VEC = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                  "data", "type_presence_vectors.json"), encoding="utf-8"))

fails = 0


def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1


# A ≥50-token body so a candidate clears the thin-scan abstain and the veto can actually judge.
BODY = ("\n" + " ".join(f"row{i} item quantity price line" for i in range(20)))


def cand(top):
    return (top + BODY).lower()


# ── parity: _type_heading_present on the shared vectors (identical to JS headingPresent) ──
print("-- _type_heading_present (parity with typePresence.js.headingPresent) --")
for v in VEC["present"]:
    got = _type_heading_present(v["tokens"], v["band"])
    check(f"{v['tokens']} in {v['band']!r} -> {v['expect']}", got == v["expect"])
check("whole-word only ('order' not inside 'reorder')",
      _type_heading_present(["order"], "please reorder soon") is False)
check("empty tokens / band -> False",
      _type_heading_present([], "delivery docket") is False and _type_heading_present(["x"], "") is False)

# ── _type_presence_top_band ──────────────────────────────────────────────────────
print("-- _type_presence_top_band --")
check("caps at 14 lines", len(_type_presence_top_band("\n".join(f"line{i}" for i in range(30))).split("\n")) == 14)
check("caps at 600 chars", len(_type_presence_top_band("x" * 1000)) == 600)

# ── _type_heading_absent (the veto predicate) ────────────────────────────────────
print("-- _type_heading_absent (armed / abstain ordering) --")
ARMED = {"type_heading_tokens": ["delivery", "docket"], "type_heading_ratio": 0.97,
         "type_heading_n": 10, "document_type_slug": "delivery_note"}


def _with(**kw):
    d = dict(ARMED)
    d.update(kw)
    return d


check("ARMED + heading ABSENT (a worksheet stamped delivery_note) -> HOLD (True)",
      _type_heading_absent(ARMED, cand("Acme Fabrication Ltd\nWORKSHEET 38\nNo 4471")) is True)
check("ARMED + heading PRESENT (a real delivery docket) -> no veto (False)",
      _type_heading_absent(ARMED, cand("Acme Fabrication Ltd\nDELIVERY DOCKET\nNo 4471")) is False)
check("not armed: ratio < 0.80 -> no veto",
      _type_heading_absent(_with(type_heading_ratio=0.5), cand("Acme Ltd\nWORKSHEET 38")) is False)
check("not armed: n < 3 -> no veto",
      _type_heading_absent(_with(type_heading_n=2), cand("Acme Ltd\nWORKSHEET 38")) is False)
check("thin scan (< 50 tokens) -> never veto",
      _type_heading_absent(ARMED, "acme ltd worksheet 38") is False)
check("no tokens -> no veto",
      _type_heading_absent(_with(type_heading_tokens=[]), cand("Acme Ltd\nWORKSHEET 38")) is False)
check("garbage ratio/n -> no veto (fail-safe)",
      _type_heading_absent(_with(type_heading_ratio="x", type_heading_n=None),
                           cand("Acme Ltd\nWORKSHEET 38")) is False)

# threshold override is honoured
os.environ["TYPE_PRESENCE_RATIO"] = "0.99"
check("env TYPE_PRESENCE_RATIO=0.99 disarms a 0.97 template",
      _type_heading_absent(ARMED, cand("Acme Ltd\nWORKSHEET 38")) is False)
os.environ.pop("TYPE_PRESENCE_RATIO", None)

print()
if fails:
    print(f"FAIL: {fails} check(s) failed")
    sys.exit(1)
print("All type-presence (Python consume) pins passed.")
