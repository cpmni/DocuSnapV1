#!/usr/bin/env python3
"""
tests/test_supplier_pin.py
--------------------------
Operator "Resolve" supplier PIN (draw-tool/identity Part B). When the operator resolves a
branding-conflict issuer, reprocess passes `pinned_supplier`; the engine must force that name as the
issuer — OVERRIDING the logo/template/anchor read (which is why a colliding-logo doc reverts today) —
and keep it REVIEW-BOUND (method 'operator_pin' + a validation_note, so it can never auto-file). It
writes NO logo/hint learning. Kill switch SUPPLIER_PIN (default on) → off is byte-identical.

Bypasses PIL/OCR: Stage 0.5 / Stage 2 are monkeypatched to deterministic dicts (mirrors
test_supplier_name_precedence.py), isolating engine.py's pin precedence from geometry.

Run: cd python_backend && PYTHONUTF8=1 py -3.12 tests/test_supplier_pin.py
"""
import os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction.engine import ExtractionEngine
from extraction import template_mapper, anchor as anchor_module

fails = 0
def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond: fails += 1

FIELD_DEFS = [
    {'key': 'supplier_name', 'label': 'Document Issuer', 'type': 'text'},
    {'key': 'invoice_number', 'label': 'Invoice Number', 'type': 'reference'},
]
PLACEHOLDER_ANCHORS = [{
    'field_key': 'supplier_name', 'anchor_label': 'x', 'direction': 'right',
    'supplier_name': '', 'document_type': '', 'usage_count': 1, 'confidence': 0.5,
}]
PIN = 'Marlowe Medical Supplies'
RIVAL = 'Ridgeway Plant Hire'
# The rival read a later stage would produce (the coarse-logo collision) — injected via the anchor
# stub so it lands AFTER the pin, testing that the pin survives the final re-resolve (Oracle C4).
RIVAL_ANCHOR = {'supplier_name': {'value': RIVAL, 'confidence': 88, 'method': 'anchor_crop', 'anchor': 'logo'}}


def run(pinned_supplier, anchor_result, pin_env='1'):
    orig_map, orig_anc = template_mapper.extract_with_mappings, anchor_module.extract_with_anchors
    template_mapper.extract_with_mappings = lambda *a, **kw: {}
    anchor_module.extract_with_anchors    = lambda *a, **kw: dict(anchor_result)
    old = os.environ.get('SUPPLIER_PIN'); os.environ['SUPPLIER_PIN'] = pin_env
    try:
        eng = ExtractionEngine(mode='smart', emit_fn=lambda *_a: None)
        res = eng.extract(
            ocr_text='Acme\nInvoice Number: INV-1\nTotal: 10',
            page_images=['fake'], filename='marlowe.pdf', field_defs=FIELD_DEFS,
            hints=[], anchors=PLACEHOLDER_ANCHORS, logos=[], templates=[],
            document_type='Invoice', document_slug='invoice',
            supplier_name=None, pinned_supplier=pinned_supplier)
        return res, eng
    finally:
        template_mapper.extract_with_mappings = orig_map
        anchor_module.extract_with_anchors    = orig_anc
        if old is None: os.environ.pop('SUPPLIER_PIN', None)
        else: os.environ['SUPPLIER_PIN'] = old

def sup(res): return (res.get('supplier_name') or {})

print("PIN overrides the rival read + is review-bound:")
r, eng = run(PIN, RIVAL_ANCHOR)
check(f"final supplier_name == the pin ('{PIN}'), NOT the rival logo/anchor read", sup(r).get('value') == PIN)
check("method is 'operator_pin'", sup(r).get('method') == 'operator_pin')
check("carries a validation_note (REVIEW-BOUND — the note blocks auto-file at every floor)", bool(sup(r).get('validation_note')))
check("_supplier_name (the scope key) is the pin", (r.get('_supplier_name') or '') == PIN)
check("pin joined accepted_issuers (branding cross-check won't re-flag it — Oracle C5)",
      eng._accept_norm(PIN) in eng.accepted_issuers)

print("\nKill switch SUPPLIER_PIN=0 → pin ignored (byte-identical: the rival wins):")
r0, _ = run(PIN, RIVAL_ANCHOR, pin_env='0')
check("supplier_name falls back to the rival read (pin had no effect)", sup(r0).get('value') == RIVAL)
check("method is NOT operator_pin when off", sup(r0).get('method') != 'operator_pin')

print("\nControl — no pin → today's behaviour (rival read stands):")
rn, _ = run(None, RIVAL_ANCHOR)
check("no pin → supplier_name is the rival read", sup(rn).get('value') == RIVAL)
check("no pin → no operator_pin note manufactured", 'operator_pin' != sup(rn).get('method'))

print("\nPinned trade-off (no-silent-auto-file): the operator_pin read ALWAYS carries the note")
r2, _ = run(PIN, {})   # even with NO rival read, the pin is noted
check("pin with no competing read still noted (can't slip to auto-file)", bool(sup(r2).get('validation_note')) and sup(r2).get('value') == PIN)

print(f"\n{'PASS' if not fails else 'FAIL'} — {fails} failure(s)")
sys.exit(1 if fails else 0)
