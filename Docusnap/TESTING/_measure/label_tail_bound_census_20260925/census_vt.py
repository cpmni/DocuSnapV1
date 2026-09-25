import sqlite3, sys, os, re
sys.path.insert(0, r"c:/GIT Projects/Docusnap/python_backend")
from extraction import keyword as K
from collections import Counter
MONEY=re.compile(r'[£$€]|\bGBP|USD|EUR\b|\d[\d,]*\.\d{2}')
TYPEW=re.compile(r'\b(invoice|credit note|delivery note|statement|purchase order|sales order|remittance|receipt|quot|worksheet)\b',re.I)
CODE=re.compile(r'^[A-Z]{1,5}[-/ ]?\d')
def cls(v):
    s=str(v or '')
    if not s.strip(): return 'empty'
    if TYPEW.search(s) or (s.isupper() and len(s)<20): return 'heading/typeword'
    if MONEY.search(s): return 'money'
    if CODE.match(s): return 'CODE(ref-like)'
    if re.search(r'\d',s): return 'text+digits'
    return 'text'
for tag,dbp in [("live727",r"C:/Users/cmccu/.claude/jobs/68b38f39/tmp/dbcopy/live727.db"),
                ("chris",  r"C:/Users/cmccu/.claude/jobs/68b38f39/tmp/dbcopy/chris-sandbox-20260924.db")]:
    con=sqlite3.connect(dbp)
    # label -> validation class (via override field_key, then field DB label)
    lab_vt={}
    key_label={}
    for r in con.execute("SELECT DISTINCT field_key,label FROM field_label_overrides WHERE label IS NOT NULL"):
        lab_vt.setdefault(r[1], K._infer_validation(r[0]))
    for r in con.execute("SELECT DISTINCT key,label FROM fields WHERE label IS NOT NULL"):
        lab_vt.setdefault(r[1], K._infer_validation(r[0]))
    labs=sorted(l for l in lab_vt if K._label_tail_boundable(l))
    rows=con.execute("SELECT id,ocr_text FROM documents WHERE ocr_text IS NOT NULL AND length(ocr_text)>50 AND COALESCE(status,'')<>'deleted'").fetchall()
    buckets=Counter(); examples={}
    for did,txt in rows:
        lines=txt.split("\n")
        for lab in labs:
            vt=lab_vt.get(lab)
            os.environ["KEYWORD_LABEL_TAIL_BOUND"]="0"; off=K._search_for_label(lines,lab,["right","below"],val_type=vt)
            os.environ["KEYWORD_LABEL_TAIL_BOUND"]="1"; on=K._search_for_label(lines,lab,["right","below"],val_type=vt)
            if off!=on:
                c=cls(off[0] if off else None); key=(lab,c,vt); buckets[key]+=1
                examples.setdefault(key,(did,off[0] if off else None,on[0] if on else None))
    print(f"\n==== {tag}: {len(rows)} docs, {len(labs)} labels — {sum(buckets.values())} changes (val_type-aware) ====")
    for (lab,c,vt),n in buckets.most_common():
        d,ov,nv=examples[(lab,c,vt)]
        print(f"  {n:>4} [{lab}] vt={vt} {c:16} eg#{d} OFF={ov!r} ON={nv!r}")
    con.close()
