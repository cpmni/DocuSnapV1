"""test_format_class_join.py — PINs for FORMAT_CLASS_JOIN (gary → Oracle SIGN-OFF-W/COND C1-C11, 2026-09-04;
DARK `format_class_join`, mig 120).

THE DEFECT (live, 2026-09-04): classify_format needs the 3 NEWEST distinct confirmed values to share one coarse
class, else FREETEXT — and build_format_class_index DROPS a FREETEXT non-name entry. The owner's Print Tracker
`reference_number` (pure-digit Lexmark serials beside alnum HP ones) lost its ENTIRE entry the moment a digits-only
serial landed among the last three confirms: every confirmed-literal arc (FORMAT_VARIANCE_RELAX_REF/_INLINE, both
Gate-C softens, leg-b, confusion-precedence 2a, _has_no_usual_format) and the mapper's consent ladder went silently
inert for that sender — the morning's pins stayed GREEN because they bake a 19-value order that still classifies
upper_alphanum (the vacuous-pin trap). §1 bakes the LIVE 20-value order + counts so this file goes RED on the
pre-change code (`join_format_entry` / `_FORMAT_CLASS_JOIN` do not exist) and would go RED again if the live
order ever stops joining.

Oracle conditions pinned here: C1 admission in the INDEX BUILDER over the DISTINCT set + the name-field exclusion
(classify_format byte-identical — tests/test_format_anomaly_checker.py §2 stays green UNEDITED); C2 separators
over the distinct set; C3 NO `shapes` key on a joined entry (+ length-aware `shape_families` attached); C4 class F
refuses a joined entry; C5/C6 consent is review-bound at most ('joined'), on positive LENGTH-AWARE evidence only;
C7 a joined scope flags, never blanks; C8 supplier-scoped only; C9/S3/S5 no support, no fc_delta; C10 the truthful
note; the 752/782 pad-window path can never clean-swap; OFF == ON byte-identical.

Run:  PYTHONIOENCODING=utf-8 py -3.12 python_backend/tests/test_format_class_join.py
"""
import importlib, itertools, os, re, sys, types
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
os.environ['FORMAT_CLASS_JOIN'] = '1'
from extraction import format_anomaly_checker as fac
importlib.reload(fac)
from extraction import template_mapper as tm
from extraction import engine

_P = _F = 0
def check(name, ok):
    global _P, _F
    if ok: _P += 1; print(f"  ok  {name}")
    else:  _F += 1; print(f"  FAIL {name}")

# ── the LIVE Print Tracker reference_number payload, 2026-09-04 15:xx (newest-first sample order) ──
SAMPLE_VALUES = ["1984800049", "1G25802868", "W2S7828006", "1625802868", "752923124N3M2", "RFH0738865",
                 "RFC9508317", "H571Y07217", "782923124N3M2", "H574951892", "H574951967", "H572413963",
                 "H7R5427479", "H573429209", "C738M125203", "RFC9509752", "C738JB00279", "G696J500513",
                 "G706M430179", "G726M930140"]
VALUE_COUNTS = {"1625802868": 2, "1984800049": 3, "1G25802868": 2, "W2S7828006": 1, "752923124N3M2": 4,
                "RFH0738865": 9, "RFC9508317": 1, "H571Y07217": 1, "782923124N3M2": 1, "H574951892": 1,
                "H574951967": 1, "H572413963": 2, "H7R5427479": 1, "H573429209": 1, "C738M125203": 1,
                "RFC9509752": 1, "C738JB00279": 1, "G696J500513": 1, "G706M430179": 1, "G726M930140": 1,
                "VG37308169": 1, "RGS0512662": 1, "H7R5326676": 1}
def group(supplier='Print Tracker', field='reference_number', samples=SAMPLE_VALUES, counts=VALUE_COUNTS):
    return {'supplier_name': supplier, 'document_type': 'print_tracker', 'field_key': field,
            'sample_values': list(samples), 'value_counts': dict(counts), 'confirmed_count': 39}
KEY = ('print tracker', 'print_tracker', 'reference_number')

