"""Light-text recovery — RECIPE SWEEP on the serial exhibit + negative controls (read-only probe).
Extends 007's probe_light_merge.py: the base (PSM-3 + PSM-6 merge, today's rule) is computed once per page;
each candidate binarisation is run once (PSM 3) and its words pass the RECONCILED filter set
(oscar + 007): conf>=60, alnum>=2 unless conf>=90, alnum ratio>=0.5, 0.4..2.0 x med_h and >=6 px, width<=0.6 W,
repetition, centre-outside-base, IoA<=0.2, ink density [0.08,0.6], lone-word rule, page cap.
Recipes: global fixed 200 · page-relative global 0.80 x paper mode · mean-offset adaptive (C x r grid).
Scores: the exhibit's 4 serial words (conf), survivors per page, debris on negatives, runtime.
"""
import sys, os, glob, time, random
sys.path.insert(0, r'c:\GIT Projects\Docusnap\python_backend')
from pathlib import Path
import numpy as np
from PIL import Image, ImageOps, ImageFilter, ImageDraw, ImageFont
from ocr import tesseract as T
from ocr import born_digital as BD
import pypdfium2 as pdfium
import pytesseract
T.configure(r'C:\Program Files\Tesseract-OCR\tesseract.exe')

INBOX = r'C:\Users\cmccu\AppData\Local\Temp\claude\c--GIT-Projects-Docusnap\7d6d3681-0d48-43ad-9347-006abf53cf6f\scratchpad\chris-sandbox\userData\inbox'
DPI = 200
EXHIBIT = os.path.join(INBOX, '217.pdf')
TARGETS = ['Serial', 'No:', 'CT-8051702', 'CT-8813265']

def data(img, cfg):
    return pytesseract.image_to_data(img, config=T._with_dpi(cfg, DPI), output_type=pytesseract.Output.DICT)

# ── recipes ─────────────────────────────────────────────────────────────────────────────────
def rec_global(level):
    def f(img, med_h):
        g = ImageOps.grayscale(img)
        return g.point(lambda p: 0 if p < level else 255)
    return f

def rec_paper_rel(frac=0.80):
    def f(img, med_h):
        g = ImageOps.grayscale(img)
        hist = g.histogram()
        paper = max(range(128, 256), key=lambda i: hist[i])
        level = int(round(frac * paper))
        return g.point(lambda p: 0 if p < level else 255)
    return f

def rec_mean_offset(C, r):
    def f(img, med_h):
        g = ImageOps.grayscale(img)
        rr = r if r else max(24, min(64, int(1.5 * med_h)))
        mean = g.filter(ImageFilter.BoxBlur(rr))
        a = np.asarray(g, dtype=np.int16); m = np.asarray(mean, dtype=np.int16)
        ink = a < (m - C)
        return Image.fromarray(np.where(ink, 0, 255).astype(np.uint8), 'L')
    return f

RECIPES = [('global200', rec_global(200)), ('paper0.80', rec_paper_rel(0.80))]
for C in (14, 20, 26, 32):
    for r in (24, 40, 56):
        RECIPES.append((f'mo_C{C}_r{r}', rec_mean_offset(C, r)))

# ── filters (reconciled) ────────────────────────────────────────────────────────────────────
def ioa(a, b):
    ax0, ay0, ax1, ay1 = a[0], a[1], a[0] + a[2], a[1] + a[3]
    bx0, by0, bx1, by1 = b[0], b[1], b[0] + b[2], b[1] + b[3]
    iw = max(0, min(ax1, bx1) - max(ax0, bx0)); ih = max(0, min(ay1, by1) - max(ay0, by0))
    return (iw * ih) / float(max(1, a[2] * a[3]))

def ink_density(bin_img, box):
    l, t, w, h = box
    if w <= 0 or h <= 0: return 0.0
    arr = np.asarray(bin_img.crop((l, t, l + w, t + h)))
    return float((arr == 0).mean()) if arr.size else 0.0

