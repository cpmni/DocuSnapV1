"""
gen_hard_set.py — the ADVERSARIAL "Hard Set" corpus (owner spec, 2026-08-30: "generate a set of multi
columned documents for testing, and examples of other areas you feel may pose problems").

TEN document CLASSES, each ~20 docs across NEW synthetic issuers, every document written in TWO
renditions of the same truth — `digital/` (true text-layer PDF; the app skips OCR → isolates layout)
and `scan/` (rasterised at 150 or 200 DPI with skew/noise/fade per class; forces OCR). One
`ground_truth.json` row per FILE with a `class` + `variant` tag, so a failure names its mechanism.

Classes (variants cycle per index; `control` rows are the clean baselines that MUST score clean):
  multicol_money  Net | VAT | Gross on ONE row · two totals blocks side by side · a caption column
                  beside a right-aligned amount column with a narrow gap · total in the MIDDLE column
  table_total     a Total row INSIDE the items table + a footer "Total due" · a "Balance b/f" row
                  above the total · a "Carried forward" line that must NOT read as the total
  small_print     the same invoice at 8 pt and 9 pt (+ an 11 pt CONTROL)
  edge_date       date flush at the left margin · inside a box touching the rule · 1/12 vs 11/12
                  pairs · ISO 2026-12-01 · US order with a locale hint · month names
  buyer_large     BILL FROM (issuer, small) | BILL TO (the buyer, LARGER) · SHIP TO right ·
                  a buyer-issued PO on the buyer's letterhead
  continental     1.234,56 · 1 234,56 · 1'234.56 · the € AFTER the amount · EU VAT ids (scan matters)
  logo_siblings   one issuer's invoice/credit note/statement on one logo · two DIFFERENT issuers with
                  near-identical logos (same construction, one hue apart)
  degraded        forced 1°/2°/3° skew · a faint grey serial line · a thermal receipt (narrow, faded)
                  · a staple blot over the ref · a fax header line above the letterhead
  multipage       2-3 pages, the total ONLY on the last page · a page-1 "Carried forward" trap
  credit_sign     -£x · £-x · (x) · x- · x CR · a PLAIN invoice with a dash-leader (control: positive)

Reuses the customer-corpus machinery patterns (stress_test/gen_customer_test.py): the Page draw
helpers, the scanify recipe (extended with dpi / forced-skew / fade / blot / fax), deterministic
per-(class, index) seeds, a pool.

Usage:
  py -3.12 stress_test/gen_hard_set.py --smoke        (1 doc per class — eyeball run)
  py -3.12 stress_test/gen_hard_set.py                (full: ~20 per class)
Output: %USERPROFILE%/Desktop/Hard Set/   (env HARDSET_OUT overrides — smokes go to a scratch dir)
No app code touched; only writes files under the output folder.
"""
import argparse
import io
import json
import math
import os
import random
import sys
from multiprocessing import Pool

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

try:
    import pypdfium2 as pdfium
except ImportError:
    pdfium = None

PAGE_W, PAGE_H = A4                      # 595 x 842 pt
DESKTOP = os.path.join(os.environ.get("USERPROFILE", os.path.expanduser("~")), "Desktop")
ROOT = os.environ.get("HARDSET_OUT") or os.path.join(DESKTOP, "Hard Set")
DIGITAL = os.path.join(ROOT, "digital")
SCAN = os.path.join(ROOT, "scan")
LOGODIR = os.path.join(ROOT, "_logos")

FONT_BOLD = {"Helvetica": "Helvetica-Bold", "Times-Roman": "Times-Bold", "Courier": "Courier-Bold"}

# The BUYER on every document (the ScanFinder user's company — matches the customer corpus, so the
# warm arm measures bleed against the same recipient identity the live learning knows).
BUYER = dict(name="Bramblewood Joinery Ltd", address=["Unit 4, Sawpit Lane", "Draymarket, DM2 6QF"],
             vat="GB 512 8846 27", rgb=(92, 64, 24))

# ── NEW synthetic issuers (never a live name; each its own logo construction + palette) ─────────
ISSUERS = [
    dict(name="Thornfield Fabrication Ltd", slug="Thornfield-Fabrication", initials="TF",
         rgb=(38, 70, 83), font="Helvetica", vat="GB 214 6633 07", acct="TFB-1121",
         address=["Forge Yard, 3 Rivet Lane", "Weldham, WD2 4XR"],
         products=[("Laser-Cut Bracket 5mm", 14.20), ("Box Section 40x40 3m", 22.80),
                   ("Powder Coat RAL7016 (per m2)", 8.75), ("CNC Folded Panel 2mm", 31.40),
                   ("Stainless Sheet 1.5mm 2x1m", 58.60), ("Weld Assembly Frame", 96.00)]),
    dict(name="Lantern Bay Foods", slug="Lantern-Bay-Foods", initials="LB",
         rgb=(155, 81, 30), font="Times-Roman", vat="GB 902 5518 64", acct="LBF-0457",
         address=["Quayside Depot 7", "Herringmouth, HM1 5QP"],
         products=[("Smoked Mackerel Fillets 1kg", 12.60), ("Sea Salt Flakes 500g (x12)", 28.20),
                   ("Chilled Chowder Base 5L", 19.90), ("Rye Crispbread (case of 24)", 21.60),
                   ("Cold-Pressed Rapeseed Oil 5L", 24.50), ("Pickled Herring 2kg Tub", 17.80)]),
    dict(name="Greyburn Plant Services", slug="Greyburn-Plant", initials="GP",
         rgb=(66, 66, 66), font="Helvetica", vat="GB 487 2209 51", acct="GPS-7730",
         address=["Depot 2, Ballast Road", "Greyburn, GB6 8LT"],
         products=[("Excavator Service Kit 8T", 145.00), ("Hydraulic Hose Assembly", 64.30),
                   ("Track Roller Assembly", 118.75), ("Filter Pack (air/oil/fuel)", 52.40),
                   ("Bucket Teeth Set (x5)", 39.90), ("Call-Out & First Hour", 95.00)]),
    dict(name="Aldercroft Stationery Co", slug="Aldercroft-Stationery", initials="AC",
         rgb=(21, 87, 36), font="Times-Roman", vat="GB 733 0084 12", acct="ASC-2288",
         address=["Millpond House, 18 Ledger Row", "Quillbury, QB3 2FE"],
         products=[("Copier Paper 80gsm (box of 5)", 18.90), ("Archive Box (x10)", 23.40),
                   ("Laser Labels 21-up (x100)", 14.70), ("Ring Binder A4 (x12)", 19.20),
                   ("Whiteboard Marker (x24)", 16.10), ("Envelope DL Window (x1000)", 25.80)]),
    dict(name="Helix Point Diagnostics", slug="Helix-Point", initials="HP",
         rgb=(94, 53, 177), font="Helvetica", vat="GB 118 7745 90", acct="HPD-6612", serials="HX",
         address=["2 Rotor Court", "Spindale, SP9 1EN"],
         products=[("Bench Analyser Mk4", 1240.00, "SN"), ("Sensor Probe Array", 386.00, "SN"),
                   ("Calibration Fluid Set", 44.20), ("Sample Tray Carousel", 92.50),
                   ("Thermal Printer Module", 156.00, "SN"), ("Annual Calibration Visit", 180.00)]),
    # the near-identical logo PAIR (logo_siblings class): same construction, one hue apart, different names
    dict(name="Kestrel Ridge Optics", slug="Kestrel-Ridge", initials="KR",
         rgb=(13, 71, 161), font="Helvetica", vat="GB 640 2217 38", acct="KRO-3319",
         address=["Summit Works, 5 Talon Way", "Cragside, CG2 7JD"],
         products=[("Prism Assembly 40mm", 74.00), ("Lens Cell Mount", 41.60),
                   ("Optical Bench Rail 1m", 88.20), ("Collimator Unit", 129.00),
                   ("Anti-Reflective Coating (per lens)", 12.40), ("Alignment Service", 110.00)]),
    dict(name="Kite Ridge Optical Ltd", slug="Kite-Ridge", initials="KO",
         rgb=(21, 101, 192), font="Helvetica", vat="GB 559 8804 73", acct="KRL-9906",
         address=["Summit House, 9 Talon Way", "Cragside, CG2 7JE"],
         products=[("Prism Assembly 42mm", 76.00), ("Lens Cell Mount B", 43.10),
                   ("Optical Bench Rail 1.2m", 94.20), ("Collimator Unit II", 133.00),
                   ("Coating Service (per lens)", 13.10), ("Alignment Visit", 115.00)]),
]
BY_SLUG = {i["slug"]: i for i in ISSUERS}


