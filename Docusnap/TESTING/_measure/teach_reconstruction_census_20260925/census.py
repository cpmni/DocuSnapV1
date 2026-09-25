"""
teach_reconstruction_census_20260925/census.py — Idea A / suggested-teach FLIP GATE, Oracle A2 (2026-09-25).
Measures whether the box a suggested-teach would RECONSTRUCT (eric's path: words-only OCR of the page →
string-match the committed value → synthesize its box) actually LOCATES the value uniquely — the safety
question the Oracle sent Idea A back to answer BEFORE any UI. Pure measurement, no app code changed.

Per sampled doc: render page 1 at the product DPI, run region.py --page-words (the SAME word geometry the
teach path uses), then for each GT field value (ref, date) look for a contiguous run of OCR words whose
normalised concatenation equals the value. Classify the value:
  UNIQUE   — exactly one such run  → a box can be safely pre-drawn
  MULTIPLE — two or more runs       → AMBIGUOUS: reconstruction could pre-draw the WRONG instance (repeated
                                      token / totals-block class — the exact rubber-stamp trap)
  NONE     — no contiguous run      → OCR split/merge: no box, must fall back to a manual draw
The 'safe' rate = UNIQUE / (all). Oracle bar: suggested-teach is viable only if UNIQUE dominates and the
MULTIPLE (silent-wrong) class is rare; MULTIPLE is reported SEPARATELY, never averaged away.

Usage: py -3.12 census.py [N_PER_TYPE]   (default 6; sequential, one OCR at a time — memory-safe)
"""
import json, os, re, subprocess, sys, tempfile
import pypdfium2 as pdfium

REPO = r"c:/GIT Projects/Docusnap"
CORP = os.path.join(os.environ.get("USERPROFILE", ""), "Desktop", "ScanFinder Test Corpus")
REGION = os.path.join(REPO, "python_backend", "ocr", "region.py")
TESS = r"C:/Program Files/Tesseract-OCR/tesseract.exe"
DPI = 200
N = int(sys.argv[1]) if len(sys.argv) > 1 else 6

def norm_ref(s):  return re.sub(r"[^A-Za-z0-9]+", "", str(s or "")).upper()
def norm_date(s): return re.sub(r"[^0-9]", "", str(s or ""))

def page_words(png_path):
    env = dict(os.environ, OCR_RENDER_DPI=str(DPI))
    p = subprocess.run(["py", "-3.12", REGION, "--image-file", png_path, "--tesseract", TESS, "--page-words"],
                       capture_output=True, text=True, env=env)
    try: return json.loads(p.stdout.strip())
    except Exception: return {"w": 0, "h": 0, "words": []}

def find_runs(words, target_norm, normfn):
    """count DISTINCT contiguous word-runs whose normalised concat == target_norm (bounded run length).
    A word that normalises to '' (a label like "Date", punctuation) may NOT start a run and is skipped
    inside one — else "Date 07-08-2026" would double-count the value (the label-absorbed run + the bare
    run) as MULTIPLE (verified artifact 2026-09-25). Overlapping hits that share the value word collapse."""
    if not target_norm: return 0
    n = len(words)
    starts = []
    for i in range(n):
        if not normfn(words[i].get("t", "")): continue      # a run may not START on an empty-norm word
        acc = ""; last = i
        for j in range(i, min(i + 8, n)):
            w = normfn(words[j].get("t", ""))
            if not w: continue                                # skip empty-norm words inside the run
            acc += w; last = j
            if len(acc) > len(target_norm): break
            if acc == target_norm: starts.append((i, last)); break
    # collapse runs that share their VALUE span (same last index) — one physical value, one box
    seen = set(); hits = 0
    for i, last in starts:
        if last in seen: continue
        seen.add(last); hits += 1
    return hits

def classify(hits): return "UNIQUE" if hits == 1 else ("MULTIPLE" if hits >= 2 else "NONE")

def main():
    gt = json.load(open(os.path.join(CORP, "ground_truth.json"), encoding="utf-8"))
    by_type = {}
    for rel, row in gt.items():
        by_type.setdefault(row.get("type_slug", "?"), []).append((rel, row))
    sample = []
    for t, rows in by_type.items(): sample += rows[:N]
    print(f"census: {len(sample)} docs ({N}/type), DPI {DPI}\n")
    agg = {}  # role -> Counter
    from collections import Counter
    details = []
    for k, (rel, row) in enumerate(sample):
        pdf_path = os.path.join(CORP, rel)
        if not os.path.exists(pdf_path): continue
        try:
            doc = pdfium.PdfDocument(pdf_path)
            pil = doc[0].render(scale=DPI / 72.0).to_pil()
            doc.close()
        except Exception as e:
            print(f"  render fail {rel}: {e}"); continue
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tf: tmp = tf.name
        pil.save(tmp)
        pw = page_words(tmp)
        os.unlink(tmp)
        words = pw.get("words", [])
        for role, val, normfn in (("ref", row.get("ref"), norm_ref), ("date", row.get("date"), norm_date)):
            if not val: continue
            c = classify(find_runs(words, normfn(val), normfn))
            agg.setdefault(role, Counter())[c] += 1
            if c != "UNIQUE": details.append(f"  {c:8} {role:4} '{val}'  ({rel.split('/')[-1]}, {len(words)} words)")
        print(f"  [{k+1}/{len(sample)}] {rel.split('/')[-1]}  ({len(words)} words)")
    print("\n=== RESULT (per role) ===")
    for role, c in agg.items():
        tot = sum(c.values()); u = c.get("UNIQUE", 0)
        print(f"  {role}: UNIQUE {u}/{tot} ({100*u//max(tot,1)}%)  MULTIPLE {c.get('MULTIPLE',0)}  NONE {c.get('NONE',0)}")
    print("\n=== non-UNIQUE (the unsafe/ambiguous class) ===")
    for d in details[:60]: print(d)
    print(f"\ntotal non-UNIQUE: {len(details)}")

if __name__ == "__main__":
    main()
