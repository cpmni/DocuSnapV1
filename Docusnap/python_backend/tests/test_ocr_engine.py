#!/usr/bin/env python3
"""
tests/test_ocr_engine.py — guards the Stage 1 full-page OCR engine seam (ocr/engine.py
+ ocr.tesseract.extract_text_and_images). Fully HERMETIC: uses fake engines / fake
RapidOCR / monkeypatched ocr_image, so it needs no real RapidOCR, ONNX, or Tesseract.

Covers:
  1. selection: default/unknown/'tesseract' -> TesseractEngine
  2. fallback: RapidOCR import/init failure -> TesseractEngine + a warn log
  3. reading order: RapidOCR line boxes are reassembled top->bottom, left->right
  4. mid-run fallback: a RapidOCR inference exception -> Tesseract for that page + warn
  5. seam: extract_text_and_images routes the full-page read through engine.read_page
  6. default byte-identical: engine=None routes through TesseractEngine -> ocr_image
  7. born-digital guard: a PDF text layer is used WITHOUT calling the OCR engine
  8. leak-prevention: crop/zone/anchor/landmark modules do NOT import the engine seam

Usage:  py -3.12 python_backend/tests/test_ocr_engine.py
"""

import io
import sys
import tempfile
import contextlib
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
    import ocr.engine as engine_mod
    import ocr.tesseract as tess_mod
    from ocr.engine import get_engine, TesseractEngine, RapidOcrEngine
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


def _capture(fn):
    """Run fn(), return (result, captured_stdout)."""
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        r = fn()
    return r, buf.getvalue()


# ── 1. selection ────────────────────────────────────────────────────────────────
for nm in (None, "tesseract", "TESSERACT", "bogus", ""):
    check(f"get_engine({nm!r}) -> Tesseract", get_engine(nm).name == "tesseract")

# ── 2. RapidOCR unavailable -> Tesseract fallback + warn log ──────────────────────
_orig_ensure = RapidOcrEngine._ensure
RapidOcrEngine._ensure = lambda self: (_ for _ in ()).throw(ImportError("no rapidocr here"))
try:
    eng, out = _capture(lambda: get_engine("rapidocr"))
    check("rapidocr unavailable -> Tesseract", eng.name == "tesseract")
    check("rapidocr unavailable -> warn log emitted", '"level": "warn"' in out and "RapidOCR unavailable" in out)
finally:
    RapidOcrEngine._ensure = _orig_ensure

# ── 3. reading order from line boxes ──────────────────────────────────────────────
def _fake_rapid(arr, **kwargs):
    # 'world' sits BELOW 'hello'; engine must reorder to hello\nworld.
    box_lo = [[10, 50], [60, 50], [60, 62], [10, 62]]   # y ~50
    box_hi = [[10, 5],  [60, 5],  [60, 17], [10, 17]]   # y ~5
    return ([[box_lo, "world", 0.9], [box_hi, "hello", 0.95]], 0.0)

r3 = RapidOcrEngine()
r3._engine = _fake_rapid                                 # bypass real init
check("rapidocr reading order top->bottom", r3.read_page(Image.new("L", (80, 80), 255)) == "hello\nworld")

# ── 4. mid-run inference failure -> Tesseract for that page + warn ────────────────
# The Tesseract full-page path now goes through reconstruct_page_text (word-geometry
# line rebuild), so the fallback is stubbed there rather than at ocr_image.
_orig_ocr_image = tess_mod.ocr_image
_orig_recon = tess_mod.reconstruct_page_text
tess_mod.reconstruct_page_text = lambda img, config="--oem 3 --psm 3": "TESS-FALLBACK"
try:
    r4 = RapidOcrEngine()
    def _boom(arr, **kwargs): raise RuntimeError("inference boom")
    r4._engine = _boom
    res4, out4 = _capture(lambda: r4.read_page(Image.new("L", (20, 20), 255)))
    check("rapidocr mid-run failure -> Tesseract text", res4 == "TESS-FALLBACK")
    check("rapidocr mid-run failure -> warn log", '"level": "warn"' in out4 and "RapidOCR failed" in out4)
finally:
    tess_mod.reconstruct_page_text = _orig_recon

# ── 5. seam: extract_text_and_images routes full-page read through engine ─────────
with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as td:
    png = _png(td)
    spy = SpyEngine()
    text, pages = tess_mod.extract_text_and_images(png, None, born_digital=False, engine=spy)
    check("seam: engine.read_page called once", spy.calls == 1)
    check("seam: engine text returned", text == "SPY")
    check("seam: raw page image returned", len(pages) == 1 and pages[0].size == (24, 16))

# ── 9. speed knobs: use_cls + intra_op_num_threads forwarding (RapidOCR-only) ─────
# 9a. get_engine forwards the knobs to the RapidOcrEngine without initialising it.
e = get_engine("rapidocr", probe=False, use_cls=False, intra_op_num_threads=3)
check("get_engine forwards use_cls", e._use_cls is False)
check("get_engine forwards intra_op_num_threads", e._intra_op_num_threads == 3)
# 9b. defaults are byte-identical (cls on, no thread cap).
ed = get_engine("rapidocr", probe=False)
check("get_engine default use_cls on", ed._use_cls is True and ed._intra_op_num_threads is None)
# 9c. read_page passes use_cls THROUGH to the underlying engine call.
_seen = {}
def _spy_cls(arr, **kwargs):
    _seen.update(kwargs)
    return ([[[[0, 0], [9, 0], [9, 9], [0, 9]], "x", 0.9]], 0.0)
rc = RapidOcrEngine(use_cls=False)
rc._engine = _spy_cls
rc.read_page(Image.new("L", (16, 16), 255))
check("read_page forwards use_cls=False to engine", _seen.get("use_cls") is False)

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
# The scanned totals column-split fix: rebuild reading lines from word GEOMETRY so a
# label and its far-right value on the SAME physical row land on ONE line (with a
# 4-space column break), rather than being split into detached columns as plain
# image_to_string does. Stubs image_to_data so it needs no real OCR.
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

# ── 8. leak-prevention: crop/zone/anchor/landmark paths don't import the seam ─────
for rel in ("ocr/region.py", "ocr/landmarks.py", "ocr/text_enhance.py",
            "extraction/anchor.py", "extraction/template_mapper.py"):
    src = (ROOT / rel).read_text(encoding="utf-8", errors="ignore")
    check(f"{rel} does not import the engine seam",
          "ocr.engine" not in src and "get_engine" not in src and "read_page" not in src)

print(f"\n{fail} check(s) FAILED" if fail else "\nAll OCR-engine seam checks passed.")
sys.exit(1 if fail else 0)
