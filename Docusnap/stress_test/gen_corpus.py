"""
Corpus generator for the detection stress test.

Produces text-based PDFs (real text layer -> born-digital) and image-only
"scanned" PDFs (rasterised + mild scan noise -> forces OCR), across 3 doc types
and 5 companies (each with a distinct logo), with rich line-item content and a
per-document ground-truth record.

Usage:  py -3.12 gen_corpus.py <n_text> <n_scanned>   (defaults 200 200)

No app code is touched; this only writes files under stress_test/corpus/.
"""
import json, os, random, sys, math
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
CORPUS = os.path.join(HERE, "corpus")
LOGODIR = os.path.join(CORPUS, "logos")
os.makedirs(LOGODIR, exist_ok=True)

PAGE_W, PAGE_H = letter            # 612 x 792 points
S = 1650.0 / PAGE_H                # points -> pixels scale for 150 DPI raster

ARIAL = "C:/Windows/Fonts/arial.ttf"
ARIALBD = "C:/Windows/Fonts/arialbd.ttf"

COMPANIES = [
    {"name": "Acme Industrial",    "initials": "AI", "rgb": (198, 40, 40),  "ref_seed": 10000, "style": "bars_v"},
    {"name": "Bluewave Supplies",  "initials": "BW", "rgb": (21, 101, 192), "ref_seed": 20000, "style": "bars_h"},
    {"name": "Greenfield Trading", "initials": "GF", "rgb": (46, 125, 50),  "ref_seed": 30000, "style": "ring"},
    {"name": "Sunrise Components", "initials": "SC", "rgb": (239, 108, 0),  "ref_seed": 40000, "style": "grid"},
    {"name": "Meridian Logistics", "initials": "ML", "rgb": (106, 27, 154), "ref_seed": 50000, "style": "triangle"},
]

TYPES = {
    "invoice":        {"title": "INVOICE",        "ref_label": "Invoice No:", "ref_pref": "INV", "date_label": "Invoice Date:"},
    "sales_order":    {"title": "SALES ORDER",    "ref_label": "Order No:",   "ref_pref": "SO",  "date_label": "Order Date:"},
    "purchase_order": {"title": "PURCHASE ORDER", "ref_label": "PO No:",      "ref_pref": "PO",  "date_label": "PO Date:"},
}
TYPE_LIST = list(TYPES.keys())

PRODUCTS = [
    ("Steel Bracket 40mm", 12.50), ("Copper Pipe 2m", 8.75), ("Hex Bolt M8 (100pk)", 5.40),
    ("Rubber Gasket Set", 15.20), ("LED Panel 600x600", 42.00), ("Cable Reel 50m", 31.90),
    ("Safety Gloves (pair)", 6.30), ("Paint Primer 5L", 24.75), ("Timber Plank 2.4m", 9.15),
    ("Insulation Roll", 38.60), ("Angle Grinder Disc", 3.85), ("Silicone Sealant", 4.60),
    ("Wall Anchor (50pk)", 7.20), ("Circuit Breaker 32A", 18.40), ("PVC Conduit 3m", 5.95),
]

def money(v):
    return "${:,.2f}".format(v)

