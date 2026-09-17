"""make_controls5.py OUT — gary's arc-3 (known-supplier-name identity change) design controls, beyond controls3/4:
  ctrl5_billto_<sup>.pdf   p1 = <sup> invoice with a MULTI-LINE recipient block ("Invoice To:" / "Accounts Payable" /
                           <known other> / addr) stamped in the top band; p2 = letterhead band + items, NO marker
                           -> must NOT split (the band truncates at the marker line, the name two lines below never counts)
  ctrl5_coinv_<sup>.pdf    p1 = <sup> invoice; p2 = a BARE page (no letterhead) "c/o <known other>" + "Invoice No" +
                           "Invoice Date" repeated + items -> must NOT split (the c/o context beats the number/date witness)
  ctrl5_prefix_<sup>.pdf   p1 = <sup> invoice; p2 = a re-typed letterhead "<SUP> LTD" (token-prefix extension of the
                           known name) + items, no marker -> must NOT split (_same_supplier prefix tolerance)
  ctrl5_blur_<sup>.pdf     p1 = <sup> invoice whose letterhead band is BLURRED (name unreadable, cur_name None);
                           p2 = a clean <sup> letterhead + items, no marker -> must NOT split (the unknown->known DROP, end-to-end)
  ctrl5_nontpl2_a.pdf      EFFICACY: a 2-doc stack of two NON-templated (supplier, type) pages of KNOWN suppliers
                           (Marlowe invoice + Ironbridge worksheet) -> MUST cut at 2
  ctrl5_nontpl3_b.pdf      EFFICACY: 3-doc stack Ridgeway invoice + Saltmarsh invoice + Northgate invoice -> MUST cut at 2 and 3
  ctrl5_supplier_<sup>.pdf p1 = <sup> PURCHASE ORDER with "Supplier: <known other>" stamped in the band (the buyer-issued
                           counterparty shape header_band_text truncates on); p2 = letterhead + items -> must NOT split
  Oracle C4 (2026-09-17) additions:
  ctrl5_item_<sup>.pdf     (i)  p1 = <sup> invoice; p2 = a LOGO-LESS page: an item table whose SECOND line names a known
                           supplier ("Print Tracker Doc annual licence …"), a repeated "Invoice No" + "Invoice Date", NO page
                           number -> must NOT split (the item-table header ends the band / the money line is an item)
  ctrl5_itembare_<sup>.pdf (i') the same but the known name sits ALONE on its item line (a multi-line description, no amount
                           on that line) -> must NOT split (the table header above it ends the band)
  ctrl5_envelope_<sup>.pdf (ii) p1 = a window-envelope layout: the RECIPIENT (known other) top-LEFT, unlabelled, the ISSUER
                           top-RIGHT with Invoice No/Date; p2 = the issuer's letterhead line + repeated Invoice No + items
                           -> must NOT split (the first-page SET holds both names)
  ctrl5_docket_<sup>.pdf   (vi) p1 = <sup> invoice; p2 = <known other>'s DELIVERY DOCKET whose only marker is "Docket No:"
                           (no date, no Invoice No) -> MUST cut at 2 (the labelled docket-number witness)
"""
import glob, json, os, sys
import pypdfium2 as pdfium
from PIL import Image, ImageDraw, ImageFilter, ImageFont
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
DEMO = os.path.join(os.path.expanduser('~'), 'Desktop', 'Demo Docs')
def font(sz):
    for f in (r"C:\Windows\Fonts\arial.ttf", r"C:\Windows\Fonts\segoeui.ttf"):
        if os.path.exists(f): return ImageFont.truetype(f, sz)
    return ImageFont.load_default()
def src_page(sup, kind, idx=0):
    c = sorted(glob.glob(os.path.join(DEMO, sup, kind, "**", "*.pdf"), recursive=True)); c = [p for p in c if "Processed" not in p] or c
    if not c: raise SystemExit(f"no {kind} pdf for {sup}")
    return c[idx % len(c)]
def render(p, i=0): return pdfium.PdfDocument(p)[i].render(scale=200 / 72).to_pil().convert("RGB")
ITEMS = ["Description                     Qty     Unit      Amount", "Cable clips 20mm (box)           12     4.20       50.40",
         "Conduit 25mm x 3m                 8    11.90       95.20", "Labour - second fix (hrs)        14    38.00      532.00",
         "", "Sub total                                       721.70", "VAT 20%                                          144.34", "Total                                            866.04"]
def body(d, W, H, y, lines):
    f = font(int(H * 0.014))
    for k, line in enumerate(lines): d.text((int(W * 0.06), y + k * int(H * 0.022)), line, fill="black", font=f)
