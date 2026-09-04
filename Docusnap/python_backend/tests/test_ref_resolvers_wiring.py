"""test_ref_resolvers_wiring.py — PINs for the RELOCATED single-glyph reference resolvers
(`ExtractionEngine._apply_ref_resolvers`; gary → Oracle SEND-BACK→SIGN-OFF-W/COND C1-C11, 2026-09-04 late).

THE ANTI-DEAD-GUARD PIN, second edition. RESOLVE_REF_NEAR_MISS (leg-b) and RESOLVE_REF_POSITIONAL (leg-a) were
wired inside the Stage-4.5 text branch, which `text_field_keys` makes unreachable for every ref-role field of a
ref-NAMED type (plus the label-confirmed / already-noted / variance gates) — their predicate pins stayed green
while they never executed on the exhibit (doc176: `1625802868` @95 clean, one backed glyph from the confirmed
`1G25802868` — the page prints 1G25802868, verified by render). This file pins REACHABILITY at the new site, the
SUGGESTION write shape (Oracle C2: value UNCHANGED, corrected_to, <=70, note, NO was_corrected, NO method
suffix), the deny set, the '' twin refusal, placement, the review signal, both flags OFF==ON, leg-a's guards,
the non-sweepable marks, and the leg-b/2a disjointness. Built on the REAL build_format_class_index (the live
Print Tracker payload of 2026-09-04 with the rubber-stamped `1625802868` confirms removed — the e2e copy).

RED-first: `_apply_ref_resolvers` does not exist on pre-change code; the old-site pins in
test_resolve_ref_near_miss.py / test_resolve_ref_positional_wiring.py were rewritten alongside.

Run:  PYTHONIOENCODING=utf-8 py -3.12 python_backend/tests/test_ref_resolvers_wiring.py
"""
import copy, os, re, sys, types
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
os.environ['FORMAT_CLASS_JOIN'] = '1'   # the live scope is only VISIBLE with the join (DARK-on-DARK, stated)
from extraction import format_anomaly_checker as fac
import importlib; importlib.reload(fac)
from extraction import engine

_P = _F = 0
def check(name, ok):
    global _P, _F
    if ok: _P += 1; print(f"  ok  {name}")
    else:  _F += 1; print(f"  FAIL {name}")

SUP, DOC, FK = 'print tracker', 'print_tracker', 'reference_number'
# the live Print Tracker payload (2026-09-04) with `1625802868` (docs 176/210) + `782923124N3M2` (doc 92) neutralised
SAMPLE_VALUES = ["1984800049", "1G25802868", "W2S7828006", "752923124N3M2", "RFH0738865", "RFC9508317",
                 "H571Y07217", "H574951892", "H574951967", "H572413963", "H7R5427479", "H573429209",
                 "C738M125203", "RFC9509752", "C738JB00279", "G696J500513", "G706M430179", "G726M930140",
                 "VG37308169", "RGS0512662"]
VALUE_COUNTS = {"1984800049": 3, "1G25802868": 2, "W2S7828006": 1, "752923124N3M2": 4, "RFH0738865": 9,
                "RFC9508317": 1, "H571Y07217": 1, "H574951892": 1, "H574951967": 1, "H572413963": 2,
                "H7R5427479": 1, "H573429209": 1, "C738M125203": 1, "RFC9509752": 1, "C738JB00279": 1,
                "G696J500513": 1, "G706M430179": 1, "G726M930140": 1, "VG37308169": 1, "RGS0512662": 1,
                "H7R5326676": 1}
def formats(supplier='Print Tracker', field=FK, literals=None, counts=VALUE_COUNTS):
    e = {'supplier_name': supplier, 'document_type': 'print_tracker', 'field_key': field,
         'sample_values': list(SAMPLE_VALUES), 'value_counts': dict(counts), 'confirmed_count': 36}
    if literals is not None:
        e['confusion_literals'] = list(literals)
    return [e]
IDX = fac.build_format_class_index(formats())
E = IDX.get((SUP, DOC, FK))
FIELD_DEFS = [{'key': 'supplier_name', 'type': 'text'}, {'key': FK, 'type': 'reference'}, {'key': 'date', 'type': 'date'},
              {'key': 'serial', 'type': 'text'}, {'key': 'mac_address', 'type': 'mac_address'}]

