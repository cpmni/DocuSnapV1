"""Re-test every REFUSED vat candidate against the widened set (Oracle C2 on VAT_EU_FORMATS).

WHY THIS EXISTS. The 56-value census that justified the widening enumerated values this install had
COMMITTED. A value the current gate REJECTS is never written anywhere, so that census sampled a
population from which the at-risk class had already been removed — which is exactly why it could
not see that the Norwegian pattern accepted a UK number carrying its own "No" caption tail.
Widening a format can only newly ACCEPT things, so the honest question needs the REFUSALS.

FEED IT with the arm that collects them:
  VAL_CENSUS_DIR=<dir> ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe       stress_test/teach_run_ab.js valcensus
  py -3.12 stress_test/census_vat_rejected.py <dir>

PASS CRITERION (Oracle): zero refused candidates newly accepted, or every accept adjudicated.
"""
import json, os, re, sys
from collections import Counter
sys.path.insert(0, r'c:\GIT Projects\Docusnap\python_backend')
CFG = r'c:\GIT Projects\Docusnap\config\keyword_patterns.json'
vp = json.load(open(CFG, encoding='utf-8'))['validation_patterns']
UK, EU = vp['vat_gb'], vp['vat_eu']

def cov(v, pats):
    s = str(v or '').strip()
    if not s: return 0.0
    best = 0
    for p in pats:
        m = re.search(p, s, re.IGNORECASE)
        if m and len(m.group(0)) > best: best = len(m.group(0))
    return best / len(s)

d = sys.argv[1]
site = Counter(); vt = Counter(); refused = []
n = 0
for f in os.listdir(d):
    if not f.endswith('.jsonl'): continue
    for line in open(os.path.join(d, f), encoding='utf-8'):
        line = line.strip()
        if not line: continue
        r = json.loads(line); n += 1
        site[(r['site'], r['accepted'])] += 1
        vt[r['val_type']] += 1
        if not r['accepted']:
            refused.append(r)
print(f'observations: {n}')
print('by site/accepted:', dict(site))
print('val_types seen:', dict(vt))
print(f'\nREFUSED candidates: {len(refused)}')

# The widening can only affect the vat_gb gate, so that is the population to re-test.
vat_ref = [r for r in refused if r['val_type'] == 'vat_gb']
print(f'  of which val_type=vat_gb: {len(vat_ref)}')
uniq = sorted({r['value'] for r in vat_ref})
print(f'  distinct refused vat values: {len(uniq)}')
flipped = []
for v in uniq:
    before, after = cov(v, UK) >= 0.8, cov(v, UK + EU) >= 0.8
    mark = '  FLIPPED refused -> ACCEPTED' if (after and not before) else ''
    print(f'    {v!r:34} UK-only={before}  with-EU={after}{mark}')
    if after and not before: flipped.append(v)
print(f'\n*** NEWLY ACCEPTED BY THE WIDENING: {len(flipped)} ***')
for v in flipped: print('   ', repr(v))
