"""
_render_rotate.py <manifest.json> <outdir>  — render page 1 of each doc and save it ROTATED by each
angle as an image PNG (image-only → strips any text layer → forces the OCR path, simulating a scanned
copy tilted by that angle). Used by stress_test/skew_type_probe.js. manifest = [{id, src, angles:[...]}].
"""
import sys, json, os
import pypdfium2 as pdfium
from PIL import Image

manifest = json.load(open(sys.argv[1], encoding='utf-8'))
outdir = sys.argv[2]
n = 0
for item in manifest:
    src = item['src']
    try:
        if src.lower().endswith('.pdf'):
            doc = pdfium.PdfDocument(src)
            img = doc[0].render(scale=300 / 72).to_pil()
            doc.close()
        else:
            img = Image.open(src).convert('RGB')
    except Exception as e:
        print('SKIP', item['id'], e)
        continue
    for angle in item['angles']:
        out = img if angle == 0 else img.rotate(angle, expand=False, fillcolor=(255, 255, 255), resample=Image.BICUBIC)
        out.convert('RGB').save(os.path.join(outdir, f"doc{item['id']}_a{str(angle).replace('.', 'p').replace('-', 'm')}.png"))
        n += 1
print('rendered', n, 'images')
