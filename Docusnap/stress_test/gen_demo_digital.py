"""
Born-digital DEMO DOC generator for ScanFinder layout/type/identity stress-testing.

Produces REAL text-layer PDFs (born-digital -> the app reads the text layer, skips OCR),
so every bug it surfaces is a LAYOUT / field-anchor / issuer-band / doc-type bug with no OCR
noise as a confound. Catalogue distilled from barry (layout coverage), herald (title/type +
the TYPE_PRESENCE_VETO), and gary (digital<->scanned bleed) advisories.

Two sets:
  SET A  — 6 NEW suppliers (unique names + logos), full archetype variety. Safe to import
           anywhere; the clean layout-accuracy baseline.
  SET B  — CLASH: reuses live supplier NAMES (SuperStore text-logo exact; Marlowe Medical
           name-scoped) on divergent digital layouts to probe digital<->scanned learning
           bleed. Import per README_PROTOCOL.txt (COPY DB, or plain-confirm-only on live).

Every doc gets a machine-readable ground-truth row (ground_truth.json) so a layout bug shows
as a FIELD-level diff, not "looks wrong". Seed-first note (herald): the veto is inert until a
sibling template has >=3 confirmed in-band-title docs, so most docs carry a clean top-standalone
title (valid seeds); a tagged MINORITY are edge variants.

Usage:  py -3.12 gen_demo_digital.py [docs_per_type]   (default 20; small number for a smoke)
Output: %USERPROFILE%/Desktop/Demo Docs Digital/
No app code touched; only writes files under the Desktop folder.
"""
import json
import os
import random
import sys

from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
from PIL import Image, ImageDraw, ImageFont

PAGE_W, PAGE_H = letter                      # 612 x 792 points, y from TOP in our layout DSL
ARIAL   = "C:/Windows/Fonts/arial.ttf"
ARIALBD = "C:/Windows/Fonts/arialbd.ttf"

DESKTOP = os.path.join(os.environ.get("USERPROFILE", os.path.expanduser("~")), "Desktop")
ROOT    = os.path.join(DESKTOP, "Demo Docs Digital")
LOGODIR = os.path.join(ROOT, "_logos")

# ── Type catalogue ────────────────────────────────────────────────────────────────
# title      = the printed heading. ref_prefs/ref_labels/date_labels are ROTATED per doc to
# vary the caption the extractor keys on. money=False -> no totals (delivery/worksheet).
# sign=-1 -> negative totals (credit note). multi_ref -> a ledger of rows (statement).
TYPES = {
    "invoice":        dict(title="INVOICE",        ref_prefs=["INV"],      ref_labels=["Invoice No:", "Invoice Number:", "Invoice #", "Our Ref:"],     date_labels=["Invoice Date:", "Date:", "Issued:"],        money=True),
    "sales_order":    dict(title="SALES ORDER",    ref_prefs=["SO"],       ref_labels=["Order No:", "Sales Order No:", "SO Number:", "Order Ref:"],      date_labels=["Order Date:", "Date:"],                     money=True),
    "purchase_order": dict(title="PURCHASE ORDER", ref_prefs=["PO"],       ref_labels=["PO No:", "Purchase Order No:", "Order No:", "PO Number:"],       date_labels=["PO Date:", "Order Date:", "Date:"],         money=True, buyer_issued=True),
    "delivery_note":  dict(title="DELIVERY NOTE",  ref_prefs=["DN"],       ref_labels=["Delivery No:", "Delivery Note No:", "DN No:", "Docket No:"],     date_labels=["Delivery Date:", "Date:"],                  money=False),
    "credit_note":    dict(title="CREDIT NOTE",    ref_prefs=["CN"],       ref_labels=["Credit Note No:", "Credit No:", "CN Number:"],                   date_labels=["Credit Date:", "Date:"],                    money=True, sign=-1),
    "quote":          dict(title="QUOTATION",      ref_prefs=["QT"],       ref_labels=["Quote No:", "Quotation No:", "Estimate No:", "Ref:"],           date_labels=["Quote Date:", "Date:", "Valid From:"],      money=True, alt_titles=["QUOTATION", "ESTIMATE", "PROFORMA INVOICE"]),
    "statement":      dict(title="STATEMENT",      ref_prefs=["STMT"],     ref_labels=["Account No:", "Statement No:", "A/C:"],                          date_labels=["Statement Date:", "Date:"],                 money=True, multi_ref=True),
    "receipt":        dict(title="RECEIPT",        ref_prefs=["RCP"],      ref_labels=["Receipt No:", "Transaction ID:", "Ref:"],                       date_labels=["Date:", "Paid:"],                           money=True),
    "worksheet":      dict(title="SERVICE WORKSHEET", ref_prefs=["WS"],    ref_labels=["Worksheet No:", "Job No:", "Ref:"],                             date_labels=["Date:", "Job Date:"],                       money=False),
}

