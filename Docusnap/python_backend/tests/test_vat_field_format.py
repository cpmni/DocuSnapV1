"""test_vat_field_format.py — the VAT number is a FORMAT, not a length check.

Run: py -3.12 python_backend/tests/test_vat_field_format.py

WHAT WAS WRONG. `vat_no` had no shipped `field_patterns` entry, so `keyword.seed_field_labels`
seeded it from its DB label with validation `alphanumeric` — `[A-Za-z0-9][A-Za-z0-9\\-\\/\\.]{2,20}`.
That is a length check, not a gate: it full-matches 'VAT', '3PL', '1RE' and every OCR garble at
coverage 1.0. Measured on 145 unseen siblings, `vat_no` scored 92 ok / 48 wrong, and the 48 were:
21 x 'VAT' (a template's frozen fixed_value is the printed CAPTION), 13 x '3PL', 6 x '1RE', and 8
garbles like 'comsssie42' / 'ee05351042' / '68903931842'.

WHAT THESE PINS DEFEND
  * Every truth value in the corpus still passes. A gate that rejects correct values is worse than
    no gate: the measured cost of over-refusing this field is 35 points on the lane (2026-08-08,
    when unfreezing it moved vat_no 51% -> 16%).
  * Every measured wrong value is refused. Listed individually, because "the pattern is stricter"
    is a claim and this is the evidence.
  * SUBSUMPTION (the seam): `val_type='vat_gb'` disarms STAGE05_REF_CODE_GATE and REF_ROLE_DIGIT_GATE
    for this field — both gate on `val_type == 'alphanumeric'`. Nothing is lost only because every
    value this pattern accepts would also have passed those gates. That is asserted as a property,
    not assumed, so a future loosening of the VAT pattern fails here with the reason attached.
  * The two VAT fields stay separate: `vat_tax` (the AMOUNT) owns the bare captions 'VAT', 'Tax',
    'VAT Amount'; `vat_no` (the NUMBER) owns only captions that also carry a registration word. One
    printed caption filling two fields is a defect this codebase has a whole flag for.
  * PARITY: the renderer compiles these same patterns with the 'i' flag and Python uses
    re.IGNORECASE, so the two must agree on every string here. The pattern deliberately does NOT
    lean on case — a lowercase 'gb 903 3318 42' is a correct number read by a tired scanner, while
    'ee05351042' is refused on STRUCTURE (Estonia is 9 digits, this is 8), which works in both
    engines and in either case.
"""
import json
import os
import re
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(_HERE, '..')))

CFG = json.load(open(os.path.join(_HERE, '..', '..', 'config', 'keyword_patterns.json'),
                    encoding='utf-8'))
VAT = CFG['validation_patterns']['vat_gb']

# Corpus ground truth — every issuer's real VAT number.
TRUTHS = [
    'GB 903 3318 42', 'GB 774 2093 55', 'GB 651 0027 84', 'GB 118 5540 63',
    'GB 821 4458 39', 'GB 442 7719 06', 'GB 335 9902 78',
    # forms a real UK document prints that the corpus happens not to contain
    'GB903331842', 'GB 903 3318 42 001', '903 3318 42', 'GBGD001', 'GB HA599',
    'gb 903 3318 42',                      # a lowercase read of a CORRECT number must still pass
]

# Every distinct wrong value measured on the corpus, plus the five seen in the live database.
WRONGS = [
    'VAT', '3PL', '1RE', '68903931842', '68903331842', 'comsssiea2', 'comsssie42',
    'cousssie42', 'ee05351042', 'ee0s351042', 'ceens351042',
    'TRE', 'Parts', 'NVU', 'Eee', 'canes.',
    # shapes the gate must also refuse
    'GB 903 3318 4',                       # clipped: 8 digits
    'GB 903 331 842',                      # wrong grouping
    'VAT Reg No GB 903 3318 42',           # label bleed - strip upstream, never admit here
    '903331842001234',                     # 15 digits
]

CASES = []
def case(fn):
    CASES.append(fn)
    return fn


def matches(v):
    return any(re.search(p, v, re.IGNORECASE) for p in VAT)


@case
def test_every_truth_value_passes():
    bad = [v for v in TRUTHS if not matches(v)]
    assert not bad, f'the gate refuses CORRECT values: {bad}'


