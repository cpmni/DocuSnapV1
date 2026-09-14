#!/usr/bin/env python3
r"""
tests/test_pages_outline_format.py
----------------------------------
Regression test for render/pages.py's two 2026-09-14 additions behind the Search viewer:

  --outline          the PDF's bookmarks (table of contents) as {"outline":[{title,page,level},…]} —
                     nested levels, 0-based page index, [] when the document has none. Backs the
                     Contents panel (click → jump to the page).
  --format auto      for a --thumb single-page render: JPEG when one embedded image covers most of the
                     page (a scan — the PNG encode was the viewer's slowest step), PNG for a vector page;
                     --format jpeg forces JPEG; the default (no flag) stays PNG byte-for-byte in shape.

Run via subprocess against the real CLI so the argparse wiring is exercised.

Usage:
    py -3.12 python_backend/tests/test_pages_outline_format.py

Exit code 0 = behaves correctly. Exit code 1 = regression.
"""

import io
import os
import sys
import json
import shutil
import tempfile
import subprocess
from pathlib import Path

RENDER_DIR = Path(__file__).parent.parent / 'render'
PAGES_PY   = RENDER_DIR / 'pages.py'

try:
    import pypdfium2 as pdfium
except ImportError:
    print("Skipping — pypdfium2 not available.")
    sys.exit(0)

fails = 0
def check(label, condition):
    global fails
    print(f"  {'OK ' if condition else 'BAD'} {label}")
    if not condition:
        fails += 1
    return condition


def _run(*args):
    proc = subprocess.run([sys.executable, str(PAGES_PY), *args], capture_output=True, text=True, timeout=120)
    return proc.returncode, proc.stdout, proc.stderr


def _vector_pdf(path, pages=4):
    doc = pdfium.PdfDocument.new()
    for _ in range(pages):
        doc.new_page(595, 842)
    buf = io.BytesIO(); doc.save(buf)
    with open(path, 'wb') as f:
        f.write(buf.getvalue())


def _raster_pdf(path):
    """A full-page raster (what a scan looks like): PIL saves an image as a one-page PDF."""
    from PIL import Image, ImageDraw
    img = Image.new('RGB', (1240, 1754), 'white')
    d = ImageDraw.Draw(img)
    for y in range(120, 1600, 60):
        d.rectangle([100, y, 1100, y + 18], fill='black')
    img.save(path, 'PDF', resolution=150.0)


def _outline_pdf(path):
    """4 blank pages + a nested outline (pypdf writes bookmarks; pypdfium2 reads them)."""
    from pypdf import PdfWriter
    w = PdfWriter()
    for _ in range(4):
        w.add_blank_page(width=595, height=842)
    top = w.add_outline_item("Chapter 1 — Introduction", 0)
    w.add_outline_item("1.1 Scope", 1, parent=top)
    w.add_outline_item("1.2 Terms", 1, parent=top)
    w.add_outline_item("Chapter 2 — Body", 2)
    w.add_outline_item("Appendix", 3)
    with open(path, 'wb') as fh:
        w.write(fh)


def main():
    tmp = tempfile.mkdtemp(prefix='sf_outline_')
    try:
        vec = os.path.join(tmp, 'vec.pdf'); _vector_pdf(vec)
        ras = os.path.join(tmp, 'ras.pdf'); _raster_pdf(ras)

        print("--outline")
        code, out, err = _run('--file', vec, '--outline')
        j = json.loads(out)
        check("a document without bookmarks → {\"outline\": []}", code == 0 and j == {"outline": []})
        try:
            import pypdf  # noqa: F401
            have_pypdf = True
        except ImportError:
            have_pypdf = False
        if have_pypdf:
            ol = os.path.join(tmp, 'outline.pdf'); _outline_pdf(ol)
            code, out, err = _run('--file', ol, '--outline')
            j = json.loads(out)
            items = j.get('outline')
            check("bookmarks listed in reader order with title / 0-based page / level",
                  code == 0 and isinstance(items, list) and [i['title'] for i in items] == [
                      "Chapter 1 — Introduction", "1.1 Scope", "1.2 Terms", "Chapter 2 — Body", "Appendix"]
                  and [i['page'] for i in items] == [0, 1, 1, 2, 3]
                  and [i['level'] for i in items] == [0, 1, 1, 0, 0])
            check("--outline renders nothing (no data: URI in the output)", 'data:image' not in out)
        else:
            print("  (pypdf not available — the nested-outline case skipped)")

        print("--format (single-page --thumb renders)")
        code, out, err = _run('--file', vec, '--thumb', '--page', '0', '--scale', '1')
        check("default (no --format) → PNG data URI, unchanged", code == 0 and json.loads(out).startswith('data:image/png;base64,'))
        code, out, err = _run('--file', ras, '--thumb', '--page', '0', '--scale', '1')
        check("default (no --format) on a RASTER page → still PNG (the argparse default is png, not auto)", code == 0 and json.loads(out).startswith('data:image/png;base64,'))
        code, out, err = _run('--file', vec, '--thumb', '--page', '0', '--scale', '1', '--format', 'auto')
        check("--format auto on a VECTOR page → PNG (lossless text)", code == 0 and json.loads(out).startswith('data:image/png;base64,'))
        code, out, err = _run('--file', ras, '--thumb', '--page', '0', '--scale', '1', '--format', 'auto')
        check("--format auto on a RASTER (scan) page → JPEG", code == 0 and json.loads(out).startswith('data:image/jpeg;base64,'))
        code, out, err = _run('--file', vec, '--thumb', '--page', '0', '--scale', '1', '--format', 'jpeg', '--quality', '80')
        check("--format jpeg forces JPEG on any page", code == 0 and json.loads(out).startswith('data:image/jpeg;base64,'))
        code, out, err = _run('--file', ras, '--scale', '1')
        arr = json.loads(out)
        check("the full-page ARRAY render (no --thumb) stays PNG regardless (the Review/teach path)",
              code == 0 and isinstance(arr, list) and len(arr) == 1 and arr[0].startswith('data:image/png;base64,'))
        code, out, err = _run('--file', ras, '--count')
        check("--count still answers {\"pages\": 1}", code == 0 and json.loads(out) == {"pages": 1})

        print("--page-info (one process: page(s) + count + bookmarks)")
        if have_pypdf:
            code, out, err = _run('--file', ol, '--page-info', '--page', '0', '--also', '2,1,99,2,-1', '--scale', '1', '--format', 'auto')
            j = json.loads(out)
            check("{pages, outline, images}: count 4, the 5 bookmarks, images for 0 + the valid extra indexes (out-of-range / duplicates skipped)",
                  code == 0 and j.get('pages') == 4 and len(j.get('outline', [])) == 5 and sorted(j.get('images', {}).keys()) == ['0', '1', '2']
                  and all(v.startswith('data:image/') for v in j['images'].values()))
        code, out, err = _run('--file', ras, '--page-info', '--page', '0', '--scale', '1', '--format', 'auto')
        j = json.loads(out)
        check("a raster page under --page-info --format auto → its image is JPEG; no bookmarks → outline []", code == 0 and j.get('pages') == 1 and j.get('outline') == [] and j['images']['0'].startswith('data:image/jpeg;base64,'))
        code, out, err = _run('--file', vec, '--page-info', '--page', '9')
        j = json.loads(out)
        check("an out-of-range --page → images {} (count still answered), never an error", code == 0 and j.get('pages') == 4 and j.get('images') == {})
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print(f"\n{'ALL OK' if not fails else str(fails) + ' FAILED'}")
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