# ── Suppliers ─────────────────────────────────────────────────────────────────────
# logo: "image" = a structurally-distinct block crest PNG; "text" = a styled wordmark PNG
# (SuperStore class). archetype = the PRIMARY layout family (each supplier = one family, so a
# family's bugs cluster). types = the 5 doc types this supplier issues (varied to cover all 9).
CURRENCIES = {"gbp": "\u00a3", "usd": "$", "eur": "\u20ac"}

SET_A = [
    dict(name="Halcyon Supplies",     initials="HS", logo="image", rgb=(21, 101, 192),  seed=11000, cur="gbp",
         archetype="saas_clean",     types=["invoice", "credit_note", "quote", "statement", "receipt"]),
    dict(name="Ferndale Trading Co",  initials="FT", logo="image", rgb=(198, 40, 40),   seed=22000, cur="gbp",
         archetype="two_col_parties", types=["invoice", "sales_order", "purchase_order", "delivery_note", "credit_note"]),
    dict(name="Kingsworth Industrial", initials="KI", logo="image", rgb=(46, 125, 50),  seed=33000, cur="gbp",
         archetype="footer_letterhead", types=["invoice", "purchase_order", "delivery_note", "statement", "worksheet"]),
    dict(name="Oakmere Logistics",    initials="OL", logo="image", rgb=(106, 27, 154),  seed=44000, cur="usd",
         archetype="three_party",     types=["purchase_order", "delivery_note", "sales_order", "invoice", "receipt"]),
    dict(name="METROMART",            initials="MM", logo="text",  rgb=(33, 33, 33),     seed=55000, cur="gbp",
         archetype="minimalist_text", types=["invoice", "receipt", "credit_note", "quote", "sales_order"]),
    dict(name="Cityline Office",      initials="CO", logo="text",  rgb=(0, 121, 107),    seed=66000, cur="eur",
         archetype="subheading_text", types=["invoice", "purchase_order", "sales_order", "quote", "delivery_note"]),
]

# SET B — deliberate digital<->scanned CLASH. Reuses LIVE names. SuperStore = text wordmark
# (exact reproduction -> template-reuse-by-name + text-ID collision). Marlowe = image logo
# (name-scoped levers fire even without a phash match).
SET_B = [
    dict(name="SuperStore",        initials="SS", logo="text",  rgb=(20, 20, 20),    seed=77000, cur="gbp",
         archetype="minimalist_text", types=["invoice", "receipt", "credit_note", "quote", "sales_order"], clash=True),
    dict(name="Marlowe Medical Supplies", initials="MD", logo="image", rgb=(2, 119, 189), seed=88000, cur="gbp",
         archetype="two_col_parties", types=["invoice", "delivery_note", "purchase_order", "credit_note", "statement"], clash=True),
]

PRODUCTS = [
    ("Steel Bracket 40mm", 12.50), ("Copper Pipe 2m", 8.75), ("Hex Bolt M8 (100pk)", 5.40),
    ("Rubber Gasket Set", 15.20), ("LED Panel 600x600", 42.00), ("Cable Reel 50m", 31.90),
    ("Safety Gloves (pair)", 6.30), ("Paint Primer 5L", 24.75), ("Timber Plank 2.4m", 9.15),
    ("Insulation Roll", 38.60), ("Angle Grinder Disc", 3.85), ("Silicone Sealant", 4.60),
    ("Wall Anchor (50pk)", 7.20), ("Circuit Breaker 32A", 18.40), ("PVC Conduit 3m", 5.95),
]
CUSTOMERS = ["ACME Inc", "Bevan & Sons", "Cromwell Retail", "Dunmore Facilities", "Everest Fit-Out",
             "Fairhaven Trust", "Grange Motors", "Halpin Joinery"]


