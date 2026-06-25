#!/usr/bin/env python3
"""
ocr/segmentation.py
-------------------
Batch document SEPARATION (Stage 1). Decides where a multi-page PDF should be CUT into
separate documents, so a stack of distinct documents generated/scanned into ONE file
(e.g. ten Print Tracker alerts, one per page) is filed as ten documents instead of one.

CONSERVATIVE first-page rule: page 0 always starts document 1; a LATER page starts a NEW
document only when it independently presents a known template's FIRST-PAGE signature — a
logo+keyword-fingerprint match whose keyword OVERLAP with that template clears a floor.

Why the fingerprint floor (not a bare logo match): identify_template short-circuits on the
LOGO alone (method 'logo'), and a multi-page invoice often repeats its letterhead logo on
every page. A continuation page carries that logo but NOT the first page's keyword
fingerprint (Invoice / Bill To / Total …), so requiring fingerprint overlap keeps a normal
multi-page invoice as ONE document while still splitting a batch of independent first pages.

Fails SAFE: any uncertainty / missing fingerprint / error → ONE segment (today's behaviour),
so a missed cut is never worse than now; only a confident multi-first-page batch is split.

segment_pages() is the pure boundary logic (unit-tested without OCR). detect_segments()
adds per-page rendering + the template match.
"""

from __future__ import annotations

# Default keyword-fingerprint overlap a later page must share with the template it matched
# to count as an independent FIRST page. 0.5 = at least half the template's signature words
# present on the page — high enough that an invoice's continuation pages (line items only)
# don't trip it, low enough that a real first page of a known layout does.
FIRST_PAGE_FP_FLOOR = 0.5


def segment_pages(first_page_flags: list[bool]) -> list[tuple[int, int]]:
    """Pure boundary logic. Given a per-page 'is this an independent first page?' flag,
    return inclusive 0-based (start, end) page-range segments.

    Page 0 always starts segment 1; each later True starts a new segment; a False page
    attaches to the current segment. So [True, False, False] (a 3-page invoice) → ONE
    segment, while [True, True, True] (three independent pages) → THREE segments."""
    n = len(first_page_flags)
    if n == 0:
        return []
    boundaries = [0] + [i for i in range(1, n) if first_page_flags[i]]
    segments: list[tuple[int, int]] = []
    for k, start in enumerate(boundaries):
        end = (boundaries[k + 1] - 1) if k + 1 < len(boundaries) else n - 1
        segments.append((start, end))
    return segments


def fingerprint_overlap(page_words, template_words) -> float:
    """Fraction of the TEMPLATE's keyword-fingerprint words present on this page
    (case-insensitive). 0.0 when the template has no fingerprint (→ never flags a
    boundary, the safe default)."""
    tset = {str(w).lower() for w in (template_words or []) if w}
    if not tset:
        return 0.0
    pset = {str(w).lower() for w in (page_words or []) if w}
    return len(tset & pset) / len(tset)


# Generic FIRST-PAGE header markers — the addressing + numbering + dating block (or an
# email header) that CLUSTERS on a document's opening page and is absent from a
# continuation page (line items only). Used to detect the start of a NEW document of an
# UNKNOWN type (no learned template), e.g. a City Office invoice appended after a batch of
# Print Tracker alerts, WITHOUT over-splitting a normal multi-page invoice (whose pages 2+
# carry no "Invoice To" addressing block).
_RECIPIENT_MARKERS = ("invoice to", "bill to", "billed to", "sold to", "ship to", "deliver to")
_NUMBER_MARKERS    = ("invoice no", "invoice number", "order no", "order number",
                      "po number", "purchase order", "account no", "statement no")
_DATE_MARKERS      = ("invoice date", "order date", "statement date", "due date")
_EMAIL_MARKERS     = ("from:", "sent:", "subject:")


def is_document_start(text: str) -> bool:
    """Heuristic: does this page BEGIN a new generic business document (invoice / order /
    statement / email), independent of any learned template? Conservative — fires only on
    a full email header (From+Sent+Subject) OR the first-page ADDRESSING block plus a
    number/date, which a continuation page (line items only) doesn't carry. Lets a trailing
    invoice in an alert batch start its own document without splitting a multi-page invoice."""
    low = (text or "").lower()
    if sum(m in low for m in _EMAIL_MARKERS) >= 3:
        return True
    has_recipient   = any(m in low for m in _RECIPIENT_MARKERS)
    has_num_or_date = any(m in low for m in _NUMBER_MARKERS) or any(m in low for m in _DATE_MARKERS)
    return has_recipient and has_num_or_date


def decide_boundary(matched_id, current_id, fp_overlap: float, doc_start: bool,
                    fp_floor: float = FIRST_PAGE_FP_FLOOR) -> bool:
    """Whether a (non-first) page starts a NEW document. True when ANY holds:
      (a) FIRST-PAGE SIGNATURE — it matches a known template AND its keyword overlap with
          that template clears the floor (a known layout's opening page);
      (b) IDENTITY CHANGE — it matches a DIFFERENT known template than the current document
          (a new KNOWN doc type starts mid-file);
      (c) GENERIC DOC-START — it carries a new document's header cluster (is_document_start),
          catching a new UNKNOWN-type document with no learned template.
    A continuation page (no match, no header cluster) satisfies none → stays attached, so a
    real multi-page invoice is never split."""
    first_signature = matched_id is not None and fp_overlap >= fp_floor
    identity_change = matched_id is not None and matched_id != current_id
    return bool(first_signature or identity_change or doc_start)


