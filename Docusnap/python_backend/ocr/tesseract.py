"""
ocr/tesseract.py
----------------
Tesseract OCR wrapper. Handles both PDF and image files.
"""

import os
from pathlib import Path

import pytesseract
import pypdfium2 as pdfium
from PIL import Image, ImageOps, ImageFilter

# Noise-cleanup slider levels (1-3) → PIL MedianFilter kernel size.
# Larger kernels remove more speckle but blur fine text more.
NOISE_FILTER_SIZES = {1: 3, 2: 5, 3: 7}


def configure(tesseract_path: str | None = None):
    """Set Tesseract executable path if not on system PATH."""
    if tesseract_path and os.path.exists(tesseract_path):
        pytesseract.pytesseract.tesseract_cmd = tesseract_path


def ocr_image(img: Image.Image, config: str = "--oem 3 --psm 3") -> str:
    """Run Tesseract OCR on a PIL image."""
    return pytesseract.image_to_string(img, config=config)


# Supplementary "uniform block" pass (PSM 6) used to RECOVER a sparse column that PSM 3's page
# segmentation drops (see reconstruct_page_text). Confidence-gated so only clean words are merged.
_SUPP_CONFIG   = "--oem 3 --psm 6"
_SUPP_MIN_CONF = 50
_RENDER_DPI    = 300               # PDF pages are rasterised at this DPI; told to Tesseract via --dpi


def _words_from_data(data) -> list:
    """image_to_data DICT -> [(left, top, w, h, text, conf)]. Skips empty tokens + bad rows."""
    words = []
    texts = data.get("text", [])
    confs = data.get("conf", [])
    for i in range(len(texts)):
        t = (texts[i] or "").strip()
        if not t:
            continue
        try:
            l, top, w, h = (int(data["left"][i]), int(data["top"][i]),
                            int(data["width"][i]), int(data["height"][i]))
        except (KeyError, TypeError, ValueError):
            continue
        try:
            c = float(confs[i])
        except (IndexError, TypeError, ValueError):
            c = -1.0
        words.append((l, top, w, h, t, c))
    return words


def _center_in_any(word, boxes) -> bool:
    """True when `word`'s CENTRE falls inside any (l, top, w, h) box — i.e. this region was
    already recognised, so a supplementary re-read of it must NOT be merged (avoid duplicates
    and importing a noisier second-pass read of an already-clean word)."""
    cx = word[0] + word[2] / 2.0
    cy = word[1] + word[3] / 2.0
    for (bl, bt, bw, bh) in boxes:
        if bl <= cx <= bl + bw and bt <= cy <= bt + bh:
            return True
    return False


def _with_dpi(cfg: str, dpi) -> str:
    """Append '--dpi N' to a Tesseract config when the render DPI is known. A rendered bitmap
    carries NO DPI metadata, so Tesseract GUESSES (~70) and mis-scales its page analysis — at 300
    DPI that silently drops sparse right-column header cells (a scanned invoice's 'Invoice Date …'
    row read EMPTY even though the words are plainly printed and recognised at 200 DPI). Telling it
    the true DPI restores recognition. No-op when dpi is falsy → byte-identical to before."""
    try:
        return f"{cfg} --dpi {int(dpi)}" if dpi else cfg
    except (TypeError, ValueError):
        return cfg