def money(v, sym):
    return "{}{:,.2f}".format(sym, v)


# ── Logos ───────────────────────────────────────────────────────────────────────
def gen_logo(sup):
    path = os.path.join(LOGODIR, sup["initials"] + ".png")
    if os.path.exists(path):
        return path
    if sup["logo"] == "text":
        # SuperStore-class wordmark: the company NAME as styled text, no pictorial mark.
        W, H = 900, 180
        img = Image.new("RGB", (W, H), (255, 255, 255))
        d = ImageDraw.Draw(img)
        try:
            f = ImageFont.truetype(ARIALBD, 120)
        except Exception:
            f = ImageFont.load_default()
        txt = sup["name"].upper()
        tw = d.textlength(txt, font=f)
        d.text(((W - tw) / 2, 20), txt, fill=sup["rgb"], font=f)
        img.save(path)
        return path
    # image crest: a distinct coarse block emblem (structure survives the phash squash).
    W, H = 800, 400
    img = Image.new("RGB", (W, H), (255, 255, 255))
    d = ImageDraw.Draw(img)
    COLS, ROWS = 6, 4
    rng = random.Random(sup["seed"])
    cw, ch = (W - 40) // COLS, (H - 40) // ROWS
    for r in range(ROWS):
        for cc in range(COLS):
            if rng.random() < 0.5:
                x0, y0 = 20 + cc * cw, 20 + r * ch
                d.rectangle([x0, y0, x0 + cw - 6, y0 + ch - 6], fill=sup["rgb"])
    img.save(path)
    return path


# ── Per-doc data ───────────────────────────────────────────────────────────────
def fmt_date(day, mon, yr, style):
    MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    if style == "dmy_slash":  return "{:02d}/{:02d}/{:04d}".format(day, mon, yr)
    if style == "mdy_slash":  return "{:02d}/{:02d}/{:04d}".format(mon, day, yr)     # ambiguous US order
    if style == "d_mon_y":    return "{:d} {} {:04d}".format(day, MON[mon], yr)
    if style == "iso":        return "{:04d}-{:02d}-{:02d}".format(yr, mon, day)
    return "{:02d}-{:02d}-{:04d}".format(day, mon, yr)


def build_doc(sup, tslug, i, rng):
    t = TYPES[tslug]
    ref_pref = rng.choice(t["ref_prefs"])
    ref_num  = sup["seed"] + i * 7 + rng.randint(0, 6)
    ref_style = rng.choice(["dash", "slash", "plain", "yearref"])
    if ref_style == "dash":     ref = "{}-{:05d}".format(ref_pref, ref_num)
    elif ref_style == "slash":  ref = "{}/{:05d}".format(ref_pref, ref_num)
    elif ref_style == "yearref": ref = "2026/{}/{:03d}".format(ref_pref, ref_num % 1000)
    else:                       ref = "{}{:06d}".format(ref_pref, ref_num)

    day = rng.randint(1, 28); mon = rng.randint(1, 12); yr = rng.randint(2024, 2026)
    date_style = rng.choice(["dmy_slash", "d_mon_y", "iso", "dmy_dash", "mdy_slash"])
    date_shown = fmt_date(day, mon, yr, date_style)
    date_canon = "{:02d}-{:02d}-{:04d}".format(day, mon, yr)      # what GT expects (DD-MM-YYYY)

    sym = CURRENCIES[sup["cur"]]
    n_items = rng.randint(3, 6)
    items = []
    for _ in range(n_items):
        p = rng.choice(PRODUCTS)
        qty = rng.randint(1, 9)
        price = round(p[1] * rng.uniform(0.9, 1.15), 2)
        items.append({"product": p[0], "qty": qty, "price": price, "amount": round(qty * price, 2)})
    subtotal = round(sum(x["amount"] for x in items), 2)
    shipping = round(rng.uniform(5, 95), 2)
    sign = t.get("sign", 1)
    total = round((subtotal + shipping) * sign, 2)

    title = t["title"]
    if t.get("alt_titles"):
        title = rng.choice(t["alt_titles"])

    return dict(sup=sup, tslug=tslug, type_title=title,
                ref=ref, ref_label=rng.choice(t["ref_labels"]),
                date_shown=date_shown, date_canon=date_canon,
                date_label=rng.choice(t["date_labels"]),
                items=items, subtotal=subtotal, shipping=shipping, total=total,
                money=t.get("money", True), multi_ref=t.get("multi_ref", False),
                buyer_issued=t.get("buyer_issued", False), sym=sym,
                customer=rng.choice(CUSTOMERS))


