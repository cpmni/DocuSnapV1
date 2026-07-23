"""
stress_test/stage0_detail_veto_probe.py — Stage-0 detail-VETO replay over the LIVE DB.

The Python twin of the JS template_detail_veto_probe.js. THE verification gate for the claim that
the Stage-0 positive-rival detail veto (_logo_detail_veto -> logo_detail.veto_by_detail) provides
FORWARD protection against the 64-bit-phash logo-collision misfile class (the 13 Copperfield<->Thornbury
poisoned links). realdoc_regression.js is BLIND to this: it reprocesses confirmed docs WITH their
stored --known-template-id, and engine.py re-imposes that link even when identify_template abstains, so
the harness never exercises a fresh (no-known-id) template decision.

This probe replays every stored (logo_phash, logo_detail_hash, ocr_text) through identify_template
DIRECTLY (no known_template_id), OFF (LOGO_DETAIL_VETO=0) vs ON (=1), holding TEMPLATE_GATE_DISTINCTIVE
at its default so the delta isolates the DETAIL veto's unique contribution beyond the text gate. Each
outcome is adjudicated against the supplier the FILENAME declares (<Supplier>_<type>_<nn>.pdf).

PASS requires:
  * GATE A — every OFF WRONG_MATCH (a doc resolving a DIFFERENT supplier's template) becomes NO_MATCH
    or RIGHT_MATCH under ON;
  * GATE B — FALSE-ABSTAIN = 0: every OFF RIGHT_MATCH stays a RIGHT_MATCH under ON (no correct
    identity suppressed by the veto);
  * any ON!=OFF change that cannot be adjudicated from the filename is a FAILURE, not a diff line.
Also emits an (a)-RESIDUAL WATCH-LIST: docs whose ON pick lands on a template with an EMPTY detail set
(logo_detail_hashes == []) — the veto structurally cannot judge those (they rest on 64-bit + text gate).

Read-only over the live DB. Run:  py -3.12 stress_test/stage0_detail_veto_probe.py
Env: TEMPLATE_PROBE_DB overrides the DB path. Output: stress_test/out/stage0_detail_veto_probe.md
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
OUT = os.path.join(_HERE, "out", "stage0_detail_veto_probe.md")


def _norm_name(s):
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


def load_payload(con):
    """Mirror templates.js getAll: fields, logo hash set (+ detail set from Store B),
    parsed fingerprint, dominant supplier, live confirmed counts, count-then-name ordering."""
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
    detailless = {t["id"] for t in templates if not t["logo_detail_hashes"]}
    slug_of = {r["id"]: r["slug"] for r in con.execute("SELECT id, slug FROM document_types")}
    known = {_norm_name(template_identity(t)) for t in templates} | {
        _norm_name(r["supplier_name"]) for r in con.execute(
            "SELECT DISTINCT supplier_name FROM documents WHERE supplier_name IS NOT NULL")}
    docs = [dict(r) for r in con.execute(
        "SELECT id, original_filename, supplier_name, status, document_type_id,"
        "       logo_phash, logo_detail_hash, ocr_text FROM documents "
        "WHERE ocr_text IS NOT NULL AND TRIM(ocr_text) <> '' AND logo_phash IS NOT NULL "
        "ORDER BY id")]

    rows, fails = [], []
    wrong_off = healed = false_abstain = unadjudicated = 0
    watch = []
    for doc in docs:
        expected = _norm_name((doc["original_filename"] or "").split("_")[0])
        adjudicable = expected in known
        own_slug = slug_of.get(doc["document_type_id"])
        for (slug, trusted) in ((None, False), (own_slug, False), (own_slug, True)):
            outs = {}
            for label, env in (("OFF", "0"), ("ON", "1")):
                os.environ["LOGO_DETAIL_VETO"] = env
                state, tpl = run_one(doc, templates, slug, trusted)
                if state == "MATCH":
                    ident = _norm_name(template_identity(tpl))
                    if not adjudicable:
                        outs[label] = ("MATCH?", tpl["id"])
                    elif ident == expected:
                        outs[label] = ("RIGHT_MATCH", tpl["id"])
                    else:
                        outs[label] = ("WRONG_MATCH", tpl["id"])
                    if label == "ON" and tpl["id"] in detailless:
                        watch.append((doc["id"], doc["original_filename"], slug, trusted, tpl["id"], outs[label][0]))
                else:
                    outs[label] = ("NO_MATCH", None)
            os.environ.pop("LOGO_DETAIL_VETO", None)
            off, on = outs["OFF"], outs["ON"]
            if off[0] == "WRONG_MATCH":
                wrong_off += 1
                if on[0] in ("NO_MATCH", "RIGHT_MATCH"):
                    healed += 1
                else:
                    fails.append(f"doc {doc['id']} {doc['original_filename']} cfg=({slug},{trusted}): "
                                 f"OFF WRONG_MATCH tpl {off[1]} NOT healed under ON ({on[0]} tpl {on[1]})")
            if off[0] == "RIGHT_MATCH" and on[0] != "RIGHT_MATCH":
                false_abstain += 1
                fails.append(f"doc {doc['id']} {doc['original_filename']} cfg=({slug},{trusted}): "
                             f"FALSE ABSTAIN — OFF RIGHT_MATCH tpl {off[1]} became {on[0]}")
            if off != on:
                if not adjudicable:
                    unadjudicated += 1
                    fails.append(f"doc {doc['id']} {doc['original_filename']} cfg=({slug},{trusted}): "
                                 f"UNADJUDICATABLE change {off} -> {on} (FAILURE)")
                rows.append((doc["id"], doc["original_filename"], slug, trusted, off, on))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("# stage0_detail_veto_probe — Stage-0 detail-veto replay (OFF vs ON)\n\n")
        f.write(f"DB: {DB}\ndocs replayed: {len(docs)} (x3 configs); detail-less templates: "
                f"{sorted(detailless)}\n\n")
        f.write(f"* OFF WRONG_MATCH outcomes: **{wrong_off}**\n")
        f.write(f"* GATE A — healed under ON (abstain or right match): **{healed}** (must == OFF WRONG_MATCH)\n")
        f.write(f"* GATE B — FALSE ABSTAINS (OFF right -> ON not right): **{false_abstain}** (must be 0)\n")
        f.write(f"* unadjudicatable changed outcomes: **{unadjudicated}** (must be 0)\n")
        f.write(f"* verdict: **{'PASS' if not fails else 'FAIL'}**\n\n")
        if fails:
            f.write("## Failures\n" + "\n".join(f"- {x}" for x in fails) + "\n\n")
        f.write("## Changed outcomes (OFF -> ON)\n")
        if not rows:
            f.write("(none — OFF and ON byte-identical on this DB: the coarse+text layer already "
                    "decides these; the detail veto changes nothing here)\n")
        for (i, fn, slug, trusted, off, on) in rows:
            f.write(f"- doc {i} {fn} cfg=({slug},{trusted}): {off} -> {on}\n")
        f.write(f"\n## (a)-residual WATCH-LIST — ON pick lands on a DETAIL-LESS template ({len(watch)} rows)\n")
        f.write("(these rest on 64-bit phash + the text gate only; the veto cannot judge them. "
                "Self-heals as those templates accrue a detail hash on next confirm.)\n")
        for (i, fn, slug, trusted, tid, verdict) in watch[:60]:
            f.write(f"- doc {i} {fn} cfg=({slug},{trusted}) -> tpl {tid} [{verdict}]\n")
    print(open(OUT, encoding="utf-8").read()[:3000])
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
