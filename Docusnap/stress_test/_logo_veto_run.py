"""_logo_veto_run.py <sets.json> — SLICE C end-to-end gate. Builds a template per supplier from most of
its docs (logo phash SET + isolated-mark detail SET), holds a few out, and runs each held-out doc through
template_matcher.identify_template with the veto OFF vs ON. Reports, over the held-out docs that land in a
≥2-supplier logo cluster (a real look-alike collision): FALSE-ACCEPTS (resolved to the WRONG supplier) and
FALSE-VETOES (a correct/own-supplier match wrongly abstained). PASS = veto ON drops false-accepts to 0 with
0 false-vetoes. sets.json = {"Northgate":[pdf,...], "Cascade":[pdf,...]}."""
import sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'python_backend'))
import pypdfium2 as pdfium
from extraction import template_matcher
import logo_detail

def render(pdf):
    d = pdfium.PdfDocument(pdf); img = d[0].render(scale=200 / 72).to_pil().convert('RGB'); d.close(); return img

sets = json.load(open(sys.argv[1], encoding='utf-8'))
data = {}
for sup, paths in sets.items():
    docs = []
    for p in paths:
        try:
            img = render(p)
            docs.append({'img': img, 'phash': template_matcher.compute_logo_hash(img),
                         'detail': logo_detail.detail_hash(img)})
        except Exception:
            pass
    data[sup] = [d for d in docs if d['phash']]

HELDOUT = 3
tmpls, heldout = [], []
tid = 1
for sup, docs in data.items():
    if len(docs) < HELDOUT + 2:
        continue
    enrol, hold = docs[:-HELDOUT], docs[-HELDOUT:]
    tmpls.append({'id': tid, 'name': sup, 'document_type_slug': 'invoice', 'dominant_supplier': sup,
                  'logo_phash': enrol[0]['phash'], 'logo_phashes': [d['phash'] for d in enrol],
                  'logo_detail_hashes': [d['detail'] for d in enrol if d['detail']], 'keyword_fingerprint': []})
    tid += 1
    for d in hold:
        heldout.append({'sup': sup, 'img': d['img'], 'detail': d['detail']})

def resolve(doc, veto):
    os.environ['LOGO_DETAIL_VETO'] = veto
    m = template_matcher.identify_template(doc['img'], '', tmpls, query_detail_hash=doc['detail'])
    return (m['template']['dominant_supplier'] if m else None)

faOff = faOn = falseVeto = clusterN = 0
print('| held-out | own | resolved(veto OFF) | resolved(veto ON) |')
for doc in heldout:
    off, on = resolve(doc, '0'), resolve(doc, '1')
    # only docs whose OFF pick differs from ON, or that mis-resolve, are interesting for the collision gate
    if off != doc['sup']:
        faOff += 1
        if on is not None and on != doc['sup']:
            faOn += 1
    if off == doc['sup'] and on is None:
        falseVeto += 1
    if off != on:
        clusterN += 1
        print(f"| {doc['sup']} | {doc['sup']} | {off} | {on} |")
print(f"\nheld-out docs: {len(heldout)} · veto changed the outcome on: {clusterN}")
print(f"FALSE-ACCEPTS (wrong-supplier resolve): OFF={faOff} → ON={faOn} (must drop)")
print(f"FALSE-VETOES (own-supplier match wrongly abstained): {falseVeto} (must be 0)")
print('GATE PASS' if faOn == 0 and falseVeto == 0 and faOff >= faOn else 'GATE FAIL')