# ── Layout DSL ─────────────────────────────────────────────────────────────────
# Each archetype returns (logo_box_or_None, in_image_title_or_None, items) where items are
# (x, y_top, text, size, bold, align). y measured from the TOP; render flips to reportlab.
def _table(items, sym, y0, x_desc=50, money_on=True):
    it = []
    it.append((x_desc, y0, "Description", 10, True, "l"))
    it.append((360, y0, "Qty", 10, True, "r"))
    if money_on:
        it.append((470, y0, "Unit Price", 10, True, "r"))
        it.append((560, y0, "Amount", 10, True, "r"))
    y = y0 + 22
    for row in items:
        it.append((x_desc, y, row["product"], 10, False, "l"))
        it.append((360, y, str(row["qty"]), 10, False, "r"))
        if money_on:
            it.append((470, y, money(row["price"], sym), 10, False, "r"))
            it.append((560, y, money(row["amount"], sym), 10, False, "r"))
        y += 18
    return it, y


def _totals(doc, y):
    it = []
    it.append((470, y, "Subtotal:", 10, False, "r"));      it.append((560, y, money(doc["subtotal"], doc["sym"]), 10, False, "r"))
    it.append((470, y + 18, "Shipping:", 10, False, "r")); it.append((560, y + 18, money(doc["shipping"], doc["sym"]), 10, False, "r"))
    it.append((470, y + 40, "Total:", 12, True, "r"));     it.append((560, y + 40, money(doc["total"], doc["sym"]), 12, True, "r"))
    return it


def lay_saas_clean(doc, title_at):
    # logo+issuer top-left; a RIGHT details block with Invoice No + a SEPARATE Reference + Date
    # + Due Date (multi-ref/multi-date); Bill To below-left; bordered-ish table; balance box.
    it = []
    logo = (40, 26, 190, 95)
    it.append((40, 130, doc["sup"]["name"], 15, True, "l"))
    it.append((40, 148, "12 Kiln Road, Bristol BS1 4TT", 8, False, "l"))
    _title_items(it, doc, title_at, right_x=PAGE_W - 50, top_y=56)
    it.append((PAGE_W - 50, 92, "{} {}".format(doc["ref_label"], doc["ref"]), 10, False, "r"))
    it.append((PAGE_W - 50, 106, "Reference: CUST-{}".format(1000 + (doc["sup"]["seed"] % 900)), 9, False, "r"))
    it.append((PAGE_W - 50, 120, "{} {}".format(doc["date_label"], doc["date_shown"]), 10, False, "r"))
    it.append((PAGE_W - 50, 134, "Due Date: 30 days", 9, False, "r"))
    it.append((50, 176, "Bill To:", 10, True, "l"))
    it.append((50, 190, doc["customer"], 10, False, "l"))
    it.append((50, 203, "44 Shore Street, Leeds LS1 2AB", 8, False, "l"))
    tbl, y = _table(doc["items"], doc["sym"], 250, money_on=doc["money"])
    it += tbl
    if doc["money"]:
        it += _totals(doc, y + 20)
    it.append((50, 730, "Thank you for your business.", 9, False, "l"))
    return logo, None, it


