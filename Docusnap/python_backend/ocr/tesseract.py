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


# ── OCR PIPELINE REVISION (Quick Reprocess, 2026-09-01; gary → Oracle C6) ──────────────────────────
# A stamp on the full-page text stored with each document (documents.ocr_recipe). "Quick" reprocess
# reuses that stored text and skips the render + per-field crop OCR — but ONLY when the pipeline that
# produced it is still the pipeline that runs today. This integer is that contract.
#
# BUMP IT (by 1) WHENEVER a change could alter the full-page OCR TEXT for the same pixels, e.g.:
#   * the render path or default DPI clamp (_resolve_render_dpi), the PSM/OEM config strings,
#     word→line grouping / column-break handling, born-digital line extraction, deskew defaults,
#     the light-text recovery merge rule, or the tesseract traineddata shipped in vendor/.
# Do NOT bump for changes that only affect PARSING of already-extracted text (date order, number
# format, field regexes) — those are not OCR. The JS mirror ocrCache.OCR_PIPELINE_REV must move in
# lockstep; test_ocr_cache_usable.js + tests/test_reextract_recipe.py FAIL on a one-sided bump.
OCR_PIPELINE_REV = 1


def get_tesseract_version() -> str:
    """The tesseract engine version, captured mechanically for the OCR recipe stamp (never hand-typed).
    A different engine version can read the same pixels differently, so it is a cache invalidator.
    Best-effort: any failure returns '' (an empty stamp ⇒ ocrCacheUsable treats the recipe as unusable,
    the fail-safe direction)."""
    try:
        return str(pytesseract.get_tesseract_version())
    except Exception:
        return ""


def current_ocr_recipe_meta(bd_enabled: bool, bd_used: bool) -> dict:
    """The recipe describing HOW the full-page text produced THIS run was read, from RUNTIME-ACTUAL
    values (Oracle C3/C6) — the DPI actually rendered, the light levels actually run — never re-read
    from settings at reprocess time. Called ONLY when fresh text was produced this run (never on a
    cached-text reuse or a --reextract; the caller enforces that). `light` is null when the light-text
    recovery pass did not run, else the list of levels it ran — so an OFF→ON flip is a visible change."""
    return {
        "dpi":     _resolve_render_dpi(),                                  # the DPI clamp actually in force now
        "light":   (_light_levels() if _light_text_enabled() else None),   # runtime-actual light levels, or null when off
        "bd":      bool(bd_enabled),                                        # born-digital text-layer path armed this run
        "bd_used": bool(bd_used),                                          # ≥1 page's text actually came from the text layer
        "rev":     OCR_PIPELINE_REV,
        "tess":    get_tesseract_version(),
    }


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


# ── LIGHT-TEXT RECOVERY (2026-08-27; oscar recipe + 007 geometry → Oracle; DARK) ─────────────────────
# Small light-grey print — a 7.5-pt "Serial No: CT-…" sub-line under an item row, a footer, a "Reg No"
# strip — is INVISIBLE to Tesseract's own binarisation on a scan: at the app's 200 DPI, PSM 3/6/11 all
# return ZERO words for it while the pixels are plainly there. A global threshold at 200 → PSM 3 reads the
# same line at conf 90–93 (measured on the Castellan exhibit: 200 beat 215, a paper-relative level and
# every mean-offset adaptive variant — those missed one or both serials and garbled — with 0 debris on
# nine control pages; probe_light_recipe.py). This is a THIRD supplementary source under the existing
# empty-region merge rule: a recovered word is kept ONLY where the PSM-3 + PSM-6 passes left nothing, so a
# page's existing reads never change — the pass can only ADD, and its survivors are placed INTO the base
# rows (see _group_words_into_lines_with_light). Scanned pages only (born-digital never reaches here).
# Switch: OCR_LIGHT_TEXT_RECOVERY (bridged from the `ocr_light_text_recovery` setting by
# processing/handler.js _reconcileEnv); OFF = the pass is not run — byte-identical text, no extra call.
# The level is env-tunable for census work only (OCR_LIGHT_TEXT_THRESHOLD, default 200).
# SEAMS (named for the flip, not the build): a recovered word is the SAME pixels as a crop read under
# another binarisation — never an independent corroboration family; the app's Reprocess reuses the cached
# page text (documents.ocr_text), so a flip heals nothing until a page is re-OCR'd; a recovered light
# footer can reach the letterhead band / a heading verdict — the realdoc + fingerprint censuses gate it.
_LIGHT_TEXT_ENV    = "OCR_LIGHT_TEXT_RECOVERY"
_LIGHT_CONFIG      = "--oem 3 --psm 3"
_LIGHT_MIN_CONF    = 60      # above the PSM-6 floor: a hard-binarised read over-states its confidence (the I/1 lesson)
_LIGHT_MIN_CONF_DIGIT = 80   # Oracle C2: every garble the sweep produced was a CODE at 61–74 ("CT-9813265"@66) and the
                             #   keyword stage has no per-word confidence — a digit-bearing token is admitted only at ≥ 80