# ── Logos (bespoke constructions; the Kestrel/Kite pair deliberately near-identical) ────────────
def _pilfont(sz, bold=True):
    f = "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf"
    try:
        return ImageFont.truetype(f, sz)
    except Exception:
        return ImageFont.load_default()


def draw_logo(slug, initials, rgb):
    W, H = 240, 258
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r, g, b = rgb
    dark = (max(r - 40, 0), max(g - 40, 0), max(b - 40, 0), 255)
    main = (r, g, b, 255)
    pale = (min(r + 90, 255), min(g + 90, 255), min(b + 90, 255), 255)
    if slug == "Thornfield-Fabrication":       # rivet plate: square + 4 corner dots + diagonal weld seam
        d.rounded_rectangle([24, 24, 216, 216], 18, outline=main, width=14)
        for cx, cy in ((56, 56), (184, 56), (56, 184), (184, 184)):
            d.ellipse([cx - 12, cy - 12, cx + 12, cy + 12], fill=dark)
        d.line([(40, 200), (200, 40)], fill=pale, width=16)
    elif slug == "Lantern-Bay-Foods":          # lantern: trapezoid + flame + base bar
        d.polygon([(80, 40), (160, 40), (184, 180), (56, 180)], outline=main, width=12)
        d.ellipse([104, 92, 136, 140], fill=pale)
        d.polygon([(120, 76), (132, 104), (108, 104)], fill=main)
        d.rectangle([64, 190, 176, 206], fill=dark)
    elif slug == "Greyburn-Plant":             # cog: 8 teeth + hub
        cx, cy = 120, 120
        for a in range(0, 360, 45):
            x, y = cx + 88 * math.cos(math.radians(a)), cy + 88 * math.sin(math.radians(a))
            d.rectangle([x - 14, y - 14, x + 14, y + 14], fill=main)
        d.ellipse([48, 48, 192, 192], fill=main)
        d.ellipse([90, 90, 150, 150], fill=(255, 255, 255, 255))
        d.ellipse([106, 106, 134, 134], fill=dark)
    elif slug == "Aldercroft-Stationery":      # paperclip loops
        d.rounded_rectangle([56, 32, 184, 208], 60, outline=main, width=14)
        d.rounded_rectangle([86, 62, 154, 208], 34, outline=pale, width=12)
        d.line([(120, 208), (120, 120)], fill=dark, width=12)
    elif slug == "Helix-Point":                # double helix: two sine strands + rungs
        for phase, col in ((0, main), (math.pi, pale)):
            pts = [(60 + i * 12, 120 + 70 * math.sin(phase + i * 0.7)) for i in range(11)]
            d.line(pts, fill=col, width=10, joint="curve")
        for i in range(1, 10, 2):
            x = 60 + i * 12
            d.line([(x, 120 + 70 * math.sin(i * 0.7)), (x, 120 + 70 * math.sin(math.pi + i * 0.7))], fill=dark, width=6)
    elif slug in ("Kestrel-Ridge", "Kite-Ridge"):   # THE NEAR-IDENTICAL PAIR: mountain + bird chevron
        d.polygon([(24, 196), (96, 72), (150, 150), (186, 96), (216, 196)], fill=main)
        d.polygon([(96, 72), (120, 110), (150, 150)], fill=pale)
        d.line([(64, 60), (96, 44), (128, 60)], fill=dark, width=10)
        if slug == "Kite-Ridge":               # one small tell: a second, higher chevron
            d.line([(140, 48), (166, 36), (192, 48)], fill=dark, width=8)
    else:                                      # buyer Bramblewood: dovetail (as the customer corpus)
        d.rectangle([28, 60, 116, 180], fill=main)
        d.rectangle([124, 60, 212, 180], fill=pale)
        for i in range(3):
            y = 70 + i * 40
            d.polygon([(116, y), (146, y + 8), (146, y + 24), (116, y + 32)], fill=main)
        d.rectangle([28, 190, 212, 202], fill=dark)
    d.text((120, 242), initials, font=_pilfont(28), fill=dark, anchor="mm")
    return img