def lay_two_col_parties(doc, title_at):
    # BILL FROM | BILL TO side-by-side (the Profile-Construction bug family). Rotate captions.
    it = []
    logo = (40, 26, 170, 80)
    caps = random_caps(doc)
    _title_items(it, doc, title_at, right_x=PAGE_W - 50, top_y=40)
    it.append((PAGE_W - 50, 74, "{} {}".format(doc["ref_label"], doc["ref"]), 10, False, "r"))
    it.append((PAGE_W - 50, 88, "{} {}".format(doc["date_label"], doc["date_shown"]), 10, False, "r"))
    # two columns on the SAME rows (issuer left, recipient right) -> one OCR/text line each
    it.append((50, 150, caps[0], 10, True, "l"));   it.append((320, 150, caps[1], 10, True, "l"))
    it.append((50, 166, doc["sup"]["name"], 11, True, "l")); it.append((320, 166, doc["customer"], 11, True, "l"))
    it.append((50, 182, "1776 Liberty Way", 8, False, "l")); it.append((320, 182, "44 Shore Street", 8, False, "l"))
    it.append((50, 195, "S66 3XH Sunnyvale", 8, False, "l")); it.append((320, 195, "AB4 1TX Macduff", 8, False, "l"))
    tbl, y = _table(doc["items"], doc["sym"], 250, money_on=doc["money"])
    it += tbl
    if doc["money"]:
        it += _totals(doc, y + 20)
    return logo, None, it


def lay_footer_letterhead(doc, title_at):
    # Title + Bill To in the BODY; issuer identity ONLY in the footer (kills "issuer band = top").
    it = []
    _title_items(it, doc, title_at, right_x=None, top_y=60, center=True)
    it.append((50, 110, "{} {}".format(doc["ref_label"], doc["ref"]), 10, False, "l"))
    it.append((50, 124, "{} {}".format(doc["date_label"], doc["date_shown"]), 10, False, "l"))
    it.append((PAGE_W - 50, 110, "Bill To:", 10, True, "r"))
    it.append((PAGE_W - 50, 124, doc["customer"], 10, False, "r"))
    tbl, y = _table(doc["items"], doc["sym"], 210, money_on=doc["money"])
    it += tbl
    if doc["money"]:
        it += _totals(doc, y + 20)
    # footer letterhead (the ONLY place the issuer name appears)
    it.append((PAGE_W / 2, 726, doc["sup"]["name"], 11, True, "c"))
    it.append((PAGE_W / 2, 740, "9 Foundry Lane, Sheffield S1 2GH  |  accounts@{}.co.uk".format(doc["sup"]["initials"].lower()), 8, False, "c"))
    return None, None, it     # no top logo (footer-only identity)


def lay_three_party(doc, title_at):
    # Issuer + Bill To + Ship To (three-party). POs here are buyer-issued (Vendor block).
    it = []
    logo = (40, 26, 180, 85)
    it.append((40, 122, doc["sup"]["name"], 14, True, "l"))
    _title_items(it, doc, title_at, right_x=PAGE_W - 50, top_y=44)
    it.append((PAGE_W - 50, 80, "{} {}".format(doc["ref_label"], doc["ref"]), 10, False, "r"))
    it.append((PAGE_W - 50, 94, "{} {}".format(doc["date_label"], doc["date_shown"]), 10, False, "r"))
    if doc["buyer_issued"]:
        it.append((50, 168, "Vendor:", 10, True, "l"));   it.append((50, 182, doc["customer"], 10, False, "l"))
        it.append((240, 168, "Ship To:", 10, True, "l")); it.append((240, 182, doc["sup"]["name"], 10, False, "l"))
        it.append((430, 168, "Bill To:", 10, True, "l")); it.append((430, 182, doc["sup"]["name"], 10, False, "l"))
    else:
        it.append((50, 168, "Bill To:", 10, True, "l"));  it.append((50, 182, doc["customer"], 10, False, "l"))
        it.append((300, 168, "Ship To:", 10, True, "l")); it.append((300, 182, doc["customer"], 10, False, "l"))
    tbl, y = _table(doc["items"], doc["sym"], 240, money_on=doc["money"])
    it += tbl
    if doc["money"]:
        it += _totals(doc, y + 20)
    return logo, None, it


def lay_minimalist_text(doc, title_at):
    # SuperStore class: text wordmark top, very sparse chrome, title top-right.
    it = []
    logo = (40, 30, 260, 55)     # the text-wordmark PNG
    _title_items(it, doc, title_at, right_x=PAGE_W - 50, top_y=44)
    it.append((PAGE_W - 50, 80, "{} {}".format(doc["ref_label"], doc["ref"]), 10, False, "r"))
    it.append((PAGE_W - 50, 94, "{} {}".format(doc["date_label"], doc["date_shown"]), 10, False, "r"))
    it.append((50, 140, doc["customer"], 10, False, "l"))
    tbl, y = _table(doc["items"], doc["sym"], 200, money_on=doc["money"])
    it += tbl
    if doc["money"]:
        it += _totals(doc, y + 20)
    return logo, None, it


