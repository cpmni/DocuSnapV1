"""soak_bundles.py <soakRoot> — build the CONTROLLED soak set into <soakRoot>/Bundles + gt.json.

  bundle_NN.pdf   3-8 single-page scanned Demo Docs of TEMPLATED suppliers concatenated (mixed suppliers/types)
                  → expected: split into one segment per source doc (GT = page ranges)
  bundle_mp_NN    the same, with a genuine 2-page scanned doc (Hard Set scan/multipage) in the middle
                  → expected: that doc stays ONE 2-page segment (boundary stress)
  single_NN.pdf   genuine multi-page single docs copied as-is (over-split control) → expected: NOT split
  real_34.pdf     the real 34-page scanned bundle the manual path already split on 2026-09-01 → expected: 34 segments
"""
import glob, json, os, random, shutil, sys
from pypdf import PdfReader, PdfWriter

root = sys.argv[1]
out = os.path.join(root, 'Bundles'); os.makedirs(out, exist_ok=True)
DEMO = os.path.join(os.path.expanduser('~'), 'Desktop', 'Demo Docs')
HARD = os.path.join(os.path.expanduser('~'), 'Desktop', 'Hard Set')
rng = random.Random(20260916)

# single-page scanned docs of templated suppliers: Demo Docs\<Supplier>\<type>\*.pdf + Other\SCANNED\*.pdf
skip_dirs = ('Processed', 'Other', 'TESTING', '.sf_separated_originals')
singles = []
for sup in sorted(os.listdir(DEMO)):
    d = os.path.join(DEMO, sup)
    if not os.path.isdir(d) or sup in skip_dirs: continue
    for p in sorted(glob.glob(os.path.join(d, '**', '*.pdf'), recursive=True)):
        if 'Processed' in p: continue
        try:
            if len(PdfReader(p).pages) == 1: singles.append(p)
        except Exception: pass
singles += sorted(glob.glob(os.path.join(DEMO, 'Other', 'SCANNED', '*.pdf')))
print(f'{len(singles)} single-page source docs')
rng.shuffle(singles)

mp_scans = sorted(glob.glob(os.path.join(HARD, 'scan', 'multipage', '*.pdf')))
mp_digital = sorted(glob.glob(os.path.join(HARD, 'digital', 'multipage', '*.pdf')))

gt = {}
def write_bundle(name, parts):
    """parts = [(path, label)] → concatenated pdf; gt = list of {pages:[start,end] (1-based), src, label}"""
    w = PdfWriter(); ranges = []; page = 1
    for p, label in parts:
        r = PdfReader(p); n = len(r.pages)
        for pg in r.pages: w.add_page(pg)
        ranges.append({'pages': [page, page + n - 1], 'src': os.path.relpath(p, os.path.expanduser('~')), 'label': label})
        page += n
    with open(os.path.join(out, name), 'wb') as fh: w.write(fh)
    gt[name] = {'page_count': page - 1, 'docs': ranges}
    print(f'  {name}: {page - 1}p, {len(ranges)} docs')

i = 0
for k in range(8):                                   # 8 plain bundles of 3-8 docs
    n = rng.choice([3, 4, 5, 6, 8])
    parts = [(singles[i + j], os.path.basename(singles[i + j])) for j in range(n)]; i += n
    write_bundle(f'bundle_{k + 1:02d}.pdf', parts)
for k in range(2):                                   # 2 bundles with a genuine 2-page doc in the middle
    parts = [(singles[i], os.path.basename(singles[i])), (singles[i + 1], os.path.basename(singles[i + 1]))]; i += 2
    parts.append((mp_scans[k], os.path.basename(mp_scans[k]) + ' (2-page single)'))
    parts += [(singles[i], os.path.basename(singles[i])), (singles[i + 1], os.path.basename(singles[i + 1]))]; i += 2
    write_bundle(f'bundle_mp_{k + 1:02d}.pdf', parts)
for k, p in enumerate(mp_digital[:3] + mp_scans[:2]):  # over-split controls: 3 digital + 2 scanned 2-page singles
    name = f'single_{k + 1:02d}.pdf'; shutil.copy2(p, os.path.join(out, name))
    gt[name] = {'page_count': len(PdfReader(p).pages), 'docs': [{'pages': [1, len(PdfReader(p).pages)], 'src': os.path.relpath(p, os.path.expanduser('~')), 'label': 'genuine multi-page single — must NOT split'}]}
    print(f'  {name}: {gt[name]["page_count"]}p single (control)')
real = os.path.join(DEMO, '.sf_separated_originals', 'doc00822120260901152813.pdf')
shutil.copy2(real, os.path.join(out, 'real_34.pdf'))
gt['real_34.pdf'] = {'page_count': 34, 'docs': [{'pages': [p, p], 'src': 'Demo Docs/.sf_separated_originals/doc00822120260901152813.pdf', 'label': f'page {p} (manual path split this into 34 on 2026-09-01)'} for p in range(1, 35)]}
print('  real_34.pdf: 34p real scanned bundle')
with open(os.path.join(root, 'gt.json'), 'w', encoding='utf-8') as fh: json.dump(gt, fh, indent=1)
print(f'{len(gt)} files → {out}; gt.json written')