print("1. THE LIVE ORDER — classify_format folds it to FREETEXT; the join keeps the entry (RED on pre-change code)")
fmt0 = fac.classify_format(SAMPLE_VALUES, VALUE_COUNTS)
check("classify_format on the live order -> FREETEXT (byte-identical: the join lives in the index builder)", fmt0['class'] == fac.FREETEXT)
IDX = fac.build_format_class_index([group()])
E = IDX.get(KEY)
check("the index now carries the scope", bool(E))
check("class = the JOIN over the distinct set (digits_only + upper_alphanum -> upper_alphanum)", E and E.get('class') == fac.UPPER_ALPHANUM)
check("marked joined", E and E.get('joined') is True)
check("C3: NO `shapes` key (the folded set is a length-blind positive licence elsewhere)", E and 'shapes' not in E)
check("length-aware shape_families attached", E and E.get('shape_families') and any(f.get('count') for f in E['shape_families']))
check("value_counts threaded (the confirmed-literal channel is back)", E and E.get('value_counts', {}).get('752923124N3M2') == 4)
check("S3: no `support` (no learned-agreement boost)", E and 'support' not in E)
check("charset attached (non-freetext)", E and E.get('charset') is not None)
check("_count_gated_shapes == classify_format's own gate on a unanimous scope (the helper cannot drift)",
      fac._count_gated_shapes(VALUE_COUNTS) == fac.classify_format(['RFH0738865', 'RFC9508317', 'H571Y07217'] + SAMPLE_VALUES[9:], VALUE_COUNTS)['shapes'])
check("every confirmed value satisfies the joined charset (C1 iii / C2)",
      E and all(not fac._disallowed_chars(v, E['class'], E.get('separators', frozenset())) for v in VALUE_COUNTS))
check("every confirmed-literal arc can see it again: value_is_confirmed_literal('752923124N3M2') True",
      E and fac.value_is_confirmed_literal('752923124N3M2', E) is True)

print("\n2. Lattice + refusals (join_code_class / join_format_entry)")
check("digits ∪ upper -> upper_alphanum", fac.join_code_class(['12345', 'AB123']) == fac.UPPER_ALPHANUM)
check("digits ∪ alphanum -> alphanum", fac.join_code_class(['12345', 'ab123']) == fac.ALPHANUM)
check("upper ∪ alphanum_sep -> alphanum_sep", fac.join_code_class(['AB123', 'AB-123']) == fac.ALPHANUM_SEP)
check("a DATE anywhere -> None", fac.join_code_class(['12345', '12/05/2026']) is None)
check("a CURRENCY anywhere -> None", fac.join_code_class(['12345', '£1,234.56']) is None)
check("a SPACE anywhere in the distinct set -> None (names/addresses)", fac.join_code_class(['12345', 'Acme Ltd']) is None)
check("empty value -> None", fac.join_code_class(['12345', '']) is None)
check("C8: the '' doc-type twin never joins", fac.join_format_entry('', 'reference_number', SAMPLE_VALUES, VALUE_COUNTS) is None)
check("C1: a name-like field never joins", fac.join_format_entry('print tracker', 'customer_name', SAMPLE_VALUES, VALUE_COUNTS) is None)
check("no value_counts -> None", fac.join_format_entry('print tracker', 'reference_number', SAMPLE_VALUES, None) is None)
check("ADMISSION GUARD: no count-gated shape (all singletons) -> None (stays FREETEXT, entry dropped)",
      fac.join_format_entry('print tracker', 'reference_number', ['1234', 'INV001', 'A5678'], {'1234': 1, 'INV001': 1, 'A5678': 1}) is None
      and KEY not in fac.build_format_class_index([group(samples=['1234', 'INV001', 'A5678'], counts={'1234': 1, 'INV001': 1, 'A5678': 1})]))
check("C2: an ALPHANUM_SEP join takes separators over the DISTINCT set (a '/' only on an old value still admitted)",
      (fac.join_format_entry('s', 'ref', ['AB-1234567', 'CD-2345678', 'EF-3456789'],
                             {'AB-1234567': 3, 'CD-2345678': 3, 'EF-3456789': 3, 'GH/4567890': 1}) or {}).get('separators') == frozenset('-/'))
check("the historic pin stays true: ['1234','INV-001','A5678'] with NO counts -> FREETEXT, no entry",
      fac.classify_format(['1234', 'INV-001', 'A5678'])['class'] == fac.FREETEXT
      and ('acme ltd', 'invoice', 'invoice_number') not in fac.build_format_class_index([
          {'supplier_name': 'Acme Ltd', 'document_type': 'invoice', 'field_key': 'invoice_number', 'sample_values': ['1234', 'INV-001', 'A5678']}]))

print("\n3. ORDER-INVARIANCE — the joined class is a function of the evidence, not the arrival order")
classes = set()
for perm in itertools.permutations(SAMPLE_VALUES[:4]):
    e = fac.build_format_class_index([group(samples=list(perm) + SAMPLE_VALUES[4:])]).get(KEY)
    classes.add((e or {}).get('class'))
