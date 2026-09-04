"""
extraction/reslice.py — the RE-SLICE WITNESS reader (2026-08-30, owner arc; oscar recipe + 007 geometry +
reggie STOP predicate → Oracle). DARK: consumed only by engine._reslice_witness_sweep behind
RESLICE_WITNESS_SWEEP.

WHAT IT IS. A noted money field whose committed value is already corroborated by arithmetic (subtotal +
tax = total, penny-exact) can still be held forever when the ONLY crop-side read of its taught zone is a
plausible garble — the Nordwind 0023 exhibit: the taught total box (134×38 px at 200 DPI) reads
`29,242.76` @90 through the product ladder; the full-page keyword reads `2,363.76`; the reconciliation
pick swaps to the keyword value with its "please verify" note, and the Oracle-signed demoter that could
release it (`_demote_recon_total_corroborated_note`) requires a CROP-SIDE witness — which does not exist.

WHAT IT DOES. Re-read the zone the mapper actually read with a DIFFERENT recipe and, ONLY if a rung
reads a strict-shape amount cents-equal (and sign-equal) to the COMMITTED value, hand that read back as
a witness. It commits nothing, never returns a disagreeing read, and abstains on any ambiguity.

THE RECIPE (measured on the product read path over the 20 Nordwind total boxes, 2026-08-30):
  R8  pad 0.5×h vertically AND horizontally, NO upscale, 20 px white border, PSM 6 `image_to_data`,
      IN-BAND line pick — 20/20 exact incl. 0023 (`£2,363.76` @92), 0 format-valid wrong reads.
  R7  the same with the vertical pad at 1.0×h — also 20/20 (the row above rides in; the pick keeps it out).
Every padded PSM-7 rung measured 15/20 with WRONG DIGITS at conf 22-70 (scale-phase fragile), and the
shipped ×2 `_prep` upscale reads '' on 0023 — which is why (a) PSM 7 and upscales are not rungs and (b) a
re-read is only ever a corroboration-gated WITNESS, never a replacement read.

IN-BAND PICK. Lines come from `anchor._read_lines_full` (PSM 6, per-line geometry in the prepped frame).
A line qualifies iff its y-band overlaps the ORIGINAL box band by >= 50 % of the LINE's height. Exactly ONE
qualifier is read; zero or >= 2 → abstain (never nearest-wins — an ambiguous crop is a review problem).
The money token is the LAST strict-shape token on the line (a totals row reads "caption … value").
"""
import os
import re
from typing import Callable, Optional

from PIL import Image, ImageOps

from extraction import number_format as _nf

# Ladder rungs: (name, vertical pad, horizontal pad) as fractions of the box HEIGHT on every side.
RUNGS = (("R8", 0.5, 0.5), ("R7", 1.0, 0.5))
BORDER_PX = 20
_MAX_TRIES_DEFAULT = 2
# Minimum crop size (px) below which the read is not attempted.
_MIN_CROP = 4


def max_tries() -> int:
    try:
        n = int(os.environ.get("RESLICE_MAX_TRIES", str(_MAX_TRIES_DEFAULT)) or _MAX_TRIES_DEFAULT)
    except (TypeError, ValueError):
        n = _MAX_TRIES_DEFAULT
    return max(1, min(n, len(RUNGS)))


def _crop_padded(page, box, vpad, hpad):
    """Crop `box` ({x,y,w,h}_norm) from `page` grown by (vpad, hpad) × box height on every side.
    Returns (crop, band) where band = (y0, y1) of the ORIGINAL box inside the crop, in crop px."""
    W, H = page.size
    x, y, w, h = (float(box["x_norm"]), float(box["y_norm"]), float(box["w_norm"]), float(box["h_norm"]))
    bh_px = h * H
    padx = int(hpad * bh_px)
    pady = int(vpad * bh_px)
    x0 = max(0, int(x * W) - padx)
    y0 = max(0, int(y * H) - pady)
    x1 = min(W, int((x + w) * W) + padx)
    y1 = min(H, int((y + h) * H) + pady)
    if x1 - x0 < _MIN_CROP or y1 - y0 < _MIN_CROP:
        return None, None
    crop = page.crop((x0, y0, x1, y1)).convert("L")
    band = (int(y * H) - y0, int((y + h) * H) - y0)
    return crop, band


