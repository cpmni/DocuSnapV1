import sqlite3, sys, os
sys.path.insert(0, r"c:/GIT Projects/Docusnap/python_backend")
from extraction import keyword as K
con=sqlite3.connect(r"C:/Users/cmccu/.claude/jobs/68b38f39/tmp/dbcopy/live727.db")
# reordered delivery-number labels (as shipped now)
DELIV=['Delivery Note No','Delivery Number','Delivery No','DN No','Despatch No','Dispatch No','Docket No','Note No']
def first_hit(lines, labels, on):
    os.environ["KEYWORD_LABEL_TAIL_BOUND"]="1" if on else "0"
    for lab in labels:
        r=K._search_for_label(lines,lab,["right","below"],val_type="alphanumeric")
        if r: return (lab, r[0])
    return None
for did in (1,43,45,47):
    row=con.execute("SELECT ocr_text, reference_number FROM documents WHERE id=?", (did,)).fetchone()
    if not row: continue
    lines=row[0].split("\n")
    # find the DN line
    dn=[ln for ln in lines if 'DN-' in ln.upper() or 'DELIVERY' in ln.upper()][:2]
    print(f"\n#{did} db.reference_number={row[1]!r}")
    for ln in dn: print("   line:", repr(ln))
    print("   OFF first-hit:", first_hit(lines,DELIV,False))
    print("   ON  first-hit:", first_hit(lines,DELIV,True))
con.close()
