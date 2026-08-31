"""test_name_unclip_reconcile.py — NAME-UNCLIP reconcile pins
(reggie design → Oracle SIGN-OFF-W/COND 2026-08-04, docs/oracle_log.md).

Run: py -3.12 python_backend/tests/test_name_unclip_reconcile.py

WHAT THIS PINS. A Stage-0.5 free-text mapping whose drawn box CUTS a name mid-token
('Kingfisher Print Stuc' — the sliced 'd' misreads as 'c') committed @90 and silently beat two
agreeing independent fuller reads. The post-merge heal adopts the fuller value ONLY under:
C0 scope · C1 keyword+crop token-IDENTICAL witnesses (mapping family excluded) · C2 the cut
fingerprint incl. Oracle's ONE edge-glyph substitution AT the cut · C3 winner remnant
page-ABSENT (the genuine-shorter-name guard) · C4 adopt page-present · C5 quality no worse.

THE ANTI-LOOSEN CONTRACT:
  • 'Studio'.startswith('Stuc') is FALSE — the cut-glyph rule (one edge substitution, >=3 clean
    prefix chars, fuller witness) is what heals the flagship exhibit. Do not "simplify" back to
    strict startswith (fails the exhibit) NOR widen beyond one edge glyph (admits real-name pairs).
  • Whole-token-missing ('Kingfisher Print' vs '... Studio') NEVER heals — no cut fingerprint;
    that is the plausible-genuine-trading-name shape.
  • A 4.5 wordness/repair note STARVES the heal (one voice per field; the flag is the fail-safe
    on lexicon-rich scopes — engine.py's Stage-4.5 name lane runs FIRST; do not reorder).
  • supplier_name excluded (identity lane). OFF = byte-identical.
"""
import os, sys, inspect
try: sys.stdout.reconfigure(encoding='utf-8')
except Exception: pass
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(_HERE, '..')))
os.environ['NAME_UNCLIP_RECONCILE'] = '1'
from extraction import engine as E                                 # noqa: E402

fails = 0
def check(label, cond):
    global fails
    print(('OK  ' if cond else 'BAD ') + label)
    if not cond:
        fails += 1

FD = [{'key': 'customer_name', 'type': 'text'},
      {'key': 'supplier_name', 'type': 'text'}]
PAGE = ("Northgate Textiles\nDELIVERY DOCKET\nDeliver To\n"
        "Kingfisher Print Studio\nWharf Studios, Canal Street\nNottingham NG1 7EH\n")

def cand(v, stage, method, conf=80):
    return {'value': v, 'stage': stage, 'method': method, 'confidence': conf}
def kw(v, conf=78):  return cand(v, '1_keyword', 'keyword_override', conf)
def cr(v, conf=82):  return cand(v, '2_anchor', 'anchor_crop_relocated', conf)
def mp(v, conf=90):  return cand(v, '0.5_mapping', 'template_mapping', conf)
def hint(v):         return cand(v, '2.5_hint', 'hint', 70)

def run(winner, cands, page=PAGE, key='customer_name'):
    e = E.ExtractionEngine.__new__(E.ExtractionEngine)
    e._field_candidates = {key: cands}
    e.log = lambda *a, **k: None
    e._t = lambda *a, **k: None
    results = {key: dict(winner)}
    e._reconcile_name_truncation(results, FD, page)
    return results[key]

W = {'value': 'Kingfisher Print Stuc', 'method': 'template_mapping', 'confidence': 90}
FULL = 'Kingfisher Print Studio'

print("The flagship exhibit (cut-glyph rule — Oracle condition 1):")
r = run(W, [kw(FULL), cr(FULL)])
check("'Kingfisher Print Stuc' heals to the fuller value", r['value'] == FULL)
check("...method + confidence KEPT (suffix-reconcile mold)",
      r['method'] == 'template_mapping' and r['confidence'] == 90)
check("...marker set, no note added",
      r.get('name_unclip_reconciled') is True and not r.get('validation_note'))
r = run({'value': 'Kingfisher Print Stud', 'method': 'template_mapping', 'confidence': 90},
        [kw(FULL), cr(FULL)])
check("clean-prefix cut 'Stud' also heals", r['value'] == FULL)

