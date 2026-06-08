#!/usr/bin/env python3
"""
pdf_splitter.py
---------------
Splits a PDF into page-range outputs using pypdf (pure-Python, BSD licence).
Called by Electron via IPC. Outputs a single JSON object to stdout.

pypdf is used only for PDF structure manipulation (splitting/writing).
pypdfium2 is kept for all rendering/preview/OCR paths — they coexist.

Usage:
  py -3.12 pdf_splitter.py --file input.pdf --ranges "1-3,5,7-9" --outdir /tmp/ds_split_xxx

  Page numbers are 1-based.  "5" = single page, "2-4" = inclusive range.
  --outdir defaults to a new system-temp subdirectory (ds_split_<timestamp>).

Output (JSON):
  {"success": true,  "files": ["path1.pdf", "path2.pdf", ...]}
  {"success": false, "error": "description"}
"""

import sys
import os
import json
import argparse
import tempfile
from pathlib import Path


def parse_ranges(ranges_str: str, total_pages: int) -> list[list[int]]:
    """Return a list of page-index lists (0-based) from a 1-based range string."""
    groups = []
    for part in ranges_str.split(','):
        part = part.strip()
        if not part:
            continue
        if '-' in part:
            a, b = part.split('-', 1)
            start = max(1, int(a.strip()))
            end   = min(total_pages, int(b.strip()))
            if start <= end:
                groups.append(list(range(start - 1, end)))
        else:
            p = int(part.strip())
            if 1 <= p <= total_pages:
                groups.append([p - 1])
    return groups


def split_pdf(input_path: str, ranges_str: str, out_dir: str) -> list[str]:
    try:
        from pypdf import PdfReader, PdfWriter
    except ImportError:
        raise RuntimeError(
            "pypdf is not installed. "
            "Run: pip install pypdf   (dev) "
            "or add it to vendor/python/Lib/site-packages/ (packaged build)."
        )

    reader     = PdfReader(input_path)
    total      = len(reader.pages)
    range_sets = parse_ranges(ranges_str, total)
    stem       = Path(input_path).stem
    out_paths  = []

    for page_indices in range_sets:
        writer = PdfWriter()
        for idx in page_indices:
            writer.add_page(reader.pages[idx])
        if len(page_indices) == 1:
            label = f"p{page_indices[0] + 1}"
        else:
            label = f"p{page_indices[0] + 1}-{page_indices[-1] + 1}"
        out_name = f"{stem}_split_{label}.pdf"
        out_path = os.path.join(out_dir, out_name)
        with open(out_path, 'wb') as fh:
            writer.write(fh)
        out_paths.append(out_path)

    return out_paths


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--file',   required=True,  help='Path to the source PDF')
    parser.add_argument('--ranges', required=True,  help='Page ranges, e.g. "1-3,5,7-9"')
    parser.add_argument('--outdir', default=None,   help='Output directory (default: auto temp)')
    args = parser.parse_args()

    if not os.path.isfile(args.file):
        print(json.dumps({'success': False, 'error': f'File not found: {args.file}'}), flush=True)
        sys.exit(1)

    out_dir = args.outdir or tempfile.mkdtemp(prefix='ds_split_')
    os.makedirs(out_dir, exist_ok=True)

    try:
        out_paths = split_pdf(args.file, args.ranges, out_dir)
        print(json.dumps({'success': True, 'files': out_paths, 'outdir': out_dir}), flush=True)
    except Exception as exc:
        print(json.dumps({'success': False, 'error': str(exc)}), flush=True)
        sys.exit(1)


if __name__ == '__main__':
    main()
