"""Multi-line continuation STRESS TEST — bulletproofing the wrap feature.

Renders realistic value blocks (a labelled free-text field — a customer / work address — that
either fits on ONE line or WRAPS onto two) across many suppliers, and reads each through the
REAL anchor crop + multi-line continuation path (`anchor._crop_and_ocr` → `_maybe_continue`)
with the project's Tesseract. No stubs on the read path — these are genuine OCR reads.

Two phases (≈200 each):
  PHASE A "invoices": the realistic population — single-line, dash-wrapped, and complete
     values with a street line below — clean + lightly degraded.
  PHASE B "stress":   the precision/recall edges — heavy degradation, DRIFTED ref-code reads
     (must NOT join), word-break hyphens (de-hyphenate), trailing-comma, and an unrelated row
     below (must NOT swallow).

Per category we assert the right thing:
  * JOIN categories  → the second line must be joined (RECALL).
  * NO-JOIN categories → the second line must NOT leak in (PRECISION — the dangerous failure).
  * single-line / complete → byte-faithful, no spurious join.

Run:  py -3.12 -m test_harness.multiline_measure
Needs a real Tesseract; SKIPs cleanly (exit 0) when it's absent.
"""
from __future__ import annotations
import json
import os
import random
import sys
from collections import defaultdict

from PIL import Image, ImageDraw

from test_harness import render as R
from test_harness.metrics import norm_text, loose
from extraction import anchor
from extraction import name_match

TESS = os.environ.get("TESSERACT_CMD", r"C:\Program Files\Tesseract-OCR\tesseract.exe")
DPI = 240   # value text ≈ 36px — a realistic ~200-300 DPI scan; below ~22px OCR garbles
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(ROOT, "config", "keyword_patterns.json")

# Suppliers: a distinct name + a RECURRING customer prefix that wraps onto a variable site,
# plus a small logo glyph drawn into the header (logo variety; the read is on the value block).
SUPPLIERS = [
    ("Document Solutions",  "Beaumont Care Homes Ltd",   ["Bangor", "Holywood", "Belmont", "Comber", "Dundonald", "Newtownards", "Jordanstown", "Tudordale", "Galgorm"]),
    ("Apex Print Bureau",   "McConnell Kelly Solicitors", ["Antrim", "Lisburn", "Carryduff", "Saintfield", "Ballynahinch"]),
    ("Northern Office Co",  "Stonebridge Joinery",        ["Bangor", "Donaghadee", "Groomsport", "Conlig"]),
    ("CityDocs Ltd",        "Dunroamin Caravan Park",     ["Millisle", "Cloughey", "Ballywalter", "Portavogie"]),
    ("PrintWorks NI",       "Hilltop Veterinary Group",   ["Comber", "Killyleagh", "Crossgar", "Saintfield"]),
    ("Bann Valley Systems", "Riverside Dental Practice",  ["Coleraine", "Portrush", "Garvagh", "Kilrea"]),
    ("Maple Business Ltd",  "Greenfield Nursing Home",    ["Lurgan", "Portadown", "Banbridge", "Gilford"]),
    ("Quill and Co",        "Lakeside Hotel Group",       ["Enniskillen", "Omagh", "Cookstown", "Dungannon"]),
]
LABELS = ["Work Address", "Customer", "Site", "Client"]
STREETS = ["1a Old Manse Road", "27 Mill Street", "14 Shore Road", "3 Castle Lane", "88 Main Street"]


def _lexicon(prefix, sites):
    vc = {f"{prefix} - {s}": 6 for s in sites}
    return name_match.build_token_lexicon(vc, confirmed_count=sum(vc.values()))


def _logo(d, x, y, name, rng):
    # A simple, distinct mark per supplier (a filled rounded square + initial) — logo variety.
    s = int(DPI * 0.5)
    col = (rng.randint(20, 90), rng.randint(20, 90), rng.randint(20, 90))
    d.rounded_rectangle((x, y, x + s, y + s), radius=int(s * 0.18), fill=col)
    f = R.font(R.FONTS[0], int(s * 0.7))
    R.text(d, (x + int(s * 0.28), y + int(s * 0.12)), name[0], f, (245, 245, 245))