_LIGHT_MIN_CONF_DIGIT_AGREED = 70   # …unless THREE OR MORE levels read the same string (see _merge_light_levels)
_LIGHT_IOA_MAX     = 0.2     # intersection over the light word's OWN area vs any base box: a drifted re-read of a base word
_LIGHT_H_MIN       = 0.4     # height band vs the base median word height (the exhibit's serials sit at 0.75–0.88)
_LIGHT_H_MAX       = 2.0
_LIGHT_INK_MIN     = 0.08    # ink density inside the box on the binarised image: below = speckle,
_LIGHT_INK_MAX     = 0.6     #   above = a tinted band that became a solid slab (Tesseract emits confident fragments)
_LIGHT_CAP_ABS     = 40      # more survivors than max(40, 0.35 × base words) ⇒ a noise page ⇒ keep NONE (fail-safe)
_LIGHT_CAP_FRAC    = 0.35


def _light_text_enabled() -> bool:
    return os.environ.get(_LIGHT_TEXT_ENV, "0") != "0"


def _light_threshold() -> int:
    try:
        v = int(os.environ.get("OCR_LIGHT_TEXT_THRESHOLD", "200") or 200)
    except (TypeError, ValueError):
        return 200
    return v if 100 <= v <= 250 else 200


def _is_binary_image(g) -> bool:
    """True when the grayscale page carries NO mid-grey mass — it was already thresholded upstream (OCR
    Enhance with `threshold` on), so a second threshold would be an identity re-read of the same pixels."""
    try:
        hist = g.histogram()
        return sum(hist[60:221]) == 0
    except Exception:
        return False


