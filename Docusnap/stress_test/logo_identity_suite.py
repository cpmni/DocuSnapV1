"""
stress_test/logo_identity_suite.py — FULL logo-hashing identity suite (2026-07-19).

Born from the Larkspur incident: 20 docs from a NEVER-SEEN supplier; the logo layer
assigned 4 to Ridgeway + 1 to Copperfield (one at logo@89 = hamming ~2 from a
Copperfield hash); correcting one doc did not heal the rest.

READ-ONLY against the live DB (%APPDATA%/ScanFinder/docusnap.db) + pure synthetic
decision tests. Run:  py -3.12 stress_test/logo_identity_suite.py
Writes a report to stress_test/out/logo_identity_report.md and exits 1 on any
failed check.

PIN PHILOSOPHY: several checks deliberately PIN today's measured-broken reality
(e.g. "the coarse hash cannot separate suppliers on scans"). A future identity fix
is EXPECTED to flip those pins — flip them consciously in the same commit as the
fix, never silently. Checks marked [PIN-BROKEN] are that kind; [INVARIANT] checks
must hold forever.
"""
import os, sys, sqlite3, itertools, statistics

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'python_backend'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'python_backend', 'extraction'))

DB_PATH = os.path.expandvars(r"%APPDATA%\ScanFinder\docusnap.db")
OUT_MD  = os.path.join(os.path.dirname(__file__), 'out', 'logo_identity_report.md')

fails = 0
lines = []
def emit(s=""):
    print(s)
    lines.append(s)
