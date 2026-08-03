"""test_template_code_edge_clean.py — Slice A agree-branch EDGE-DEBRIS heal pins
(reggie+gary → Oracle SIGN-OFF-W/COND, fork RULED reggie/witness-equality, 2026-08-03 evening —
docs/oracle_log.md).

Run: py -3.12 python_backend/tests/test_template_code_edge_clean.py

WHAT THIS PINS. The label-tail bleed class: a taught value box a few px off its label catches the
label's trailing "." on slightly-rotated siblings → every read commits '. DN-60902' (flagged via
shapewarn on the drift rung; SILENT clean@90 on the absolute rung). `_pick_fuller_code`'s agree
branch (cores equal) used to discard the computed clean inline read. Now (gated
TEMPLATE_CODE_EDGE_CLEAN): heal iff strip_edges(rigid) == inline VERBATIM and the learned shape
does not reject the cleaned value.

THE ANTI-LOOSEN CONTRACT:
  • NAMED-DELIBERATE (Oracle A-C1): a COLD supplier's '#12345' heals to '12345' when the inline
    read is sigil-less — do NOT "fix" this into cold-inert (the shape model then bootstraps DIRTY:
    dotted confirms become the ≥3-confirm shape, and the :593 un-clip branch already commits inline
    surfaces cold on WEAKER evidence). Shape history, once formed, vetoes the strip.
  • Interior disagreements (DN.-60902 / DN 60902 / em-dash) NEVER heal — verbatim equality is the
    whole safety; internal rewrites route to review.
  • Inline carrying the debris itself → no heal (two witnesses of real ink → human).
  • OFF = byte-identical.
"""
import os, sys, inspect
try: sys.stdout.reconfigure(encoding='utf-8')
except Exception: pass
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(_HERE, '..')))
sys.path.insert(0, _HERE)
os.environ['TEMPLATE_CODE_EDGE_CLEAN'] = '1'
from extraction import template_mapper as tm                       # noqa: E402
from test_template_mapper import _run_del                          # noqa: E402  (has __main__ guard)

fails = 0
def check(label, cond):
    global fails
    print(('OK  ' if cond else 'BAD ') + label)
    if not cond:
        fails += 1

def pick(rigid, inline, field_key='delivery_number', format_lookup=None, on=True):
    saved = tm._CODE_EDGE_CLEAN_ON
    tm._CODE_EDGE_CLEAN_ON = on
    try:
        return tm._pick_fuller_code(rigid, 80, inline, 80, 'Delivery Note No.', 'alphanumeric',
                                    None, field_key=field_key, format_lookup=format_lookup)
    finally:
        tm._CODE_EDGE_CLEAN_ON = saved

print("_strip_code_edges:")
check("'. DN-60902' -> 'DN-60902'", tm._strip_code_edges('. DN-60902') == 'DN-60902')
check("interior untouched: 'DN.-60902' stays", tm._strip_code_edges('DN.-60902') == 'DN.-60902')
check("'№ 456' -> '456'", tm._strip_code_edges('№ 456') == '456')

print("\nAgree-branch heal (unit — the shared decision point both rungs route through):")
r = pick('. DN-60902', 'DN-60902')
check("dotted rigid + clean inline -> heals to 'DN-60902'", r and r.get('value') == 'DN-60902')
check("...method exactly template_mapping (no _shapewarn)", r and r.get('method') == 'template_mapping')
check("...conf 90, NO validation_note key",
      r and r.get('confidence') == 90 and 'validation_note' not in r)
check("trailing ':' heals", (pick('DN-60902:', 'DN-60902') or {}).get('value') == 'DN-60902')
check("'№ 456' heals to '456'", (pick('№ 456', '456') or {}).get('value') == '456')

print("\nRefusals (fail-toward-review — each returns None = today's path verbatim):")
check("OFF -> None on the dotted-agree case (kill-switch pin)",
      pick('. DN-60902', 'DN-60902', on=False) is None)
check("interior debris 'DN.-60902' vs 'DN-60902' -> None", pick('DN.-60902', 'DN-60902') is None)
check("inline carries the debris too ('. DN-60902' both) -> None",
      pick('. DN-60902', '. DN-60902') is None)
