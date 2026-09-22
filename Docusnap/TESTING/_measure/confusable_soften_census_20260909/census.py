"""FILING_SANITY_CONFUSABLE_SOFTEN (mig 147) census — offline, over the 147-doc ScanFinder Test Corpus
(TESTING/_measure/clip_census_20260909/census_off.db: confirmed docs WITH ocr_text). The Gate-C confusable
branch is a PURE function of (committed ref value rv, page ocr_text), replayed EXACTLY per engine.py:7302-7356
(page_match_v2 + the two softeners are DARK/OFF by default, so the confusable branch is reached directly).
OFF = scary 'doesn't appear' note; ON = soft note iff _near is a digit/letter confusable. Both are
validation_notes → wouldFile identical (structural)."""
import os, re, sqlite3, sys
sys.path.insert(0, r"C:\GIT Projects\Docusnap\python_backend")
from extraction import engine
DB = r"C:\GIT Projects\Docusnap\TESTING\_measure\clip_census_20260909\census_off.db"
con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True); con.row_factory = sqlite3.Row

docs = con.execute("""
  SELECT d.id, d.ocr_text, dt.ref_field_key, dt.name AS tname
    FROM documents d JOIN document_types dt ON dt.id = d.document_type_id
   WHERE d.status='confirmed' AND dt.ref_field_key IS NOT NULL
""").fetchall()

def _absent_trigger(rv, page):
    """engine.py:7311-7316 exactly."""
    if not (len(page) > 200): return None
    if not (rv and len(rv) >= 4): return None
    toks = {t.strip('.,;:()[]{}"\'').casefold() for t in re.split(r'\s+', page)}
    return rv.casefold() not in toks

n = 0; absent = []; confusable = []; nonconf_scary = []; noform = []
for d in docs:
    rk = d["ref_field_key"]; page = str(d["ocr_text"] or "")
    ex = con.execute("SELECT display_value, validation_note FROM extractions WHERE document_id=? AND field_key=?",
                     (d["id"], rk)).fetchone()
    if not ex: continue
    rv = str(ex["display_value"] or "").strip()
    n += 1
    ab = _absent_trigger(rv, page)
    if ab is None or ab is False: continue          # Gate C doesn't fire / value IS on the page
    absent.append(d["id"])
    near = engine._nearest_confusable_page_token(page, rv)
    if near and engine._one_digit_letter_confusable(rv, near):
        confusable.append((d["id"], rk, rv, near, d["tname"]))
    elif near:
        nonconf_scary.append((d["id"], rk, rv, near))   # a confusable that is NOT digit/letter (case-fold etc)
    else:
        noform.append((d["id"], rk, rv))                # plain 'absent', no page form named

print(f"=== CORPUS CENSUS — 147-doc ScanFinder Test Corpus ({n} ref-bearing confirmed docs judged) ===\n")
print(f"(i)  docs where Gate-C 'absent' fires on the ref value      : {len(absent)}")
print(f"(ii) of those, RECLASSIFIED scary->soft by mig 147 (benefit): {len(confusable)}")
print(f"     left scary — confusable but NOT digit/letter (case-fold): {len(nonconf_scary)}")
print(f"     left scary — plain 'absent', no confusable page form    : {len(noform)}")
print(f"     wouldFile CHANGED by mig 147                            : 0  (structural: note-set either way)\n")

def dump(t, a):
    print(f"--- {t}: {len(a)} ---")
    for x in a: print("   ", x)
    if not a: print("    (none)")
dump("RECLASSIFIED to soft note (digit/letter confusable)", confusable)
dump("stay scary — non-digit/letter confusable", nonconf_scary)
dump("stay scary — plain absent (no page form)", noform)
con.close()
