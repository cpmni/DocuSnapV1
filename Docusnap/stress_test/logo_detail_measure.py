import sqlite3, os, sys, itertools
sys.path.insert(0, r'c:\GIT Projects\Docusnap\python_backend')
import pypdfium2 as pdfium
import logo_detail

db=os.path.join(os.environ['APPDATA'],'ScanFinder','docusnap.db')
con=sqlite3.connect(f'file:{db}?mode=ro',uri=True); con.row_factory=sqlite3.Row

PER=5  # docs per supplier
rows=[dict(r) for r in con.execute("""
   SELECT supplier_name, stored_path, working_path FROM documents
   WHERE status='confirmed' AND supplier_name IS NOT NULL ORDER BY id""").fetchall()]
by_sup={}
for r in rows:
    by_sup.setdefault(r['supplier_name'],[]).append(r)

def render0(path, dpi=200):
    doc=pdfium.PdfDocument(path)
    try:
        img=doc[0].render(scale=dpi/72).to_pil()
    finally:
        doc.close()
    return img

hashes={}   # supplier -> [detail_hash,...]
print("Computing 256-bit isolated-mark detail hashes from source pages...")
for sup, docs in by_sup.items():
    got=[]
    tried=0
    for d in docs:
        if len(got)>=PER: break
        path = d['stored_path'] if d['stored_path'] and os.path.exists(d['stored_path']) else (d['working_path'] if d['working_path'] and os.path.exists(d['working_path']) else None)
        if not path: continue
        tried+=1
        try:
            h=logo_detail.detail_hash(render0(path))
        except Exception as e:
            h=None
        if h: got.append(h)
    hashes[sup]=got
    print(f"  {sup!r}: {len(got)} detail hashes computed (from {tried} files tried, {len(docs)} confirmed)")

def ham(a,b): return logo_detail.detail_distance(a,b)

print("\n=== INTRA-supplier detail-hash distance (same supplier; SMALL = stable) ===")
intra_all=[]
for s,hs in hashes.items():
    ds=[ham(a,b) for a,b in itertools.combinations(hs,2) if ham(a,b) is not None]
    intra_all+=ds
    if ds: print(f"  {s!r}: n={len(ds)} min={min(ds)} max={max(ds)} avg={sum(ds)/len(ds):.1f}")
    else:  print(f"  {s!r}: {'no graphic mark (None) — TEXT logo, needs text identity' if not hs else 'single'}")

print("\n=== INTER-supplier MIN detail-hash distance (different suppliers; LARGE = discriminative) ===")
sups=[s for s in hashes if hashes[s]]
inter=[]
for a,b in itertools.combinations(sups,2):
    mind=min((ham(x,y) for x in hashes[a] for y in hashes[b] if ham(x,y) is not None), default=None)
    if mind is not None: inter.append((mind,a,b))
inter.sort()
for d,a,b in inter:
    print(f"  {d:3d}/256  {a!r} vs {b!r}")

if intra_all and inter:
    im=max(intra_all); xm=min(m for m,_,_ in inter)
    print(f"\nSEPARATION: worst intra(same-supplier)={im}  vs  best-collision inter(diff-supplier)={xm}")
    print("  ->", "CLEAN GAP — 256-bit isolated mark DISCRIMINATES" if im<xm else "OVERLAP")
    # suggest a threshold
    if im<xm: print(f"  a threshold anywhere in ({im}, {xm}) separates all measured pairs (e.g. {(im+xm)//2})")
con.close()
