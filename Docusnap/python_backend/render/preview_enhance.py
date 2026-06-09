#!/usr/bin/env python3
"""
render/preview_enhance.py
Renders a single page with OCR preprocessing applied and returns a base64
PNG data URI.  Reuses the exact same preprocess_for_ocr() as the OCR path.
Does NOT run Tesseract — preview only.
"""
import sys, os, json, argparse, base64
from io import BytesIO
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from ocr.tesseract import preprocess_for_ocr
from PIL import Image


def _win_long_path(p: str) -> str:
    """Same fix as pages.py — bypasses Win32 8.3 trailing-dot truncation."""
    if os.name != 'nt' or p.startswith('\\\\?\\'):
        return p
    if p.startswith('\\\\'):
        return '\\\\?\\UNC\\' + p.lstrip('\\')
    return '\\\\?\\' + p


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--file',         required=True)
    parser.add_argument('--page',         type=int, default=0)
    parser.add_argument('--enhance-file', required=True)
    args = parser.parse_args()

    if not os.path.exists(args.enhance_file):
        print(json.dumps(None), flush=True)
        return

    with open(args.enhance_file, encoding='utf-8') as f:
        enhance_params = json.load(f)

    if not enhance_params:
        print(json.dumps(None), flush=True)
        return

    filepath = Path(args.file)
    ext      = filepath.suffix.lower()

    try:
        if ext == '.pdf':
            import pypdfium2 as pdfium
            doc    = pdfium.PdfDocument(_win_long_path(str(filepath)))
            pages  = list(doc)
            idx    = min(max(args.page, 0), len(pages) - 1)
            bitmap = pages[idx].render(scale=1.5)  # 108 DPI — same as pages.py
            img    = bitmap.to_pil()
        else:
            img = Image.open(str(filepath))
            if img.mode not in ('RGB', 'L'):
                img = img.convert('RGB')
    except Exception:
        print(json.dumps(None), flush=True)
        return

    try:
        processed = preprocess_for_ocr(img, enhance_params)
    except Exception:
        print(json.dumps(None), flush=True)
        return

    if processed.mode not in ('RGB', 'L', 'RGBA'):
        processed = processed.convert('L')

    buf = BytesIO()
    processed.save(buf, format='PNG', optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode()
    print(json.dumps(f'data:image/png;base64,{b64}'), flush=True)


if __name__ == '__main__':
    main()
