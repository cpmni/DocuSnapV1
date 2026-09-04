"""test_confusion_precedence_wiring.py — PINs for the ENGINE wiring of CONFUSION PRECEDENCE 2a
(`ExtractionEngine._apply_confusion_precedence`; reggie+gary → Oracle SIGN-OFF-W/COND 2026-09-04, A1-A4 + O1-O9).

THE ANTI-DEAD-GUARD PIN. The leg-b/leg-a resolvers (RESOLVE_REF_NEAR_MISS / RESOLVE_REF_POSITIONAL) were wired
inside the Stage-4.5 text branch (`if key in text_field_keys:`), which EXCLUDES every ref-role field of a
ref-NAMED type (`_is_ref_field`) — so they never executed on the exhibit while their predicate pins stayed green.
2a is therefore the family's FIRST live arc; this file pins REACHABILITY (a `reference`-typed, ref-named key,
via a taught-mapping read AND an anchor read) as well as the write shape, the deny set, the placement, the
review signal and OFF==ON. Built on the REAL build_format_class_index (the live Print Tracker human
value_counts + the exact confirmed_at-DESC sample order — classify_format is order-sensitive).

RED-first: `_apply_confusion_precedence` / `_CONFUSION_PRECEDENCE` / `_CODE_FIELD_SKIP_TYPES` do not exist on
pre-change code.

Run:  PYTHONIOENCODING=utf-8 py -3.12 python_backend/tests/test_confusion_precedence_wiring.py
"""
import copy, os, re, sys, types
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from extraction import engine
from extraction import format_anomaly_checker as fac

_P = _F = 0
def check(name, ok):
    global _P, _F
    if ok: _P += 1; print(f"  ok  {name}")
    else:  _F += 1; print(f"  FAIL {name}")

SUP, DOC, FK = 'print tracker', 'print_tracker', 'reference_number'
VALUE_COUNTS = {
    'RFH0738865': 3, 'H572413963': 2, '1984800049': 2, 'H7R5326676': 1, 'RGS0512662': 1,
    'VG37308169': 1, '752923124N3M2': 1, 'G726M930140': 1, 'G706M430179': 1, 'G696J500513': 1,
    'C738JB00279': 1, 'RFC9509752': 1, 'C738M125203': 1, 'H573429209': 1, 'H7R5427479': 1,
    'H574951967': 1, 'H574951892': 1, '782923124N3M2': 1, 'H571Y07217': 1,
}
SAMPLE_VALUES = [
    'RFH0738865', 'H571Y07217', '782923124N3M2', 'H574951892', 'H574951967', 'H572413963',
    'H7R5427479', 'H573429209', 'C738M125203', 'RFC9509752', 'C738JB00279', 'G696J500513',
    'G706M430179', '1984800049', 'G726M930140', '752923124N3M2', 'VG37308169', 'RGS0512662',
    'H7R5326676',
]
FACT_O0 = {'len': 10, 'pos': 3, 'from': 'O', 'to': '0', 'support_docs': 4, 'support_values': 3, 'counter': 0}
def formats(supplier='Print Tracker', facts=(FACT_O0,), literals=None):
    e = {'supplier_name': supplier, 'document_type': 'print_tracker', 'field_key': FK,
         'sample_values': SAMPLE_VALUES, 'value_counts': dict(VALUE_COUNTS), 'confirmed_count': sum(VALUE_COUNTS.values())}
    if facts:
        e['confusions'] = list(facts)
    if literals is not None:
        e['confusion_literals'] = list(literals)
    return [e]

def engine_stub(index):
    """The unbound-method receiver: only what _apply_confusion_precedence reads off self."""
    return types.SimpleNamespace(format_class_index=index, log=lambda *a, **k: None, _trace=False,
                                 _list_field_keys=(), _barcode_field_keys=())
FIELD_DEFS = [{'key': 'supplier_name', 'type': 'text'}, {'key': FK, 'type': 'reference'}, {'key': 'date', 'type': 'date'},
              {'key': 'make', 'type': 'text'}, {'key': 'mac_address', 'type': 'mac_address'}]
def run(results, index=None, supplier='Print Tracker', slug='print_tracker', flag=True, fdefs=FIELD_DEFS):
    idx = index if index is not None else fac.build_format_class_index(formats())
    old = engine._CONFUSION_PRECEDENCE
    engine._CONFUSION_PRECEDENCE = flag
    try:
        r = copy.deepcopy(results)
        fired = engine.ExtractionEngine._apply_confusion_precedence(engine_stub(idx), r, fdefs, supplier, slug)
        return fired, r
    finally:
        engine._CONFUSION_PRECEDENCE = old
READ = {'value': 'RFWO112233', 'confidence': 95, 'method': 'template_mapping', 'raw_value': 'RFWO112233'}