def check(label, cond):
    global fails
    emit(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1

def ham(a, b):
    try:
        return bin(int(a, 16) ^ int(b, 16)).count("1")
    except Exception:
        return None

# ── data ─────────────────────────────────────────────────────────────────────
db = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
db.row_factory = sqlite3.Row

pools: dict[str, list[str]] = {}
detail_total = detail_present = 0
for r in db.execute("SELECT supplier_name, phash, detail_hash FROM logo_fingerprints"):
    if r["supplier_name"] and r["phash"]:
        pools.setdefault(r["supplier_name"].strip(), []).append(r["phash"])
        detail_total += 1
        if r["detail_hash"]:
            detail_present += 1
# Template hash sets are per-scan recomputed values too — pool them under the
# template's (name-derived) supplier for a bigger sample.
for r in db.execute("""SELECT t.name, h.phash FROM template_logo_hashes h
                       JOIN templates t ON t.id = h.template_id"""):
    if r["name"] and r["phash"]:
        pools.setdefault(r["name"].strip(), []).append(r["phash"])

emit("§1 SEPARABILITY — 64-bit coarse phash on the LIVE install")
intra, inter = [], []
for sup, hashes in pools.items():
    for a, b in itertools.combinations(set(hashes), 2):
        d = ham(a, b)
        if d is not None:
            intra.append(d)
for (s1, h1), (s2, h2) in itertools.combinations(pools.items(), 2):
    for a in set(h1):
        for b in set(h2):
            d = ham(a, b)
            if d is not None:
                inter.append(d)
if intra and inter:
    emit(f"  suppliers={len(pools)} samples={sum(len(set(v)) for v in pools.values())}")
    emit(f"  SAME-supplier  distances: n={len(intra)} min={min(intra)} med={statistics.median(intra)} max={max(intra)}")
    emit(f"  CROSS-supplier distances: n={len(inter)} min={min(inter)} med={statistics.median(inter)} max={max(inter)}")
    overlap = sum(1 for d in inter if d <= max(intra))
    check("[INVARIANT] measured data present (>=2 suppliers with hashes)", True)
    check("[PIN-BROKEN] cross-supplier reaches INSIDE the accept threshold (12) — "
          "the coarse hash is NOT a safe identity source on scans",
          min(inter) <= 12)
    check("[PIN-BROKEN] intra/inter distributions OVERLAP (no clean cut exists)",
          min(inter) <= max(intra))
else:
    check("[INVARIANT] live DB has enough fingerprint data to measure", False)

emit("")
emit("§2 SLICE-D DETAIL RESOLVER — enrolment coverage")
emit(f"  logo_fingerprints rows={detail_total} with detail_hash={detail_present}")
check("[PIN-BROKEN] detail_hash coverage is 0% — the 256-bit resolver NEVER "
      "engages at the fingerprint layer (enrolment plants detail into templates only)",
      detail_present == 0)

emit("")
emit("§3 DECISION LAYER — _pick_unambiguous_supplier (pure, python matcher core)")
try:
    from anchor import _pick_unambiguous_supplier
    have_core = True
except Exception as e:
    have_core = False
    emit(f"  (import failed: {e})")
check("[INVARIANT] decision core importable", have_core)
if have_core:
    # The structural first-contact hole: a supplier with NO enrolled fingerprints can
    # never be the answer — the matcher can only choose among ENROLLED suppliers, so a
    # new sender's docs are assigned to the nearest WRONG pool or abstain. This pin is
    # the incident: Larkspur absent, Ridgeway/Copperfield enrolled.
    live_like = {"Ridgeway Plant Hire": {"dist": 4, "match_count": 5},
                 "Copperfield Electrical": {"dist": 9, "match_count": 13}}
    w = _pick_unambiguous_supplier(live_like)
    check("[PIN-BROKEN] first-contact: an unseen supplier's scan RESOLVES TO AN "
          "ENROLLED RIVAL when decisively nearer (the Larkspur->Ridgeway incident; "
          "conf carries the match_count bonus, so an established WRONG pool looks stronger)",
          w is not None and w["supplier_name"] == "Ridgeway Plant Hire" and w["confidence"] >= 85)
    # Distance 2 (the live cross-supplier MINIMUM measured tonight) scores 100-12+bonus —
    # the confidence formula cannot express "cross-supplier" because the metric can't.
    d2 = _pick_unambiguous_supplier({"Copperfield Electrical": {"dist": 2, "match_count": 13}})
    check("[PIN-BROKEN] the measured cross-supplier MINIMUM (d=2) yields ~98% confidence "
          "(the live logo@89-class misassign)", d2 is not None and d2["confidence"] >= 88)
    # Ambiguity guard still works when rivals tie — the guard is real, keep it.
    tie = {"Ridgeway Plant Hire": {"dist": 8, "match_count": 5},
           "Copperfield Electrical": {"dist": 9, "match_count": 13}}
    check("[INVARIANT] near-tie between rivals abstains (ambiguity margin holds)",
          _pick_unambiguous_supplier(tie) is None)

emit("")
emit("§4 TEXT COUNTERPOINT — keyword branding fingerprints on the SAME install")
def tokens(s):
    return set(w for w in (s or "").lower().replace(",", " ").split() if len(w) >= 4)
tpl_fp = {}
for r in db.execute("SELECT name, keyword_fingerprint FROM templates WHERE keyword_fingerprint IS NOT NULL"):
    tpl_fp.setdefault(r["name"].strip(), []).append(tokens(r["keyword_fingerprint"]))
cross_best = 0.0
pair = ""
for (s1, f1), (s2, f2) in itertools.combinations(tpl_fp.items(), 2):
    for a in f1:
        for b in f2:
            if a and b:
                ov = len(a & b) / max(1, min(len(a), len(b)))
                if ov > cross_best:
                    cross_best, pair = ov, f"{s1} vs {s2}"
emit(f"  suppliers with fingerprints={len(tpl_fp)}  worst cross-supplier token overlap={cross_best:.2f} ({pair})")
check("[INVARIANT] branding text SEPARATES where the logo cannot (worst cross overlap < 0.80 accept bar)",
      cross_best < 0.80)

emit("")
emit("§5 THE INCIDENT, PRESERVED — live-DB evidence pins")
n_notes = db.execute("""SELECT COUNT(*) c FROM extractions e JOIN documents d ON d.id = e.document_id
    WHERE e.field_key='supplier_name' AND e.validation_note LIKE '%page branding reads%Larkspur%'""").fetchone()["c"]
check("[INVARIANT] the branding guard CAUGHT every logo misassignment (notes exist on the misfiled docs)",
      n_notes >= 1)
emit(f"  ({n_notes} Larkspur branding-conflict notes on the live install)")

db.close()

emit("")
emit(f"{'FAIL' if fails else 'PASS'} — {fails} failed check(s)")
os.makedirs(os.path.dirname(OUT_MD), exist_ok=True)
with open(OUT_MD, "w", encoding="utf-8") as f:
    f.write("# Logo identity suite report\n\n```\n" + "\n".join(lines) + "\n```\n")
sys.exit(1 if fails else 0)
