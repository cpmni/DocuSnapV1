"""G2 census (2026-09-24; gary Slice 2 -> Oracle CENSUS FIRST): would extending the page-family disagreement refusal
to TAUGHT optional NAME-like fields hold correct boxes (false holds) or catch wrong ones?

Population: confirmed docs; name-like OPTIONAL text fields (required=0, type text/''); the winner is a taught mapping
(winner_family 'mapping'); a PAGE family (keyword) is on `disagree`. Post-filter mirrors trust.js
_pageFamilyDisagrees (a page family in disagree U discounted) + gary's nameQuality>=0.6 floor on the keyword witness.

Classification per row:
  catch      — the human corrected the field (corrections.corrected_value differs from the stored value) OR the doc
               was machine-filed and the stored value equals its own label / a garble the keyword witness completes
  false_hold — the human confirmed the stored value unchanged (a correct box; the keyword witness was the wrong one)
  unknown    — machine-filed, no correction, no label/garble evidence (we cannot know without the page)
Also reported: containment-only share (one value contains the other), the nameQuality filter's effect.
Read-only. Usage: py -3.12 census.py <db copy> [<db copy> ...]
"""
import json, sqlite3, sys, re, unicodedata, os
sys.path.insert(0, r"C:\GIT Projects\Docusnap\python_backend")
from extraction import value_quality as VQ

def norm(s):
    t = unicodedata.normalize("NFKC", str(s or "")).casefold()
    return re.sub(r"\s+", " ", re.sub(r"[^0-9a-z&' ]+", " ", t)).strip()

def name_quality(v):
    try: return float(VQ.name_quality(str(v or "")))
    except Exception: return 0.0

def run(db_path):
    db = sqlite3.connect(db_path); db.row_factory = sqlite3.Row
    rows = db.execute("""
      SELECT d.id AS doc_id, d.confirmed_via, d.confirmed_by_username, d.supplier_name, e.field_key, e.extraction_method,
             e.display_value, e.raw_value, e.corroboration, f.label, f.required, f.type AS ftype, c.corrected_value, c.original_value
        FROM extractions e
        JOIN documents d ON d.id = e.document_id
        JOIN fields f ON f.document_type_id = d.document_type_id AND f.key = e.field_key
        LEFT JOIN corrections c ON c.document_id = e.document_id AND c.field_key = e.field_key
       WHERE d.status = 'confirmed' AND f.required = 0 AND COALESCE(f.type,'') IN ('text','')
         AND e.corroboration LIKE '%"winner_family":"mapping"%'
    """).fetchall()
    out = {"db": db_path, "rows": 0, "name_like": 0, "page_disagree": 0, "quality_pass": 0,
           "catch": 0, "false_hold": 0, "unknown": 0, "containment_only": 0, "examples": []}
    for r in rows:
        out["rows"] += 1
        if not VQ.is_name_like_field(r["field_key"], r["label"]): continue
        out["name_like"] += 1
        try: rec = json.loads(r["corroboration"] or "{}")
        except Exception: continue
        pool = list(rec.get("disagree") or []) + list(rec.get("discounted") or [])
        hit = next((d for d in pool if str((d or {}).get("family")) in ("mapping", "crop", "keyword")), None)
        if not hit: continue
        out["page_disagree"] += 1
        kw = str(hit.get("value") or "")
        stored = str(r["display_value"] or r["raw_value"] or "")
        q = name_quality(kw)
        if q < 0.6: continue
        out["quality_pass"] += 1
        a, b = norm(stored), norm(kw)
        contain = bool(a and b and (a in b or b in a) and a != b)
        if contain: out["containment_only"] += 1
        human = not str(r["confirmed_via"] or "").strip() and not re.match(r"^Auto-filed", str(r["confirmed_by_username"] or ""))
        # the stored display_value is ALREADY the corrected value after a human confirm — the pre-correction read is
        # corrections.original_value; a correction that landed ON the keyword witness = the page read was right.
        orig = r["original_value"]
        corrected_to_kw = (r["corrected_value"] is not None and orig is not None
                           and norm(r["corrected_value"]) != norm(orig) and norm(r["corrected_value"]) == b)
        corrected_elsewhere = (r["corrected_value"] is not None and orig is not None
                               and norm(r["corrected_value"]) != norm(orig) and norm(r["corrected_value"]) != b)
        is_label = VQ.value_is_own_label(stored, r["label"], None)
        kw_tokens = len([t for t in b.split() if t])
        box_clipped = bool(contain and len(b) > len(a))          # the page read is the FULLER form of the box read
        if corrected_to_kw or is_label or box_clipped or (not human and (contain or (kw_tokens >= 2 and q >= 0.6 and not human))):
            cls = "catch" if (corrected_to_kw or is_label or box_clipped) else "unknown"
        elif human and not corrected_elsewhere and not corrected_to_kw:
            cls = "false_hold"          # a human confirmed the box value as-is; the page witness disagreed
        else:
            cls = "unknown"
        if kw_tokens < 2 and cls != "catch":
            cls = "false_hold_1tok"     # a single-word page witness ('Make', 'Studio') — junk/fragment class
        out.setdefault(cls, 0); out[cls] += 1
        if len(out["examples"]) < 60:
            out["examples"].append({"doc": r["doc_id"], "field": r["field_key"], "via": r["confirmed_via"], "cls": cls,
                                    "stored": stored, "keyword": kw, "q": round(q, 2), "kw_tokens": kw_tokens, "contain": contain,
                                    "orig": orig, "corrected": r["corrected_value"]})
    return out

if __name__ == "__main__":
    for p in sys.argv[1:]:
        res = run(p)
        print(json.dumps({k: v for k, v in res.items() if k != "examples"}, indent=1))
        for ex in res["examples"]: print("   ", ex)