def stamp(img, x, y, lines, sz=0.015):
    d = ImageDraw.Draw(img); W, H = img.size
    for k, line in enumerate(lines): d.text((int(W * x), int(H * y) + k * int(H * 0.018)), line, fill="black", font=font(int(H * sz)))
def cont_page(band, W, H, extra=None, y0=0.20):
    p2 = Image.new("RGB", (W, H), "white")
    if band is not None: p2.paste(band, (0, 0))
    d = ImageDraw.Draw(p2)
    if extra:
        for k, line in enumerate(extra): d.text((int(W * 0.06), int(H * (y0 - 0.02)) + k * int(H * 0.02)), line, fill="black", font=font(int(H * 0.016)))
        y0 += 0.02 * len(extra) + 0.02
    body(d, W, H, int(H * y0), ITEMS)
    return p2
def save(name, pages, docs):
    pages[0].save(os.path.join(out, name), "PDF", resolution=200.0, save_all=True, append_images=pages[1:])
    gt[name] = {"page_count": len(pages), "docs": docs}; print(name)
gt = {}
PAIRS = [("Copperfield Electrical", "Thornbury Fasteners", "copperfield"), ("Thornbury Fasteners", "Saltmarsh Seafoods", "thornbury")]
for sup, other, tag in PAIRS:
    p1 = render(src_page(sup, "invoice")); W, H = p1.size; band = p1.crop((0, 0, W, int(H * 0.16)))
    # multi-line recipient block: the marker line, then a department line, THEN the other known name
    q = p1.copy(); stamp(q, 0.55, 0.10, ["Invoice To:", "Accounts Payable", other, "Unit 4 Trade Park", "Bristol BS1 4TT"])
    save(f"ctrl5_billto_{tag}.pdf", [q, cont_page(band, W, H)],
         [{"pages": [1, 2], "src": tag, "label": f"{sup} invoice; multi-line Invoice To block naming {other} two lines below the marker; p2 letterhead continuation — must NOT split"}])
    # bare c/o page WITH a repeated Invoice No + Invoice Date (the witness passes; only the c/o context can save it)
    save(f"ctrl5_coinv_{tag}.pdf", [p1, cont_page(None, W, H, [f"c/o {other}", "12 Trade Park, Bristol", "", "Invoice No: INV-20441", "Invoice Date: 12/08/2026"], y0=0.12)],
         [{"pages": [1, 2], "src": tag, "label": f"{sup} invoice; p2 BARE page 'c/o {other}' + repeated Invoice No/Date + items — must NOT split"}])
    # token-prefix extension of the known name as a re-typed letterhead
    r = Image.new("RGB", (W, H), "white"); stamp(r, 0.06, 0.04, [f"{sup.upper()} LTD", "Unit 7, Riverside Industrial Estate", "Bristol BS2 0QY  ·  01179 555 0100"], sz=0.02)
    d = ImageDraw.Draw(r); body(d, W, H, int(H * 0.20), ITEMS)
    save(f"ctrl5_prefix_{tag}.pdf", [p1, r],
         [{"pages": [1, 2], "src": tag, "label": f"{sup} invoice; p2 re-typed letterhead '{sup.upper()} LTD' (prefix extension) + items, no marker — must NOT split"}])
    # blurred page-1 letterhead (name unreadable) + a clean page-2 letterhead: the unknown->known drop end-to-end
    b = p1.copy(); blurred = b.crop((0, 0, W, int(H * 0.16))).filter(ImageFilter.GaussianBlur(radius=max(4, W // 250))); b.paste(blurred, (0, 0))
    save(f"ctrl5_blur_{tag}.pdf", [b, cont_page(band, W, H)],
         [{"pages": [1, 2], "src": tag, "label": f"{sup} invoice with a BLURRED letterhead; p2 clean letterhead continuation — must NOT split (unknown->known dropped)"}])
    # buyer-issued PO with "Supplier: <other>" in the band
    po = render(src_page(sup, "purchase_order")); Wp, Hp = po.size; stamp(po, 0.55, 0.10, [f"Supplier: {other}", "Unit 4 Trade Park", "Bristol BS1 4TT"])
    save(f"ctrl5_supplier_{tag}.pdf", [po, cont_page(po.crop((0, 0, Wp, int(Hp * 0.16))), Wp, Hp)],
         [{"pages": [1, 2], "src": tag, "label": f"{sup} PO with 'Supplier: {other}' in the band; p2 letterhead continuation — must NOT split"}])
    # (i) logo-less continuation whose item table names a known supplier + repeated Invoice No/Date, no page number
    KN = "Print Tracker Doc"
    it = Image.new("RGB", (W, H), "white"); dd = ImageDraw.Draw(it)
    body(dd, W, H, int(H * 0.06), ["Description                     Qty     Unit      Amount", f"{KN} annual licence        1   240.00      240.00",
                                   "Toner cartridge black             2    41.50       83.00", "", "Invoice No: INV-3321", "Invoice Date: 12/08/2026", "",
                                   "Sub total                                       323.00", "VAT 20%                                           64.60", "Total                                            387.60"])
    save(f"ctrl5_item_{tag}.pdf", [p1, it],
         [{"pages": [1, 2], "src": tag, "label": f"{sup} invoice; p2 logo-less item table naming '{KN}' on an amount line + repeated Invoice No/Date — must NOT split"}])
    it2 = Image.new("RGB", (W, H), "white"); dd = ImageDraw.Draw(it2)
    body(dd, W, H, int(H * 0.06), ["Description                     Qty     Unit      Amount", KN, "  annual licence (12 months)      1   240.00      240.00",
                                   "", "Invoice No: INV-3321", "Invoice Date: 12/08/2026", "", "Total                                            240.00"])
    save(f"ctrl5_itembare_{tag}.pdf", [p1, it2],
         [{"pages": [1, 2], "src": tag, "label": f"{sup} invoice; p2 logo-less item table with '{KN}' ALONE on an item line + repeated Invoice No/Date — must NOT split"}])
    # (ii) window-envelope layout: the recipient top-LEFT (unlabelled), the issuer top-RIGHT
    env = Image.new("RGB", (W, H), "white")
    stamp(env, 0.06, 0.05, [other, "12 Trade Park", "Bristol BS1 4TT"], sz=0.016)
    stamp(env, 0.55, 0.05, [sup.upper(), "Unit 7 Riverside Estate", "Invoice No: INV-3321", "Invoice Date: 12/08/2026"], sz=0.016)
    dd = ImageDraw.Draw(env); body(dd, W, H, int(H * 0.22), ITEMS)
    env2 = Image.new("RGB", (W, H), "white"); stamp(env2, 0.06, 0.04, [sup.upper(), "Unit 7 Riverside Estate"], sz=0.018)
    dd = ImageDraw.Draw(env2); body(dd, W, H, int(H * 0.14), ["Invoice No: INV-3321", ""] + ITEMS)
    save(f"ctrl5_envelope_{tag}.pdf", [env, env2],
         [{"pages": [1, 2], "src": tag, "label": f"window-envelope: {other} (recipient) top-left unlabelled, {sup} (issuer) top-right; p2 issuer letterhead + repeated Invoice No — must NOT split"}])
    # (vi) a docket first page whose only witness is "Docket No:"
    dk = Image.new("RGB", (W, H), "white"); stamp(dk, 0.06, 0.04, [other.upper(), "Unit 4 Trade Park, Bristol BS1 4TT", "", "DELIVERY DOCKET", "Docket No: DN-4471"], sz=0.018)
    dd = ImageDraw.Draw(dk); body(dd, W, H, int(H * 0.22), ["Description                     Qty", "Cable clips 20mm (box)           12", "Conduit 25mm x 3m                 8"])
    save(f"ctrl5_docket_{tag}.pdf", [p1, dk],
         [{"pages": [1, 1], "src": tag, "label": f"{sup} invoice"}, {"pages": [2, 2], "src": "other", "label": f"{other} delivery docket, only 'Docket No:' — MUST cut"}])
# efficacy: stacks of NON-templated (supplier, type) pages of known suppliers (sandbox templates: Marlowe=sales_order only,
# Ironbridge=invoice only, Ridgeway=delivery_note+worksheet, Saltmarsh=delivery_note, Northgate=sales_order)
a1 = render(src_page("Marlowe Medical Supplies", "invoice")); a2 = render(src_page("Ironbridge Fabrication", "worksheet"))
save("ctrl5_nontpl2_a.pdf", [a1, a2.resize(a1.size)],
     [{"pages": [1, 1], "src": "marlowe", "label": "Marlowe invoice (no invoice template)"}, {"pages": [2, 2], "src": "ironbridge", "label": "Ironbridge worksheet (no worksheet template) — MUST cut"}])
b1 = render(src_page("Ridgeway Plant Hire", "invoice")); b2 = render(src_page("Saltmarsh Seafoods", "invoice")); b3 = render(src_page("Northgate Textiles", "invoice"))
save("ctrl5_nontpl3_b.pdf", [b1, b2.resize(b1.size), b3.resize(b1.size)],
     [{"pages": [1, 1], "src": "ridgeway", "label": "Ridgeway invoice (no invoice template)"}, {"pages": [2, 2], "src": "saltmarsh", "label": "Saltmarsh invoice — MUST cut"}, {"pages": [3, 3], "src": "northgate", "label": "Northgate invoice — MUST cut"}])
json.dump(gt, open(os.path.join(out, "gt_controls5.json"), "w"), indent=1)