# ── Page draw helpers (top-down y; the gen_customer_test pattern) ───────────────────────────────
class Page:
    def __init__(self, c, font):
        self.c = c
        self.font = font
        self.bold = FONT_BOLD[font]

    def t(self, x, y, s, size=9, bold=False, rgb=(0, 0, 0), right=False, centre=False, font=None):
        self.c.setFont(font or (self.bold if bold else self.font), size)
        self.c.setFillColorRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255)
        if right:
            self.c.drawRightString(x, PAGE_H - y, s)
        elif centre:
            self.c.drawCentredString(x, PAGE_H - y, s)
        else:
            self.c.drawString(x, PAGE_H - y, s)

    def line(self, x1, y1, x2, y2, rgb=(120, 120, 120), w=0.7):
        self.c.setStrokeColorRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255)
        self.c.setLineWidth(w)
        self.c.line(x1, PAGE_H - y1, x2, PAGE_H - y2)

    def rect(self, x, y, w, h, rgb=None, outline=None, lw=0.7):
        if rgb:
            self.c.setFillColorRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255)
        if outline:
            self.c.setStrokeColorRGB(outline[0] / 255, outline[1] / 255, outline[2] / 255)
            self.c.setLineWidth(lw)
        self.c.rect(x, PAGE_H - y - h, w, h, fill=1 if rgb else 0, stroke=1 if outline else 0)

    def img(self, pil, x, y, w, h):
        self.c.drawImage(ImageReader(pil), x, PAGE_H - y - h, w, h, mask="auto")


def header(p, issuer, logo, title, big_title_size=19):
    rgb = issuer["rgb"]
    p.img(logo, 40, 32, 58, 58)
    p.t(110, 54, issuer["name"], 16, bold=True, rgb=rgb)
    p.t(110, 70, " · ".join(issuer["address"]), 8)
    p.t(110, 82, f"VAT Reg No {issuer['vat']}", 8)
    p.t(PAGE_W - 42, 58, title, big_title_size, bold=True, rgb=rgb, right=True)
    p.line(40, 98, PAGE_W - 40, 98, rgb)
    return 114


def meta_row(p, y, pairs, rgb):
    p.rect(40, y, PAGE_W - 80, 34, outline=rgb, lw=1)
    w = (PAGE_W - 80) / len(pairs)
    for i, (k, v) in enumerate(pairs):
        x = 40 + i * w
        if i:
            p.line(x, y, x, y + 34, rgb)
        p.t(x + 6, y + 13, k, 7.5, bold=True, rgb=rgb)
        p.t(x + 6, y + 27, v, 9.5)
    return y + 48


def parties(p, y, rgb, left_cap="BILL TO", right_cap="SHIP TO", left=BUYER, right=BUYER,
            left_size=9, right_size=9, left_bold=False):
    for x, cap, who, size, bold in ((40, left_cap, left, left_size, left_bold),
                                    (PAGE_W / 2 + 10, right_cap, right, right_size, False)):
        p.t(x, y, cap, 8, bold=True, rgb=rgb)
        yy = y + 13
        p.t(x, yy, who["name"], size, bold=bold)
        yy += size + 4
        for ln in who["address"]:
            p.t(x, yy, ln, 9)
            yy += 12
    return y + 13 + 12 * 3 + 14


def items_table(p, issuer, y, items, cur="£", size=9):
    rgb = issuer["rgb"]
    cols = [("Description", 46), ("Qty", 380, True), ("Unit", 440, True), ("Net", PAGE_W - 46, True)]
    p.rect(40, y, PAGE_W - 80, 18, rgb=rgb)
    for name, x, *r in cols:
        p.t(x, y + 13, name, 8.5, bold=True, rgb=(255, 255, 255), right=bool(r))
    yy = y + 18
    for it in items:
        rowh = size + 8 + (10 * len(it.get("serials", [])))
        p.t(46, yy + size + 3, it["name"], size)
        p.t(380, yy + size + 3, str(it["qty"]), size, right=True)
        p.t(440, yy + size + 3, f"{it['unit']:,.2f}", size, right=True)
        p.t(PAGE_W - 46, yy + size + 3, f"{it['net']:,.2f}", size, right=True)
        sy = yy + size + 13
        for sn, faint in it.get("serials", []):
            p.t(60, sy, f"Serial No: {sn}", 7.5, rgb=(170, 170, 170) if faint else (90, 90, 90))
            sy += 10
        yy += rowh
    p.line(40, yy, PAGE_W - 40, yy, rgb, 1)
    return yy + 10


def make_items(issuer, rng, n=None, faint_serials=False):
    n = n or rng.randint(2, 5)
    items = []
    for prod in rng.sample(issuer["products"], min(n, len(issuer["products"]))):
        name, price = prod[0], prod[1]
        has_sn = len(prod) > 2 and "serials" in issuer
        qty = 1 if has_sn else rng.randint(1, 8)
        sns = [(f"{issuer['serials']}-{rng.randint(1000000, 9999999)}", faint_serials)] if has_sn else []
        items.append(dict(name=name, qty=qty, unit=price, net=round(qty * price, 2), serials=sns))
    return items


def money(v):
    return f"{v:,.2f}"


def mkdate(rng):
    y = rng.choice([2025, 2026])
    m = rng.randint(1, 12 if y == 2025 else 8)
    d = rng.randint(1, 28)
    return f"{d:02d}-{m:02d}-{y}"


def mkref(prefix, rng, n=5):
    return f"{prefix}-{rng.randint(10 ** (n - 1), 10 ** n - 1)}"


def base_gt(cls, variant, issuer, type_slug, ref, date, control=False):
    return dict(cls=cls, variant=variant, control=control, issuer=issuer["name"], type_slug=type_slug,
                ref=ref, date=date, vat_no=issuer["vat"], total=None, subtotal=None, tax=None, currency="gbp")


def finish(c, buf):
    c.showPage()
    c.save()
    buf.seek(0)
    return buf.read()


def start(issuer):
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    return buf, c, Page(c, issuer["font"])