def gen_logo(c):
    # Each company gets a STRUCTURALLY distinct emblem (different shapes/ink layout,
    # not just colour) — a greyscale phash is colour-blind, so structure is what makes
    # the five logos separable well beyond the match threshold + scan drift.
    path = os.path.join(LOGODIR, c["initials"] + ".png")
    if os.path.exists(path):
        return path
    # Wide 2:1 emblem (matches the header banner box). compute_logo_hash squashes the
    # top-left crop to 256x256 then hashes an 8x8 DCT, which compresses HORIZONTAL detail
    # ~5x — so the emblems are made to differ in their COARSE, VERTICAL ink distribution
    # (bands/solid/ring/checker/triangle), which survives the squash and separates well.
    # A DISTINCT dense emblem per company: a coarse block "crest" whose filled cells
    # are fixed per company. Dense solid blocks are drift-robust and fill the top-left
    # crop with rich, company-specific coarse structure, so the greyscale phash lands
    # the five logos far apart (well beyond the match threshold + scan drift).
    W, H = 800, 400
    img = Image.new("RGB", (W, H), (255, 255, 255))
    d = ImageDraw.Draw(img)
    col = c["rgb"]
    COLS, ROWS = 6, 4
    rng = random.Random(c["ref_seed"])           # fixed, distinct per company
    cw, ch = (W - 40) // COLS, (H - 40) // ROWS
    for r in range(ROWS):
        for cc in range(COLS):
            if rng.random() < 0.5:
                x0, y0 = 20 + cc * cw, 20 + r * ch
                d.rectangle([x0, y0, x0 + cw - 6, y0 + ch - 6], fill=col)
    img.save(path)
    return path

def build_doc(idx, rng):
    company = COMPANIES[idx % len(COMPANIES)]
    tslug = TYPE_LIST[idx % len(TYPE_LIST)]
    t = TYPES[tslug]
    ref = "{}-{}".format(t["ref_pref"], company["ref_seed"] + idx)
    day = rng.randint(13, 28); mon = rng.randint(1, 12); yr = rng.randint(2021, 2025)
    date = "{:02d}-{:02d}-{:04d}".format(day, mon, yr)
    n_items = rng.randint(3, 5)
    items = []
    for _ in range(n_items):
        p = rng.choice(PRODUCTS)
        qty = rng.randint(1, 9)
        price = round(p[1] * rng.uniform(0.9, 1.15), 2)
        items.append({"product": p[0], "qty": qty, "price": price, "amount": round(qty * price, 2)})
    subtotal = round(sum(i["amount"] for i in items), 2)
    shipping = round(rng.uniform(5, 95), 2)
    total = round(subtotal + shipping, 2)
    return {
        "idx": idx, "type_slug": tslug, "company": company["name"], "initials": company["initials"],
        "ref": ref, "ref_label": t["ref_label"], "title": t["title"], "date": date,
        "date_label": t["date_label"], "items": items, "subtotal": subtotal,
        "shipping": shipping, "total": total,
    }

# Layout in POINTS, y measured from the TOP of the page.
def layout(doc):
    """Return (logo_box, text_items) where text_items = [(x, y_top, text, size, bold, align)]."""
    logo_box = (40, 26, 210, 105)  # x, y_top, w, h (wide banner — matches the 2:1 emblem)
    it = []
    it.append((40, 138, doc["company"], 15, True, "l"))
    it.append((PAGE_W - 50, 60, doc["title"], 26, True, "r"))
    it.append((PAGE_W - 50, 92, "{} {}".format(doc["ref_label"], doc["ref"]), 11, False, "r"))
    it.append((PAGE_W - 50, 108, "{} {}".format(doc["date_label"], doc["date"]), 11, False, "r"))
    it.append((50, 172, "Bill To:", 10, True, "l"))
    it.append((50, 188, "Customer Account 7788", 10, False, "l"))
    # table header
    hy = 250
    it.append((50, hy, "Description", 10, True, "l"))
    it.append((360, hy, "Qty", 10, True, "r"))
    it.append((460, hy, "Unit Price", 10, True, "r"))
    it.append((560, hy, "Amount", 10, True, "r"))
    y = hy + 22
    for row in doc["items"]:
        it.append((50, y, row["product"], 10, False, "l"))
        it.append((360, y, str(row["qty"]), 10, False, "r"))
        it.append((460, y, money(row["price"]), 10, False, "r"))
        it.append((560, y, money(row["amount"]), 10, False, "r"))
        y += 20
    ty = y + 24
    it.append((470, ty, "Subtotal:", 10, False, "r"))
    it.append((560, ty, money(doc["subtotal"]), 10, False, "r"))
    it.append((470, ty + 20, "Shipping:", 10, False, "r"))
    it.append((560, ty + 20, money(doc["shipping"]), 10, False, "r"))
    it.append((470, ty + 44, "Total:", 12, True, "r"))
    it.append((560, ty + 44, money(doc["total"]), 12, True, "r"))
    it.append((50, 720, "Thank you for your business.", 9, False, "l"))
    return logo_box, it

