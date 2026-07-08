"""Agent 1 — synthetic document generator.

Produces 900 scanned-style docs (IMAGE-ONLY PDFs — no selectable text, the real OCR
stress test) + 100 text-based control docs (genuine text layer via pdfwrite). Renders
10 templates across 9 doc types with logos, tables, stamps, signatures, checkboxes,
barcodes/QR, watermarks, handwriting and deliberate edge cases. Every key field's
pixel + normalised bbox and each anchor token is captured into ground_truth.json.

Determinism: per-doc seed = cfg['seed'] + index. Ground-truth field KEYS match the
project's engine keys (see fixtures.DOC_TYPES) so metrics compare like-for-like.
"""
from __future__ import annotations
import csv
import json
import os
import random

from PIL import Image, ImageDraw

from test_harness import fixtures as fx
from test_harness import render as R
from test_harness.pdfwrite import TextPdf

REF_PREFIX = {"invoice": "INV", "purchase_order": "PO", "sales_order": "SO",
              "receipt": "RCP", "statement": "STM", "delivery_note": "DN",
              "remittance_advice": "REM", "letter": "REF", "order_form": "FRM"}

# Decoration / edge-case probabilities (deterministic per-doc via rng).
P_STAMP, P_SIGNATURE, P_BARCODE, P_QR, P_WATERMARK, P_HANDWRITE = 0.18, 0.16, 0.20, 0.14, 0.10, 0.12
EDGE_CASES = ["near_blank", "dense_table", "missing_header", "overlapping_stamps",
              "multi_page", "low_currency_eu"]


def _content(dt, idx, rng, recurring=None):
    """Field values + line items for one doc (keys match the engine).

    `recurring` (cfg["recurring_customer"] = {"prefix":..., "sites":[...]}) forces a
    SINGLE recurring multi-site customer ("<prefix> - <site>", site cycled by idx) so a
    stable-prefix + varying-tail lexicon can form — the scenario that exercises the
    name_match repair / truncation-flag follow-ups (the default cycled pools are
    high-variety and never build a lexicon)."""
    company = fx.COMPANIES[idx % len(fx.COMPANIES)]
    customer = fx.CUSTOMERS[(idx * 3 + 1) % len(fx.CUSTOMERS)]
    if recurring and recurring.get("prefix") and recurring.get("sites"):
        sites = recurring["sites"]
        customer = f"{recurring['prefix']} - {sites[idx % len(sites)]}"
    slug = dt["slug"]
    ref = f"{REF_PREFIX[slug]}-{2026000 + idx}"
    date = f"{rng.randint(1, 28):02d}-{rng.randint(1, 12):02d}-2026"
    cur_code, cur_sym = rng.choice(fx.CURRENCIES)
    items, total = [], 0.0
    for _ in range(rng.randint(3, 6)):
        desc = rng.choice(fx.PRODUCTS)
        qty = rng.randint(1, 9)
        unit = round(rng.uniform(8, 240), 2)
        amt = round(qty * unit, 2)
        total += amt
        items.append({"description": desc, "qty": qty, "unit": unit, "amount": amt})
    total_str = f"{cur_sym}{total:,.2f}"
    vals = {"supplier_name": company, "customer_name": customer,
            dt["ref_field_key"]: ref, dt["date_field_key"]: date}
    if dt["has_total"]:
        vals["total_amount"] = total_str
    return {"company": company, "customer": customer, "ref": ref, "date": date,
            "currency": cur_code, "currency_symbol": cur_sym, "items": items,
            "total": total_str, "values": vals}