def totals_block(p, x_label, x_amt, y, net, cur="£", label="TOTAL", sign=1, size=9, dash_leader=False):
    vat = round(net * 0.2, 2)
    total = round(net + vat, 2)

    def _fmt(v):
        s = f"{cur}{money(abs(v))}"
        return ("-" + s) if (sign < 0) else s
    rows = [("Net Total", net, False), ("VAT @ 20%", vat, False), (label, total, True)]
    for k, v, last in rows:
        p.t(x_label, y, k, size + (1 if last else 0), bold=last)
        if dash_leader and last:
            p.t(x_label + 60, y, "-" * 14, size)
        p.t(x_amt, y, _fmt(v), size + (1 if last else 0), bold=last, right=True)
        y += size + 7
    return round(net, 2), vat, round(total, 2) * sign, y


# ── Class builders — each returns (pdf_bytes, gt, scan_params) ─────────────────────────────────
def b_multicol_money(rng, idx):
    variants = ["one_row", "two_blocks", "narrow_gap", "middle_total"]
    v = variants[idx % 4]
    issuer = ISSUERS[idx % 4]
    buf, c, p = start(issuer)
    ref, date = mkref("INV", rng), mkdate(rng)
    y = header(p, issuer, _LOGOS[issuer["slug"]], "INVOICE")
    y = meta_row(p, y + 6, [("Invoice No", ref), ("Date", date), ("Account", issuer["acct"])], issuer["rgb"])
    y = parties(p, y + 4, issuer["rgb"])
    items = make_items(issuer, rng)
    y = items_table(p, issuer, y + 4, items)
    net = round(sum(i["net"] for i in items), 2)
    vat = round(net * 0.2, 2)
    total = round(net + vat, 2)
    gt = base_gt("multicol_money", v, issuer, "invoice", ref, date)
    gt.update(subtotal=money(net), tax=money(vat), total=money(total))
    if v == "one_row":                       # Net | VAT | Gross across ONE line
        p.t(46, y + 14, "Net", 9, bold=True); p.t(90, y + 14, f"£{money(net)}", 9)
        p.t(220, y + 14, "VAT", 9, bold=True); p.t(262, y + 14, f"£{money(vat)}", 9)
        p.t(420, y + 14, "Gross Total", 9, bold=True); p.t(PAGE_W - 46, y + 14, f"£{money(total)}", 10, bold=True, right=True)
    elif v == "two_blocks":                  # two totals blocks side by side (This period | Total due)
        p.t(60, y + 12, "THIS PERIOD", 8, bold=True, rgb=issuer["rgb"])
        totals_block(p, 60, 250, y + 26, net)
        p.t(PAGE_W / 2 + 30, y + 12, "TOTAL DUE", 8, bold=True, rgb=issuer["rgb"])
        totals_block(p, PAGE_W / 2 + 30, PAGE_W - 46, y + 26, net)
    elif v == "narrow_gap":                  # caption column with a ≤2-char gap to the amounts
        yy = y + 12
        for k, val in (("Net Total", net), ("VAT @ 20%", vat), ("TOTAL", total)):
            p.t(330, yy, k + ":", 9, bold=(k == "TOTAL"))
            p.t(392, yy, f"£{money(val)}", 9, bold=(k == "TOTAL"))
            yy += 15
    else:                                    # middle_total: Gross | VAT | Net column ORDER swapped
        p.rect(40, y + 6, PAGE_W - 80, 34, outline=issuer["rgb"], lw=1)
        w3 = (PAGE_W - 80) / 3
        for i, (k, val, bold) in enumerate((("Gross Total", total, True), ("VAT", vat, False), ("Net", net, False))):
            x = 40 + i * w3
            if i:
                p.line(x, y + 6, x, y + 40, issuer["rgb"])
            p.t(x + 6, y + 19, k, 7.5, bold=True, rgb=issuer["rgb"])
            p.t(x + 6, y + 33, f"£{money(val)}", 9.5, bold=bold)
    return finish(c, buf), gt, {}


def b_table_total(rng, idx):
    variants = ["total_in_table", "balance_bf", "carried_fwd"]
    v = variants[idx % 3]
    issuer = ISSUERS[(idx + 1) % 4]
    buf, c, p = start(issuer)
    ref, date = mkref("STM" if v == "balance_bf" else "INV", rng), mkdate(rng)
    slug = "statement" if v == "balance_bf" else "invoice"
    y = header(p, issuer, _LOGOS[issuer["slug"]], "STATEMENT" if slug == "statement" else "INVOICE")
    y = meta_row(p, y + 6, [("Ref", ref), ("Date", date)], issuer["rgb"])
    y = parties(p, y + 4, issuer["rgb"])
    items = make_items(issuer, rng, n=3)
    net = round(sum(i["net"] for i in items), 2)
    vat = round(net * 0.2, 2)
    total = round(net + vat, 2)
    gt = base_gt("table_total", v, issuer, slug, ref, date)
    gt.update(subtotal=money(net), tax=money(vat), total=money(total))
    rgb = issuer["rgb"]
    if v == "balance_bf":
        bf = round(rng.uniform(80, 400), 2)
        gt.update(total=money(round(bf + total, 2)), subtotal=None, tax=None)
        p.t(46, y + 10, f"Balance b/f", 9, bold=True); p.t(PAGE_W - 46, y + 10, f"£{money(bf)}", 9, right=True)
        y = items_table(p, issuer, y + 18, items)
        p.t(46, y + 8, "VAT on new items", 9); p.t(PAGE_W - 46, y + 8, f"£{money(vat)}", 9, right=True)
        p.t(PAGE_W - 200, y + 28, "Balance Due", 10, bold=True)
        p.t(PAGE_W - 46, y + 28, f"£{money(round(bf + total, 2))}", 10, bold=True, right=True)
    else:
        # the totals as EXTRA TABLE ROWS inside the grid
        y2 = items_table(p, issuer, y + 4, items)
        p.rect(40, y2 - 10, PAGE_W - 80, 54, outline=(190, 190, 190), lw=0.5)
        if v == "carried_fwd":
            p.t(46, y2 + 4, "Carried forward", 9)
            p.t(PAGE_W - 46, y2 + 4, f"£{money(net)}", 9, right=True)
        p.t(46, y2 + 18, "VAT @ 20%", 9)
        p.t(PAGE_W - 46, y2 + 18, f"£{money(vat)}", 9, right=True)
        p.t(46, y2 + 34, "TOTAL", 10, bold=True)
        p.t(PAGE_W - 46, y2 + 34, f"£{money(total)}", 10, bold=True, right=True)
        p.t(40, y2 + 58, f"Total due £{money(total)} — payment terms 14 days net. Quote {ref}.", 8.5)
    return finish(c, buf), gt, {}


