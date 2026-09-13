#!/usr/bin/env python3
"""
pdf_find.py — locate a search TERM in a born-digital PDF's text layer and return where it sits on
each page, as FRACTIONS of the page size (0..1, top-left origin). NO OCR, NO rendering. Used by the
preview's "jump to the search term / next / highlight" feature (search-term navigation, 2026-09-13).

Fractions (not pixels) keep the result independent of the render DPI/scale and of any on-screen zoom:
the renderer positions a highlight box at left=x0*100%, top=y0*100% over the page image.

Output JSON: {"kind":"pdf","pages":N,"matches":[{"page":i,"x0":..,"y0":..,"x1":..,"y1":..}, ...]}
A scanned PDF with no text layer yields matches:[] (that lane needs OCR word boxes — a follow-up).
"""
import sys, os, json, argparse
import pypdfium2 as pdfium

_MAX_PAGES   = int(os.environ.get("PREVIEW_FIND_PAGES", "100") or "100")
_MAX_MATCHES = int(os.environ.get("PREVIEW_FIND_MATCHES", "500") or "500")


def _win_long_path(path):
    # Win32 strips trailing dots/spaces from path components; the \\?\ prefix bypasses it (see pages.py).
    if os.name != 'nt' or path.startswith('\\\\?\\'):
        return path
    if path.startswith('\\\\'):
        return '\\\\?\\UNC\\' + path.lstrip('\\')
    return '\\\\?\\' + path


def _clamp01(v):
    return 0.0 if v < 0 else (1.0 if v > 1 else v)


def _page_matches(page, term):
    """Yield one union bbox per occurrence of `term` on `page`, as top-left-origin fractions."""
    out = []
    w, h = page.get_size()
    if not w or not h:
        return out
    tp = page.get_textpage()
    try:
        searcher = tp.search(term, match_case=False, match_whole_word=False)
        try:
            occ = searcher.get_next()
            while occ is not None:
                index, count = occ
                # Union the (possibly multi-line-wrapped) rects of this one occurrence into a single box.
                n = tp.count_rects(index, count)
                l = b = r = t = None
                for i in range(n):
                    rl, rb, rr, rt = tp.get_rect(i)
                    l = rl if l is None else min(l, rl)
                    b = rb if b is None else min(b, rb)
                    r = rr if r is None else max(r, rr)
                    t = rt if t is None else max(t, rt)
                if l is not None:
                    out.append({
                        "x0": round(_clamp01(l / w), 5),
                        "y0": round(_clamp01((h - t) / h), 5),   # top edge (PDF y is bottom-up)
                        "x1": round(_clamp01(r / w), 5),
                        "y1": round(_clamp01((h - b) / h), 5),   # bottom edge
                    })
                if len(out) >= _MAX_MATCHES:
                    break
                occ = searcher.get_next()
        finally:
            searcher.close()
    finally:
        tp.close()
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--file', required=True)
    ap.add_argument('--query', required=True)
    a = ap.parse_args()
    out = {"kind": "pdf", "pages": 0, "matches": []}
    term = (a.query or "").strip()
    if not term:
        sys.stdout.write(json.dumps(out)); return
    try:
        pdf = pdfium.PdfDocument(_win_long_path(a.file))
        n = len(pdf)
        out["pages"] = n
        matches = []
        for i in range(min(n, _MAX_PAGES)):
            try:
                for box in _page_matches(pdf[i], term):
                    box["page"] = i
                    matches.append(box)
            except Exception:
                continue   # a bad page must not sink the whole search
            if len(matches) >= _MAX_MATCHES:
                break
        pdf.close()
        # Reading order: page, then top-to-bottom, then left-to-right.
        matches.sort(key=lambda m: (m["page"], m["y0"], m["x0"]))
        out["matches"] = matches[:_MAX_MATCHES]
    except Exception as e:
        out["error"] = str(e)
    sys.stdout.write(json.dumps(out))


if __name__ == '__main__':
    main()
