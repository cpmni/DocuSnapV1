"""
gen_customer_test.py — the CUSTOMER DOC TEST corpus (owner spec, 2026-08-02).

Simulates a real customer install: 10 COMPLETELY UNIQUE document issuers + 1 owner company
(Bramblewood Joinery Ltd — the ScanFinder user; it letterheads the purchase orders it issues
to its suppliers). Every issuer has its OWN logo (bespoke geometric mark, no two share
construction or palette) and every (issuer, type) pair has its OWN layout (header placement,
meta arrangement, label vocabulary, table style, fonts and footer all vary per issuer; body
structure varies per type). Documents carry realistic line items for the issuer's industry,
consistent arithmetic (net + 20% VAT = total), and EXTRA references for custom-field testing:
VAT registration numbers, account numbers, job/project refs, a "Your PO" cross-reference, and
serial numbers on the two device suppliers' invoices/delivery notes.

Output (Desktop) — TWO FULL RENDITIONS of every document (owner spec: one digital set, one
simulated-scan set; same content, same refs, byte-different renditions):
  Customer Doc Test/
    Digital set/
      To be manually confirmed/<Issuer>/<type>/<Issuer>_<type>_NNNN.pdf   (10 per type = 50/issuer)
      Live docs to be imported/<Issuer>/<type>/<Issuer>_<type>_NNNN.pdf   (100 per type = 500/issuer)
    Scanned set/
      To be manually confirmed/...                                        (same structure)
      Live scans to be imported/...
    ground_truth.json   (one row per FILE: file, set, rendition, issuer, type, ref, date, total, extras)
    _logos/ · README.txt

Scan rendition: rasterised ~150 DPI; ~70% carry a slight skew (±1.6°), all carry mild
brightness/contrast/noise imperfections. Digital rendition: true text-layer PDFs.

Usage:
  py -3.12 stress_test/gen_customer_test.py --smoke        (2 live + 1 manual per type — eyeball run)
  py -3.12 stress_test/gen_customer_test.py                (full: 100 live + 10 manual per type)
Deterministic per (issuer, type, index) — reruns overwrite byte-similar docs.
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

PAGE_W, PAGE_H = A4                       # 595 x 842 pt
DESKTOP = os.path.join(os.environ.get("USERPROFILE", os.path.expanduser("~")), "Desktop")
ROOT    = os.environ.get("CORPUS_OUT") or os.path.join(DESKTOP, "Customer Doc Test")
DIGITAL = os.path.join(ROOT, "Digital set")
SCANNED = os.path.join(ROOT, "Scanned set")
LOGODIR = os.path.join(ROOT, "_logos")
MANUAL_NAME = "To be manually confirmed"
LIVE_DIGITAL_NAME = "Live docs to be imported"
LIVE_SCAN_NAME    = "Live scans to be imported"

OWNER = dict(
    name="Bramblewood Joinery Ltd", slug="Bramblewood-Joinery",
    address=["Unit 4, Sawpit Lane", "Draymarket, DM2 6QF"],
    vat="GB 512 8846 27", phone="01632 960115", email="office@bramblewoodjoinery.co.uk",
    rgb=(92, 64, 24),
)

# ── The ten issuers ─────────────────────────────────────────────────────────────────────
# Every field that shapes the LAYOUT varies per issuer: font family, palette, header style,
# meta placement, table style, label vocabulary, ref schemes, footer content.
# header: logo_left | logo_right | banner | centre | side_rail | footer_letterhead
# meta:   right_block | left_block | boxed_table | inline_row
ISSUERS = [
    dict(name="Harrowgate Timber Supplies", slug="Harrowgate-Timber", initials="HT",
         rgb=(27, 94, 32), font="Helvetica", header="logo_left", meta="right_block", table="grid",
         address=["The Old Sawmill, Kiln Road", "Harrowgate, HG4 8TD"], vat="GB 286 4471 90",
         acct="HT-00412", industry="timber",
         types=["invoice", "delivery_note", "purchase_order", "sales_order", "quote"],
         ref=dict(invoice="HTS-INV-{n5}", delivery_note="HTS-DN-{n5}", purchase_order="PO-{n5}",
                  sales_order="HTS-SO-{n5}", quote="HTS-Q-{n4}")),
    dict(name="Pelican Office Interiors", slug="Pelican-Office", initials="PO",
         rgb=(13, 71, 161), font="Times-Roman", header="banner", meta="boxed_table", table="zebra",
         address=["82 Wharfside Business Park", "Easthaven, EH11 3PL"], vat="GB 774 2093 55",
         acct="ACC-2291", industry="furniture",
         types=["invoice", "delivery_note", "purchase_order", "credit_note", "statement"],
         ref=dict(invoice="PI/{yy}/{n4}", delivery_note="PD/{yy}/{n4}", purchase_order="PO-{n5}",
                  credit_note="PC/{yy}/{n3}", statement="A-2291")),
    dict(name="Nordwind Refrigeration Ltd", slug="Nordwind-Refrigeration", initials="NR",
         rgb=(0, 105, 137), font="Helvetica", header="logo_right", meta="left_block", table="lines",
         address=["9 Frostfield Estate", "Colderton, CL3 5RW"], vat="GB 903 3318 42",
         acct="NWR-77", industry="refrigeration", serials="NW",
         types=["invoice", "delivery_note", "purchase_order", "service_worksheet", "quote"],
         ref=dict(invoice="NRI-{n6}", delivery_note="NRD-{n6}", purchase_order="PO-{n5}",
                  service_worksheet="NWS-{n5}", quote="NRQ-{n4}")),
    dict(name="Castellan Security Systems", slug="Castellan-Security", initials="CS",
         rgb=(69, 39, 116), font="Courier", header="centre", meta="inline_row", table="grid",
         address=["Keep House, 14 Bastion Way", "Fortbridge, FB1 9AA"], vat="GB 651 0027 84",
         acct="CSS-1108", industry="security", serials="CT",
         types=["invoice", "delivery_note", "purchase_order", "service_worksheet", "credit_note"],
         ref=dict(invoice="CAS{n6}", delivery_note="CAD{n6}", purchase_order="PO-{n5}",
                  service_worksheet="CJB-{n4}", credit_note="CCN{n4}")),
    dict(name="Meadowvale Dairy Wholesale", slug="Meadowvale-Dairy", initials="MD",
         rgb=(46, 125, 50), font="Times-Roman", header="side_rail", meta="right_block", table="zebra",
         address=["Meadowvale Creamery, Low Lane", "Butterwick, BW7 2JD"], vat="GB 118 5540 63",
         acct="MDW-315", industry="dairy",
         types=["invoice", "delivery_note", "purchase_order", "statement", "credit_note"],
         ref=dict(invoice="MV-{n6}", delivery_note="MVD-{n6}", purchase_order="PO-{n5}",
                  statement="MDW-315", credit_note="MVC-{n4}")),
    dict(name="Ironclad Tool Hire", slug="Ironclad-Tool-Hire", initials="IT",
         rgb=(84, 68, 56), font="Helvetica", header="footer_letterhead", meta="boxed_table", table="lines",
         address=["Depot 3, Anvil Road", "Forgeley, FG5 8HH"], vat="GB 442 7719 06",
         acct="ITH-0093", industry="hire",
         types=["invoice", "delivery_note", "purchase_order", "quote", "statement"],
         ref=dict(invoice="IH-{n5}-{yy}", delivery_note="IHD-{n5}", purchase_order="PO-{n5}",
                  quote="IHQ-{n4}", statement="ITH-0093")),
    dict(name="Quillstone Print & Packaging", slug="Quillstone-Print", initials="QP",
         rgb=(183, 28, 28), font="Times-Roman", header="logo_left", meta="inline_row", table="grid",
         address=["Pressworks, 51 Galley Street", "Inkerton, IK9 4YS"], vat="GB 570 6684 21",
         acct="QPP-808", industry="print",
         types=["invoice", "delivery_note", "purchase_order", "quote", "credit_note"],
         ref=dict(invoice="QS-{n6}", delivery_note="QSD-{n5}", purchase_order="PO-{n5}",
                  quote="QSQ-{n4}", credit_note="QSC-{n4}")),
    dict(name="Veltrix Automotive Parts", slug="Veltrix-Automotive", initials="VA",
         rgb=(230, 81, 0), font="Helvetica", header="banner", meta="left_block", table="zebra",
         address=["Unit 12, Camshaft Close", "Motherwell Park, MP6 1RE"], vat="GB 335 9902 78",
         acct="VLX-4407", industry="automotive",
         types=["invoice", "delivery_note", "purchase_order", "sales_order", "credit_note"],
         ref=dict(invoice="VX{n6}", delivery_note="VXD{n6}", purchase_order="PO-{n5}",
                  sales_order="VXS{n5}", credit_note="VXC{n4}")),
    dict(name="Silverbeck Cleaning Supplies", slug="Silverbeck-Cleaning", initials="SC",
         rgb=(0, 121, 107), font="Courier", header="logo_right", meta="boxed_table", table="lines",
         address=["Brightworks House, 7 Lather Lane", "Suddsfield, SF2 6NN"], vat="GB 821 4458 39",
         acct="SBC-556", industry="cleaning",
         types=["invoice", "delivery_note", "purchase_order", "statement", "sales_order"],
         ref=dict(invoice="SB-INV{n5}", delivery_note="SB-DEL{n5}", purchase_order="PO-{n5}",
                  statement="SBC-556", sales_order="SB-ORD{n5}")),
    dict(name="Oakhaven Electrical Wholesale", slug="Oakhaven-Electrical", initials="OE",
         rgb=(40, 53, 147), font="Helvetica", header="centre", meta="right_block", table="grid",
         address=["19 Conduit Row", "Ampfield, AM4 7GB"], vat="GB 660 1173 45",
         acct="OEW-2214", industry="electrical",
         types=["invoice", "delivery_note", "purchase_order", "sales_order", "quote"],
         ref=dict(invoice="OE/{n6}", delivery_note="OED/{n5}", purchase_order="PO-{n5}",
                  sales_order="OES/{n5}", quote="OEQ/{n4}")),
]

# Per-issuer LABEL VOCABULARY (rotates per doc from the issuer's own list — no two issuers
# share the same list, so anchors/keywords must genuinely learn per issuer).
LABELS = {
    "Harrowgate-Timber":    dict(ref=["Invoice No.", "Document No.", "Ref"], date=["Invoice Date", "Dated"], total=["Total Due", "Amount Payable"]),
    "Pelican-Office":       dict(ref=["Invoice Number", "Our Reference"], date=["Date of Issue", "Date"], total=["Balance Due", "Invoice Total"]),
    "Nordwind-Refrigeration": dict(ref=["Tax Invoice No", "Document Ref"], date=["Issue Date", "Date"], total=["Total (inc VAT)", "Amount Due"]),
    "Castellan-Security":   dict(ref=["INVOICE #", "REF #"], date=["DATE", "ISSUED"], total=["TOTAL", "AMOUNT DUE"]),
    "Meadowvale-Dairy":     dict(ref=["Invoice No", "Acct Doc No"], date=["Date", "Delivery Week"], total=["Total to Pay", "Total"]),
    "Ironclad-Tool-Hire":   dict(ref=["Hire Invoice No.", "Contract Ref"], date=["Invoice Date", "Off-Hire Date"], total=["Total Charge", "Total Due"]),
    "Quillstone-Print":     dict(ref=["Invoice no", "Job Ticket"], date=["Date", "Despatched"], total=["Grand Total", "Total"]),
    "Veltrix-Automotive":   dict(ref=["Invoice Num", "Doc Ref"], date=["Date", "Tax Point"], total=["Total inc. VAT", "Balance"]),
    "Silverbeck-Cleaning":  dict(ref=["INVOICE NO", "DOCUMENT"], date=["DATE", "TAX DATE"], total=["TOTAL DUE", "NET TO PAY"]),
    "Oakhaven-Electrical":  dict(ref=["Invoice Ref", "Document Number"], date=["Invoice Date", "Date"], total=["Amount Due", "Total Payable"]),
}

# Non-invoice types carry TYPE-correct reference/date captions (a delivery note must not be
# labelled "INVOICE #"); the ISSUER's character comes through via its case style + which
# variant its per-doc RNG picks. Invoices keep the issuer's own vocabulary (LABELS above).
TYPE_LABELS = {
    "delivery_note":   dict(ref=["Delivery Note No", "Delivery No", "Despatch Ref"], date=["Delivery Date", "Despatch Date", "Date"]),
    "purchase_order":  dict(ref=["PO Number", "Purchase Order No"], date=["PO Date", "Order Date", "Date"]),
    "sales_order":     dict(ref=["Order No", "Sales Order No", "Order Ref"], date=["Order Date", "Date"]),
    "credit_note":     dict(ref=["Credit Note No", "Credit Ref"], date=["Credit Date", "Date"]),
    "statement":       dict(ref=["Statement Ref", "Account Ref"], date=["Statement Date", "Date"]),
    "quote":           dict(ref=["Quote No", "Quotation Ref", "Estimate No"], date=["Quote Date", "Date", "Valid From"]),
    "service_worksheet": dict(ref=["Worksheet No", "Job Sheet No"], date=["Job Date", "Date"]),
}
UPPERCASE_ISSUERS = {"Castellan-Security", "Silverbeck-Cleaning"}   # their house style is caps captions

TYPE_TITLES = {
    "invoice": ["INVOICE", "TAX INVOICE", "SALES INVOICE"],
    "delivery_note": ["DELIVERY NOTE", "GOODS DELIVERY NOTE", "DESPATCH NOTE"],
    "purchase_order": ["PURCHASE ORDER"],
    "sales_order": ["SALES ORDER", "ORDER CONFIRMATION"],
    "credit_note": ["CREDIT NOTE"],
    "statement": ["STATEMENT", "STATEMENT OF ACCOUNT"],
    "quote": ["QUOTATION", "ESTIMATE"],
    "service_worksheet": ["SERVICE WORKSHEET", "ENGINEER WORKSHEET"],
}

PRODUCTS = {
    "timber": [("Sawn Oak Board 25x150mm 2.4m", 18.40), ("CLS Studwork 38x63mm 2.4m", 3.85),
               ("Birch Plywood 18mm 2440x1220", 46.20), ("MDF Sheet 12mm 2440x1220", 24.60),
               ("Treated Batten 25x50mm 3.6m", 2.95), ("Oak Veneer Edging 22mm roll", 11.30),
               ("Softwood PSE 18x144mm 2.4m", 7.10), ("OSB3 Board 11mm 2440x1220", 17.85)],
    "furniture": [("Height-Adjustable Desk 1400mm", 329.00), ("Task Chair Mesh-Back", 148.50),
                  ("Acoustic Partition Screen 1600mm", 212.00), ("Under-Desk Pedestal 3-Drawer", 96.00),
                  ("Meeting Table Round 1200mm", 254.00), ("Monitor Arm Dual", 62.40),
                  ("Bookcase 4-Shelf Walnut", 139.00), ("Visitor Chair Cantilever", 88.70)],
    "refrigeration": [("Underbench Chiller 240L", 689.00, "SN"), ("Display Fridge Glass Door 400L", 1149.00, "SN"),
                      ("Blast Chiller 5-Tray", 2340.00, "SN"), ("Freezer Room Evaporator Unit", 875.00, "SN"),
                      ("Door Gasket Kit Universal", 34.50), ("Digital Thermostat Controller", 58.90),
                      ("Refrigerant R290 Charge", 79.00), ("Condenser Coil Clean Service", 120.00)],
    "security": [("IP Dome Camera 4MP", 129.00, "SN"), ("8-Channel NVR 2TB", 385.00, "SN"),
                 ("Intruder Alarm Panel G3", 264.00, "SN"), ("PIR Motion Sensor Dual-Tech", 41.20),
                 ("Door Contact Grade 2", 12.80), ("Keypad Prox Reader", 96.50, "SN"),
                 ("Siren Module External", 54.00), ("CCTV Signage Pack", 9.90)],
    "dairy": [("Whole Milk 2L (crate of 6)", 7.68), ("Semi-Skimmed Milk 2L (crate of 6)", 7.38),
              ("Mature Cheddar 5kg Block", 32.40), ("Salted Butter 250g (case of 20)", 27.00),
              ("Double Cream 1L (case of 6)", 14.10), ("Natural Yoghurt 5kg Tub", 11.25),
              ("Free-Range Eggs (tray of 30)", 8.85), ("Mozzarella Shredded 2kg", 16.20)],
    "hire": [("Mini Excavator 1.5T (per week)", 285.00), ("Breaker Hydraulic (per week)", 96.00),
             ("Tower Scaffold 5.2m (per week)", 118.00), ("Plate Compactor (per week)", 64.00),
             ("Diamond Core Drill (per week)", 88.00), ("Dehumidifier Industrial (per week)", 52.00),
             ("Delivery & Collection", 45.00), ("Damage Waiver", 28.50)],
    "print": [("Corrugated Box 400x300x200 (x100)", 68.00), ("Gloss Leaflet A5 (x1000)", 89.00),
              ("Roll Label 76mm Core (x2000)", 112.00), ("Business Cards 450gsm (x500)", 42.50),
              ("Pallet Wrap Printed (x6 rolls)", 74.40), ("Tape Custom 48mm (x36)", 96.00),
              ("Booklet A4 16pp Stapled (x250)", 187.00), ("Die-Cut Mailer Box (x50)", 94.00)],
    "automotive": [("Brake Pad Set Front VX-BP204", 34.80), ("Oil Filter Spin-On VX-OF88", 6.95),
                   ("Alternator Reman 120A VX-AL662", 148.00), ("Timing Belt Kit VX-TB431", 89.50),
                   ("Coolant 5L Long-Life", 18.20), ("Wiper Blade Set 24/18", 15.40),
                   ("Battery 072 AGM", 132.00), ("Spark Plug Iridium (x4)", 27.60)],
    "cleaning": [("Multi-Surface Cleaner 5L (x4)", 23.60), ("Blue Roll 2-Ply (x6)", 19.80),
                 ("Nitrile Gloves L (x10 boxes)", 47.50), ("Heavy Duty Degreaser 5L", 16.90),
                 ("Mop Head Kentucky (x10)", 21.00), ("Bin Liner 90L Compactor (x200)", 26.40),
                 ("Glass Cleaner Trigger (x12)", 17.16), ("Floor Pad 17in Red (x5)", 13.75)],
    "electrical": [("Twin & Earth 2.5mm 100m", 89.00), ("MCB 32A Type B", 8.40),
                   ("Consumer Unit 10-Way", 74.50), ("LED Panel 600x600 40W (x4)", 96.00),
                   ("Socket Double 13A White (x10)", 32.00), ("SWA Cable 4mm 3-Core 50m", 118.00),
                   ("RCD 63A 30mA", 38.20), ("Conduit PVC 20mm 3m (x10)", 27.50)],
}

FONT_BOLD = {"Helvetica": "Helvetica-Bold", "Times-Roman": "Times-Bold", "Courier": "Courier-Bold"}


# ── Logos: 11 bespoke marks, each a different geometric construction ────────────────────
def _font(sz, bold=True):
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
    if slug == "Harrowgate-Timber":            # ringed tree: circle + trunk + three canopy arcs
        d.ellipse([16, 16, 224, 224], outline=main, width=14)
        d.rectangle([110, 120, 130, 200], fill=dark)
        for i, rad in enumerate((78, 56, 34)):
            d.pieslice([120 - rad, 118 - rad, 120 + rad, 118 + rad], 200, 340, fill=(main if i % 2 == 0 else pale))
    elif slug == "Pelican-Office":             # angular bird: two triangles + beak line over bar
        d.polygon([(30, 170), (120, 40), (150, 170)], fill=main)
        d.polygon([(120, 40), (205, 95), (150, 170)], fill=pale)
        d.line([(205, 95), (232, 108)], fill=dark, width=12)
        d.rectangle([30, 186, 210, 206], fill=dark)
    elif slug == "Nordwind-Refrigeration":     # six-spoke snowflake in a hexagon outline
        cx, cy = 120, 120
        hexpts = [(cx + 100 * math.cos(math.radians(a)), cy + 100 * math.sin(math.radians(a))) for a in range(30, 391, 60)]
        d.polygon(hexpts, outline=main, width=12)
        for a in range(0, 360, 60):
            x2, y2 = cx + 74 * math.cos(math.radians(a)), cy + 74 * math.sin(math.radians(a))
            d.line([(cx, cy), (x2, y2)], fill=main, width=10)
            d.ellipse([x2 - 9, y2 - 9, x2 + 9, y2 + 9], fill=pale)
    elif slug == "Castellan-Security":         # castellated shield with keyhole
        d.polygon([(40, 40), (70, 40), (70, 60), (100, 60), (100, 40), (140, 40), (140, 60), (170, 60),
                   (170, 40), (200, 40), (200, 130), (120, 214), (40, 130)], fill=main)
        d.ellipse([104, 92, 136, 124], fill=(255, 255, 255, 255))
        d.polygon([(112, 118), (128, 118), (134, 158), (106, 158)], fill=(255, 255, 255, 255))
    elif slug == "Meadowvale-Dairy":           # milk drop in rounded square + wave
        d.rounded_rectangle([24, 24, 216, 216], 46, fill=pale)
        d.polygon([(120, 44), (168, 130), (120, 178), (72, 130)], fill=(255, 255, 255, 255))
        d.ellipse([84, 106, 156, 178], fill=(255, 255, 255, 255))
        for x in range(34, 206, 34):
            d.arc([x, 176, x + 34, 208], 180, 360, fill=main, width=8)
    elif slug == "Ironclad-Tool-Hire":         # bolt head: hexagon + inner circle + three torque bars
        cx, cy = 120, 104
        hexpts = [(cx + 84 * math.cos(math.radians(a)), cy + 84 * math.sin(math.radians(a))) for a in range(0, 360, 60)]
        d.polygon(hexpts, fill=main)
        d.ellipse([cx - 38, cy - 38, cx + 38, cy + 38], fill=(255, 255, 255, 255))
        for i, w in enumerate((150, 110, 70)):
            d.rectangle([120 - w // 2, 196 + i * 16, 120 + w // 2, 204 + i * 16], fill=dark)
    elif slug == "Quillstone-Print":           # quill nib: diagonal leaf + slit + ink dot
        d.polygon([(48, 200), (96, 72), (176, 28), (196, 48), (152, 128), (72, 210)], fill=main)
        d.line([(176, 28), (84, 190)], fill=(255, 255, 255, 255), width=8)
        d.ellipse([36, 196, 64, 224], fill=dark)
    elif slug == "Veltrix-Automotive":         # chevron V stack + wheel
        for i in range(3):
            y = 36 + i * 34
            d.polygon([(48, y), (120, y + 44), (192, y), (192, y + 20), (120, y + 64), (48, y + 20)],
                      fill=(main if i == 0 else (pale if i == 1 else dark)))
        d.ellipse([88, 154, 152, 218], outline=main, width=12)
        d.ellipse([110, 176, 130, 196], fill=dark)
    elif slug == "Silverbeck-Cleaning":        # sparkle: 4-point star + droplet grid
        d.polygon([(120, 20), (140, 100), (220, 120), (140, 140), (120, 220), (100, 140), (20, 120), (100, 100)], fill=main)
        for i, (dx, dy) in enumerate([(180, 40), (196, 74), (168, 66)]):
            rr = 10 - i * 2
            d.ellipse([dx - rr, dy - rr, dx + rr, dy + rr], fill=pale)
    elif slug == "Oakhaven-Electrical":        # lightning bolt through rounded diamond outline
        d.polygon([(120, 12), (228, 120), (120, 228), (12, 120)], outline=main, width=12)
        d.polygon([(134, 44), (96, 124), (124, 124), (102, 196), (162, 108), (130, 108)], fill=main)
    else:                                       # OWNER Bramblewood: dovetail joint mark
        d.rectangle([28, 60, 116, 180], fill=main)
        d.rectangle([124, 60, 212, 180], fill=pale)
        for i in range(3):
            y = 70 + i * 40
            d.polygon([(116, y), (146, y + 8), (146, y + 24), (116, y + 32)], fill=main)
        d.rectangle([28, 190, 212, 202], fill=dark)
    # monogram strip under the mark
    f = _font(28)
    d.text((120, 242), initials, font=f, fill=dark, anchor="mm")
    return img


# ── Value + reference helpers ──────────────────────────────────────────────────────────
def make_ref(scheme, rng, year):
    return (scheme.replace("{n6}", str(rng.randint(100000, 999999)))
                  .replace("{n5}", str(rng.randint(10000, 99999)))
                  .replace("{n4}", str(rng.randint(1000, 9999)))
                  .replace("{n3}", str(rng.randint(100, 999)))
                  .replace("{yy}", str(year % 100)))


def make_date(rng):
    year = rng.choice([2025, 2026])
    month = rng.randint(1, 12 if year == 2025 else 8)
    day = rng.randint(1, 28)
    return f"{day:02d}-{month:02d}-{year}", year


def make_items(issuer, rng, n=None, hire=False):
    prods = PRODUCTS[issuer["industry"]]
    n = n or rng.randint(2, 6)
    items = []
    for p in rng.sample(prods, min(n, len(prods))):
        name, price = p[0], p[1]
        has_sn = len(p) > 2 and "serials" in issuer
        qty = 1 if has_sn else rng.randint(1, 12)
        sns = [f"{issuer['serials']}-{rng.randint(1000000, 9999999)}" for _ in range(qty)] if has_sn else []
        items.append(dict(name=name, qty=qty, unit=price, net=round(qty * price, 2), serials=sns))
    return items


# ── Drawing helpers (top-down y) ───────────────────────────────────────────────────────
class Page:
    def __init__(self, c, font):
        self.c = c
        self.font = font
        self.bold = FONT_BOLD[font]

    def t(self, x, y, s, size=9, bold=False, rgb=(0, 0, 0), right=False, centre=False):
        self.c.setFont(self.bold if bold else self.font, size)
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


def draw_header(p, issuer, logo, title, rng):
    """Issuer-styled letterhead. Returns y where the body may start."""
    style, rgb = issuer["header"], issuer["rgb"]
    name, addr = issuer["name"], issuer["address"]
    if style == "logo_left":
        p.img(logo, 40, 34, 62, 62)
        p.t(114, 56, name, 17, bold=True, rgb=rgb)
        p.t(114, 72, " · ".join(addr), 8)
        p.t(114, 84, f"Tel {issuer.get('phone', '01632 ' + str(random.Random(issuer['slug']).randint(960000, 969999)))}   VAT Reg No {issuer['vat']}", 8)
        p.t(PAGE_W - 42, 60, title, 19, bold=True, rgb=rgb, right=True)
        p.line(40, 102, PAGE_W - 40, 102, rgb)
        return 118
    if style == "logo_right":
        p.img(logo, PAGE_W - 104, 34, 62, 62)
        p.t(40, 56, name, 17, bold=True, rgb=rgb)
        p.t(40, 72, " · ".join(addr), 8)
        p.t(40, 84, f"VAT Reg No {issuer['vat']}", 8)
        p.t(40, 112, title, 19, bold=True, rgb=rgb)
        p.line(40, 124, PAGE_W - 40, 124, rgb)
        return 138
    if style == "banner":
        p.rect(0, 26, PAGE_W, 66, rgb=rgb)
        p.img(logo, 44, 30, 56, 56)
        p.t(112, 58, name, 18, bold=True, rgb=(255, 255, 255))
        p.t(112, 76, " · ".join(addr) + f"   VAT {issuer['vat']}", 8, rgb=(235, 235, 235))
        p.t(PAGE_W / 2, 122, title, 20, bold=True, rgb=rgb, centre=True)
        return 140
    if style == "centre":
        p.img(logo, PAGE_W / 2 - 30, 26, 60, 60)
        p.t(PAGE_W / 2, 104, name, 17, bold=True, rgb=rgb, centre=True)
        p.t(PAGE_W / 2, 118, " · ".join(addr) + f"  ·  VAT Reg {issuer['vat']}", 8, centre=True)
        p.t(PAGE_W / 2, 142, title, 18, bold=True, centre=True)
        p.line(150, 152, PAGE_W - 150, 152, rgb)
        return 168
    if style == "side_rail":
        p.rect(0, 0, 26, PAGE_H, rgb=rgb)
        p.img(logo, 40, 30, 56, 56)
        p.t(106, 52, name, 16, bold=True, rgb=rgb)
        p.t(106, 68, " · ".join(addr), 8)
        p.t(106, 80, f"VAT Reg No {issuer['vat']}   Acct enquiries {issuer.get('email', 'accounts@' + issuer['slug'].lower().replace('-', '') + '.co.uk')}", 7.5)
        p.t(PAGE_W - 42, 52, title, 18, bold=True, rgb=rgb, right=True)
        p.line(40, 96, PAGE_W - 40, 96, rgb)
        return 112
    # footer_letterhead: minimal top, identity in the footer
    p.t(40, 52, title, 21, bold=True, rgb=rgb)
    p.img(logo, PAGE_W - 96, 30, 54, 54)
    p.line(40, 68, PAGE_W - 40, 68, rgb)
    p.t(PAGE_W / 2, 806, f"{name}  ·  {' · '.join(addr)}  ·  VAT Reg No {issuer['vat']}", 8, centre=True, rgb=rgb)
    return 84


def draw_meta(p, issuer, y, pairs, rng):
    """The reference/date/etc block, in the issuer's meta style. Returns next y."""
    style, rgb = issuer["meta"], issuer["rgb"]
    if style == "right_block":
        yy = y
        for k, v in pairs:
            p.t(PAGE_W - 190, yy, k, 9, bold=True)
            p.t(PAGE_W - 42, yy, v, 9.5, right=True)
            yy += 15
        return yy + 6          # ADVANCE past the block — returning y overlapped the parties column
    if style == "left_block":
        yy = y
        for k, v in pairs:
            p.t(40, yy, k, 9, bold=True)
            p.t(150, yy, v, 9.5)
            yy += 15
        return yy + 6
    if style == "boxed_table":
        w = (PAGE_W - 80) / len(pairs)
        p.rect(40, y, PAGE_W - 80, 34, outline=rgb, lw=1)
        for i, (k, v) in enumerate(pairs):
            x = 40 + i * w
            if i:
                p.line(x, y, x, y + 34, rgb)
            p.t(x + 6, y + 13, k, 7.5, bold=True, rgb=rgb)
            p.t(x + 6, y + 27, v, 9.5)
        return y + 50
    # inline_row — WRAPS to a second row instead of running off the right edge
    xs, yy = 40, y
    for k, v in pairs:
        wk = p.c.stringWidth(f"{k} ", p.bold, 8.5)
        wv = p.c.stringWidth(v, p.font, 9.5)
        if xs + wk + wv > PAGE_W - 46:
            xs, yy = 40, yy + 15
        p.t(xs, yy, f"{k} ", 8.5, bold=True)
        p.t(xs + wk, yy, v, 9.5)
        xs += wk + wv + 26
    p.line(40, yy + 8, PAGE_W - 40, yy + 8)
    return yy + 24


