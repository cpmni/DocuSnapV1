import sys
sys.path.insert(0, r'c:\GIT Projects\Docusnap\python_backend')
from pathlib import Path
from PIL import Image, ImageOps, ImageFilter
from ocr import tesseract as T
import pytesseract
T.configure(r'C:\Program Files\Tesseract-OCR\tesseract.exe')
SB = r'C:\Users\cmccu\AppData\Local\Temp\claude\c--GIT-Projects-Docusnap\7d6d3681-0d48-43ad-9347-006abf53cf6f\scratchpad'
scan = Path(SB + r'\chris-sandbox\userData\inbox\217.pdf')
def words(img, cfg, dpi):
    d = pytesseract.image_to_data(img, config=T._with_dpi(cfg, dpi), output_type=pytesseract.Output.DICT)
    return [(d['text'][i], int(float(d['conf'][i]))) for i in range(len(d['text'])) if d['text'][i].strip() and ('erial' in d['text'][i] or 'CT-' in d['text'][i] or d['text'][i].startswith('No'))]
for dpi in (200, 300):
    img = T.pdf_to_images(scan, dpi=dpi)[0]
    g = ImageOps.grayscale(img)
    variants = {
        'gray': g,
        'autocontrast': ImageOps.autocontrast(g, cutoff=1),
        'thresh200': g.point(lambda p: 0 if p < 200 else 255),
        'thresh215': g.point(lambda p: 0 if p < 215 else 255),
        'gamma+sharpen': ImageOps.autocontrast(g.point(lambda p: int(255 * (p / 255) ** 2.2)), cutoff=1).filter(ImageFilter.UnsharpMask(radius=1.5, percent=150)),
    }
    try:
        variants['app_preprocess_default'] = T.preprocess_for_ocr(img, None)
        variants['app_preprocess_enhance'] = T.preprocess_for_ocr(img, {'grayscale': True, 'contrast': 1.8, 'sharpen': True, 'threshold': 190})
    except Exception as e:
        print('preprocess err', e)
    print('\n=== DPI', dpi)
    for name, v in variants.items():
        for cfg in ('--oem 3 --psm 3', '--oem 3 --psm 6'):
            w = words(v, cfg, dpi)
            if w: print(f'  {name:24s} {cfg}: {w}')
    # a BAND-only pass (the item region) with PSM 6 on the thresholded image
    band = variants['thresh215'].crop((0, int(700 * dpi / 200), img.size[0], int(1000 * dpi / 200)))
    print('  band thresh215 psm6:', words(band, '--oem 3 --psm 6', dpi))