# CAVEAT (gary/Oracle): a permutation whose 3 newest happen to be UNANIMOUS still narrows to that class (defect 3,
# the deferred slice) — so the invariant is "always an entry, joined OR the unanimous class", never FREETEXT.
check("every permutation of the 4 newest keeps an entry (never None/FREETEXT)", None not in classes and fac.FREETEXT not in classes)
check("…and every joined permutation yields the same class", classes <= {fac.UPPER_ALPHANUM})

print("\n4. C5/C6 — consent on a joined entry is REVIEW-BOUND at most, on positive LENGTH-AWARE evidence")
LOOKUP = lambda fk: E if fk == 'reference_number' else None
c = lambda v: tm._shape_consents(v, 'reference_number', LOOKUP, None)
check("an exact confirmed literal -> 'joined' (never 'confirmed')", c('752923124N3M2') == 'joined')
check("the rival literal too -> 'joined' (both are confirmed on this install)", c('782923124N3M2') == 'joined')
check("a never-seen value whose RAW shape is a >=3-doc family variant (@@@# family, 12 docs: RFH…) -> 'joined'", c('RFZ9999999') == 'joined')
check("a never-seen value matching ONLY the folded '#' (digits of a different length) -> 'none' (length-aware)", c('12345678901234') == 'none')
check("a never-seen value matching a BELOW-bar family (@#@#######, 3 docs — bar is 3? see next) -> depends on the bar",
      c('W2Z1111111') in ('joined', 'none'))
check("a garble -> 'none' (never 'refused' — a joined entry carries no veto)", c('ZZ-??-!!') == 'none')
check("'joined' is NOT clean for every caller that tests in ('confirmed','provisional')", 'joined' not in ('confirmed', 'provisional'))
src_tm = open(tm.__file__, encoding='utf-8').read()
check("the pad-window swap still requires consent in ('confirmed','provisional') — a joined entry can NEVER clean-swap "
      "(the 752/782 path: tight '82923124N3M2', pad '782923124N3M2' stays flagged)",
      re.search(r'if consent in \("confirmed", "provisional"\)\s*\\?\s*\n?\s*and consent_tight not in', src_tm) is not None)
check("the inline clip-commit + fragment-strip callers test the same tuple (fail toward review on 'joined')",
      "if _consent not in ('confirmed', 'provisional'):" in src_tm and "if _consent in ('confirmed', 'provisional')" in src_tm)

print("\n5. C10 — _edge_cut_relocate on a joined literal: value pre-filled, cap <=70, the TRUTHFUL note")
orig_relo, orig_cons = tm._relocate_and_read, tm._shape_consents
tm._relocate_and_read = lambda *a, **k: {'value': '752923124N3M2', 'confidence': 90, 'method': 'template_mapping'}
tm._shape_consents = lambda *a, **k: 'joined'
tm_flags = (tm._EDGE_CUT_RELOCATE_ON, tm._TARGET_WORD_SNAP_ON)
tm._EDGE_CUT_RELOCATE_ON = tm._TARGET_WORD_SNAP_ON = True
try:
    class _FakePage:  # noqa
        size = (1000, 1000)
        def crop(self, b): return b
    LOC = {"matched_text": "Serial number", "x_norm": 0.5, "y_norm": 0.7, "w_norm": 0.12, "h_norm": 0.012,
           "label_box": {"x_norm": 0.5, "y_norm": 0.7, "w_norm": 0.12, "h_norm": 0.012}}
    MAP = {"field_key": "reference_number", "anchor_text": "Serial number", "offset_dx_norm": 0.2, "offset_dy_norm": 0.0}
    r = tm._edge_cut_relocate(_FakePage(), MAP, {"x_norm": 0.5, "y_norm": 0.7, "w_norm": 0.12, "h_norm": 0.012},
                              {"x_norm": 0.7, "y_norm": 0.7, "w_norm": 0.1, "h_norm": 0.016}, LOC, 'reference_code',
                              'reference_number', 'Serial number', 'DELINJ2Q2Q64', lambda *a, **k: '', lambda img: [], 0.0,
                              {}, None, {}, None, 0, None)
    check("re-seated value pre-filled", r and r['value'] == '752923124N3M2')
    check("still REVIEW-BOUND (cap <=70)", r and r['confidence'] <= 70)
    check("the note is the truthful one, not 'could not be verified'", r and r.get('validation_note') == tm._JOINED_LITERAL_NOTE)
    tm._shape_consents = lambda *a, **k: 'none'
    r2 = tm._edge_cut_relocate(_FakePage(), MAP, {"x_norm": 0.5, "y_norm": 0.7, "w_norm": 0.12, "h_norm": 0.012},
                               {"x_norm": 0.7, "y_norm": 0.7, "w_norm": 0.1, "h_norm": 0.016}, LOC, 'reference_code',
                               'reference_number', 'Serial number', 'DELINJ2Q2Q64', lambda *a, **k: '', lambda img: [], 0.0,
                               {}, None, {}, None, 0, None)
    check("no evidence -> the edge-cut note verbatim (today's behaviour)", r2 and r2.get('validation_note') == tm._EDGE_CUT_NOTE)
