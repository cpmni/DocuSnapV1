"""format_join_census.py — the FORMAT_CLASS_JOIN flip gate (gary → Oracle SIGN-OFF-W/COND 2026-09-04).

Run over the SAME formats payload the engine receives (dump learning.getFieldFormats({includeProvisional:true})
to JSON via electron-as-node, from a db.backup() COPY — never a file copy), for the live DB AND the corpus DB:

    py -3.12 python_backend/tools/format_join_census.py formats.json

Per non-name solid scope: today's class vs the joined class, N / thr / the folded-shape histogram, and the
HARD lines Oracle requires:
  (a) 0 confirmed values fail the joined charset INCLUDING separators (C2);
  (b) 0 name-like scopes join and 0 scopes with any whitespace-bearing value in the distinct set join (C1);
  (c) 0 ('', doctype, field) groups join (C8);
  (d) every scope gaining an entry, annotated with the arcs it un-blocks (all of them read value_counts);
  (e) per joining scope, the count of confirmed values whose RAW shape_signature is NOT in a >=3-doc family
      (the C6 consent-coverage number — the honest reward estimate: only literals + covered shapes consent).
Exit 1 on any HARD-line violation. Pure read of the payload; touches no DB.
"""
import json, math, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
os.environ.setdefault('FORMAT_CLASS_JOIN', '1')
from extraction import format_anomaly_checker as fac
from extraction import value_quality as vq

ARCS = 'FORMAT_VARIANCE_RELAX_REF · _REF_INLINE · FILING_SANITY_REF_CORROB_SOFTEN · FILING_SANITY_REF_HISTORY_SOFTEN · RESOLVE_REF_NEAR_MISS · CONFUSION_PRECEDENCE · _has_no_usual_format · mapper consent (joined tier)'

def main(path):
    data = json.load(open(path, encoding='utf-8'))
    solid = [e for e in data if not e.get('provisional')]
    hard = []
    gained = []
    for g in solid:
        fk = g.get('field_key') or ''
        sup = (g.get('supplier_name') or '').strip()
        samples = g.get('sample_values') or []
        vc = g.get('value_counts') or {}
        distinct = {str(k).strip() for k in vc if k} | {str(s).strip() for s in samples if s}
        if len(distinct) < 3:
            continue
        today = fac.classify_format(samples, vc or None).get('class')
        joined = fac.join_format_entry(sup, fk, samples, vc) if today == fac.FREETEXT else None
        if not joined:
            continue
        tag = f"{sup or chr(39)*2}|{g.get('document_type')}|{fk}"
        if vq.is_name_like_field(fk):
            hard.append(f"(b) name-like scope joined: {tag}")
        if any(any(ch.isspace() for ch in v) for v in distinct):
            hard.append(f"(b) whitespace-bearing value joined: {tag}")
        if not sup:
            hard.append(f"(c) '' twin joined: {tag}")
        bad = [v for v in vc if fac._disallowed_chars(str(v), joined['class'], joined.get('separators', frozenset()))]
        if bad:
            hard.append(f"(a) confirmed values fail the joined charset: {tag} {bad}")
        N = sum(int(n or 0) for n in vc.values())
        thr = max(fac._SHAPE_ACCEPT_MIN, math.ceil(fac._SHAPE_ACCEPT_RATIO * N))
        hist = {}
        for v, n in vc.items():
            s = fac._fold_shape(fac.shape_signature(str(v)))
            hist[s] = hist.get(s, 0) + int(n or 0)
        fams = fac.shape_families(vc)
        covered = set()
        for f in fams:
            if int(f.get('count') or 0) >= fac._SHAPE_ACCEPT_MIN:
                covered.add(f.get('shape')); covered.update(f.get('variants') or [])
        uncovered = [v for v in vc if fac.shape_signature(str(v)) not in covered]
        gained.append(tag)
        print(f"\n{tag}: today={today} -> joined={joined['class']} seps={sorted(joined.get('separators', ()))} N={N} thr={thr} distinct={len(distinct)}")
        print(f"   folded histogram: {dict(sorted(hist.items(), key=lambda kv: -kv[1]))}")
        print(f"   (e) confirmed values NOT covered by a >={fac._SHAPE_ACCEPT_MIN}-doc length-aware family: {len(uncovered)}/{len(vc)} {uncovered}")
        print(f"   (d) un-blocks: {ARCS}")
    print(f"\nscopes gaining an entry: {len(gained)}")
    if hard:
        print("HARD-LINE VIOLATIONS:")
        for h in hard: print("  ", h)
        return 1
    print("HARD lines (a)(b)(c): clean")
    return 0

if __name__ == '__main__':
    sys.exit(main(sys.argv[1]))