def lay_subheading_text(doc, title_at):
    # text wordmark centered; the TYPE title as a small subheading under a marketing line.
    it = []
    logo = (PAGE_W / 2 - 130, 26, 260, 55)
    it.append((PAGE_W / 2, 92, "Quality office supplies since 1998", 9, False, "c"))
    # subheading title (small, with words around it) -> title_trusted stress
    if title_at == "subheading":
        it.append((PAGE_W / 2, 108, "Document: {}".format(doc["type_title"].title()), 10, True, "c"))
    else:
        _title_items(it, doc, title_at, right_x=None, top_y=108, center=True)
    it.append((50, 150, "{} {}".format(doc["ref_label"], doc["ref"]), 10, False, "l"))
    it.append((PAGE_W - 50, 150, "{} {}".format(doc["date_label"], doc["date_shown"]), 10, False, "r"))
    it.append((50, 172, doc["customer"], 10, False, "l"))
    tbl, y = _table(doc["items"], doc["sym"], 220, money_on=doc["money"])
    it += tbl
    if doc["money"]:
        it += _totals(doc, y + 20)
    return logo, None, it


ARCHETYPES = {
    "saas_clean": lay_saas_clean, "two_col_parties": lay_two_col_parties,
    "footer_letterhead": lay_footer_letterhead, "three_party": lay_three_party,
    "minimalist_text": lay_minimalist_text, "subheading_text": lay_subheading_text,
}


def random_caps(doc):
    r = random.Random(hash(doc["ref"]) & 0xffff)
    return r.choice([("BILL FROM", "BILL TO"), ("From:", "To:"), ("Seller:", "Buyer:"),
                     ("Supplier:", "Customer:"), ("Remit To:", "Ship To:")])


def _title_items(it, doc, title_at, right_x, top_y, center=False):
    """Place the TYPE title per the requested placement. Returns nothing (appends to `it`);
    an 'in_image' placement is handled by the caller (title baked into the logo image)."""
    title = doc["type_title"]
    if title_at == "ref_in_title":
        title = "{} {}".format(doc["type_title"], doc["ref"])       # ref fused into the heading
    if title_at == "below_tall":
        # a tall letterhead pushes the title down past the veto's 14-line / 600-char band
        for k, line in enumerate(["Registered office: 4 Cathedral Sq, York YO1 7HH",
                                   "Company No. 04827713  |  VAT GB 231 8890 04",
                                   "Bank: Northern 60-83-71  Acc 41220398",
                                   "Tel 01904 555 812  |  accounts@example.co.uk",
                                   "Terms: payment due within 30 days of issue",
                                   "All goods remain our property until paid in full"]):
            it.append((50, 60 + k * 14, line, 8, False, "l"))
        it.append((50, 168, title, 22, True, "l"))
        return
    if center:
        it.append((PAGE_W / 2, top_y, title, 24, True, "c"))
    elif right_x is not None:
        it.append((right_x, top_y, title, 24, True, "r"))
    else:
        it.append((50, top_y, title, 24, True, "l"))