def b_small_print(rng, idx):
    sizes = [(8, "pt8", False), (9, "pt9", False), (11, "pt11_control", True)]
    size, v, control = sizes[idx % 3]
    issuer = ISSUERS[(idx + 2) % 4]
    buf, c, p = start(issuer)
    ref, date = mkref("INV", rng), mkdate(rng)
    y = header(p, issuer, _LOGOS[issuer["slug"]], "INVOICE")
    p.t(46, y + 12, f"Invoice No: {ref}", size, bold=True)
    p.t(240, y + 12, f"Date: {date}", size)
    p.t(430, y + 12, f"Account: {issuer['acct']}", size)
    y = parties(p, y + 26, issuer["rgb"])
    items = make_items(issuer, rng, n=3)
    y = items_table(p, issuer, y + 4, items, size=size)
    net = round(sum(i["net"] for i in items), 2)
    _n, vat, total, _ = totals_block(p, PAGE_W - 220, PAGE_W - 46, y + 8, net, size=size)
    gt = base_gt("small_print", v, issuer, "invoice", ref, date, control=control)
    gt.update(subtotal=money(net), tax=money(vat), total=money(total))
    return finish(c, buf), gt, {"dpi": 200 if idx % 2 else 150}


def b_edge_date(rng, idx):
    variants = ["flush_left", "boxed_border", "pair_1", "pair_11", "iso", "month_name"]
    v = variants[idx % 6]
    issuer = ISSUERS[(idx + 3) % 4]
    buf, c, p = start(issuer)
    ref = mkref("INV", rng)
    if v == "pair_1":
        date_print, gt_date = "1/12/2026", "01-12-2026"
    elif v == "pair_11":
        date_print, gt_date = "11/12/2026", "11-12-2026"
    elif v == "iso":
        d = mkdate(rng); gt_date = d
        date_print = f"{d[6:]}-{d[3:5]}-{d[:2]}"
    elif v == "month_name":
        months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        d = mkdate(rng); gt_date = d
        date_print = f"{int(d[:2])} {months[int(d[3:5]) - 1]} {d[6:]}"
    else:
        gt_date = mkdate(rng); date_print = gt_date
    y = header(p, issuer, _LOGOS[issuer["slug"]], "INVOICE")
    if v == "flush_left":                    # the date starts at the page's very edge
        p.t(2, y + 14, date_print, 9.5)
        p.t(120, y + 14, f"Invoice No: {ref}", 9.5, bold=True)
    elif v == "boxed_border":                # the date inside a box, glyphs touching the rule
        p.rect(40, y + 2, 120, 16, outline=issuer["rgb"], lw=1.2)
        p.t(41, y + 14, date_print, 10)
        p.t(200, y + 14, f"Invoice No: {ref}", 9.5, bold=True)
    else:
        p.t(46, y + 14, f"Date: {date_print}", 9.5)
        p.t(240, y + 14, f"Invoice No: {ref}", 9.5, bold=True)
    y = parties(p, y + 28, issuer["rgb"])
    items = make_items(issuer, rng, n=2)
    y = items_table(p, issuer, y + 4, items)
    net = round(sum(i["net"] for i in items), 2)
    _n, vat, total, _ = totals_block(p, PAGE_W - 220, PAGE_W - 46, y + 8, net)
    gt = base_gt("edge_date", v, issuer, "invoice", ref, gt_date)
    gt.update(subtotal=money(net), tax=money(vat), total=money(total))
    return finish(c, buf), gt, {"skew": 1.2 if v in ("flush_left", "boxed_border") else None}


def b_buyer_large(rng, idx):
    variants = ["buyer_bigger", "ship_to_right", "buyer_issued_po"]
    v = variants[idx % 3]
    issuer = ISSUERS[idx % 5]
    ref, date = mkref("PO" if v == "buyer_issued_po" else "INV", rng), mkdate(rng)
    if v == "buyer_issued_po":
        # the BUYER's letterhead; the issuer of record for filing is the SUPPLIER (the vendor)
        head = dict(name=BUYER["name"], address=BUYER["address"], vat=BUYER["vat"],
                    rgb=BUYER["rgb"], font="Helvetica", acct="", products=issuer["products"])
        buf, c, p = start(head)
        y = header(p, head, _LOGOS["BUYER"], "PURCHASE ORDER")
        y = meta_row(p, y + 6, [("PO Number", ref), ("PO Date", date)], head["rgb"])
        p.t(40, y + 6, "SUPPLIER", 8, bold=True, rgb=head["rgb"])
        p.t(40, y + 19, issuer["name"], 11, bold=True)
        yy = y + 33
        for ln in issuer["address"]:
            p.t(40, yy, ln, 9); yy += 12
        p.t(PAGE_W / 2 + 10, y + 6, "DELIVER TO", 8, bold=True, rgb=head["rgb"])
        p.t(PAGE_W / 2 + 10, y + 19, BUYER["name"], 9)
        y = yy + 10
        items = make_items(issuer, rng, n=2)
        y = items_table(p, head, y + 4, items)
        net = round(sum(i["net"] for i in items), 2)
        _n, vat, total, _ = totals_block(p, PAGE_W - 220, PAGE_W - 46, y + 8, net, label="Order Total")
        gt = base_gt("buyer_large", v, issuer, "purchase_order", ref, date)
        gt.update(subtotal=money(net), tax=money(vat), total=money(total), printed_vat_no=BUYER["vat"])
        return finish(c, buf), gt, {}
    buf, c, p = start(issuer)
    y = header(p, issuer, _LOGOS[issuer["slug"]], "INVOICE", big_title_size=16)
    y = meta_row(p, y + 6, [("Invoice No", ref), ("Date", date)], issuer["rgb"])
    # BILL FROM small | BILL TO (the buyer) LARGER than the issuer's name anywhere on the page
    p.t(40, y + 6, "BILL FROM", 8, bold=True, rgb=issuer["rgb"])
    p.t(40, y + 19, issuer["name"], 8.5)
    p.t(40, y + 30, " · ".join(issuer["address"]), 7.5)
    cap = "SHIP TO" if v == "ship_to_right" else "BILL TO"
    p.t(PAGE_W / 2 + 10, y + 6, cap, 8, bold=True, rgb=issuer["rgb"])
    p.t(PAGE_W / 2 + 10, y + 22, BUYER["name"], 14, bold=True)
    yy = y + 38
    for ln in BUYER["address"]:
        p.t(PAGE_W / 2 + 10, yy, ln, 9); yy += 12
    y = yy + 8
    items = make_items(issuer, rng, n=2)
    y = items_table(p, issuer, y + 4, items)
    net = round(sum(i["net"] for i in items), 2)
    _n, vat, total, _ = totals_block(p, PAGE_W - 220, PAGE_W - 46, y + 8, net)
    gt = base_gt("buyer_large", v, issuer, "invoice", ref, date)
    gt.update(subtotal=money(net), tax=money(vat), total=money(total))
    return finish(c, buf), gt, {}