def filt(lw, base_boxes, med_h, W, bin_img):
    l, t, w, h, txt, conf = lw
    if conf < 60: return 'conf'
    aln = sum(ch.isalnum() for ch in txt)
    if aln == 0: return 'noalnum'
    if aln < 2 and conf < 90: return 'alnum<2'
    if aln / max(1, len(txt)) < 0.5: return 'ratio'
    if h < 6 or h < 0.4 * med_h or h > 2.0 * med_h: return 'height'
    if w > 0.6 * W: return 'width'
    a = [ch for ch in txt if ch.isalnum()]
    if len(a) >= 4 and len(set(a)) < 2: return 'repeat'
    if T._center_in_any(lw, base_boxes): return 'centre'
    if max((ioa((l, t, w, h), b) for b in base_boxes), default=0.0) > 0.2: return 'ioa'
    d = ink_density(bin_img, (l, t, w, h))
    if d < 0.08 or d > 0.6: return 'ink'
    return ''

def lone_rule(surv, base, med_h):
    band = max(med_h * 0.6, 6)
    keep = []
    for s in surv:
        cy = s[1] + s[3] / 2
        others = [b for b in base + [x for x in surv if x is not s] if abs((b[1] + b[3] / 2) - cy) <= band]
        aln = sum(ch.isalnum() for ch in s[4])
        if others or aln >= 4 or s[5] >= 80:
            keep.append(s)
    return keep

