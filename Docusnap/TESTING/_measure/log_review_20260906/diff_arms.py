"""Diff two realdoc arms by their RR_CONSENSUS jsonl: per-doc field value changes + the AUTO-FILE ELIGIBILITY
DELTA (wouldFile OFF→ON). Usage: py -3.12 diff_arms.py <consensus_A.jsonl> <consensus_B.jsonl> [out.md]"""
import io
import json
import sys


def load(p):
    out = {}
    for line in io.open(p, encoding='utf-8'):
        try:
            r = json.loads(line)
        except Exception:
            continue
        out[r.get('id')] = r
    return out


a_path, b_path = sys.argv[1], sys.argv[2]
out = sys.argv[3] if len(sys.argv) > 3 else None
A, B = load(a_path), load(b_path)
ids = sorted(set(A) | set(B), key=lambda x: (x is None, x))
value_diffs, elig = [], {'A_only': [], 'B_only': [], 'both': 0, 'neither': 0}
for i in ids:
    ra, rb = A.get(i), B.get(i)
    if not ra or not rb:
        value_diffs.append((i, 'MISSING', 'in A' if ra else 'in B', ''))
        continue
    wa, wb = bool(ra.get('wouldFile')), bool(rb.get('wouldFile'))
    if wa and wb:
        elig['both'] += 1
    elif wa:
        elig['A_only'].append(i)
    elif wb:
        elig['B_only'].append(i)
    else:
        elig['neither'] += 1
    fa, fb = ra.get('fields') or {}, rb.get('fields') or {}
    for k in sorted(set(fa) | set(fb)):
        va, vb = fa.get(k), fb.get(k)
        if va != vb:
            value_diffs.append((i, k, va, vb))
    for k in ('ref', 'date', 'type', 'overall'):
        if ra.get(k) != rb.get(k):
            value_diffs.append((i, k, ra.get(k), rb.get(k)))
lines = [f"# Arm diff — A=`{a_path}` vs B=`{b_path}`", "",
         f"docs: {len(ids)} · wouldFile both: {elig['both']} · neither: {elig['neither']} · A-only: {len(elig['A_only'])} {elig['A_only'][:40]} · B-only: {len(elig['B_only'])} {elig['B_only'][:40]}",
         "", f"value/field diffs: {len(value_diffs)}", "", "| doc | field | A | B |", "|---|---|---|---|"]
for i, k, va, vb in value_diffs[:400]:
    lines.append(f"| {i} | {k} | `{str(va)[:60]}` | `{str(vb)[:60]}` |")
txt = "\n".join(lines) + "\n"
if out:
    io.open(out, 'w', encoding='utf-8').write(txt)
print("\n".join(lines[:6]))
if len(value_diffs) <= 40:
    print("\n".join(lines[6:]))