# ── Render (born-digital text layer) ────────────────────────────────────────────
def render_pdf(doc, path, edge_tags, watermark=None, in_image_title=False):
    lay = ARCHETYPES[doc["sup"]["archetype"]]
    title_at = "standard"
    if "below_tall" in edge_tags:      title_at = "below_tall"
    elif "ref_in_title" in edge_tags:  title_at = "ref_in_title"
    elif "subheading" in edge_tags:    title_at = "subheading"
    logo_box, _, items = lay(doc, title_at)

    c = canvas.Canvas(path, pagesize=letter)
    # logo (image or text wordmark). in_image_title bakes the TYPE word INTO the logo image
    # (born-digital-unique: the heading is legible but ABSENT from the text layer).
    if logo_box is not None:
        lx, ly, lw, lh = logo_box
        logo_path = gen_logo(doc["sup"])
        if in_image_title:
            logo_path = _logo_with_title(doc)
        c.drawImage(logo_path, lx, PAGE_H - ly - lh, width=lw, height=lh, mask="auto")
    if watermark:
        c.saveState(); c.setFont("Helvetica-Bold", 60); c.setFillGray(0.85)
        c.translate(PAGE_W / 2, PAGE_H / 2); c.rotate(35)
        c.drawCentredString(0, 0, watermark); c.restoreState()
    for (x, yt, text, size, bold, align) in items:
        if in_image_title and size >= 22 and text.strip().upper().startswith(doc["type_title"].split()[0]):
            continue                       # suppress the text-layer title (it lives in the image)
        c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        y = PAGE_H - yt - size
        if align == "r":   c.drawRightString(x, y, text)
        elif align == "c": c.drawCentredString(x, y, text)
        else:              c.drawString(x, y, text)

    # statement ledger: a second block of multi-ref rows (breaks one-ref/one-date)
    if doc["multi_ref"]:
        c.setFont("Helvetica-Bold", 9); yy = PAGE_H - 430
        c.drawString(50, yy, "Date"); c.drawString(150, yy, "Invoice No"); c.drawString(300, yy, "Ref"); c.drawRightString(560, yy, "Amount")
        rr = random.Random(hash(doc["ref"]) & 0xffff)
        for k in range(5):
            yy -= 16; c.setFont("Helvetica", 9)
            c.drawString(50, yy, fmt_date(rr.randint(1, 28), rr.randint(1, 12), 2026, "dmy_slash"))
            c.drawString(150, yy, "INV-{:05d}".format(40000 + rr.randint(0, 9999)))
            c.drawString(300, yy, "PO-{:05d}".format(rr.randint(0, 9999)))
            c.drawRightString(560, yy, money(round(rr.uniform(80, 900), 2), doc["sym"]))

    # page 2 for multi_page docs (ref/date only on page 1 — herald/barry)
    if "multi_page" in edge_tags:
        c.setFont("Helvetica", 9); c.drawString(50, PAGE_H - 60, "{} (continued)".format(doc["sup"]["name"]))
        yy = PAGE_H - 90
        for extra in doc["items"]:
            c.drawString(50, yy, extra["product"]); c.drawRightString(560, yy, money(extra["amount"], doc["sym"])); yy -= 16
        c.showPage()
    c.showPage(); c.save()


