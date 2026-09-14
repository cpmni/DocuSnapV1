#!/usr/bin/env python3
"""
render_pages.py — renders PDF pages to base64 PNG for the review window.
Called by Electron main process. Outputs a JSON array of data: URIs.
"""
import sys, os, json, argparse, base64
from io import BytesIO
import pypdfium2 as pdfium

# SECURITY (Stage 2 — F6/L5, Oracle C2): the crafted-document render-dimension clamp also applies on
# THIS preview/thumbnail render path (the same PDF reaches here when the queue shows it, before OCR).
# Bounds a decompression/pixel-bomb page (a tiny page declaring enormous dimensions). INERT on real
# docs — min(scale, …) equals `scale` for every normal page (A4 at scale 1.5 is ~1240px « 10000).
_MAX_RENDER_DIM = int(os.environ.get("OCR_MAX_RENDER_DIM", "10000") or "10000")   # px per axis

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

def _is_raster_page(page, min_cover=0.5):
    """True when the embedded IMAGE objects together cover >= min_cover of the page area — a scan / photo
    page (one full-page image, or a strip/band-encoded fax-style scan of several images). Such a page has no
    crisp vector text to lose, and its PNG at the Search scale (216 DPI) was the single slowest step of the
    viewer (measured 2026-09-14: 0.84 s to encode + 5 MB per page, vs 0.03 s + 0.8 MB as JPEG).
    Fail-closed: any API difference → False → PNG (the lossless path)."""
    try:
        import pypdfium2.raw as pdfium_c
        pw, ph = page.get_size()
        area = float(pw) * float(ph)
        if area <= 0:
            return False
        total = 0.0
        for obj in page.get_objects(filter=(pdfium_c.FPDF_PAGEOBJ_IMAGE,), max_depth=2):
            # pypdfium2 ≥ 4.x names the bbox getter get_bounds(); older builds get_pos(). Both → (l, b, r, t) in points.
            getter = getattr(obj, 'get_bounds', None) or getattr(obj, 'get_pos', None)
            if getter is None:
                continue
            l, b, r, t = getter()
            total += min(1.0, max(0.0, (r - l)) * max(0.0, (t - b)) / area)
            if total >= min_cover:
                return True
    except Exception:
        return False
    return False

def _render_page(page, scale, fmt='png', quality=90):
    """fmt: 'png' (default, lossless — unchanged behaviour), 'jpeg', or 'auto' (JPEG for a raster/scan
    page, PNG for a vector/text page — see _is_raster_page). The Search viewer asks for 'auto'."""
    try:
        _w, _h = page.get_size()                       # points; clamp so a bomb page can't render huge
        if _w > 0 and _h > 0:
            scale = min(scale, _MAX_RENDER_DIM / _w, _MAX_RENDER_DIM / _h)
    except Exception:
        pass
    bitmap = page.render(scale=scale)
    img    = bitmap.to_pil()
    buf    = BytesIO()
    use_jpeg = (fmt == 'jpeg') or (fmt == 'auto' and _is_raster_page(page))
    if use_jpeg:
        q = max(50, min(95, int(quality or 90)))
        img.convert('RGB').save(buf, format='JPEG', quality=q, optimize=False)
        mime = 'image/jpeg'
    else:
        # No optimize=True: it's the slowest PNG step (extra zlib pass) for only a
        # marginal size win — not worth it for an on-demand preview render over a LAN.
        img.save(buf, format='PNG')
        mime = 'image/png'
    b64 = base64.b64encode(buf.getvalue()).decode()
    return f'data:{mime};base64,{b64}'

def _outline(doc, limit=500):
    """The PDF's bookmarks / outline (table of contents) as a flat, ordered list of
    {title, page, level} — page is a 0-based index (None when the bookmark has no page
    destination), level 0 = top. Empty list when the document has none. Capped so a
    hostile file can't emit megabytes; titles trimmed. Fail-closed → []."""
    out = []
    try:
        for item in doc.get_toc():
            if len(out) >= limit:
                break
            try:
                title = item.get_title()
            except Exception:
                title = None
            page = None
            try:
                dest = item.get_dest()
                if dest is not None:
                    page = dest.get_index()
            except Exception:
                page = None
            level = int(getattr(item, 'level', 0) or 0)
            title = str(title or '').strip()[:200]
            if not title and page is None:
                continue
            out.append({"title": title or f"Page {int(page) + 1}", "page": (int(page) if page is not None else None), "level": max(0, level)})
    except Exception:
        return []
    return out

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
    # COUNT MODE: open the PDF and print ONLY its page count as JSON — no rendering. Lets the preview
    # size its lazy page array (and show page nav) instantly for a doc whose page_count wasn't recorded
    # (e.g. a Quick File doc), instead of rendering every page just to learn how many there are.
    parser.add_argument('--count', action='store_true', help='print {"pages":N} and exit — no render')
    # OUTLINE MODE: print the PDF's bookmarks (table of contents) as {"outline":[{title,page,level},…]} — no render.
    # Backs the Search viewer's Contents panel (click → jump to the page).
    parser.add_argument('--outline', action='store_true', help='print {"outline":[…]} and exit — no render')
    # Image format for --thumb single-page renders: png (default, unchanged), jpeg, or auto (JPEG for a
    # raster/scan page, PNG for a vector page). The full-page array render stays PNG.
    parser.add_argument('--format', choices=['png', 'jpeg', 'auto'], default='png')
    parser.add_argument('--quality', type=int, default=90, help='JPEG quality for --format jpeg/auto (50..95)')
    args = parser.parse_args()

    doc = pdfium.PdfDocument(_win_long_path(args.file))

    if args.count:
        print(json.dumps({"pages": len(doc)}), flush=True)
        return

    if args.outline:
        print(json.dumps({"outline": _outline(doc)}), flush=True)
        return

    if args.thumb:
        scale = args.scale if args.scale is not None else 0.3
        idx   = max(0, min(args.page, len(doc) - 1))
        print(json.dumps(_render_page(doc[idx], scale, fmt=args.format, quality=args.quality)), flush=True)
        return

    scale  = args.scale if args.scale is not None else 1.5   # 108 DPI — enough for preview, smaller payload
    images = [_render_page(page, scale) for page in doc]
    print(json.dumps(images), flush=True)

if __name__ == '__main__':
    main()