def _ioa(a, b) -> float:
    """Intersection over the FIRST box's OWN area (not IoU): how much of `a` lies inside `b`."""
    iw = max(0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    ih = max(0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    return (iw * ih) / float(max(1, a[2] * a[3]))


def _ink_density(bin_img, box) -> float:
    """Fraction of BLACK pixels inside `box` on a binarised L-mode image."""
    l, t, w, h = box
    if w <= 0 or h <= 0:
        return 0.0
    try:
        return bin_img.crop((l, t, l + w, t + h)).histogram()[0] / float(w * h)
    except Exception:
        return 0.0


def _adjacent_duplicate(lw, base, med_h) -> bool:
    """True when a BASE word with the same (cleaned, case-folded) text sits on the same row band within one word
    width of `lw` — a shifted re-read of an already-read word, never a recovery."""
    key = _light_agree_key(lw[4])
    if not key:
        return False
    cy = lw[1] + lw[3] / 2.0
    band = max(med_h * 0.6, 6)
    reach = max(lw[2], 4 * med_h)
    h_floor = max(6, _LIGHT_H_MIN * med_h)
    for b in base:
        if b[3] < h_floor:
            continue                       # a degenerate sliver never "owns" a text — the light word replaces it
        if abs((b[1] + b[3] / 2.0) - cy) > band:
            continue
        if _light_agree_key(b[4]) != key:
            continue
        gap = max(b[0] - (lw[0] + lw[2]), lw[0] - (b[0] + b[2]))   # horizontal gap (negative = overlapping)
        if gap <= reach:
            return True
    return False


def _light_survivors(light, base, med_h, page_w, bin_img, min_conf=None, min_conf_digit=None) -> list:
    """The reconciled filter set (oscar + 007, ranked): conf ≥ 60 · ≥2 alnum (a lone glyph only at ≥ 90) ·
    alnum ratio ≥ 0.5 · height 0.4–2.0 × med_h and ≥ 6 px · width ≤ 0.6 × page · repetition ("iiii") ·
    centre OUTSIDE every base word box (the load-bearing dedupe — a thresholded box is a superset of the
    grey-level box, so a re-read of a base word lands inside it) · IoA ≤ 0.2 (the drifted-box escape) ·
    ink density 0.08–0.6 (speckle / slab) · the lone-word rule (no same-row neighbour ⇒ ≥ 4 alnum or conf
    ≥ 80) · the page cap (a noise page keeps nothing)."""
    # Dedupe against REAL base words only: a base box shorter than the page's own word floor (a 5-px sliver PSM-6
    # read as 'CT-832884' at conf 87 on a real scan) is debris by the same rule the light words must pass — it must
    # not "own" the spot and block the three-level light read of 'CT-8328847' beneath it (doc 1706, 2026-08-27).
    _h_floor = max(6, _LIGHT_H_MIN * med_h)
    boxes = [(w[0], w[1], w[2], w[3]) for w in base if w[3] >= _h_floor]
    mc  = _LIGHT_MIN_CONF if min_conf is None else min_conf
    mcd = _LIGHT_MIN_CONF_DIGIT if min_conf_digit is None else min_conf_digit
    kept = []
    for lw in light:
        l, t, w, h, txt, conf = lw
        if conf < mc:
            continue
        if conf < mcd and any(ch.isdigit() for ch in txt):
            continue
        aln = sum(1 for ch in txt if ch.isalnum())
        if aln == 0 or (aln < 2 and conf < 90):
            continue
        if aln / float(max(1, len(txt))) < 0.5:
            continue
        if h < 6 or h < _LIGHT_H_MIN * med_h or h > _LIGHT_H_MAX * med_h:
            continue
        if w > 0.6 * page_w:
            continue
        a = [ch for ch in txt if ch.isalnum()]
        if len(a) >= 4 and len(set(a)) < 2:
            continue
        if _center_in_any(lw, boxes):
            continue
        if any(_ioa((l, t, w, h), b) > _LIGHT_IOA_MAX for b in boxes):
            continue
        dens = _ink_density(bin_img, (l, t, w, h))
        if dens < _LIGHT_INK_MIN or dens > _LIGHT_INK_MAX:
            continue
        # ADJACENT DUPLICATE (census 2026-08-27: 'VAT Reg No GB 774 774 2093 55' — the base pass read '774' with a
        # box shifted enough that the thresholded re-read's centre escaped it and IoA stayed under 0.2): a light
        # word whose text equals a base word's on the same row within one width of it is that word, not a new one.
        if _adjacent_duplicate(lw, base, med_h):
            continue
        kept.append(lw)
    _, _, band = _row_params(med_h)
    def _row_mate(s):
        cy = s[1] + s[3] / 2.0
        for o in base:
            if abs((o[1] + o[3] / 2.0) - cy) <= band:
                return True
        for o in kept:
            if o is not s and abs((o[1] + o[3] / 2.0) - cy) <= band:
                return True
        return False
    kept = [s for s in kept if _row_mate(s) or sum(1 for ch in s[4] if ch.isalnum()) >= 4 or s[5] >= 80]
    # the page cap is applied by the caller on the MERGED set (one level's noise must not blank the others)
    return kept


# THE LEVELS (measured 2026-08-27 on FOUR exhibits — three of the owner's own scans + the sandbox one): NO single
# level reads every serial. A page's faint ink sits 15–45 luminance units under its paper mode, and a thin stroke
# breaks at one level and holds at the next — one value's confidence swung 8 → 90 → 64 → 92 across 200/205/215/220
# on the SAME page; another page read at 200 only, another at 215 only. The UNION of {200, 210, 220, 230} read all
# ten values on all four pages at ≥ 80, and every TRUE string was read by ≥ 2 of the levels while the one garble
# ("CT-8024168" for "CT-8024188", conf 80) appeared at ONE level only — so a digit-bearing string is accepted only
# with two agreeing levels. Cost: one tesseract call per level per scanned page (state it in the flip note).
_LIGHT_LEVELS_DEFAULT = (200, 210, 220, 230)


def _light_levels() -> list:
    """OCR_LIGHT_TEXT_LEVELS ("200,210,220,230") overrides for census work; a bare OCR_LIGHT_TEXT_THRESHOLD pins ONE
    level; else the measured default set. Each level clamped to 100–250, at most six."""
    raw = os.environ.get("OCR_LIGHT_TEXT_LEVELS")
    if raw:
        try:
            lv = sorted({int(x) for x in raw.split(",") if x.strip()})
            lv = [v for v in lv if 100 <= v <= 250][:6]
            if lv:
                return lv
        except (TypeError, ValueError):
            pass
    if os.environ.get("OCR_LIGHT_TEXT_THRESHOLD"):
        return [_light_threshold()]
    return list(_LIGHT_LEVELS_DEFAULT)


def _merge_light_levels(per_level, rejected_out=None) -> list:
    """per_level = [(level, candidate words)] → ONE word list. Candidates from different levels on the same spot are
    ONE word (centre inside / IoA > 0.5 either way). Per spot the STRING read by the most levels wins (tie → the
    higher best confidence) and its best-confidence tuple is returned. A DIGIT-bearing string needs ≥ 2 agreeing
    levels (a hard-binarised misread at one level can carry conf 80 — the I/1 lesson); an alpha-only word may stand
    on one level. The confidence floors are applied to the WINNER here (the per-level candidates come in unfloored
    so a level that read the right string at 78 still counts as agreement)."""
    groups = []
    for level, words in per_level:
        for w in words:
            box = (w[0], w[1], w[2], w[3])
            home = None
            for g in groups:
                b = g["box"]
                if _center_in_any(w, [b]) or _ioa(box, b) > 0.5 or _ioa(b, box) > 0.5:
                    home = g
                    break
            if home is None:
                groups.append({"box": box, "cands": [(level, w)]})
            else:
                home["cands"].append((level, w))
    out = []
    for g in groups:
        by_str = {}
        for level, w in g["cands"]:
            # AGREEMENT KEY (owner's live batch 2026-08-27): the same code read as 'CT-9999544' / 'cT-9999544' /
            # 'CT-9999544_' at three levels is ONE string — case and edge punctuation are binarisation noise, not
            # evidence of a different value. Interior characters (the digits, the '-') must still agree exactly.
            key = _light_agree_key(w[4])
            if not key:
                continue
            e = by_str.setdefault(key, {"levels": set(), "best": w})
            e["levels"].add(level)
            if w[5] > e["best"][5]:
                e["best"] = w
        if not by_str:
            continue
        key, e = max(by_str.items(), key=lambda kv: (len(kv[1]["levels"]), kv[1]["best"][5]))
        digits = any(ch.isdigit() for ch in key)
        support = len(e["levels"])
        # SUPPORT-SCALED FLOOR: a digit string agreed by THREE OR MORE levels may stand at ≥ 70 (doc 1707's second
        # serial read 'CT-2903961' at 73 / 77 / 78 on three levels and was lost to the flat 80); two levels still
        # need 80 (the one-level garble class carried 80–86, and a two-level pair at 61/70 was genuinely ambiguous).
        floor = (_LIGHT_MIN_CONF_DIGIT if support < 3 else _LIGHT_MIN_CONF_DIGIT_AGREED) if digits else _LIGHT_MIN_CONF
        if (digits and support < 2) or e["best"][5] < floor:
            # a REFUSED digit spot keeps its candidate strings for the slot ladder (a second RECIPE — the ⊕ crop
            # reader — may agree with one of them; see _light_slot_ladder). Alpha refusals are not retried.
            if digits and rejected_out is not None:
                rejected_out.append({"box": g["box"], "by_key": {k: v["best"] for k, v in by_str.items()}})
            continue
        best = e["best"]
        cleaned = _light_clean_text(best[4])
        out.append(best if cleaned == best[4] else (best[0], best[1], best[2], best[3], cleaned, best[5]))
    return out


_LIGHT_EDGE_PUNCT = "_\"'`~*|"      # binarisation debris only — NEVER ':' '.' ',' ';' (real caption characters: 'No:', 'No.', 'Ltd,')


def _light_clean_text(txt: str) -> str:
    """Strip binarisation debris from the EDGES of a recovered token ('CT-9999544_' → 'CT-9999544', '"Serial' →
    'Serial'); interior characters and real punctuation ('No:') are never touched."""
    return str(txt or "").strip().strip(_LIGHT_EDGE_PUNCT)


def _light_agree_key(txt: str) -> str:
    return _light_clean_text(txt).casefold()


def _light_text_pass(img, base, med_h, dpi=None) -> list:
    """Run the threshold pass at every level on the SAME page bitmap and return the merged surviving words (the base
    6-tuple shape). Skips: an already-binary input; a frame mismatch (the merge is only valid in one pixel frame)."""
    g = img if getattr(img, "mode", "") == "L" else ImageOps.grayscale(img)
    if _is_binary_image(g):
        return []
    per_level = []
    for level in _light_levels():
        light_img = g.point(lambda p, L=level: 0 if p < L else 255)
        if light_img.size != img.size:
            return []
        data = pytesseract.image_to_data(light_img, config=_with_dpi(_LIGHT_CONFIG, dpi),
                                         output_type=pytesseract.Output.DICT)
        light = _words_from_data(data)
        if not light:
            continue
        # unfloored here: the merge counts a sub-floor read of the SAME string as agreement, then floors the winner
        per_level.append((level, _light_survivors(light, base, med_h, img.size[0], light_img, min_conf=0, min_conf_digit=0)))
    if not per_level:
        return []
    rejected = []
    kept = _merge_light_levels(per_level, rejected_out=rejected)
    if len(kept) > max(_LIGHT_CAP_ABS, _LIGHT_CAP_FRAC * len(base)):
        return []
    if kept and rejected:
        kept = kept + _light_slot_ladder(g, kept, rejected, med_h, img.size[0])
    return kept


# ── THE SLOT LADDER (owner's observation 2026-08-27: "in Review the third Serial No: line is readable by a box draw,
# but only two were detected on import"). The ⊕ / draw-box reader (ocr.region_core.process — greyscale + LANCZOS
# upscale, PSM 7/6, NO hard threshold) read every value slot the four-level pass had refused on the owner's residual
# docs: 'CT-8668378', 'CT-3913688' (exactly the strings the levels had seen below agreement) and 'T-9802341' (a
# partial). So: for each recovered light ROW that ends in a caption ('… No:') with NOTHING to its right, crop the
# value slot as an operator would and read it with that SAME shared ladder — and accept the read ONLY when it
# agrees (normalised) with one of the level candidates the merge refused on that spot. Two independent RECIPES
# agreeing is the evidence; a ladder read with no level candidate to agree with (or a partial like 'T-9802341')
# adds nothing. One small crop OCR per empty caption slot; never runs when the pass is OFF.
_SLOT_SPAN_MEDH = 28      # value slot width to the right of the caption, in med_h units (~450 px at 200 DPI)


def _slot_ladder_read(crop) -> str:
    """The ⊕ / draw-box reader on a greyscale crop — ONE shared recipe (region_core.process), so the pass reads a
    slot exactly as the operator's box would. Monkeypatched in the pins."""
    try:
        from ocr import region_core
    except ImportError:
        import region_core   # embeddable-python sibling import (see region.py)
    try:
        return str((region_core.process(crop) or {}).get("text") or "").strip()
    except Exception:
        return ""


def _light_slot_ladder(g, kept, rejected, med_h, page_w) -> list:
    added = []
    _, cap, band = _row_params(med_h)
    for lr in _build_rows(kept, med_h):
        ws = sorted(lr["words"], key=lambda w: w[0])
        last = ws[-1]
        if not last[4].endswith(":"):
            continue                                   # not a caption row
        top = min(w[1] for w in ws); bot = max(w[1] + w[3] for w in ws)
        x0 = last[0] + last[2] + 3
        x1 = min(page_w, x0 + int(_SLOT_SPAN_MEDH * med_h))
        if x1 - x0 < 4 * med_h:
            continue
        cands = [r for r in rejected
                 if x0 <= r["box"][0] + r["box"][2] / 2.0 <= x1
                 and top - band <= r["box"][1] + r["box"][3] / 2.0 <= bot + band]
        if not cands:
            continue                                   # nothing the levels ever saw there — no second witness possible
        try:
            crop = g.crop((x0, max(0, top - 6), x1, bot + 6))
        except Exception:
            continue
        txt = _slot_ladder_read(crop)
        if not txt or " " in txt or len(txt) > 32:
            continue
        key = _light_agree_key(txt)
        if not key or not any(ch.isdigit() for ch in key):
            continue
        for r in cands:
            best = r["by_key"].get(key)
            if best is None:
                continue
            cleaned = _light_clean_text(best[4])
            added.append(best if cleaned == best[4] else (best[0], best[1], best[2], best[3], cleaned, best[5]))
            break
    return added


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
    return _rows_to_lines(_build_rows(words, med_h), med_h, rows_out=rows_out)


# The row build was split into _row_params / _row_eligible / _build_rows / _place_in_rows / _rows_to_lines
# (2026-08-27, light-text recovery — 007's placement condition): the LIGHT pass must put its recovered
# words INTO the rows the base words already formed, not re-run the seeding over the union (a light word
# that seeded its own anchor could steal a tall base word in PASS 2 and move a base line). The logic of
# every piece is the old single function's, unchanged — pinned byte-identical in tests/test_light_text_recovery.py.
_ROW_OV = 0.3                          # box-overlap fraction that counts as "significant" (same line)

def _row_params(med_h):
    """The three DPI-stable row constants: (col_gap, cap, band)."""
    col_gap = max(med_h * 1.5, 12)    # x-gap wide enough to be a column break (4-space)
    cap     = max(med_h * 1.2, 10)    # centres farther than this = DIFFERENT rows (hard backstop)
    band    = max(med_h * 0.6, 6)     # within this of a row's FROZEN centre = same row (OR clause)
    return col_gap, cap, band


def _row_eligible(wd, a, band, cap):
    top_w, bot_w = wd[1], wd[1] + wd[3]
    overlap = min(bot_w, a["bot"]) - max(top_w, a["top"])
    shorter = min(wd[3], a["bot"] - a["top"]) or 1
    d = abs((wd[1] + wd[3] / 2.0) - a["yc"])
    sig = overlap >= _ROW_OV * shorter
    return ((sig or d <= band) and d <= cap), sig, overlap, d


def _place_in_rows(rows, wd, band, cap):
    """Assign ONE word to its BEST row (overlap-first; centre only as tie-break) or open a new row
    (pathological rounding only — never lose a word)."""
    best, best_key = None, None
    for r in rows:
        ok, sig, overlap, d = _row_eligible(wd, r, band, cap)
        if not ok:
            continue
        key = (1 if sig else 0, overlap, -d)
        if best is None or key > best_key:
            best, best_key = r, key
    if best is None:
        rows.append({"top": wd[1], "bot": wd[1] + wd[3], "yc": wd[1] + wd[3] / 2.0, "words": [wd]})
    else:
        best["words"].append(wd)


def _build_rows(words, med_h):
    """PASS 1 — discover the anchor SET (the frozen seeding rule); PASS 2 — assign EVERY word to its best
    anchor over the FULL set (removes the visit-order bias). Returns the non-empty rows top-to-bottom."""
    _, cap, band = _row_params(med_h)
    sw = sorted(words, key=lambda w: w[1] + w[3] / 2.0)         # deterministic top-to-bottom
    anchors = []
    for wd in sw:
        if not any(_row_eligible(wd, a, band, cap)[0] for a in anchors):
            anchors.append({"top": wd[1], "bot": wd[1] + wd[3], "yc": wd[1] + wd[3] / 2.0})
    rows = [{"top": a["top"], "bot": a["bot"], "yc": a["yc"], "words": []} for a in anchors]
    for wd in sw:
        _place_in_rows(rows, wd, band, cap)
    rows = [r for r in rows if r["words"]]                      # drop any anchor that ended up empty
    rows.sort(key=lambda r: r["yc"])
    return rows


def _rows_to_lines(rows, med_h, rows_out=None):
    col_gap, _, _ = _row_params(med_h)
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


def _group_words_into_lines_with_light(base, light, med_h, rows_out=None):
    """ROWS-FIRST placement of the light-text survivors (007, 2026-08-27): the base rows are built EXACTLY
    as _group_words_into_lines builds them (same words, same frozen med_h), then each recovered word joins
    its best EXISTING row by the same eligibility key or opens its own. A base row can only ever GAIN a
    word (inserted in x order) — never lose one, never re-split — so every OFF line is a subsequence of
    its ON line and a page that recovers nothing is byte-identical."""
    rows = _build_rows(base, med_h)
    _, cap, band = _row_params(med_h)
    # Light words are placed as LINES, not one word at a time (owner's live batch 2026-08-27, doc 1721): a lone base
    # qty '1' whose box sat 11 px above the serial line captured the light 'Serial' (box overlap) but not 'No:' or the
    # code (centre distance past the band) — the caption split from its value across two rows and the collector read
    # nothing. The light words first form their OWN rows (the same seeding rule); each light row then joins the best
    # base row as a unit, judged by the row's union box, or opens a new row.
    for lr in _build_rows(light, med_h):
        top = min(w[1] for w in lr["words"]); bot = max(w[1] + w[3] for w in lr["words"])
        pseudo = (0, top, 0, bot - top)
        best, best_key = None, None
        for r in rows:
            ok, sig, overlap, d = _row_eligible(pseudo, r, band, cap)
            if not ok:
                continue
            key = (1 if sig else 0, overlap, -d)
            if best is None or key > best_key:
                best, best_key = r, key
        if best is None:
            rows.append({"top": top, "bot": bot, "yc": (top + bot) / 2.0, "words": list(lr["words"])})
        else:
            best["words"].extend(lr["words"])
    rows.sort(key=lambda r: r["yc"])
    return _rows_to_lines(rows, med_h, rows_out=rows_out)


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
    # LIGHT-TEXT RECOVERY (DARK — see _light_text_pass). Runs AFTER the PSM-6 merge so it dedupes against
    # BOTH base passes, against the FROZEN base med_h, and its survivors are placed INTO the base rows
    # rather than re-clustered with them (007's three placement conditions). Additive-only and best-effort:
    # any failure leaves the base result exactly as it was.
    light_kept = []
    if _light_text_enabled():
        try:
            light_kept = _light_text_pass(img, words, med_h, dpi=dpi)
        except Exception:
            light_kept = []
    light_replaced = []
    if light_kept:
        # A DEGENERATE base word (shorter than the page's own word floor — a 5-px sliver the PSM-6 pass read as a
        # code at conf 87) that a recovered light word sits on is debris by the same rule the light words must pass:
        # it leaves the row so the recovered word is not doubled by it ('CT-8328847 CT-832884'). The ONLY case a base
        # word ever yields to the light pass; reported in words_out["light_replaced"].
        _h_floor = max(6, _LIGHT_H_MIN * med_h)
        for w in words:
            if w[3] < _h_floor:
                b = (w[0], w[1], w[2], w[3])
                if any(_center_in_any(lw, [b]) or _ioa(b, (lw[0], lw[1], lw[2], lw[3])) > 0.5 for lw in light_kept):
                    light_replaced.append(w)
        if light_replaced:
            _rep = set(light_replaced)
            words = [w for w in words if w not in _rep]
        lines = _group_words_into_lines_with_light(words, light_kept, med_h, rows_out=_rows)
    else:
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
        words_out["words"] = words          # BASE words only [(left, top, w, h, text, conf)] — the geometry CONTRACT
                                            # (Oracle C1 2026-08-27): the heading-band pre-gate ranks `words` by height
                                            # in the top band, so a light word there must never become a banner candidate
        words_out["med_h"] = med_h          # the DPI-invariant scale reference (BASE words only — frozen): compare RATIOS to it
        words_out["lines"] = lines          # the same visual rows the returned text is built from
        words_out["rows"] = _rows           # per-row word tuples, PARALLEL to `lines` (rows_out) — light words included
        words_out["size"] = getattr(img, "size", None)
        if light_kept:                      # provenance of the light-text pass (absent when OFF / nothing recovered)
            words_out["light_words"] = list(light_kept)                          # the recovered 6-tuples
            words_out["light_boxes"] = [(w[0], w[1], w[2], w[3]) for w in light_kept]
            if light_replaced:
                words_out["light_replaced"] = list(light_replaced)               # degenerate base slivers that yielded
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