def _logo_with_title(doc):
    """A logo image with the TYPE word baked in (title-in-image edge case)."""
    path = os.path.join(LOGODIR, "{}_{}_titled.png".format(doc["sup"]["initials"], doc["tslug"]))
    if os.path.exists(path):
        return path
    base = Image.open(gen_logo(doc["sup"])).convert("RGB")
    W = max(base.width, 900); H = base.height + 160
    img = Image.new("RGB", (W, H), (255, 255, 255))
    img.paste(base, ((W - base.width) // 2, 0))
    d = ImageDraw.Draw(img)
    try:
        f = ImageFont.truetype(ARIALBD, 96)
    except Exception:
        f = ImageFont.load_default()
    txt = doc["type_title"]
    tw = d.textlength(txt, font=f)
    d.text(((W - tw) / 2, base.height + 30), txt, fill=(20, 20, 20), font=f)
    img.save(path)
    return path


# ── Batch ─────────────────────────────────────────────────────────────────────
# For each (supplier, type): the MAJORITY are clean top-standalone-title SEEDS (valid veto
# seeds); a tagged MINORITY are edge variants. Deterministic per index.
EDGE_PLAN = {   # index -> edge tag (only a minority of the 20)
    3: "below_tall", 7: "ref_in_title", 11: "in_image_title", 15: "watermark", 18: "multi_page",
}


def gen_supplier(sup, per_type, out_dir, gt, rng):
    os.makedirs(out_dir, exist_ok=True)
    for tslug in sup["types"]:
        for i in range(per_type):
            doc = build_doc(sup, tslug, i, rng)
            edge = EDGE_PLAN.get(i)
            tags = []
            wm = None; in_img = False
            if edge == "watermark":       tags.append("watermark"); wm = rng.choice(["COPY", "DUPLICATE", "PRO FORMA", "DRAFT"])
            elif edge == "in_image_title": tags.append("in_image_title"); in_img = True
            elif edge:                    tags.append(edge)
            if sup["archetype"] == "subheading_text" and i % 5 == 2:
                tags.append("subheading")
            fname = "{}_{}_{}_{}.pdf".format(sup["initials"], tslug, doc["ref"].replace("/", "-"), i)
            path = os.path.join(out_dir, fname)
            render_pdf(doc, path, tags, watermark=wm, in_image_title=in_img)
            gt.append(dict(
                file=os.path.relpath(path, ROOT), set=("B" if sup.get("clash") else "A"),
                supplier=sup["name"], logo=sup["logo"], archetype=sup["archetype"],
                type_slug=tslug, printed_title=doc["type_title"], ref=doc["ref"],
                ref_label=doc["ref_label"].strip(":"), date=doc["date_canon"],
                date_shown=doc["date_shown"], total=doc["total"], currency=sup["cur"],
                money=doc["money"], edge_tags=tags,
                expected_title_trusted=(not tags or tags == ["watermark"] or tags == ["multi_page"]),
                is_seed=(not tags), clash=bool(sup.get("clash")),
            ))


def write_readme():
    txt = """DEMO DOCS DIGITAL — born-digital ScanFinder test batch
=======================================================
Two sets. ground_truth.json has the expected field values for every doc (score against it,
don't eyeball). Logos in _logos/ (regenerated on demand).

SET A - Layout Variety   (folder: "Set A - Layout Variety")
  6 NEW suppliers, unique names + logos, full layout/type/title variety. SAFE to import into
  your live app — new names cannot collide with existing scanned learning. This is the clean
  born-digital accuracy baseline + the layout-bug hunt.

SET B - Clash (BACK UP FIRST)   (folder: "Set B - Clash")
  Reuses LIVE supplier names (SuperStore, Marlowe Medical) on DIVERGENT digital layouts to
  probe digital<->scanned learning BLEED. Learning is scoped by supplier NAME with no
  digital/scanned separation, and a confirm's merges cannot be cleanly undone. So:
    * PREFERRED: import Set B into a COPY of docusnap.db, never the live one.
    * IF on live: BACK UP %APPDATA%\\ScanFinder\\docusnap.db first, and import with PLAIN
      CONFIRM ONLY — do NOT ⊕-teach or type-correct on these docs (that irreversibly wipes
      the scanned supplier's taught anchors).

SEED-FIRST (for the TYPE_PRESENCE_VETO): the veto only arms once a template has >=3 confirmed
in-band-title docs. Most docs here carry a clean top-of-page title (valid seeds); edge docs are
tagged in ground_truth.json (edge_tags). To test the veto, confirm the clean seeds first, then
process the edge/collision docs.

EDGE TAGS (ground_truth.json): below_tall (title pushed past the veto band), ref_in_title,
in_image_title (heading only inside the logo image — absent from the text layer), watermark,
multi_page, subheading. expected_title_trusted flags which docs SHOULD type cleanly.
"""
    with open(os.path.join(ROOT, "README_PROTOCOL.txt"), "w", encoding="utf-8") as f:
        f.write(txt)


def main():
    per_type = int(sys.argv[1]) if len(sys.argv) > 1 else 20
    os.makedirs(ROOT, exist_ok=True); os.makedirs(LOGODIR, exist_ok=True)
    rng = random.Random(20260729)
    gt = []
    for sup in SET_A:
        gen_supplier(sup, per_type, os.path.join(ROOT, "Set A - Layout Variety", sup["name"]), gt, rng)
        print("  Set A:", sup["name"], "done"); sys.stdout.flush()
    for sup in SET_B:
        gen_supplier(sup, per_type, os.path.join(ROOT, "Set B - Clash", sup["name"]), gt, rng)
        print("  Set B:", sup["name"], "done"); sys.stdout.flush()
    with open(os.path.join(ROOT, "ground_truth.json"), "w", encoding="utf-8") as f:
        json.dump(gt, f, indent=1)
    write_readme()
    na = sum(1 for g in gt if g["set"] == "A"); nb = len(gt) - na
    print("DONE: {} docs  (Set A {} / Set B {})  -> {}".format(len(gt), na, nb, ROOT))


if __name__ == "__main__":
    main()
