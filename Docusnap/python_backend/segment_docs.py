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
                           [--slips]

Output (JSON, one line to stdout):
  {"success": true, "page_count": 10, "segments": [[0,0],[1,1],...],
   "first_pages": [0,1,...], "reasons": ["document start", "first-page fingerprint", ...]}
  {"success": false, "error": "..."}

A single-page PDF, no templates, or any error yields a single whole-document segment so
the caller's behaviour is byte-identical to today (no split).

--slips (Filing Slips / "Separator sheets", docs/designs/FILING_SLIPS_2026-07-18.md):
scan for printed SFSEP QR separator sheets FIRST (ocr/slip_detect.py — works with ZERO
templates). Sheets found ⇒ emit a slips-only result whose segments EXCLUDE the sheet
pages (adds "separator_pages"/"separator_payloads") and SKIP template segmentation for
this file (pinned trade-off — physical sheets are explicit operator intent). No sheets,
or a slip-scan abort ⇒ fall through to template segmentation unchanged (an abort is
recorded in `reasons` + `slip_aborted` so the trace explains the fallthrough, and the
caller must ignore any separator data — a partial slip map would split wrong). Without
--slips the output is byte-identical to before (slip code is never imported).
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
    parser.add_argument("--slips", action="store_true",
                        help="Scan for printed separator sheets (Filing Slips) before template segmentation")
    args = parser.parse_args()

    if not os.path.isfile(args.file):
        print(json.dumps({"success": False, "error": f"File not found: {args.file}"}), flush=True)
        sys.exit(1)

    templates = load_json_arg(args.templates_file) or []

    # Filing Slips: separator-sheet scan FIRST (template-free by design). Sheets found ⇒
    # slips-only result, template segmentation skipped. Abort/no-sheets ⇒ fall through.
    slip_aborted = None
    if args.slips:
        try:
            from ocr.slip_detect import detect_slips, segments_excluding
            sd = detect_slips(args.file)
            if sd.get("aborted"):
                slip_aborted = sd["aborted"]
            elif sd.get("separator_pages"):
                seps = sd["separator_pages"]
                segs = segments_excluding(sd["page_count"], seps)
                print(json.dumps({
                    "success": True,
                    "page_count": sd["page_count"],
                    "segments": segs,
                    "first_pages": [s[0] for s in segs],
                    "separator_pages": seps,
                    "separator_payloads": sd.get("separator_payloads", []),
                    "reasons": ["separator sheet"] * len(seps),
                }), flush=True)
                return
        except Exception as exc:            # fail safe: never let the slip rung kill the pre-pass
            slip_aborted = str(exc)

    try:
        from ocr.segmentation import detect_segments
        res = detect_segments(args.file, templates, tesseract_path=args.tesseract)
        res["success"] = True
        if slip_aborted:
            # Visible in the dev-inspector trace: explains WHY a slip-bearing file fell
            # through to template segmentation (Oracle C4 — abort must never half-apply,
            # so no separator_pages are emitted on this path).
            res.setdefault("reasons", []).append(f"slip detection aborted: {slip_aborted}")
            res["slip_aborted"] = slip_aborted
        print(json.dumps(res), flush=True)
    except Exception as exc:
        # Fail safe: report a single whole-document segment so the caller never splits
        # on an error (no worse than today).
        print(json.dumps({"success": False, "error": str(exc),
                          "page_count": 1, "segments": [[0, 0]], "first_pages": [0]}), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
