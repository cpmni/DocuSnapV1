"""
gen_teach_anchors.py — derive AUTHORITATIVE taught-anchor boxes for the stress corpus.

The stress corpus is generated from a fixed `layout()` (gen_corpus.py) whose field
positions are known exactly, so we can compute the true VALUE bounding box of each
structured field and emit it as a taught ⊕ anchor — WITHOUT guessing and WITHOUT
regenerating anything. Feeding these into a reprocess pass makes the Stage-2 anchor_crop
path actually FIRE (the plain corpus never teaches anchors, so it can't score that stage).

Scope: the FIXED-position structured fields — reference number + date. (Totals move with
the item count; supplier is confounded by logo resolution — both deferred.) These are the
exact fields the real anchor-crop drift bug hit (City Office invoice 152574->192074).

Emits stress_test/corpus/teach_anchors.json:
  [ { supplier_name, document_type, field_key, anchor_label, direction,
      x_norm, y_norm, w_norm, h_norm, usage_count, confidence, last_authoritative_at }, ... ]

Run: py -3.12 stress_test/gen_teach_anchors.py
"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_corpus as G
from reportlab.pdfbase.pdfmetrics import stringWidth

PW, PH = float(G.PAGE_W), float(G.PAGE_H)   # 612 x 792 points, y from TOP
REFKEY  = {"invoice": "invoice_number", "sales_order": "sales_order_number", "purchase_order": "po_number"}
DATEKEY = {"invoice": "invoice_date",   "sales_order": "order_date",         "purchase_order": "po_date"}
# document_type NAME as the engine sees it (the anchor filter matches the doc-type name).
TYPE_NAME = {"invoice": "Invoice", "sales_order": "Sales Order", "purchase_order": "Purchase Order"}
# the printed caption WITHOUT the trailing colon (what re-locates on the page).
LABEL = {"invoice_number": "Invoice No", "sales_order_number": "Order No", "po_number": "PO No",
         "invoice_date": "Invoice Date", "order_date": "Order Date", "po_date": "PO Date"}


def value_boxes_pts(doc):
    """{field_key: (x0,y0,x1,y1)} in POINTS (top-based) for the ref + date VALUES,
    computed from the layout's right-aligned 'Label: VALUE' item and real font metrics."""
    _, items = G.layout(doc)
    ref_text  = "{} {}".format(doc["ref_label"],  doc["ref"])
    date_text = "{} {}".format(doc["date_label"], doc["date"])
    out = {}
    for (x, yt, text, size, bold, align) in items:
        font = "Helvetica-Bold" if bold else "Helvetica"
        if align == "r" and text == ref_text:
            vw = stringWidth(doc["ref"], font, size)
            out[REFKEY[doc["type_slug"]]] = (x - vw, yt, x, yt + size)
        elif align == "r" and text == date_text:
            vw = stringWidth(doc["date"], font, size)
            out[DATEKEY[doc["type_slug"]]] = (x - vw, yt, x, yt + size)
    return out


def main():
    truth = json.load(open(os.path.join(G.CORPUS, "ground_truth.json")))
    # Union each field's value box over ALL docs of its type (values vary in width;
    # a single taught anchor must cover them all — the real teach draws ONE box reused
    # for every future doc). Key by (type_slug, field_key).
    union = {}   # (type_slug, field_key) -> [x0,y0,x1,y1]
    companies_by_type = {}   # type_slug -> set(company)
    for doc in truth:
        ts = doc["type_slug"]
        companies_by_type.setdefault(ts, set()).add(doc["company"])
        for fk, (x0, y0, x1, y1) in value_boxes_pts(doc).items():
            k = (ts, fk)
            if k not in union:
                union[k] = [x0, y0, x1, y1]
            else:
                u = union[k]
                u[0], u[1] = min(u[0], x0), min(u[1], y0)
                u[2], u[3] = max(u[2], x1), max(u[3], y1)

    PADX, PADY = 3.0, 3.0   # small headroom so the crop doesn't clip glyph edges
    anchors = []
    for (ts, fk), (x0, y0, x1, y1) in sorted(union.items()):
        x0 -= PADX; x1 += PADX; y0 -= PADY; y1 += PADY
        box = {
            "x_norm": round(x0 / PW, 5), "y_norm": round(y0 / PH, 5),
            "w_norm": round((x1 - x0) / PW, 5), "h_norm": round((y1 - y0) / PH, 5),
        }
        # One authoritative anchor per (company, type) reusing the type's union box —
        # the layout is company-independent for ref/date, so every company shares it.
        for company in sorted(companies_by_type[ts]):
            anchors.append({
                "supplier_name": company, "document_type": ts, "field_key": fk,   # SLUG — engine matches anchors by document_slug
                "anchor_label": LABEL[fk], "direction": "right",
                **box, "usage_count": 5, "confidence": 0.9,
                "last_authoritative_at": 20260705120000,
            })

    outp = os.path.join(G.CORPUS, "teach_anchors.json")
    json.dump(anchors, open(outp, "w"), indent=1)
    print("wrote {} anchors -> {}".format(len(anchors), outp))
    # show the derived boxes for a sanity read
    seen = set()
    for a in anchors:
        k = (a["document_type"], a["field_key"])
        if k in seen:
            continue
        seen.add(k)
        print("  {:14s} {:20s} label='{}' box=({:.3f},{:.3f} w{:.3f} h{:.3f})".format(
            a["document_type"], a["field_key"], a["anchor_label"],
            a["x_norm"], a["y_norm"], a["w_norm"], a["h_norm"]))


if __name__ == "__main__":
    main()
