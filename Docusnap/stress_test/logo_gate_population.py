"""
stress_test/logo_gate_population.py — Oracle C8 readout for the text-agreement gate.

The corpus A/B can come back byte-identical for TWO very different reasons: the gate agreed with
every logo read (good), or the gate never fired at all (no evidence either way). This probe answers
which, by replaying the PURE decision over every live doc whose supplier was resolved BY LOGO,
using that doc's own stored ocr_text and the install's template branding banks.

Reports: branch populations (accept / suggest / abstain) + ABSTAIN PRECISION — for each abstain,
whether the suppressed logo name matched the doc's human-confirmed supplier. Any abstain that
would have suppressed a CORRECT identity is the number that sends the design back (Oracle C8).

READ-ONLY.  py -3.12 stress_test/logo_gate_population.py
"""
import os, sys, sqlite3, json, collections

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'python_backend'))
from extraction.engine import decide_logo_text_gate, _branding_banks, _identity_text_sufficient  # noqa: E402

DB = os.path.expandvars(r"%APPDATA%\ScanFinder\docusnap.db")
NORM = lambda v: " ".join(str(v or "").strip().lower().split())  # noqa: E731

db = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
db.row_factory = sqlite3.Row

# Branding banks exactly as the engine builds them (templates carry keyword_fingerprint JSON; the
# engine keys on dominant_supplier which the JS layer derives from confirmed docs — approximate it
# here with the template NAME, which is what dominant_supplier falls back to).
templates = []
for t in db.execute("SELECT name, keyword_fingerprint FROM templates WHERE keyword_fingerprint IS NOT NULL"):
    try:
        kf = json.loads(t["keyword_fingerprint"]) or []
    except Exception:
        kf = []
    if kf:
        templates.append({"name": t["name"], "dominant_supplier": t["name"], "keyword_fingerprint": kf})
banks = _branding_banks(templates, NORM)

rows = db.execute("""
    SELECT d.id, d.status, d.supplier_name AS filed, d.ocr_text,
           e.display_value AS logo_value, e.confidence, e.extraction_method AS method
    FROM documents d JOIN extractions e ON e.document_id = d.id
    WHERE e.field_key = 'supplier_name' AND e.extraction_method = 'logo'
      AND d.ocr_text IS NOT NULL AND length(d.ocr_text) > 0
    ORDER BY d.id""").fetchall()

tally = collections.Counter()
abstains, suggests, wrong_abstains = [], [], []
for r in rows:
    verdict = decide_logo_text_gate(r["logo_value"], banks, r["ocr_text"], NORM)
    tally[verdict] += 1
    if verdict == 'abstain':
        # PRECISION, honestly scoped: only a CONFIRMED doc carries a human-verified supplier.
        # On a needs_review doc `documents.supplier_name` is the pipeline's OWN (here: the logo's)
        # guess, so "agrees with the logo" is a tautology there and proves nothing either way.
        agrees = bool(r["filed"]) and NORM(r["filed"]) == NORM(r["logo_value"])
        human_verified = r["status"] == 'confirmed'
        abstains.append((r["id"], r["logo_value"], r["filed"], r["status"],
                         'YES' if (agrees and human_verified) else ('n/a — not human-confirmed'
                                                                   if not human_verified else 'no')))
        if agrees and human_verified:
            wrong_abstains.append((r["id"], r["logo_value"]))
    elif verdict == 'suggest':
        suggests.append((r["id"], r["logo_value"], _identity_text_sufficient(r["ocr_text"])))

print(f"docs whose supplier was resolved BY LOGO: {len(rows)}  (templates with banks: {len(banks)})")
print(f"  accept  (text corroborates)      : {tally['accept']}")
print(f"  suggest (unjudgeable/text-poor)  : {tally['suggest']}")
print(f"  abstain (text contradicts)       : {tally['abstain']}")

if abstains:
    print("\nABSTAINS (id, logo said, doc's current supplier, status, logo-confirmed-correct?):")
    for a in abstains:
        print(f"  #{a[0]:<5} {str(a[1])[:24]:<25} now={str(a[2])[:24]:<25} {a[3]:<13} {a[4]}")
if suggests:
    print("\nSUGGESTS (id, logo said, text-sufficient):")
    for s in suggests[:20]:
        print(f"  #{s[0]:<5} {str(s[1])[:24]:<25} text_sufficient={s[2]}")

print(f"\nABSTAIN PRECISION — abstains that suppressed a CONFIRMED-CORRECT identity: {len(wrong_abstains)}")
for w in wrong_abstains:
    print(f"  !! #{w[0]} {w[1]}")
print("(Oracle C8: any non-zero here means tighten the C2 floor before merge.)")
db.close()
sys.exit(1 if wrong_abstains else 0)
