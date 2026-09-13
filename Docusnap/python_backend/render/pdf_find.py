#!/usr/bin/env python3
"""
pdf_find.py — locate a search TERM in a PDF and return where it sits on each page, as FRACTIONS of the
page size (0..1, top-left origin). Used by the preview's "jump to the search term / next / highlight"
feature (search-term navigation, 2026-09-13).

TWO geometry sources:
  1. BORN-DIGITAL text layer (pypdfium2 textpage.search) — no OCR, no render. The fast path.
  2. SCANNED PAGES (no text layer) — an OCR word-box fallback (2026-09-13): render each page, read word
     boxes via ocr.tesseract.reconstruct_page_text, and match the term against them. DISPLAY-ONLY — it
     writes nothing to the DB / extraction / learning; a miss or a slightly-off box has no filing
     consequence. Runs ONLY when the text-layer pass found nothing AND the doc has no text layer at all
     (a pure scan), so an authoritative born-digital text layer is never second-guessed by fuzzy OCR.

Fractions (not pixels) keep the result independent of the render DPI/scale and of any on-screen zoom:
the renderer positions a highlight box at left=x0*100%, top=y0*100% over the page image. Tesseract boxes
are already top-left origin, so — unlike the PDF text layer (bottom-up, y-flipped below) — the OCR path
does NOT flip y.

Output JSON: {"kind":"pdf"|"ocr"|"none","pages":N,"matches":[{"page":i,"x0":..,"y0":..,"x1":..,"y1":..}]}
"""
import sys, os, json, argparse, hashlib, tempfile

# The OCR fallback imports ocr.tesseract (from python_backend/). Embeddable Python drops the script dir
# from sys.path, so add python_backend (parent of render/) explicitly — NEVER a bare `import ocr...`.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pypdfium2 as pdfium

_MAX_PAGES     = int(os.environ.get("PREVIEW_FIND_PAGES", "100") or "100")
_MAX_MATCHES   = int(os.environ.get("PREVIEW_FIND_MATCHES", "500") or "500")
# OCR fallback is seconds-per-page, so cap tighter than the text-layer scan; env-tunable for diagnosis.
_MAX_OCR_PAGES = int(os.environ.get("PREVIEW_FIND_OCR_PAGES", "30") or "30")
_OCR_DPI       = int(os.environ.get("PREVIEW_FIND_OCR_DPI", "200") or "200")
_OCR_CONF_MIN  = int(os.environ.get("PREVIEW_FIND_OCR_CONF", "30") or "30")


def _win_long_path(path):
    # Win32 strips trailing dots/spaces from path components; the \\?\ prefix bypasses it (see pages.py).
    if os.name != 'nt' or path.startswith('\\\\?\\'):
        return path
    if path.startswith('\\\\'):
        return '\\\\?\\UNC\\' + path.lstrip('\\')
    return '\\\\?\\' + path


def _clamp01(v):
    return 0.0 if v < 0 else (1.0 if v > 1 else v)


def _norm(s):
    """Compare-time normalise: lower-case + collapse whitespace to single spaces."""
    return " ".join(str(s or "").lower().split())


# ── Born-digital text layer ─────────────────────────────────────────────────────
def _textpage_matches(tp, w, h, term):
    """Yield one union bbox per occurrence of `term` on this textpage, as top-left-origin fractions."""
    out = []
    if not w or not h:
        return out
    searcher = tp.search(term, match_case=False, match_whole_word=False)
    try:
        occ = searcher.get_next()
        while occ is not None:
            index, count = occ
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
    return out


# ── OCR word-box fallback (scanned pages) ────────────────────────────────────────
def _match_rows(rows, term):
    """Match `term` (already normalised) against OCR rows. Each row = [[x0,y0,x1,y1,text_lower], ...]
    sorted left-to-right. Single word OR a phrase spanning adjacent words on a line: join the row's word
    texts with single spaces, substring-search, and union the boxes of the contributing words."""
    out = []
    if not term:
        return out
    for row in rows:
        if not row:
            continue
        parts, spans, pos = [], [], 0
        for wi, wd in enumerate(row):
            txt = wd[4]
            if wi:
                parts.append(" "); pos += 1
            start = pos
            parts.append(txt); pos += len(txt)
            spans.append((start, pos, wi))
        rowtext = "".join(parts)
        idx = rowtext.find(term)
        while idx != -1:
            end = idx + len(term)
            hit = [row[wi] for (s, e, wi) in spans if s < end and e > idx]
            if hit:
                out.append({
                    "x0": round(min(w[0] for w in hit), 5),
                    "y0": round(min(w[1] for w in hit), 5),
                    "x1": round(max(w[2] for w in hit), 5),
                    "y1": round(max(w[3] for w in hit), 5),
                })
            if len(out) >= _MAX_MATCHES:
                return out
            idx = rowtext.find(term, idx + 1)
    return out


def _ocr_cache_path(filepath):
    try:
        st = os.stat(filepath)
        sig = f"{os.path.abspath(filepath)}|{int(st.st_mtime)}|{st.st_size}|{_OCR_DPI}|{_OCR_CONF_MIN}"
    except OSError:
        sig = f"{os.path.abspath(filepath)}|{_OCR_DPI}|{_OCR_CONF_MIN}"
    key = hashlib.sha1(sig.encode("utf-8")).hexdigest()
    return os.path.join(tempfile.gettempdir(), f"sf_find_ocr_{key}.json")


