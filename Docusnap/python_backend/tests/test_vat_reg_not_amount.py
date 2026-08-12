"""tests/test_vat_reg_not_amount.py — VAT_REG_NOT_AMOUNT (reggie + gary -> Oracle SIGN-OFF-W/COND,
2026-08-07).

THE BUG. A letterhead prints "… FB1 9AA · VAT Reg GB 651 0027 84". The bare "VAT" label matches it,
_search_for_label scans TOP-DOWN and returns the FIRST accepted occurrence, so the letterhead beats
the real "VAT @ 20%" line below. number_format.normalise_currency_spacing rule 3 then MINTS a decimal
("trailing 2-digit decimal with the point dropped", for "5,767 71" -> "5,767.71"): a UK VAT number is
grouped 3-4-2, so its last group is ALWAYS two digits at end-of-segment and "651 0027 84" becomes
"651 0027.84". Only THEN does it pass currency validation, and _clean_value returns just the match —
destroying the "Reg GB 651" context that would have condemned it. Measured on the live DB: an
identical '0027.84' on all 13 documents of one supplier, conf 90, poisoning total reconciliation on
~12 CORRECT documents.

These tests run END-TO-END through keyword.extract_fields on real two-line text, NOT the predicate in
isolation — Oracle's condition, because a predicate-only test greens even when the arming is threaded
wrongly and the guard never actually runs.

Run: cd python_backend && py -3.12 tests/test_vat_reg_not_amount.py
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from extraction import keyword, number_format          # noqa: E402

PATTERNS = json.loads((Path(__file__).resolve().parents[2] / 'config' /
                       'keyword_patterns.json').read_text(encoding='utf-8'))

FAILURES = []


def check(name, cond, detail=''):
    if cond:
        print(f'  ok   {name}')
    else:
        print(f'  FAIL {name}  {detail}')
        FAILURES.append(name)


def vat_of(text, on):
    """Run the real Stage-1 extractor over `text` and return the committed vat_tax value."""
    prev = os.environ.get('VAT_REG_NOT_AMOUNT')
    if on:
        os.environ['VAT_REG_NOT_AMOUNT'] = '1'
    else:
        os.environ.pop('VAT_REG_NOT_AMOUNT', None)
    try:
        got = keyword.extract_fields(text, ['vat_tax'], PATTERNS) or {}
    finally:
        if prev is None:
            os.environ.pop('VAT_REG_NOT_AMOUNT', None)
        else:
            os.environ['VAT_REG_NOT_AMOUNT'] = prev
    return (got.get('vat_tax') or {}).get('value')


# The two shipped letterhead styles, verbatim in shape from stress_test/gen_customer_test.py.
LETTERHEAD_REG = 'Keep House, 14 Bastion Way · Fortbridge, FB1 9AA · VAT Reg GB 651 0027 84'
LETTERHEAD_BARE = '82 Wharfside Business Park · Easthaven, EH11 3PL   VAT GB 774 2093 55'
TOTALS_BLOCK = 'Net Total    225.50\nVAT   45.10\nTOTAL   270.60'

print('== OFF: today\'s behaviour is PINNED (byte-identical when the switch is off) ==')
# This is the assertion that makes "byte-identical off" a fact rather than a hope: with the switch
# off the bug MUST still reproduce. If this test ever starts passing-by-accident, the guard has
# begun firing unarmed.
check('OFF still reads the registration number as the tax',
      vat_of(LETTERHEAD_REG + '\n' + TOTALS_BLOCK, on=False) == '0027.84',
      f'got {vat_of(LETTERHEAD_REG + chr(10) + TOTALS_BLOCK, on=False)!r}')

print('\n== ON: the registration number is refused, in BOTH shipped letterhead styles ==')
check('keyword style "VAT Reg GB 651 0027 84" no longer yields 0027.84',
      vat_of(LETTERHEAD_REG + '\n' + TOTALS_BLOCK, on=True) != '0027.84',
      f'got {vat_of(LETTERHEAD_REG + chr(10) + TOTALS_BLOCK, on=True)!r}')
# ORACLE: the banner style does NOT poison with '2093.55' — _clean_value returns the FIRST currency
# pattern's match, which is the bare '774'. A test written against the 0027.84 shape alone passes
# while this whole class still fires. This is that test.
check('banner style "VAT GB 774 2093 55" no longer yields the 774 fragment',
      vat_of(LETTERHEAD_BARE + '\n' + TOTALS_BLOCK, on=True) not in ('774', '2093.55'),
      f'got {vat_of(LETTERHEAD_BARE + chr(10) + TOTALS_BLOCK, on=True)!r}')
# The grouping leg alone — no country code, no Reg keyword. Nothing else can catch this.
check('bare "VAT 651 0027 84" (no GB, no Reg) is refused — grouping leg',
      vat_of('Fortbridge FB1 9AA   VAT 651 0027 84\n' + TOTALS_BLOCK, on=True) != '0027.84')
check('spaceless "VAT No GB651002784" is refused — unbroken-run leg',
      vat_of('Fortbridge FB1 9AA   VAT No GB651002784\n' + TOTALS_BLOCK, on=True) is None
      or vat_of('Fortbridge FB1 9AA   VAT No GB651002784\n' + TOTALS_BLOCK, on=True) == '45.10')

print('\n== ON: the scan CONTINUES down the page and real amounts still read ==')
check('two-line: letterhead skipped, the real VAT line below is read',
      vat_of(LETTERHEAD_REG + '\n' + TOTALS_BLOCK, on=True) == '45.10',
      f'got {vat_of(LETTERHEAD_REG + chr(10) + TOTALS_BLOCK, on=True)!r}')
check('plain "VAT   27.84" still reads', vat_of('VAT   27.84', on=True) == '27.84',
      f'got {vat_of("VAT   27.84", on=True)!r}')
# Assert ON == OFF rather than a literal: today this returns '£64.56' with the symbol retained, and
# the property that matters is that the guard changed NOTHING here, not what the legacy value looks
# like. Pinning the literal would couple this test to unrelated _clean_value behaviour.
check('"VAT (20%)   £64.56" reads identically ON and OFF (the existing percent-column case)',
      vat_of('VAT (20%)   £64.56', on=True) == vat_of('VAT (20%)   £64.56', on=False) is not None,
      f'on={vat_of("VAT (20%)   £64.56", on=True)!r} off={vat_of("VAT (20%)   £64.56", on=False)!r}')
check('"VAT Amount  1,234.56" still reads',
      vat_of('VAT Amount  1,234.56', on=True) == '1,234.56',
      f'got {vat_of("VAT Amount  1,234.56", on=True)!r}')

print('\n== the money VETO outranks every identifier leg ==')
# A tax line whose amount happens to be long. The veto must win on the cents group alone, because
# the currency SYMBOL is a routine OCR casualty and cannot be relied on (Oracle).
check('long amount with cents is protected by the veto',
      keyword._vat_identifier_tail('   1 234 567.89') is None)
check('symbol-less long amount with cents is protected',
      keyword._vat_identifier_tail('   123456789.00') is None)
check('a currency CODE protects', keyword._vat_identifier_tail('  GBP 651 0027 84') is None)

print('\n== predicate units: the legs, and what must NOT fire ==')
check('grouping leg fires on 3-4-2', keyword._vat_identifier_tail(' 651 0027 84') == 'grouping')
check('country leg fires on a 3-3-3 with a GB prefix',
      keyword._vat_identifier_tail(' GB 651 002 784') == 'country')
check('spaceless run with Reg No fires — unbroken leg (regressed once: \\d{1,4} capped the group)',
      keyword._vat_identifier_tail(' Reg No 651002784') == 'unbroken',
      f'got {keyword._vat_identifier_tail(" Reg No 651002784")!r}')
check('spaceless run with a country prefix fires',
      keyword._vat_identifier_tail(' GB651002784') == 'unbroken',
      f'got {keyword._vat_identifier_tail(" GB651002784")!r}')
# gary's false-positive probe: an 8-digit whole-pound amount with space thousands. Non-leading
# groups are 3,3 -> grouping leg false; no country code; no keyword. Must not fire.
check('"12 345 678" (whole-pound amount) does NOT fire',
      keyword._vat_identifier_tail('   12 345 678') is None)
check('short continental "1 234,56" does NOT fire',
      keyword._vat_identifier_tail('   1 234,56') is None)
check('empty tail does NOT fire', keyword._vat_identifier_tail('') is None)

print('\n== PIN: number_format rule 3 is DELIBERATELY left alone ==')
# Oracle C6 + both advisors. Rule 3 is shared with anchor.py and is load-bearing for genuinely
# OCR-split money; there is no measured failure there, and narrowing it is a far wider blast radius.
# A future dev who "fixes" the decimal fabrication instead of the label binding trips this and reads
# why. The rule's docstring rationale is only true INSIDE a money context — that is the whole point:
# the fix is to stop a non-money context reaching it, not to weaken it.
check('rule 3 still rejoins genuinely OCR-split money',
      number_format.normalise_currency_spacing('5,767 71') == '5,767.71',
      f'got {number_format.normalise_currency_spacing("5,767 71")!r}')
check('rule 3 still mints the identifier when handed one (unchanged by this slice)',
      number_format.normalise_currency_spacing('Reg GB 651 0027 84').endswith('0027.84'))
check('a 6-digit split amount is below the floor and never reaches the guard',
      keyword._vat_identifier_tail('   5,767 71') is None)

print('\n== PIN: the ACCEPTED TRADE-OFFS (chosen, not lost) ==')
# (1) A user who names a VAT-REGISTRATION field literally 'vat' aliases to the vat_tax role, so the
# guard suppresses it. Accepted: it fails toward EMPTY (review), never toward a wrong number. Do not
# "restore" this by widening the arming — Oracle C2 ruled the arming is the role, not the class.
check('a vat-keyed registration field is suppressed — accepted, fails toward empty',
      vat_of(LETTERHEAD_REG, on=True) is None,
      f'got {vat_of(LETTERHEAD_REG, on=True)!r}')
# (2) A1 converts a poisoned tax into NO tax. validator.py:675 ("components present but nothing
# reconciles") therefore goes quiet on a document whose only captured component was the poison. That
# class is not protected by anything else and falls to NEUTRAL. This is the A1-only narrowing, signed
# off with A2 deferred (pendingfeatures 1391) — asserted here so nobody "fixes" it by re-admitting a
# bogus tax.
check('letterhead-only doc yields NO tax at all (the narrowing, made explicit)',
      vat_of(LETTERHEAD_BARE, on=True) is None,
      f'got {vat_of(LETTERHEAD_BARE, on=True)!r}')

print('\n== the guard is ARMED BY ROLE, not by validation class (Oracle C2) ==')
# The same letterhead text under a TOTAL read must be untouched: total_amount is currency-validated
# too, so if the arming ever drifts to the validation class this starts failing.
_prev = os.environ.get('VAT_REG_NOT_AMOUNT')
os.environ['VAT_REG_NOT_AMOUNT'] = '1'
try:
    _tot = keyword.extract_fields('Total   1 234 567 89', ['total_amount'], PATTERNS) or {}
    check('a long OCR-split TOTAL is NOT suppressed by the vat guard',
          (_tot.get('total_amount') or {}).get('value') is not None,
          f'got {(_tot.get("total_amount") or {}).get("value")!r}')
finally:
    if _prev is None:
        os.environ.pop('VAT_REG_NOT_AMOUNT', None)
    else:
        os.environ['VAT_REG_NOT_AMOUNT'] = _prev


print('\n== GARBLE-TOLERANT RUN (2026-08-12 NIGHT — the Pelican live miss) ==')
# One OCR speckle inside the registration run truncated the regex digit run at 5 digits (< the
# 9 floor) and the guard stayed SILENT: doc 1061's letterhead read 'VAT GB 774 20! 2093 55' and
# '2093 55' was minted to a 2093.55 tax amount, failing total reconciliation on a CORRECT doc.
# The token walk now steps over pure-punctuation speckle and keeps counting digit groups.
GARBLED = '82 Wharfside Business Park    thaven,    EH113PL VAT GB 774 20! 2093 55'
check('speckled registration run is still recognised — guard fires (live doc 1061 verbatim)',
      vat_of(GARBLED, on=True) is None, f'got {vat_of(GARBLED, on=True)!r}')
check('dark stays byte-identical on the same text (the mint still happens with the guard off)',
      vat_of(GARBLED, on=False) is not None)
# A letter-garbled group ('2O93', O for 0) deliberately ENDS the run — conservative, the guard
# abstains rather than guessing; the money veto (a real dd.dd anywhere) still always wins.
check('letter-garbled group ends the run (guard abstains, no over-reach)',
      vat_of('VAT GB 774 2O93 55', on=True) is not None)
check('money veto still outranks the walk (a cents group anywhere → never fire)',
      vat_of('VAT 774 20! 2093 55 total £12.34', on=True) is not None)
# reggie BLOCKING (2026-08-12): the walk is a SECOND CHANCE, never a replacement — a verdict the
# shipped legs reach on the regex's own groups must survive a garbled continuation. His exhibit:
# extending ['651002784'] with '123' would flip the 'unbroken' leg silent and re-admit the mint.
check("two-pass: shipped 'unbroken' verdict survives trailing garble (never un-fired by the walk)",
      vat_of('VAT 651002784 ! 123', on=True) is None)
# reggie narrowing 2+3 pinned on the PREDICATE directly (the end-to-end extractor happens to
# read nothing from these constructed lines even with the guard silent, so vat_of can't
# distinguish "guard fired" from "nothing minted" — the predicate call can).
check('comma-grouped 9-digit whole-pound amount: predicate abstains (comma = money signature)',
      keyword._vat_identifier_tail(' 123,456,789') is None)
check('comma-grouped rate-band summary row: predicate abstains',
      keyword._vat_identifier_tail(' 1,234 2,468 3,702') is None)
check('table-rule separated columns: predicate abstains (never stitched into an identifier)',
      keyword._vat_identifier_tail(' 123 456 -- 789 012') is None)
check('the live 1061 tail fires on the SECOND pass with the +walk trace suffix',
      keyword._vat_identifier_tail(' GB 774 20! 2093 55') == 'grouping+walk')

print('\n== CC-FLOOR relaxation (reggie 2026-08-12 — the doc-#1064 digit-dropped exhibit) ==')
# 'VAT GB 774 206 55' = the reg number with ONE digit dropped by OCR: 8 digits, under the 9
# floor, so both passes abstained and 774206.55 was minted as a tax amount. An UPPERCASE cc +
# >=2 groups relaxes the floor to 8 — the true NATIVE minimum (DK/FI/HU/LU/MT/SI VRNs are
# 8 digits), and no money print shape leads with a country code.
check("digit-dropped 'GB 774 206 55' fires the cc_floor leg (doc #1064 verbatim shape)",
      keyword._vat_identifier_tail(' GB 774 206 55') == 'cc_floor')
check('dark parity: the same line still mints with the guard OFF',
      vat_of('VAT GB 774 206 55', on=False) is not None)
check('armed end-to-end: the mint is suppressed', vat_of('VAT GB 774 206 55', on=True) is None)
check('lowercase word never binds as the relaxation cc (fail toward the 9 floor)',
      keyword._vat_identifier_tail(' at 1234 5678') is None)
check('6 digits with cc still abstains (the new floor has a lower edge)',
      keyword._vat_identifier_tail(' GB 123 456') is None)
check("native-8 EU VRN 'DK 12 34 56 78' fires — do not tighten back to 9 without reading the rationale",
      keyword._vat_identifier_tail(' DK 12 34 56 78') == 'cc_floor')

print('\n== DOUBLED cc (live doc #1065: OCR echoed the country code) ==')
# 'VAT GB GB 774 2093 55' — the regex met letters where it demanded digits and the whole guard
# fell silent; the 2093.55 mint re-poisoned the doc on every reprocess. The cc may now repeat
# IDENTICALLY (backreference) — two different words can never chain.
check("doubled cc 'GB GB 774 2093 55' fires (doc #1065 verbatim shape)",
      keyword._vat_identifier_tail(' GB GB 774 2093 55') == 'grouping')
check('dark parity: the doubled-cc line still mints with the guard OFF',
      vat_of('VAT GB GB 774 2093 55', on=False) is not None)
check('armed end-to-end: the doubled-cc mint is suppressed',
      vat_of('VAT GB GB 774 2093 55', on=True) is None)
check("two DIFFERENT words never chain into a cc ('at on …' stays out)",
      keyword._vat_identifier_tail(' at on 1234 5678') is None)
check("footer 8-digit variant 'GB 774 209 55' fires via cc_floor (doc #1065 line 19)",
      keyword._vat_identifier_tail(' GB 774 209 55') == 'cc_floor')
# Rate decoration + reg number on one line: the shipped first pass already fires ('2093' ≠ 3).
check('reg number followed by a rate decoration still fires on the FIRST pass',
      vat_of('VAT GB 774 2093 55 @ 20%', on=True) is None)


def main():
    print(f'\n{"-" * 68}')
    if FAILURES:
        print(f'FAILED {len(FAILURES)}: {", ".join(FAILURES)}')
    else:
        print('all green')
    return len(FAILURES)


if __name__ == '__main__':
    sys.exit(main())