def stub(index=None, **extra):
    # The receiver is a SimpleNamespace, so leg-a's `self._ref_positional_value(key)` must be a stub attribute here
    # (an AttributeError would be swallowed by the pass's best-effort guard and green the "never called" checks
    # vacuously — the dead-guard trap this file exists to catch). Default: no consensus.
    s = types.SimpleNamespace(format_class_index=index if index is not None else IDX, log=lambda *a, **k: None,
                              _trace=False, _list_field_keys=(), _barcode_field_keys=(),
                              _field_candidates={}, _s05_read_geom={}, _s05_pages=None, _s05_mappings=[], _code_witnesses={},
                              _ref_positional_value=lambda key: None)
    for k, v in extra.items(): setattr(s, k, v)
    return s
def run(results, nm=True, pa=False, index=None, supplier='Print Tracker', slug='print_tracker', fdefs=FIELD_DEFS, ref=FK, st=None):
    o1, o2 = engine._RESOLVE_REF_NEAR_MISS, engine._RESOLVE_REF_POSITIONAL
    engine._RESOLVE_REF_NEAR_MISS, engine._RESOLVE_REF_POSITIONAL = nm, pa
    try:
        r = copy.deepcopy(results)
        fired = engine.ExtractionEngine._apply_ref_resolvers(st or stub(index), r, fdefs, supplier, slug, ref)
        return fired, r
    finally:
        engine._RESOLVE_REF_NEAR_MISS, engine._RESOLVE_REF_POSITIONAL = o1, o2
READ = {'value': '1625802868', 'confidence': 95, 'method': 'anchor_crop_relocated', 'raw_value': '1625802868'}

print("0. preconditions")
check("the joined entry exists with value_counts (the live scope is visible)", bool(E) and E.get('joined') is True and bool(E.get('value_counts')))
check("both flags default OFF (== '1' idiom)", engine._RESOLVE_REF_NEAR_MISS is False and engine._RESOLVE_REF_POSITIONAL is False)

print("\n1. REACHABILITY — the doc176 shape FIRES (the exact case the old site could never see)")
fired, r = run({FK: dict(READ)})
check("reference-typed, ref-named key via anchor_crop_relocated -> leg-b fires", fired is True)
fired2, r2 = run({FK: {**READ, 'method': 'template_mapping'}})
check("…and via a taught template_mapping read (label-confirmed reads are NOT exempt — Oracle O6, pinned decision)", fired2 is True)
fired3, r3 = run({'serial': dict(READ)}, index=fac.build_format_class_index([{**formats()[0], 'field_key': 'serial'}]))
check("a text-typed, non-ref-named `serial` fires too (the old site's reachable domain is preserved)", fired3 is True)

print("\n2. THE WRITE SHAPE — a SUGGESTION (Oracle C2), not a pre-fill")
w = r[FK]
check("value UNCHANGED (the raw read stays the committed value)", w['value'] == '1625802868' and w.get('display_value', '1625802868') == '1625802868')
check("corrected_to carries the proposal", w.get('corrected_to') == '1G25802868')
check("confidence capped to 70 (from 95)", w['confidence'] == 70)
check("NO was_corrected", not w.get('was_corrected'))
check("NO method suffix (S3: a suffix broke the corroboration family match)", w['method'] == 'anchor_crop_relocated')
note = w['validation_note']
check("note names both forms, the glyph pair (6→G), the confirm count, and the mark",
      "'1625802868'" in note and "'1G25802868'" in note and '6→G' in note and 'confirmed 2 times before' in note
      and engine._REF_RESOLVE_NOTE_MARK in note)

print("\n3. THE DENY SET — each refuses, byte-identical")
def refuses(results, **kw):
    f, r = run(results, **kw)
    return f is False and r == results
check("already noted -> refuse", refuses({FK: {**READ, 'validation_note': 'x'}}))
check("already carries corrected_to -> refuse", refuses({FK: {**READ, 'corrected_to': 'Z'}}))
check("method anchor_crop_crosscheck -> refuse", refuses({FK: {**READ, 'method': 'anchor_crop_crosscheck'}}))
for m in ('keyword_override', 'template_fixed', 'manual', 'operator_pin'):
    check(f"user-set method '{m}' -> refuse", refuses({FK: {**READ, 'method': m}}))
check("identity key -> refuse", refuses({'supplier_name': dict(READ)}, index=fac.build_format_class_index([{**formats()[0], 'field_key': 'supplier_name'}])))
check("house skip type (mac_address) -> refuse", refuses({'mac_address': dict(READ)}, index=fac.build_format_class_index([{**formats()[0], 'field_key': 'mac_address'}])))
check("list field -> refuse", refuses({FK: dict(READ)}, st=stub(_list_field_keys=(FK,))))
check("internal whitespace / no digit / non-string -> refuse",
      refuses({FK: {**READ, 'value': '1625 02868'}}) and refuses({FK: {**READ, 'value': 'ABCDEFGHIJ'}}) and refuses({FK: {**READ, 'value': 12}}))