def draw_parties(p, issuer, y, doc, rng, vendor=None):
    owner_lines = [OWNER["name"]] + OWNER["address"]
    if doc["type"] == "purchase_order":
        v = vendor or issuer            # the REAL supplier — never the style dict (it may be owner-mutated)
        left = ("Supplier", [v["name"]] + v["address"])
        right = ("Deliver To", owner_lines)
    elif doc["type"] in ("sales_order", "quote"):
        left = ("Customer", owner_lines)
        right = ("Delivery Address", owner_lines)
    else:
        left = (rng.choice(["Bill To", "Invoice To", "Customer"]), owner_lines)
        right = (rng.choice(["Deliver To", "Ship To", "Site Address"]), owner_lines)
    for x, (cap, lines) in ((40, left), (PAGE_W / 2 + 10, right)):
        p.t(x, y, cap.upper(), 8, bold=True, rgb=issuer["rgb"])
        yy = y + 13
        for ln in lines:
            p.t(x, yy, ln, 9)
            yy += 12
    return y + 13 + 12 * max(len(left[1]), len(right[1])) + 10


def draw_items_table(p, issuer, y, items, money=True, cur="£"):
    rgb, style = issuer["rgb"], issuer["table"]
    cols = ([("Description", 46), ("Qty", 380, True), ("Unit", 440, True), ("Net", PAGE_W - 46, True)]
            if money else [("Description", 46), ("Qty", PAGE_W - 46, True)])
    p.rect(40, y, PAGE_W - 80, 18, rgb=rgb if style != "lines" else None,
           outline=rgb if style == "grid" else None)
    hdr_rgb = (255, 255, 255) if style != "lines" else rgb
    for name, x, *r in cols:
        p.t(x, y + 13, name, 8.5, bold=True, rgb=hdr_rgb, right=bool(r))
    if style == "lines":
        p.line(40, y + 18, PAGE_W - 40, y + 18, rgb, 1.2)
    yy = y + 18
    for i, it in enumerate(items):
        rowh = 16 + (10 * len(it["serials"]) if it["serials"] else 0)
        if style == "zebra" and i % 2:
            p.rect(40, yy, PAGE_W - 80, rowh, rgb=(245, 245, 245))
        # description clipped to its column so it can never run under the Qty figures
        desc_max = (cols[1][1] - 24) - 46
        name = it["name"]
        while p.c.stringWidth(name, p.font, 9) > desc_max and len(name) > 4:
            name = name[:-2].rstrip() + "…" if not name.endswith("…") else name[:-3].rstrip() + "…"
        p.t(46, yy + 12, name, 9)
        p.t(cols[1][1], yy + 12, str(it["qty"]), 9, right=True)
        if money:
            p.t(cols[2][1], yy + 12, f"{it['unit']:,.2f}", 9, right=True)
            p.t(cols[3][1], yy + 12, f"{it['net']:,.2f}", 9, right=True)
        sy = yy + 24
        for sn in it["serials"]:
            p.t(60, sy, f"Serial No: {sn}", 7.5, rgb=(90, 90, 90))
            sy += 10
        if style == "grid":
            p.rect(40, yy, PAGE_W - 80, rowh, outline=(190, 190, 190), lw=0.5)
        yy += rowh
    p.line(40, yy, PAGE_W - 40, yy, rgb, 1)
    return yy + 10


