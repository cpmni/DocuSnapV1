"""
stress_test/template_gate_probe.py — Stage-0 template-identity replay over the LIVE DB.

THE verification gate for the template-misfile fix family (TEMPLATE_GATE_DISTINCTIVE — the
distinctive-token Stage-0 gate, Oracle-signed 2026-07-20). realdoc_regression.js is BLIND to this
class: it reprocesses confirmed docs whose learning was built from those same docs, and does not
score validation_note/needs_review — the Northgate→Copperfield misfile scored 100% through it.
This probe replays every stored (logo_phash, ocr_text) through identify_template directly, V1
(TEMPLATE_GATE_DISTINCTIVE=0) vs V2 (=1), and adjudicates each outcome against the supplier the
FILENAME declares (the corpus files are named <Supplier>_<type>_<nn>.pdf).

PASS requires (Oracle conditions):
  * every V1 WRONG_MATCH (the misfile class) becomes NO_MATCH or RIGHT_MATCH under V2;
  * FALSE-ABSTAIN = 0 — every V1 RIGHT_MATCH stays a RIGHT_MATCH under V2;
  * any changed outcome that cannot be adjudicated from the filename is a FAILURE, not a diff line.

Read-only over the live DB. Run:  py -3.12 stress_test/template_gate_probe.py
Env: TEMPLATE_PROBE_DB overrides the DB path. Output: stress_test/out/template_gate_probe.md
"""
import json
import os
import re
import sqlite3
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, "..", "python_backend"))
sys.path.insert(0, os.path.join(_HERE, "..", "python_backend", "extraction"))
import template_matcher as tm  # noqa: E402

DB = os.environ.get("TEMPLATE_PROBE_DB") or os.path.join(
    os.environ.get("APPDATA", ""), "ScanFinder", "docusnap.db")
OUT = os.path.join(_HERE, "out", "template_gate_probe.md")


def _norm_name(s):
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


def load_payload(con):
    """Mirror templates.js getAll: fields, logo hash set, parsed fingerprint, dominant supplier,
    live confirmed counts, count-then-name ordering."""
    q = lambda sql, *a: [dict(r) for r in con.execute(sql, a).fetchall()]
    live = {r["template_id"]: r["c"] for r in q(
        "SELECT template_id, COUNT(*) c FROM documents "
        "WHERE status='confirmed' AND template_id IS NOT NULL GROUP BY template_id")}
    tpls = []
    for t in q("SELECT * FROM templates"):
        t["confirmed_count"] = live.get(t["id"], 0)
        t["fields"] = q("SELECT * FROM template_fields WHERE template_id=?", t["id"])
        hs = q("SELECT phash, detail_hash FROM template_logo_hashes WHERE template_id=?", t["id"])
        t["logo_phashes"] = [h["phash"] for h in hs]
        t["logo_detail_hashes"] = [h["detail_hash"] for h in hs if h["detail_hash"]]
        try:
            t["keyword_fingerprint"] = json.loads(t["keyword_fingerprint"] or "[]")
        except Exception:
            t["keyword_fingerprint"] = []
        dom = q("""SELECT supplier_name v, COUNT(*) c FROM documents
                   WHERE template_id=? AND status='confirmed' AND supplier_name IS NOT NULL
                     AND TRIM(supplier_name) <> '' GROUP BY supplier_name
                   ORDER BY c DESC LIMIT 1""", t["id"])
        t["dominant_supplier"] = dom[0]["v"] if dom else None
        tpls.append(t)
    tpls.sort(key=lambda t: (-t["confirmed_count"], str(t["name"] or "")))
    return tpls


def template_identity(t):
    """The identity a match would ASSERT: dominant confirmed issuer, else the frozen supplier
    value, else the cosmetic name (last resort, matches _rival_branding_present's keying)."""
    if t.get("dominant_supplier"):
        return t["dominant_supplier"]
    for f in t.get("fields") or []:
        if f.get("field_key") == "supplier_name" and f.get("fixed_value") and not f.get("is_variable"):
            return f["fixed_value"]
    return t.get("name")


def run_one(doc, templates, slug, trusted):
    tm.compute_logo_hash = lambda img, _p=doc["logo_phash"]: _p
    r = tm.identify_template(object(), doc["ocr_text"] or "", templates,
                             detected_slug=slug, title_trusted=trusted,
                             query_detail_hash=doc.get("logo_detail_hash"))
    if not r or not r.get("template"):
        return ("NO_MATCH", None)
    return ("MATCH", r["template"])


