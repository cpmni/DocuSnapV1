"""
ocr/slip_detect.py — Filing Slips ("Separator sheets") page detection.

Scans every page of a batch PDF for a printed ScanFinder separator sheet, identified by a
QR code whose payload matches the SFSEP namespace (e.g. "SFSEP-0007"). Slip pages define
split boundaries AND are excluded from the split output (pdf_splitter range groups already
skip unlisted pages). Design + Oracle conditions: docs/designs/FILING_SLIPS_2026-07-18.md.

Contract (consumed by segment_docs.py --slips):
  detect_slips(pdf_path) -> {
      "page_count": int,
      "separator_pages": [0-based page indices],       # [] when aborted
      "separator_payloads": ["SFSEP-0007", ...],       # parallel to separator_pages
      "aborted": None | "reason",
  }
  aborted set  => the caller MUST ignore separator_pages and fall through to the
  template-based detector (a PARTIAL slip map would split WRONG — whole-file scan or
  nothing; any per-page failure aborts the entire detection).

  segments_excluding(page_count, separator_pages) -> [[start, end], ...]
  0-based inclusive segments of the non-slip pages (consecutive runs). Only-slips -> [].

The decode IS the decision: a QR survives skew/rotation/mirroring by construction, and its
Reed-Solomon checksum makes a false decode practically impossible; the anchored namespace
regex firewalls third-party QRs (payment/marketing codes) printed inside real documents.
The printed number on the sheet is the HUMAN handle — deliberately NOT cross-checked here
(an AND-gate would let a failed digit-OCR veto a good decode; see the design doc).

Imports are lazy + fail-safe: a missing decoder wheel aborts detection (recorded in the
caller's `reasons`, visible in the dev-inspector trace) rather than crashing segment_docs.
"""

import re

# Encoder emits SFSEP-%04d (filing_slips.py, slice 2); the decoder accepts 1-6 digits so
# already-printed packs never go stale if the counter ever widens.
SLIP_PAYLOAD_RE = re.compile(r"^SFSEP-\d{1,6}$")

# Anomaly cap: a pathological page count skips slip detection for the file entirely
# (abort, never a partial scan).
MAX_PAGES = 500

# Detection render scale — ~150 DPI, matching the existing separation pre-pass render
# (ocr/segmentation.py). The 90 mm sheet QR yields ~21 px/module here, ~5x the decode floor.
RENDER_SCALE = 150 / 72


def detect_slips(pdf_path, max_pages=MAX_PAGES):
    """Scan every page of `pdf_path` for separator-sheet QR codes. Never raises."""
    result = {"page_count": 0, "separator_pages": [], "separator_payloads": [], "aborted": None}

    def aborted(reason):
        result["separator_pages"] = []
        result["separator_payloads"] = []
        result["aborted"] = str(reason)
        return result

    try:
        import zxingcpp
    except Exception as exc:
        return aborted(f"slip decoder unavailable: {exc}")
    try:
        import pypdfium2 as pdfium
    except Exception as exc:
        return aborted(f"pdf renderer unavailable: {exc}")

    try:
        doc = pdfium.PdfDocument(str(pdf_path))
        n = len(doc)
    except Exception as exc:
        return aborted(f"could not open pdf: {exc}")
    result["page_count"] = n
    if n > max_pages:
        return aborted(f"page count {n} exceeds slip-scan cap {max_pages}")

    try:
        qr_only = getattr(getattr(zxingcpp, "BarcodeFormat", None), "QRCode", None)
        for i in range(n):
            img = doc[i].render(scale=RENDER_SCALE).to_pil()
            hits = zxingcpp.read_barcodes(img, formats=qr_only) if qr_only is not None \
                else zxingcpp.read_barcodes(img)
            payload = None
            for r in hits:
                text = getattr(r, "text", "") or ""
                if getattr(r, "valid", True) and SLIP_PAYLOAD_RE.fullmatch(text):
                    payload = text
                    break
            if payload is not None:
                result["separator_pages"].append(i)
                result["separator_payloads"].append(payload)
    except Exception as exc:
        # Whole-file or nothing: a partial slip map would split in the wrong places.
        return aborted(f"slip scan failed on page: {exc}")
    return result


def segments_excluding(page_count, separator_pages):
    """Pure: consecutive runs of non-slip pages as 0-based inclusive [start, end] segments."""
    seps = set(separator_pages or [])
    segments = []
    start = None
    for i in range(int(page_count or 0)):
        if i in seps:
            if start is not None:
                segments.append([start, i - 1])
                start = None
        elif start is None:
            start = i
    if start is not None:
        segments.append([start, page_count - 1])
    return segments
