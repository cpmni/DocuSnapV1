#!/usr/bin/env python3
"""
pdf_text.py — extract the TEXT LAYER of a born-digital PDF (no OCR, no rendering) for Quick File
search (QuickFile+Departments plan §3 Q2 / eric B.4). Called by the directIntake handler like
render/pages.py. Outputs JSON {"text": "...", "pages": N}. A scanned PDF with no text layer yields
"" — Quick File is the NON-OCR lane by design; that doc is still found by its typed title/notes.
"""
import sys, os, json, argparse
import pypdfium2 as pdfium

_TEXT_CAP = 200000          # characters
_MAX_PAGES = int(os.environ.get("QUICKFILE_PDF_TEXT_PAGES", "50") or "50")


def _win_long_path(path):
    # Win32 strips trailing dots/spaces from path components; the \\?\ prefix bypasses it (see pages.py).
    if os.name != 'nt' or path.startswith('\\\\?\\'):
        return path
    if path.startswith('\\\\'):
        return '\\\\?\\UNC\\' + path.lstrip('\\')
    return '\\\\?\\' + path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--file', required=True)
    a = ap.parse_args()
    out = {"text": "", "pages": 0}
    try:
        pdf = pdfium.PdfDocument(_win_long_path(a.file))
        n = len(pdf)
        out["pages"] = n
        parts, total = [], 0
        for i in range(min(n, _MAX_PAGES)):
            try:
                tp = pdf[i].get_textpage()
                t = tp.get_text_range() or ""
            except Exception:
                t = ""
            if t:
                parts.append(t)
                total += len(t)
                if total >= _TEXT_CAP:
                    break
        pdf.close()
        out["text"] = ("\n".join(parts))[:_TEXT_CAP]
    except Exception as e:
        # Never fail the intake over a bad/locked/encrypted PDF — search text is best-effort.
        out["error"] = str(e)
    sys.stdout.write(json.dumps(out))


if __name__ == '__main__':
    main()
