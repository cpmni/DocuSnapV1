"""Per-document, per-field diff of two `teach_run_ab.js` arms, scored against corpus ground truth.

WHY THIS EXISTS ALONGSIDE `score_teach_run.py`. The scorer answers "how many ok / wrong / empty per
lane", which is the right headline. It does not say WHICH documents moved. A lane that nets to zero
can be six heals and six regressions, and a gate that only reads the totals would call that no
change. This prints the moved rows, split into HEAL / REGRESS / OTHER, so a no-regression claim is
something you can see rather than infer.

It was written for the `CODE_SEPARATOR_STRUCTURE_GUARD` gate (`8ee7456`), where it showed the two
heals, zero regressions, and — the useful part — that the single surviving ref failure was a
DIFFERENT defect (an I->1 OCR misread) rather than an incomplete fix.

  py -3.12 stress_test/diff_arms.py <base.json> <armed.json>

  where the arm files are what teach_run_ab.js writes to ~/Desktop/TESTING/arms/<arm>.json.

READ THIS BEFORE QUOTING THE LANE TOTALS. `score_teach_run.py` is AUTHORITATIVE for per-lane counts;
this tool is not. Its ref lane resolves the per-type reference field by trying a fixed list of likely
keys rather than by the document type's structural roles, so its "N ok" figures UNDER-COUNT. What is
exact here is the per-document comparison: both arms are read with the same key, so a row appearing
under HEAL or REGRESS is a real move regardless of the totals beside it.
"""
import json
import os
import re
import sys

HOME = os.path.expanduser("~")
CORPUS = os.environ.get("TEACH_CORPUS") or os.path.join(HOME, "Desktop", "Customer Doc Test")

COLMAP = {"issuer": "supplier_name", "customer": "customer_name", "total": "total",
          "vat_no": "vat_no", "account_no": "account_no", "po_ref": "po_ref", "serials": "serials"}
# Tried in order to find the per-type reference field. See the caveat in the module docstring.
REF_KEYS = ("invoice_number", "reference_code", "sales_order_number", "po_number",
            "reference_number", "delivery_number")


def n_txt(s):
    return re.sub(r"[^a-z0-9]+", " ", str(s or "").lower()).strip()


def n_ref(s):
    return re.sub(r"\s+", "", str(s or "").upper())


def n_date(s):
    return re.sub(r"[^0-9]", "", str(s or ""))


def n_money(s):
    m = re.sub(r"[^0-9.\-]", "", str(s or ""))
    try:
        return f"{float(m):.2f}"
    except ValueError:
        return None


def load_gt():
    gt = {}
    for r in json.load(open(os.path.join(CORPUS, "ground_truth.json"), encoding="utf-8")):
        gt[os.path.basename(r["file"])] = r
    return gt


def load_arm(p):
    raw = json.load(open(p, encoding="utf-8"))
    docs = raw.values() if isinstance(raw, dict) else raw
    out = {}
    for d in docs:
        fn = d.get("original_filename") or d.get("file")
        if fn:
            out[os.path.basename(fn)] = d
    return out


def value_of(doc, key):
    ex = doc.get("extractions") or doc.get("fields") or {}
    v = ex.get(key)
    if isinstance(v, dict):
        return v.get("value") if "value" in v else v.get("v")
    if v is not None:
        return v
    return doc.get(key)


def verdict(got, want, norm):
    if want in (None, ""):
        return None
    g, w = norm(got), norm(want)
    if not g:
        return "empty"
    return "ok" if g == w else "wrong"


LANES = [("ref", "ref", n_ref), ("date", "date", n_date), ("total", "total", n_money),
         ("issuer", "issuer", n_txt), ("customer", "customer", n_txt),
         ("vat_no", "vat_no", n_ref), ("account_no", "account_no", n_ref),
         ("po_ref", "po_ref", n_ref), ("serials", "serials", n_ref)]


def main(a_path, b_path):
    gt, A, B = load_gt(), load_arm(a_path), load_arm(b_path)
    a_name = os.path.basename(a_path).replace(".json", "")
    b_name = os.path.basename(b_path).replace(".json", "")
    shared = sorted(set(A) & set(B))
    print(f"documents in both arms: {len(shared)}   ({a_name} -> {b_name})")
    print("lane totals are INDICATIVE — score_teach_run.py is authoritative; the moved rows are exact\n")
    net = 0
    for lane, gtcol, norm in LANES:
        heals, regs, moves = [], [], []
        a_ok = b_ok = 0
        for fn in shared:
            g = gt.get(fn)
            if not g:
                continue
            want = g.get(gtcol)
            if lane == "ref":
                key = next((k for k in REF_KEYS if value_of(A[fn], k) or value_of(B[fn], k)), None)
                if not key:
                    continue
            else:
                key = COLMAP.get(lane, lane)
            va, vb = value_of(A[fn], key), value_of(B[fn], key)
            xa, xb = verdict(va, want, norm), verdict(vb, want, norm)
            if xa is None:
                continue
            a_ok += xa == "ok"
            b_ok += xb == "ok"
            if xa == xb:
                continue
            row = (fn, va, vb, want)
            if xb == "ok":
                heals.append(row)
            elif xa == "ok":
                regs.append(row)
            else:
                moves.append(row)
        net += len(heals) - len(regs)
        if not (heals or regs or moves):
            print(f"{lane:<12} identical  ({a_ok} ok)")
            continue
        print(f"{lane:<12} {a_ok} ok -> {b_ok} ok  (delta {b_ok - a_ok:+d})   "
              f"healed {len(heals)} / regressed {len(regs)} / other {len(moves)}")
        for tag, rows in (("HEAL", heals), ("REGRESS", regs), ("OTHER", moves)):
            for fn, va, vb, want in rows[:12]:
                print(f"    {tag:<8} {fn[:44]:<44} {str(va)!r} -> {str(vb)!r}  (gt {want!r})")
            if len(rows) > 12:
                print(f"    {tag:<8} … {len(rows) - 12} more")
        print()
    print(f"net across all lanes: {net:+d} (heals minus regressions)")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit("usage: diff_arms.py <base.json> <armed.json>")
    main(sys.argv[1], sys.argv[2])