def prep(crop):
    """R8/R7 prep: NO upscale, a plain white quiet zone. (Measured: the upscaling preps mis-read 0023.)"""
    return ImageOps.expand(crop.convert("L"), border=BORDER_PX, fill=255)


def pick_in_band_line(lines, band, border_px=BORDER_PX):
    """The ONE line whose y-band overlaps the original box band by >= 50 % of the line's height, else None.
    `lines` are `_read_lines_full` per-line dicts in the PREPPED frame (top/height); `band` is in CROP px,
    so the border offset is added here."""
    if not lines or band is None:
        return None
    b0, b1 = band[0] + border_px, band[1] + border_px
    q = []
    for ln in lines:
        top = ln.get("top")
        height = ln.get("height")
        if top is None or height is None:
            continue
        y0, y1 = int(top), int(top) + int(height)
        lh = max(1, y1 - y0)
        overlap = max(0, min(y1, b1) - max(y0, b0))
        if overlap >= 0.5 * lh:
            q.append(ln)
    return q[0] if len(q) == 1 else None


def money_token(text, words=None):
    """The ONE money value on a line → (token, token_conf) or None.
    Oracle C3 (2026-08-30): EXACTLY ONE strict-shape amount may be present on the picked line — a two-amount
    line ("1,969.80  2,363.76", a tight Net/Gross layout or a box on the Net column) ABSTAINS, else the
    witness could vouch for the committed gross from the NEIGHBOURING column (provenance fraud even when
    the value is right). The tail is also tried respaced (3, 2 trailing tokens through the shipped
    respacing cleaner) so an OCR-split amount ("Total 2 363.76" → "2,363.76") is rejoined rather than
    truncated to its last group. A garbled tail ("£9 32632.76") yields its last strict token ("32632.76")
    — harmless: the STOP predicate (cents-equal to the committed value) admits a witness, never this picker.
    Oracle C4: `words` = the line's per-word (text, conf); the returned conf is the MIN over the words that
    formed the token — the amount's own confidence, not the caption-diluted line mean."""
    toks = [t for t in re.split(r"\s+", str(text or "").strip()) if t]
    if not toks:
        return None
    confs = {}
    if words:
        for wt, wc in words:
            try:
                confs.setdefault(str(wt), float(wc))
            except (TypeError, ValueError):
                pass
    # (1) an OCR-SPLIT trailing amount ("Total 2 363.76" → "2,363.76"): the tail is ONE amount when the
    #     shipped respacing cleaner rejoins it into a strict shape AND nothing before the tail is an amount.
    #     A genuine two-amount line ("1,969.80 2,363.76") never rejoins (no 3-digit group follows the gap).
    for n in (3, 2):
        if len(toks) < n:
            continue
        cand = _nf.normalise_currency_spacing(" ".join(toks[-n:]))
        if cand != " ".join(toks[-n:]) and _nf.money_strict_shape(cand):
            if any(_nf.money_strict_shape(t) for t in toks[:-n]):
                return None                            # C3: another amount before the tail → abstain
            c = [confs.get(t) for t in toks[-n:] if confs.get(t) is not None]
            return cand, (min(c) if c else 0.0)
    # (2) exactly ONE strict-shape token on the line, else abstain (C3)
    strict_idx = [i for i, t in enumerate(toks) if _nf.money_strict_shape(t)]
    if len(strict_idx) != 1:
        return None
    i = strict_idx[0]
    return toks[i], confs.get(toks[i], 0.0)


def witness_agrees(read_value, committed_value) -> bool:
    """STOP predicate for money: BOTH strict-shape AND cents-equal AND sign-equal."""
    a = _nf.money_cents(read_value)
    b = _nf.money_cents(committed_value)
    return bool(a and b and a == b)


