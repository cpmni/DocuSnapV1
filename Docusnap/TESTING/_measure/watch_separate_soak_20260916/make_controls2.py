"""make_controls2.py OUT_DIR — the Oracle's EXTENDED over-split controls (C5): from a multi-type-templated supplier,
  ctrl2_i_*    logo-ONLY page 2 (top 7 % band = the logo strip; no name/address line)          — must NOT split
  ctrl2_ii_*   logo + the company-name line on page 2 (top 10 %)                               — must NOT split
  ctrl2_iii_*  FULL header p2: letterhead + heading + Bill To block + Invoice No + Date + "Page 2 of 2" — must NOT split
  ctrl2_iv_*   a 3-page STACK: doc A p1 printing "Page 1 of 2" + A p2 "Page 2 of 2" + doc B p1 "Page 1 of 1" — MUST cut at p3, NOT at p2
No marker on i/ii (the veto cannot help there — measures (A)'s added identity_change exposure); iii self-declares."""
import glob, json, os, sys
import pypdfium2 as pdfium
from PIL import Image, ImageDraw, ImageFont
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
DEMO = os.path.join(os.path.expanduser('~'), 'Desktop', 'Demo Docs')
def font(sz):
    for f in (r"C:\Windows\Fonts\arial.ttf", r"C:\Windows\Fonts\segoeui.ttf"):
        if os.path.exists(f): return ImageFont.truetype(f, sz)
    return ImageFont.load_default()
def src_page(sup, kind, idx=0):
    cands = sorted(glob.glob(os.path.join(DEMO, sup, kind, "**", "*.pdf"), recursive=True))
    cands = [p for p in cands if "Processed" not in p] or cands
    return cands[idx % len(cands)]
def render(p, i=0): return pdfium.PdfDocument(p)[i].render(scale=200 / 72).to_pil().convert("RGB")
ITEMS = ["Description                     Qty     Unit      Amount", "Cable clips 20mm (box)           12     4.20       50.40",
         "Conduit 25mm x 3m                 8    11.90       95.20", "Junction box IP65                 6     7.35       44.10",
         "Labour - second fix (hrs)        14    38.00      532.00", "", "Sub total                                       721.70",
         "VAT 20%                                          144.34", "Total                                            866.04"]
def body(d, W, H, y, lines):
    f = font(int(H * 0.014))
    for k, line in enumerate(lines): d.text((int(W * 0.06), y + k * int(H * 0.022)), line, fill="black", font=f)
gt = {}
for sup, kind, heading, tag in [("Copperfield Electrical", "invoice", "INVOICE", "copperfield"), ("Thornbury Fasteners", "invoice", "INVOICE", "thornbury")]:
    p1 = render(src_page(sup, kind)); W, H = p1.size
    for variant, band_frac, extra in [("i", 0.07, None), ("ii", 0.10, None), ("iii", 0.16, "full")]:
        p2 = Image.new("RGB", (W, H), "white"); p2.paste(p1.crop((0, 0, W, int(H * band_frac))), (0, 0)); d = ImageDraw.Draw(p2)
        y = int(H * 0.19)
        if extra == "full":
            d.text((int(W * 0.06), y), heading, fill="black", font=font(int(H * 0.028))); y += int(H * 0.05)
            for line in ["Bill To", "Fernbank Veterinary Clinic", "44 Woodland Rise, Coventry CV5 8QT", "",
                         "Invoice No. INV-30772          Invoice Date 12/10/2026          Page 2 of 2"]:
                d.text((int(W * 0.06), y), line, fill="black", font=font(int(H * 0.016))); y += int(H * 0.028)
            y += int(H * 0.02)
        body(d, W, H, y, ITEMS)
        name = f"ctrl2_{variant}_{tag}.pdf"
        p1.save(os.path.join(out, name), "PDF", resolution=200.0, save_all=True, append_images=[p2])
        gt[name] = {"page_count": 2, "docs": [{"pages": [1, 2], "src": os.path.relpath(src_page(sup, kind), os.path.expanduser('~')), "label": f"genuine 2-page {kind}; p2 = {variant} ({'logo only' if variant=='i' else 'logo + name line' if variant=='ii' else 'full header + Page 2 of 2'}) — must NOT split"}]}
        print(name)
    # (iv) the "Page 1 of 2" stack
    a1 = render(src_page(sup, kind, 0)); b1 = render(src_page(sup, "delivery_docket" if os.path.isdir(os.path.join(DEMO, sup, "delivery_docket")) else kind, 1))
    for img, stamp in ((a1, "Page 1 of 2"), (b1, "Page 1 of 1")):
        d = ImageDraw.Draw(img); d.text((int(W * 0.80), int(H * 0.96)), stamp, fill="black", font=font(int(H * 0.014)))
    a2 = Image.new("RGB", (W, H), "white"); a2.paste(a1.crop((0, 0, W, int(H * 0.16))), (0, 0)); d = ImageDraw.Draw(a2)
    body(d, W, H, int(H * 0.22), ITEMS); d.text((int(W * 0.80), int(H * 0.96)), "Page 2 of 2", fill="black", font=font(int(H * 0.014)))
    name = f"ctrl2_iv_{tag}.pdf"
    a1.save(os.path.join(out, name), "PDF", resolution=200.0, save_all=True, append_images=[a2, b1])
    gt[name] = {"page_count": 3, "docs": [{"pages": [1, 2], "src": "A", "label": "doc A (Page 1 of 2 + Page 2 of 2)"}, {"pages": [3, 3], "src": "B", "label": "doc B (Page 1 of 1) — MUST cut here"}]}
    print(name)
json.dump(gt, open(os.path.join(out, "gt_controls2.json"), "w"), indent=1)