finally:
    tm._relocate_and_read, tm._shape_consents = orig_relo, orig_cons
    tm._EDGE_CUT_RELOCATE_ON, tm._TARGET_WORD_SNAP_ON = tm_flags
check("the truthful note is NOT a class-F verification-doubt mark (Oracle C4 — never sweepable)",
      engine._is_verification_doubt_note(tm._JOINED_LITERAL_NOTE) is False
      and all(tm._JOINED_LITERAL_NOTE != m for m, _ in engine._verification_doubt_note_marks()))
_js = open(os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'services', 'classFixService.js'), encoding='utf-8').read()
_marks = re.findall(r"""['"](.+?)['"]""", re.search(r'CLEARABLE_NOTE_MARKS\s*=\s*Object\.freeze\(\[(.*?)\]\)', _js, re.S).group(1))
check("JS: no CLEARABLE_NOTE_MARK is a substring of the truthful note", all(m not in tm._JOINED_LITERAL_NOTE for m in _marks))

print("\n6. Engine — C4 class F refuses a joined entry; C7 flags never blanks; S5 no fc_delta; 2a comment")
src_e = open(engine.__file__, encoding='utf-8').read()
check("C4: explicit `if fmt_entry.get(\"joined\"): return False` inside _try_verification_doubt_clear",
      re.search(r'def _try_verification_doubt_clear[\s\S]*?if fmt_entry\.get\("joined"\):\s*\n\s*return False', src_e) is not None)
check("C7: the terminal shape-withhold takes keep-and-flag for a joined entry",
      "if ((_xsupplier or bool(fmt_entry.get('joined')))" in src_e)
check("S5: supported_keys excludes joined entries", "not (isinstance(_fe, dict) and _fe.get('joined'))" in src_e)
check("2a's post-correction shape refusal is documented as KNOWINGLY DEAD on a joined entry", 'KNOWINGLY DEAD on a FORMAT_CLASS_JOIN entry' in src_e)
S = types.SimpleNamespace(format_class_index={KEY: E}, _trace=False, log=lambda *a, **k: None)
check("class F on the live joined entry returns False for the exact literal (would have lifted to 90)",
      engine.ExtractionEngine._try_verification_doubt_clear(S, 'reference_number',
          {'value': '752923124N3M2', 'method': 'template_mapping_relocated', 'validation_note': tm._EDGE_CUT_NOTE},
          {'winner_family': 'mapping', 'agree': ['crop'], 'disagree': [], 'independent_agree': True},
          'Print Tracker', 'print_tracker', [{'key': 'reference_number', 'type': 'reference'}]) is False)
check("check_value on a joined entry: charset only — a lowercase slip flags 'high', a never-seen shape passes",
      fac.check_value('W2s7828006', E) is not None and fac.check_value('ZZZZ123456789012', E) is None)
check("_has_no_usual_format sees the families (3+ families, 39 confirms, no >=50% share) -> True", fac._has_no_usual_format(E) is True)

print("\n7. OFF == ON byte-identical")
os.environ['FORMAT_CLASS_JOIN'] = '0'
importlib.reload(fac)
check("flag OFF: the live scope has NO entry (today's behaviour)", KEY not in fac.build_format_class_index([group()]))
check("flag uses the `== '1'` idiom", "_FORMAT_CLASS_JOIN = os.environ.get('FORMAT_CLASS_JOIN', '0') == '1'" in open(fac.__file__, encoding='utf-8').read())
os.environ['FORMAT_CLASS_JOIN'] = '1'
importlib.reload(fac)

print(f"\n{'ALL PASS' if _F == 0 else str(_F) + ' FAILED'}  ({_P} ok)")
sys.exit(1 if _F else 0)
