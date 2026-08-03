"""test_template_frag_clip.py — NIGHT-round pins: A2/C1 fragment strip · C2a clip commit ·
provisional consent channel (gary+reggie → Oracle NIGHT SIGN-OFF-W/COND 2026-08-03,
docs/oracle_log.md).

Run: py -3.12 python_backend/tests/test_template_frag_clip.py

WHAT THIS PINS.
A2/C1 (TEMPLATE_CODE_FRAG_CLEAN): an ALNUM label-tail fragment ('o. DN-67428' — the 'o' of
"Delivery Note No.") heals ONLY when the fragment is a case-insensitive suffix of the mapping's
OWN anchor label tail + the remainder equals the inline witness VERBATIM + the consent ladder
passes (confirmed verdict FINAL → provisional taught skeleton → 1-letter floor).
C2a (TEMPLATE_CLIP_COMMIT): a right-clipped rigid whose core strictly prefixes the inline core
commits the inline CLEAN — killing the factually-false "manually mapped value differs" note —
only under three legs: >=4-char prefix corroboration, consent-ladder skeleton accept, and the
locate-token glyph corroboration with the S1 LADDER-PROVENANCE bit (a locate-fallback inline
must never witness itself).
S2: the provisional channel is invisible to every veto path (main format index + _format_rejects).
S5: branch order (un-clip → frag-strip → C2a → conf race) is load-bearing.
"""
import os, sys, inspect
try: sys.stdout.reconfigure(encoding='utf-8')
except Exception: pass
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(_HERE, '..')))
os.environ['TEMPLATE_CODE_FRAG_CLEAN'] = '1'
os.environ['TEMPLATE_CLIP_COMMIT'] = '1'
from extraction import template_mapper as tm                       # noqa: E402
from extraction import format_anomaly_checker as fac               # noqa: E402

fails = 0
def check(label, cond):
    global fails
    print(('OK  ' if cond else 'BAD ') + label)
    if not cond:
        fails += 1

ANCHOR = 'Delivery Note No.'
def entry_for(*samples):
    return fac.build_format_class_index([{'supplier_name': 's', 'document_type': 'd',
                                          'field_key': 'delivery_number',
                                          'sample_values': list(samples),
                                          'value_counts': {v: 3 for v in samples}}]) \
              .get(('s', 'd', 'delivery_number'))

DN_ENTRY = entry_for('DN-11111', 'DN-22222', 'DN-33333')
def dn_lookup(fk): return DN_ENTRY
PROV = fac.build_provisional_shape_index([{'supplier_name': 's', 'document_type': 'd',
                                           'field_key': 'delivery_number', 'provisional': True,
                                           'sample_values': ['DN-99999']}])
def prov_lookup(fk, v):
    return fac.provisional_shape_accepts(v, PROV.get(('s', 'd', 'delivery_number')))

def pick(rigid, inline, anchor=ANCHOR, fl=None, pl=None, ladder=True, locate=None,
         rigid_conf=60, inline_conf=90):
    return tm._pick_fuller_code(rigid, rigid_conf, inline, inline_conf, anchor, 'alphanumeric',
                                None, field_key='delivery_number', format_lookup=fl,
                                provisional_lookup=pl, locate_token=locate,
                                inline_from_ladder=ladder)

# ── A2/C1 fragment strip ──────────────────────────────────────────────────────
print("A2/C1 fragment strip (label-suffix + verbatim + consent ladder):")
r = pick('o. DN-67428', 'DN-67428', fl=dn_lookup)
check("'o. DN-67428' heals to 'DN-67428' (confirmed-shape consent)",
      r and r.get('value') == 'DN-67428' and 'shapewarn' not in r.get('method', ''))
check("...no validation_note", r and 'validation_note' not in r)
r = pick('o. DN-99999', 'DN-99999', fl=None, pl=prov_lookup)
check("COLD supplier + provisional taught skeleton -> heals (the teach-first scenario)",
      r and r.get('value') == 'DN-99999')
r = pick('o. DN-67428', 'DN-67428', fl=None, pl=None)
check("no history at all: 1-LETTER fragment heals (ladder floor)",
      r and r.get('value') == 'DN-67428')
check("2-letter fragment WITHOUT consent -> refused ('No. DN-...' class)",
      pick('No. DN-67428', 'DN-67428', fl=None, pl=None) is None)
r = pick('No. DN-67428', 'DN-67428', fl=dn_lookup)
check("2-letter fragment WITH confirmed consent -> heals",
      r and r.get('value') == 'DN-67428')
check("fragment NOT a suffix of the anchor tail ('x.') -> refused (gary C1 pin)",
      pick('x. DN-67428', 'DN-67428', fl=dn_lookup, anchor='Delivery Note No.') is None)
check("digit fragment '2.' -> refused (value-material)",
      pick('2. DN-67428', 'DN-67428', fl=dn_lookup) is None)
check("fused fragment 'oDN-67428' (no separator) -> refused",
      pick('oDN-67428', 'DN-67428', fl=dn_lookup) is None)
NO_ENTRY = entry_for('NO-11111', 'NO-22222', 'NO-33333')
check("S4 decapitation: taught 'NO-#####' REFUSES stripped bare digits",
      pick('NO-12345', '12345', anchor='Order No.',
           fl=(lambda fk: NO_ENTRY)) is None)
