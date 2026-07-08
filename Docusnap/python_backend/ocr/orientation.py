"""
ocr/orientation.py — page orientation detection (90/180/270) via Tesseract OSD.

Distinct from ocr/tesseract.py `_deskew` (±15° micro-skew): this catches a page scanned
SIDEWAYS or UPSIDE-DOWN. Uses Tesseract's Orientation & Script Detection (`--psm 0`), which
needs only `osd.traineddata` (bundled, Apache-2.0) — no text recognition, no new dependency.

CONVENTION (proven, see tests/test_orientation.py): Tesseract's `rotate` is the number of
degrees to turn the image CLOCKWISE to make it upright. Callers correct with:
  * PIL (counter-clockwise lib):  img.rotate(360 - r, expand=True)   # == rotate(-r)
  * pypdf (clockwise, additive):  page.rotate(r)                     # verbatim, no sign flip
Getting these signs wrong corrupts every rotated document — the round-trip tests prove them.
"""

import pytesseract
from pytesseract import Output

_VALID = {0, 90, 180, 270}

# OSD's orientation_conf is a ratio; >~1.5 is usable, 2.0 is conservative. Below this (or an
# OSD failure / too-little-text page) we return 0 = leave the page as-is, never guess.
DEFAULT_MIN_CONF = 2.0

# Cap the OSD input width (~120 DPI): orientation needs coarse layout, not detail, so a
# downscaled copy is several times faster with no accuracy loss (mirrors the locate-pass trick).
_OSD_MAX_WIDTH = 1100


def _downscaled(img):
    try:
        w, h = img.size
        if w > _OSD_MAX_WIDTH:
            s = _OSD_MAX_WIDTH / float(w)
            return img.resize((_OSD_MAX_WIDTH, max(1, int(h * s))))
        return img
    except Exception:
        return img


def detect_rotation(img, min_conf: float = DEFAULT_MIN_CONF) -> int:
    """Clockwise degrees (0/90/180/270) needed to make `img` upright.

    Returns 0 (do nothing) on low confidence, too-little-text, or any OSD failure — the safe
    default, so a sparse/ambiguous page is never rotated. `tesseract_cmd` must already be set
    by the caller (ocr/tesseract.py does this at import)."""
    try:
        osd = pytesseract.image_to_osd(_downscaled(img), output_type=Output.DICT, config="--psm 0")
    except Exception:
        return 0  # OSD raises "Too few characters. Skipping this page." on low-text pages
    try:
        rotate = int(osd.get("rotate", 0) or 0)
        conf   = float(osd.get("orientation_conf", 0) or 0)
    except (TypeError, ValueError):
        return 0
    if rotate not in _VALID or rotate == 0:
        return 0
    if conf < min_conf:
        return 0
    return rotate


def correct_image(img, rotate: int):
    """Apply the PIL correction for an OSD `rotate` (clockwise-to-upright) value. Pure helper."""
    if not rotate:
        return img
    return img.rotate(360 - rotate, expand=True)
