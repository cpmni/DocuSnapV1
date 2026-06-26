"""Minimal, dependency-free PDF writer that produces a REAL selectable text layer.

Used for the 100 text-based control docs. Uses the base-14 Helvetica font (no font
embedding needed), which pypdfium2 — the project's own reader — extracts cleanly, so
the OCR & Detection agent's born-digital path reads exact text from these.

We also return per-string bounding boxes (PDF points, top-left origin to match the
raster docs) using the Helvetica AFM advance-width table, so ground truth carries
field bboxes for the control set too.
"""
from __future__ import annotations

# Helvetica AFM advance widths (1/1000 em) for ASCII 32..126. Enough for English text.
_HELV_W = [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
]


def text_width(s: str, size: float) -> float:
    """Width of `s` at `size` pt in Helvetica (points)."""
    total = 0
    for ch in s:
        o = ord(ch)
        w = _HELV_W[o - 32] if 32 <= o <= 126 else 556
        total += w
    return total * size / 1000.0


def _esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


class TextPdf:
    """Accumulate page lines, then write a valid single/multi-page PDF.

    add_line(page, x, y_top, text, size) places `text` at top-left (x, y_top) in a
    top-left pixel/point space (y grows DOWN, like PIL). Returns the [x, y_top, w, h]
    bbox in that same space so ground truth matches the raster convention.
    """
    def __init__(self, width=595, height=842):     # A4 in PDF points (72 dpi)
        self.w, self.h = width, height
        self.pages: list[list[tuple]] = [[]]       # each page: list of (x, y_top, text, size)

    def new_page(self):
        self.pages.append([])
        return len(self.pages) - 1

    def add_line(self, page, x, y_top, text, size=11):
        while page >= len(self.pages):
            self.new_page()
        self.pages[page].append((x, y_top, text, size))
        return [round(x, 1), round(y_top, 1), round(text_width(text, size), 1), round(size * 1.2, 1)]

    def _content_stream(self, page_lines) -> bytes:
        parts = ["BT"]
        for (x, y_top, text, size) in page_lines:
            y_pdf = self.h - y_top - size        # baseline (points, bottom-left origin)
            parts.append(f"/F1 {size:.1f} Tf 1 0 0 1 {x:.1f} {y_pdf:.1f} Tm")
            parts.append(f"({_esc(text)}) Tj")
        parts.append("ET")
        return ("\n".join(parts)).encode("latin-1", "replace")

    def write(self, path: str):
        objs: list[bytes] = []

        def add(obj: bytes) -> int:
            objs.append(obj)
            return len(objs)                      # 1-based object number

        font_id = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica "
                      b"/Encoding /WinAnsiEncoding >>")
        page_ids, content_ids = [], []
        # Build content + page objects first, then Pages, then Catalog. The Pages
        # object number is known ahead of time (font + N content + N page objects).
        for pl in self.pages:
            stream = self._content_stream(pl)
            cid = add(b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream))
            content_ids.append(cid)
        pages_obj_num = len(objs) + len(self.pages) + 1       # after we add the page objs
        for cid in content_ids:
            pid = add(
                ("<< /Type /Page /Parent %d 0 R /MediaBox [0 0 %d %d] "
                 "/Resources << /Font << /F1 %d 0 R >> >> /Contents %d 0 R >>"
                 % (pages_obj_num, self.w, self.h, font_id, cid)).encode())
            page_ids.append(pid)
        kids = " ".join(f"{p} 0 R" for p in page_ids)
        pages_id = add(("<< /Type /Pages /Count %d /Kids [%s] >>"
                        % (len(page_ids), kids)).encode())
        catalog_id = add(("<< /Type /Catalog /Pages %d 0 R >>" % pages_id).encode())

        # Serialise with a correct xref table.
        out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        offsets = [0] * (len(objs) + 1)
        for i, obj in enumerate(objs, start=1):
            offsets[i] = len(out)
            out += ("%d 0 obj\n" % i).encode() + obj + b"\nendobj\n"
        xref_pos = len(out)
        out += ("xref\n0 %d\n" % (len(objs) + 1)).encode()
        out += b"0000000000 65535 f \n"
        for i in range(1, len(objs) + 1):
            out += ("%010d 00000 n \n" % offsets[i]).encode()
        out += ("trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n"
                % (len(objs) + 1, catalog_id, xref_pos)).encode()
        with open(path, "wb") as fh:
            fh.write(out)
        return path