def draw_totals(p, issuer, y, net, labels, cur="£", sign=1):
    vat = round(net * 0.2, 2)
    total = round(net + vat, 2)
    rows = [("Net Total", net), ("VAT @ 20%", vat), (labels["total"][0], total)]
    for i, (k, v) in enumerate(rows):
        last = i == len(rows) - 1
        p.t(PAGE_W - 180, y, k, 10 if last else 9, bold=last)
        p.t(PAGE_W - 46, y, f"{cur}{sign * v:,.2f}", 10 if last else 9, bold=last, right=True)
        y += 16
    return total * sign, y


# ── One document ───────────────────────────────────────────────────────────────────────
def build_doc(issuer, dtype, idx, logos, rng):
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    p = Page(c, issuer["font"])
    labels = LABELS[issuer["slug"]]
    # TEMPLATE rng — seeded by (supplier, type) so the label VOCABULARY, title and party captions
    # are STABLE across every doc of a given (supplier, type) but still DIFFER across suppliers.
    # A real supplier's template does not re-roll its headers per document; only the VALUES change
    # (values/line-count/renditions keep using the per-doc `rng`). Fixes the 2026-08-06 finding that
    # the corpus penalised template-teaching for label instability no real supplier has.
    tmpl = random.Random(f"{issuer['slug']}|{dtype}")
    date, year = make_date(rng)
    ref = make_ref(issuer["ref"][dtype], rng, year)
    title = tmpl.choice(TYPE_TITLES[dtype])
    gt = dict(issuer=issuer["name"], type_slug=dtype, ref=ref, date=date, total=None,
              vat_no=issuer["vat"], account_no=issuer["acct"],
              # The RECIPIENT on every doc is the owner company (draw_parties prints its
              # block under Bill To/Customer/Deliver To on every type — POs deliver to the
              # owner too). GT-carried so the customer_name lane is scorable (2026-08-05:
              # without it NAME_UNCLIP's non-supplier name class was structurally
              # unexercisable in every arm).
              customer=OWNER["name"],
              # THE VAT NUMBER THAT IS ACTUALLY PRINTED (2026-08-10, Oracle C5). On a buyer-issued
              # purchase order the letterhead is the OWNER's, so the page carries the owner's VAT
              # number and the counterparty's `vat_no` above appears NOWHERE on it. Scoring the app
              # against the counterparty's number marked a correct read wrong on every PO, and
              # simply dropping the column left that lane unscored FOR EVER - a future regression
              # that made the app read the wrong VAT on a PO would have been invisible. This column
              # carries the printed value, and the scorer swaps to it for buyer-issued types exactly
              # as it already swaps issuer/customer.
              printed_vat_no=(OWNER["vat"] if dtype == "purchase_order" else issuer["vat"]))

    if dtype == "purchase_order":
        # The OWNER issues every purchase order, so every PO shares ONE Bramblewood layout
        # regardless of which supplier it addresses (real-world: a firm has one PO template;
        # the pipeline then learns the SAME layout across ten vendor scopes).
        head_issuer = dict(issuer, **{k: OWNER[k] for k in ("name", "address", "vat")},
                           header="logo_left", meta="right_block", table="grid",
                           rgb=OWNER["rgb"], font="Helvetica")
        p.font, p.bold = "Helvetica", FONT_BOLD["Helvetica"]
        issuer_style = head_issuer
        logo = logos["OWNER"]
    else:
        head_issuer = issuer_style = issuer
        logo = logos[issuer["slug"]]
    y = draw_header(p, head_issuer, logo, title, rng)

    def _case(s):
        return s.upper() if issuer["slug"] in UPPERCASE_ISSUERS and dtype != "purchase_order" else s
    if dtype == "invoice":
        ref_label = labels["ref"][tmpl.randrange(len(labels["ref"]))]
        date_label = labels["date"][tmpl.randrange(len(labels["date"]))]
    else:
        tl = TYPE_LABELS[dtype]
        ref_label = _case(tl["ref"][tmpl.randrange(len(tl["ref"]))])
        date_label = _case(tl["date"][tmpl.randrange(len(tl["date"]))])

    po_ref = f"PO-{rng.randint(10000, 99999)}"
    job_ref = f"JB-{rng.randint(2000, 9999)}"
    meta = [(ref_label, ref), (date_label, date)]
    if dtype in ("invoice", "delivery_note"):
        meta.append(("Your PO", po_ref)); gt["po_ref"] = po_ref
    if dtype in ("invoice", "statement", "credit_note"):
        meta.append(("Account No", issuer["acct"]))
    if dtype == "service_worksheet":
        meta.append(("Job Ref", job_ref)); gt["job_ref"] = job_ref
    y = draw_meta(p, issuer_style, y + 8, meta, rng)
    y = draw_parties(p, issuer_style, y + 4, dict(type=dtype), tmpl, vendor=issuer)

    cur = "£"
    if dtype == "statement":
        p.t(40, y + 4, "Statement of account — items outstanding at " + date, 9.5, bold=True)
        yy, bal = y + 22, 0.0
        p.line(40, yy, PAGE_W - 40, yy, issuer["rgb"], 1)
        stmt_day, stmt_month, stmt_year = int(date[:2]), int(date[3:5]), int(date[6:])
        for _ in range(rng.randint(4, 8)):
            # outstanding items predate the statement (never a future-dated row)
            m2 = rng.randint(1, stmt_month) if stmt_month > 1 else 1
            d2 = f"{rng.randint(1, 28):02d}-{m2:02d}-{stmt_year}"
            r2 = make_ref(issuer["ref"]["invoice"], rng, stmt_year)
            amt = round(rng.uniform(60, 900), 2)
            bal += amt
            yy += 15
            p.t(46, yy, d2, 9); p.t(150, yy, r2, 9); p.t(320, yy, "Invoice", 9)
            p.t(PAGE_W - 46, yy, f"{cur}{amt:,.2f}", 9, right=True)
        yy += 22
        p.t(PAGE_W - 180, yy, "Balance Due", 10, bold=True)
        p.t(PAGE_W - 46, yy, f"{cur}{round(bal, 2):,.2f}", 10, bold=True, right=True)
        gt["total"] = round(bal, 2)
    elif dtype in ("delivery_note", "service_worksheet"):
        items = make_items(issuer, rng)
        y = draw_items_table(p, issuer_style, y + 4, items, money=False)
        gt["serials"] = [sn for it in items for sn in it["serials"]] or None
        if dtype == "service_worksheet":
            p.t(40, y + 8, "Work carried out:", 9, bold=True)
            p.t(40, y + 22, tmpl.choice(["Routine service completed; all checks passed.",
                                        "Fault traced and repaired on site.",
                                        "Installation commissioned and handed over."]), 9)
            p.t(40, y + 44, "Engineer signature: ______________________     Customer signature: ______________________", 9)
        else:
            p.t(40, y + 10, f"Received in good condition — {tmpl.choice(['sign on delivery', 'goods checked at gate'])}.", 8.5)
            p.t(40, y + 26, "Received by: ______________________    Date: ____________", 9)
    else:
        items = make_items(issuer, rng)
        y = draw_items_table(p, issuer_style, y + 4, items, money=True, cur=cur)
        net = round(sum(it["net"] for it in items), 2)
        sign = -1 if dtype == "credit_note" else 1
        tot_labels = dict(total=["Order Total"]) if dtype == "purchase_order" else labels
        total, y = draw_totals(p, issuer_style, y + 4, net, tot_labels, cur, sign)
        gt["total"] = total
        gt["serials"] = [sn for it in items for sn in it["serials"]] or None
        if dtype == "credit_note":
            p.t(40, y + 8, f"Credit against invoice {make_ref(issuer['ref']['invoice'], rng, year)} — goods returned.", 9)
        if dtype in ("invoice",):
            p.t(40, y + 12, f"Payment terms: {tmpl.choice(['30 days net', '14 days net', 'Due on receipt'])}. "
                            f"Please quote {ref} on all remittances.", 8.5)
    if issuer["header"] != "footer_letterhead" and dtype != "purchase_order":
        p.t(PAGE_W / 2, 806, f"{issuer['name']} · Registered in England · VAT Reg No {issuer['vat']}", 7.5, centre=True, rgb=(110, 110, 110))
    c.showPage()
    c.save()
    buf.seek(0)
    return buf.read(), gt


