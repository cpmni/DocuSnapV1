#!/usr/bin/env python3
r"""
tests/test_thumbnail.py
-----------------------
Regression test for render/pages.py's --thumb mode, which backs the document
LIST thumbnails (get-document-thumbnail → previewService.getThumbnail) used by
the Review queue, Search results and the add-template / teach picker.

The full-page preview path (no --thumb) must stay byte-shaped exactly as before:
a JSON ARRAY with one data: URI per page. --thumb must instead emit a SINGLE
data: URI string for ONE page only (page 1 by default), at a low scale — so a
long list never renders every page of every document.

Run via subprocess against the real CLI so the argparse wiring is exercised, not
just an imported function.

Usage:
    py -3.12 python_backend/tests/test_thumbnail.py

Exit code 0 = behaves correctly. Exit code 1 = regression.
"""

import io
import os
import sys
import json
import base64
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


def check(label, condition):
    print(f"  {'OK ' if condition else 'BAD'} {label}")
    return condition


def _make_pdf(path, pages_count, w=600, h=800):
    doc = pdfium.PdfDocument.new()
    for _ in range(pages_count):
        doc.new_page(w, h)
    buf = io.BytesIO()
    doc.save(buf)
    with open(path, 'wb') as f:
        f.write(buf.getvalue())


def _run(*args):
    proc = subprocess.run(
        [sys.executable, str(PAGES_PY), *args],
        capture_output=True, text=True,
    )
    return proc


def _png_size(data_uri):
    """(width, height) of a data:image/png;base64 URI via the PNG IHDR header."""
    raw = base64.b64decode(data_uri.split(',', 1)[1])
    # PNG: 8-byte signature, then IHDR length(4)+type(4), then width(4)+height(4).
    w = int.from_bytes(raw[16:20], 'big')
    h = int.from_bytes(raw[20:24], 'big')
    return w, h


def main():
    failures = 0
    tmp = Path(tempfile.mkdtemp(prefix='docusnap-thumb-'))
    try:
        pdf = tmp / 'sample.pdf'
        _make_pdf(pdf, pages_count=3)

        # Full-page mode unchanged: a JSON array, one URI per page.
        print("Case 1: full-page mode (no --thumb) still returns an array of N pages")
        full = _run('--file', str(pdf))
        try:
            full_out = json.loads(full.stdout)
        except Exception:
            full_out = None
        if not check("stdout parses as JSON", full_out is not None):
            failures += 1
            print("    stderr:", full.stderr.strip()[:400])
        else:
            if not check("is a list", isinstance(full_out, list)):
                failures += 1
            if not check("has one entry per page (3)", isinstance(full_out, list) and len(full_out) == 3):
                failures += 1

        # Thumb mode: a SINGLE data: URI string, not an array.
        print("Case 2: --thumb returns ONE data: URI string (not an array)")
        thumb = _run('--file', str(pdf), '--thumb')
        try:
            thumb_out = json.loads(thumb.stdout)
        except Exception:
            thumb_out = None
        if not check("stdout parses as JSON", thumb_out is not None):
            failures += 1
            print("    stderr:", thumb.stderr.strip()[:400])
        else:
            if not check("is a string, not a list", isinstance(thumb_out, str)):
                failures += 1
            if not check("is a PNG data URI", isinstance(thumb_out, str) and thumb_out.startswith('data:image/png;base64,')):
                failures += 1

        # The thumb is smaller than a full-page render (low default scale) — this
        # is what keeps a long list cheap.
        print("Case 3: --thumb renders at a smaller scale than the full page")
        if isinstance(full_out, list) and full_out and isinstance(thumb_out, str):
            fw, _ = _png_size(full_out[0])
            tw, _ = _png_size(thumb_out)
            if not check(f"thumb width ({tw}) < full-page width ({fw})", tw < fw):
                failures += 1

        # --scale override is honoured.
        print("Case 4: --thumb honours an explicit --scale")
        if isinstance(thumb_out, str):
            big = _run('--file', str(pdf), '--thumb', '--scale', '0.6')
            try:
                big_out = json.loads(big.stdout)
            except Exception:
                big_out = None
            if isinstance(big_out, str):
                tw, _  = _png_size(thumb_out)
                bw, _  = _png_size(big_out)
                if not check(f"scale 0.6 wider ({bw}) than default 0.3 ({tw})", bw > tw):
                    failures += 1
            else:
                if not check("scaled thumb parses as a string", False):
                    failures += 1

        # An out-of-range --page is clamped, not crashed.
        print("Case 5: an out-of-range --page is clamped (no crash)")
        oob = _run('--file', str(pdf), '--thumb', '--page', '99')
        try:
            oob_out = json.loads(oob.stdout)
        except Exception:
            oob_out = None
        if not check("still returns a single data URI string", isinstance(oob_out, str) and oob_out.startswith('data:image')):
            failures += 1
            print("    stderr:", oob.stderr.strip()[:400])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print()
    if failures:
        print(f"{failures} check(s) failed — --thumb regressed.")
        return 1
    print("All checks passed — --thumb behaves as expected.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
