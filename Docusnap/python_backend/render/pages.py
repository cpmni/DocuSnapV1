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

def _render_page(page, scale):
    bitmap = page.render(scale=scale)
    img    = bitmap.to_pil()
    buf    = BytesIO()
    # No optimize=True: it's the slowest PNG step (extra zlib pass) for only a
    # marginal size win — not worth it for an on-demand preview render over a LAN.
    img.save(buf, format='PNG')
    b64 = base64.b64encode(buf.getvalue()).decode()
    return f'data:image/png;base64,{b64}'

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--file', required=True)
    # THUMBNAIL MODE: render a SINGLE low-res page (page 1 by default) and print
    # one data: URI string — used by the document/file lists + the add-template
    # picker (get-document-thumbnail). Without --thumb the behaviour is unchanged:
    # ALL pages at scale 1.5 as a JSON array, for the full-page preview panes.
    parser.add_argument('--thumb', action='store_true',
                        help='render only one page at a low scale and print a single data: URI')
    parser.add_argument('--page', type=int, default=0, help='page index for --thumb (default 0)')
    parser.add_argument('--scale', type=float, default=None,
                        help='render scale (default 1.5 full / 0.3 thumb)')
    args = parser.parse_args()

    doc = pdfium.PdfDocument(_win_long_path(args.file))

    if args.thumb:
        scale = args.scale if args.scale is not None else 0.3
        idx   = max(0, min(args.page, len(doc) - 1))
        print(json.dumps(_render_page(doc[idx], scale)), flush=True)
        return

    scale  = args.scale if args.scale is not None else 1.5   # 108 DPI — enough for preview, smaller payload
    images = [_render_page(page, scale) for page in doc]
    print(json.dumps(images), flush=True)

if __name__ == '__main__':
    main()
