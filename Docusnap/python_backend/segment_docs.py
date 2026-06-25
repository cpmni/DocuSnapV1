#!/usr/bin/env python3
"""
segment_docs.py
---------------
CLI front-end for ocr/segmentation.py — the batch document SEPARATION pre-pass.
Renders a multi-page PDF's pages and reports where it should be CUT into separate
documents (a stack of distinct documents in one file → one document each).

Called by Electron (processing/handler.js) BEFORE the worker pool runs. Reuses the same
`--templates-file` the main pipeline already builds (writeTempJson('templates', …)).

Usage:
  py -3.12 segment_docs.py --file in.pdf --templates-file templates.json [--tesseract PATH]

Output (JSON, one line to stdout):
  {"success": true, "page_count": 10, "segments": [[0,0],[1,1],...],
   "first_pages": [0,1,...], "reasons": ["document start", "first-page fingerprint", ...]}
  {"success": false, "error": "..."}

A single-page PDF, no templates, or any error yields a single whole-document segment so
the caller's behaviour is byte-identical to today (no split).
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def load_json_arg(path):
    if not path or not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True, help="Path to the source PDF")
    parser.add_argument("--templates-file", default=None, help="JSON list of learned templates")
    parser.add_argument("--tesseract", default=None, help="Tesseract executable (for scanned pages)")
    args = parser.parse_args()

    if not os.path.isfile(args.file):
        print(json.dumps({"success": False, "error": f"File not found: {args.file}"}), flush=True)
        sys.exit(1)

    templates = load_json_arg(args.templates_file) or []
    try:
        from ocr.segmentation import detect_segments
        res = detect_segments(args.file, templates, tesseract_path=args.tesseract)
        res["success"] = True
        print(json.dumps(res), flush=True)
    except Exception as exc:
        # Fail safe: report a single whole-document segment so the caller never splits
        # on an error (no worse than today).
        print(json.dumps({"success": False, "error": str(exc),
                          "page_count": 1, "segments": [[0, 0]], "first_pages": [0]}), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
