#!/usr/bin/env python3
"""teach_label_probe_crops.py — OCR service for stress_test/teach_label_reread_probe.js.

Renders page 1 of TEACH_PROBE_PDF (default: the live inbox's doc 182, the Ironbridge sales
order whose "Sales Order No." caption produced the live "oe ee No." teach read) at the teach
wizard's display scale (4.0 = 288 DPI), crops the page-norm rects supplied in --rects-file,
and runs each crop through ocr/region.py --boxes — the EXACT recipe the wizard's
ocr-region-boxes IPC uses. Emits {"page":{"w","h"},"results":[{"text","words"}...]} to --out.

Read-only: touches only the working-copy PDF + temp crops. Run (from repo root):
    py -3.12 stress_test/teach_label_probe_crops.py --rects-file r.json --out o.json
"""
import argparse
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# NOT the bare 'TESSERACT' env key: this machine carries TESSERACT='C:\Program Files\Tesseract-OCR'
# (the DIRECTORY) machine-wide — executing a directory is WinError 5 "Access is denied".
TESS = os.environ.get('TEACH_PROBE_TESSERACT', r'C:\Program Files\Tesseract-OCR\tesseract.exe')
if os.path.isdir(TESS):
    TESS = os.path.join(TESS, 'tesseract.exe')
SCALE = 4.0   # TEACH_RENDER_SCALE (teach/renderer.js) — native crops, ds=1.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--rects-file', required=True, help='JSON [[x,y,w,h] page-norm, ...]')
    ap.add_argument('--out', required=True)
    ap.add_argument('--pdf', default=os.environ.get(
        'TEACH_PROBE_PDF',
        os.path.join(os.environ.get('APPDATA', ''), 'ScanFinder', 'inbox', '182.pdf')))
    args = ap.parse_args()

    import pypdfium2 as pdfium
    import pytesseract
    # region_core IN-PROCESS — the byte-identical function region.py's CLI calls
    # (region.py:136). In-process (not a nested region.py spawn) so the sandboxed
    # harness only ever spawns tesseract one level deep.
    sys.path.insert(0, os.path.join(REPO, 'python_backend'))
    from ocr import region_core
    if os.path.exists(TESS):
        pytesseract.pytesseract.tesseract_cmd = TESS

    with open(args.rects_file, 'r', encoding='utf-8') as f:
        rects = json.load(f)

    pdf = pdfium.PdfDocument(args.pdf)
    img = pdf[0].render(scale=SCALE).to_pil()
    W, H = img.size
    results = []
    for i, (x, y, w, h) in enumerate(rects):
        px = (max(0, int(x * W)), max(0, int(y * H)))
        crop = img.crop((px[0], px[1],
                         min(W, px[0] + max(1, int(w * W))),
                         min(H, px[1] + max(1, int(h * H))))).convert('L')  # region.py:86 greyscale
        try:
            res = region_core.process(crop, boxes=True)
            results.append({'text': res.get('text') or '', 'words': res.get('words') or [],
                            'crop_h': crop.size[1]})
        except Exception as e:
            print(f'crop {i}: region_core fail: {e}', file=sys.stderr)
            results.append({'text': '', 'words': [], 'crop_h': crop.size[1]})
    with open(args.out, 'w', encoding='utf-8') as f:
        json.dump({'page': {'w': W, 'h': H}, 'results': results}, f)
    print(f'ok {len(results)} crops @ {W}x{H}')


if __name__ == '__main__':
    main()
