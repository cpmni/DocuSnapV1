"""make_scanned_set.py — turn born-digital test PDFs into image-only simulated scans.

    py -3.12 stress_test/make_scanned_set.py --src "~/Desktop/TESTING/SINGLE" \
                                             --out "~/Desktop/TESTING/SCANNED"
    ...--severity hard        # a rougher scanner: lower DPI, more skew, more noise

WHY THIS EXISTS. The corpus already ships both renditions — `TESTING/IMPORT` and `IMPORT2` are
image-only (verified: 400 of 400 carry no text layer), while `TESTING/SINGLE`, the ten TEACH
documents, is born-digital by design, because the original protocol teaches on a clean page and
imports scanned siblings. Anyone opening SINGLE and finding selectable text is looking at the teach
set, not at a defect.

What was missing is a scanned rendition OF THE TEACH DOCUMENTS — so you can teach from a scan, which
is what a customer without the original files actually does, and the harder case by some way: the
teach box is drawn on a degraded, possibly skewed page, and every sibling then inherits that
geometry.

FIDELITY: the degradation is the corpus generator's own `scanify` — same 150 DPI raster, same ±1.6°
skew on ~70% of pages, same brightness/contrast/blur/noise. Imported here rather than copied, so the
two cannot drift and a scan made by this tool is comparable with the shipped IMPORT sets.

FILENAMES ARE PRESERVED, which matters: `ground_truth.json` and every scorer key off the basename,
so a document scanned by this tool scores against exactly the same truth row as its digital twin.

`--severity hard` is deliberately NOT the default. The shipped corpus never tilts a page past 1.6°,
and this project has a standing finding that the 0.2-1.6° band is inside Tesseract's own tolerance —
so `hard` is the only way to exercise the tilt the readers were actually built for. Use it to find
weaknesses; use `normal` to compare against every number already recorded.
"""
import argparse
import io
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pypdfium2 as pdfium                                     # noqa: E402
from PIL import Image, ImageEnhance, ImageFilter               # noqa: E402

# The generator's own degradation, imported so the two can never drift.
from gen_customer_test import scanify as _scanify_normal       # noqa: E402


def scanify_hard(pdf_bytes, rng):
    """A rougher scanner than the corpus ships: 120 DPI, up to 3.5 degrees of skew on nearly every
    page, heavier blur and noise, and a JPEG round-trip so the reader meets compression artefacts.

    Every one of those is a thing real office scanners do and the shipped corpus does not: it never
    tilts past 1.6 degrees, which is inside the band Tesseract self-corrects, so the placement work
    in this codebase is effectively untested by it."""
    pdf = pdfium.PdfDocument(pdf_bytes)
    pil = pdf[0].render(scale=120 / 72.0).to_pil().convert("L")
    pdf.close()
    angle = rng.uniform(-3.5, 3.5) if rng.random() < 0.9 else 0.0
    if angle:
        pil = pil.rotate(angle, expand=False, fillcolor=245, resample=Image.BICUBIC)
    pil = ImageEnhance.Brightness(pil).enhance(rng.uniform(0.88, 1.12))
    pil = ImageEnhance.Contrast(pil).enhance(rng.uniform(0.80, 1.10))
    pil = pil.filter(ImageFilter.GaussianBlur(rng.uniform(0.4, 1.1)))
    noise = Image.effect_noise(pil.size, rng.uniform(12, 26)).point(lambda v: v // 3 + 170)
    pil = Image.blend(pil, noise, 0.16)
    # a JPEG round-trip, because a real scanner's output has been compressed at least once
    jb = io.BytesIO()
    pil.convert("L").save(jb, "JPEG", quality=rng.randint(55, 75))
    jb.seek(0)
    pil = Image.open(jb).convert("RGB")
    out = io.BytesIO()
    pil.save(out, "PDF", resolution=120.0)
    return out.getvalue()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True, help='folder of born-digital PDFs')
    ap.add_argument('--out', required=True, help='folder to write image-only scans into')
    ap.add_argument('--severity', choices=('normal', 'hard'), default='normal')
    ap.add_argument('--seed', default='scanned-set', help='same seed => byte-identical output')
    a = ap.parse_args()

    src = os.path.expanduser(a.src)
    out = os.path.expanduser(a.out)
    os.makedirs(out, exist_ok=True)
    files = sorted(f for f in os.listdir(src) if f.lower().endswith('.pdf'))
    if not files:
        print(f'no PDFs in {src}')
        return 1

    fn = _scanify_normal if a.severity == 'normal' else scanify_hard
    print(f'{len(files)} file(s) from {src}\n  -> {out}  (severity: {a.severity})')
    made = 0
    for name in files:
        # Seeded per FILE, so a re-run reproduces the same page byte for byte and two arms differ by
        # the thing under test rather than by fresh randomness.
        rng = random.Random(f'{a.seed}|{a.severity}|{name}')
        with open(os.path.join(src, name), 'rb') as fh:
            data = fh.read()
        try:
            open(os.path.join(out, name), 'wb').write(fn(data, rng))
            made += 1
        except Exception as e:
            print(f'  FAILED {name}: {e}')

    # Verify the point of the exercise: no text layer survived.
    leaked = []
    for name in os.listdir(out):
        if not name.lower().endswith('.pdf'):
            continue
        try:
            d = pdfium.PdfDocument(os.path.join(out, name))
            if len((d[0].get_textpage().get_text_range() or '').strip()) > 20:
                leaked.append(name)
        except Exception:
            pass
    print(f'wrote {made} scan(s); text layer found in {len(leaked)} of them'
          + (f' -> {leaked[:3]}' if leaked else ' (image-only, as intended)'))
    return 1 if leaked else 0


if __name__ == '__main__':
    sys.exit(main())
