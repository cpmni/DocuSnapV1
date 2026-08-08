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

from ocr.text_layout import COLUMN_BREAK   # 4-space column-break marker (single source of truth)

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
def _resolve_render_dpi():
    """Extraction OCR render DPI. Env OCR_RENDER_DPI is set from the 'ocr_dpi' processing setting
    (handler.js _ocrDpiEnv). DEFAULT 300 = byte-identical to the old hardcoded value. A LOWER DPI is
    a large speed win — the OCR cost scales ~DPI^2 (150 is ~2.8x faster than 300) AND smaller page
    images scale far better across parallel workers (less memory-bandwidth contention) — traded
    against small-text OCR accuracy on genuine high-res scans, so it is an operator OPT-IN. Garbage /
    out-of-band falls back to 300 (never a broken render). The same value drives BOTH the render scale
    and the --dpi told to Tesseract, so they can't diverge."""
    try:
        v = int(os.environ.get("OCR_RENDER_DPI", "300") or "300")
    except (TypeError, ValueError):
        return 300
    return v if 100 <= v <= 600 else 300


_RENDER_DPI    = _resolve_render_dpi()   # PDF pages rasterised at this DPI; told to Tesseract via --dpi


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


def _group_words_into_lines(words, med_h, rows_out=None) -> list:
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
        # rows_out (geometry hand-off, 2026-07-20): the per-row WORD TUPLES, appended PARALLEL to
        # the returned line strings — rows_out[i] is exactly the words `lines[i]` was built from.
        # Opt-in and inert (None = no extra work); the letterhead height ranker needs LINE-level
        # heights ("Cit" h=64 + "Office" h=101 on one row — word heights are noisy, the row is not).
        if rows_out is not None:
            rows_out.append(row_ws)
        out = [row_ws[0][4]]
        for a, b in zip(row_ws, row_ws[1:]):
            gap = b[0] - (a[0] + a[2])
            out.append(COLUMN_BREAK if gap > col_gap else " ")
            out.append(b[4])
        lines.append("".join(out))
    return lines


