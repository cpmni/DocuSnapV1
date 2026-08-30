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