def b_continental(rng, idx):
    variants = ["dot_thousands", "space_thousands", "swiss", "eur_after"]
    v = variants[idx % 4]
    issuer = ISSUERS[(idx + 1) % 5]
    eu_vats = ["DE 129 273 398", "FR 12 345 678 901", "NL 8528.66.404.B01", "IT 00743110157"]
    buf, c, p = start(issuer)
    ref, date = mkref("RE" if v == "dot_thousands" else "INV", rng), mkdate(rng)
    y = header(p, issuer, _LOGOS[issuer["slug"]], "INVOICE / RECHNUNG" if v == "dot_thousands" else "INVOICE")
    p.t(46, y + 12, f"Invoice No: {ref}", 9.5, bold=True)
    p.t(240, y + 12, f"Date: {date}", 9.5)
    p.t(400, y + 12, f"VAT ID: {eu_vats[idx % 4]}", 9)
    y = parties(p, y + 26, issuer["rgb"])
    items = make_items(issuer, rng, n=3)
    y = items_table(p, issuer, y + 4, items)
    net = round(sum(i["net"] for i in items), 2)
    vat = round(net * 0.2, 2)
    total = round(net + vat, 2)

    def fmt(x):
        s = f"{x:,.2f}"                       # 1,234.56
        if v == "dot_thousands":
            return s.replace(",", "§").replace(".", ",").replace("§", ".")   # 1.234,56
        if v == "space_thousands":
            return s.replace(",", "§").replace(".", ",").replace("§", " ")   # 1 234,56
        if v == "swiss":
            return s.replace(",", "'")                                        # 1'234.56
        return s.replace(",", "§").replace(".", ",").replace("§", ".")        # eur_after prints 1.234,56 €
    cur = "" if v == "eur_after" else "€"
    yy = y + 10
    for k, val, bold in (("Netto", net, False), ("MwSt 20%", vat, False), ("Gesamtbetrag", total, True)):
        p.t(PAGE_W - 230, yy, k, 9 + (1 if bold else 0), bold=bold)
        amt = f"{cur}{fmt(val)}" + (" €" if v == "eur_after" else "")
        p.t(PAGE_W - 46, yy, amt, 9 + (1 if bold else 0), bold=bold, right=True)
        yy += 16
    gt = base_gt("continental", v, issuer, "invoice", ref, date)
    gt.update(subtotal=money(net), tax=money(vat), total=money(total), currency="eur", eu_vat=eu_vats[idx % 4])
    return finish(c, buf), gt, {}


def b_logo_siblings(rng, idx):
    variants = ["sib_invoice", "sib_credit", "sib_statement", "lookalike_a", "lookalike_b"]
    v = variants[idx % 5]
    if v.startswith("sib"):
        issuer = BY_SLUG["Helix-Point"]
        slug = {"sib_invoice": "invoice", "sib_credit": "credit_note", "sib_statement": "statement"}[v]
        title = {"invoice": "INVOICE", "credit_note": "CREDIT NOTE", "statement": "STATEMENT"}[slug]
        pref = {"invoice": "HPI", "credit_note": "HPC", "statement": "HPS"}[slug]
    else:
        issuer = BY_SLUG["Kestrel-Ridge" if v == "lookalike_a" else "Kite-Ridge"]
        slug, title, pref = "invoice", "INVOICE", "KR" if v == "lookalike_a" else "KO"
    buf, c, p = start(issuer)
    ref, date = mkref(pref, rng), mkdate(rng)
    y = header(p, issuer, _LOGOS[issuer["slug"]], title)
    y = meta_row(p, y + 6, [("Ref", ref), ("Date", date), ("Account", issuer["acct"])], issuer["rgb"])
    y = parties(p, y + 4, issuer["rgb"])
    gt = base_gt("logo_siblings", v, issuer, slug, ref, date)
    if slug == "statement":
        yy = y + 10; bal = 0.0
        for _ in range(rng.randint(3, 6)):
            amt = round(rng.uniform(60, 700), 2); bal += amt
            p.t(46, yy, mkdate(rng), 9); p.t(160, yy, mkref("HPI", rng), 9)
            p.t(PAGE_W - 46, yy, f"£{money(amt)}", 9, right=True)
            yy += 14
        p.t(PAGE_W - 200, yy + 12, "Balance Due", 10, bold=True)
        p.t(PAGE_W - 46, yy + 12, f"£{money(round(bal, 2))}", 10, bold=True, right=True)
        gt.update(total=money(round(bal, 2)))
    else:
        items = make_items(issuer, rng, n=2)
        y = items_table(p, issuer, y + 4, items)
        net = round(sum(i["net"] for i in items), 2)
        sign = -1 if slug == "credit_note" else 1
        _n, vat, total, _ = totals_block(p, PAGE_W - 220, PAGE_W - 46, y + 8, net, sign=sign,
                                         label="CREDIT TOTAL" if sign < 0 else "TOTAL")
        gt.update(subtotal=money(net), tax=money(vat), total=(("-" + money(abs(total))) if sign < 0 else money(total)))
    return finish(c, buf), gt, {}