def read_money_witness(page, box, committed_value, read_lines_fn: Optional[Callable] = None,
                       tries: Optional[int] = None):
    """Run the ladder on `page` at `box` looking for a read that CORROBORATES `committed_value`.
    Returns {'value', 'confidence', 'rung', 'line'} for the FIRST agreeing rung, else None.
    `read_lines_fn(img, psm) -> (text, mean_conf, min_conf, lines)` defaults to anchor._read_lines_full
    (a test injects a stub). Never raises."""
    if page is None or not box or not committed_value:
        return None
    if read_lines_fn is None:
        from extraction.anchor import _read_lines_full as read_lines_fn   # lazy: anchor is heavy
    n = tries if tries is not None else max_tries()
    for name, vpad, hpad in RUNGS[:n]:
        try:
            crop, band = _crop_padded(page, box, vpad, hpad)
            if crop is None:
                continue
            _text, _conf, _mn, lines = read_lines_fn(prep(crop), 6)
            line = pick_in_band_line(lines, band)
            if not line:
                continue
            picked = money_token(line.get("text"), line.get("words"))
            if not picked or not witness_agrees(picked[0], committed_value):
                continue
            tok, tok_conf = picked
            try:
                line_mean = float(line.get("mean_conf") or 0.0)
            except (TypeError, ValueError):
                line_mean = 0.0
            # Oracle C4: the witness carries the AMOUNT's own confidence, never a caption-inflated line mean
            conf = min(float(tok_conf or 0.0), line_mean) if line.get("words") else line_mean
            return {"value": tok, "confidence": int(round(conf)), "rung": name, "line": str(line.get("text") or "")}
        except Exception:
            continue
    return None


# ── CODE re-slice witness + positional consensus (2026-09-04; gary integration → Oracle Phase 2, ─────────
# REVIEW-BOUND). For a single-token REFERENCE/serial box whose crop read disagrees with the full-page
# read at exactly one same-length position, produce INDEPENDENT-RECIPE re-reads to break the tie. The
# engine has only the 200-DPI bitmap (no higher-DPI re-render), so independence comes from a DIFFERENT
# BINARISATION (007's #1 lever for a 5<->8 / 0<->O stroke-topology flip) — NOT a re-read of the same
# grayscale (a duplicate vote) and NOT a pixel shift (LSTM-normalised away). numpy (BSD-3) + scipy.ndimage
# (BSD-3), both already shipped; no new dependency. The witnesses NEVER enter _field_candidates — a
# reference is a filing key, and the corroboration record must stay byte-identical (Oracle Q3); only the
# separate pixel-source consensus below reads them.
import numpy as _np

_CODE_MAX_DEFAULT = 2
_CODE_TOKEN_RE = re.compile(r"[0-9A-Za-z][0-9A-Za-z\-/]{2,}")


def code_witness_max() -> int:
    try:
        n = int(os.environ.get("CODE_WITNESS_MAX", str(_CODE_MAX_DEFAULT)) or _CODE_MAX_DEFAULT)
    except (TypeError, ValueError):
        n = _CODE_MAX_DEFAULT
    return max(1, min(n, 2))


def _otsu_binarise(gray):
    """Global Otsu threshold -> a 0/255 'L' image. Pure numpy. Changes a glyph's stroke TOPOLOGY (whether
    the thin loop-closing stroke of an 8 survives), the lever that can flip a 5<->8 the grayscale ladder
    fixed one way."""
    a = _np.asarray(gray.convert("L"), dtype=_np.uint8)
    if a.size == 0:
        return gray
    hist = _np.bincount(a.ravel(), minlength=256).astype(_np.float64)
    total = float(a.size)
    idx = _np.arange(256, dtype=_np.float64)
    wB = _np.cumsum(hist)
    wF = total - wB
    sumB = _np.cumsum(idx * hist)
    sum_all = float(_np.dot(idx, hist))
    with _np.errstate(divide="ignore", invalid="ignore"):
        mB = _np.where(wB > 0, sumB / wB, 0.0)
        mF = _np.where(wF > 0, (sum_all - sumB) / wF, 0.0)
    between = wB * wF * (mB - mF) ** 2
    t = int(_np.argmax(between))
    return Image.fromarray(_np.where(a > t, 255, 0).astype(_np.uint8), mode="L")


def _adaptive_binarise(gray, block_frac=0.5, C=8):
    """Local adaptive-mean threshold via a vectorised box filter (scipy.ndimage.uniform_filter). A
    genuinely DIFFERENT threshold regime than global Otsu (a second, independent recipe)."""
    a = _np.asarray(gray.convert("L"), dtype=_np.float64)
    h, w = a.shape
    if h < 3 or w < 3:
        return gray
    from scipy import ndimage as _ndi
    size = max(3, int(block_frac * min(h, w)))
    size |= 1  # odd window
    local_mean = _ndi.uniform_filter(a, size=size, mode="reflect")
    return Image.fromarray(_np.where(a > (local_mean - C), 255, 0).astype(_np.uint8), mode="L")


