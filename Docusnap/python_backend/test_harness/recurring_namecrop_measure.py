"""Targeted recurring-entity measurement for reggie's lexicon/history follow-ups.

The full-page cold run (recurring_measure.py) produced few customer_name reads and the
natural OCR failures were trailing-junk / wrong-field (caught by the existing charset +
wordness signals), so the REPAIR and TRUNCATION follow-ups barely fired. This isolates
THEIR failure population at scale, faithfully:

  - render the recurring customer name ("Beaumont Care Homes Ltd - <site>") as a line
    image and OCR it with the project's Tesseract (REAL OCR errors), under variants:
      clean | garble (blur/noise/contrast/jpeg/resize) | truncation (width-clipped, site cut)
  - build the confirmed history (lexicon) from the canonical site names
  - replay each real read through engine.extract() WITH history + name_wordness on
  - measure, per variant: accuracy (name_match REPAIR), wrong reads caught vs silent
    (TRUNCATION flag + wordness), and false-flags on clean reads.

Run: py -3.12 -m test_harness.recurring_namecrop_measure
"""
from __future__ import annotations
import os
import random
import sys

from PIL import Image

from test_harness import render as R
from test_harness.metrics import norm_text, loose
from extraction import engine as engine_mod
from extraction.engine import ExtractionEngine

CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                           "config", "keyword_patterns.json")
TESS = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
DPI = 150
PREFIX = "Beaumont Care Homes Ltd"
SITES = ["Bangor", "Holywood", "Belmont", "Parkview", "Clandeboye",
         "Newtownards", "Comber", "Dundonald"]
PER_SITE = 30          # samples per site -> 240 total


def _render_line(text, rng):
    fnt = R.font(rng.choice(R.FONTS), int(DPI * 0.085))
    tmp = Image.new("RGB", (10, 10), (252, 252, 250))
    from PIL import ImageDraw
    w = ImageDraw.Draw(tmp).textlength(text, font=fnt)
    W, H = int(w + DPI * 0.4), int(DPI * 0.34)
    img = Image.new("RGB", (W, H), (252, 252, 250))
    R.text(ImageDraw.Draw(img), (int(DPI * 0.12), int(DPI * 0.06)), text, fnt, (15, 15, 15))
    return img


def _degrade(img, kind, rng):
    if kind == "clean":
        return img
    if kind == "garble":
        op = rng.choice(["blur", "noise", "contrast", "jpeg", "resize"])
        if op == "blur":     return R.deg_blur(img, radius=rng.uniform(1.2, 2.1))
        if op == "noise":    return R.deg_noise(img, rng, strength=rng.randint(22, 34))
        if op == "contrast": return R.deg_contrast(img, factor=rng.uniform(0.4, 0.62))
        if op == "jpeg":     return R.deg_jpeg(img, quality=rng.randint(18, 30))
        if op == "resize":   return R.deg_resize(img, scale=rng.uniform(0.5, 0.68))
    if kind == "truncation":
        frac = rng.uniform(0.5, 0.72)            # clip the right side -> site cut off
        return img.crop((0, 0, int(img.width * frac), img.height))
    return img


def _ocr(img):
    import pytesseract
    pytesseract.pytesseract.tesseract_cmd = TESS
    g = img.convert("L").resize((img.width * 2, img.height * 2))
    return " ".join(pytesseract.image_to_string(g, config="--psm 7").split()).strip()


def _history():
    vc = {f"{PREFIX} - {s}": 6 for s in SITES}
    return [{"supplier_name": "", "document_type": "invoice", "field_key": "customer_name",
             "sample_values": list(vc.keys()), "value_counts": vc,
             "confirmed_count": sum(vc.values())}]


def _replay(read_value, formats):
    eng = ExtractionEngine(mode="fast", config_path=CONFIG_PATH if os.path.exists(CONFIG_PATH) else None)
    eng.set_name_wordness(True)
    eng.set_formats(formats)
    tm, kw, anc, val = (engine_mod.template_matcher, engine_mod.keyword,
                        engine_mod.anchor, engine_mod.validator)
    orig = (tm.identify_template, tm.compute_logo_hash, kw.extract_fields,
            anc.extract_with_anchors, val.validate_and_adjust)
    tm.compute_logo_hash = lambda *a, **k: None
    tm.identify_template = lambda *a, **k: None
    kw.extract_fields = lambda *a, **k: {"customer_name": {"value": read_value, "confidence": 88, "method": "keyword"}}
    anc.extract_with_anchors = lambda *a, **k: {}
    val.validate_and_adjust = lambda results, field_defs: results
    try:
        res = eng.extract(ocr_text="stub", page_images=[], filename="t.pdf",
                          field_defs=[{"key": "customer_name", "type": "text"}], hints=[],
                          anchors=[], logos=[], templates=[], document_type="Invoice",
                          document_slug="invoice")
    finally:
        (tm.identify_template, tm.compute_logo_hash, kw.extract_fields,
         anc.extract_with_anchors, val.validate_and_adjust) = orig
    return res.get("customer_name") or {}


