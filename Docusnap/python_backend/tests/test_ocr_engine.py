#!/usr/bin/env python3
"""
tests/test_ocr_engine.py — guards the Stage 1 full-page OCR engine seam (ocr/engine.py
+ ocr.tesseract.extract_text_and_images). Fully HERMETIC: uses a fake engine /
monkeypatched image_to_data, so it needs no real Tesseract.

Full-page OCR is TESSERACT ONLY: get_engine() returns TesseractEngine for any name
(a stale 'rapidocr' from an old setting is tolerated -> Tesseract).

Covers:
  1. selection: default / unknown / 'tesseract' / stale-'rapidocr' -> TesseractEngine
  5. seam: extract_text_and_images routes the full-page read through engine.read_page
  6. default byte-identical: engine=None routes through TesseractEngine -> reconstruct_page_text
  7. born-digital guard: a PDF text layer is used WITHOUT calling the OCR engine
 10. reconstruct_page_text: a far-right value stays on its label's line (+ bold-label banding)
  8. leak-prevention: crop/zone/anchor/landmark modules do NOT import the engine seam

Usage:  py -3.12 python_backend/tests/test_ocr_engine.py
"""

import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

fail = 0


def check(label, cond):
    global fail
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fail += 1
    return cond


try:
    from PIL import Image
    import ocr.tesseract as tess_mod
    from ocr.engine import get_engine, TesseractEngine
except Exception as e:                                   # pragma: no cover
    print(f"  SKIP test_ocr_engine — deps unavailable ({e.__class__.__name__}: {e})")
    sys.exit(0)


def _png(tmpdir, name="p.png"):
    p = Path(tmpdir) / name
    Image.new("RGB", (24, 16), "white").save(p)
    return p


class SpyEngine:
    """Records read_page calls; returns a fixed marker (no real OCR)."""
    name = "spy"
    def __init__(self): self.calls = 0
    def read_page(self, img, enhance_params=None):
        self.calls += 1
        return "SPY"


_orig_recon = tess_mod.reconstruct_page_text

# ── 1. selection: any name -> Tesseract (full-page OCR is Tesseract only) ──────────
for nm in (None, "tesseract", "TESSERACT", "bogus", "rapidocr", ""):
    check(f"get_engine({nm!r}) -> Tesseract", get_engine(nm).name == "tesseract")
check("get_engine ignores stale speed knobs",
      get_engine("rapidocr", use_cls=False, intra_op_num_threads=3).name == "tesseract")

# ── 5. seam: extract_text_and_images routes full-page read through engine ─────────
with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as td:
    png = _png(td)
    spy = SpyEngine()
    text, pages = tess_mod.extract_text_and_images(png, None, born_digital=False, engine=spy)
    check("seam: engine.read_page called once", spy.calls == 1)
    check("seam: engine text returned", text == "SPY")
    check("seam: raw page image returned", len(pages) == 1 and pages[0].size == (24, 16))

# ── 6. default (engine=None) is the Tesseract path -> reconstruct_page_text ───────
with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as td:
    png = _png(td)
    tess_mod.reconstruct_page_text = lambda img, config="--oem 3 --psm 3": "DEFAULT-TESS"
    try:
        text, _pages = tess_mod.extract_text_and_images(png, None)   # no engine arg
        check("default engine routes through Tesseract reconstruct_page_text", text == "DEFAULT-TESS")
    finally:
        tess_mod.reconstruct_page_text = _orig_recon

# ── 7. born-digital guard: text layer used WITHOUT calling the OCR engine ─────────
import pypdfium2 as _pdfium
import ocr.born_digital as _bd

class _FakeBitmap:
    def __init__(self, img): self._img = img
    def to_pil(self): return self._img
class _FakePage:
    def __init__(self, img): self._img = img
    def render(self, scale=1): return _FakeBitmap(self._img)
class _FakeDoc:
    def __init__(self, img): self._pages = [_FakePage(img)]
    def __iter__(self): return iter(self._pages)
    def __getitem__(self, i): return self._pages[i]

_saved = (_pdfium.PdfDocument, _bd.assess_page, getattr(_bd, "page_text", None))
try:
    _img = Image.new("RGB", (24, 16), "white")
    _pdfium.PdfDocument = lambda path: _FakeDoc(_img)
    _bd.assess_page = lambda page: (True, 5, "layer")
    _bd.page_text   = lambda page: "LAYER-TEXT"
    spy = SpyEngine()
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as td:
        pdf = Path(td) / "gen.pdf"; pdf.write_bytes(b"%PDF-1.4 fake")
        text, _pages = tess_mod.extract_text_and_images(pdf, None, born_digital=True, engine=spy)
    check("born-digital: text layer used", text == "LAYER-TEXT")
    check("born-digital: OCR engine NOT called", spy.calls == 0)
finally:
    _pdfium.PdfDocument, _bd.assess_page = _saved[0], _saved[1]
    if _saved[2] is not None: _bd.page_text = _saved[2]

# ── 10. reconstruct_page_text: far-right value stays on its label's line ──────────
import pytesseract as _pt
_orig_i2d = _pt.image_to_data
def _fake_i2d(img, config=None, output_type=None):
    # two label|value rows, each with a wide inter-column gap (label left, value far right)
    return {
        "text":   ["Subtotal:", "$377.94", "Total:", "$396.12"],
        "left":   [1900, 2300, 1900, 2300],
        "top":    [500, 500, 560, 560],
        "width":  [200, 250, 160, 250],
        "height": [30, 30, 30, 30],
    }
_pt.image_to_data = _fake_i2d
try:
    _lines = tess_mod.reconstruct_page_text(Image.new("L", (10, 10), 255)).split("\n")
    _total = [l for l in _lines if l.startswith("Total:")]
    check("reconstruct: subtotal label+value on ONE line",
          any(l.startswith("Subtotal:") and "$377.94" in l for l in _lines))
    check("reconstruct: total label+value on ONE line",
          len(_total) == 1 and "$396.12" in _total[0])
    check("reconstruct: wide gap emits a 4-space column break", "    " in _total[0])
finally:
    _pt.image_to_data = _orig_i2d

# ── 10b. reconstruct: a BOLD/larger Total label bands with its value (overlap banding) ──
def _fake_i2d_bold(img, config=None, output_type=None):
    return {
        "text":   ["Item", "$50.00", "Total:", "$396.12"],
        "left":   [200,    2300,     1900,     2300],
        "top":    [400,    400,      520,      574],   # label h84 top520 & value h30 top574 share baseline 604
        "width":  [150,    200,      160,      250],
        "height": [30,     30,       84,       30],
    }
_pt.image_to_data = _fake_i2d_bold
try:
    _lines = tess_mod.reconstruct_page_text(Image.new("L", (10, 10), 255)).split("\n")
    _total = [l for l in _lines if l.startswith("Total:")]
    check("reconstruct: bold/larger Total label bands with its value (overlap banding)",
          len(_total) == 1 and "$396.12" in _total[0])
finally:
    _pt.image_to_data = _orig_i2d

# ── 8. leak-prevention: crop/zone/anchor/landmark paths don't import the seam ─────
for rel in ("ocr/region.py", "ocr/landmarks.py", "ocr/text_enhance.py",
            "extraction/anchor.py", "extraction/template_mapper.py"):
    src = (ROOT / rel).read_text(encoding="utf-8", errors="ignore")
    check(f"{rel} does not import the engine seam",
          "ocr.engine" not in src and "get_engine" not in src and "read_page" not in src)

print(f"\n{fail} check(s) FAILED" if fail else "\nAll OCR-engine seam checks passed.")
sys.exit(1 if fail else 0)