def b_degraded(rng, idx):
    variants = ["skew1", "skew2", "skew3", "faint_serial", "thermal", "staple_blot", "fax_header"]
    v = variants[idx % 7]
    issuer = BY_SLUG["Helix-Point"] if v == "faint_serial" else ISSUERS[idx % 4]
    if v == "thermal":                        # narrow till-roll page
        buf = io.BytesIO()
        W = 226
        c = canvas.Canvas(buf, pagesize=(W, 520))
        ref, date = f"RCP-{rng.randint(10000, 99999)}", mkdate(rng)
        c.setFont("Courier-Bold", 10); c.drawCentredString(W / 2, 490, issuer["name"].upper())
        c.setFont("Courier", 7); c.drawCentredString(W / 2, 478, " ".join(issuer["address"]))
        c.setFont("Courier", 8)
        c.drawString(12, 456, f"RECEIPT {ref}")
        c.drawString(12, 444, f"DATE {date}")
        yy = 424; net = 0.0
        for prod in rng.sample(issuer["products"], 3):
            c.drawString(12, yy, prod[0][:22]); c.drawRightString(W - 12, yy, f"{prod[1]:,.2f}")
            net += prod[1]; yy -= 12
        net = round(net, 2); vat = round(net * 0.2, 2); total = round(net + vat, 2)
        c.drawString(12, yy - 6, "VAT 20%"); c.drawRightString(W - 12, yy - 6, f"{vat:,.2f}")
        c.setFont("Courier-Bold", 9)
        c.drawString(12, yy - 22, "TOTAL"); c.drawRightString(W - 12, yy - 22, f"{total:,.2f}")
        c.showPage(); c.save(); buf.seek(0)
        gt = base_gt("degraded", v, issuer, "invoice", ref, date)
        gt.update(subtotal=money(net), tax=money(vat), total=money(total))
        return buf.read(), gt, {"fade": True, "dpi": 150}
    buf, c, p = start(issuer)
    ref, date = mkref("INV", rng), mkdate(rng)
    if v == "fax_header":
        p.t(40, 18, f"FROM {issuer['name'].upper()}  {date}  P.01/01  +44 1632 960{rng.randint(100, 999)}", 7,
            font="Courier")
    y = header(p, issuer, _LOGOS[issuer["slug"]], "INVOICE")
    y = meta_row(p, y + 6, [("Invoice No", ref), ("Date", date)], issuer["rgb"])
    y = parties(p, y + 4, issuer["rgb"])
    items = make_items(issuer, rng, n=3, faint_serials=(v == "faint_serial"))
    y = items_table(p, issuer, y + 4, items)
    net = round(sum(i["net"] for i in items), 2)
    _n, vat, total, _ = totals_block(p, PAGE_W - 220, PAGE_W - 46, y + 8, net)
    gt = base_gt("degraded", v, issuer, "invoice", ref, date)
    gt.update(subtotal=money(net), tax=money(vat), total=money(total),
              serials=[sn for it in items for sn, _f in it.get("serials", [])] or None)
    params = {}
    if v in ("skew1", "skew2", "skew3"):
        params["skew"] = {"skew1": 1.0, "skew2": 2.0, "skew3": 3.0}[v]
    if v == "staple_blot":
        params["blot"] = "ref"                # the blot lands over the meta row's top-left (the ref)
    return finish(c, buf), gt, params


def b_multipage(rng, idx):
    variants = ["total_last_page", "carried_fwd_trap"]
    v = variants[idx % 2]
    issuer = ISSUERS[(idx + 2) % 5]
    buf, c, p = start(issuer)
    ref, date = mkref("INV", rng), mkdate(rng)
    y = header(p, issuer, _LOGOS[issuer["slug"]], "INVOICE")
    y = meta_row(p, y + 6, [("Invoice No", ref), ("Date", date), ("Page", "1 of 2")], issuer["rgb"])
    y = parties(p, y + 4, issuer["rgb"])
    items1 = make_items(issuer, rng, n=4)
    y = items_table(p, issuer, y + 4, items1)
    run1 = round(sum(i["net"] for i in items1), 2)
    if v == "carried_fwd_trap":
        p.t(PAGE_W - 220, y + 10, "Carried forward", 9, bold=True)
        p.t(PAGE_W - 46, y + 10, f"£{money(run1)}", 9, bold=True, right=True)
    p.t(PAGE_W / 2, 806, "continued …", 8.5, centre=True, rgb=(120, 120, 120))
    c.showPage()
    p2 = Page(c, issuer["font"])
    y = header(p2, issuer, _LOGOS[issuer["slug"]], "INVOICE (cont.)", big_title_size=14)
    p2.t(46, y + 12, f"Invoice No: {ref}   ·   Page 2 of 2", 9, bold=True)
    items2 = make_items(issuer, rng, n=2)
    y = items_table(p2, issuer, y + 24, items2)
    net = round(run1 + sum(i["net"] for i in items2), 2)
    _n, vat, total, _ = totals_block(p2, PAGE_W - 220, PAGE_W - 46, y + 10, net)
    gt = base_gt("multipage", v, issuer, "invoice", ref, date)
    gt.update(subtotal=money(net), tax=money(vat), total=money(total), pages=2)
    return finish(c, buf), gt, {}


def b_credit_sign(rng, idx):
    variants = ["lead_minus", "sym_minus", "parens", "trail_minus", "cr_marker", "dash_leader_control"]
    v = variants[idx % 6]
    issuer = ISSUERS[(idx + 3) % 5]
    buf, c, p = start(issuer)
    control = v == "dash_leader_control"
    slug = "invoice" if control else "credit_note"
    ref = mkref("INV" if control else "CN", rng)
    date = mkdate(rng)
    y = header(p, issuer, _LOGOS[issuer["slug"]], "INVOICE" if control else "CREDIT NOTE")
    y = meta_row(p, y + 6, [("Ref", ref), ("Date", date)], issuer["rgb"])
    y = parties(p, y + 4, issuer["rgb"])
    items = make_items(issuer, rng, n=2)
    y = items_table(p, issuer, y + 4, items)
    net = round(sum(i["net"] for i in items), 2)
    vat = round(net * 0.2, 2)
    total = round(net + vat, 2)

    def fmt(x):
        s = money(x)
        return {"lead_minus": f"-£{s}", "sym_minus": f"£-{s}", "parens": f"(£{s})",
                "trail_minus": f"£{s}-", "cr_marker": f"£{s} CR"}.get(v, f"£{s}")
    yy = y + 10
    for k, val, bold in (("Net", net, False), ("VAT @ 20%", vat, False),
                         ("TOTAL" if control else "CREDIT TOTAL", total, True)):
        p.t(PAGE_W - 240, yy, k, 9 + (1 if bold else 0), bold=bold)
        if control and bold:
            p.t(PAGE_W - 190, yy, "-" * 16, 9)
        p.t(PAGE_W - 46, yy, fmt(val) if bold or not control else f"£{money(val)}", 9 + (1 if bold else 0),
            bold=bold, right=True)
        yy += 16
    if not control:
        p.t(40, yy + 6, f"Credit against invoice {mkref('INV', rng)} — goods returned.", 9)
    gt = base_gt("credit_sign", v, issuer, slug, ref, date, control=control)
    gt.update(subtotal=money(net), tax=money(vat), total=(money(total) if control else "-" + money(total)))
    return finish(c, buf), gt, {}


