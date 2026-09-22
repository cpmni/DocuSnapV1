"""S2 SAFETY comparator: off.jsonl vs on.jsonl (700 warm corpus). The switch may only ever HOLD, so:
  - wouldFile(ON) ⊆ wouldFile(OFF)  — NO doc may newly auto-file under ON (that would be a fail; must be 0).
  - ref VALUE identical every doc     — PP never overwrites the displayed value.
  - newly-held = wouldFile OFF=true, ON=false (the safety-side effect: extra review, never a wrong file).
"""
import json, os
D = os.path.dirname(os.path.abspath(__file__))


def load(fn):
    out = {}
    p = os.path.join(D, fn)
    if not os.path.exists(p):
        return out
    for ln in open(p, encoding="utf-8"):
        ln = ln.strip()
        if not ln.startswith("{"):
            continue
        try:
            m = json.loads(ln)
        except Exception:
            continue
        out[m["id"]] = m
    return out


def main():
    off, on = load("off.jsonl"), load("on.jsonl")
    ids = sorted(set(off) & set(on))
    print(f"docs compared: {len(ids)}  (off {len(off)} / on {len(on)})")

    newly_filed = []      # ON auto-files but OFF did not — FORBIDDEN
    newly_held = []       # OFF auto-filed but ON holds — the allowed safety effect
    val_changed = []      # ref value differs — FORBIDDEN (PP never overwrites)
    for i in ids:
        o, n = off[i], on[i]
        of, nf = bool(o.get("wouldFile")), bool(n.get("wouldFile"))
        if nf and not of:
            newly_filed.append(i)
        if of and not nf:
            newly_held.append(i)
        ov = (o.get("ref") or {}).get("val")
        nv = (n.get("ref") or {}).get("val")
        if ov != nv:
            val_changed.append((i, ov, nv))

    print(f"\nwouldFile(ON) ⊆ wouldFile(OFF): {'PASS' if not newly_filed else 'FAIL'} "
          f"(newly auto-filed under ON: {len(newly_filed)} {newly_filed[:10]})")
    print(f"ref value unchanged everywhere: {'PASS' if not val_changed else 'FAIL'} "
          f"(changed: {len(val_changed)})")
    for i, ov, nv in val_changed[:10]:
        print(f"    #{i}: {ov!r} -> {nv!r}")
    print(f"newly HELD under ON (extra review, safe): {len(newly_held)} {newly_held[:15]}")

    fires = os.path.join(D, "fires.jsonl")
    nfires = sum(1 for _ in open(fires, encoding="utf-8")) if os.path.exists(fires) else 0
    print(f"PP disagreement fires logged: {nfires}")

    ok = not newly_filed and not val_changed
    print(f"\nSAFETY: {'PASS — the switch only ever holds; no new misfile, no value change' if ok else 'FAIL'}")


if __name__ == "__main__":
    main()