def main():
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    templates = load_payload(con)
    slug_of = {r["id"]: r["slug"] for r in con.execute("SELECT id, slug FROM document_types")}
    known = {_norm_name(template_identity(t)) for t in templates} | {
        _norm_name(r["supplier_name"]) for r in con.execute(
            "SELECT DISTINCT supplier_name FROM documents WHERE supplier_name IS NOT NULL")}
    docs = [dict(r) for r in con.execute(
        "SELECT id, original_filename, supplier_name, status, document_type_id,"
        "       logo_phash, logo_detail_hash, ocr_text FROM documents "
        "WHERE ocr_text IS NOT NULL AND TRIM(ocr_text) <> '' AND logo_phash IS NOT NULL "
        "ORDER BY id")]

    rows, fails, wrong_v1, false_abstain, healed, unadjudicated_changes = [], [], 0, 0, 0, 0
    for doc in docs:
        expected = _norm_name((doc["original_filename"] or "").split("_")[0])
        adjudicable = expected in known
        own_slug = slug_of.get(doc["document_type_id"])
        for (slug, trusted) in ((None, False), (own_slug, False), (own_slug, True)):
            outs = {}
            for label, env in (("V1", "0"), ("V2", "1")):
                os.environ["TEMPLATE_GATE_DISTINCTIVE"] = env
                state, tpl = run_one(doc, templates, slug, trusted)
                if state == "MATCH":
                    ident = _norm_name(template_identity(tpl))
                    if not adjudicable:
                        outs[label] = ("MATCH?", tpl["id"])
                    elif ident == expected:
                        outs[label] = ("RIGHT_MATCH", tpl["id"])
                    else:
                        outs[label] = ("WRONG_MATCH", tpl["id"])
                else:
                    outs[label] = ("NO_MATCH", None)
            os.environ.pop("TEMPLATE_GATE_DISTINCTIVE", None)
            v1, v2 = outs["V1"], outs["V2"]
            if v1[0] == "WRONG_MATCH":
                wrong_v1 += 1
                if v2[0] in ("NO_MATCH", "RIGHT_MATCH"):
                    healed += 1
                else:
                    fails.append(f"doc {doc['id']} {doc['original_filename']} cfg=({slug},{trusted}): "
                                 f"V1 WRONG_MATCH tpl {v1[1]} NOT healed under V2 ({v2[0]} tpl {v2[1]})")
            if v1[0] == "RIGHT_MATCH" and v2[0] != "RIGHT_MATCH":
                false_abstain += 1
                fails.append(f"doc {doc['id']} {doc['original_filename']} cfg=({slug},{trusted}): "
                             f"FALSE ABSTAIN — V1 RIGHT_MATCH tpl {v1[1]} became {v2[0]}")
            if v1 != v2:
                if not adjudicable:
                    unadjudicated_changes += 1
                    fails.append(f"doc {doc['id']} {doc['original_filename']} cfg=({slug},{trusted}): "
                                 f"UNADJUDICATABLE change {v1} -> {v2} (counts as FAILURE)")
                rows.append((doc["id"], doc["original_filename"], slug, trusted, v1, v2))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("# template_gate_probe — Stage-0 identity replay (V1 = gate off, V2 = distinctive gate)\n\n")
        f.write(f"DB: {DB}\ndocs replayed: {len(docs)} (x3 configs)\n\n")
        f.write(f"* V1 WRONG_MATCH outcomes: **{wrong_v1}**\n")
        f.write(f"* healed under V2 (abstain or right match): **{healed}**\n")
        f.write(f"* FALSE ABSTAINS (V1 right -> V2 not right): **{false_abstain}** (must be 0)\n")
        f.write(f"* unadjudicatable changed outcomes: **{unadjudicated_changes}** (must be 0)\n")
        f.write(f"* verdict: **{'PASS' if not fails else 'FAIL'}**\n\n")
        if fails:
            f.write("## Failures\n" + "\n".join(f"- {x}" for x in fails) + "\n\n")
        f.write("## Changed outcomes (V1 -> V2)\n")
        if not rows:
            f.write("(none — V1 and V2 byte-identical on this DB)\n")
        for (i, fn, slug, trusted, v1, v2) in rows:
            f.write(f"- doc {i} {fn} cfg=({slug},{trusted}): {v1} -> {v2}\n")
    print(open(OUT, encoding="utf-8").read()[:2500])
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