# ── Scan rendering ─────────────────────────────────────────────────────────────────────
# SCAN GEOMETRY FIDELITY (2026-08-05, the TEACH_ANGLE_COMPOSE gate finding): a REAL scanner
# emits a FIXED page size — the paper tilts inside the glass, corners crop, dimensions never
# change. expand=True GREW the page and shifted content by angle-dependent margins, a geometry
# no real scanner produces — it made the corpus structurally unfaithful for any frame-transform
# testing (teach coords from an expanded scan mismatch every unexpanded sibling). expand=False
# is the faithful default; SCAN_EXPAND=1 restores the old behaviour for comparability reruns.
_SCAN_EXPAND = os.environ.get("SCAN_EXPAND", "0") == "1"


def scanify(pdf_bytes, rng):
    pdf = pdfium.PdfDocument(pdf_bytes)
    pil = pdf[0].render(scale=150 / 72.0).to_pil().convert("L")
    pdf.close()
    # slight skew on SOME (~70%); the rest go through the scanner straight
    angle = rng.uniform(-1.6, 1.6) if rng.random() < 0.7 else 0.0
    if angle:
        pil = pil.rotate(angle, expand=_SCAN_EXPAND, fillcolor=245, resample=Image.BICUBIC)
    pil = ImageEnhance.Brightness(pil).enhance(rng.uniform(0.94, 1.08))
    pil = ImageEnhance.Contrast(pil).enhance(rng.uniform(0.88, 1.05))
    if rng.random() < 0.5:
        pil = pil.filter(ImageFilter.GaussianBlur(rng.uniform(0.2, 0.7)))
    noise = Image.effect_noise(pil.size, rng.uniform(6, 16)).point(lambda v: v // 3 + 170)
    pil = Image.blend(pil, noise, 0.10)
    out = io.BytesIO()
    pil.convert("RGB").save(out, "PDF", resolution=150.0)
    return out.getvalue()


def render_one(job):
    """Build ONE document's content, write BOTH renditions (digital + simulated scan)."""
    issuer, dtype, idx, setname, digital_path, scan_path = job
    rng = random.Random(f"{issuer['slug']}|{dtype}|{setname}|{idx}")
    pdf, gt = build_doc(issuer, dtype, idx, _LOGOS, rng)
    rows = []
    os.makedirs(os.path.dirname(digital_path), exist_ok=True)
    with open(digital_path, "wb") as f:
        f.write(pdf)
    rows.append(dict(gt, file=os.path.relpath(digital_path, ROOT), set=setname, rendition="digital"))
    if pdfium is not None:
        scan = scanify(pdf, rng)
        os.makedirs(os.path.dirname(scan_path), exist_ok=True)
        with open(scan_path, "wb") as f:
            f.write(scan)
        rows.append(dict(gt, file=os.path.relpath(scan_path, ROOT), set=setname, rendition="scan"))
    return rows


_LOGOS = None


def _pool_init():
    global _LOGOS
    _LOGOS = {i["slug"]: draw_logo(i["slug"], i["initials"], i["rgb"]) for i in ISSUERS}
    _LOGOS["OWNER"] = draw_logo("OWNER", "BJ", OWNER["rgb"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--smoke", action="store_true", help="2 live + 1 manual per type")
    ap.add_argument("--live", type=int, default=100)
    ap.add_argument("--manual", type=int, default=10)
    ap.add_argument("--workers", type=int, default=8)
    a = ap.parse_args()
    live_n, manual_n = (2, 1) if a.smoke else (a.live, a.manual)

    os.makedirs(LOGODIR, exist_ok=True)
    _pool_init()
    for slug, img in _LOGOS.items():
        img.save(os.path.join(LOGODIR, f"{slug}.png"))

    jobs = []
    for issuer in ISSUERS:
        for dtype in issuer["types"]:
            for setname, lo, hi in (("manual", 1, manual_n), ("live", manual_n + 1, manual_n + live_n)):
                for i in range(lo, hi + 1):
                    fn = f"{issuer['slug']}_{dtype}_{i:04d}.pdf"
                    live_name = LIVE_DIGITAL_NAME if setname == "live" else MANUAL_NAME
                    dpath = os.path.join(DIGITAL, live_name, issuer["slug"], dtype, fn)
                    live_name_s = LIVE_SCAN_NAME if setname == "live" else MANUAL_NAME
                    spath = os.path.join(SCANNED, live_name_s, issuer["slug"], dtype, fn)
                    jobs.append((issuer, dtype, i, setname, dpath, spath))

    print(f"generating {len(jobs)} documents x 2 renditions into {ROOT} ...")
    if a.workers <= 1:
        rows = [render_one(j) for j in jobs]
    else:
        with Pool(a.workers, initializer=_pool_init) as pool:
            rows = pool.map(render_one, jobs, chunksize=8)
    gts = [r for rr in rows for r in rr]

    with open(os.path.join(ROOT, "ground_truth.json"), "w", encoding="utf-8") as f:
        json.dump(gts, f, indent=1)
    with open(os.path.join(ROOT, "README.txt"), "w", encoding="utf-8") as f:
        f.write(
            "CUSTOMER DOC TEST corpus (generated by stress_test/gen_customer_test.py)\n\n"
            "10 unique issuers + the owner company (Bramblewood Joinery Ltd — letterheads the\n"
            "purchase orders). 5 doc types per issuer from the pool: invoice, delivery_note,\n"
            "purchase_order, sales_order, credit_note, statement, quote, service_worksheet.\n"
            "Types beyond the built-in three can be added via Settings → Document Types →\n"
            "'Add from catalog…' before teaching.\n\n"
            "TWO FULL RENDITIONS of every document: 'Digital set' (true text-layer PDFs) and\n"
            "'Scanned set' (rasterised ~150 DPI; ~70% slightly skewed, all with mild scan\n"
            "imperfections). Same content and references in both, so digital vs scan behaviour\n"
            "is directly comparable.\n\n"
            "Flow per set: teach/confirm everything in 'To be manually confirmed' (10 per type\n"
            "per issuer), then import the live folder (100 per type per issuer) and see what\n"
            "holds. ground_truth.json carries per-FILE truth (set, rendition, ref/date/total/\n"
            "VAT no/account no/PO cross-ref/serial numbers) for scoring.\n")
    n_scan = sum(1 for g in gts if g["rendition"] == "scan")
    print(f"done: {len(gts)} docs ({n_scan} scan-rendered, {len(gts) - n_scan} born-digital)")
    print(f"ground truth: {os.path.join(ROOT, 'ground_truth.json')}")


if __name__ == "__main__":
    main()