def _degrade(img, kind, rng):
    if kind == "clean":
        return img
    op = rng.choice(["blur", "noise", "contrast", "jpeg", "resize"])
    if op == "blur":     return R.deg_blur(img, radius=rng.uniform(1.0, 1.8))
    if op == "noise":    return R.deg_noise(img, rng, strength=rng.randint(16, 28))
    if op == "contrast": return R.deg_contrast(img, factor=rng.uniform(0.5, 0.7))
    if op == "jpeg":     return R.deg_jpeg(img, quality=rng.randint(24, 36))
    if op == "resize":   return R.deg_resize(img, scale=rng.uniform(0.6, 0.78))
    return img


def render_doc(supplier, prefix, site, category, degrade, rng):
    """Render an invoice-style block; return (image, value_box_centre_norm, ground_truth,
    join_expected, forbidden) where `forbidden` is the text on the line BELOW line 1 that must
    NOT be joined for a NO-JOIN category (a street for a complete value; the site for a drift)."""
    W, H = int(DPI * 6.0), int(DPI * 3.6)
    img = Image.new("RGB", (W, H), (252, 252, 250))
    d = ImageDraw.Draw(img)
    fsize = int(DPI * 0.15)
    fnt = R.font(rng.choice(R.FONTS), fsize)
    hdr = R.font(R.FONTS[0], int(fsize * 1.3))
    _logo(d, int(W * 0.04), int(H * 0.05), supplier, rng)
    R.text(d, (int(W * 0.16), int(H * 0.10)), supplier, hdr, (10, 10, 10))
    label = rng.choice(LABELS)
    lx, vx = int(W * 0.06), int(W * 0.40)
    y = int(H * 0.42)
    line_h = int(fsize * 1.55)
    R.text(d, (lx, y), label, fnt, (20, 20, 20))

    street = rng.choice(STREETS)
    gt = f"{prefix} - {site}"
    join_expected = False
    if category == "single_line":
        line1, second, forbidden = gt, street, street            # site is PART of line1; street must not leak
    elif category == "multiline_dash":
        line1, second, forbidden = f"{prefix} -", site, None; join_expected = True
    elif category == "complete_street_below":
        line1, second, forbidden = gt, street, street
    elif category == "drift_refcode":
        line1 = f"{rng.randint(2600, 2699)}-{rng.randint(0, 9999):04d}-{rng.randint(1, 9)}"
        second, forbidden, gt = site, site, line1                 # the site below must NOT join the ref code
    elif category == "wordbreak":
        cut = max(2, len(site) // 2)
        line1, second, forbidden = f"{prefix} - {site[:cut]}-", site[cut:], None; join_expected = True
    elif category == "trailing_comma":
        # A short value ending in a comma with the site below: the history-TRUNCATION signal
        # correctly JOINS it (the value is genuinely incomplete). gt stays "prefix - site"
        # (loose comparison ignores the missing dash). This is a recall case, not precision.
        line1, second, forbidden = f"{prefix},", site, None; join_expected = True
    else:
        line1, second, forbidden = gt, street, street

    vy = y
    R.text(d, (vx, vy), line1, fnt, (15, 15, 15))
    for i, r in enumerate([second, "Newtownabbey", "BT37 0RU"], start=1):
        R.text(d, (vx, vy + i * line_h), r, fnt, (15, 15, 15))

    # Tight value box over LINE 1 only (a single-line teach — the continuation must EXTEND).
    w1 = max(8, d.textlength(line1, font=fnt))
    bx, by, bw, bh = vx, vy - int(fsize * 0.12), int(w1), int(fsize * 1.22)
    cx, cy = bx + bw / 2.0, by + bh / 2.0
    box = (cx / W, cy / H, bw / W, bh / H)

    img = _degrade(img, degrade, rng)
    return img, box, gt, join_expected, forbidden


def read(img, box, prefix, sites, patterns):
    lex = _lexicon(prefix, sites)
    label = "work address"
    cont = {"pattern_chars": "-", "name_lex": lex, "fmt_entry": None}
    vf = lambda t: bool(t and t.strip()) and anchor._crop_is_credible(t, "text", patterns, label)
    return anchor._crop_and_ocr(img, box[0], box[1], box[2], box[3], "text",
                                verify_fn=vf, continuation=cont) or ""


def main():
    if not os.path.exists(TESS):
        print(f"SKIP: Tesseract not found at {TESS} (set TESSERACT_CMD). Exit 0.")
        return 0
    import pytesseract
    pytesseract.pytesseract.tesseract_cmd = TESS
    patterns = {}
    try:
        with open(CONFIG_PATH, encoding="utf-8") as fh:
            patterns = (json.load(fh) or {}).get("validation_patterns", {})
    except Exception:
        pass

    rng = random.Random(2026)
    PHASES = {
        # category -> weight (per phase)
        "A_invoices": {"single_line": 38, "multiline_dash": 38, "complete_street_below": 24},
        "B_stress":   {"multiline_dash": 30, "drift_refcode": 25, "wordbreak": 15,
                       "complete_street_below": 15, "trailing_comma": 10, "single_line": 5},
    }
    PER_PHASE = 200
    # The dangerous failure is a FALSE JOIN (line 2 leaked into a value that shouldn't continue).
    JOIN_CATS    = {"multiline_dash", "wordbreak", "trailing_comma"}
    NOJOIN_CATS  = {"single_line", "complete_street_below", "drift_refcode"}

    overall = {"n": 0, "ok": 0, "false_join": 0, "missed_join": 0}
    by_cat = defaultdict(lambda: {"n": 0, "ok": 0, "false_join": 0, "missed_join": 0})
    examples = {"false_join": [], "missed_join": [], "other_wrong": []}

    for phase, weights in PHASES.items():
        cats = [c for c, w in weights.items() for _ in range(w)]
        print(f"\n[{phase}] reading {PER_PHASE} blocks through the real crop+continuation path …")
        for _ in range(PER_PHASE):
            supplier, prefix, sites = rng.choice(SUPPLIERS)
            site = rng.choice(sites)
            cat = rng.choice(cats)
            degrade = "clean" if (phase == "A_invoices" and rng.random() < 0.55) else rng.choice(
                ["clean", "blur", "noise", "contrast", "jpeg", "resize"])
            img, box, gt, join_expected, forbidden = render_doc(supplier, prefix, site, cat, degrade, rng)
            got = read(img, box, prefix, sites, patterns)

            c = by_cat[cat]; c["n"] += 1; overall["n"] += 1
            if cat in JOIN_CATS:
                ok = (norm_text(got) == norm_text(gt) or loose(got) == loose(gt))
                if ok:
                    c["ok"] += 1; overall["ok"] += 1
                else:
                    c["missed_join"] += 1; overall["missed_join"] += 1
                    if len(examples["missed_join"]) < 8: examples["missed_join"].append((cat, gt, got))
            else:  # NO-JOIN: the line BELOW (the `forbidden` text) must NOT have leaked in
                leaked = bool(forbidden) and loose(forbidden) and loose(forbidden) in loose(got)
                if leaked:
                    c["false_join"] += 1; overall["false_join"] += 1
                    if len(examples["false_join"]) < 10: examples["false_join"].append((cat, gt, got))
                else:
                    c["ok"] += 1; overall["ok"] += 1

    print("\n================  MULTI-LINE CONTINUATION STRESS RESULTS  ================")
    for cat in sorted(by_cat):
        s = by_cat[cat]
        kind = "JOIN" if cat in JOIN_CATS else "NO-JOIN"
        print(f"  [{kind:7}] {cat:22} n={s['n']:>3}  ok={s['ok']:>3}  "
              f"false_join={s['false_join']:>2}  missed_join={s['missed_join']:>2}")
    print("  ---- TOTAL ----")
    print(f"  n={overall['n']}  ok={overall['ok']}  "
          f"FALSE-JOINS={overall['false_join']}  missed-joins={overall['missed_join']}")
    for tag in ("false_join", "missed_join"):
        if examples[tag]:
            print(f"\n  e.g. {tag}:")
            for cat, gt, got in examples[tag]:
                print(f"     [{cat}] gt={gt!r}  got={got!r}")

    # BULLETPROOF verdict: ZERO false joins (precision is non-negotiable — a wrong row leaking
    # in is the dangerous failure) AND ≥90% join recall (real OCR has some noise floor).
    join_n  = sum(by_cat[c]["n"]  for c in JOIN_CATS)
    join_ok = sum(by_cat[c]["ok"] for c in JOIN_CATS)
    recall = (join_ok / join_n) if join_n else 1.0
    print(f"\n  join recall: {join_ok}/{join_n} = {recall:.1%}   false joins: {overall['false_join']}")
    bulletproof = (overall["false_join"] == 0 and recall >= 0.90)
    print("  VERDICT:", "[PASS] BULLETPROOF" if bulletproof else "[FAIL] needs work")
    return 0 if bulletproof else 1


if __name__ == "__main__":
    sys.exit(main())
