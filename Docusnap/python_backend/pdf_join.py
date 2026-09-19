#!/usr/bin/env python3
"""
pdf_join.py
-----------
Concatenates several PDFs into ONE, in the exact order given, using pypdf
(pure-Python, BSD-3 licence). Called by Electron via IPC to undo a bad
automatic document split ("C12" — Rejoin). Outputs a single JSON object.

pypdf is used only for PDF structure manipulation (joining/writing). pypdfium2
stays for all rendering/preview/OCR paths — they coexist.

writer.add_page() clones each page's /Rotate entry, so per-page rotation is
preserved for free. Auto-rotate bakes rotation into the WORKING COPY
(inbox/<docId>.pdf) via pdf_rotate.py, so the caller joins the working copies,
NOT the raw un-rotated folder segments (which are also drained to Processed/).

Usage:
  py -3.12 pdf_join.py --file A.pdf --file B.pdf --out joined.pdf

  Page order = the order the --file arguments are given (the caller sorts the
  earlier page before the later page). Repeat --file per input; two minimum.

Output (JSON):
  {"success": true,  "pages": N, "out": "joined.pdf"}
  {"success": false, "error": "description"}
"""

import sys
import os
import json
import argparse


def join_pdfs(in_paths: list[str], out_path: str) -> int:
    try:
        from pypdf import PdfReader, PdfWriter
    except ImportError:
        raise RuntimeError(
            "pypdf is not installed. "
            "Run: pip install pypdf   (dev) "
            "or add it to vendor/python/Lib/site-packages/ (packaged build)."
        )

    writer = PdfWriter()
    for p in in_paths:
        reader = PdfReader(p)
        for page in reader.pages:
            writer.add_page(page)   # clones /Rotate -> per-page rotation preserved

    # Write to a temporary sibling first, then atomic-rename, so a crash mid-write
    # never leaves a truncated --out that the caller might swap into a working copy.
    tmp = out_path + '.part'
    with open(tmp, 'wb') as fh:
        writer.write(fh)
    os.replace(tmp, out_path)
    return len(writer.pages)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--file', dest='files', action='append', required=True,
                        help='An input PDF (repeat, in output page order)')
    parser.add_argument('--out', required=True, help='Path to write the joined PDF')
    args = parser.parse_args()

    in_paths = [p for p in (args.files or []) if p and p.strip()]
    if len(in_paths) < 2:
        print(json.dumps({'success': False, 'error': 'Provide at least two --file inputs to join'}), flush=True)
        sys.exit(1)
    missing = [p for p in in_paths if not os.path.isfile(p)]
    if missing:
        print(json.dumps({'success': False, 'error': f'File(s) not found: {missing}'}), flush=True)
        sys.exit(1)

    try:
        pages = join_pdfs(in_paths, args.out)
        print(json.dumps({'success': True, 'pages': pages, 'out': args.out}), flush=True)
    except Exception as exc:
        try:
            if os.path.isfile(args.out + '.part'):
                os.remove(args.out + '.part')
        except OSError:
            pass
        print(json.dumps({'success': False, 'error': str(exc)}), flush=True)
        sys.exit(1)


if __name__ == '__main__':
    main()
