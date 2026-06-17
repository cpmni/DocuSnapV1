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


def chunk_ranges(total_pages: int, every: int) -> list[list[int]]:
    """Split into consecutive groups of `every` pages (0-based indices).
    every=1 -> one file per page; every=3 -> pages 1-3, 4-6, ... A trailing
    short group is kept (e.g. 7 pages by 3 -> 1-3, 4-6, 7)."""
    every = max(1, int(every))
    return [list(range(i, min(i + every, total_pages)))
            for i in range(0, total_pages, every)]


def split_pdf(input_path: str, ranges_str: str, out_dir: str, every: int | None = None) -> list[str]:
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
    # `every` (split every N pages, 1 = every page) takes precedence over an
    # explicit range string when supplied.
    range_sets = chunk_ranges(total, every) if every else parse_ranges(ranges_str or '', total)
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
    parser.add_argument('--ranges', default=None,   help='Page ranges, e.g. "1-3,5,7-9"')
    parser.add_argument('--every',  type=int, default=None,
                        help='Split every N pages (1 = one file per page). Overrides --ranges.')
    parser.add_argument('--outdir', default=None,   help='Output directory (default: auto temp)')
    args = parser.parse_args()

    if not args.every and not args.ranges:
        print(json.dumps({'success': False, 'error': 'Provide --ranges or --every'}), flush=True)
        sys.exit(1)

    if not os.path.isfile(args.file):
        print(json.dumps({'success': False, 'error': f'File not found: {args.file}'}), flush=True)
        sys.exit(1)

    out_dir = args.outdir or tempfile.mkdtemp(prefix='ds_split_')
    os.makedirs(out_dir, exist_ok=True)

    try:
        out_paths = split_pdf(args.file, args.ranges, out_dir, every=args.every)
        print(json.dumps({'success': True, 'files': out_paths, 'outdir': out_dir}), flush=True)
    except Exception as exc:
        print(json.dumps({'success': False, 'error': str(exc)}), flush=True)
        sys.exit(1)


if __name__ == '__main__':
    main()
