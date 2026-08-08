#!/usr/bin/env python3
"""autofile_census.py — Oracle gates (a) and (b) for the pad-window LABELLED sub-slice.

Accuracy deltas and M cannot see this change's dominant cost: a value that stays CORRECT but
crosses >=88 -> <88, or gains a validation_note, scores identically while silently costing the
customer an auto-file. This enumerates exactly those documents.

Gate (a) MERGE BAR: zero docs whose value equals GT lose auto-file eligibility.
Gate (b) MERGE BAR: zero 'provisional'-tier swaps land at >= 88 (proxy: no _padunclip at >= 88 that
                    is not backed by confirmed consent — reported for eyeballing).

Usage: py -3.12 scratchpad/autofile_census.py <baseline.jsonl> <armed.jsonl>
"""
import json
import sys
from collections import Counter

FLOOR = 88          # the critical auto-file floor (database/modules/trust.js)


def load(p):
    rows = {}
    with open(p, encoding="utf-8") as fh:
        for ln in fh:
            ln = ln.strip()
            if not ln:
                continue
            try:
                r = json.loads(ln)
            except Exception:
                continue
            rows[r.get("file")] = r
    return rows


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    base, armed = load(sys.argv[1]), load(sys.argv[2])
    common = [f for f in base if f in armed]
    print(f"baseline docs={len(base)}  armed docs={len(armed)}  common={len(common)}\n")

    lost, gained_note, fires = [], [], []
    heal_af = []
    for f in common:
        b, a = base[f], armed[f]
        bc, ac = b.get("confs") or {}, a.get("confs") or {}
        bn, an = b.get("notes") or {}, a.get("notes") or {}
        bv, av = b.get("verdicts") or {}, a.get("verdicts") or {}
        am = a.get("methods") or {}
        for lane in set(bc) | set(ac):
            b_conf, a_conf = bc.get(lane), ac.get(lane)
            correct = av.get(lane)
            if b_conf is not None and a_conf is not None:
                if b_conf >= FLOOR and a_conf < FLOOR:
                    (lost if correct else heal_af).append((f, lane, b_conf, a_conf, correct))
                elif b_conf < FLOOR and a_conf >= FLOOR:
                    heal_af.append((f, lane, b_conf, a_conf, correct))
            if lane not in bn and lane in an:
                gained_note.append((f, lane, correct, an[lane][:70]))
        for lane, meth in am.items():
            if "_padunclip" in str(meth) or "_padcodeflag" in str(meth):
                fires.append((f, lane, meth, ac.get(lane), av.get(lane),
                              (a.get(f"{lane}_got") if not av.get(lane) else "(matches GT)")))

    print("=== GATE (a) — AUTO-FILE LOSSES on values that are CORRECT (the merge bar) ===")
    if not lost:
        print("  none\n")
    for f, lane, bcf, acf, ok in lost:
        print(f"  LOST  {lane:<10} {bcf} -> {acf}  correct={ok}  {f}")
    print(f"  TOTAL auto-file losses on correct values: {len(lost)}   MERGE BAR: 0\n")

    print("=== confidence crossings that are NOT a loss on a correct value (context) ===")
    for f, lane, bcf, acf, ok in heal_af[:20]:
        print(f"  {lane:<10} {bcf} -> {acf}  correct={ok}  {f}")
    print(f"  total: {len(heal_af)}\n")

    print("=== docs that GAINED a validation_note ===")
    for f, lane, ok, note in gained_note[:25]:
        mark = "  <== on a CORRECT value" if ok else ""
        print(f"  {lane:<10} correct={ok}  {note}{mark}\n      {f}")
    print(f"  total: {len(gained_note)}\n")

    print("=== GATE (b) — PAD FIRE CENSUS (armed arm) ===")
    if not fires:
        print("  no pad fires in the corpus (sub-slice inert here)")
    for f, lane, meth, conf, ok, got in fires:
        bad = ""
        if "_padunclip" in meth and not ok:
            bad = "  <== BAD SWAP (STOP)"
        elif "_padcodeflag" in meth and ok:
            bad = "  <== FALSE FLAG on a correct value"
        print(f"  {lane:<10} {meth} conf={conf} correct={ok} got={got}{bad}\n      {f}")
    kinds = Counter("swap" if "_padunclip" in m else "flag" for _, _, m, _, _, _ in fires)
    print(f"\n  fires: {dict(kinds)}")
    bad_swaps = sum(1 for _, _, m, _, ok, _ in fires if "_padunclip" in m and not ok)
    false_flags = sum(1 for _, _, m, _, ok, _ in fires if "_padcodeflag" in m and ok)
    print(f"  bad swaps: {bad_swaps}   false flags on correct values: {false_flags}   MERGE BAR: both 0")
    return 0 if (not lost and not bad_swaps and not false_flags) else 1


if __name__ == "__main__":
    sys.exit(main())