def _features(idx, cfg, rng, modality, edge=None):
    f = {"edge": edge, "low_quality": False, "lq_effects": [], "pages": 1,
         "stamp": False, "signature": False, "barcode": False, "qr": False,
         "watermark": False, "handwrite": False, "overlap_stamp": False}
    if modality == "text":
        return f                                  # control docs stay clean
    f["stamp"] = rng.random() < P_STAMP
    f["signature"] = rng.random() < P_SIGNATURE
    f["barcode"] = rng.random() < P_BARCODE
    f["qr"] = rng.random() < P_QR
    f["watermark"] = rng.random() < P_WATERMARK
    f["handwrite"] = rng.random() < P_HANDWRITE
    if edge == "near_blank":
        f.update(stamp=False, signature=False, barcode=False, qr=False, watermark=False)
    if edge == "overlapping_stamps":
        f["overlap_stamp"] = True
    if edge == "multi_page":
        f["pages"] = rng.choice([2, 3])
    elif edge is None and rng.random() < 0.12:    # ~12% organic multi-page (page-number coverage)
        f["pages"] = rng.choice([2, 3])
    return f


def render_scanned(doc_id, idx, cfg, paths, dt, template_id, style, feat):
    rng = random.Random(cfg["seed"] + idx + 1)
    dpi = int(cfg.get("render_dpi", 150))
    W, H = int(8.27 * dpi), int(11.69 * dpi)
    pages = [Image.new("RGB", (W, H), (252, 252, 250)) for _ in range(feat["pages"])]
    draws = [ImageDraw.Draw(p) for p in pages]
    c = _content(dt, idx, rng, cfg.get('recurring_customer'))
    body = R.font(rng.choice(R.FONTS), int(dpi * 0.085))
    small = R.font(rng.choice(R.FONTS), int(dpi * 0.072))
    big = R.font(R.BOLD, int(dpi * 0.17))
    mono = R.font(R.MONO, int(dpi * 0.078))
    bold_v = R.font(R.BOLD, int(dpi * 0.085))
    M = int(dpi * 0.55)
    page_text = [[] for _ in pages]          # (y, x, str) for reading-order reconstruction

    def put(pg, s, xy, fnt, fill=(20, 20, 20)):
        b = R.text(draws[pg], xy, s, fnt, fill)
        page_text[pg].append((xy[1], xy[0], s))
        return b

    fields, anchors = {}, []
    logo_id = f"logo_{idx % len(fx.COMPANIES):03d}"
    company_key = dt["company_key"]
    near_blank = feat["edge"] == "near_blank"
    missing_header = feat["edge"] == "missing_header"

    # ── Header ──
    y = M
    if not missing_header:
        logo, shape = R.make_logo(rng, c["company"], size=int(dpi * 0.9),
                                  shape=("circle" if template_id == "invoice_b" else None))
        lx = {"left": M, "right": W - M - logo.width, "center": (W - logo.width) // 2}[style["logo"]]
        pages[0].paste(logo, (lx, M))
        logo.save(os.path.join(paths.logos, f"{logo_id}.png"))
        identity_val = c["values"].get(company_key, c["company"])
        cb = put(0, identity_val, (M + (logo.width + 18 if style["logo"] == "left" else 0),
                                   M + (6 if style["logo"] == "left" else logo.height + 10)),
                 body, fill=(10, 40, 90))
        fields[company_key] = {"value": identity_val, "bbox_px": cb,
                               "bbox_norm": R.norm(cb, W, H), "page": 0}
        put(0, "VAT 123 4567 89", (M, M + logo.height + 12), small, fill=(90, 90, 90))
        title_x = W - M - int(dpi * 1.9) if style["logo"] != "right" else M
        put(0, dt["name"].upper(), (title_x, M), big, fill=(15, 15, 15))
        y = M + logo.height + int(dpi * 0.55)
    else:
        put(0, dt["name"].upper(), (M, M), big, fill=(15, 15, 15))
        y = M + int(dpi * 0.7)

    # ── Meta key/value block (ref, date, other party, etc.) ──
    def kv(label, value, key, fnt=body):
        nonlocal y
        ab = put(0, label + ":", (M, y), small, fill=(110, 110, 110))
        anchors.append({"token": label, "field_key": key, "bbox_px": ab,
                        "bbox_norm": R.norm(ab, W, H), "page": 0})
        vb = put(0, value, (M + int(dpi * 1.5), y), fnt)
        fields[key] = {"value": value, "bbox_px": vb, "bbox_norm": R.norm(vb, W, H), "page": 0}
        y += int(dpi * 0.33)

    if not near_blank:
        for fd in dt["fields"]:
            k = fd["key"]
            if k == company_key or k == "total_amount":
                continue
            kv(fd["label"], c["values"][k], k, mono if fd["type"] == "alphanumeric" else body)

    # ── Body ──
    if not near_blank:
        if dt["slug"] == "letter":
            y += int(dpi * 0.2)
            for ln in ["Dear Sir or Madam,",
                       "Please find enclosed the documentation you requested regarding",
                       f"reference {c['ref']}. We confirm the details are correct as of",
                       f"{c['date']}. Do not hesitate to contact us with any queries.",
                       "Yours faithfully,"]:
                put(0, ln, (M, y), body); y += int(dpi * 0.3)
        elif dt["slug"] == "order_form":
            y += int(dpi * 0.15)
            for i, opt in enumerate(["Standard delivery", "Express delivery", "Gift wrap", "Email receipt"]):
                R.checkbox(pages[0], rng, (M, y), opt, checked=(i in (idx % 4, (idx + 2) % 4)), dpi=dpi)
                y += int(dpi * 0.24)
            y += int(dpi * 0.1)
            _table(put, draws[0], pages[0], rng, dt, c, M, y, W, H, dpi, body, small, mono, bold_v,
                   fields, anchors, dense=False, prices=True)
        else:
            dense = feat["edge"] == "dense_table"
            prices = dt["slug"] != "delivery_note"
            _table(put, draws[0], pages[0], rng, dt, c, M, y, W, H, dpi, body, small, mono, bold_v,
                   fields, anchors, dense=dense, prices=prices)

    # ── Continuation pages (multi-page) ──
    for pg in range(1, feat["pages"]):
        yy = M
        put(pg, f"{c['company']} — continued", (M, yy), small, fill=(120, 120, 120)); yy += int(dpi * 0.4)
        for _ in range(rng.randint(8, 16)):
            put(pg, rng.choice(fx.PRODUCTS) + f"   ref {c['ref']}", (M, yy), body); yy += int(dpi * 0.3)

    # ── Decorations ──
    if feat["barcode"]:
        anchors_bbox = R.barcode(pages[0], rng, (W - M - int(dpi * 2.2), M + int(dpi * 1.1)),
                                 c["ref"].replace("-", ""), dpi=dpi)
        fields.setdefault("_barcode_value", {"value": c["ref"].replace("-", ""),
                          "bbox_px": anchors_bbox, "bbox_norm": R.norm(anchors_bbox, W, H), "page": 0})
    if feat["qr"]:
        R.qr(pages[0], rng, (W - M - int(dpi * 0.55), H - int(dpi * 1.3)), dpi=dpi)
    if feat["signature"]:
        R.signature(pages[0], rng, (M, H - int(dpi * 1.0)), dpi=dpi)
    if feat["stamp"]:
        R.stamp(pages[0], rng, (W - M - int(dpi * 1.8), int(H * 0.45)),
                rng.choice(["PAID", "COPY", "RECEIVED"]), dpi=dpi)
    if feat["overlap_stamp"]:
        # two stamps overlapping the total/ref region
        R.stamp(pages[0], rng, (M + int(dpi * 1.3), y - int(dpi * 0.5)), "PAID", dpi=dpi)
        R.stamp(pages[0], rng, (M + int(dpi * 1.7), y - int(dpi * 0.2)), "VOID", dpi=dpi)
    if feat["handwrite"]:
        R.handwriting(pages[0], rng, (M + int(dpi * 1.4), M + int(dpi * 0.2)), "urgent", dpi=dpi)
    if feat["watermark"]:
        pages[0] = R.watermark(pages[0], rng.choice(["DRAFT", "COPY", "ORIGINAL"]), dpi=dpi)

    # ── Footer ──
    for pg, p in enumerate(pages):
        ImageDraw.Draw(p).text((M, H - int(dpi * 0.5)),
                               f"{c['company']} — Page {pg + 1} of {len(pages)}",
                               font=small, fill=(150, 150, 150))

    # ── Light paper texture on all; strong low-quality on the flagged subset ──
    pages = [R.paper_texture(p, rng, strength=5) for p in pages]
    if feat["low_quality"]:
        pages, feat["lq_effects"] = _degrade(pages, rng)

    # ── Persist as IMAGE-ONLY PDF + optional page PNGs ──
    ddir = paths.doc_dir(doc_id); os.makedirs(ddir, exist_ok=True)
    pages[0].save(paths.pdf_path(doc_id), "PDF", resolution=dpi,
                  save_all=True, append_images=pages[1:])
    if cfg.get("keep_page_images", True):
        pdir = os.path.join(ddir, "pages"); os.makedirs(pdir, exist_ok=True)
        for pg, p in enumerate(pages):
            p.save(os.path.join(pdir, f"page_{pg}.png"))

    return _ground_truth(doc_id, idx, cfg, dt, template_id, "scanned", c, logo_id,
                         style, feat, fields, anchors, page_text, W, H, dpi, len(pages))


def _table(put, draw, img, rng, dt, c, M, y, W, H, dpi, body, small, mono, bold_v,
           fields, anchors, dense, prices):
    cols = ([M, M + int(dpi * 3.6), M + int(dpi * 4.6), M + int(dpi * 5.6)] if prices
            else [M, M + int(dpi * 4.5)])
    heads = ["Description", "Qty", "Unit", "Amount"] if prices else ["Description", "Qty"]
    for cx, ct in zip(cols, heads):
        put(0, ct, (cx, y), small, fill=(110, 110, 110))
    y += int(dpi * 0.26)
    draw.line([(M, y), (W - M, y)], fill=(150, 150, 150), width=2); y += 8
    rows = c["items"] * (4 if dense else 1)
    step = int(dpi * (0.2 if dense else 0.3))
    rfont = R.font(rng.choice(R.FONTS), int(dpi * (0.06 if dense else 0.085)))
    for it in rows:
        cells = ([it["description"], str(it["qty"]), f"{it['unit']:.2f}", f"{it['amount']:.2f}"]
                 if prices else [it["description"], str(it["qty"])])
        for cx, cv in zip(cols, cells):
            put(0, cv, (cx, y), rfont if cx == cols[0] else mono)
        y += step
    if dt["has_total"] and prices:
        y += int(dpi * 0.15)
        tl = put(0, "Total", (cols[2], y), small, fill=(110, 110, 110))
        anchors.append({"token": "Total", "field_key": "total_amount", "bbox_px": tl,
                        "bbox_norm": R.norm(tl, W, H), "page": 0})
        tb = put(0, c["total"], (cols[3], y), bold_v)
        fields["total_amount"] = {"value": c["total"], "bbox_px": tb,
                                  "bbox_norm": R.norm(tb, W, H), "page": 0}


def _degrade(pages, rng):
    """Apply a deterministic subset of strong low-quality scan effects."""
    choices = rng.sample(["blur", "contrast", "shadow", "noise", "resize"],
                         k=rng.randint(1, 3))
    out = []
    for p in pages:
        q = p
        if "blur" in choices: q = R.deg_blur(q, radius=rng.uniform(1.0, 2.0))
        if "contrast" in choices: q = R.deg_contrast(q, factor=rng.uniform(0.45, 0.7))
        if "shadow" in choices: q = R.deg_shadow(q, rng)
        if "noise" in choices: q = R.deg_noise(q, rng, strength=rng.randint(18, 30))
        if "resize" in choices: q = R.deg_resize(q, scale=rng.uniform(0.5, 0.7))
        out.append(q)
    return out, choices


def render_text(doc_id, idx, cfg, paths, dt, template_id):
    """A control doc with a genuine selectable text layer (pdfwrite, 72-pt A4)."""
    rng = random.Random(cfg["seed"] + idx + 1)
    c = _content(dt, idx, rng, cfg.get('recurring_customer'))
    os.makedirs(paths.doc_dir(doc_id), exist_ok=True)
    pdf = TextPdf()
    fields, anchors, page_text = {}, [], [[]]
    M = 56

    def line(s, x, y, size=11, key=None, label_for=None):
        b = pdf.add_line(0, x, y, s, size)
        page_text[0].append((y, x, s))
        if key:
            fields[key] = {"value": s, "bbox_px": b, "bbox_norm": [b[0] / 595, b[1] / 842, b[2] / 595, b[3] / 842], "page": 0}
        if label_for:
            anchors.append({"token": s.rstrip(":"), "field_key": label_for, "bbox_px": b,
                            "bbox_norm": [b[0] / 595, b[1] / 842, b[2] / 595, b[3] / 842], "page": 0})
        return b

    y = M
    line(dt["name"].upper(), M, y, 20); y += 30
    identity_val = c["values"].get(dt["company_key"], c["company"])
    line(identity_val, M, y, 13, key=dt["company_key"]); y += 26
    for fd in dt["fields"]:
        k = fd["key"]
        if k == dt["company_key"] or k == "total_amount":
            continue
        line(fd["label"] + ":", M, y, 11, label_for=k)
        line(c["values"][k], M + 140, y, 11, key=k); y += 20
    y += 12
    if dt["has_total"]:
        line("Description", M, y, 10); line("Qty", M + 280, y, 10)
        line("Unit", M + 330, y, 10); line("Amount", M + 400, y, 10); y += 18
        for it in c["items"]:
            line(it["description"], M, y, 10); line(str(it["qty"]), M + 280, y, 10)
            line(f"{it['unit']:.2f}", M + 330, y, 10); line(f"{it['amount']:.2f}", M + 400, y, 10); y += 16
        y += 14
        line("Total:", M + 330, y, 11, label_for="total_amount")
        line(c["total"], M + 400, y, 11, key="total_amount")
    else:
        for ln in ["This document is provided for your records.",
                   f"Reference {c['ref']} dated {c['date']}."]:
            line(ln, M, y, 11); y += 18
    pdf.write(paths.pdf_path(doc_id))
    feat = {"edge": None, "low_quality": False, "lq_effects": [], "pages": 1,
            "stamp": False, "signature": False, "barcode": False, "qr": False,
            "watermark": False, "handwrite": False, "overlap_stamp": False}
    return _ground_truth(doc_id, idx, cfg, dt, template_id, "text", c, None,
                         {"logo": "left"}, feat, fields, anchors, page_text, 595, 842, 72, 1)


def _ground_truth(doc_id, idx, cfg, dt, template_id, modality, c, logo_id, style,
                  feat, fields, anchors, page_text, W, H, dpi, page_count):
    pt = []
    for pg in page_text:
        pt.append(" ".join(s for (_, _, s) in sorted(pg, key=lambda t: (round(t[0] / (dpi * 0.18)), t[1]))))
    return {
        "doc_id": doc_id, "variant_id": "base", "seed": cfg["seed"] + idx + 1,
        "template_id": template_id, "doc_type": dt["slug"], "doc_type_name": dt["name"],
        "modality": modality, "page_count": page_count,
        "render": {"width": W, "height": H, "dpi": dpi},
        "company": {"name": c["company"], "logo_id": logo_id, "logo_style": style["logo"]},
        "customer_name": c["customer"], "date": c["date"], "currency": c["currency"],
        "reference": c["ref"], "total_amount": c.get("total") if dt["has_total"] else None,
        "ref_field_key": dt["ref_field_key"], "date_field_key": dt["date_field_key"],
        "company_key": dt["company_key"],
        "features": feat, "edge_case": feat.get("edge"),
        "fields": fields, "line_items": c["items"], "anchors": anchors,
        "page_text": pt, "drift": None,
    }


def _spread_across_templates(scanned, rng, count):
    """Pick `count` of the given (plan_index, template_id) entries, spread as evenly as
    possible across templates: round-robin over per-template pools shuffled by `rng`.
    Deterministic for a fixed seed; returns distinct plan indices. This is what keeps
    the hard cases (edge cases, low-quality) from piling onto one or two templates."""
    by_t = {}
    for idx, tmpl in scanned:
        by_t.setdefault(tmpl, []).append(idx)
    pools = {t: rng.sample(v, len(v)) for t, v in by_t.items()}   # shuffled per template
    order = sorted(pools)
    picked = []
    while len(picked) < count and any(pools[t] for t in order):
        for t in order:
            if pools[t]:
                picked.append(pools[t].pop())
                if len(picked) >= count:
                    break
    return picked


def _low_quality_set(plan, cfg):
    """SEEDED-RANDOM low-quality selection (>= low_quality_pct of scanned docs), spread
    evenly across templates so per-template metrics stay comparable. The old index-stride
    (scan_idx[::5] against a 10-template cycle) landed every low-quality doc on just two
    templates — the invoice_a / statement_a skew in the report."""
    scanned = [(i, p[2]) for i, p in enumerate(plan) if p[0] == "scanned"]
    n_lq = (len(scanned) * int(cfg.get("low_quality_pct", 20)) + 99) // 100
    return set(_spread_across_templates(scanned, random.Random(cfg["seed"] * 17 + 3), n_lq))


def plan_corpus(cfg):
    """Deterministic (modality, doc_type, template, edge) plan for every doc.

    Edge cases are assigned by SEEDED RANDOM SAMPLING spread evenly across templates
    (shuffled edge-type list zipped onto a template-round-robin pick), so each of the 6
    edge classes lands on a variety of templates instead of clustering by index stride."""
    n_scan, n_text = cfg["scanned_docs"], cfg["text_docs"]
    styles = [{"logo": "left"}, {"logo": "right"}, {"logo": "center"}]
    edge_rng = random.Random(cfg["seed"] * 13 + 7)
    scanned = [(i, fx.TEMPLATES[i % len(fx.TEMPLATES)][0]) for i in range(n_scan)]
    edge_types = [ec for ec in EDGE_CASES for _ in range(8)]     # >= 8 of each edge case
    edge_rng.shuffle(edge_types)
    picked = _spread_across_templates(scanned, edge_rng, len(edge_types))
    edge_slots = dict(zip(picked, edge_types))
    plan = []
    for i in range(n_scan):
        tmpl, slug = fx.TEMPLATES[i % len(fx.TEMPLATES)]
        plan.append(("scanned", slug, tmpl, styles[i % 3], edge_slots.get(i)))
    for i in range(n_text):
        tmpl, slug = fx.TEMPLATES[i % len(fx.TEMPLATES)]
        plan.append(("text", slug, tmpl, styles[i % 3], None))
    return plan


def generate_corpus(cfg, paths, limit=None):
    """Generate the corpus + per-doc ground truth + manifest.csv."""
    plan = plan_corpus(cfg)
    if limit is not None:
        # Smoke run: keep the 90/10 feel — mostly scanned + a couple of text docs.
        n_text = max(1, limit // 10)
        plan = plan[:limit - n_text] + [p for p in plan if p[0] == "text"][:n_text]
    lq = _low_quality_set(plan, cfg)

    rows = []
    for i, (modality, slug, tmpl, style, edge) in enumerate(plan):
        doc_id = f"DOC_{i + 1:06d}"
        dt = fx.DOC_TYPE_BY_SLUG[slug]
        rng = random.Random(cfg["seed"] + i + 1)
        if modality == "text":
            gt = render_text(doc_id, i, cfg, paths, dt, tmpl)
        else:
            feat = _features(i, cfg, rng, modality, edge)
            feat["low_quality"] = i in lq
            gt = render_scanned(doc_id, i, cfg, paths, dt, tmpl, style, feat)
        with open(paths.gt_path(doc_id), "w", encoding="utf-8") as fh:
            json.dump(gt, fh, indent=2)
        rows.append({"doc_id": doc_id, "modality": gt["modality"], "doc_type": gt["doc_type"],
                     "template_id": gt["template_id"], "company": gt["company"]["name"],
                     "customer_name": gt["customer_name"], "page_count": gt["page_count"],
                     "variant_id": gt["variant_id"], "seed": gt["seed"],
                     "low_quality": int(gt["features"]["low_quality"]),
                     "edge_case": gt.get("edge_case") or ""})
    with open(paths.manifest, "w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader(); w.writerows(rows)
    return rows
