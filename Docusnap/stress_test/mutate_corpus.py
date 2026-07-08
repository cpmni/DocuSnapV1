"""
mutate_corpus.py — ADVERSARIAL degradation pass.

Renders the same 5 suppliers x 3 doc types as gen_corpus, but as HEAVILY degraded scans
(low resolution + strong noise/blur + bigger rotation) so OCR sometimes MIS-READS. This
makes the silent-mis-file / crop-drift class REPRODUCIBLE in the harness — it does not
appear on the clean corpus, where every stage is precision-perfect. Each doc carries its
own ground truth, so precision is measured honestly.

Point the harness at it (learning stays the clean stress.db — "learned clean, tested hard"):
   CORPUS=stress_test/corpus_hard ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron stress_test/analyze.js
   CORPUS=stress_test/corpus_hard ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron stress_test/teach_pass.js

Writes stress_test/corpus_hard/ (scanned-only) + ground_truth.json.
Run: py -3.12 stress_test/mutate_corpus.py [n=200]
"""
import os, sys, json, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_corpus as G
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import numpy as np

HARD = os.path.join(G.HERE, "corpus_hard")
os.makedirs(os.path.join(HARD, "logos"), exist_ok=True)

# ~110 DPI raster (extraction upscales to 300 → soft) + heavy artefacts. Tuned to push OCR
# into MIS-READS (wrong glyphs), not total failure (which would only cost recall).
S = 1200.0 / G.PAGE_H
NOISE, BLUR, ROT = 16.0, 0.8, 2.5


def render_hard(doc, path, rng):
    _, items = G.layout(doc)
    logo_box = G.layout(doc)[0]
    W, H = int(G.PAGE_W * S), int(G.PAGE_H * S)
    img = Image.new("RGB", (W, H), (250, 250, 247))
    d = ImageDraw.Draw(img)
    logo = Image.open(G.gen_logo(next(cc for cc in G.COMPANIES if cc["name"] == doc["company"]))).convert("RGB")
    lx, ly, lw, lh = logo_box
    logo = logo.resize((max(1, int(lw * S)), max(1, int(lh * S))))
    img.paste(logo, (int(lx * S), int(ly * S)))
    for (x, yt, text, size, bold, align) in items:
        try:
            f = ImageFont.truetype(G.ARIALBD if bold else G.ARIAL, max(6, int(size * S)))
        except Exception:
            f = ImageFont.load_default()
        tw = d.textlength(text, font=f)
        px = x * S - (tw if align == "r" else 0)
        d.text((px, yt * S), text, fill=(25, 25, 30), font=f)
    img = img.rotate(rng.uniform(-ROT, ROT), resample=Image.BICUBIC, fillcolor=(250, 250, 247))
    arr = np.asarray(img).astype(np.int16)
    st = np.random.RandomState(rng.randint(0, 2**31 - 1))
    arr = np.clip(arr + (st.randn(*arr.shape) * NOISE).astype(np.int16), 0, 255).astype("uint8")
    img = Image.fromarray(arr).filter(ImageFilter.GaussianBlur(BLUR))
    img.convert("RGB").save(path, "PDF", resolution=110.0)


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 200
    rng = random.Random(9999)                 # distinct docs; ground truth is self-consistent
    for c in G.COMPANIES:
        G.gen_logo(c)
    truth = []
    for i in range(n):
        doc = G.build_doc(i, rng)             # same 5 suppliers x 3 types (idx % 5 / % 3)
        fname = "hard_{}_{}_{}.pdf".format(doc["type_slug"], doc["initials"], doc["ref"])
        render_hard(doc, os.path.join(HARD, fname), rng)
        doc["variant"] = "scanned"
        doc["filename"] = fname
        truth.append(doc)
        if (i + 1) % 25 == 0:
            print("  hard {}/{}".format(i + 1, n)); sys.stdout.flush()
    json.dump(truth, open(os.path.join(HARD, "ground_truth.json"), "w"), indent=1)
    print("DONE: {} heavily-degraded scans -> {}".format(n, HARD))


if __name__ == "__main__":
    main()
