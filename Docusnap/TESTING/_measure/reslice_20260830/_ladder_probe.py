"""Ladder-rung probe over the 20 Nordwind total boxes with the PRODUCT read (anchor._read_lines_full).
Rungs: (vpad, hpad, scale, border, psm). scale=None -> no upscale. border=('white'|'median', px). psm 6 uses an
in-band line pick (line y-band overlap >= 50% of the LINE height with the ORIGINAL box band; one qualifier only).
Reports per rung: exact hits, format-valid WRONG reads (the false-witness class), empties."""
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
FIELD = 'total_amount'
geoms = {}; cur = None
for ln in open(JSONL, encoding='utf-8'):
    t = ln.strip()
    if not t.startswith('{'): continue
    try: m = json.loads(t)
    except Exception: continue
    if m.get('type') == 'file_begin': cur = m.get('filename')
    if m.get('type') == 'trace' and m.get('event') == 'candidate' and m.get('stage') == '0.5_mapping' and m.get('field') == FIELD and m.get('geom'):
        geoms[m.get('doc') or cur] = m['geom']

def otsu(g):
    import numpy as np
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
    return Image.fromarray(((arr > thr) * 255).astype('uint8'))

RUNGS = [
    ('R1 v.5/h.5 x1 white20 psm7',   0.5, 0.5, None, ('white', 20), 7, False),
    ('R2 v.5/h.5 x1 otsu white20 psm7', 0.5, 0.5, None, ('white', 20), 7, True),
    ('R3 v.5/h.5 x1.5 white20 psm7', 0.5, 0.5, 1.5, ('white', 20), 7, False),
    ('R4 v.5/h.5 x2 white20 psm7',   0.5, 0.5, 2.0, ('white', 20), 7, False),
    ('R5 v.5/h.5 x1 median20 psm7',  0.5, 0.5, None, ('median', 20), 7, False),
    ('R6 v.5/h.25 x1 white20 psm7',  0.5, 0.25, None, ('white', 20), 7, False),
    ('R7 v1/h.5 x1 white20 psm6+pick', 1.0, 0.5, None, ('white', 20), 6, False),
    ('R8 v.5/h.5 x1 white20 psm6+pick', 0.5, 0.5, None, ('white', 20), 6, False),
    ('R0 v0/h0 x1 white20 psm7 (control)', 0.0, 0.0, None, ('white', 20), 7, False),
]

def norm_money(s):
    return re.sub(r'[^0-9.,]', '', NF.strip_currency(str(s or '')))

def money_ok(s):
    return TM._money_wellformed(NF.strip_currency(str(s or '')))

stats = {r[0]: {'hit': 0, 'wrong_valid': 0, 'empty': 0, 'n': 0, 'wrongs': []} for r in RUNGS}
for name in sorted(geoms):
    pdf = os.path.join(DOCS, name)
    if not os.path.exists(pdf): continue
    truth = norm_money(((SUMMARY.get(name) or {}).get('fields') or {}).get(FIELD, {}).get('value'))
    page = pdf_to_images(Path(pdf), 200)[0]; W, H = page.size
    x, y, w, h = geoms[name]
    out = [name.replace('Nordwind-Refrigeration_quote_', '').replace('.pdf', ''), truth]
    for (label, pv, ph, scale, border, psm, use_otsu) in RUNGS:
        padx = int(ph * h * H); pady = int(pv * h * H)
        bx0 = max(0, int(x * W) - padx); by0 = max(0, int(y * H) - pady)
        bx1 = min(W, int((x + w) * W) + padx); by1 = min(H, int((y + h) * H) + pady)
        g = page.crop((bx0, by0, bx1, by1)).convert('L')
        sc = 1.0
        if scale:
            sc = scale; g = g.resize((int(g.width * scale), int(g.height * scale)), Image.LANCZOS)
        if use_otsu: g = otsu(g)
        if border[0] == 'white': fill = 255
        else:
            import numpy as np; fill = int(np.median(np.asarray(g)))
        g = ImageOps.expand(g, border=border[1], fill=fill)
        text, conf, _mn, lines = A._read_lines_full(g, psm)
        if psm == 6:
            # in-band pick: original box band in the prepped image's px frame
            band0 = border[1] + pady * sc; band1 = border[1] + (pady + int(h * H)) * sc
            q = []
            for L in (lines or []):
                y0, y1 = L.get('top'), L.get('top', 0) + L.get('height', 0)
                if y0 is None: continue
                ov = max(0, min(y1, band1) - max(y0, band0)); lh = max(1, y1 - y0)
                if ov >= 0.5 * lh: q.append(L)
            if len(q) == 1:
                text, conf = q[0].get('text', ''), q[0].get('mean_conf', 0)
            else:
                text, conf = '', 0
        s = stats[label]; s['n'] += 1
        nm = norm_money(text)
        if nm == truth and truth: s['hit'] += 1; tag = '*'
        elif not text.strip(): s['empty'] += 1; tag = '_'
        elif money_ok(text) and nm != truth: s['wrong_valid'] += 1; s['wrongs'].append((out[0], text.strip(), round(conf))); tag = '!'
        else: tag = 'x'
        out.append(f"{label.split()[0]}={text.strip()!r}@{conf:.0f}{tag}")
    print(' | '.join(out))
print('\nRUNG STATS (hit / format-valid WRONG / empty of n):')
for label, s in stats.items():
    print(f"  {label}: {s['hit']}/{s['n']} hit, {s['wrong_valid']} wrong-valid {s['wrongs'][:6]}, {s['empty']} empty")
