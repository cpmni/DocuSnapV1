#!/usr/bin/env python3
"""
filing_slips.py — generate a printable pack of ScanFinder SEPARATOR SHEETS (Filing Slips).

Called by Electron (processing/handler.js `generate-filing-slips`). Draws each sheet with
PIL (200 DPI A4 raster) + a segno-encoded QR, and writes ONE multi-page PDF. Duplex by
default (owner decision, design §10 Q3): every sheet is emitted as TWO identical pages so
a double-sided print survives a face-down feed; printed single-sided the extra page is a
harmless second sheet. Artwork spec: docs/designs/FILING_SLIPS_2026-07-18.md §2 — the v1
layout is a FROZEN CONTRACT (the slice-6 page-signature rescue rung calibrates against it).

Usage:
  py -3.12 filing_slips.py --out "pack.pdf" [--count 10] [--start 1]

Output (JSON, one line to stdout):
  {"success": true, "path": "...", "first": 7, "last": 16, "pages": 20}
  {"success": false, "error": "..."}

No repo-sibling imports (segno/PIL only) — safe under the embeddable Python's -P sys.path.
"""

import argparse
import io
import json
import sys

DPI = 200.0
PAGE_W, PAGE_H = 1654, 2339            # A4 at 200 DPI


def _mm(mm):
    return int(round(mm / 25.4 * DPI))


def _font(size):
    """Font ladder: Arial Bold → Segoe UI Bold → PIL default. Never fail the pack over a font."""
    from PIL import ImageFont
    for name in ("C:/Windows/Fonts/arialbd.ttf", "C:/Windows/Fonts/segoeuib.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    try:
        return ImageFont.load_default(size)
    except Exception:
        return ImageFont.load_default()


def _qr_image(payload, side_px):
    """segno QR at ECC level H, rasterised to side_px (NEAREST keeps modules crisp)."""
    import segno
    from PIL import Image
    qr = segno.make(payload, error="h", micro=False)
    buf = io.BytesIO()
    qr.save(buf, kind="png", scale=10, border=4)   # border=4 modules = the spec quiet zone
    buf.seek(0)
    img = Image.open(buf).convert("L")
    return img.resize((side_px, side_px), Image.NEAREST)


def _stripe_band(draw, y0, y1):
    """Thick diagonal-stripe band across the full page width (pure black on white)."""
    h = y1 - y0
    period, w = 46, 20
    for x in range(-h, PAGE_W + h, period):
        draw.polygon([(x, y0), (x + w, y0), (x + w - h, y1), (x - h, y1)], fill=0)


def make_sheet(number):
    from PIL import Image, ImageDraw
    payload = f"SFSEP-{number:04d}"
    page = Image.new("L", (PAGE_W, PAGE_H), 255)
    d = ImageDraw.Draw(page)

    # Header + footer stripe bands (mirrored — the sheet reads the same upside down).
    _stripe_band(d, 0, 70)
    _stripe_band(d, PAGE_H - 70, PAGE_H)
    d.text((PAGE_W // 2, 140), "SCANFINDER SEPARATOR SHEET", font=_font(56), fill=0, anchor="mm")

    # Primary QR — 90 mm, centred upper half (≈21 px/module at the 150 DPI detection render).
    big = _mm(90)
    page.paste(_qr_image(payload, big), ((PAGE_W - big) // 2, 420))

    # Two 35 mm corner-repeat QRs on opposite diagonal corners (crease/staple insurance).
    mini = _mm(35)
    page.paste(_qr_image(payload, mini), (90, 210))
    page.paste(_qr_image(payload, mini), (PAGE_W - 90 - mini, PAGE_H - 160 - mini))

    # The human handle: big number + the payload in small print (support/diagnostic).
    y = 420 + big
    d.text((PAGE_W // 2, y + 130), f"SEPARATOR {number:02d}", font=_font(150), fill=0, anchor="mm")
    d.text((PAGE_W // 2, y + 250), payload, font=_font(24), fill=0, anchor="mm")

    # Instructions — must make sense lying in a paper pile, months later.
    ins = _font(40)
    d.text((PAGE_W // 2, y + 360), "Place this sheet between documents in your scan pile.", font=ins, fill=0, anchor="mm")
    d.text((PAGE_W // 2, y + 425), "ScanFinder splits the batch here and removes this sheet automatically.", font=ins, fill=0, anchor="mm")
    d.text((PAGE_W // 2, y + 490), "Reusable — any way up is fine. Print double-sided if you can.", font=ins, fill=0, anchor="mm")
    return page


def generate(out_path, count, start):
    pages = []
    for i in range(count):
        sheet = make_sheet(start + i)
        pages.append(sheet)
        pages.append(sheet.copy())     # duplex pair — identical back face
    # resolution= is LOAD-BEARING: without it the PDF page size is wrong and the
    # sheets print off-A4 (design §5).
    pages[0].save(out_path, "PDF", save_all=True, append_images=pages[1:], resolution=DPI)
    return len(pages)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="Output PDF path")
    ap.add_argument("--count", type=int, default=10, help="Number of sheets (1-50)")
    ap.add_argument("--start", type=int, default=1, help="First sheet number")
    args = ap.parse_args()
    try:
        count = max(1, min(50, int(args.count)))
        start = max(1, min(9999, int(args.start)))
        n_pages = generate(args.out, count, start)
        print(json.dumps({"success": True, "path": args.out, "first": start,
                          "last": start + count - 1, "pages": n_pages}), flush=True)
    except Exception as exc:
        print(json.dumps({"success": False, "error": str(exc)}), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
