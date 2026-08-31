import sqlite3, os, sys
sys.path.insert(0, r'c:\GIT Projects\Docusnap\python_backend')
import pypdfium2 as pdfium, logo_detail
db=os.path.join(os.environ['APPDATA'],'ScanFinder','docusnap.db')
con=sqlite3.connect(f'file:{db}?mode=ro',uri=True); con.row_factory=sqlite3.Row

def render0(path,dpi=200):
    d=pdfium.PdfDocument(path)
    try: return d[0].render(scale=dpi/72).to_pil()
    finally: d.close()
def fpath(r):
    for k in ('working_path','stored_path'):
        if r[k] and os.path.exists(r[k]): return r[k]
    return None
def dh(path):
    try: return logo_detail.detail_hash(render0(path))
    except Exception: return None

# REFERENCE set: first K confirmed docs per supplier (held-out test docs excluded below)
REF_K=8
ref={}
for sup in ['Cascade Water Systems','Northgate Textiles','DOCUMENT SOLUTIONS','City Office NI','Profile Construction','SuperStore']:
    rows=con.execute("SELECT id,working_path,stored_path FROM documents WHERE supplier_name=? AND status='confirmed' ORDER BY id LIMIT ?",(sup,REF_K)).fetchall()
    hs=[]
    for r in rows:
        p=fpath(r)
        if not p: continue
        h=dh(p)
        if h: hs.append((r['id'],h))
    ref[sup]=hs
    print(f"REF {sup!r}: {len(hs)} marks")
ref_ids={i for hs in ref.values() for i,_ in hs}

def classify(query_h):
    if not query_h: return (None,None)
    best=(None,10**9)
    for sup,hs in ref.items():
        for _,h in hs:
            d=logo_detail.detail_distance(query_h,h)
            if d is not None and d<best[1]: best=(sup,d)
    return best

# TEST docs: the failing review-queue docs + held-out confirmed docs of each supplier
tests=[]
# failing review docs (known expected)
for i,exp in [(410,'DOCUMENT SOLUTIONS'),(372,'DOCUMENT SOLUTIONS'),(374,'DOCUMENT SOLUTIONS'),
              (239,'SuperStore'),(268,'SuperStore'),(276,'SuperStore')]:
    tests.append((i,exp))
# held-out confirmed docs (id NOT in ref) for the colliding suppliers
for sup in ['Cascade Water Systems','Northgate Textiles']:
    for r in con.execute("SELECT id FROM documents WHERE supplier_name=? AND status='confirmed' ORDER BY id DESC LIMIT 5",(sup,)):
        if r['id'] not in ref_ids: tests.append((r['id'],sup))

THR=86
print(f"\n=== CLASSIFY by nearest-supplier 256-bit mark (threshold {THR}) ===")
ok=miss=none_=0
for docid,exp in tests:
    r=con.execute("SELECT id,working_path,stored_path FROM documents WHERE id=?",(docid,)).fetchone()
    p=fpath(r) if r else None
    q=dh(p) if p else None
    sup,d=classify(q)
    if q is None:
        verdict='NO-MARK (text logo -> needs text identity)'; none_+=1
    elif d>THR:
        verdict=f'ABSTAIN (nearest {sup!r}@{d} > {THR})'
    elif sup==exp:
        verdict=f'CORRECT -> {sup!r}@{d}'; ok+=1
    else:
        verdict=f'*** WRONG -> {sup!r}@{d} (expected {exp!r})'; miss+=1
    print(f"  #{docid:>4} expect {exp!r:24} : {verdict}")
print(f"\nCORRECT={ok}  WRONG={miss}  NO-MARK={none_}  (of {len(tests)})")
con.close()