def _build_ocr_index(pdf, n):
    """Render + OCR each page (capped) into {page_index: [rows]} of top-left-origin fractions.
    Best-effort per page — a page that won't render/OCR is skipped, never sinks the whole search."""
    from ocr.tesseract import reconstruct_page_text
    # A concurrent PSM-3 + PSM-6 pass halves per-page OCR latency (each shells to a GIL-free tesseract.exe).
    os.environ.setdefault('DS_OCR_PARALLEL_FULLPAGE', '1')
    scale = _OCR_DPI / 72.0
    index = {}
    for i in range(min(n, _MAX_OCR_PAGES)):
        try:
            img = pdf[i].render(scale=scale).to_pil()
            out = {}
            reconstruct_page_text(img, dpi=_OCR_DPI, words_out=out)
            size = out.get("size") or getattr(img, "size", None)
            if not size:
                continue
            W, H = size
            if not W or not H:
                continue
            rows = []
            for row in (out.get("rows") or []):
                r = []
                for wd in row:
                    if len(wd) < 5:
                        continue
                    l, t, w, h, text = wd[0], wd[1], wd[2], wd[3], wd[4]
                    conf = wd[5] if len(wd) > 5 else None
                    if conf is not None and conf < _OCR_CONF_MIN:
                        continue
                    tx = _norm(text)
                    if not tx:
                        continue
                    r.append([round(_clamp01(l / W), 5), round(_clamp01(t / H), 5),
                              round(_clamp01((l + w) / W), 5), round(_clamp01((t + h) / H), 5), tx])
                if r:
                    rows.append(r)
            index[str(i)] = rows
        except Exception:
            continue
    return index


def _get_ocr_index(pdf, n, filepath):
    """Load the per-doc OCR word-box index from the temp cache (keyed by path+mtime+size+dpi), or build
    it once and cache it. The renderer's find is debounced per keystroke, so without this cache every
    keystroke would re-OCR the whole scan. Ephemeral + lossy: a changed file misses the key and re-OCRs."""
    cp = _ocr_cache_path(filepath)
    try:
        with open(cp, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict) and isinstance(data.get("index"), dict):
            return data["index"]
    except Exception:
        pass
    index = _build_ocr_index(pdf, n)
    try:
        with open(cp, "w", encoding="utf-8") as f:
            json.dump({"index": index}, f)
    except Exception:
        pass   # cache is best-effort; a write failure just means the next find re-OCRs
    return index


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--file', required=True)
    ap.add_argument('--query', required=True)
    ap.add_argument('--tesseract', default=None)   # tesseract.exe path for the OCR fallback (dev / packaged)
    a = ap.parse_args()

    out = {"kind": "none", "pages": 0, "matches": []}
    term_raw = (a.query or "").strip()
    if not term_raw:
        sys.stdout.write(json.dumps(out)); return

    try:
        pdf = pdfium.PdfDocument(_win_long_path(a.file))
        n = len(pdf)
        out["pages"] = n

        # 1) BORN-DIGITAL text layer. Also learn whether ANY page carries text — a pure scan has none,
        #    and only then do we OCR (an authoritative text layer is never second-guessed).
        matches, any_text = [], False
        for i in range(min(n, _MAX_PAGES)):
            try:
                page = pdf[i]
                tp = page.get_textpage()
                try:
                    try:
                        if tp.count_chars() > 0:
                            any_text = True
                    except Exception:
                        pass
                    w, h = page.get_size()
                    for box in _textpage_matches(tp, w, h, term_raw):
                        box["page"] = i
                        matches.append(box)
                finally:
                    tp.close()
            except Exception:
                continue
            if len(matches) >= _MAX_MATCHES:
                break

        if matches:
            matches.sort(key=lambda m: (m["page"], m["y0"], m["x0"]))
            out["kind"] = "pdf"; out["matches"] = matches[:_MAX_MATCHES]
            sys.stdout.write(json.dumps(out)); return
        if any_text:
            # Born-digital, term simply absent — do NOT OCR (keeps the text layer authoritative + cheap).
            out["kind"] = "pdf"
            sys.stdout.write(json.dumps(out)); return

        # 2) PURE SCAN → OCR word-box fallback (display-only).
        if a.tesseract:
            try:
                from ocr.tesseract import configure
                configure(a.tesseract)
            except Exception:
                pass
        index = _get_ocr_index(pdf, n, a.file)
        oc = []
        term = _norm(term_raw)
        for i in range(min(n, _MAX_OCR_PAGES)):
            for box in _match_rows(index.get(str(i)) or [], term):
                box["page"] = i
                oc.append(box)
            if len(oc) >= _MAX_MATCHES:
                break
        oc.sort(key=lambda m: (m["page"], m["y0"], m["x0"]))
        out["kind"] = "ocr"; out["matches"] = oc[:_MAX_MATCHES]
    except Exception as e:
        out["error"] = str(e)
    sys.stdout.write(json.dumps(out))


if __name__ == '__main__':
    main()