print("0. preconditions")
IDX = fac.build_format_class_index(formats())
ENT = IDX.get((SUP, DOC, FK))
check("the REAL index carries the entry with shapes + value_counts + confusions", bool(ENT) and bool(ENT.get('shapes'))
      and bool(ENT.get('value_counts')) and ENT.get('confusions') == [FACT_O0])
check("the flag defaults OFF and uses the `== '1'` idiom (EMPTY is OFF — the `!= '0'` trap)",
      engine._CONFUSION_PRECEDENCE is False
      and "_CONFUSION_PRECEDENCE = os.environ.get(\"CONFUSION_PRECEDENCE\", \"0\") == \"1\"" in open(engine.__file__, encoding='utf-8').read())

print("\n1. REACHABILITY — a `reference`-typed, ref-NAMED key FIRES (the exact shape leg-b/leg-a fail)")
fired, r = run({FK: dict(READ)})
check("taught template_mapping read of reference_number: fires", fired is True and r[FK]['value'] == 'RFW0112233')
fired2, r2 = run({FK: {**READ, 'method': 'anchor_crop_relocated'}})
check("anchor_crop_relocated read: fires too (label-confirmed reads are NOT exempt — Oracle O6, pinned decision)",
      fired2 is True and r2[FK]['value'] == 'RFW0112233')
fired3, r3 = run({'make': {**READ, 'method': 'keyword'}}, index=fac.build_format_class_index(
    [{**formats()[0], 'field_key': 'make'}]), fdefs=[{'key': 'make', 'type': 'text'}])
check("ANY code-like field with facts (a text 'make' here) — not ref-only (Oracle Q3)", fired3 is True and r3['make']['value'] == 'RFW0112233')

print("\n2. THE WRITE SHAPE (Oracle O2: no corrected_to, no was_corrected)")
w = r[FK]
check("value + display_value corrected", w['value'] == 'RFW0112233' and w['display_value'] == 'RFW0112233')
check("raw_value keeps the misread (searchable)", w['raw_value'] == 'RFWO112233')
check("confidence capped to 70 (from 95)", w['confidence'] == 70)
check("NO corrected_to and NO was_corrected (the badge + the human-act readers key on them)",
      'corrected_to' not in w and not w.get('was_corrected'))
check("method suffixed +confusion_resolved", w['method'] == 'template_mapping+confusion_resolved')
note = w['validation_note']
check("note names BOTH forms, the glyph pair, the count, and says the value has NOT been seen before (O8)",
      "'RFWO112233'" in note and "'RFW0112233'" in note and 'O→0' in note and 'on 4 documents' in note
      and 'has not been seen before' in note and engine._CONFUSION_NOTE_MARK in note)
check("raw_value falls back to the read when the row had none", run({FK: {'value': 'RFWO112233', 'confidence': 90, 'method': 'template_mapping'}})[1][FK]['raw_value'] == 'RFWO112233')

print("\n3. THE DENY SET (Oracle O5) — each refuses, byte-identical")
def refuses(results, **kw):
    f, r = run(results, **kw)
    return f is False and r == results
check("already noted -> refuse", refuses({FK: {**READ, 'validation_note': 'x'}}))
check("already carries corrected_to -> refuse", refuses({FK: {**READ, 'corrected_to': 'RFW0112233'}}))
check("method anchor_crop_crosscheck (equality-keyed restore) -> refuse", refuses({FK: {**READ, 'method': 'anchor_crop_crosscheck'}}))
for m in ('keyword_override', 'template_fixed', 'manual', 'operator_pin'):
    check(f"user-set method '{m}' -> refuse", refuses({FK: {**READ, 'method': m}}))
check("identity key -> refuse", refuses({'supplier_name': dict(READ)}, index=fac.build_format_class_index([{**formats()[0], 'field_key': 'supplier_name'}])))
check("name-like key (customer) -> refuse", refuses({'customer': dict(READ)}, index=fac.build_format_class_index([{**formats()[0], 'field_key': 'customer'}]),
      fdefs=[{'key': 'customer', 'type': 'text'}]))
check("house skip type (mac_address) -> refuse", refuses({'mac_address': dict(READ)}, index=fac.build_format_class_index([{**formats()[0], 'field_key': 'mac_address'}])))
def _refuses_with_stub(stub):
    old = engine._CONFUSION_PRECEDENCE
    engine._CONFUSION_PRECEDENCE = True
    try:
        rr = {FK: dict(READ)}
        f = engine.ExtractionEngine._apply_confusion_precedence(stub, rr, FIELD_DEFS, 'Print Tracker', 'print_tracker')
        return f is False and rr == {FK: dict(READ)}
    finally:
        engine._CONFUSION_PRECEDENCE = old
check("list field -> refuse", _refuses_with_stub(types.SimpleNamespace(
    format_class_index=IDX, log=lambda *a, **k: None, _trace=False, _list_field_keys=(FK,), _barcode_field_keys=())))
