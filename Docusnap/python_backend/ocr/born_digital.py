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


# Punctuation the embedded text layer often emits as its OWN word — a comma/period
# hangs on a different baseline or sits a kerning-gap away from its digit, so the
# word-builder below splits it off. A naive space-join then renders "March 6 , 2026"
# / "42 . 35", which breaks the date/amount validation patterns AND parse_date (and
# made the keyword stage silently skip the field). _join_words glues such tokens back
# to their neighbour so the reconstructed line matches what a human reads. It only
# changes SPACING, never which characters are present, and is reusable for every
# born-digital field/supplier — no document-specific logic.
_ATTACH_PUNCT = set(',.;:!?)]}%')

# A gap this many median glyph-HEIGHTS wide (or the norm floor) is an inter-COLUMN break,
# not a word space — a true column gap spans several text-heights; a normal inter-word space
# is a fraction of one. Tying it to height keeps it zoom-invariant. Mirrors the OCR path
# (reconstruct_page_text / cluster_value_words) so born-digital columns split the SAME way
# scanned ones do.
_COLUMN_GAP_MULT  = 4.0    # a column gap is MANY glyph-heights; keep this well above a wide
_COLUMN_GAP_FLOOR = 0.07   # value space ("# 2371") so only a true inter-column gap (~0.14+) trips

def _join_words(words):
    if not words:
        return ""
    # Median word height → a zoom-invariant column-gap threshold. Without a column break a
    # multi-column row ("BILL FROM value …big gap… BILL TO value") joins into one string, so a
    # keyword read of that line grabs BOTH columns (the merged-supplier "Profile Construction
    # ACME Inc" bug). Emit 4 spaces at a column-wide gap so keyword.py's existing `{4,}`-space
    # column guard takes only the value's own column — reusable for every born-digital field.
    heights = sorted((w.get("y2", 0.0) - w.get("y1", 0.0)) for w in words)
    med_h   = heights[len(heights) // 2] if heights else 0.0
    col_gap = max(med_h * _COLUMN_GAP_MULT, _COLUMN_GAP_FLOOR)
    out  = words[0].get("text", "")
    prev = words[0]
    for w in words[1:]:
        t = w.get("text", "")
        # (1) a leading attaching-punctuation token glues to the previous word
        #     ("6"+","->"6,", "42"+"."->"42.")
        glue = bool(t) and t[0] in _ATTACH_PUNCT
        # (2) a digit token continues a number after a decimal point ("42."+"35"->
        #     "42.35"); a DATE comma ("6,"+"2026") is NOT glued, so it keeps its space.
        if not glue and out[-1:] == '.' and len(out) >= 2 and out[-2].isdigit() and t[:1].isdigit():
            glue = True
        if glue:
            out += t
        else:
            gap  = w.get("x1", 0.0) - prev.get("x2", 0.0)
            out += ("    " if gap > col_gap else " ") + t   # 4 spaces = a column break
        prev = w
    return out


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

    # 2) Group words into lines — TWO PASS (mirrors ocr.tesseract._group_words_into_lines, oscar).
    # A single greedy pass (join the LAST line if within tol) assigns a word to whichever row was
    # VISITED first, so on a 3-column header whose columns are NOT row-aligned a value between two
    # rows glues to the row above (a value at cy 0.385 joins "BILLING ADDRESS" at 0.379, Δ0.006 <
    # tol) instead of its own "INVOICE NUMBER" row at 0.386 (Δ0.001) which is SEEDED LATER — so the
    # label read empty and keyword extraction grabbed the wrong column ("ACME"). PASS 1 discovers the
    # line-anchor SET with the SAME within-tol eligibility as the old single pass (→ identical rows,
    # no regression by construction); PASS 2 assigns EVERY word to its NEAREST anchor line (removes
    # the visit-order bias), so the value re-homes to its own label's row. y-centre-relative.
    _sw = sorted(words, key=lambda w: ((w["y1"] + w["y2"]) / 2.0, w["x1"]))
    _anchors = []
    for wd in _sw:
        cy = (wd["y1"] + wd["y2"]) / 2.0
        if not any(abs(cy - a) <= _LINE_TOL_NORM for a in _anchors):
            _anchors.append(cy)
    grouped = [{"_cy": a, "_words": []} for a in _anchors]
    for wd in _sw:
        cy = (wd["y1"] + wd["y2"]) / 2.0
        best = min(grouped, key=lambda g: abs(cy - g["_cy"])) if grouped else None
        if best is not None and abs(cy - best["_cy"]) <= _LINE_TOL_NORM:
            best["_words"].append(wd)
        else:                                           # no anchor within tol (rounding) — never lose a word
            grouped.append({"_cy": cy, "_words": [wd]})
    grouped = [g for g in grouped if g["_words"]]
    grouped.sort(key=lambda g: g["_cy"])

    out = []
    for ln in grouped:
        ws = sorted(ln["_words"], key=lambda w: w["x1"])
        x1 = min(w["x1"] for w in ws); x2 = max(w["x2"] for w in ws)
        y1 = min(w["y1"] for w in ws); y2 = max(w["y2"] for w in ws)
        out.append({
            "text":   _join_words(ws),
            "x_norm": x1, "y_norm": y1, "w_norm": x2 - x1, "h_norm": y2 - y1,
            "words": [{"text": w["text"], "x_norm": w["x1"], "y_norm": w["y1"],
                       "w_norm": w["x2"] - w["x1"], "h_norm": w["y2"] - w["y1"]} for w in ws],
        })
    return out