def _group_words_into_lines(words, med_h) -> list:
    """Group image_to_data words into reading LINES by visual row, then order columns within each
    row (a label and its far-right value on the SAME physical row stay on one line; a wide intra-row
    x-gap emits a 4-space column break so keyword.py's column-split still separates real columns).

    TWO PASS with a FROZEN row anchor (oscar). A word can belong to a row that is SEEDED AFTER it in
    the global y-sort, so a single greedy pass (which can only choose among rows already created) put
    a value on the row above its label on a 3-column header — e.g. an invoice number at y-centre 1270
    glued to "BILLING ADDRESS" (yc 1252, seeded first) instead of its own "INVOICE NUMBER" row (yc
    1274, seeded later), so the label read empty and the keyword matcher fell through to the line
    below. Fix: PASS 1 discovers the anchor SET with the SAME frozen-seed eligibility as before (so
    the rows are identical to today — no regression); PASS 2 assigns EVERY word against the FULL set,
    order-independent. Tie-break = (significant-overlap, max overlap, min centre-distance): vertical
    box OVERLAP (physical "same printed line") wins over centre proximity, so a value re-homes to its
    own label's row while a tall BOLD label still keeps its lower-centred value (which it encloses)
    instead of losing it to a nearer line below. med_h-relative → DPI-stable. Guarded by test_ocr_engine.py."""
    if not words:
        return []
    col_gap = max(med_h * 1.5, 12)    # x-gap wide enough to be a column break (4-space)
    cap     = max(med_h * 1.2, 10)    # centres farther than this = DIFFERENT rows (hard backstop)
    band    = max(med_h * 0.6, 6)     # within this of a row's FROZEN centre = same row (OR clause)
    OV      = 0.3                      # box-overlap fraction that counts as "significant" (same line)
    sw = sorted(words, key=lambda w: w[1] + w[3] / 2.0)         # deterministic top-to-bottom

    def _eligible(wd, a):
        top_w, bot_w = wd[1], wd[1] + wd[3]
        overlap = min(bot_w, a["bot"]) - max(top_w, a["top"])
        shorter = min(wd[3], a["bot"] - a["top"]) or 1
        d = abs((wd[1] + wd[3] / 2.0) - a["yc"])
        sig = overlap >= OV * shorter
        return ((sig or d <= band) and d <= cap), sig, overlap, d

    # PASS 1 — discover the anchor SET (identical seeding rule to the old single pass → same rows).
    anchors = []
    for wd in sw:
        if not any(_eligible(wd, a)[0] for a in anchors):
            anchors.append({"top": wd[1], "bot": wd[1] + wd[3], "yc": wd[1] + wd[3] / 2.0})
    # PASS 2 — assign EVERY word to its BEST anchor over the FULL set (removes the visit-order bias).
    rows = [{"top": a["top"], "bot": a["bot"], "yc": a["yc"], "words": []} for a in anchors]
    for wd in sw:
        best, best_key = None, None
        for r in rows:
            ok, sig, overlap, d = _eligible(wd, r)
            if not ok:
                continue
            key = (1 if sig else 0, overlap, -d)               # overlap-first; centre only as tie-break
            if best is None or key > best_key:
                best, best_key = r, key
        if best is None:                                        # pathological rounding only — never lose a word
            rows.append({"top": wd[1], "bot": wd[1] + wd[3], "yc": wd[1] + wd[3] / 2.0, "words": [wd]})
        else:
            best["words"].append(wd)
    rows = [r for r in rows if r["words"]]                      # drop any anchor that ended up empty
    rows.sort(key=lambda r: r["yc"])
    lines = []
    for r in rows:
        row_ws = sorted(r["words"], key=lambda w: w[0])         # left-to-right within the row
        out = [row_ws[0][4]]
        for a, b in zip(row_ws, row_ws[1:]):
            gap = b[0] - (a[0] + a[2])
            out.append("    " if gap > col_gap else " ")
            out.append(b[4])
        lines.append("".join(out))
    return lines


