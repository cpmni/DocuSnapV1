"""Zone re-render probe for Nordwind 0023's total box (geom [0.845, 0.441, 0.081, 0.0162]).
Measures whether re-rendering the taught zone FROM THE PDF at a higher DPI (vs the 200-DPI raster)
lets Tesseract read the printed `£2,363.76`. Prints every (dpi, pad, prep, psm) read."""
import os, sys, re
os.environ.setdefault('TESSDATA_PREFIX', r'C:\Program Files\Tesseract-OCR\tessdata')
import pypdfium2 as pdfium
import pytesseract
from PIL import Image, ImageOps
pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'

PDF = sys.argv[1] if len(sys.argv) > 1 else r'C:\Users\cmccu\Desktop\Demo Docs\Other\IMPORT\Nordwind-Refrigeration_quote_0023.pdf'
GEOM = [float(x) for x in (sys.argv[2].split(',') if len(sys.argv) > 2 else ['0.845', '0.441', '0.081', '0.0162'])]
TRUTH = sys.argv[3] if len(sys.argv) > 3 else '2,363.76'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'zone_probe')
os.makedirs(OUT, exist_ok=True)

doc = pdfium.PdfDocument(PDF)
page = doc[0]
w_pt, h_pt = page.get_size()
print(f"page size pt: {w_pt:.1f} x {h_pt:.1f}")
# Embedded image inventory -> native DPI of the scan raster
try:
    for obj in page.get_objects():
        if obj.type == pdfium.raw.FPDF_PAGEOBJ_IMAGE:
            try:
                meta = obj.get_metadata()
                bw, bh = meta.width, meta.height
                l, b, r, t = obj.get_pos()
                dpi_x = bw / ((r - l) / 72) if r > l else 0
                dpi_y = bh / ((t - b) / 72) if t > b else 0
                print(f"embedded image {bw}x{bh}px over {r-l:.0f}x{t-b:.0f}pt -> native ~{dpi_x:.0f}x{dpi_y:.0f} DPI")
            except Exception as e:
                print("image meta err", e)
except Exception as e:
    print("objects err", e)

def norm_ok(s):
    return re.sub(r'[^0-9.,]', '', s)

x, y, w, h = GEOM
hits = []
for dpi in (200, 300, 400, 600):
    scale = dpi / 72
    full = page.render(scale=scale).to_pil().convert('L')
    W, H = full.size
    for pad in (0.0, 0.5, 1.0):     # pad as a fraction of the box HEIGHT on every side
        px = int(w * W); py = int(h * H)
        padx = int(pad * py); pady = int(pad * py)
        box = (max(0, int(x * W) - padx), max(0, int(y * H) - pady),
               min(W, int((x + w) * W) + padx), min(H, int((y + h) * H) + pady))
        crop = full.crop(box)
        crop.save(os.path.join(OUT, f'z_{dpi}_{pad}.png'))
        preps = {'raw': crop,
                 'border': ImageOps.expand(crop, border=20, fill=255),
                 'otsu': None}
        try:
            import numpy as np
            arr = np.asarray(crop)
            # Otsu
            hist = np.bincount(arr.ravel(), minlength=256).astype(float)
            tot = arr.size; sumB = 0.0; wB = 0.0; mx = 0.0; sum1 = np.dot(np.arange(256), hist); thr = 128
            for i in range(256):
                wB += hist[i]
                if wB == 0: continue
                wF = tot - wB
                if wF == 0: break
                sumB += i * hist[i]
                mB = sumB / wB; mF = (sum1 - sumB) / wF
                between = wB * wF * (mB - mF) ** 2
                if between > mx: mx = between; thr = i
            preps['otsu'] = ImageOps.expand(Image.fromarray(((arr > thr) * 255).astype('uint8')), border=20, fill=255)
        except Exception as e:
            preps.pop('otsu')
        for pname, img in preps.items():
            for psm in (7, 8, 6, 13):
                for wl in ('', 'wl'):
                    cfg = f'--oem 3 --psm {psm}'
                    if wl:
                        cfg += ' -c tessedit_char_whitelist=0123456789.,£'
                    try:
                        t = pytesseract.image_to_string(img, config=cfg).strip().replace('\n', ' | ')
                    except Exception as e:
                        t = f'ERR {e}'
                    ok = norm_ok(t) == TRUTH or norm_ok(t) == TRUTH.replace(',', '')
                    if ok: hits.append((dpi, pad, pname, psm, wl))
                    print(f"dpi {dpi} pad {pad} {pname:6} psm {psm:2} {wl or '  '}: {t!r} {'<== OK' if ok else ''}")
print("\nHITS:", hits)
