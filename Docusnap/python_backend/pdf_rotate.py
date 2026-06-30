#!/usr/bin/env python3
"""
pdf_rotate.py — apply per-page CLOCKWISE rotations to a PDF IN PLACE (pypdf, BSD-3).

Used by the import pipeline to make the WORKING-COPY PDF upright when OSD (ocr/orientation.py)
detected a sideways/upside-down page on first import, so BOTH filing (commitDocument copies the
working copy) and any future reprocess (re-renders it) inherit the corrected orientation from a
single detection.

pypdf `page.rotate(r)` adds `r` (a multiple of 90, CLOCKWISE) to the page's `/Rotate` — which
matches Tesseract OSD's clockwise-to-upright value VERBATIM (no sign flip; see ocr/orientation.py
and tests/test_orientation.py for the proof). Only `/Rotate` is touched — content streams, the
text layer and images are untouched. Atomic: writes a sibling `.part` then os.replace()s, so a
crash never leaves a half-written working copy.

Usage:
  py -3.12 pdf_rotate.py --file working.pdf --rotations "0,90,0,270"

Output (JSON): {"success": true, "rotated": N} | {"success": false, "error": "..."}
"""

import sys
import os
import json
import argparse


def rotate_pdf(path: str, rotations: list) -> int:
    """Rotate page i by rotations[i] degrees clockwise (0/90/180/270), in place. Returns the
    number of pages actually rotated."""
    from pypdf import PdfReader, PdfWriter

    reader  = PdfReader(path)
    writer  = PdfWriter()
    rotated = 0
    for i, page in enumerate(reader.pages):
        r = int(rotations[i]) if i < len(rotations) else 0
        r = ((r % 360) + 360) % 360
        if r in (90, 180, 270):
            page.rotate(r)          # CLOCKWISE, additive to /Rotate — verbatim OSD value
            rotated += 1
        writer.add_page(page)

    tmp = path + '.part'
    with open(tmp, 'wb') as fh:
        writer.write(fh)
    os.replace(tmp, path)           # atomic in-place replace (same directory)
    return rotated


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--file', required=True, help='PDF to rotate in place')
    p.add_argument('--rotations', required=True,
                   help='Comma-separated per-page clockwise degrees, e.g. "0,90,0,270"')
    args = p.parse_args()

    if not os.path.isfile(args.file):
        print(json.dumps({'success': False, 'error': f'File not found: {args.file}'}), flush=True)
        sys.exit(1)
    try:
        rots = [int(x) for x in args.rotations.split(',') if x.strip() != '']
    except ValueError:
        print(json.dumps({'success': False, 'error': 'bad --rotations'}), flush=True)
        sys.exit(1)

    try:
        rotated = rotate_pdf(args.file, rots)
        print(json.dumps({'success': True, 'rotated': rotated}), flush=True)
    except Exception as exc:
        print(json.dumps({'success': False, 'error': str(exc)}), flush=True)
        sys.exit(1)


if __name__ == '__main__':
    main()