print("\nRefusals (each leaves the winner byte-identical):")
check("whole-token-missing 'Kingfisher Print' NEVER heals (no cut fingerprint)",
      run({'value': 'Kingfisher Print', 'method': 'template_mapping', 'confidence': 90},
          [kw(FULL), cr(FULL)])['value'] == 'Kingfisher Print')
check("'Stump' vs 'Studio' refused (more than one edge glyph)",
      run({'value': 'Kingfisher Print Stump', 'method': 'template_mapping', 'confidence': 90},
          [kw(FULL), cr(FULL)])['value'] == 'Kingfisher Print Stump')
check("remnant < 4 ('Stu') refused",
      run({'value': 'Kingfisher Print Stu', 'method': 'template_mapping', 'confidence': 90},
          [kw(FULL), cr(FULL)])['value'] == 'Kingfisher Print Stu')
check("digit completion refused ('Unit 4' vs 'Unit 42B' class)",
      run({'value': 'Warehouse Unit4', 'method': 'template_mapping', 'confidence': 90},
          [kw('Warehouse Unit42B'), cr('Warehouse Unit42B')],
          page='Warehouse Unit42B\n')['value'] == 'Warehouse Unit4')
check("keyword+keyword (no crop family) refused",
      run(W, [kw(FULL), kw(FULL, 79)])['value'] == W['value'])
check("hint-backed witness refused (not a page read)",
      run(W, [kw(FULL), hint(FULL)])['value'] == W['value'])
check("mapping-FAMILY witness refused (Oracle cond. 3)",
      run(W, [mp(FULL), cr(FULL)])['value'] == W['value'])
check("witnesses DISAGREEING with each other refused",
      run(W, [kw(FULL), cr('Kingfisher Print Works')])['value'] == W['value'])
check("C3 page-defended genuine short name refused ('Acme Corp' printed)",
      run({'value': 'Acme Corp', 'method': 'template_mapping', 'confidence': 90},
          [kw('Acme Corporation'), cr('Acme Corporation')],
          page='Acme Corp\nAcme Corporation House\n')['value'] == 'Acme Corp')
check("Northgate/Northdale can never merge (prefix relation fails)",
      run({'value': 'Northgate Textiles', 'method': 'template_mapping', 'confidence': 90},
          [kw('Northdale Textiles'), cr('Northdale Textiles')],
          page='Northdale Textiles\n')['value'] == 'Northgate Textiles')
check("4.5 note STARVES the heal (lexicon-rich scope fail-safe — pinned, do not reorder)",
      run({**W, 'validation_note': 'looks shorter than the usual name — please verify'},
          [kw(FULL), cr(FULL)])['value'] == W['value'])
check("was_corrected winner untouched",
      run({**W, 'was_corrected': True}, [kw(FULL), cr(FULL)])['value'] == W['value'])
check("supplier_name EXCLUDED (identity lane)",
      run(W, [kw(FULL), cr(FULL)], key='supplier_name')['value'] == W['value'])
check("non-Stage-0.5 winner (anchor_crop) untouched",
      run({'value': 'Kingfisher Print Stuc', 'method': 'anchor_crop', 'confidence': 85},
          [kw(FULL), cr(FULL)])['value'] == 'Kingfisher Print Stuc')
check("adopt NOT page-present refused",
      run(W, [kw('Kingfisher Print Studioz'), cr('Kingfisher Print Studioz')])['value'] == W['value'])

print("\nSwitch + order:")
_s = E.NAME_UNCLIP_RECONCILE
try:
    E.NAME_UNCLIP_RECONCILE = False
    check("OFF -> byte-identical", run(W, [kw(FULL), cr(FULL)])['value'] == W['value'])
finally:
    E.NAME_UNCLIP_RECONCILE = _s
src = inspect.getsource(E.ExtractionEngine.extract)
i_suf = src.find('_reconcile_clipped_suffix(results')
i_nu  = src.find('_reconcile_name_truncation(results')
i_sc  = src.find('_reconcile_blind_geometry(results')
i_uv  = src.find('_universal_postmerge_verify(')
check("ORDER: after suffix-reconcile, before S-C chain and the universal verify",
      0 < i_suf < i_nu < i_sc and i_nu < i_uv)
check("carve-out documented at _override_eligible",
      '_reconcile_name_truncation' in inspect.getsource(E.ExtractionEngine._override_eligible))

print(f"\n{'ALL PASS' if fails == 0 else str(fails) + ' FAILURES'}")
sys.exit(1 if fails else 0)
