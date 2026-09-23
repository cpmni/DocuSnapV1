#!/usr/bin/env python3
"""THESIS CHECK (owner 2026-09-23 late, "verify your thesis"): a label-confirmed / taught read whose value violates
the scope's learned SKELETON carries NO shape note today (engine.py ~:12081 skips the Stage-4.5 shape flag for
anchor._LABEL_CONFIRMED_METHODS + _is_stage05_located reads). How big is that population on the owner's own data,
and are those reads RIGHT (a genuinely new shape → a false hold if we flagged) or WRONG (a catch)?

Uses the engine's OWN machinery: the harness's --formats-file payload (dump_formats.js) →
format_anomaly_checker.build_format_class_index (provisional rows stripped, as engine.set_formats does) →
check_value(read, entry) with the engine's exact scope key (supplier lower, type slug lower, ref key).
GT = the owner's confirmed value (the C0 jsonl `ref.correct`).

Usage: py -3.12 shape_exempt_census.py <formats.json> <full.jsonl>
"""
import sys, json
from pathlib import Path
HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[3] / "python_backend"))
from extraction import format_anomaly_checker as fac
from extraction.anchor import _LABEL_CONFIRMED_METHODS
from extraction.engine import _is_stage05_located

formats = json.load(open(sys.argv[1], encoding="utf-8"))
solid = [e for e in formats if not (isinstance(e, dict) and e.get("provisional"))]
index = fac.build_format_class_index(solid)
print(f"format groups: {len(formats)} (solid {len(solid)}) → class index entries: {len(index)}")

rows = [json.loads(l) for l in open(sys.argv[2], encoding="utf-8") if l.strip()]
def exempt(method):
    m = str(method or "")
    return m in _LABEL_CONFIRMED_METHODS or _is_stage05_located(m)

buckets = {"exempt_viol": [], "exempt_ok": [], "gated_viol": [], "gated_ok": [], "no_shape": []}
for r in rows:
    ref = r.get("ref")
    if not ref or not ref.get("val"):
        continue
    sup = str((r.get("fields", {}).get("supplier_name") or [""])[0] or "").lower().strip()
    key = (sup, str(r.get("type") or "").lower().strip(), ref["key"])
    fe = index.get(key)
    if not fe or not fe.get("shapes"):
        buckets["no_shape"].append(r); continue
    anomaly = fac.check_value(str(ref["val"]), fe)
    ex = exempt(ref.get("method"))
    b = ("exempt" if ex else "gated") + ("_viol" if anomaly else "_ok")
    r["_anomaly"] = anomaly; r["_shapes"] = sorted(fe["shapes"])
    buckets[b].append(r)

def line(r):
    ref = r["ref"]
    return (f"  #{r['id']} {r['type']} ref='{ref['val']}' ({ref['method']}, conf {ref['conf']}) correct={ref['correct']} "
            f"note={'YES' if ref.get('note') else 'no'} reason={r['reason']} learned={r['_shapes']}")

for b, title in (("exempt_viol", "LABEL-CONFIRMED / TAUGHT read that VIOLATES the learned shape (skipped today — the thesis population)"),
                 ("gated_viol", "non-exempt read that violates the learned shape (already shape-gated today)")):
    L = buckets[b]
    wrong = [r for r in L if r["ref"]["correct"] is False]
    noted = [r for r in L if r["ref"].get("note")]
    print(f"\n{title}: {len(L)}  (WRONG vs confirmed: {len(wrong)} · already carry some note: {len(noted)})")
    for r in L: print(line(r))
print(f"\nexempt reads matching the learned shape: {len(buckets['exempt_ok'])} · gated reads matching: {len(buckets['gated_ok'])} · "
      f"refs with no learned shape for their scope: {len(buckets['no_shape'])}")