BUILDERS = dict(multicol_money=b_multicol_money, table_total=b_table_total, small_print=b_small_print,
                edge_date=b_edge_date, buyer_large=b_buyer_large, continental=b_continental,
                logo_siblings=b_logo_siblings, degraded=b_degraded, multipage=b_multipage,
                credit_sign=b_credit_sign)


# ── Scan rendition (gen_customer_test.scanify, extended: dpi / forced skew / fade / blot / fax) ──
def scanify(pdf_bytes, rng, dpi=150, skew=None, fade=False, blot=None):
    pdf = pdfium.PdfDocument(pdf_bytes)
    pages = []
    for pg in pdf:
        pil = pg.render(scale=dpi / 72.0).to_pil().convert("L")
        angle = skew if skew is not None else (rng.uniform(-1.6, 1.6) if rng.random() < 0.7 else 0.0)
        if angle:
            pil = pil.rotate(angle, expand=False, fillcolor=245, resample=Image.BICUBIC)   # fixed glass size
        if fade:
            pil = ImageEnhance.Contrast(pil).enhance(0.62)
            pil = ImageEnhance.Brightness(pil).enhance(1.12)
        else:
            pil = ImageEnhance.Brightness(pil).enhance(rng.uniform(0.94, 1.08))
            pil = ImageEnhance.Contrast(pil).enhance(rng.uniform(0.88, 1.05))
        if rng.random() < 0.5:
            pil = pil.filter(ImageFilter.GaussianBlur(rng.uniform(0.2, 0.7)))
        noise = Image.effect_noise(pil.size, rng.uniform(6, 16)).point(lambda v: v // 3 + 170)
        pil = Image.blend(pil, noise, 0.10)
        if blot == "ref" and not pages:       # a staple/ink blot over the meta row's top-left corner
            d = ImageDraw.Draw(pil)
            bx, by = int(pil.width * 0.075), int(pil.height * 0.145)
            for i in range(3):
                d.ellipse([bx + i * 9, by + i * 5, bx + 34 + i * 9, by + 22 + i * 5], fill=35 + i * 10)
        pages.append(pil.convert("RGB"))
    pdf.close()
    out = io.BytesIO()
    pages[0].save(out, "PDF", resolution=float(dpi), save_all=len(pages) > 1, append_images=pages[1:])
    return out.getvalue()


_LOGOS = None


def _pool_init():
    global _LOGOS
    _LOGOS = {i["slug"]: draw_logo(i["slug"], i["initials"], i["rgb"]) for i in ISSUERS}
    _LOGOS["BUYER"] = draw_logo("BUYER", "BJ", BUYER["rgb"])


def render_one(job):
    cls, idx = job
    rng = random.Random(f"hardset|{cls}|{idx}")
    pdf, gt, params = BUILDERS[cls](rng, idx)
    fn = f"{cls}_{idx:03d}.pdf"
    rows = []
    dpath = os.path.join(DIGITAL, cls, fn)
    os.makedirs(os.path.dirname(dpath), exist_ok=True)
    with open(dpath, "wb") as f:
        f.write(pdf)
    rows.append(dict(gt, file=os.path.relpath(dpath, ROOT), rendition="digital"))
    if pdfium is not None:
        spath = os.path.join(SCAN, cls, fn)
        os.makedirs(os.path.dirname(spath), exist_ok=True)
        with open(spath, "wb") as f:
            f.write(scanify(pdf, rng, dpi=params.get("dpi", 150), skew=params.get("skew"),
                            fade=params.get("fade", False), blot=params.get("blot")))
        rows.append(dict(gt, file=os.path.relpath(spath, ROOT), rendition="scan",
                         scan_dpi=params.get("dpi", 150), scan_skew=params.get("skew")))
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--smoke", action="store_true", help="1 doc per class")
    ap.add_argument("--per-class", type=int, default=20)
    ap.add_argument("--workers", type=int, default=8)
    a = ap.parse_args()
    n = 1 if a.smoke else a.per_class

    os.makedirs(LOGODIR, exist_ok=True)
    _pool_init()
    for slug, img in _LOGOS.items():
        img.save(os.path.join(LOGODIR, f"{slug}.png"))

    jobs = [(cls, i) for cls in BUILDERS for i in range(1, n + 1)]
    print(f"generating {len(jobs)} documents x 2 renditions into {ROOT} ...")
    if a.workers <= 1 or a.smoke:
        rows = [render_one(j) for j in jobs]
    else:
        with Pool(a.workers, initializer=_pool_init) as pool:
            rows = pool.map(render_one, jobs, chunksize=4)
    gts = [r for rr in rows for r in rr]
    with open(os.path.join(ROOT, "ground_truth.json"), "w", encoding="utf-8") as f:
        json.dump(gts, f, indent=1)
    with open(os.path.join(ROOT, "README_PROTOCOL.txt"), "w", encoding="utf-8") as f:
        f.write(
            "HARD SET — the adversarial test corpus (stress_test/gen_hard_set.py, 2026-08-31 night run).\n\n"
            "SYNTHETIC documents from NEW made-up issuers (plus the Bramblewood buyer identity as the\n"
            "recipient / PO letterhead, matching the customer corpus). Ten classes, each tagged in\n"
            "ground_truth.json (`cls`, `variant`, `control`): multicol_money, table_total, small_print,\n"
            "edge_date, buyer_large, continental, logo_siblings, degraded, multipage, credit_sign.\n"
            "TWO renditions of every document: digital/ (true text layer) and scan/ (rasterised 150/200 DPI\n"
            "with per-class skew/noise/fade/blots). `control` rows are the clean baselines and MUST score\n"
            "clean before any class number is read.\n\n"
            "SAFE USE: score with stress_test/score_hard_set.js (cold/warm, read-only). If importing into an\n"
            "app, use a SANDBOXED instance only — never confirm these into the live learning.\n")
    per = {}
    for r in gts:
        per[r["cls"]] = per.get(r["cls"], 0) + 1
    print("rows:", len(gts), "per class (files):", per)
    print("->", ROOT)


if __name__ == "__main__":
    main()