def page_is_first(page_text: str, page_image, templates: list,
                  fp_floor: float = FIRST_PAGE_FP_FLOOR) -> tuple[bool, dict]:
    """Decide whether a single (non-first) page independently looks like a known
    template's FIRST page. Returns (is_first, info). Conservative: requires BOTH a
    template match AND fingerprint overlap ≥ fp_floor, so a logo-only continuation page
    is not mistaken for a new document."""
    from extraction.template_matcher import identify_template, extract_keyword_fingerprint
    match = identify_template(page_image, page_text or "", templates)
    if not match:
        return False, {"reason": "no template match"}
    tmpl = match.get("template") or {}
    overlap = fingerprint_overlap(extract_keyword_fingerprint(page_text or ""),
                                  tmpl.get("keyword_fingerprint"))
    ok = overlap >= fp_floor
    return ok, {
        "reason": "first-page fingerprint" if ok else "logo-only (continuation)",
        "confidence": match.get("confidence"),
        "fp_overlap": round(overlap, 2),
        "template_id": tmpl.get("id"),
    }


def detect_segments(pdf_path: str, templates: list, tesseract_path: str | None = None,
                    born_digital: bool = True, fp_floor: float = FIRST_PAGE_FP_FLOOR) -> dict:
    """Render each page of `pdf_path`, decide which pages are independent first pages, and
    return {page_count, segments, first_pages, reasons}. A non-PDF, a single-page PDF, no
    templates, or any error → a single whole-document segment (no split)."""
    import os
    result_single = {"page_count": 1, "segments": [[0, 0]], "first_pages": [0], "reasons": ["whole document"]}
    if not templates or not str(pdf_path).lower().endswith(".pdf") or not os.path.isfile(pdf_path):
        return result_single

    try:
        import pypdfium2 as pdfium
    except Exception:
        return result_single

    try:
        doc = pdfium.PdfDocument(str(pdf_path))
        n = len(doc)
    except Exception:
        return result_single
    if n < 2:
        return {"page_count": n or 1, "segments": [[0, max(0, n - 1)]], "first_pages": [0], "reasons": ["single page"]}

    if tesseract_path:
        try:
            import pytesseract
            pytesseract.pytesseract.tesseract_cmd = tesseract_path
        except Exception:
            pass

    from extraction.template_matcher import identify_template, extract_keyword_fingerprint

    # Per-page signals: (matched template id | None, fingerprint overlap, doc-start flag).
    signals: list[tuple] = []
    for i in range(n):
        page = doc[i]
        # Low-DPI render is enough for logo hashing + a fingerprint read, and keeps the
        # pre-pass cheap (this is NOT the extraction OCR — process_docs re-reads each
        # segment at full quality afterwards).
        try:
            img = page.render(scale=150 / 72).to_pil()
        except Exception:
            img = None
        text = _page_text(page, img, born_digital, tesseract_path)
        match = identify_template(img, text or "", templates)
        tmpl = (match or {}).get("template") or {}
        mid = tmpl.get("id") if match else None
        overlap = fingerprint_overlap(extract_keyword_fingerprint(text or ""),
                                      tmpl.get("keyword_fingerprint")) if match else 0.0
        signals.append((mid, overlap, is_document_start(text)))

    # Walk the pages, tracking the CURRENT document's identity so a different known type
    # OR a generic new-document header starts a fresh segment.
    flags: list[bool] = [True]            # page 0 always starts document 1
    reasons: list[str] = ["document start"]
    current_id = signals[0][0]
    for i in range(1, n):
        mid, overlap, ds = signals[i]
        boundary = decide_boundary(mid, current_id, overlap, ds, fp_floor)
        flags.append(boundary)
        if not boundary:
            reasons.append("continuation")
        elif mid is not None and overlap >= fp_floor and mid == current_id:
            reasons.append("first-page fingerprint")
        elif mid is not None and mid != current_id:
            reasons.append("different template")
        else:
            reasons.append("document-start header")
        if boundary:
            current_id = mid

    segments = segment_pages(flags)
    return {
        "page_count": n,
        "segments": [[s, e] for (s, e) in segments],
        "first_pages": [i for i, f in enumerate(flags) if f],
        "reasons": reasons,
    }


def _page_text(page, img, born_digital: bool, tesseract_path: str | None) -> str:
    """Per-page text for the fingerprint: the embedded text layer when present (cheap,
    exact — the born-digital case like a Print Tracker batch), else a light OCR when a
    Tesseract path is available, else '' (→ the page can't be a confident boundary)."""
    if born_digital:
        try:
            from ocr import born_digital as _bd
            if _bd.assess_page(page)[0]:
                return _bd.page_text(page)
        except Exception:
            pass
    if tesseract_path and img is not None:
        try:
            import pytesseract
            return pytesseract.image_to_string(img)
        except Exception:
            return ""
    return ""
