"""soak_bundles2.py <soakRoot> — phase-B controlled set: bundles of TEMPLATED (supplier, type) docs only, so the
separator's first-page rule applies to every boundary (the phase-A misses were all non-templated pages).
  tb_01..tb_08      4-7 mixed templated docs
  tb_same_01/02     5 docs from ONE supplier (same logo back to back — the boundary must come from the fingerprint)
Sources exclude the phase-A docs. Merges into gt.json."""
import glob, json, os, random, sys
from pypdf import PdfReader, PdfWriter

root = sys.argv[1]
out = os.path.join(root, 'Bundles'); os.makedirs(out, exist_ok=True)
DEMO = os.path.join(os.path.expanduser('~'), 'Desktop', 'Demo Docs')
rng = random.Random(916)
gt_path = os.path.join(root, 'gt.json'); gt = json.load(open(gt_path, encoding='utf-8'))
used = {d['src'] for v in gt.values() for d in v['docs']}

# templated (Demo Docs folder, kind folder) pairs — verified against the sandbox templates table
PAIRS = {
    'Copperfield Electrical': ['delivery_docket', 'invoice', 'purchase_order', 'sales_order', 'worksheet'],
    'Ironbridge Fabrication': ['invoice'],
    'Saltmarsh Seafoods': ['delivery_docket'],
    'Thornbury Fasteners': ['delivery_docket', 'invoice', 'worksheet'],
    'Vellum & Crane Stationers': ['delivery_docket', 'sales_order'],
    'Northgate Textiles': ['sales_order'],
    'Marlowe Medical Supplies': ['sales_order'],
    'Ridgeway Plant Hire': ['delivery_docket', 'worksheet'],
}
# Other/SCANNED singles whose (supplier, type) is templated: everything except Quillstone (no template)
OTHER_OK = ('Castellan', 'Harrowgate', 'Ironclad', 'Meadowvale', 'Nordwind', 'Oakhaven', 'Pelican', 'Silverbeck', 'Veltrix')

pool = []
for sup, kinds in PAIRS.items():
    for k in kinds:
        for p in sorted(glob.glob(os.path.join(DEMO, sup, k, '*.pdf'))):
            rel = os.path.relpath(p, os.path.expanduser('~'))
            if rel in used or 'Processed' in p: continue
            try:
                if len(PdfReader(p).pages) == 1: pool.append((sup, p))
            except Exception: pass
for p in sorted(glob.glob(os.path.join(DEMO, 'Other', 'SCANNED', '*.pdf'))):
    if os.path.basename(p).startswith(OTHER_OK) and os.path.relpath(p, os.path.expanduser('~')) not in used:
        pool.append((os.path.basename(p).split('_')[0], p))
print(f'{len(pool)} templated single-page sources')
rng.shuffle(pool)

def write_bundle(name, parts):
    w = PdfWriter(); ranges = []; page = 1
    for p, label in parts:
        r = PdfReader(p); n = len(r.pages)
        for pg in r.pages: w.add_page(pg)
        ranges.append({'pages': [page, page + n - 1], 'src': os.path.relpath(p, os.path.expanduser('~')), 'label': label}); page += n
    with open(os.path.join(out, name), 'wb') as fh: w.write(fh)
    gt[name] = {'page_count': page - 1, 'docs': ranges}
    print(f'  {name}: {page - 1}p, {len(ranges)} docs: ' + ', '.join(l for _, l in parts))

# mixed bundles: consecutive docs from DIFFERENT suppliers where possible
i = 0
for k in range(8):
    n = rng.choice([4, 5, 6, 7]); parts = []; last = None
    while len(parts) < n and i < len(pool):
        sup, p = pool[i]; i += 1
        parts.append((p, os.path.basename(p)))
    write_bundle(f'tb_{k + 1:02d}.pdf', parts)
# same-supplier runs
for k, sup in enumerate(['Copperfield Electrical', 'Thornbury Fasteners']):
    cands = [p for s, p in pool[i:] if s == sup][:5]
    if len(cands) < 3: cands = [p for p in sorted(glob.glob(os.path.join(DEMO, sup, '*', '*.pdf'))) if any(f'\\{kd}\\' in p for kd in PAIRS[sup])][:5]
    write_bundle(f'tb_same_{k + 1:02d}.pdf', [(p, os.path.basename(p)) for p in cands])
json.dump(gt, open(gt_path, 'w', encoding='utf-8'), indent=1)
print(f'gt.json now {len(gt)} files')