def _correct(pred, gt):
    return bool(pred) and (norm_text(pred) == norm_text(gt) or loose(pred) == loose(gt))


def main():
    rng = random.Random(11)
    formats = _history()
    kinds = (["clean"] * 12 + ["garble"] * 12 + ["truncation"] * 6)   # per-site mix (30)
    from collections import Counter
    note_tally = Counter()
    stats = {}
    examples = {"repaired": [], "caught": [], "silent": [], "false_flag": []}
    print(f"[namecrop] OCR'ing {len(SITES)*PER_SITE} rendered name lines (clean/garble/truncation) ...")
    for s in SITES:
        gt = f"{PREFIX} - {s}"
        for j in range(PER_SITE):
            kind = kinds[j % len(kinds)]
            img = _degrade(_render_line(gt, rng), kind, rng)
            read = _ocr(img)
            if not read:
                continue
            st = stats.setdefault(kind, {"n": 0, "base_ok": 0, "treat_ok": 0,
                                         "repaired": 0, "caught": 0, "silent": 0, "false_flag": 0})
            st["n"] += 1
            b_ok = _correct(read, gt)
            st["base_ok"] += b_ok
            r = _replay(read, formats)
            tval, flagged = r.get("value"), bool(r.get("validation_note"))
            t_ok = _correct(tval, gt)
            st["treat_ok"] += t_ok
            if not b_ok and t_ok:
                st["repaired"] += 1
                if len(examples["repaired"]) < 6: examples["repaired"].append((read, tval))
            elif not b_ok and flagged:
                st["caught"] += 1
                _n = r.get("validation_note") or ""
                _tag = ("truncation flag" if "shorter than" in _n else
                        "wordness" if "read like a name" in _n or "document heading" in _n else
                        "charset" if "unexpected characters" in _n else "other")
                note_tally[_tag] += 1
                if len(examples["caught"]) < 6: examples["caught"].append((read, r.get("validation_note")))
            elif not b_ok:
                st["silent"] += 1
                if len(examples["silent"]) < 6: examples["silent"].append((read, gt))
            if b_ok and flagged:
                st["false_flag"] += 1
                if len(examples["false_flag"]) < 6: examples["false_flag"].append((read, r.get("validation_note")))

    print("\n================ RECURRING-ENTITY NAME MEASUREMENT (real OCR, n per variant) ================")
    tot = {k: 0 for k in ("n", "base_ok", "treat_ok", "repaired", "caught", "silent", "false_flag")}
    for kind in ("clean", "garble", "truncation"):
        st = stats.get(kind)
        if not st:
            continue
        for k in tot: tot[k] += st[k]
        print(f"\n  [{kind}]  n={st['n']}  accuracy {st['base_ok']}/{st['n']} -> {st['treat_ok']}/{st['n']}"
              f"   repaired={st['repaired']} caught={st['caught']} silent={st['silent']} false_flag={st['false_flag']}")
    print("\n  ---- TOTAL ----")
    print(f"  n={tot['n']}  accuracy {tot['base_ok']}/{tot['n']} -> {tot['treat_ok']}/{tot['n']}")
    print(f"  baseline-wrong handled: repaired={tot['repaired']}  caught(flagged)={tot['caught']}  silent={tot['silent']}")
    print(f"  false-flags on correct reads: {tot['false_flag']}/{tot['base_ok']}")
    print(f"  caught attribution by mechanism: {dict(note_tally)}")
    print("    (repair = name_match lexicon; truncation flag + word_like = reggie follow-ups; "
          "wordness/charset = pre-existing signals)")
    for tag in ("repaired", "caught", "false_flag", "silent"):
        if examples[tag]:
            print(f"\n  e.g. {tag}:")
            for a, b in examples[tag]:
                print(f"     {a!r:<46} -> {b!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
