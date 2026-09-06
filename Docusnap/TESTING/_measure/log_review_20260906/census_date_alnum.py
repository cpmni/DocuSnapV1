"""Item 3 gate — the alnum-lookbehind DATE census over a VAL_CENSUS_DIR run (keyword + crop sites).
For every date-site record: where does the OLD pattern's first match start, and does the NEW pattern
match at all / elsewhere? Classes:
  A  old accepted, new REJECTS entirely            (the affected population — expect only code-shaped windows)
  B  old and new both match but at DIFFERENT windows (the real date sat past a code-shaped window)
  C  same window (unaffected)
  D  neither matches
Usage: py -3.12 census_date_alnum.py <census_dir> [out.md]"""
import glob
import io
import json
import os
import re
import sys

OLD = [r'(?<!\d)\d{4}[/\-]\d{2}[/\-]\d{2}(?!\d)', r'(?<!\d)\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}(?!\d)']
NEW = [r'(?<![A-Za-z0-9])\d{4}[/\-]\d{2}[/\-]\d{2}(?!\d)', r'(?<![A-Za-z0-9])\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}(?!\d)']


def first(pats, s):
    best = None
    for p in pats:
        m = re.search(p, s, re.IGNORECASE)
        if m and (best is None or m.start() < best.start()):
            best = m
    return best


d = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(d, 'date_alnum_census.md')
recs = []
for f in glob.glob(os.path.join(d, 'val_*.jsonl')):
    for line in io.open(f, encoding='utf-8'):
        try:
            r = json.loads(line)
        except Exception:
            continue
        if r.get('val_type') == 'date':
            recs.append(r)
cls = {'A': [], 'B': [], 'C': 0, 'D': 0}
for r in recs:
    v = str(r.get('value') or '')
    mo, mn = first(OLD, v), first(NEW, v)
    if mo and not mn:
        cls['A'].append((r.get('site'), v, mo.group(0), v[max(0, mo.start() - 1):mo.start()]))
    elif mo and mn and mo.group(0) != mn.group(0):
        cls['B'].append((r.get('site'), v, mo.group(0), mn.group(0)))
    elif mo and mn:
        cls['C'] += 1
    else:
        cls['D'] += 1
sites = {}
for r in recs:
    sites[r.get('site')] = sites.get(r.get('site'), 0) + 1
lines = [f"# Item 3 alnum-lookbehind DATE census — {d}", "",
         f"date-site records: {len(recs)} (by site: {sites}) · A old-only: {len(cls['A'])} · B window moved: {len(cls['B'])} · C same: {cls['C']} · D neither: {cls['D']}", "",
         "## A — OLD accepted, NEW rejects (the affected population)", "", "| site | value | old match | glyph before |", "|---|---|---|---|"]
for s, v, m, g in cls['A'][:200]:
    lines.append(f"| {s} | `{v[:80]}` | `{m}` | `{g}` |")
lines += ["", "## B — window moved", "", "| site | value | old | new |", "|---|---|---|---|"]
for s, v, mo, mn in cls['B'][:200]:
    lines.append(f"| {s} | `{v[:80]}` | `{mo}` | `{mn}` |")
io.open(out, 'w', encoding='utf-8').write("\n".join(lines) + "\n")
print("\n".join(lines[:3]))
print(f"... written {out}")
