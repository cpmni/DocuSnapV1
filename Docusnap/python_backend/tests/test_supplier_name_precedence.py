#!/usr/bin/env python3
"""
tests/test_supplier_name_precedence.py
---------------------------------------
Targeted regression coverage for the supplier_name precedence fix in
engine.py: an admin-drawn template mapping (Stage 0.5 — Settings → Templates
→ "Map a Field") must outrank Stage 0's generic template_fixed/
template_anchor guesses, AND survive Stage 2's "a taught anchor is ground
truth" override — without changing behaviour for templates that have no
manual mapping at all.

Context: a supplier's template had learned the WRONG company name
("Wjm Building Services Ltd" — actually the customer/"Invoice To" block, not
the supplier) as its fixed supplier_name. The user repeatedly corrected it in
review and even drew a manual Stage 0.5 mapping pointing at the real supplier
block on the page — but reprocess kept reverting to the wrong name. Tracing
engine.py's merge order found two structural gaps that, together, explain it:

  1. template_mapping's confidence ceiling is 90 (see template_mapper.py),
     which can never exceed template_fixed's fixed 95 — so a hand-placed
     mapping for a field the template ALSO carries a (possibly stale,
     auto-learned — _buildTemplateFields regenerates it from whatever was
     last confirmed) fixed_value for could never take effect, no matter how
     deliberately it was drawn.
  2. is_taught_override made ANY anchor_crop result unconditionally win over
     anything that wasn't itself an anchor_crop — including a just-applied,
     CORRECT template_mapping result. A field_anchors row taught while the
     pipeline still believed the wrong identity is itself mis-keyed (or aimed
     at the wrong block), so this let stale taught data silently re-poison a
     freshly fixed value, regardless of the new mapping's confidence.

The fix gives template_mapping*/template_mapping_expanded the same
"curated ground truth" standing anchor_crop already has: it now (a) refines
Stage 0's template_fixed/template_anchor unconditionally — the relationship
the comment in engine.py already documents Stage 0.5 as having ("optional,
additive REFINEMENT layer on the matched template") — and (b) is excluded
from anchor_crop's blanket override, so the two curated tiers settle their
disagreement on confidence (a fair contest) rather than one silently
clobbering the other by stage-order accident.

These checks bypass PIL/OCR entirely — extract_with_mappings and
extract_with_anchors are monkeypatched to return fixed dicts, mirroring
test_template_matcher.py's with_stub_hash convention. That is deliberate:
this file exercises engine.py's MERGE/PRECEDENCE rules in isolation, not
template_mapper's geometry or anchor's crop+re-OCR — both already have their
own dedicated test files (test_template_mapper.py, and anchor's behaviour is
exercised indirectly via test_supplier_identity_stability.py).

Usage:
    py -3.12 python_backend/tests/test_supplier_name_precedence.py

Exit code 0 = precedence behaves as expected. Exit code 1 = regression.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction.engine import ExtractionEngine                    # noqa: E402
from extraction import template_mapper, anchor as anchor_module   # noqa: E402


def check(label, condition):
    print(f"  {'OK ' if condition else 'BAD'} {label}")
    return condition


def section(title):
    print(f"\n{title}")


WRONG_NAME = "Wjm Building Services Ltd"   # the customer/"Invoice To" block — NOT the supplier
RIGHT_NAME = "City Office NI"              # the real supplier — what the admin's mapping resolves to

FIELD_DEFS = [
    {"key": "supplier_name",  "label": "Supplier Name",  "type": "text", "is_variable": False},
    {"key": "invoice_number", "label": "Invoice Number", "type": "text", "is_variable": True},
]

# Learned the WRONG name as its fixed supplier_name (confirmed several times
# under the mistake before it was noticed — the "old incorrect learned value"
# the user described) — plus a manual mapping the admin has now drawn to fix it.
TEMPLATE_WITH_MAPPING = {
    'id': 7, 'name': f'{WRONG_NAME} Invoice', 'document_type_slug': 'invoice',
    'logo_phash': None, 'keyword_fingerprint': ['CITY', 'OFFICE', 'FACILITIES'],
    'fields': [
        {'field_key': 'supplier_name', 'fixed_value': WRONG_NAME, 'is_variable': 0,
         'anchor_label': None, 'direction': 'right'},
    ],
    'field_mappings': [
        {'field_key': 'supplier_name', 'enabled': True, 'page_number': 0,
         'anchor_text': 'Remit to', 'target_x_norm': 0.05, 'target_y_norm': 0.05,
         'target_w_norm': 0.3, 'target_h_norm': 0.05},
    ],
}

# Same learned mistake, but the admin has NOT drawn a mapping — proves
# templates without one are byte-for-byte unaffected by this fix.
TEMPLATE_NO_MAPPING = {
    **TEMPLATE_WITH_MAPPING,
    'id': 8, 'name': f'{WRONG_NAME} Invoice (no mapping)',
    'field_mappings': [],
}

OCR_TEXT = (
    "CITY OFFICE NI FACILITIES MANAGEMENT\n"
    "Remit to: City Office NI, 12 Anywhere Street\n"
    "Invoice To: Wjm Building Services Ltd\n"
    "Invoice Number: INV-5521\nTotal Due: 842.10"
)

# Non-empty placeholder so engine.py's `if anchors:` gate engages — its
# contents are irrelevant because extract_with_anchors itself is stubbed
# below; only the STUBBED RETURN VALUE drives what Stage 2 "finds".
PLACEHOLDER_ANCHORS = [{
    'field_key': 'supplier_name', 'anchor_label': 'placeholder', 'direction': 'right',
    'supplier_name': '', 'document_type': '', 'usage_count': 1, 'confidence': 0.5,
}]


def run(template, mapping_result, anchor_result):
    """Run engine.extract() with Stage 0.5 / Stage 2 stubbed to deterministic
    outputs — isolates engine.py's merge/precedence code from the geometry
    those stages would otherwise need real page images and OCR for."""
    orig_mapping = template_mapper.extract_with_mappings
    orig_anchor  = anchor_module.extract_with_anchors
    template_mapper.extract_with_mappings = lambda *a, **kw: dict(mapping_result)
    anchor_module.extract_with_anchors    = lambda *a, **kw: dict(anchor_result)
    try:
        engine = ExtractionEngine(mode='smart', emit_fn=lambda *_a: None)
        return engine.extract(
            ocr_text      = OCR_TEXT,
            page_images   = ['fake-page-so-stage-0.5-engages'],
            filename      = 'cityoffice.pdf',
            field_defs    = FIELD_DEFS,
            hints         = [],
            anchors       = PLACEHOLDER_ANCHORS,
            logos         = [],
            templates     = [template],
            document_type = 'Invoice',
            document_slug = 'invoice',
            supplier_name = None,
        )
    finally:
        template_mapper.extract_with_mappings = orig_mapping
        anchor_module.extract_with_anchors    = orig_anchor


def main():
    failures = 0

    MAPPING_HIT = {
        'supplier_name': {'value': RIGHT_NAME, 'confidence': 90, 'method': 'template_mapping'},
    }
    NO_HIT = {}
    # Taught back when the pipeline believed the wrong identity — mis-keyed
    # (and quite possibly mis-aimed at the customer block, since that's what
    # the user was looking at when "supplier_name" first showed wrong). It
    # must not be allowed to silently override a curated correction just
    # because it happens to run in a later stage.
    POISONED_ANCHOR_CROP = {
        'supplier_name': {'value': WRONG_NAME, 'confidence': 88, 'method': 'anchor_crop',
                          'anchor': 'Invoice To'},
    }

    # ── 1: a manual mapping must beat the template's own (stale) fixed_value ──
    section("template_mapping outranks Stage 0's template_fixed for the same field")
    r1 = run(TEMPLATE_WITH_MAPPING, MAPPING_HIT, NO_HIT)
    if not check(f'final supplier_name is the curated value ({RIGHT_NAME!r}), not the stale template_fixed',
                 r1.get('_supplier_name') == RIGHT_NAME
                 and (r1.get('supplier_name') or {}).get('value') == RIGHT_NAME):
        failures += 1
    if not check("method recorded as 'template_mapping' — the curated source, not the generic template rule",
                 (r1.get('supplier_name') or {}).get('method') == 'template_mapping'):
        failures += 1

    # ── 2: an old, identity-poisoned anchor_crop must not re-clobber it ──────
    section('a stale anchor_crop taught under the wrong identity does not override the mapping')
    r2 = run(TEMPLATE_WITH_MAPPING, MAPPING_HIT, POISONED_ANCHOR_CROP)
    if not check(f'final supplier_name stays the curated value ({RIGHT_NAME!r}) despite a higher-confidence '
                 f'(88%) anchor_crop insisting on the wrong name',
                 r2.get('_supplier_name') == RIGHT_NAME
                 and (r2.get('supplier_name') or {}).get('value') == RIGHT_NAME):
        failures += 1
    if not check("method stays 'template_mapping' — the poisoned anchor_crop lost a fair confidence contest "
                 "(90 > 88) instead of winning an automatic override",
                 (r2.get('supplier_name') or {}).get('method') == 'template_mapping'):
        failures += 1

    # ── 3: this is a fair contest, not "mapping always wins no matter what" ──
    # A genuinely strong, freshly-taught anchor pointing at the SAME (correct)
    # block can still out-score a weak mapping — proving the guard settles
    # disagreements between two curated tiers on their merits rather than
    # locking in whichever one happens to apply first.
    section('a confident fresh anchor_crop can still outscore a weak mapping (fair contest, not a one-way lock)')
    WEAK_MAPPING_HIT = {
        'supplier_name': {'value': RIGHT_NAME, 'confidence': 50, 'method': 'template_mapping_expanded'},
    }
    STRONG_FRESH_ANCHOR_CROP = {
        'supplier_name': {'value': RIGHT_NAME, 'confidence': 92, 'method': 'anchor_crop',
                          'anchor': 'Remit To'},
    }
    r3 = run(TEMPLATE_WITH_MAPPING, WEAK_MAPPING_HIT, STRONG_FRESH_ANCHOR_CROP)
    if not check('the higher-confidence anchor_crop (92 > 50) wins outright — both agree on the value either way',
                 (r3.get('supplier_name') or {}).get('method') == 'anchor_crop'
                 and r3.get('_supplier_name') == RIGHT_NAME):
        failures += 1

    # ── 4: templates with NO manual mapping are completely unaffected ───────
    section('a template with no drawn mapping behaves exactly as before (Stage 0.5 does no work at all)')
    r4 = run(TEMPLATE_NO_MAPPING, MAPPING_HIT, NO_HIT)
    if not check("template_fixed still applies untouched — nothing exists to refine it "
                 "(a stale fixed_value still needs a fresh confirm, or a drawn mapping, to change — "
                 "unchanged pre-existing contract, not what this fix addresses)",
                 (r4.get('supplier_name') or {}).get('method') == 'template_fixed'
                 and (r4.get('supplier_name') or {}).get('value') == WRONG_NAME):
        failures += 1

    # ── 5: an implausible template_fixed fragment ("IN") is overridden by a
    #       plausible read, regardless of the fragment's high confidence ──────
    section('a plausible read overrides an implausible template_fixed short fragment ("IN") despite higher fixed confidence')
    IN_TEMPLATE = {
        'id': 30, 'name': 'IN Invoice', 'document_type_slug': 'invoice',
        'logo_phash': None, 'keyword_fingerprint': ['CITY', 'OFFICE', 'FACILITIES'],
        'fields': [
            {'field_key': 'supplier_name', 'fixed_value': 'IN', 'is_variable': 0,
             'anchor_label': None, 'direction': 'right'},
        ],
        'field_mappings': [],
    }
    PLAUSIBLE_ANCHOR = {
        'supplier_name': {'value': RIGHT_NAME, 'confidence': 30, 'method': 'anchor'},
    }
    r5 = run(IN_TEMPLATE, NO_HIT, PLAUSIBLE_ANCHOR)
    if not check(f'final supplier_name is the plausible read ({RIGHT_NAME!r}), not the implausible "IN" '
                 f'(template_fixed conf 95 lost to a plausible conf-30 read — plausibility outranks confidence here)',
                 r5.get('_supplier_name') == RIGHT_NAME
                 and (r5.get('supplier_name') or {}).get('value') == RIGHT_NAME):
        failures += 1

    # ── 6: an implausible incumbent no longer BLOCKS Stage 2.5a hint recovery ─
    section('an implausible "IN" seed no longer blocks Stage 2.5a hint text-scan recovery of the real name')
    IN_TEMPLATE_SS = {
        **IN_TEMPLATE, 'id': 31,
        'keyword_fingerprint': ['SuperStore', 'Invoice', 'Total'],
    }
    RECOVERY_OCR = "SuperStore\nInvoice Number: INV-9001\nTotal Due: 12.00"
    RECOVERY_HINTS = [
        {'field_key': 'supplier_name', 'hint_value': 'SuperStore', 'usage_count': 6},
    ]
    orig_anchor = anchor_module.extract_with_anchors
    anchor_module.extract_with_anchors = lambda *a, **kw: {}
    try:
        eng = ExtractionEngine(mode='smart', emit_fn=lambda *_a: None)
        r6 = eng.extract(
            ocr_text=RECOVERY_OCR, page_images=['fake'], filename='ss.pdf',
            field_defs=FIELD_DEFS, hints=RECOVERY_HINTS, anchors=PLACEHOLDER_ANCHORS,
            logos=[], templates=[IN_TEMPLATE_SS], document_type='Invoice',
            document_slug='invoice', supplier_name=None,
        )
    finally:
        anchor_module.extract_with_anchors = orig_anchor
    if not check('Stage 2.5a recovered the plausible "SuperStore" from confirmed hints despite the "IN" template seed',
                 r6.get('_supplier_name') == 'SuperStore'):
        failures += 1

    # ── 7: the plausibility helper itself — shape test, not a stoplist ───────
    section('supplier-name plausibility helper rejects short structural fragments, accepts real names')
    from extraction.keyword import _is_plausible_supplier_name as plausible
    for bad in ('IN', 'INV', 'PO', '', '   '):
        if not check(f'{bad!r} rejected as an implausible supplier identity', not plausible(bad)):
            failures += 1
    for good in ('SuperStore', 'ACME LIMITED', 'Polychemtex Inc.', 'INV-2024-01'):
        if not check(f'{good!r} accepted as a plausible supplier identity', plausible(good)):
            failures += 1

    # ── 8: supplier-name normalisation (edge quote/apostrophe noise) ─────────
    section('normalize_supplier_name collapses OCR edge noise to one canonical key')
    # Labels kept ASCII-only — the cp1252 dev console can't encode U+FFFD; the
    # actual noise characters are exercised in the assertion arguments below.
    from extraction.keyword import normalize_supplier_name as norm
    if not check('leading smart quote (U+2018) stripped -> "Cloud VPS"',
                 norm('‘Cloud VPS') == 'Cloud VPS'):
        failures += 1
    if not check('replacement char (U+FFFD) stripped -> "Cloud VPS"',
                 norm('�Cloud VPS') == 'Cloud VPS'):
        failures += 1
    if not check('straight apostrophe + trailing quote stripped -> "Cloud VPS"',
                 norm("'Cloud VPS'") == 'Cloud VPS'):
        failures += 1
    if not check('legitimate trailing "." preserved: "Polychemtex Inc." unchanged',
                 norm('Polychemtex Inc.') == 'Polychemtex Inc.'):
        failures += 1
    if not check('interior characters untouched: "Smith & Sons" unchanged',
                 norm('Smith & Sons') == 'Smith & Sons'):
        failures += 1

    print()
    if failures:
        print(f"{failures} check(s) failed — supplier_name precedence regressed.")
        return 1
    print('All checks passed — manual template mappings now outrank stale generic guesses for supplier_name,')
    print('and survive contact with identity-poisoned learned anchors, without affecting unmapped templates.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
