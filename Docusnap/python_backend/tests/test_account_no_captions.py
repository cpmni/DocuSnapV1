"""test_account_no_captions.py — an account number is not "anything next to the word Ref".

Run: py -3.12 python_backend/tests/test_account_no_captions.py

THE DEFECT, verified at source. `account_no` had no shipped `field_patterns` entry, so
`seed_field_labels` gave it its DB label PLUS the generic role bank
["Reference No", "Reference", "Ref No", "Ref"]. The bare caption **"Ref"** matches

    JOB SHEET NO CJB-5900    DATE 07-06-2025    Job Ref JB-8887

so the JOB REFERENCE was committed as the account number — on 20 documents whose pages carry no
account number at all.

Measured against what is actually PRINTED (200 documents): the account number appears on 60 pages,
all 60 are read correctly, and a value was INVENTED on 40 of the 140 pages that have none. That is
the worst kind of wrong value — not a misread of the right thing, but a confident value with no
source on the page, which a human reviewing it has nothing to check against.

It also closed the defect at the TEACH end. On a quote with no account number printed, the generic
bank filled the field with the quotation reference, the teach FROZE that as the template's permanent
account number, and it was then stamped on every sibling at 95. With no caption matching, the
teach-time read is empty and there is nothing to freeze.

GATE: account_no 7 ok / 19 wrong / 41 empty -> 7 / 0 / 60, every other lane byte-identical.
Nothing correct was lost; the 19 invented values became empty, which is what a page with no account
number should produce.

THE ONE JUDGEMENT CALL, pinned below: `role_caption` is deliberately NOT set, unlike vat_no. It arms
a guard that refuses a caption preceded by a PARTY word — right for a VAT number, where "Customer
VAT No" belongs to the other company, and wrong here, because the account number IS our account with
that supplier. "Customer Account No" is the most common real-world spelling of this field.
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

from extraction import keyword                                   # noqa: E402

CFG = json.load(open(os.path.join(_HERE, '..', '..', 'config', 'keyword_patterns.json'),
                     encoding='utf-8'))
ENTRY = CFG['field_patterns'].get('account_no') or {}

CASES = []
def case(fn):
    CASES.append(fn)
    return fn


def matches(caption, line):
    return bool(re.search(r'(?<![a-z0-9])' + re.escape(caption.lower()) + r'(?![a-z0-9])',
                          line.lower()))


def captions_hitting(line, labels=None):
    return [c for c in (labels if labels is not None else ENTRY.get('labels', []))
            if matches(c, line)]


@case
def test_account_no_is_a_shipped_field():
    assert ENTRY, 'account_no must be shipped, or it inherits the generic reference bank'
    assert ENTRY.get('validation') == 'alphanumeric', ENTRY
    assert ENTRY.get('base_confidence', 99) < 88, \
        'a right-read adds 5; the base must keep a clean read below the 88 auto-file floor'


@case
def test_the_generic_reference_bank_is_no_longer_seeded():
    """The mechanism, asserted rather than assumed: `seed_field_labels` skips a key that is already
    shipped, so shipping the entry is what removes the bare "Ref"."""
    seeded = keyword.seed_field_labels(dict(CFG),
                                       [{'key': 'account_no', 'label': 'Account Number',
                                         'type': 'text'}])
    labels = seeded['field_patterns']['account_no']['labels']
    for generic in ('Ref', 'Reference', 'Ref No', 'Reference No'):
        assert generic not in labels, f'the generic bank is back: {generic!r} would match "Job Ref ..."'


@case
def test_the_exhibit_no_longer_matches():
    """The live line that produced 20 invented account numbers."""
    line = 'JOB SHEET NO CJB-5900    DATE 07-06-2025    Job Ref JB-8887'
    assert captions_hitting(line) == [], \
        f'still matching the job-reference line: {captions_hitting(line)}'


@case
def test_real_account_captions_still_match():
    for line in ('Account No    CSS-1108',
                 'Customer Account No: HT-00412',
                 'A/C No 12345',
                 'Your Account   MDW-315',
                 'ACCOUNT NUMBER  ITH-0093'):
        assert captions_hitting(line), f'a real account caption stopped matching: {line!r}'


@case
def test_longest_caption_first():
    """`_search_for_label` iterates in order and breaks on the first hit, so a longer caption must be
    tried before the shorter one it contains — otherwise "Customer Account No" is matched by
    "Account" and the read starts mid-caption."""
    labels = ENTRY['labels']
    for long, short in (('Customer Account No', 'Account No'),
                        ('Customer Account Number', 'Account Number'),
                        ('Account Number', 'Account'),
                        ('A/C Number', 'A/C')):
        assert labels.index(long) < labels.index(short), \
            f'{long!r} must be tried before {short!r}'


@case
def test_no_party_guard_and_the_reason():
    """TRADE-OFF PIN. `role_caption: 'ref'` arms `_ref_caption_party_conflict`, which refuses a
    caption preceded by a party word. vat_no wants that — "Customer VAT No" is the other company's
    number. account_no must NOT: the account number IS our account with that supplier, so
    "Customer Account No" and "Your Account" are precisely the captions that name it. Anyone adding
    role_caption here turns the two pins above red."""
    assert 'role_caption' not in ENTRY, \
        'the party guard would refuse "Customer Account No", the commonest spelling of this field'
    assert any('Customer Account' in l for l in ENTRY['labels'])


@case
def test_no_caption_is_shared_with_another_field():
    """One printed caption must not fill two fields — the class KEYWORD_GENERIC_CAPTION_EXCLUSIVE
    exists to clean up after."""
    own = {l.strip().lower() for l in ENTRY['labels']}
    for key, e in CFG['field_patterns'].items():
        if key == 'account_no':
            continue
        shared = own & {str(l).strip().lower() for l in (e.get('labels') or [])}
        assert not shared, f'account_no shares {shared} with {key}'


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
        print(f"{fails} check(s) failed - account_no captions regressed.")
        return 1
    print("All checks passed - the account number is read from its own captions, or not at all.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
