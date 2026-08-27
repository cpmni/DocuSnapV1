"""analyse_census.py — summarise census_light_text.py's JSONL for the Oracle gate (condition 7).
Usage: py -3.12 analyse_census.py <census.jsonl>
Prints: totals, conf/digit histograms, the OFF⊂ON violation pages with samples, column-break losses, band shrink,
rung-2-window words, other-supplier names in added lines, footer/date/money-like counts, the 30 highest-add pages and a
random 30-page sample of added lines for the by-eye check."""
import json, random, sys
from collections import Counter
rows = [json.loads(l) for l in open(sys.argv[1], encoding='utf-8') if l.strip()]
rows = [r for r in rows if 'error' not in r]
n = len(rows); adds = [r for r in rows if r['added']]
print(f'pages {n} · pages with adds {len(adds)} ({100*len(adds)/max(1,n):.0f}%) · words added {sum(r["added"] for r in rows)} · '
      f'extra s/page {sum(r["t_on"]-r["t_off"] for r in rows)/max(1,n):.2f} · by status {Counter(r["status"] for r in rows)}')
conf = Counter(); dig = Counter()
for r in adds:
    for (t, c, hr, y) in r['added_words']:
        conf['90+' if c >= 90 else '80-89' if c >= 80 else '70-79' if c >= 70 else '60-69'] += 1
        if any(ch.isdigit() for ch in t): dig['90+' if c >= 90 else '80-89' if c >= 80 else '70-79'] += 1
print('conf hist', dict(conf), '· digit-bearing hist', dict(dig))
viol = [r for r in rows if r['off_lines_missing']]
unexpl = [r for r in rows if r.get('viol_unexplained_n')]
print(f'\nOFF⊂ON violations: {len(viol)} pages · UNEXPLAINED (lost tokens that are not replaced slivers): {len(unexpl)} pages · '
      f'slivers replaced on {sum(1 for r in rows if r.get("light_replaced"))} pages')
for r in viol[:12]:
    print(f"   #{r['id']} {r['supplier']} missing={r['off_lines_missing']} unexplained={r.get('viol_unexplained_n', '?')} "
          f"replaced={r.get('light_replaced', '?')} sample={r['missing_sample'][:1]}")
cb = [r for r in rows if r['col_breaks_lost']]
print(f'\ncolumn breaks lost: {len(cb)} pages ·', [(r['id'], r['col_breaks_lost']) for r in cb[:10]])
print('band shrank:', [(r['id'], r['band_len_off'], r['band_len_on']) for r in rows if r['band_shrank']][:10])
print('heading band changed:', [r['id'] for r in rows if not r['heading_band_same']][:10])
print('rung-2 window light words:', sum(r['rung2_window'] for r in rows), [(r['id'], r['rung2_window']) for r in rows if r['rung2_window']][:10])
oth = [r for r in rows if r['other_supplier_named']]
print(f'\nother-supplier names in added lines: {len(oth)} pages')
for r in oth[:10]: print(f"   #{r['id']} own={r['supplier']!r} named={r['other_supplier_named']} lines={r['added_lines'][:2]}")
print('\nfooter-like pages', sum(1 for r in adds if r['footer_like']), '· date-like lines', sum(r['date_like'] for r in adds), '· money-like lines', sum(r['money_like'] for r in adds))
print('\ninto-base-rows total', sum(r['into_base_rows'] for r in adds), '· pages', sum(1 for r in adds if r['into_base_rows']))
top = sorted(adds, key=lambda r: -r['added'])[:8]
print('\nmost-added pages:', [(r['id'], r['added'], r['supplier']) for r in top])
random.seed(20260827)
print('\n=== by-eye sample (30 pages) — added lines:')
for r in random.sample(adds, min(30, len(adds))):
    print(f"#{r['id']} {r['supplier']} (+{r['added']}): {r['added_lines'][:3]}")