def _read_code_token(img, read_lines_fn, psm):
    """One image_to_data pass -> (dominant code token, per-word conf) or (None, None)."""
    text, mean_c, min_c, _lines = read_lines_fn(img, psm)
    toks = _CODE_TOKEN_RE.findall(text or "")
    if not toks:
        return None, None
    tok = max(toks, key=len)
    conf = min_c if (min_c and min_c > 0) else mean_c
    return tok, conf


def read_code_witnesses(page, box, read_lines_fn, k=2):
    """Up to k INDEPENDENT-RECIPE re-reads of a single-token CODE box -> [{value, conf, recipe_key}].
    read_lines_fn = anchor._read_lines_full (one image_to_data pass, per-WORD conf; per-char is not
    trustworthy — Oracle C4). Reuses the measured R8 crop (pad 0.5xh, 20px white border, NO upscale).
    Deterministic; never raises; [] on a tiny/blank crop. Commits nothing — a WITNESS producer."""
    out = []
    try:
        crop, _band = _crop_padded(page, box, 0.5, 0.5)
        if crop is None:
            return out
        base = prep(crop)
        recipes = [("otsu", _otsu_binarise), ("adaptive", _adaptive_binarise)][:max(1, min(int(k), 2))]
        for name, fn in recipes:
            try:
                img = fn(base)
                val, conf = _read_code_token(img, read_lines_fn, 8)
                if not val:
                    val, conf = _read_code_token(img, read_lines_fn, 7)
                if val:
                    out.append({"value": val, "conf": float(conf or 0.0), "recipe_key": name})
            except Exception:
                continue
    except Exception:
        return []
    return out[:k]


def quantize_box(box, ndp=2):
    try:
        return (round(float(box["x_norm"]), ndp), round(float(box["y_norm"]), ndp),
                round(float(box["w_norm"]), ndp), round(float(box["h_norm"]), ndp))
    except (TypeError, KeyError, ValueError):
        return None


def source_key(box, recipe_key=None, dpi=200):
    """Pixel-source identity for the positional consensus (Oracle Q3 — independence is the PIXEL SOURCE,
    not the method family). Same crop-rect + same recipe -> same key (crop and mapping of one taught box
    collapse to ONE vote); each binarisation witness is a NEW source; a region-less read (box None, the
    full-page text pass) is the single ('page','text-pass') source."""
    if not box:
        return ("page", "text-pass")
    q = quantize_box(box)
    if q is None:
        return ("page", "text-pass")
    return (q, int(dpi), recipe_key or "gray-ladder")


def positional_consensus(voters):
    """Pure. voters = [{value, conf, source_key}]. Return the consensus string iff, after keeping the
    highest-conf read per DISTINCT source_key: (1) >= 3 distinct sources; (2) all reads EQUAL length;
    (3) every position has a STRICT majority glyph (> half the sources); (4) the assembled string EQUALS
    at least one voter's read (NEVER a synthesised novel token). Else None. A REVIEW-BOUND decision only
    — the caller keeps a note + <=70 cap; it NEVER auto-files (Oracle Phase 2)."""
    best = {}
    for v in (voters or []):
        sk = v.get("source_key")
        val = (v.get("value") or "").strip()
        if sk is None or not val:
            continue
        if sk not in best or float(v.get("conf") or 0) > float(best[sk].get("conf") or 0):
            best[sk] = {"value": val, "conf": float(v.get("conf") or 0)}
    reads = list(best.values())
    if len(reads) < 3:
        return None
    if len({len(r["value"]) for r in reads}) != 1:
        return None
    n = len(reads)
    L = len(reads[0]["value"])
    result = []
    for i in range(L):
        counts = {}
        for r in reads:
            ch = r["value"][i]
            counts[ch] = counts.get(ch, 0) + 1
        ch, c = max(counts.items(), key=lambda kv: kv[1])
        if c * 2 <= n:            # not a strict majority
            return None
        result.append(ch)
    s = "".join(result)
    return s if any(r["value"] == s for r in reads) else None
