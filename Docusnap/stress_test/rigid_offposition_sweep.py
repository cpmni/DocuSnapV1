"""READ-ONLY decision sweep for the RELOCATION-VETO COMPANION (Oracle's Slice-0 gate — twin of
crossfield_sweep / prefix_outlier_sweep). The primary veto (commit 3363206) stops a confident-wrong
RELOCATED value on a same-supplier anchor. The residual seam Oracle named: the `located_ok`
certification (anchor.py ~1059) is PRESENCE-ONLY for same-supplier, so a same-supplier AUTHORITATIVE
RIGID (anchor_crop) read whose true caption is skew-garbled but whose wrong-prefix caption is merely
PRESENT is still certified 'located' and NOT capped to 50 -> a confident-wrong RIGID read can slip the
88 floor + docTrustGate. The companion gate would extend `_located_at_taught_position` to same-supplier
authoritative anchors WITH an offset — but that flips a LARGE population trusted->capped, so build it
ONLY if this sweep finds the class LIVE. Zero hits -> documented DO-NOTHING (KO_wor_41 pattern); re-run
on the next sighting.

The class (DB proxy): a CONFIRMED doc whose stored extraction for a field is method='anchor_crop', at
or above the 88 critical floor, on a field whose scope carries a SAME-SUPPLIER AUTHORITATIVE anchor with
a non-zero label->value OFFSET — AND the read was WRONG (corrected_to set = the user caught it). The
auto-filed-but-uncaught variant is covered separately by realdoc_regression M (currently 0).

Run:  py -3.12 stress_test/rigid_offposition_sweep.py   (repo root OR python_backend/ — auto-locates)
"""
import os, sqlite3

CRITICAL_FLOOR = 88   # trust.js critical_field_conf_floor — a read below this can't auto-file anyway

db = os.path.join(os.environ['APPDATA'], 'Roaming', 'ScanFinder', 'docusnap.db')
if not os.path.exists(db):
    db = os.path.join(os.environ['APPDATA'], 'ScanFinder', 'docusnap.db')
con = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
c = con.cursor()

def norm(s): return (s or '').strip().lower()

# ── Eligible anchors: SAME-SUPPLIER AUTHORITATIVE with a usable (non-zero) offset — the population the
#    companion gate would flip trusted->position-checked. field_anchors.document_type stores the SLUG.
eligible = set()
for s, dt, fk in c.execute("""
    SELECT supplier_name, document_type, field_key FROM field_anchors
    WHERE last_authoritative_at IS NOT NULL AND TRIM(last_authoritative_at) <> ''
      AND offset_dx_norm IS NOT NULL AND offset_dy_norm IS NOT NULL
      AND (offset_dx_norm <> 0 OR offset_dy_norm <> 0)"""):
    eligible.add((norm(s), norm(dt), fk))

# ── Confident RIGID anchor_crop reads on CONFIRMED docs, scoped to those anchors ──
rows = c.execute("""
    SELECT d.id, d.supplier_name, dt.slug, e.field_key, e.confidence, e.corrected_to,
           COALESCE(e.display_value, e.raw_value), d.original_filename
    FROM documents d
    JOIN document_types dt ON dt.id = d.document_type_id
    JOIN extractions e ON e.document_id = d.id
    WHERE d.status = 'confirmed' AND e.extraction_method = 'anchor_crop'
      AND e.confidence IS NOT NULL""").fetchall()
con.close()

in_scope, confident, wrong = [], [], []
for did, sup, slug, fk, conf, corr, val, fname in rows:
    if (norm(sup), norm(slug), fk) not in eligible:
        continue
    in_scope.append((did, sup, slug, fk, conf))
    if conf >= CRITICAL_FLOOR:
        confident.append((did, sup, slug, fk, conf, corr, val, fname))
        if corr is not None and str(corr).strip():        # the confident rigid read was WRONG (corrected)
            wrong.append((did, sup, slug, fk, conf, val, corr, fname))

print(f"eligible anchor scopes (same-supplier authoritative + non-zero offset): {len(eligible)}")
print(f"anchor_crop reads on confirmed docs in those scopes:                    {len(in_scope)}")
print(f"  ...of which CONFIDENT (conf >= {CRITICAL_FLOOR}, would-auto-file eligible):        {len(confident)}")
print(f"  ...of which CONFIDENT-WRONG (corrected -> the class the gate would cap): {len(wrong)}\n")

for did, sup, slug, fk, conf, val, corr, fname in wrong:
    print(f"  HIT doc#{did} [{sup} / {slug} / {fk}] conf={conf} read={val!r} -> corrected={corr!r}  ({fname})")

print()
if wrong:
    print(f"** {len(wrong)} live case(s) -> the class EXISTS. BUILD the located_ok-on-offset gate + its own")
    print("   corpus A/B (over-hold cost of capping same-supplier authoritative rigid reads to 50).")
else:
    print("** 0 live cases -> DO-NOTHING (documented). The companion gate stays a READY design; the")
    print("   confident-wrong RIGID class is not present in the live corpus (realdoc M=0 covers the")
    print("   auto-filed-uncaught variant). Re-run this sweep on the next sighting before building.")