check("a read that IS a confirmed literal -> refuse (nothing to suggest)", refuses({FK: {**READ, 'value': '1G25802868'}}))
check("the 752/782 ball-of-two (both confirmed) -> refuse", refuses({FK: {**READ, 'value': '762923124N3M2'}},
      index=fac.build_format_class_index(formats(counts={**VALUE_COUNTS, '782923124N3M2': 1}))))

print("\n4. A1 — supplier entry only; the '' twin never licenses")
check("facts/counts only on the '' entry -> no fire", refuses({FK: dict(READ)}, index=fac.build_format_class_index(formats(supplier=''))))
check("no supplier resolved -> no fire", refuses({FK: dict(READ)}, supplier=''))
check("a different supplier -> no fire", refuses({FK: dict(READ)}, supplier='Other Co'))

print("\n5. The machine-literal union + attestation (Oracle C3/C5) reach leg-b through the entry")
IDX_M = fac.build_format_class_index(formats(literals=list(VALUE_COUNTS) + ['1625802869']))   # a MACHINE literal one edit from the read
check("the union rides on the entry independently of any confusion facts (C4)", IDX_M[(SUP, DOC, FK)].get('confusion_literals') is not None)
check("a machine-confirmed neighbour makes the ball size 2 -> refuse", refuses({FK: dict(READ)}, index=IDX_M))
IDX_A = fac.build_format_class_index(formats(literals=list(VALUE_COUNTS) + ['1725802868']))   # a known literal with a DIGIT at pos 1
check("attestation: the family admits a digit at the read's position -> refuse (C3)", refuses({FK: dict(READ)}, index=IDX_A))
IDX_MO = fac.build_format_class_index(formats(counts={k: v for k, v in VALUE_COUNTS.items() if k != '1G25802868'},
                                              literals=list(VALUE_COUNTS)))              # 1G… only MACHINE-known
check("a machine-only target (no human attestation) -> refuse — the deliberate dead zone, pinned", refuses({FK: dict(READ)}, index=IDX_MO))
check("NO support floor by design: a count-1 human literal still licenses a SUGGESTION (a later floor must be a conscious edit)",
      (run({FK: dict(READ)}, index=fac.build_format_class_index(formats(counts={**VALUE_COUNTS, '1G25802868': 1})))[1][FK].get('corrected_to') == '1G25802868'))

print("\n6. leg-a — ref role only, never on a confirmed literal, its own flag")
_calls = []
def _spy(key):
    _calls.append(key); return None
check("leg-a OFF: _ref_positional_value never called even for the ref role",
      run({FK: {**READ, 'value': 'ZZ9999999999'}}, nm=False, pa=False, st=stub(_ref_positional_value=_spy))[0] is False and not _calls)
check("leg-a ON but key != ref role: never called", run({'serial': {**READ, 'value': 'ZZ9999999999'}}, nm=False, pa=True,
      st=stub(index=fac.build_format_class_index([{**formats()[0], 'field_key': 'serial'}]), _ref_positional_value=_spy), ref='reference_number')[0] is False and not _calls)
check("leg-a ON, ref role, read IS a confirmed literal: never called",
      run({FK: {**READ, 'value': '1G25802868'}}, nm=False, pa=True, st=stub(_ref_positional_value=_spy))[0] is False and not _calls)
check("leg-a ON, ref role, never-seen read: IS consulted (the spy proves the plumbing is live)",
      run({FK: {**READ, 'value': 'ZZ9999999999'}}, nm=False, pa=True, st=stub(_ref_positional_value=_spy))[0] is False and _calls == [FK])
fa, ra = run({FK: {**READ, 'value': '762923124N3M2'}}, nm=False, pa=True, st=stub(_ref_positional_value=lambda key: '752923124N3M2'))
check("leg-a ON, consensus differs: SUGGESTION written (corrected_to, <=70, leg-a note, no was_corrected, no suffix)",
      fa is True and ra[FK]['value'] == '762923124N3M2' and ra[FK]['corrected_to'] == '752923124N3M2' and ra[FK]['confidence'] == 70
      and engine._REF_POSITIONAL_NOTE_MARK in ra[FK]['validation_note'] and not ra[FK].get('was_corrected') and ra[FK]['method'] == 'anchor_crop_relocated')
fb, rb = run({FK: dict(READ)}, nm=True, pa=True, st=stub(_ref_positional_value=lambda key: 'XXXXXXXXXX'))
check("leg-b fired first -> leg-a never overrides it (precedence)", fb is True and rb[FK]['corrected_to'] == '1G25802868')

