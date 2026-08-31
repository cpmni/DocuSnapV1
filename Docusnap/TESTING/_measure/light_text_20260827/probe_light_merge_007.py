"""007 measurement probe — light-text merge geometry on the serial exhibit + a control census.
Read-only: renders sandbox PDFs, runs Tesseract, prints geometry. Touches no project file / DB.
"""
import sys, os, glob
sys.path.insert(0, r'c:\GIT Projects\Docusnap\python_backend')
from pathlib import Path
from PIL import ImageOps
from ocr import tesseract as T
from ocr import born_digital as BD
import pypdfium2 as pdfium
import pytesseract
T.configure(r'C:\Program Files\Tesseract-OCR\tesseract.exe')

INBOX = r'C:\Users\cmccu\AppData\Local\Temp\claude\c--GIT-Projects-Docusnap\7d6d3681-0d48-43ad-9347-006abf53cf6f\scratchpad\chris-sandbox\userData\inbox'
DPI = 200
EXHIBIT = os.path.join(INBOX, '217.pdf')

def data(img, cfg):
    return pytesseract.image_to_data(img, config=T._with_dpi(cfg, DPI), output_type=pytesseract.Output.DICT)

def light_img(img, level=200):
    g = ImageOps.grayscale(img)
    return g.point(lambda p: 0 if p < level else 255)

def iou(a, b):
    ax0, ay0, ax1, ay1 = a[0], a[1], a[0] + a[2], a[1] + a[3]
    bx0, by0, bx1, by1 = b[0], b[1], b[0] + b[2], b[1] + b[3]
    iw = max(0, min(ax1, bx1) - max(ax0, bx0)); ih = max(0, min(ay1, by1) - max(ay0, by0))
    inter = iw * ih
    if inter <= 0: return 0.0
    return inter / float(a[2] * a[3] + b[2] * b[3] - inter)

def ink_density(bin_img, box):
    l, t, w, h = box
    if w <= 0 or h <= 0: return 0.0
    crop = bin_img.crop((l, t, l + w, t + h))
    px = crop.getdata()
    n = len(px)
    return (sum(1 for p in px if p == 0) / n) if n else 0.0

def run_page(pdf, page_idx=0, verbose=False, band=None):
    img = T.pdf_to_images(Path(pdf), dpi=DPI)[page_idx]
    # today's merge: PSM3 main + PSM6 supp (existing rule)
    main = T._words_from_data(data(img, '--oem 3 --psm 3'))
    supp = T._words_from_data(data(img, '--oem 3 --psm 6'))
    base = list(main)
    boxes = [(w[0], w[1], w[2], w[3]) for w in main]
    for sw in supp:
        if sw[5] >= T._SUPP_MIN_CONF and any(ch.isalnum() for ch in sw[4]) and not T._center_in_any(sw, boxes):
            base.append(sw)
    heights = sorted(w[3] for w in base if w[3] > 0)
    med_h = heights[len(heights) // 2] if heights else 10
    # the light pass
    bin_img = light_img(img)
    light = T._words_from_data(data(bin_img, '--oem 3 --psm 3'))
    base_boxes = [(w[0], w[1], w[2], w[3]) for w in base]
    surv = []
    for lw in light:
        if lw[5] >= T._SUPP_MIN_CONF and any(ch.isalnum() for ch in lw[4]) and not T._center_in_any(lw, base_boxes):
            surv.append(lw)
    # med_h after merge (as line 259 would compute)
    h2 = sorted(w[3] for w in base + surv if w[3] > 0)
    med_h2 = h2[len(h2) // 2] if h2 else 10
    print(f'\n=== {os.path.basename(pdf)} p{page_idx} size={img.size} main={len(main)} psm6_merged={len(base)-len(main)} '
          f'light_total={len(light)} light_survivors={len(surv)} med_h(base)={med_h} med_h(after)={med_h2}')
    for s in surv:
        mx = max((iou((s[0], s[1], s[2], s[3]), b) for b in base_boxes), default=0.0)
        # nearest base word by centre distance
        cx, cy = s[0] + s[2] / 2, s[1] + s[3] / 2
        near = min(base, key=lambda b: ((b[0] + b[2] / 2 - cx) ** 2 + (b[1] + b[3] / 2 - cy) ** 2)) if base else None
        dens = ink_density(bin_img, (s[0], s[1], s[2], s[3]))
        same_row = [b for b in base if abs((b[1] + b[3] / 2) - cy) <= max(med_h * 0.6, 6)]
        near_txt = repr(near[4]) if near else 'None'
        print(f'   + {s[4]!r:22} conf={s[5]:5.1f} box=({s[0]},{s[1]},{s[2]},{s[3]}) h/med={s[3]/med_h:4.2f} '
              f'maxIoU={mx:4.2f} ink={dens:4.2f} base_same_row={len(same_row)} nearest={near_txt}')
    if verbose:
        rows = []
        lines = T._group_words_into_lines(base + surv, med_h2, rows_out=rows)
        print('   --- rows in band', band)
        for ln, rw in zip(lines, rows):
            yc = sum(w[1] + w[3] / 2 for w in rw) / len(rw)
            top = min(w[1] for w in rw); bot = max(w[1] + w[3] for w in rw)
            if band is None or (band[0] <= yc <= band[1]):
                srcs = ''.join('L' if w in surv else '.' for w in rw)
                print(f'   row yc={yc:7.1f} top={top} bot={bot} h={bot-top} [{srcs}] {ln[:110]!r}')
        # boxes of the item words + serial words for the arithmetic
        for w in base + surv:
            if any(k in w[4] for k in ('Channel', 'NVR', 'Dome', 'Camera', 'Serial', 'No:', 'CT-')):
                print(f'   word {w[4]!r:14} box=({w[0]},{w[1]},{w[2]},{w[3]}) yc={w[1]+w[3]/2:.1f} conf={w[5]} src={"L" if w in surv else "base"}')
    return img, base, surv

def dpi_frame_check(pdf):
    img = T.pdf_to_images(Path(pdf), dpi=DPI)[0]
    a = T._words_from_data(pytesseract.image_to_data(img, config='--oem 3 --psm 3', output_type=pytesseract.Output.DICT))
    b = T._words_from_data(pytesseract.image_to_data(img, config='--oem 3 --psm 3 --dpi 200', output_type=pytesseract.Output.DICT))
    ta = {w[4]: w[:4] for w in a}; tb = {w[4]: w[:4] for w in b}
    common = [k for k in ta if k in tb][:6]
    print('\n=== --dpi frame check (same text, boxes with/without --dpi):')
    for k in common:
        print(f'   {k!r:16} nodpi={ta[k]} dpi200={tb[k]}')

if __name__ == '__main__':
    dpi_frame_check(EXHIBIT)
    run_page(EXHIBIT, verbose=True, band=(650, 1050))
    # control census: other scanned pages in the inbox (skip born-digital)
    n = 0
    for pdf in sorted(glob.glob(os.path.join(INBOX, '*.pdf')), key=lambda p: os.path.getsize(p)):
        if os.path.basename(pdf) == '217.pdf': continue
        try:
            doc = pdfium.PdfDocument(pdf)
            ok = BD.assess_page(doc[0])[0]
            doc.close()
        except Exception:
            ok = True
        if ok: continue          # born-digital → never reaches reconstruct_page_text
        run_page(pdf)
        n += 1
        if n >= 6: break
