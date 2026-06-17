"""
born_digital.py — read text + word boxes straight from a PDF's embedded text
layer (pypdfium2 — BSD-3-Clause binding, PDFium engine BSD-3-Clause/Apache-2.0),
skipping OCR for pages that carry real vector text (generated invoices,
statements). Exact and faster than OCR for those; INERT for image-only/scanned
PDFs (no text layer), where the caller falls back to the existing OCR path.

Detection keys on GLYPH COUNT, not area coverage: a full born-digital page still
covers only a few percent of its area with ink, so coverage is a poor signal —
char count cleanly separates a real text layer (hundreds of glyphs) from an
image-only page (zero). A hybrid/garbage layer (broken ToUnicode, a junk OCR
layer) is rejected by a minimum alphanumeric ratio.

Coordinates: PDFium text boxes are POINTS with a BOTTOM-LEFT origin; we map them
to the project's TOP-LEFT page-normalised space (x/y/w/h in [0,1], y-flipped) —
the SAME space anchors / landmarks / template_mapper._ocr_lines already use, so
page_lines() output is drop-in compatible with the OCR line path.

Gated by the 'born_digital_enabled' setting (default ON); see process_docs.
"""

_MIN_CHARS       = 40     # a page with >= this many real glyphs is born-digital
_MIN_ALPHA_RATIO = 0.30   # hybrid/garbage guard: a real layer is mostly alnum
_WORD_GAP_NORM   = 0.010  # x-gap (page-norm) that breaks one word from the next
_LINE_TOL_NORM   = 0.006  # y-centre tolerance (page-norm) for grouping a line


def _textpage(page):
    try:
        return page.get_textpage()
    except Exception:
        return None


def assess_page(page):
    """(is_born_digital, char_count, full_text) for one pypdfium2 page. Cheap — no
    rendering. A scanned/image page returns (False, 0, '')."""
    tp = _textpage(page)
    if tp is None:
        return (False, 0, "")
    try:
        n = tp.count_chars()
    except Exception:
        return (False, 0, "")
    if n < _MIN_CHARS:
        return (False, n, "")
    try:
        text = tp.get_text_range(0, n)
    except Exception:
        return (False, n, "")
    printable = [c for c in (text or "") if not c.isspace()]
    if printable:
        alpha = sum(c.isalnum() for c in printable) / len(printable)
        if alpha < _MIN_ALPHA_RATIO:
            return (False, n, "")   # junk/garbled layer -> treat as scanned
    return (True, n, text or "")


def page_text(page):
    """Full page text in VISUAL reading order (top→bottom, left→right),
    reconstructed from page_lines. The embedded layer's RAW char order
    (get_text_range) can be arbitrary — the order glyphs were added to the PDF —
    which scrambles label-adjacency keyword extraction; positional order matches
    what OCR produces, so the existing keyword/anchor pipeline behaves the same."""
    return "\n".join(ln["text"] for ln in page_lines(page))


def page_lines(page):
    """Text-layer lines with per-word boxes in TOP-LEFT page-normalised coords —
    the SAME shape template_mapper._ocr_lines emits, so the anchor locate/harvest
    can use it interchangeably. Returns [] when the page carries no usable text."""
    tp = _textpage(page)
    if tp is None:
        return []
    try:
        n = tp.count_chars()
        if n < 1:
            return []
        w_pt, h_pt = page.get_size()
    except Exception:
        return []
    if not w_pt or not h_pt:
        return []

    # 1) Build words: walk chars, break on whitespace, a large x-gap, or a new row.
    words = []
    cur = None
    prev_r = None
    for i in range(n):
        try:
            ch = tp.get_text_range(i, 1)
            l, b, r, t = tp.get_charbox(i)
        except Exception:
            continue
        x1 = l / w_pt; x2 = r / w_pt
        y1 = 1.0 - (t / h_pt); y2 = 1.0 - (b / h_pt)
        if ch is None or ch == "" or ch.isspace():
            if cur:
                words.append(cur); cur = None
            prev_r = None
            continue
        gap = (x1 - prev_r) if prev_r is not None else 0.0
        if cur is None or gap > _WORD_GAP_NORM or abs(y1 - cur["y1"]) > _LINE_TOL_NORM:
            if cur:
                words.append(cur)
            cur = {"text": ch, "x1": x1, "y1": y1, "x2": x2, "y2": y2}
        else:
            cur["text"] += ch
            cur["x2"] = max(cur["x2"], x2)
            cur["y1"] = min(cur["y1"], y1)
            cur["y2"] = max(cur["y2"], y2)
        prev_r = x2
    if cur:
        words.append(cur)

    # 2) Group words into lines by y-centre proximity, left→right within a line.
    grouped = []
    for wd in sorted(words, key=lambda w: (round((w["y1"] + w["y2"]) / 2.0, 3), w["x1"])):
        cy = (wd["y1"] + wd["y2"]) / 2.0
        ln = grouped[-1] if grouped else None
        if ln and abs(cy - ln["_cy"]) <= _LINE_TOL_NORM:
            ln["_words"].append(wd)
        else:
            grouped.append({"_cy": cy, "_words": [wd]})

    out = []
    for ln in grouped:
        ws = sorted(ln["_words"], key=lambda w: w["x1"])
        x1 = min(w["x1"] for w in ws); x2 = max(w["x2"] for w in ws)
        y1 = min(w["y1"] for w in ws); y2 = max(w["y2"] for w in ws)
        out.append({
            "text":   " ".join(w["text"] for w in ws),
            "x_norm": x1, "y_norm": y1, "w_norm": x2 - x1, "h_norm": y2 - y1,
            "words": [{"text": w["text"], "x_norm": w["x1"], "y_norm": w["y1"],
                       "w_norm": w["x2"] - w["x1"], "h_norm": w["y2"] - w["y1"]} for w in ws],
        })
    return out
