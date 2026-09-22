"""Classify the refined-run fires on the 700 corpus: for each doc PP held, was the committed
(Tesseract) ref actually RIGHT (a FALSE hold) or WRONG (a real CATCH)? Uses the harness's own
GT-correct flag (ref.correct) from on2.jsonl. Also confirms wouldFile(ON2) ⊆ wouldFile(OFF) and no
value change vs off.jsonl.
"""
import json, os
D = os.path.dirname(os.path.abspath(__file__))


def load(fn):
    out = {}
    p = os.path.join(D, fn)
    if os.path.exists(p):
        for ln in open(p, encoding="utf-8"):
            ln = ln.strip()
            if ln.startswith("{"):
                try:
                    m = json.loads(ln); out[m["id"]] = m
                except Exception:
                    pass
    return out


def main():
    off, on = load("off.jsonl"), load("on2.jsonl")
    ids = sorted(set(off) & set(on))

    newly_filed = [i for i in ids if on[i].get("wouldFile") and not off[i].get("wouldFile")]
    val_changed = [(i, (off[i].get("ref") or {}).get("val"), (on[i].get("ref") or {}).get("val"))
                   for i in ids if (off[i].get("ref") or {}).get("val") != (on[i].get("ref") or {}).get("val")]
    newly_held = [i for i in ids if off[i].get("wouldFile") and not on[i].get("wouldFile")]

    # classify each newly-held doc by whether its committed ref was GT-correct
    catch, false_hold = [], []
    for i in newly_held:
        r = on[i].get("ref") or {}
        (false_hold if r.get("correct") else catch).append((i, r.get("val")))

    print(f"docs compared: {len(ids)}")
    print(f"wouldFile(ON) ⊆ wouldFile(OFF): {'PASS' if not newly_filed else 'FAIL ' + str(newly_filed)}")
    print(f"ref value unchanged: {'PASS' if not val_changed else 'FAIL ' + str(val_changed[:5])}")
    print(f"\nnewly HELD by PP: {len(newly_held)}")
    print(f"  CATCH (committed ref was WRONG, PP held it): {len(catch)}")
    for i, v in catch[:20]:
        print(f"    #{i} '{v}'")
    print(f"  FALSE HOLD (committed ref was RIGHT, PP held anyway): {len(false_hold)}")
    for i, v in false_hold[:20]:
        print(f"    #{i} '{v}'")
    denom = len(ids)
    print(f"\nfalse-hold rate: {len(false_hold)}/{denom} = {100*len(false_hold)/denom:.1f}%")
    print(f"catch rate: {len(catch)}/{denom} = {100*len(catch)/denom:.1f}%")


if __name__ == "__main__":
    main()
