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

import re

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


# ── SELF-DECLARED CONTINUATION VETO (2026-09-16; Oracle (B) slice 1, DARK `segment_continuation_veto`) ────────
# The first-page signature is "a known template matches AND the keyword-fingerprint overlap clears the floor" —
# but the fingerprint IS the letterhead words, and a real continuation page (logo + name + address repeated,
# line items below) reproduces it (measured: 6/6 repeat-letterhead 2-page controls cut at page 2 —
# TESTING/_measure/watch_separate_soak_20260916/controls). On a manual import that is a SILENT TRUNCATION: page 1
# files as a one-page document, page 2 becomes an orphan. A page that DECLARES ITSELF a continuation is never a
# boundary, whatever the template/overlap/doc-start legs say:
#   • "Page n of N" / "Page n/N" / "Page n" with n >= 2 — anywhere on the page (a page number describes the page it
#     is printed on; "Page 1 of 2" never suppresses);
#   • "continued" / "(cont.)" / "continuation" — in the TOP band only and never "continued on …" (that footer sits
#     on the page BEFORE the continuation);
#   • "brought forward" / "B/F" — in the top band (the balance carried in from the previous page; "carried forward"
#     is deliberately EXCLUDED — it marks the page before).
# Page 0 is never affected (always document 1). OCR failure direction: a garbled marker = today's behaviour; a
# first page misread as "Page 2 of 2" = an under-split → a multi-page heuristic cut → the mig-176 belt holds it
# (fail-toward-review). Pure; pinned in tests/test_segmentation.py.
# "Page n of N" / "Page n/N" anywhere EXCEPT as the object of "on"/"see"/"to" ("continued on page 2 of 3" is the
# page BEFORE talking about its successor); the bare "Page n" form only as a page-number LINE of its own.
_PAGE_N_OF_N_RE = re.compile(r"(?<!\bon\s)(?<!\bsee\s)(?<!\bto\s)\bpage\s*(\d{1,3})\s*(?:of|/)\s*(\d{1,3})\b")
_PAGE_N_RE      = re.compile(r"(?m)^\s*page\s+(\d{1,3})\s*$")
_CONT_RE        = re.compile(r"(?<![a-z])(?:continued|continuation|cont\.)(?![a-z])(?!\s+(?:on|overleaf|next|from))")
_BF_RE          = re.compile(r"(?<![a-z])(?:brought\s+forward|b/f)(?![a-z])")
CONTINUATION_TOP_LINES = 12


def is_continuation_page(text: str) -> bool:
    """Does this page DECLARE ITSELF a continuation of the previous one? See the block comment above.
    Pure; never raises; empty/None → False."""
    try:
        low = (text or "").lower()
        if not low.strip():
            return False
        for m in _PAGE_N_OF_N_RE.finditer(low):
            if int(m.group(1)) >= 2:
                return True
        for m in _PAGE_N_RE.finditer(low):
            if int(m.group(1)) >= 2:
                return True
        top = "\n".join([l for l in low.splitlines() if l.strip()][:CONTINUATION_TOP_LINES])
        return bool(_CONT_RE.search(top) or _BF_RE.search(top))
    except Exception:
        return False


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


# ── TITLE-THREADED page match (2026-09-16; gary → Oracle (A) SIGN-OFF-W/COND, DARK `segment_title_slug`) ──────
# The pre-pass used to call identify_template with THREE args — no `detected_slug` / `title_trusted` — so on a
# same-letterhead supplier the sibling tie-break degenerates to the most-confirmed sibling (identical fingerprints
# → a stable-sort tie), and when that sibling's type reliably prints a heading that is absent here, the
# TYPE-PRESENCE VETO refuses it → `{'template': None, 'type_refused': True}` → the page could never be a boundary
# (every missed boundary in the 2026-09-16 templated stacks). The full pipeline threads the page's OWN title
# (TYPE-PRECEDENCE 2026-07-09); this does the same, as a CASCADE that can never lose today's boundary:
#   1. a TRUSTED heading → identify_template(…, slug, True)   (the `matching` branch picks the right sibling)
#   2. any installed slug  → identify_template(…, slug, False)  (the matching branch needs no trust)
#   3. today's 3-arg call                                        (the fallback on None / any type_refused)
# Measured (4-arm per-page census, probe_4arm_stacks.txt): base 72/95 boundaries → cascade 79/95, 0 lost,
# 0 over-splits; real_34 34/34 and the singles unchanged. `title_ctx is None` (the switch OFF) → the 3-arg
# call exactly as before (byte-identical).
def page_match(page_image, text: str, templates: list, title_ctx=None):
    from extraction.template_matcher import identify_template
    if not title_ctx:
        return identify_template(page_image, text or "", templates)
    slug, trusted = None, False
    try:
        from extraction.keyword import title_signal
        slug, trusted = title_signal(text or "", title_ctx.get("patterns"), title_ctx.get("doc_types"))
    except Exception:
        slug, trusted = None, False
    m = None
    if slug and trusted:
        m = identify_template(page_image, text or "", templates, slug, True)
    if slug and not (m or {}).get("template"):
        m = identify_template(page_image, text or "", templates, slug, False)
    if not (m or {}).get("template"):
        m = identify_template(page_image, text or "", templates)
    return m


def detect_segments(pdf_path: str, templates: list, tesseract_path: str | None = None,
                    born_digital: bool = True, fp_floor: float = FIRST_PAGE_FP_FLOOR,
                    title_ctx: dict | None = None, continuation_veto: bool = False) -> dict:
    """Render each page of `pdf_path`, decide which pages are independent first pages, and
    return {page_count, segments, first_pages, reasons}. A non-PDF, a single-page PDF, no
    templates, or any error → a single whole-document segment (no split).
    `title_ctx` = {'patterns', 'doc_types'} threads the page's own title into the match (DARK
    segment_title_slug); `continuation_veto` suppresses a boundary on a self-declared continuation
    page (DARK segment_continuation_veto). Both default OFF → byte-identical."""
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

    from extraction.template_matcher import extract_keyword_fingerprint

    # Per-page signals: (matched template id | None, fingerprint overlap, doc-start flag, self-declared cont.).
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
        match = page_match(img, text or "", templates, title_ctx)
        tmpl = (match or {}).get("template") or {}
        mid = tmpl.get("id") if match else None
        overlap = fingerprint_overlap(extract_keyword_fingerprint(text or ""),
                                      tmpl.get("keyword_fingerprint")) if match else 0.0
        signals.append((mid, overlap, is_document_start(text),
                        bool(continuation_veto and i > 0 and is_continuation_page(text))))

    # Walk the pages, tracking the CURRENT document's identity so a different known type
    # OR a generic new-document header starts a fresh segment.
    flags: list[bool] = [True]            # page 0 always starts document 1
    reasons: list[str] = ["document start"]
    current_id = signals[0][0]
    for i in range(1, n):
        mid, overlap, ds, self_cont = signals[i]
        boundary = decide_boundary(mid, current_id, overlap, ds, fp_floor)
        if boundary and self_cont:
            boundary = False                      # the page says it is a continuation — never a cut
        flags.append(boundary)
        if not boundary:
            reasons.append("self-declared continuation" if self_cont else "continuation")
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
            import os, pytesseract   # S0 (2026-09-09): timeout backstop; guarded → '' on a hung/aborted read.
            return pytesseract.image_to_string(img, timeout=int(os.environ.get('OCR_CALL_TIMEOUT') or 120))
        except Exception:
            return ""
    return ""