# ── pages ───────────────────────────────────────────────────────────────────────────────────
def base_for(img):
    main = T._words_from_data(data(img, '--oem 3 --psm 3'))
    supp = T._words_from_data(data(img, '--oem 3 --psm 6'))
    base = list(main)
    boxes = [(w[0], w[1], w[2], w[3]) for w in main]
    for sw in supp:
        if sw[5] >= T._SUPP_MIN_CONF and any(ch.isalnum() for ch in sw[4]) and not T._center_in_any(sw, boxes):
            base.append(sw)
    heights = sorted(w[3] for w in base if w[3] > 0)
    med_h = heights[len(heights) // 2] if heights else 10
    return base, med_h

def scanify(img, seed=1):
    """Generator-style degradation: 150-DPI raster, slight blur, noise, back to 200 DPI."""
    rnd = random.Random(seed)
    w, h = img.size
    small = img.resize((int(w * 150 / 200), int(h * 150 / 200)), Image.BILINEAR)
    small = small.filter(ImageFilter.GaussianBlur(0.5))
    arr = np.asarray(small.convert('L'), dtype=np.int16)
    noise = np.asarray([[rnd.randint(-12, 12) for _ in range(arr.shape[1])] for _ in range(arr.shape[0])], dtype=np.int16)
    arr = np.clip(arr + noise, 0, 255).astype(np.uint8)
    return Image.fromarray(arr, 'L').resize((w, h), Image.BILINEAR).convert('RGB')

def synth_controls():
    W, H = 1655, 2339
    try: f21 = ImageFont.truetype('arial.ttf', 21); f28 = ImageFont.truetype('arial.ttf', 28); f34 = ImageFont.truetype('arial.ttf', 34)
    except Exception: f21 = f28 = f34 = ImageFont.load_default()
    out = []
    # (i) blank tinted page + noise
    im = Image.new('RGB', (W, H), (232, 232, 232)); out.append(('synth_blank_tint', scanify(im, 2), []))
    # (ii) shadow gradient with a few dark words
    im = Image.new('RGB', (W, H), 'white'); px = np.zeros((H, W, 3), np.uint8)
    for x in range(W): px[:, x, :] = int(250 - 60 * x / W)
    im = Image.fromarray(px, 'RGB'); d = ImageDraw.Draw(im)
    for i, t in enumerate(['SERVICE WORKSHEET', 'Job number 4471', 'Site: Depot 3', 'Engineer: A. Smith']):
        d.text((120, 200 + i * 90), t, font=f34 if i == 0 else f28, fill='black')
    out.append(('synth_shadow', scanify(im, 3), []))
    # (iii) small BLACK vs small GREY sub-lines on tinted bands (contrast-not-size control)
    im = Image.new('RGB', (W, H), 'white'); d = ImageDraw.Draw(im)
    d.text((120, 150), 'SERVICE WORKSHEET', font=f34, fill='black')
    y = 400; expect = []
    for i in range(4):
        d.rectangle((100, y - 8, W - 100, y + 70), fill=(232, 232, 232))
        d.text((120, y), f'{i+1}   16 Channel NVR unit', font=f28, fill='black')
        col = 'black' if i % 2 == 0 else (90, 90, 90)
        val = f'CT-80517{i:02d}'
        d.text((160, y + 38), f'Serial No: {val}', font=f21, fill=col)
        expect.append((val, 'black' if i % 2 == 0 else 'grey'))
        y += 130
    out.append(('synth_black_vs_grey', scanify(im, 4), expect))
    return out

def run():
    pages = []
    img = T.pdf_to_images(Path(EXHIBIT), dpi=DPI)[0]; pages.append(('EXHIBIT_217', img, TARGETS))
    n = 0
    for pdf in sorted(glob.glob(os.path.join(INBOX, '*.pdf')), key=lambda p: os.path.getsize(p)):
        if os.path.basename(pdf) == '217.pdf': continue
        try:
            doc = pdfium.PdfDocument(pdf); ok = BD.assess_page(doc[0])[0]; doc.close()
        except Exception:
            ok = True
        if ok: continue
        pages.append((os.path.basename(pdf), T.pdf_to_images(Path(pdf), dpi=DPI)[0], []))
        n += 1
        if n >= 6: break
    pages.extend(synth_controls())
    bases = {}
    for name, im, _ in pages:
        t0 = time.time(); base, med_h = base_for(im); bases[name] = (base, med_h, time.time() - t0)
        print(f'base {name:22} words={len(base):4} med_h={med_h} t={time.time()-t0:4.1f}s', flush=True)
    print()
    summary = []
    for rname, rec in RECIPES:
        row = {'recipe': rname, 'hits': [], 'surv': {}, 'debris': 0, 't': 0.0, 'cap': 0}
        for name, im, expect in pages:
            base, med_h, _ = bases[name]
            W = im.size[0]
            t0 = time.time()
            bin_img = rec(im, med_h)
            light = T._words_from_data(data(bin_img, '--oem 3 --psm 3'))
            row['t'] += time.time() - t0
            base_boxes = [(w[0], w[1], w[2], w[3]) for w in base]
            surv = [lw for lw in light if filt(lw, base_boxes, med_h, W, bin_img) == '']
            surv = lone_rule(surv, base, med_h)
            capped = len(surv) > max(40, 0.35 * len(base))
            if capped: row['cap'] += 1; surv = []
            row['surv'][name] = len(surv)
            texts = [s[4] for s in surv]
            if name == 'EXHIBIT_217':
                hits = []
                for tgt in TARGETS:
                    m = [s for s in surv if s[4] == tgt or (tgt.startswith('CT-') and tgt in s[4])]
                    hits.append((tgt, max((s[5] for s in m), default=None)))
                row['hits'] = hits
                row['exhibit_all'] = [(s[4], round(s[5])) for s in surv]
            elif name == 'synth_black_vs_grey':
                got = {v: any(v in s[4] for s in surv) for v, _ in expect}
                got_base = {v: any(v in b[4] for b in base) for v, _ in expect}
                row['bvg'] = {v: ('base' if got_base[v] else ('light' if got[v] else 'MISS')) + '/' + c for v, c in expect}
                row['bvg_debris'] = [s[4] for s in surv if not any(v in s[4] for v, _ in expect) and 'Serial' not in s[4] and 'No:' not in s[4]]
            else:
                row['debris'] += len(surv)
                if surv: row.setdefault('debris_samples', {})[name] = texts[:8]
        summary.append(row)
        hs = ' '.join(f'{t}={c}' for t, c in row['hits'])
        print(f"{rname:12} t={row['t']:5.1f}s exhibit_surv={row['surv'].get('EXHIBIT_217')} hits[{hs}] "
              f"debris_on_controls={row['debris']} capped_pages={row['cap']} bvg={row.get('bvg')}", flush=True)
        if row.get('debris_samples'): print('      debris samples:', row['debris_samples'], flush=True)
        if row.get('bvg_debris'): print('      bvg debris:', row['bvg_debris'][:10], flush=True)
    print('\nEXHIBIT survivors per recipe:')
    for row in summary:
        print(f"  {row['recipe']:12} {row.get('exhibit_all')}")

if __name__ == '__main__':
    run()
