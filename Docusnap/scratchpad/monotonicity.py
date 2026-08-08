#!/usr/bin/env python3
"""monotonicity.py — doc-level TRUE->FALSE check between two customer_corpus_score jsonl runs.

Usage: py -3.12 scratchpad/monotonicity.py <baseline.jsonl> <armed.jsonl>

Prints, per field key: heals (F->T), regressions (T->F), and the per-doc T->F list.
The gate the project uses: M = 0 for the targeted field(s) and ZERO doc-level true->false.
"""
import json
import sys
from collections import defaultdict


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
    print(f"baseline docs={len(base)}  armed docs={len(armed)}  common={len(common)}")
    heal = defaultdict(int)
    regress = defaultdict(list)
    for f in common:
        bv = base[f].get("verdicts") or {}
        av = armed[f].get("verdicts") or {}
        for k in set(bv) | set(av):
            b, a = bv.get(k), av.get(k)
            if b is True and a is False:
                regress[k].append(f)
            elif b is False and a is True:
                heal[k] += 1
    keys = sorted(set(heal) | set(regress))
    print(f"{'field':<12}{'heal F->T':>11}{'REGRESS T->F':>14}")
    for k in keys:
        print(f"{k:<12}{heal[k]:>11}{len(regress[k]):>14}")
    total_r = sum(len(v) for v in regress.values())
    print(f"\nTOTAL true->false regressions: {total_r}")
    for k, files in regress.items():
        for f in files:
            print(f"  T->F {k}: {f}")
    return 0 if total_r == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
