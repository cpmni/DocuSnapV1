"""probe_crop_recipes.py — read ONE saved crop under every prep the ladder uses, plus the
binarisation variants, printing each one's TEXT and its MEAN WORD CONFIDENCE side by side.

WHY THIS EXISTS (2026-08-10). The Pelican `I`->`1` misread is not placement, drift or a bad taught
box: the crop is a clean, legible `PI/26/6000` that a human reads at a glance. It is the OCR ladder
RANKING ITS RUNGS BY A NUMBER THAT IS NOT COMPARABLE ACROSS PREPROCESSING RECIPES. The correct read
IS produced — by the raw/light rung — and is then discarded because a sharpened rung is more
CONFIDENTLY WRONG (`anchor.py:3304`, `if rseg and rconf > best_conf`).

So this probe deliberately prints confidence NEXT TO correctness, because the finding is that the
two are uncorrelated here: binarised variants score 79-85 while wrong; raw scores 45-56 while right.

It also answers the owner's question of 2026-08-10 — "would converting the doc to 2-bit B&W help?"
— with a measurement rather than an opinion. It does not: Tesseract/Leptonica already binarise
internally with an ADAPTIVE threshold, so a global pre-threshold only discards the antialiasing
grey that separates a serif `I` from a digit `1`, and PIL's dithering `convert('1')` is worse again.

  py -3.12 stress_test/probe_crop_recipes.py <slice.png> [more.png ...]

Feed it any crop the dev trace saved (trace event `slice`, `"kind":"target"`) — e.g. from
`stress_test/trace_one_doc.js <doc> <field>`. Read-only; touches no DB and no settings.
"""
import sys

sys.path.insert(0, __file__.rsplit("stress_test", 1)[0] + "python_backend")

from PIL import Image, ImageOps                                    # noqa: E402
import pytesseract                                                 # noqa: E402

pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

from extraction.anchor import _light_prep, _struct_prep            # noqa: E402
from extraction import template_mapper as _tm                      # noqa: E402

# What "right" looks like, so the output is scannable. Override for another exhibit.
EXPECT_PREFIX = "PI"


def _otsu(g):
    """Global Otsu threshold. Hand-rolled so the probe needs no new dependency."""
    h = g.histogram()
    total = sum(h)
    sum_all = sum(i * h[i] for i in range(256))
    sum_b = w_b = 0
    best = (0.0, 0)
    for t in range(256):
        w_b += h[t]
        if w_b == 0:
            continue
        w_f = total - w_b
        if w_f == 0:
            break
        sum_b += t * h[t]
        between = w_b * w_f * ((sum_b / w_b) - ((sum_all - sum_b) / w_f)) ** 2
        if between > best[0]:
            best = (between, t)
    return best[1]


def _read(img, psm=7):
    """Text + mean word confidence, the same pair `_read_lines_full` ranks rungs on."""
    cfg = f"--oem 3 --psm {psm}"
    txt = pytesseract.image_to_string(img, config=cfg).strip().split("\n")[0].strip()
    d = pytesseract.image_to_data(img, config=cfg, output_type=pytesseract.Output.DICT)
    confs = [int(c) for c, w in zip(d["conf"], d["text"]) if str(w).strip() and int(c) >= 0]
    return txt, (sum(confs) / len(confs) if confs else -1.0)


def variants(crop):
    """The ladder's own preps first, then the binarisation ideas, so they are compared on
    equal terms against what production actually runs."""
    g = ImageOps.grayscale(crop)
    t = _otsu(g)
    g2 = g.resize((g.width * 2, g.height * 2), Image.LANCZOS)
    yield "raw greyscale", g
    yield "light (ladder)", _light_prep(crop)
    yield "heavy (_prep)", _tm._prep(crop)
    try:
        yield "struct (_struct_prep)", _struct_prep(crop)
    except Exception as e:                      # slice-1 prep may be absent in an older tree
        print(f"  (struct prep unavailable: {e})")
    yield f"1-bit Otsu (t={t})", g.point(lambda p: 255 if p > t else 0, mode="L")
    yield "1-bit Otsu, x2 first", g2.point(lambda p: 255 if p > _otsu(g2) else 0, mode="L")
    yield "PIL convert('1') dither", g.convert("1")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    for p in sys.argv[1:]:
        print(f"\n=== {p}")
        crop = Image.open(p)
        rows = []
        for name, img in variants(crop):
            for psm in (7, 6):
                txt, conf = _read(img, psm)
                rows.append((name, psm, img.size, conf, txt))
        for name, psm, size, conf, txt in rows:
            if psm != 7:
                continue                        # PSM 6 printed only when it disagrees
            mark = ("CORRECT" if txt.startswith(EXPECT_PREFIX)
                    else ("WRONG" if txt else "empty"))
            print(f"  {name:24} psm7 {str(size):11} conf={conf:5.1f}  {txt!r:22} {mark}")
        dis = [(n, s, c, t) for n, ps, s, c, t in rows if ps == 6
               and t != next(tt for nn, pp, _, _, tt in rows if nn == n and pp == 7)]
        for n, s, c, t in dis:
            print(f"    (psm6 differs on {n}: {t!r} conf={c:.1f})")
    print("\nREAD THE CONFIDENCE COLUMN AGAINST THE VERDICT COLUMN. Where a WRONG row outscores a")
    print("CORRECT one, the ladder's best-by-confidence pick (anchor.py:3304) commits the wrong read.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
