import sqlite3, sys, os, re
sys.path.insert(0, r"c:/GIT Projects/Docusnap/python_backend")
from extraction import keyword as K

DBS = {
  "live727": r"C:/Users/cmccu/.claude/jobs/68b38f39/tmp/dbcopy/live727.db",
  "chris":   r"C:/Users/cmccu/.claude/jobs/68b38f39/tmp/dbcopy/chris-sandbox-20260924.db",
}
KNOWN_TYPE_WORDS = re.compile(r'\b(invoice|credit note|delivery note|statement|purchase order|sales order|remittance|receipt|quote|quotation|worksheet|order)\b', re.I)

def labels_for(con):
    labs = set()
    cols = [c[1] for c in con.execute("PRAGMA table_info(field_label_overrides)")]
    lc = "label" if "label" in cols else cols[-1]
    for r in con.execute(f"SELECT DISTINCT {lc} v FROM field_label_overrides"):
        if r[0]: labs.add(r[0])
    for r in con.execute("SELECT DISTINCT label FROM fields WHERE label IS NOT NULL"):
        if r[0]: labs.add(r[0])
    return sorted(l for l in labs if K._label_tail_boundable(l))

def search(lines, label, on):
    os.environ["KEYWORD_LABEL_TAIL_BOUND"] = "1" if on else "0"
    return K._search_for_label(lines, label, ["right", "below"])

for tag, dbp in DBS.items():
    con = sqlite3.connect(dbp)
    labs = labels_for(con)
    rows = con.execute("SELECT id, original_filename, ocr_text FROM documents WHERE ocr_text IS NOT NULL AND length(ocr_text)>50 AND COALESCE(status,'')<>'deleted'").fetchall()
    changed = []   # (docid, label, off_val, on_val)
    for did, fn, txt in rows:
        lines = txt.split("\n")
        for lab in labs:
            off = search(lines, lab, False)
            on  = search(lines, lab, True)
            if off != on:
                ov = off[0] if off else None
                nv = on[0] if on else None
                changed.append((did, lab, ov, nv))
    print(f"\n==== {tag}: {len(rows)} docs, {len(labs)} labels, {len(changed)} extraction changes OFF->ON ====")
    # classify each OFF value: heading/type-word (safe to refuse) vs looks-like-a-real-code (suspect)
    suspect = []
    for did, lab, ov, nv in changed:
        ov_s = str(ov or "")
        is_typeword = bool(KNOWN_TYPE_WORDS.search(ov_s)) or ov_s.isupper() and len(ov_s.split())<=3
        has_code = bool(re.search(r'\d', ov_s)) and not KNOWN_TYPE_WORDS.search(ov_s)
        tag2 = "TYPEWORD/heading" if is_typeword else ("SUSPECT(has digits)" if has_code else "text")
        if has_code and not is_typeword: suspect.append((did, lab, ov, nv))
        print(f"  #{did:>4} [{lab}] OFF={ov!r} -> ON={nv!r}   {tag2}")
    print(f"  --- SUSPECT (OFF value had digits, not a type word): {len(suspect)} ---")
    con.close()
