#!/usr/bin/env python3
"""
render_pages.py — renders PDF pages to base64 PNG for the review window.
Called by Electron main process. Outputs a JSON array of data: URIs.
"""
import sys, json, argparse, base64
from io import BytesIO
import pypdfium2 as pdfium

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--file', required=True)
    args = parser.parse_args()

    doc    = pdfium.PdfDocument(args.file)
    images = []
    for page in doc:
        bitmap = page.render(scale=1.5)   # 108 DPI — enough for preview, smaller payload
        img    = bitmap.to_pil()
        buf    = BytesIO()
        img.save(buf, format='PNG', optimize=True)
        b64 = base64.b64encode(buf.getvalue()).decode()
        images.append(f'data:image/png;base64,{b64}')

    print(json.dumps(images), flush=True)

if __name__ == '__main__':
    main()
