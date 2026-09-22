"""Pad/prep probe over the 20 Nordwind total boxes, using the PRODUCT's own code paths:
render = ocr.tesseract.pdf_to_images(path, 200) (the engine frame for an upright, un-deskewed doc);
box = the geom the mapper actually read (from the base trace's 0.5_mapping candidate event);
preps = raw-L | anchor._struct_prep | template_mapper._prep | otsu+border; pads = (v,h) fractions of box h.
Prints per-doc reads and a per-recipe hit tally against the baseline summary's committed total."""
import os, sys, json, re
os.environ.setdefault('TESSDATA_PREFIX', r'C:\Program Files\Tesseract-OCR\tessdata')
os.environ['OCR_RENDER_DPI'] = '200'
sys.path.insert(0, r'c:\GIT Projects\Docusnap\python_backend')
import pytesseract
pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
from PIL import Image, ImageOps
from pathlib import Path
from ocr.tesseract import pdf_to_images
from extraction import anchor as A, template_mapper as TM, number_format as NF

HERE = os.path.dirname(os.path.abspath(__file__))
JSONL = os.path.join(HERE, 'runs', 'base.jsonl')
SUMMARY = json.load(open(os.path.join(HERE, 'runs', 'base_summary.json'), encoding='utf-8'))
DOCS = r'C:\Users\cmccu\Desktop\Demo Docs\Other\IMPORT'
FIELD = sys.argv[1] if len(sys.argv) > 1 else 'total_amount'

# per-doc read geom from the trace
geoms = {}; cur = None
for ln in open(JSONL, encoding='utf-8'):
    t = ln.strip()
    if not t.startswith('{'): continue
    try: m = json.loads(t)
    except Exception: continue
    if m.get('type') == 'file_begin': cur = m.get('filename')
    if m.get('type') == 'trace' and m.get('event') == 'candidate' and m.get('stage') == '0.5_mapping' and m.get('field') == FIELD and m.get('geom'):
        geoms[m.get('doc') or cur] = m['geom']

def otsu_border(crop):
    import numpy as np
    g = crop.convert('L'); w, h = g.size
    if w < 300:
        s = max(2, 300 // max(1, w)); g = g.resize((w * s, h * s), Image.LANCZOS)
    arr = np.asarray(g); hist = np.bincount(arr.ravel(), minlength=256).astype(float)
    tot = arr.size; sumB = wB = mx = 0.0; sum1 = float(np.dot(np.arange(256), hist)); thr = 128
    for i in range(256):
        wB += hist[i]
        if wB == 0: continue
        wF = tot - wB
        if wF == 0: break
        sumB += i * hist[i]; mB = sumB / wB; mF = (sum1 - sumB) / wF
        b = wB * wF * (mB - mF) ** 2
        if b > mx: mx = b; thr = i
    return ImageOps.expand(Image.fromarray(((arr > thr) * 255).astype('uint8')), border=20, fill=255)

PREPS = {'rawL': lambda c: c.convert('L'), 'struct': A._struct_prep, 'prep': TM._prep, 'otsu': otsu_border}
PADS = [(0.0, 0.0), (0.5, 0.0), (0.0, 0.5), (0.5, 0.5), (0.5, 0.25)]

def norm_money(s):
    s = NF.strip_currency(str(s or ''))
    return re.sub(r'[^0-9.,]', '', s)

hits = {}
for name in sorted(geoms):
    pdf = os.path.join(DOCS, name)
    if not os.path.exists(pdf): continue
    truth = norm_money(((SUMMARY.get(name) or {}).get('fields') or {}).get(FIELD, {}).get('value'))
    page = pdf_to_images(Path(pdf), 200)[0]
    W, H = page.size
    x, y, w, h = geoms[name]
    line = [name.replace('Nordwind-Refrigeration_quote_', ''), f'truth={truth}']
    for (pv, ph) in PADS:
        padx = int(ph * h * H); pady = int(pv * h * H)
        box = (max(0, int(x * W) - padx), max(0, int(y * H) - pady), min(W, int((x + w) * W) + padx), min(H, int((y + h) * H) + pady))
        crop = page.crop(box)
        for pn, pf in PREPS.items():
            try:
                img = pf(crop)
                text, conf, _mn, _lines = A._read_lines_full(img, 7)
            except Exception as e:
                text, conf = f'ERR {e}', 0
            ok = norm_money(text) == truth and bool(truth)
            key = (pv, ph, pn)
            hits.setdefault(key, [0, 0]); hits[key][1] += 1
            if ok: hits[key][0] += 1
            line.append(f"{pv}/{ph}:{pn}={text.strip()!r}@{conf:.0f}{'*' if ok else ''}")
    print(' | '.join(line))
print('\nHITS per (vpad, hpad, prep):')
for k in sorted(hits): print(f'  {k}: {hits[k][0]}/{hits[k][1]}')
