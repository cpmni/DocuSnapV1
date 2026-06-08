#!/usr/bin/env python3
"""
render_pages.py — renders PDF pages to base64 PNG for the review window.
Called by Electron main process. Outputs a JSON array of data: URIs.
"""
import sys, os, json, argparse, base64
from io import BytesIO
import pypdfium2 as pdfium

def _win_long_path(path):
    """Win32 silently strips trailing dots/spaces from path components
    (legacy DOS 8.3 behaviour), so a real folder named e.g. 'Acme Inc.'
    (filed under the supplier's name) is invisible to CRT/Win32-level file
    opens — including pypdfium2's internal fopen/CreateFileW — even though
    Node's fs (libuv) resolves the very same path correctly. The \\\\?\\
    extended-length prefix bypasses that normalisation, but ONLY if applied
    to the path verbatim — os.path.abspath()/normpath() would themselves
    strip the trailing dot/space before the prefix is added, defeating the
    fix. The incoming path is already absolute (Node built it by joining the
    document's stored_path/folder_path with its filename), so no
    normalisation is needed here. See get-document-pages in
    review/handler.js, the only caller that hands this script a path rooted
    at a filed (stored_path) location rather than a copied temp file."""
    if os.name != 'nt' or path.startswith('\\\\?\\'):
        return path
    if path.startswith('\\\\'):
        return '\\\\?\\UNC\\' + path.lstrip('\\')
    return '\\\\?\\' + path

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--file', required=True)
    args = parser.parse_args()

    doc    = pdfium.PdfDocument(_win_long_path(args.file))
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