check("confirmed entry REJECTING the stripped value is FINAL (no provisional fallback)",
      pick('o. XX99', 'XX99', fl=dn_lookup, pl=prov_lookup) is None)
check("remainder != inline verbatim -> refused",
      pick('o. DN 67428', 'DN-67428', fl=dn_lookup) is None)

# ── C2a clip commit ───────────────────────────────────────────────────────────
print("\nC2a right-clip clean commit (three legs, S1 provenance):")
r = pick('o. DN-6742', 'DN-67428', fl=dn_lookup, locate='DN-67428', ladder=True)
check("truncated 'o. DN-6742' -> inline 'DN-67428' committed CLEAN (no false note)",
      r and r.get('value') == 'DN-67428' and 'shapewarn' not in r.get('method', '')
      and 'validation_note' not in r)
r = pick('DN-6742', 'DN-67428', fl=dn_lookup, locate='DN-67428', ladder=True)
check("plain right-clip 'DN-6742' commits clean too", r and r.get('value') == 'DN-67428'
      and 'shapewarn' not in r.get('method', ''))
r = pick('o. DN-6742', 'DN-67428', fl=dn_lookup, locate='DN-67428', ladder=False)
check("S1: locate-FALLBACK inline (ladder=False) -> flagged path survives",
      r and 'shapewarn' in r.get('method', ''))
r = pick('o. DN-6742', 'DN-67428', fl=dn_lookup, locate='DN-99999', ladder=True)
check("locate token disagrees -> flagged path", r and 'shapewarn' in r.get('method', ''))
r = pick('o. DN-6742', 'DN-67428', fl=None, pl=None, locate='DN-67428', ladder=True)
check("no shape evidence -> flagged path (cold C2a never fires without provisional)",
      r and 'shapewarn' in r.get('method', ''))
r = pick('o. DN-6742', 'DN-67428', fl=None, pl=prov_lookup, locate='DN-67428', ladder=True)
check("provisional skeleton consents C2a on a cold teach-first supplier",
      r and r.get('value') == 'DN-67428' and 'shapewarn' not in r.get('method', ''))
r = pick('o. DN-67425', 'DN-67428', fl=dn_lookup, locate='DN-67428', ladder=True)
check("interior digit mismatch (67425 vs 67428) -> NOT a prefix -> flagged (D1 preserved)",
      r and 'shapewarn' in r.get('method', ''))
r = pick('D', 'DN-67428', fl=dn_lookup, locate='DN-67428', ladder=True)
check("sub-4-char prefix corroboration -> flagged (substance floor)",
      r is None or 'shapewarn' in (r.get('method') or ''))

# ── Switch + order pins ───────────────────────────────────────────────────────
print("\nSwitches + branch order:")
_f, _c = tm._CODE_FRAG_CLEAN_ON, tm._CLIP_COMMIT_ON
try:
    tm._CODE_FRAG_CLEAN_ON = False
    check("frag OFF -> 'o. DN-67428' agree case refused (byte-identical)",
          pick('o. DN-67428', 'DN-67428', fl=dn_lookup) is None)
    tm._CODE_FRAG_CLEAN_ON = _f
    tm._CLIP_COMMIT_ON = False
    r = pick('o. DN-6742', 'DN-67428', fl=dn_lookup, locate='DN-67428', ladder=True)
    check("clip OFF -> truncation falls to today's flagged path",
          r and 'shapewarn' in r.get('method', ''))
finally:
    tm._CODE_FRAG_CLEAN_ON, tm._CLIP_COMMIT_ON = _f, _c
r = pick('N-93159', 'DN-93159', fl=dn_lookup, locate='DN-93159', ladder=True)
check("S5 order: un-clip branch still fires FIRST (suffix class untouched)",
      r and r.get('value') == 'DN-93159' and 'shapewarn' not in r.get('method', ''))
src = inspect.getsource(tm._pick_fuller_code)
check("S5 order pinned in source (un-clip -> frag -> C2a -> conf race)",
      src.find('ni.endswith(na)') < src.find('_CODE_FRAG_CLEAN_ON')
      < src.find('_CLIP_COMMIT_ON') < src.find('inline_conf <= rigid_conf'))

# ── S2 provisional invisibility ───────────────────────────────────────────────
print("\nS2 — provisional channel invisible to every veto path:")
check("build_format_class_index SKIPS provisional entries",
      fac.build_format_class_index([{'supplier_name': 's', 'document_type': 'd',
                                     'field_key': 'x', 'provisional': True,
                                     'sample_values': ['A-1', 'A-2', 'A-3'],
                                     'value_counts': {'A-1': 1}}]) == {})
check("_format_rejects blind to provisional (no format_lookup -> False)",
      tm._format_rejects('anything', 'delivery_number', None) is False)
esrc = open(os.path.join(_HERE, '..', 'extraction', 'engine.py'), encoding='utf-8').read()
check("engine strips provisional rows before EVERY established index builder",
      "_solid = [e for e in (formats_data or [])" in esrc
      and "build_prefix_index(_solid)" in esrc and "build_format_class_index(_solid)" in esrc)
check("single consent helper (S2): provisional_lookup consumed only via _shape_consents",
      inspect.getsource(tm).count('provisional_lookup(field_key') == 1)

print(f"\n{'ALL PASS' if fails == 0 else str(fails) + ' FAILURES'}")
sys.exit(1 if fails else 0)
