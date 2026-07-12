"""Prefix-outlier guard (ocr_corrector.build_prefix_index/is_prefix_outlier + engine._flag_prefix_outlier).
A shape-valid single-glyph misread of a variable ref field's dominant code prefix (DN->IN / DN->YN)
passes every format gate and auto-files at 95%+ on IMPORT, poisoning learning. This guard flags it
(cap 69 + note, value untouched) once the scope's dominant prefix is armed. reggie-designed,
Oracle-signed 2026-07-12.

Run:  py -3.12 tests/test_prefix_outlier.py   (from python_backend/)
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from extraction import ocr_corrector as oc
from extraction.engine import ExtractionEngine

fails = 0
def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond: fails += 1

def scope(field_key, supplier, dtype, values):
    """One formats_data entry: values is {value: count}."""
    return {'field_key': field_key, 'supplier_name': supplier, 'document_type': dtype, 'value_counts': values}

# ── code_prefix extraction ──────────────────────────────────────────────────────
check("code_prefix DN-11354 -> DN", oc.code_prefix('DN-11354') == 'DN')
check("code_prefix INV-2044 -> INV", oc.code_prefix('INV-2044') == 'INV')
check("code_prefix WS830532 -> WS (no sep)", oc.code_prefix('WS830532') == 'WS')
check("code_prefix IN/26/0045 -> IN", oc.code_prefix('IN/26/0045') == 'IN')
check("code_prefix lowercases -> upper", oc.code_prefix('dn-9') == 'DN')
check("code_prefix pure numeric -> None", oc.code_prefix('1947063') is None)
check("code_prefix digit-leading serial -> None", oc.code_prefix('1102V03NL1') is None)
check("code_prefix single-letter prefix -> None", oc.code_prefix('A1234') is None)
check("code_prefix no digit (name-like) -> None", oc.code_prefix('ABCDEF') is None)

# ── build_prefix_index arming / disarming ───────────────────────────────────────
clean = oc.build_prefix_index([scope('reference_number', 'Cascade', 'delivery_docket',
                                      {f'DN-{n}': 1 for n in range(60000, 60013)})])   # 13 DN
rec = oc.lookup_prefix(clean, 'reference_number', 'Cascade', 'delivery_docket')
check("clean DN scope ARMS (dominant DN)", rec and rec['dominant'] == 'DN' and rec['known'] == {'DN'})
check("lookup is exact-scope (wrong supplier -> None)",
      oc.lookup_prefix(clean, 'reference_number', 'Other', 'delivery_docket') is None)

polluted = oc.build_prefix_index([scope('reference_number', 'Cascade', 'delivery_docket',
      {**{f'DN-{n}': 1 for n in range(13)}, **{f'IN-{n}': 1 for n in range(5)}, 'YN-1': 1})])  # 13/5/1 -> DN 0.68
check("polluted 0.68 DN scope DISARMS (no dominant >= 0.80)",
      oc.lookup_prefix(polluted, 'reference_number', 'Cascade', 'delivery_docket') is None)

mixed = oc.build_prefix_index([scope('reference_number', 'X', 'invoice',
      {**{f'DN-{n}': 1 for n in range(6)}, **{f'CN-{n}': 1 for n in range(5)}})])   # ~55/45
check("legit two-prefix scope DISARMS (no >=0.80)",
      oc.lookup_prefix(mixed, 'reference_number', 'X', 'invoice') is None)

numeric = oc.build_prefix_index([scope('reference_number', 'Y', 'invoice',
      {f'{n}': 1 for n in range(1000, 1010)})])   # pure-numeric
check("pure-numeric scope DISARMS", oc.lookup_prefix(numeric, 'reference_number', 'Y', 'invoice') is None)

thin = oc.build_prefix_index([scope('reference_number', 'Z', 'invoice', {'DN-1': 1, 'DN-2': 1})])  # only 2 < MIN_COUNT
check("below MIN_COUNT DISARMS", oc.lookup_prefix(thin, 'reference_number', 'Z', 'invoice') is None)

# ── is_prefix_outlier ───────────────────────────────────────────────────────────
check("DN->IN fires (Hamming-1)", oc.is_prefix_outlier('IN', rec) is True)
check("DN->YN fires (Hamming-1)", oc.is_prefix_outlier('YN', rec) is True)
check("DN (equals dominant) no-fire", oc.is_prefix_outlier('DN', rec) is False)
check("DN->XY (Hamming-2) no-fire", oc.is_prefix_outlier('XY', rec) is False)
check("length-change (INV vs DN) no-fire", oc.is_prefix_outlier('INV', rec) is False)
check("empty prefix no-fire", oc.is_prefix_outlier(None, rec) is False)

# ── self-heal (Q5): a legit-new sibling flags ONCE, then joins known ────────────
check("legit-new CN flags (not yet confirmed)", oc.is_prefix_outlier('CN', rec) is True)
healed = {'dominant': 'DN', 'known': {'DN', 'CN'}}                 # after one confirm CN in known
check("...then CN in known -> never flags (self-heal)", oc.is_prefix_outlier('CN', healed) is False)

# ── Oracle's count-1 immunization pin (deliberate trade vs the self-heal story) ──
# A prefix already in `known` does NOT flag EVEN AT count 1 — this is the poison-hole trade-off that
# gives the clean confirm-once-self-heals behaviour. A future dev must not "fix" it into a support
# floor (that would re-flag legit-new prefixes more than once). The scope that is poisoned ENOUGH to
# matter drops below 0.80 and disarms entirely; the residual remedy is a Learning-Recovery purge.
part_poison = {'dominant': 'DN', 'known': {'DN', 'IN'}}            # DN dominant but a stray IN confirmed
check("PIN: an already-known prefix does NOT flag (count-1 immunization is deliberate)",
      oc.is_prefix_outlier('IN', part_poison) is False)

# ── engine._flag_prefix_outlier — cap 69 + note, exemptions ─────────────────────
class _Stub:
    def __init__(self, idx): self.prefix_index = idx
    def log(self, *a): pass
IDX = {('cascade', 'delivery_docket', 'reference_number'): {'dominant': 'DN', 'known': {'DN'}}}
FD = [{'key': 'reference_number', 'type': 'alphanumeric'}, {'key': 'supplier_name', 'type': 'text'}]

def run_guard(results, supplier='Cascade', slug='delivery_docket', idx=IDX):
    ExtractionEngine._flag_prefix_outlier(_Stub(idx), results, FD, supplier, slug)
    return results

r = run_guard({'reference_number': {'value': 'IN-11354', 'confidence': 97, 'method': 'anchor_crop'}})
check("guard caps outlier conf to 69", r['reference_number']['confidence'] == 69)
check("guard sets a review note", bool(str(r['reference_number'].get('validation_note') or '').strip()))
check("guard leaves the VALUE untouched", r['reference_number']['value'] == 'IN-11354')

r = run_guard({'reference_number': {'value': 'DN-11354', 'confidence': 97, 'method': 'anchor_crop'}})
check("guard leaves a correct DN read alone", r['reference_number']['confidence'] == 97)

r = run_guard({'reference_number': {'value': 'IN-11354', 'confidence': 100, 'method': 'manual'}})
check("guard EXEMPTS manual method", r['reference_number']['confidence'] == 100)

r = run_guard({'reference_number': {'value': 'IN-11354', 'confidence': 95, 'method': 'keyword_override'}})
check("guard EXEMPTS *override method", r['reference_number']['confidence'] == 95)

# supplier_name is a name-like field -> excluded even if its value looks prefix-outlier-ish
r = run_guard({'supplier_name': {'value': 'IN-99', 'confidence': 90, 'method': 'anchor_crop'}},
              idx={('cascade', 'delivery_docket', 'supplier_name'): {'dominant': 'DN', 'known': {'DN'}}})
check("guard EXCLUDES name-like fields", r['supplier_name']['confidence'] == 90)

# kill switch
os.environ['PREFIX_OUTLIER_GUARD'] = '0'
r = run_guard({'reference_number': {'value': 'IN-11354', 'confidence': 97, 'method': 'anchor_crop'}})
check("kill switch PREFIX_OUTLIER_GUARD=0 disables", r['reference_number']['confidence'] == 97)
os.environ.pop('PREFIX_OUTLIER_GUARD', None)

print()
print(f"{fails} FAILED" if fails else "All prefix-outlier checks passed")
sys.exit(1 if fails else 0)