check("spaced inline 'DN 60902' vs rigid '. DN-60902' -> None (interior rewrite = review)",
      pick('. DN-60902', 'DN 60902') is None)
check("equal clean surfaces -> None (no spurious commit)", pick('DN-60902', 'DN-60902') is None)
check("punctuation-only rigid -> None (empty core)", pick('...', 'DN-60902') is None)

print("\nSigil discipline (Oracle A-C1 — the named-deliberate trade-off):")
_saved_chk = tm._check_learned_format
try:
    tm._check_learned_format = lambda t, e: ('shape-reject' if t == '12345' else None)
    check("'#12345' + shape history REJECTING '12345' -> None (sigil preserved, review path)",
          pick('#12345', '12345', format_lookup=lambda fk: {'has': 'history'}) is None)
finally:
    tm._check_learned_format = _saved_chk
check("PIN NAMED-DELIBERATE: COLD '#12345' (no shape history) heals to '12345'",
      (pick('#12345', '12345', format_lookup=None) or {}).get('value') == '12345')

print("\nUntouched branches (regression):")
r = pick('N-93159', 'DN-93159')
check("suffix un-clip still commits inline 'DN-93159'", r and r.get('value') == 'DN-93159')
r = tm._pick_fuller_code('HAL7ea7ca', 60, 'DN-78756', 90, 'Delivery Note No.', 'alphanumeric',
                         None, field_key='delivery_number', format_lookup=None)
check("genuine disagreement still flags (shape_warn path, inline higher-conf)",
      r and r.get('value') == 'DN-78756' and 'shapewarn' in (r.get('method') or ''))
check("rigid fuller (inline suffix of rigid) still kept", pick('DN-93159', '93159') is None)

print("\nIntegration — the ABSOLUTE-path silent class (Oracle A-C2: dotted abs read used to")
print("commit clean@90 with NO note; the shared reconcile now heals it):")
got = _run_del('. DN-60902', 'DN-60902', value_text='DN-60902').get('delivery_number', {})
check("fast path: '. DN-60902' healed to 'DN-60902'", got.get('value') == 'DN-60902')
check("...clean commit (no shapewarn, no note)",
      'shapewarn' not in (got.get('method') or '') and not got.get('validation_note'))
_saved_edge = tm._CODE_EDGE_CLEAN_ON
try:
    tm._CODE_EDGE_CLEAN_ON = False
    got = _run_del('. DN-60902', 'DN-60902', value_text='DN-60902').get('delivery_number', {})
    check("OFF integration: dotted '. DN-60902' commits as today (byte-identical)",
          got.get('value') == '. DN-60902')
finally:
    tm._CODE_EDGE_CLEAN_ON = _saved_edge

print("\nWiring (source):")
src = inspect.getsource(tm._pick_fuller_code)
check("heal gated on _CODE_EDGE_CLEAN_ON inside the agree branch", '_CODE_EDGE_CLEAN_ON' in src)
check("witness-equality is the predicate (stripped == inline verbatim)",
      'stripped == (inline_val' in src)
check("shape consent required (_format_rejects on the CLEANED value)",
      '_format_rejects(stripped' in src)
check("default OFF", os.environ.get('TEMPLATE_CODE_EDGE_CLEAN') == '1'
      and "os.environ.get('TEMPLATE_CODE_EDGE_CLEAN', '0')" in inspect.getsource(tm).split('def ')[0][:120000])
isrc = inspect.getsource(tm._inline_code_reconcile)
check("call site threads field_key + format_lookup (reaches BOTH rungs via the shared fn)",
      'field_key=field_key' in isrc and 'format_lookup=format_lookup' in isrc)
dsrc = inspect.getsource(tm._relocate_and_read)
check("stale drift-flag comment corrected (A-C4: states Default ON, cites the flip gate)",
      'Default ON since the forced-drift gate' in dsrc)

print(f"\n{'ALL PASS' if fails == 0 else str(fails) + ' FAILURES'}")
sys.exit(1 if fails else 0)
