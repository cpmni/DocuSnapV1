#!/usr/bin/env python3
"""
tests/test_letterhead_prefill.py
--------------------------------
Slice 0 verification gate — the cold-start letterhead PREFILL (Chris r11 card #4; gary→Oracle
SIGN-OFF-WITH-CONDITIONS 2026-08-21). LETTERHEAD_ISSUER already reads a fresh install's letterhead
company; LETTERHEAD_PREFILL (DEFAULT OFF) lands that SAME name INTO the Document Issuer box instead of
leaving it blank behind a "Use 'X'" button — held in Review two ways (conf 69 AND a note), plants no
learning, never auto-files.

This is the NON-VACUOUS cold pass Oracle asked for: it drives the real engine seam on a PRISTINE read
(no hints/anchors/logos/templates), where the suggest/prefill block actually fires — the synthetic
corpus is blind to it precisely because that corpus carries confirmed history and resolves the issuer
another way.

Bypasses PIL/OCR: Stage 0.5 / Stage 2 are monkeypatched to {} (mirrors test_supplier_pin.py), so the
supplier is genuinely UNRESOLVED when the letterhead block runs.

Run: cd python_backend && PYTHONUTF8=1 py -3.12 tests/test_letterhead_prefill.py
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

# A clean cold letterhead (address block corroborates the name — pick_issuer's text arm resolves it).
CLEAN = ("Harrowgate Timber Supplies\n14 Mill Street\nLeeds LS1 4DF\n"
         "Invoice Number: INV-1\nInvoice Date: 01/01/2026\nTotal: 10")
# Two comparable companies in the band → pick_issuer ABSTAINS (the no-fill-ambiguous guard lives in the
# reader, so prefill can never fire here).
AMBIG = ("Alpha Holdings Ltd\nBravo Interiors Ltd\nInvoice\nInvoice Number: INV-2\nTotal: 10")
# A single company at the top with an address, which may in truth be the RECIPIENT — pick_issuer cannot
# tell, so it returns it. The gate: prefill must still HOLD it (conf 69 + the sender-vs-customer note),
# never silently file it. This is the known buyer-issued/recipient misfile class failing toward review.
RECIP = ("Bramblewood Builders Ltd\n9 Kiln Road\nBristol BS1 5TR\n"
         "Order Number: PO-1\nTotal: 10")
# No letterhead at all — the block finds nothing; both flag states must be inert.
BARE = ("WORKSHEET 38\nJob 4471-2201-9\nQty 4\nSigned ......\n")


def run(ocr_text, prefill):
    """Drive extract() cold with LETTERHEAD_ISSUER=1 and LETTERHEAD_PREFILL=prefill ('0'|'1')."""
    orig_map, orig_anc = template_mapper.extract_with_mappings, anchor_module.extract_with_anchors
    template_mapper.extract_with_mappings = lambda *a, **kw: {}
    anchor_module.extract_with_anchors    = lambda *a, **kw: {}
    saved = {k: os.environ.get(k) for k in ('LETTERHEAD_ISSUER', 'LETTERHEAD_PREFILL')}
    os.environ['LETTERHEAD_ISSUER'] = '1'
    os.environ['LETTERHEAD_PREFILL'] = prefill
    try:
        eng = ExtractionEngine(mode='smart', emit_fn=lambda *_a: None)
        return eng.extract(
            ocr_text=ocr_text, page_images=['fake'], filename='cold.pdf', field_defs=FIELD_DEFS,
            hints=[], anchors=[], logos=[], templates=[],
            document_type='Invoice', document_slug='invoice',
            supplier_name=None, pinned_supplier=None)
    finally:
        template_mapper.extract_with_mappings = orig_map
        anchor_module.extract_with_anchors    = orig_anc
        for k, v in saved.items():
            if v is None: os.environ.pop(k, None)
            else: os.environ[k] = v

def sup(res): return (res.get('supplier_name') or {})

NAME = 'Harrowgate Timber Supplies'

print("OFF — the value-less suggest is unchanged (byte-identical behaviour):")
off = run(CLEAN, '0')
check("PREFILL off: supplier_name.value stays None (never asserts)", sup(off).get('value') is None)
check("PREFILL off: the letterhead name is SUGGESTED", sup(off).get('suggested_supplier') == NAME)
check("PREFILL off: the suggest note is present (arms the 'Use X' button)", bool(sup(off).get('validation_note')))

print("\nON — the name lands in the box, but held two ways (C1) and never as a button (C2):")
on = run(CLEAN, '1')
check(f"PREFILL on: supplier_name.value == the letterhead name ('{NAME}')", sup(on).get('value') == NAME)
check("C1: confidence is 69 (< the 70 review threshold — held by confidence AND note)", sup(on).get('confidence') == 69)
check("C3: method token is 'letterhead_prefill' (matches no note-demoter)", sup(on).get('method') == 'letterhead_prefill')
check("C2: a note is present (the auto-file block)", bool(sup(on).get('validation_note')))
check("C2: the note names the sender-vs-customer check", 'sender, not the customer' in (sup(on).get('validation_note') or ''))
check("C2: NO suggested_supplier on the filled row (no redundant 'Use X' button)", not sup(on).get('suggested_supplier'))
check("the doc is held for review", bool(on.get('_needs_review')))

print("\nno-fill-ambiguous — the reader abstains, so prefill cannot fire (guard lives in pick_issuer):")
amb = run(AMBIG, '1')
check("two comparable companies → supplier_name.value stays None even with PREFILL on", sup(amb).get('value') is None)

print("\nrecipient / single-company page — prefill fills but FAILS TOWARD REVIEW (the misfile class):")
rec = run(RECIP, '1')
check("a single-company page is filled (pick_issuer cannot tell issuer from recipient)",
      sup(rec).get('value') == 'Bramblewood Builders Ltd')
check("...but held: confidence 69 AND a note (never silently filed under a wrong company)",
      sup(rec).get('confidence') == 69 and bool(sup(rec).get('validation_note')))
check("...and the note tells the human to check sender-vs-customer",
      'sender, not the customer' in (sup(rec).get('validation_note') or ''))

print("\ninert when there is no letterhead — OFF == ON (nothing to fill):")
bare_off, bare_on = run(BARE, '0'), run(BARE, '1')
check("no letterhead → no value either way", sup(bare_off).get('value') is None and sup(bare_on).get('value') is None)
check("no letterhead → no suggestion either way",
      not sup(bare_off).get('suggested_supplier') and not sup(bare_on).get('suggested_supplier'))

print()
if fails:
    print(f"FAILED: {fails} check(s)")
    sys.exit(1)
print("ALL PASS")
