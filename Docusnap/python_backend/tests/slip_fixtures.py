#!/usr/bin/env python3
"""
tests/slip_fixtures.py — synthetic Filing-Slips fixtures (test-only, never shipped).

Builds multi-page PDFs mixing PIL-drawn content pages with separator-sheet pages carrying
a real segno-encoded SFSEP QR, via Pillow's multi-page PDF writer — no binary fixtures in
git. Shared by tests/test_slip_detect.py and spawned by src/modules/processing/
test_slip_e2e.js (the Oracle C1 real-invocation gate):

  py -3.12 tests/slip_fixtures.py --out fx.pdf --layout c,s7,c
      layout tokens: c = content page · sN = separator sheet number N
"""

import argparse
import io

from PIL import Image, ImageDraw

PAGE = (1654, 2339)          # A4 @ 200 DPI
DPI = 200.0


def make_slip_page(number, qr_mm=90, rotate_deg=0.0, mask_band_frac=0.0, payload=None):
    """A separator sheet: centred QR (default 90 mm) + big number beneath — enough of the
    real artwork for detection. Optional degradation: small rotation, a white band masking
    a fraction of the QR's height (ECC-H recovery test)."""
    import segno
    text = payload if payload is not None else f"SFSEP-{number:04d}"
    qr = segno.make(text, error="h", micro=False)
    buf = io.BytesIO()
    qr.save(buf, kind="png", scale=10, border=4)
    buf.seek(0)
    qimg = Image.open(buf).convert("L")
    side = int(qr_mm / 25.4 * DPI)
    qimg = qimg.resize((side, side), Image.NEAREST)
    if mask_band_frac > 0:
        d = ImageDraw.Draw(qimg)
        band = int(side * mask_band_frac)
        top = (side - band) // 2
        d.rectangle([0, top, side, top + band], fill=255)

    page = Image.new("L", PAGE, 255)
    x = (PAGE[0] - side) // 2
    y = 420
    page.paste(qimg, (x, y))
    d = ImageDraw.Draw(page)
    d.text((PAGE[0] // 2 - 160, y + side + 90), f"SEPARATOR {number:02d}", fill=0)
    d.text((PAGE[0] // 2 - 120, y + side + 160), text, fill=0)
    if rotate_deg:
        page = page.rotate(rotate_deg, expand=False, fillcolor=255)
    return page


def make_content_page(seed=0):
    """A plausible document page: heading + ruled text lines (no QR)."""
    page = Image.new("L", PAGE, 255)
    d = ImageDraw.Draw(page)
    d.text((140, 120), f"ACME TRADING LTD — INVOICE {1000 + seed}", fill=0)
    for row in range(14):
        y = 340 + row * 120
        d.text((140, y), f"Line item {row + 1} · widget batch {seed}-{row} · 12.{row:02d}", fill=60)
        d.line([(140, y + 46), (1500, y + 46)], fill=180, width=2)
    return page


def build_pdf(pages, path):
    pages[0].save(path, "PDF", save_all=True, append_images=pages[1:], resolution=DPI)
    return path


def pages_from_layout(layout):
    """'c,s7,c' -> [content, slip#7, content]"""
    pages = []
    for i, tok in enumerate(t.strip() for t in layout.split(",") if t.strip()):
        if tok == "c":
            pages.append(make_content_page(seed=i))
        elif tok.startswith("s"):
            pages.append(make_slip_page(int(tok[1:])))
        else:
            raise ValueError(f"unknown layout token: {tok}")
    return pages


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--layout", default="c,s7,c")
    args = ap.parse_args()
    build_pdf(pages_from_layout(args.layout), args.out)
    print(args.out)


if __name__ == "__main__":
    main()