def reconstruct_page_text(img: Image.Image, config: str = "--oem 3 --psm 3", dpi=None,
                          words_out: dict | None = None) -> str:
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
    supp_cfg = _with_dpi(_SUPP_CONFIG, dpi)

    # OBTAIN THE TWO INDEPENDENT FULL-PAGE PASSES (PSM-3 main + PSM-6 supplementary). The MERGE
    # below is unchanged and single-source, so only HOW these are fetched differs:
    #   OFF (default): sequential — PSM-3, and PSM-6 only if PSM-3 read words (today's behaviour,
    #                  byte-identical).
    #   ON  (DS_OCR_PARALLEL_FULLPAGE != '0'): both submitted concurrently to a 2-worker pool —
    #        each pytesseract call shells out to a GIL-releasing tesseract.exe, so this is the
    #        ~2x lever on the full-page OCR of a single reprocess (Option B, 2026-07-17 design).
    #        Byte-identical because the merge takes PSM-3 as a FIXED base and APPENDS PSM-6
    #        survivors, never order-of-completion. OMP capped to 1 so the 2 tesseract.exe can't
    #        oversubscribe (LSTM is 1-core-bound → throughput-neutral + recognition-identical).
    #        ANY pool/import failure falls through to the sequential path. Gated ON only by the
    #        single-reprocess spawn — never batch/import (those already parallelise across docs).
    data = supp = None
    if os.environ.get('DS_OCR_PARALLEL_FULLPAGE', '0') != '0':
        try:
            import concurrent.futures as _cf
            os.environ['OMP_THREAD_LIMIT'] = '1'   # floor; never raises a parent cap (1 is the min)
            with _cf.ThreadPoolExecutor(max_workers=2) as _ex:
                _fm = _ex.submit(pytesseract.image_to_data, img, config=main_cfg, output_type=pytesseract.Output.DICT)
                _fs = _ex.submit(pytesseract.image_to_data, img, config=supp_cfg, output_type=pytesseract.Output.DICT)
                try:
                    data = _fm.result()
                except Exception:
                    return ocr_image(img, config)           # PSM-3 failed → same fallback as sequential
                try:
                    supp = _fs.result()
                except Exception:
                    supp = None                             # supplementary is additive-only
        except Exception:
            data = supp = None                              # pool construction failed → sequential below

    if data is None:                                        # OFF / fallback: sequential PSM-3
        try:
            data = pytesseract.image_to_data(img, config=main_cfg, output_type=pytesseract.Output.DICT)
        except Exception:
            return ocr_image(img, config)

    words = _words_from_data(data)
    if not words:
        return ""

    # Supplementary PSM-6 recovery (fetched now only if not already obtained in parallel above —
    # OFF path preserves today's behaviour of skipping PSM-6 when PSM-3 read nothing).
    if supp is None:
        try:
            supp = pytesseract.image_to_data(img, config=supp_cfg, output_type=pytesseract.Output.DICT)
        except Exception:
            supp = None   # supplementary recovery is additive-only; never break the PSM-3 result
    if supp is not None:
        try:
            boxes = [(w[0], w[1], w[2], w[3]) for w in words]
            for sw in _words_from_data(supp):
                if sw[5] >= _SUPP_MIN_CONF and any(ch.isalnum() for ch in sw[4]) \
                        and not _center_in_any(sw, boxes):
                    words.append(sw)
        except Exception:
            pass   # supplementary recovery is additive-only; never break the PSM-3 result
    heights = sorted(wd[3] for wd in words if wd[3] > 0)
    med_h = heights[len(heights) // 2] if heights else 10
    _rows = [] if words_out is not None else None
    lines = _group_words_into_lines(words, med_h, rows_out=_rows)
    # GEOMETRY HAND-OFF (2026-07-20). Everything above computes per-word boxes, per-word confidence
    # and the page's MEDIAN WORD HEIGHT — and the join below has always thrown all of it away, so
    # everything downstream reasons over a bare string. That is why "the biggest text at the top of
    # the page" is not merely unimplemented but UNREPRESENTABLE in extraction/keyword.py, and why a
    # letterhead issuer that is the largest text on its page reads as null (measured: 0 of 14 real
    # invoices identified, extraction/letterhead.py).
    #
    # OPT-IN and inert: `words_out` defaults to None, so with no caller asking, this function is
    # byte-identical — no extra OCR pass, no extra work, same return value. A caller that passes a
    # dict receives the geometry alongside the text it belongs to. Units are IMAGE-NATURAL PIXELS
    # of the preprocessed page bitmap, origin TOP-LEFT, box = (left, top, width, height) — the
    # convention this module produces. Do NOT hand these to anchor space, which is CENTRE-based and
    # normalised: mixing the two is a documented source of drift bugs in this project.
    if words_out is not None:
        words_out["words"] = words          # [(left, top, w, h, text, conf)]
        words_out["med_h"] = med_h          # the DPI-invariant scale reference: compare RATIOS to it
        words_out["lines"] = lines          # the same visual rows the returned text is built from
        words_out["rows"] = _rows           # per-row word tuples, PARALLEL to `lines` (rows_out)
        words_out["size"] = getattr(img, "size", None)
    return "\n".join(lines)


# SECURITY (Stage 2 — F6/L5): crafted-document DoS caps ahead of pdfium. Extraction parses an
# attacker-supplied PDF in-process, today bounded only by the per-file watchdog. These caps bound the
# THREE cheap vectors: an oversized file, a huge page count, and a decompression/pixel bomb (a tiny
# page declaring enormous dimensions that renders to a giant bitmap). All three are set FAR above any
# real business document (the corpus max is 2 pages, A4 at 300 DPI is ~3500 px) so they are INERT on
# real docs — the render scale below is min(dpi/72, …) which equals dpi/72 for every normal page, so
# extraction output is byte-identical. Env-overridable. An over-cap doc RAISES → the process_docs
# per-file handler surfaces it as status=error (drained to Errors/, visible), never a silent truncation.
_MAX_PAGES        = int(os.environ.get("OCR_MAX_PAGES", "300") or "300")
_MAX_RENDER_DIM   = int(os.environ.get("OCR_MAX_RENDER_DIM", "10000") or "10000")   # px per axis
_MAX_FILE_BYTES   = int(os.environ.get("OCR_MAX_FILE_MB", "500") or "500") * 1024 * 1024


def pdf_to_images(filepath: Path, dpi: int = 300) -> list[Image.Image]:
    """Convert each PDF page to a PIL Image using pypdfium2. DoS-capped (see _MAX_* above)."""
    try:
        _sz = os.path.getsize(str(filepath))
        if _sz > _MAX_FILE_BYTES:
            raise ValueError(f"PDF is {_sz // (1024 * 1024)} MB, over the {_MAX_FILE_BYTES // (1024 * 1024)} MB safety cap")
    except OSError:
        pass
    doc    = pdfium.PdfDocument(str(filepath))
    images = []
    try:
        _n = len(doc)
        if _n > _MAX_PAGES:
            raise ValueError(f"PDF has {_n} pages, over the {_MAX_PAGES}-page safety cap")
        for page in doc:
            scale = dpi / 72
            try:
                _w, _h = page.get_size()                       # points; clamp so a bomb page can't render huge
                if _w > 0 and _h > 0:
                    scale = min(scale, _MAX_RENDER_DIM / _w, _MAX_RENDER_DIM / _h)
            except Exception:
                pass
            bitmap = page.render(scale=scale)
            images.append(bitmap.to_pil())
            try: page.close()
            except Exception: pass
    finally:
        try: doc.close()       # release the file handle promptly (see extract_text_and_images)
        except Exception: pass
    return images


def detect_skew_angle(img: Image.Image, min_angle: float = 0.2) -> float:
    """Detect small-angle document skew via horizontal projection variance. Returns the angle in
    DEGREES in PIL's convention (positive = the rotation `img.rotate(angle)` applies to STRAIGHTEN,
    i.e. CCW-positive), or 0.0 when |skew| < max(0.2, min_angle) — the caller's user-set floor,
    clamped so it can NEVER drop below the hard 0.2° noise floor (below which the estimate is noise
    and a rotate would be spurious). Default 0.2 ⇒ byte-identical to the pre-flag behaviour. NON-DESTRUCTIVE — measures
    only. Shared by `_deskew` (which applies it to the OCR copy) and the Review-window display
    deskew (which rotates the on-screen page so drawn ⊕ boxes align with straight text). Operates
    on a downscaled binary copy for speed."""
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

    return best if abs(best) >= max(0.2, min_angle) else 0.0


# S1 DESKEW_SS_ROTATE (007 + Oracle SIGN-OFF-W/COND C1-C5, 2026-08-05 — docs/oracle_log.md).
# A single BICUBIC rotate at render resolution DEGRADES marginal-resolution print: on a
# 150-DPI-native scan an ~8pt glyph has 1-2px strokes, the rotation's subpixel phase varies
# across the page (strokes alternately thin/thicken) and BICUBIC's negative lobes add halos —
# probe-proven on live doc 561 ('Delivery Note No. DN-98447' reads PERFECTLY raw, garbles to
# 'Dobrery/Not/Ne:/DN/er!' after its own +1.9° deskew). Supersample 2× (LANCZOS) → rotate →
# downsample to the ORIGINAL size (LANCZOS): geometrically IDENTICAL (same centre/angle/output
# size/mode — zero coordinate impact anywhere), only the pixels get the anti-aliased rotation.
# C2: pages beyond the megapixel clamp keep the single-resample path (transient supersample
# memory ~4× — an A4@300 is ~9MP, the clamp only trips on outliers).
# DEFAULT OFF (=1 arms): the doc-561 probe REFUTED the interpolation hypothesis — the
# supersampled rotation garbles the same header the same way, so the degradation is NOT the
# resample quality (suspect: the scan's noise field smearing into strokes under ANY rotation;
# raw+tilted reads perfectly because Tesseract self-tolerates <=~2°). Oracle C5: default ON
# only after the C4 gate is green — it is not. The Oracle-banked S4 (raw-preferring frame
# election) / read-path angle floor now carry the evidence bar instead.
_SS_ROTATE_ON = os.environ.get('DESKEW_SS_ROTATE', '0') != '0'
_SS_ROTATE_MAX_PIXELS = 24_000_000   # ~A3 @ 300 DPI; beyond this the 4× transient is unreasonable


def _apply_skew_rotation(img: Image.Image, angle: float) -> Image.Image:
    """Rotate `img` by a PRE-DETECTED skew `angle` (PIL CCW-positive), or return it UNCHANGED when
    angle is 0.0 (a below-floor page). Factored out of `_deskew` so a caller can detect the angle
    ONCE (to decide fast-path cache reuse) and apply it here without a second projection sweep.
    ONE rotation implementation for the whole system (Oracle C1): the pipeline, the Review display
    deskew and the teach window's straightened render all route through here, so the operator
    always validates against the SAME pixels the pipeline reads."""
    if not angle:
        return img  # no meaningful skew — identical pixels, so an OCR read would be unchanged
    fill = 255 if img.mode in ('L', '1') else (255, 255, 255)   # ('1' parity — region.py callers)
    w, h = img.size
    if _SS_ROTATE_ON and 0 < w * h <= _SS_ROTATE_MAX_PIXELS:
        big = img.resize((w * 2, h * 2), Image.LANCZOS)
        big = big.rotate(angle, expand=False, fillcolor=fill, resample=Image.BICUBIC)
        return big.resize((w, h), Image.LANCZOS)
    return img.rotate(angle, expand=False, fillcolor=fill, resample=Image.BICUBIC)


def _deskew(img: Image.Image, min_angle: float = 0.2) -> Image.Image:
    """
    Detect and correct small-angle document skew via horizontal projection variance.
    Operates on a downscaled binary copy for speed; rotation applied to the original
    at full resolution. Skew below 0.2° is ignored to avoid spurious micro-rotations.
    """
    return _apply_skew_rotation(img, detect_skew_angle(img, min_angle))


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
    provenance_out: list | None = None,
    deskew_pages: bool = False,
    deskew_min_angle: float = 0.2,
    raw_pages_out: list | None = None,
    page0_words_out: dict | None = None,
    deskew_angles_out: list | None = None,
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

    deskew_pages (default off): the "Straighten + Reprocess" recovery path. When on, each
    SCANNED page is transiently deskewed (ocr/tesseract._deskew — small-angle projection-variance
    correction) after auto-rotate and BEFORE the OCR read, so the full-page text AND the returned
    page image (the anchor crop source) are level → a taught label relocates in a straight frame.
    Born-digital pages (exact text layer, upright) are skipped. The FILED file is never touched.
    raw_pages_out, when given, is filled PARALLEL to the returned pages with each page's PRE-deskew
    image — the caller passes raw_pages_out[0] to engine.extract(raw_page0=...) so the persisted
    logo phash + logo/template MATCHING use the raw frame (a deskewed logo phash drifts from the
    learned raw hashes and, once persisted, poisons the supplier's logo set for every future import).
    Deskew and cached_text now COEXIST (DESKEW×CACHE fast path): the skew FLOOR is the gate — a
    scanned page tilted past it is straightened + re-OCR'd fresh; a below-floor page reuses cache
    because `_deskew` would return identical pixels (so the read is unchanged). Env DESKEW_CACHE_FAST=0
    forces re-OCR on every deskew run; DESKEW_PAGES=0 upstream disables deskew entirely.

    cached_text (default None): REPROCESS optimisation. The full-page OCR (~1.9 s/page
    on a scanned page) re-reads the SAME pixels every reprocess for a result that never
    changes; only the learned data does. When the caller already has the text (stored
    in documents.ocr_text on first import), pass it here: the page IMAGES are still
    rendered (~0.25 s, needed for crop/logo/zone OCR + registration), but the full-page
    OCR is SKIPPED and cached_text is returned verbatim. Under deskew_pages the OCR is skipped
    ONLY for docs whose every scanned page is below the skew floor (a tilted doc re-OCRs fresh
    straightened). Per-field crop reads + the born-digital page_text_lines (derived by the caller)
    are unaffected, so extraction is unchanged — only the redundant full-page pass is removed.
    """
    use_cache = cached_text is not None
    # OCR happens whenever this is NOT a cached run, OR a deskew run might re-read a tilted page — so
    # initialise the read engine in those cases (a pure cached NON-deskew run reads nothing, needs none).
    if engine is None and (not use_cache or deskew_pages):
        from ocr.engine import TesseractEngine
        engine = TesseractEngine()
    # DESKEW × CACHE FAST PATH (oscar-designed, Oracle SIGN-OFF-WITH-CONDITIONS). Straightening a scan
    # re-reads the SAME rendered pixels, but a page tilted BELOW the floor is a no-op for `_deskew`
    # (`detect_skew_angle` -> 0.0 -> identical pixels -> identical OCR). So instead of re-OCRing every
    # page under Straighten-all, DETECT skew first (cheap projection sweep) and only re-OCR when a
    # SCANNED page is actually tilted past the floor; an all-level doc reuses its cached OCR exactly
    # like a normal reprocess. Kill switch DESKEW_CACHE_FAST=0 forces the old always-re-OCR behaviour.
    _deskew_cache_fast = os.environ.get('DESKEW_CACHE_FAST', '1') != '0'

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
        # PASS A — render every page, auto-rotate, read born-digital text, DETECT+apply skew, fill the
        # parallel output lists. The OCR read is DEFERRED to Pass B so we can first learn whether ANY
        # scanned page is tilted (the whole-doc fast-path verdict). `page_layer[i]` remembers each page's
        # born-digital text (None = a scanned page) so Pass B can OCR the stored `pages[i]` without
        # re-touching the pdfium page — closed here to release the source file handle immediately
        # (otherwise pdfium keeps it open and the "move to Processed/" rename hits a Windows lock; the
        # returned page images are independent PIL .to_pil() copies, so they survive the close).
        page_layer = []
        any_scanned_tilted = False
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
                # DESKEW (transient, scanned pages only): DETECT the angle ONCE (drives both the
                # fast-path verdict and the rotation), then straighten before it's appended to `pages`
                # (the anchor crop source), so a taught label relocates in a level frame. Below the floor
                # detect returns 0.0 and the rotation is a NO-OP -> identical pixels, so reusing the cache
                # for that page is exact. Runs under cached_text too now (the verdict below decides
                # re-OCR vs cache). raw_pages_out keeps the PRE-deskew page for the logo phash / identity.
                raw_img = img
                _angle = detect_skew_angle(img, deskew_min_angle) if (deskew_pages and layer_text is None) else 0.0
                if _angle:
                    img = _apply_skew_rotation(img, _angle)
                    any_scanned_tilted = True
                if deskew_angles_out is not None:
                    deskew_angles_out.append(_angle)   # per-page applied angle (0.0 = untouched) — SFDEV/raw-witness observability
                if deskew_pages and raw_pages_out is not None:
                    raw_pages_out.append(raw_img)   # parallel to pages (raw==img on a born-digital / level page)
                pages.append(img)
                # Per-page PROVENANCE (parallel to `pages`): 'born_digital' when this page's text
                # comes from the embedded vector layer, else 'ocr'. Lets a downstream consumer
                # (the Stage-4.5 gate-failure re-read) fire ONLY on OCR'd pages — a born-digital
                # value is exact, so a withhold there is a real format issue, not an OCR garble.
                if provenance_out is not None:
                    provenance_out.append('born_digital' if layer_text is not None else 'ocr')
                page_layer.append(layer_text)       # None = a scanned page (OCR'd or cache-deferred in Pass B)
                try: page.close()
                except Exception: pass
        finally:
            try: doc.close()
            except Exception: pass

        # VERDICT: re-OCR the scanned pages when this is a fresh run, or a deskew run found a tilted
        # scanned page (or the fast path is killed). Else the scanned pages reuse the cache. All-or-
        # nothing per doc (the cache is one whole-doc blob), so a mixed/multi-page doc re-OCRs entirely
        # iff ANY scanned page is tilted (per-page splitting is a deferred slice). Born-digital pages
        # ALWAYS take their fresh layer text (never cache) — so a fully born-digital doc stays fresh.
        needs_scanned_ocr = (not use_cache) or (deskew_pages and (any_scanned_tilted or not _deskew_cache_fast))
        # PASS B — assemble `texts` in page order. When needs_scanned_ocr the list is complete (fresh
        # born-digital + fresh OCR) and is joined below; else a scanned page sets all_fresh=False and the
        # doc returns cached_text (the partial `texts` is never joined — same as the pre-split behaviour).
        for i, layer_text in enumerate(page_layer):
            if layer_text is not None:
                texts.append(layer_text)                                                 # fresh born-digital
            elif needs_scanned_ocr:
                # page0_words_out: the PAGE-0 geometry hand-off (letterhead height ranking) —
                # filled only on a fresh page-0 OCR read; born-digital page 0 has no word boxes
                # (exact vector text) and a cache-honoured run reads nothing (cleared below).
                texts.append(engine.read_page(pages[i], enhance_params, dpi=_RENDER_DPI,
                                              words_out=(page0_words_out if i == 0 else None)))  # fresh (straightened) OCR
            else:
                all_fresh = False                                                        # scanned page -> honour cache
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
        # DESKEW (a scanned raster has no text layer -> always a scanned page): detect the angle once,
        # straighten if tilted (below-floor = no-op). raw_pages_out keeps the raw frame for the logo
        # phash. Same fast-path verdict as the PDF branch (Oracle C3): a tilted raster re-OCRs fresh
        # straightened; a level raster under cache reuses it.
        raw_img = img
        _angle = detect_skew_angle(img, deskew_min_angle) if deskew_pages else 0.0
        if _angle:
            img = _apply_skew_rotation(img, _angle)
        if deskew_angles_out is not None:
            deskew_angles_out.append(_angle)   # per-page applied angle — parity with the PDF path
        if deskew_pages and raw_pages_out is not None:
            raw_pages_out.append(raw_img)
        pages = [img]
        if provenance_out is not None:
            provenance_out.append('ocr')   # a raster image has no text layer — always OCR
        if (not use_cache) or (deskew_pages and ((_angle != 0.0) or not _deskew_cache_fast)):
            texts.append(engine.read_page(img, enhance_params, dpi=_idpi,
                                          words_out=page0_words_out))   # a raster IS page 0
        else:
            all_fresh = False   # level raster under cache -> honour the OCR cache

    # Prefer freshly-derived text whenever we have it for EVERY page (fully born-digital, or a
    # non-cache run); only fall back to the cache when a scanned/mixed page was skipped under it.
    if use_cache and not all_fresh:
        # The CACHED text is being returned, so any page-0 geometry captured above belongs to
        # lines the caller will never see — a stale pairing is worse than none (the documented
        # cached-reprocess caveat: geometry consumers fall back to text-only on a reprocess).
        if page0_words_out is not None:
            page0_words_out.clear()
        return cached_text, pages
    return "\n\n--- PAGE BREAK ---\n\n".join(texts), pages


SUPPORTED_EXTENSIONS = {
    ".pdf", ".png", ".jpg", ".jpeg", ".tiff", ".tif", ".bmp"
}
