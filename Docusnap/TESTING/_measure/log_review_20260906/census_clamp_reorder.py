"""Item 2B gate — the REORDER BAND count with value diffs, from a VAL_CENSUS_DIR run.
Records: site 'caption_clamp_reorder_band' (a clamp the old widened-first order would have dropped) and
'caption_clamp_reorder_diff' (the same read re-done WITHOUT the clamp: old vs new value, accepted = they differ).
Usage: py -3.12 census_clamp_reorder.py <census_dir> [out.md]"""
import glob
import io
import json
import os
import sys

d = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(d, 'clamp_reorder_census.md')
band, diff = [], []
for f in glob.glob(os.path.join(d, 'val_*.jsonl')):
    for line in io.open(f, encoding='utf-8'):
        try:
            r = json.loads(line)
        except Exception:
            continue
        if r.get('site') == 'caption_clamp_reorder_band':
            band.append(r)
        elif r.get('site') == 'caption_clamp_reorder_diff':
            diff.append(r)
changed = [r for r in diff if r.get('accepted')]
lines = [f"# Item 2B reorder-band census — {d}", "",
         f"band records (clamp newly applied): {len(band)} · diff records: {len(diff)} · value CHANGED by the clamp: {len(changed)} · unchanged: {len(diff) - len(changed)}", "",
         "| val_type | field|clamp|old|new | changed |", "|---|---|---|"]
for r in diff[:300]:
    lines.append(f"| {r.get('val_type')} | `{str(r.get('value'))[:160]}` | {'YES' if r.get('accepted') else ''} |")
io.open(out, 'w', encoding='utf-8').write("\n".join(lines) + "\n")
print("\n".join(lines[:3]))
for r in changed[:40]:
    print('  CHANGED', r.get('val_type'), str(r.get('value'))[:200])
print(f"... written {out}")