@case
def test_every_measured_wrong_value_is_refused():
    bad = [v for v in WRONGS if matches(v)]
    assert not bad, f'the gate still admits: {bad}'


@case
def test_patterns_are_whole_value_anchored():
    """Unanchored is how 'alphanumeric' let a sub-run of a garble score coverage 1.0. Anchoring
    makes coverage binary, which is the entire mechanism by which the 27 read-side failures die."""
    for p in VAT:
        assert p.startswith('^') and p.endswith('$'), f'not whole-value anchored: {p}'


@case
def test_subsumption_nothing_is_lost_by_leaving_the_ref_role_gates():
    """THE SEAM. Setting validation to `vat_gb` takes this field OUT of the two ref-role digit
    gates, both of which arm on `val_type == 'alphanumeric'`. That is safe only because every value
    this pattern accepts also satisfies what those gates required: at least one digit
    (`ref_value_is_codeless`) and two digits separated by non-space (the Stage-1 form)."""
    from extraction.keyword import ref_value_is_codeless
    for v in TRUTHS:
        assert not ref_value_is_codeless(v), f'{v!r} would have failed the codeless gate'
        assert re.search(r'\d\S*\d', v), f'{v!r} would have failed the Stage-1 two-digit form'


@case
def test_vat_no_is_a_shipped_field_with_its_own_labels():
    fp = CFG['field_patterns']
    assert 'vat_no' in fp, 'vat_no must be a shipped field, not seeded from its DB label'
    e = fp['vat_no']
    assert e['validation'] == 'vat_gb', e
    assert e['base_confidence'] < 88, \
        'a clean read gets +5 for a right-read; base must keep it under the 88 auto-file floor'
    assert e.get('role_caption') == 'ref', \
        "role_caption 'ref' strips the caption tail and arms the party guard (Customer VAT No)"


@case
def test_the_number_and_the_amount_do_not_share_a_caption():
    """`vat_tax` is the AMOUNT and owns the bare 'VAT'/'Tax' captions. Every `vat_no` label must
    carry a registration word as well, or one printed caption fills two fields."""
    fp = CFG['field_patterns']
    amount = {str(l).strip().lower() for l in fp['vat_tax']['labels']}
    for l in fp['vat_no']['labels']:
        low = str(l).strip().lower()
        assert low not in amount, f'{l!r} is already owned by vat_tax (the amount)'
        assert re.search(r'reg|number|no\b|id', low), \
            f'{l!r} carries no registration word — it would collide with the amount field'


@case
def test_javascript_and_python_agree():
    """The renderer compiles these with `new RegExp(p, 'i')` and validates on blur; Python uses
    re.IGNORECASE. A value the backend refuses but the UI accepts is a user typing a value the app
    silently rejects later — so both engines must agree on every string in this file."""
    import subprocess
    node = os.path.join(os.path.abspath(os.path.join(_HERE, '..', '..')),
                        'node_modules', 'electron', 'dist', 'electron.exe')
    script = (
        "const pats=%s.map(p=>new RegExp(p,'i'));"
        "const t=%s, w=%s;"
        "const bad=[...t.filter(v=>!pats.some(r=>r.test(v))).map(v=>'MISS:'+v),"
        "...w.filter(v=>pats.some(r=>r.test(v))).map(v=>'ADMIT:'+v)];"
        "console.log(JSON.stringify(bad));"
        % (json.dumps(VAT), json.dumps(TRUTHS), json.dumps(WRONGS)))
    env = dict(os.environ, ELECTRON_RUN_AS_NODE='1')
    out = subprocess.run([node, '-e', script], capture_output=True, text=True, env=env)
    assert out.returncode == 0, f'JS run failed: {out.stderr[-400:]}'
    bad = json.loads(out.stdout.strip().splitlines()[-1])
    assert not bad, f'JS and Python disagree: {bad}'


def main():
    fails = 0
    for fn in CASES:
        try:
            fn()
            print(f"  OK  {fn.__name__}")
        except AssertionError as e:
            fails += 1
            print(f"  BAD {fn.__name__}: {e}")
    if fails:
        print(f"{fails} check(s) failed - the VAT format gate regressed.")
        return 1
    print("All checks passed - VAT is gated on its own format, and nothing correct is refused.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
