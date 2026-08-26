"""
ocr/barcodes.py — page BARCODE INVENTORY (owner 2026-08-26: "I don't think we currently have the
option for a barcode field"; barry → gary design, slice A).

Decodes every 1D/2D symbol on the page images the OCR pass ALREADY rendered (no second render,
no OCR), using the vendored `zxingcpp` (Apache-2.0 — the same decoder the separator-sheet QR
detector uses, `ocr/slip_detect.py`). One call per page; the result is a plain list the engine
threads to a `barcode`-typed field (slice B) and `process_docs.py` emits as `barcodes` metadata
(slice A) for the `document_barcodes` table + full-text search.

Contract:
  decode_pages(page_images, formats=None) -> [
      {"page": int, "symbology": "Code128", "value": "INV-20260826",
       "x_norm": .., "y_norm": .., "w_norm": .., "h_norm": ..,      # bbox of the 4 corners / page size
       "orientation": int, "content_type": "Text"}, ...]
  • NEVER raises — a missing decoder / a bad page / a bad symbol yields nothing for that unit.
  • Separator-sheet payloads (SFSEP-nnnn, `slip_detect.SLIP_PAYLOAD_RE`) are EXCLUDED: they are
    the app's own cut marks, never a document's data.
  • Invalid decodes (checksum/EC failure, `Barcode.valid == False`) are dropped — a barcode is
    right or absent; there is no "87% barcode".
  • Deduped (page, symbology, value) first-seen; capped MAX_PER_PAGE per page (a label sheet of
    200 identical codes must not flood the table).

Frame: `page_images` are the post-rotate/deskew renders at the OCR render DPI (the anchor-crop
frame), so the normalised boxes land in the SAME frame as field-anchor norms. zxing-cpp's 1D
decoders want >= ~1.5-2 px per module; at the app's 200 DPI a 0.25-0.33 mm X-dimension is
2.0-2.6 px — at/above floor (try_downscale handles oversize; try_rotate handles vertical bars).

Kill: the callers gate on BARCODE_INVENTORY / BARCODE_FIELD — this module is inert unless called.
"""

import re

# Mirror of ocr/slip_detect.SLIP_PAYLOAD_RE (kept local so a slip_detect import failure can never
# take the inventory down with it; the two are pinned equal in tests/test_barcode_decode.py).
SLIP_PAYLOAD_RE = re.compile(r"^SFSEP-\d{1,6}$")

MAX_PER_PAGE = 50

# A decoded payload that can stand as a FIELD VALUE (slice B): a printable code — never a URL,
# vCard, WiFi config or binary. Same character family as the ref-role code fields.
CODE_LIKE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._/\-]{2,63}$")


def is_code_like(value) -> bool:
    s = str(value or "").strip()
    return bool(s) and bool(CODE_LIKE_RE.match(s)) and "://" not in s


def _enum_name(v):
    try:
        return str(v.name)
    except Exception:
        return str(v).split(".")[-1]


def decode_pages(page_images, formats=None):
    """Decode every symbol on every page image. Never raises; [] when nothing decodes."""
    out = []
    if not page_images:
        return out
    try:
        import zxingcpp
    except Exception:
        return out
    for page_idx, img in enumerate(page_images):
        try:
            w, h = img.size
            if not w or not h:
                continue
            kwargs = {}
            if formats is not None:
                kwargs["formats"] = formats
            found = zxingcpp.read_barcodes(img, **kwargs) or []
        except Exception:
            continue
        seen = set()
        n_page = 0
        for b in found:
            try:
                if not getattr(b, "valid", False):
                    continue
                text = str(getattr(b, "text", "") or "").strip()
                if not text or SLIP_PAYLOAD_RE.match(text):
                    continue
                sym = _enum_name(getattr(b, "format", ""))
                key = (page_idx, sym, text)
                if key in seen:
                    continue
                seen.add(key)
                p = b.position
                xs = [p.top_left.x, p.top_right.x, p.bottom_left.x, p.bottom_right.x]
                ys = [p.top_left.y, p.top_right.y, p.bottom_left.y, p.bottom_right.y]
                x0, x1 = max(0, min(xs)), min(w, max(xs))
                y0, y1 = max(0, min(ys)), min(h, max(ys))
                out.append({
                    "page": page_idx,
                    "symbology": sym,
                    "value": text,
                    "x_norm": round(x0 / w, 4), "y_norm": round(y0 / h, 4),
                    "w_norm": round(max(0, x1 - x0) / w, 4), "h_norm": round(max(0, y1 - y0) / h, 4),
                    "orientation": int(getattr(b, "orientation", 0) or 0),
                    "content_type": _enum_name(getattr(b, "content_type", "")),
                })
                n_page += 1
                if n_page >= MAX_PER_PAGE:
                    break
            except Exception:
                continue
    return out


def candidates_for_field(barcodes):
    """Slice B: the DISTINCT code-like payloads a barcode-typed field may take (SFSEP already
    excluded by decode_pages). Order = page, then reading order as decoded."""
    vals, seen = [], set()
    for b in (barcodes or []):
        v = str((b or {}).get("value") or "").strip()
        if not v or not is_code_like(v) or v in seen:
            continue
        seen.add(v)
        vals.append(v)
    return vals