check("barcode field -> refuse", _refuses_with_stub(types.SimpleNamespace(
    format_class_index=IDX, log=lambda *a, **k: None, _trace=False, _list_field_keys=(), _barcode_field_keys=(FK,))))
check("internal whitespace -> refuse", refuses({FK: {**READ, 'value': 'RFWO 11223'}}))
check("no digit at all -> refuse", refuses({FK: {**READ, 'value': 'RFWOABCDEF'}}))
check("empty / non-string value -> refuse", refuses({FK: {**READ, 'value': ''}}) and refuses({FK: {**READ, 'value': 12345}}))
check("the module deny set EQUALS the four reconciles' local `_skip_types` (can't drift)",
      (lambda src: len(re.findall(r"_skip_types = \{'date', 'currency', 'number', 'percentage', 'email', 'iban', 'vat_gb',\s*'postcode_uk', 'ip_address', 'mac_address', 'currency_code', 'website'\}", src)) >= 3
       and engine._CODE_FIELD_SKIP_TYPES == frozenset({'date', 'currency', 'number', 'percentage', 'email', 'iban', 'vat_gb',
                                                       'postcode_uk', 'ip_address', 'mac_address', 'currency_code', 'website'}))
      (open(engine.__file__, encoding='utf-8').read()))

print("\n4. A1 — SUPPLIER-scoped entry only; the '' doc-type twin can never license")
idx_twin = fac.build_format_class_index(formats(supplier=''))          # facts on the '' entry only
check("facts only on the '' entry -> no fire", refuses({FK: dict(READ)}, index=idx_twin))
check("no supplier resolved -> no fire (never a cross-supplier fact)", refuses({FK: dict(READ)}, supplier=''))
check("a different supplier's entry -> no fire", refuses({FK: dict(READ)}, supplier='Other Co'))

print("\n5. OFF == ON byte-identical")
check("flag off: results untouched, returns False", (lambda f, r: f is False and r == {FK: dict(READ)})(*run({FK: dict(READ)}, flag=False)))

print("\n6. Placement + review signal (source-order pins, engine.py)")
src = open(engine.__file__, encoding='utf-8').read()
i_d1   = src.find('self._flag_digit_disagreement(results, field_defs, supplier_name,')
i_call = src.find('_cp_fired = self._apply_confusion_precedence(results, field_defs, supplier_name, document_slug)')
i_boost = src.find('# ── LEARNED-AGREEMENT CONFIDENCE BOOST')
i_snap  = src.find("'+snapped'")
i_rev   = src.find('review_needed = validator.needs_review(results, field_defs) or format_anomaly_flagged or _cp_fired')
i_gatec = src.find('self._flag_filing_value_sanity(')
check("call sits AFTER _flag_digit_disagreement and BEFORE the learned-agreement boost (Oracle O1)", 0 < i_d1 < i_call < i_boost)
check("…after the 2.5d dominant snap (nothing can re-snap a 2a value)", 0 < i_snap < i_call)
check("…and AFTER Gate C's call (Oracle O1: every page-witness gate judges the RAW read first; 2a fires only on a "
      "value that passed them all cleanly — it must never pre-empt the page witness with its own note)", 0 < i_gatec < i_call)
check("the fired flag is ORed into review_needed (results['_needs_review'] is assigned unconditionally later)", i_rev > i_call > 0)
check("2a never calls _has_no_usual_format (test_format_anomaly_variance pins exactly ONE site)",
      '_has_no_usual_format' not in src[src.find('def _apply_confusion_precedence'):src.find('def _history_soften_ok')])

print("\n7. The note MARK is not sweepable (Oracle O7, bilingual)")
n = engine._CONFUSION_NOTE.format('RFWO112233', 'RFW0112233', 'O', '0', 4)
check("Python: _is_verification_doubt_note(note) is False", engine._is_verification_doubt_note(n) is False)
check("the mark is NOT in _verification_doubt_note_marks()", all(engine._CONFUSION_NOTE_MARK not in str(m) for m, _ in engine._verification_doubt_note_marks()))
_js = open(os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'services', 'classFixService.js'), encoding='utf-8').read()
_marks = re.findall(r"""['"](.+?)['"]""", re.search(r'CLEARABLE_NOTE_MARKS\s*=\s*Object\.freeze\(\[(.*?)\]\)', _js, re.S).group(1))
check("JS: no CLEARABLE_NOTE_MARK is a substring of the note", len(_marks) == 4 and all(m not in n for m in _marks))
check("no known arm/near-miss PREFIX starts the note",
      not any(n.startswith(p) for p in ('unexpected characters', 'Suggested name correction:', 'looks like a misread', 'Cross-check:')))

print(f"\n{'ALL PASS' if _F == 0 else str(_F) + ' FAILED'}  ({_P} ok)")
sys.exit(1 if _F else 0)