def render_text_pdf(doc, path):
    logo_box, items = layout(doc)
    c = canvas.Canvas(path, pagesize=letter)
    lx, ly, lw, lh = logo_box
    c.drawImage(gen_logo(next(cc for cc in COMPANIES if cc["name"] == doc["company"])),
                lx, PAGE_H - ly - lh, width=lw, height=lh, mask="auto")
    for (x, yt, text, size, bold, align) in items:
        c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        y = PAGE_H - yt - size
        if align == "r":
            c.drawRightString(x, y, text)
        else:
            c.drawString(x, y, text)
    c.showPage(); c.save()

def render_scanned_pdf(doc, path, rng):
    logo_box, items = layout(doc)
    W, H = int(PAGE_W * S), int(PAGE_H * S)
    img = Image.new("RGB", (W, H), (252, 252, 250))
    d = ImageDraw.Draw(img)
    logo = Image.open(gen_logo(next(cc for cc in COMPANIES if cc["name"] == doc["company"]))).convert("RGB")
    lx, ly, lw, lh = logo_box
    logo = logo.resize((int(lw * S), int(lh * S)))
    img.paste(logo, (int(lx * S), int(ly * S)))
    for (x, yt, text, size, bold, align) in items:
        try:
            f = ImageFont.truetype(ARIALBD if bold else ARIAL, int(size * S))
        except Exception:
            f = ImageFont.load_default()
        tw = d.textlength(text, font=f)
        px = x * S - (tw if align == "r" else 0)
        d.text((px, yt * S), text, fill=(15, 15, 20), font=f)
    # mild scan artefacts: tiny rotation, light gaussian noise, faint blur
    ang = rng.uniform(-1.0, 1.0)
    img = img.rotate(ang, resample=Image.BICUBIC, fillcolor=(252, 252, 250))
    import numpy as np
    arr = np.asarray(img).astype(np.int16)
    noise = rng_noise(arr.shape, rng)
    arr = np.clip(arr + noise, 0, 255).astype("uint8")
    img = Image.fromarray(arr)
    img = img.filter(ImageFilter.GaussianBlur(0.4))
    img.convert("RGB").save(path, "PDF", resolution=150.0)

def rng_noise(shape, rng):
    import numpy as np
    st = np.random.RandomState(rng.randint(0, 2**31 - 1))
    return (st.randn(*shape) * 5.0).astype(np.int16)

def main():
    n_text = int(sys.argv[1]) if len(sys.argv) > 1 else 200
    n_scan = int(sys.argv[2]) if len(sys.argv) > 2 else 200
    rng = random.Random(4242)
    for c in COMPANIES:
        gen_logo(c)
    truth = []
    total = n_text + n_scan
    for i in range(total):
        variant = "text" if i < n_text else "scanned"
        doc = build_doc(i, rng)
        fname = "{}_{}_{}_{}.pdf".format(variant, doc["type_slug"], doc["initials"], doc["ref"])
        path = os.path.join(CORPUS, fname)
        if variant == "text":
            render_text_pdf(doc, path)
        else:
            render_scanned_pdf(doc, path, rng)
        doc["variant"] = variant
        doc["filename"] = fname
        truth.append(doc)
        if (i + 1) % 25 == 0:
            print("  generated {}/{}".format(i + 1, total)); sys.stdout.flush()
    with open(os.path.join(CORPUS, "ground_truth.json"), "w") as f:
        json.dump(truth, f, indent=1)
    print("DONE: {} docs ({} text, {} scanned) + ground_truth.json".format(total, n_text, n_scan))

if __name__ == "__main__":
    main()