print("\n7. OFF == ON byte-identical, per flag")
check("both flags off: untouched, False", (lambda f, r: f is False and r == {FK: dict(READ)})(*run({FK: dict(READ)}, nm=False, pa=False)))
check("leg-b off / leg-a on, no leg-a consensus: untouched", (lambda f, r: f is False and r == {FK: dict(READ)})(*run({FK: dict(READ)}, nm=False, pa=True)))

print("\n8. Placement + review signal (source-order pins, engine.py)")
src = open(engine.__file__, encoding='utf-8').read()
i_gatec = src.find('self._flag_filing_value_sanity(')
i_d1    = src.find('self._flag_digit_disagreement(results, field_defs, supplier_name,')
i_rc    = src.find('_rc_fired = self._apply_ref_resolvers(results, field_defs, supplier_name, document_slug, ref_field_key)')
i_cp    = src.find('_cp_fired = self._apply_confusion_precedence(results, field_defs, supplier_name, document_slug)')
i_boost = src.find('# ── LEARNED-AGREEMENT CONFIDENCE BOOST')
i_snap  = src.find("'+snapped'")
i_rev   = src.find('or format_anomaly_flagged or _cp_fired or _rc_fired')
check("Gate C < D1 < ref resolvers < 2a < boost", 0 < i_gatec < i_d1 < i_rc < i_cp < i_boost)
check("…after the 2.5d dominant snap", 0 < i_snap < i_rc)
check("_rc_fired is ORed into review_needed", i_rev > i_rc > 0)
check("the OLD text-branch blocks are GONE (no second site)", src.count('_ua = (format_anomaly_checker.unambiguous_near_miss') == 0 and src.count('_pc = (self._ref_positional_value') == 0)
check("the new method's source never calls _has_no_usual_format and writes no was_corrected / no method suffix",
      (lambda seg: '_has_no_usual_format' not in seg and "'was_corrected'" not in seg and "+ref_resolved" not in seg and "+ref_positional" not in seg)
      (src[src.find('def _apply_ref_resolvers'):src.find('def _apply_confusion_precedence')]))
check("the 2a wiring pin's slice (def _apply_confusion_precedence → def _history_soften_ok) is still clean of _has_no_usual_format",
      '_has_no_usual_format' not in src[src.find('def _apply_confusion_precedence'):src.find('def _history_soften_ok')])

print("\n9. Marks non-sweepable (bilingual) + distinct")
n1 = engine._REF_RESOLVE_NOTE.format('1625802868', '1G25802868', '6→G; confirmed 2 times before')
n2 = engine._REF_POSITIONAL_NOTE.format('762923124N3M2', '752923124N3M2')
check("Python: neither note is a verification-doubt note", engine._is_verification_doubt_note(n1) is False and engine._is_verification_doubt_note(n2) is False)
_js = open(os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'services', 'classFixService.js'), encoding='utf-8').read()
_marks = re.findall(r"""['"](.+?)['"]""", re.search(r'CLEARABLE_NOTE_MARKS\s*=\s*Object\.freeze\(\[(.*?)\]\)', _js, re.S).group(1))
check("JS: no CLEARABLE_NOTE_MARK is a substring of either note", all(m not in n1 and m not in n2 for m in _marks))
check("neither note contains the renderer's isApplied / _neitherOnPage triggers",
      all(t not in n1 and t not in n2 for t in ('one character differs', "doesn't appear on this page as written")))
check("the three family marks are distinct", len({engine._REF_RESOLVE_NOTE_MARK, engine._REF_POSITIONAL_NOTE_MARK, engine._CONFUSION_NOTE_MARK}) == 3)

print("\n10. leg-b ⟂ 2a — disjoint by construction over ball sizes {0,1,2}")
F = {'len': 10, 'pos': 1, 'from': '6', 'to': 'G', 'support_docs': 4, 'support_values': 3, 'counter': 0}
for label, counts in (('ball 0', {'RFH0738865': 9, 'H574951892': 1, 'H572413963': 2}),
                      ('ball 1', {'1G25802868': 2, 'RFH0738865': 9, 'H574951892': 1}),
                      ('ball 2', {'1G25802868': 2, '1625802869': 1, 'RFH0738865': 9})):
    e = {'value_counts': counts, 'confusions': [F]}
    b = fac.unambiguous_near_miss('1625802868', e); c = fac.confusion_correct('1625802868', e)
    check(f"{label}: at most ONE of leg-b / 2a fires (leg-b={bool(b)}, 2a={bool(c)})", not (b and c))

print(f"\n{'ALL PASS' if _F == 0 else str(_F) + ' FAILED'}  ({_P} ok)")
sys.exit(1 if _F else 0)