def reconstruct_page_text(img: Image.Image, config: str = "--oem 3 --psm 3", dpi=None) -> str:
    """Full-page OCR text with reading lines rebuilt from word GEOMETRY.

    Tesseract's page segmentation (the plain image_to_string in ocr_image) treats a wide
    inter-column gap as a COLUMN break, so a right-aligned totals block OCRs as two detached
    columns: the labels ("Subtotal:" / "Total:") on their own lines and the values
    ("$387.74") stranded in a separate block further down the text. The line-based keyword
    matcher (extraction/keyword.py) then can't pair a label with its value, so the total /
    subtotal read EMPTY on scanned pages (born-digital pages keep exact word positions and
    never hit this path). This rebuilds lines from image_to_data word boxes grouped by
    VISUAL ROW (y-centre band), so a label and its far-right value on the SAME physical row
    stay on ONE line. A wide intra-row x-gap emits a column break (4+ spaces) so keyword.py's
    existing column-split guard still separates genuinely distinct columns. Same words
    Tesseract recognises — only their grouping into lines changes. Falls back to plain
    image_to_string on any error, so it can never read WORSE than before.

    SPARSE-COLUMN RECOVERY: PSM 3 recognises the totals LABELS but not the far-right AMOUNT
    column (a sparse right-aligned block sits outside the main text flow, so page segmentation
    drops the values entirely — subtotal/total then read EMPTY even though the number is
    plainly printed). A second "uniform block" pass (PSM 6) DOES recognise them; we merge back
    ONLY the high-confidence words that land in a region PSM 3 left EMPTY (centre not inside any
    PSM-3 box). PSM 3's clean reads win everywhere it recognised text, so no second-pass noise
    is imported on an already-read row (PSM 6 alone garbles the ruled table-header row). Adds one
    OCR pass per SCANNED page only (born-digital never reaches here); best-effort, so a failure
    leaves the PSM-3 result untouched — it can never read worse. (oscar's sparse-column diagnosis.)
    """
    main_cfg = _with_dpi(config, dpi)
    try:
        data = pytesseract.image_to_data(img, config=main_cfg, output_type=pytesseract.Output.DICT)
    except Exception:
        return ocr_image(img, config)
    words = _words_from_data(data)
    if not words:
        return ""
    try:
        supp = pytesseract.image_to_data(img, config=_with_dpi(_SUPP_CONFIG, dpi), output_type=pytesseract.Output.DICT)
        boxes = [(w[0], w[1], w[2], w[3]) for w in words]
        for sw in _words_from_data(supp):
            if sw[5] >= _SUPP_MIN_CONF and any(ch.isalnum() for ch in sw[4]) \
                    and not _center_in_any(sw, boxes):
                words.append(sw)
    except Exception:
        pass   # supplementary recovery is additive-only; never break the PSM-3 result
    heights = sorted(wd[3] for wd in words if wd[3] > 0)
    med_h = heights[len(heights) // 2] if heights else 10
    return "\n".join(_group_words_into_lines(words, med_h))


def pdf_to_images(filepath: Path, dpi: int = 300) -> list[Image.Image]:
    """Convert each PDF page to a PIL Image using pypdfium2."""
    doc    = pdfium.PdfDocument(str(filepath))
    images = []
    try:
        for page in doc:
            bitmap = page.render(scale=dpi / 72)
            images.append(bitmap.to_pil())
            try: page.close()
            except Exception: pass
    finally:
        try: doc.close()       # release the file handle promptly (see extract_text_and_images)
        except Exception: pass
    return images


def _deskew(img: Image.Image) -> Image.Image:
    """
    Detect and correct small-angle document skew via horizontal projection variance.
    Operates on a downscaled binary copy for speed; rotation applied to the original
    at full resolution. Skew below 0.2° is ignored to avoid spurious micro-rotations.
    """
    import numpy as np

    gray   = img.convert('L') if img.mode != 'L' else img
    binary = gray.point(lambda p: 0 if p < 128 else 255)

    w, h  = binary.size
    scale = min(1.0, 800.0 / max(w, h))
    small = binary.resize((int(w * scale), int(h * scale)), Image.LANCZOS) if scale < 1.0 else binary
    arr   = np.array(small)

    def _score(deg: float) -> float:
        rot  = Image.fromarray(arr).rotate(deg, expand=False, fillcolor=255)
        proj = np.sum(np.array(rot) < 128, axis=1).astype(np.float64)
        return float(np.var(proj))

    # Coarse sweep: -15 to +15 degrees in 0.5-degree steps (61 iterations)
    coarse = [a * 0.5 for a in range(-30, 31)]
    best   = max(coarse, key=_score)

    # Fine sweep: ±0.5 around coarse best in 0.1-degree steps (11 iterations)
    base = round(best * 10)
    fine = [(base + d) / 10.0 for d in range(-5, 6)]
    best = max(fine, key=_score)

    if abs(best) < 0.2:
        return img  # no meaningful skew

    fill = 255 if img.mode == 'L' else (255, 255, 255)
    return img.rotate(best, expand=False, fillcolor=fill, resample=Image.BICUBIC)


def preprocess_for_ocr(img: Image.Image, params: dict | None) -> Image.Image:
    """
    Apply OCR preprocessing in a fixed pipeline order.
    params keys: grayscale (bool), autocontrast (bool), deskew (bool),
                 threshold (bool), threshold_level (int 50-220),
                 noise_level (int 0-3, 0 = off).
    Returns img unchanged when params is None or all options are falsy.
    Pipeline order is fixed here and must not be controlled by the caller.
    """
    if not params:
        return img

    # Normalise exotic modes (RGBA, P, etc.) before any operation
    if img.mode not in ('RGB', 'L'):
        img = img.convert('RGB')

    # 1. Grayscale — required before autocontrast and threshold
    if params.get('grayscale') or params.get('autocontrast') or params.get('threshold'):
        if img.mode != 'L':
            img = img.convert('L')

    # 1.5. Noise cleanup / despeckle — median filter, before autocontrast/deskew
    # so contrast stretching and skew detection aren't thrown off by speckle.
    noise_level = int(params.get('noise_level') or 0)
    if noise_level > 0:
        size = NOISE_FILTER_SIZES.get(max(1, min(3, noise_level)), 3)
        img  = img.filter(ImageFilter.MedianFilter(size=size))

    # 2. Autocontrast / contrast normalisation
    if params.get('autocontrast'):
        img = ImageOps.autocontrast(img, cutoff=2)

    # 3. Deskew — after grayscale (projects well on grey), before threshold
    if params.get('deskew'):
        img = _deskew(img)

    # 4. Threshold / binarize
    if params.get('threshold'):
        level = max(1, min(254, int(params.get('threshold_level', 128))))
        img   = img.point(lambda p: 255 if p > level else 0)

    return img


def extract_text_and_images(
    filepath: Path,
    enhance_params: dict | None = None,
    born_digital: bool = False,
    engine=None,
    cached_text: str | None = None,
    auto_rotate: bool = False,
    rotations_out: list | None = None,
) -> tuple[str, list[Image.Image]]:
    """
    Extract OCR text from a document file.
    Returns (full_text, list_of_page_images).

    page_images are the original unenhanced images, kept for logo matching and
    zone OCR.  enhance_params, when provided, are applied only to the OCR text
    extraction pass — the returned pages are always the raw render.

    engine (default None -> Tesseract): the FULL-PAGE OCR engine (ocr.engine). When
    None it is a TesseractEngine whose read_page is exactly the previous inline
    ocr_image(preprocess_for_ocr(...)) call, so the default path is byte-identical.
    Only the full-page read is routed through it — crop/zone/anchor OCR is unaffected.

    born_digital (default off): when on, a PDF page that carries a real embedded
    text layer (a generated invoice/statement) contributes its EXACT vector text
    instead of an OCR read — faster and exact. Image-only/scanned pages have no
    text layer and fall back to OCR unchanged. The page IMAGES are still rendered
    either way (logo/anchor/zone OCR need them). Gated by 'born_digital_enabled'.

    cached_text (default None): REPROCESS optimisation. The full-page OCR (~1.9 s/page
    on a scanned page) re-reads the SAME pixels every reprocess for a result that never
    changes; only the learned data does. When the caller already has the text (stored
    in documents.ocr_text on first import), pass it here: the page IMAGES are still
    rendered (~0.25 s, needed for crop/logo/zone OCR + registration), but the full-page
    OCR is SKIPPED and cached_text is returned verbatim. Per-field crop reads + the
    born-digital page_text_lines (derived by the caller) are unaffected, so extraction
    is unchanged — only the redundant full-page pass is removed.
    """
    use_cache = cached_text is not None
    if engine is None and not use_cache:
        from ocr.engine import TesseractEngine
        engine = TesseractEngine()

    ext   = filepath.suffix.lower()
    texts = []
    pages = []

    # Born-digital text is a near-free text-layer read (no OCR), so it is regenerated FRESH
    # even on reprocess (use_cache) — the cache only exists to skip expensive OCR. Without this,
    # a stale cache (text generated before a born_digital text-gen change, e.g. the column-break
    # split) silently re-serves the OLD text, so a reprocess never picks the improvement up (the
    # "supplier still merged after reprocess" trap). Tracks whether EVERY page yielded fresh text;
    # if a scanned page under use_cache did not, we fall back to the cache for the whole doc.
    all_fresh = True

    if ext == ".pdf":
        import pypdfium2 as pdfium
        from ocr import born_digital as _bd
        # Close the document (and its pages) as soon as we are done rendering, so the
        # source PDF's file handle is released immediately — otherwise pdfium keeps it
        # open for the rest of the worker's life and the post-processing "move to
        # Processed/" rename fails on a Windows file lock. The returned page images are
        # independent PIL copies (.to_pil()), so they survive the close.
        doc = pdfium.PdfDocument(str(filepath))
        try:
            for page in doc:
                img = page.render(scale=_RENDER_DPI / 72).to_pil()
                # AUTO-ROTATE a sideways/upside-down page (first import only — reprocess re-renders
                # the already-corrected working copy, so it's gated off under use_cache). Born-digital
                # pages are upright by construction and skipped. Rotates the image BEFORE OCR + the
                # returned page list, and records the per-page CLOCKWISE angle (0/90/180/270) so the
                # caller can rewrite the working-copy PDF to match. INERT (rot=0) when off, born-digital,
                # low-confidence, or already upright. See ocr/orientation.py for the proven convention.
                rot = 0
                if auto_rotate and not use_cache:
                    _skip = False
                    if born_digital:
                        try: _skip = bool(_bd.assess_page(page)[0])
                        except Exception: _skip = False
                    if not _skip:
                        from ocr import orientation as _orientation
                        rot = _orientation.detect_rotation(img)
                        if rot:
                            img = _orientation.correct_image(img, rot)
                if rotations_out is not None:
                    rotations_out.append(rot)
                pages.append(img)
                # Born-digital text: regenerate FRESH every run (cheap, authoritative), even
                # under use_cache. Positional reading order (page_lines), not the layer's raw
                # char order, so label-adjacency keyword extraction matches OCR.
                layer_text = None
                if born_digital:
                    try:
                        ok, _n, _txt = _bd.assess_page(page)
                        if ok:
                            layer_text = _bd.page_text(page)
                    except Exception:
                        layer_text = None   # any text-layer failure -> OCR / cache fallback
                if layer_text is not None:
                    texts.append(layer_text)
                elif not use_cache:                 # scanned page, fresh run -> OCR it
                    texts.append(engine.read_page(img, enhance_params, dpi=_RENDER_DPI))
                else:                               # scanned page under use_cache -> honour cache
                    all_fresh = False
                try: page.close()
                except Exception: pass
        finally:
            try: doc.close()
            except Exception: pass
    else:
        img = Image.open(filepath)
        _idpi = None                              # honour a raster's own DPI so Tesseract scales right
        try:
            _d = img.info.get("dpi")
            if _d:
                _idpi = int(round(_d[0] if isinstance(_d, (tuple, list)) else _d))
        except Exception:
            _idpi = None
        if not _idpi or _idpi < 72:               # unknown / implausible -> assume the standard render DPI
            _idpi = _RENDER_DPI
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        pages = [img]
        if not use_cache:
            texts.append(engine.read_page(img, enhance_params, dpi=_idpi))
        else:
            all_fresh = False   # a raster image has no text layer -> honour the OCR cache

    # Prefer freshly-derived text whenever we have it for EVERY page (fully born-digital, or a
    # non-cache run); only fall back to the cache when a scanned/mixed page was skipped under it.
    if use_cache and not all_fresh:
        return cached_text, pages
    return "\n\n--- PAGE BREAK ---\n\n".join(texts), pages


SUPPORTED_EXTENSIONS = {
    ".pdf", ".png", ".jpg", ".jpeg", ".tiff", ".tif", ".bmp"
}
