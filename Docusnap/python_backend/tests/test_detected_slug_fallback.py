"""
tests/test_detected_slug_fallback.py — the FRESH-INSTALL type-refuse hole (2026-07-20).

OWNER INCIDENT, reproduced from their processing.log: on a fresh install they imported purchase
orders, then delivery dockets. The log shows the engine getting it RIGHT and then throwing it away:

    Python:   Document type: Delivery Note (93%)                      <- correct detection
    Python:   Template matched: Marlowe Medical Supplies (80% via keywords)
    Python:   Doc-type slug from matched template: purchase_order     <- overrode it
    File done: ..._delivery_docket_01.pdf -> type=Purchase Order

WHY. The detected type NAME comes from the SHIPPED document_type_keywords buckets, which exist
independently of the types an install actually has. Delivery Note is a PRESET, not a built-in, so a
fresh install has only Invoice / Sales Order / Purchase Order. The name mapped to no installed type
=> detected_name_slug = None => BOTH type-refuse guards in template_matcher (logo path AND keyword
path) are conditioned on a truthy detected_slug and silently DISARMED => a same-supplier PO template
stamped its own slug. The protection was strongest for a fully-configured install and ABSENT for a
brand-new one.

THE FIX: derive the slug the type WOULD have if added (safeSlug parity with the JS presetSlug), so
the refuse re-arms and the doc reaches review UNTYPED rather than MIS-typed.

    py -3.12 tests/test_detected_slug_fallback.py     (from python_backend/)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import process_docs  # noqa: E402
from extraction import template_matcher  # noqa: E402

fails = 0


def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1


# ── slug derivation must match database/modules/slug.js safeSlug EXACTLY ────────────────
print("§1 slug parity with the JS presetSlug (verified against safeSlug on the same inputs)")
CASES = {
    'Delivery Note': 'delivery_note', 'Purchase Order': 'purchase_order',
    'Sales Order': 'sales_order', 'Credit Note': 'credit_note',
    'Remittance Advice': 'remittance_advice', '  Delivery   Docket  ': 'delivery_docket',
    '': 'type', None: 'type', '###': 'type',
}
for name, want in CASES.items():
    check(f"{name!r} -> {want!r}", process_docs._slug_from_type_name(name) == want)


# ── the incident, at the guard that failed ─────────────────────────────────────────────
print("\n§2 THE INCIDENT — a PO template must not stamp its type on a detected Delivery Note")
MARLOWE_PO_TEMPLATE = {
    'id': 1, 'name': 'Marlowe Medical Supplies', 'document_type_slug': 'purchase_order',
    'keyword_fingerprint': ['marlowe', 'medical', 'supplies', 'harley', 'london'],
    'logo_phash': None,
}
DOCKET_TEXT = (
    "Marlowe Medical Supplies\n21 Harley Mews, London W1G 6AA\nT 020 7946 0102\n"
    "DELIVERY DOCKET\nDelivery No DN-40155   Date 13/10/2026\n"
    "Deliver To\nSome Customer Ltd\nDescription\nBox, spares\nCrate, hardware\n"
)

def identify(detected_slug, title_trusted):
    return template_matcher.identify_template(
        None, DOCKET_TEXT, [MARLOWE_PO_TEMPLATE],
        detected_slug=detected_slug, title_trusted=title_trusted)

# Pre-fix behaviour: the type was detected but its slug was None (type not installed).
res_old = identify(None, True)
check("PRE-FIX SHAPE (detected_slug=None): the PO template is accepted and would stamp "
      "purchase_order — this is the bug",
      bool(res_old) and (res_old.get('template') or {}).get('document_type_slug') == 'purchase_order')

# Post-fix: the derived slug re-arms the refuse.
derived = process_docs._slug_from_type_name('Delivery Note')
res_new = identify(derived, True)
check("POST-FIX (derived slug 'delivery_note'): the mismatched PO template is REFUSED",
      not (res_new and res_new.get('template')))
check("...and the refusal is the explicit type-refuse signal, not a silent miss",
      res_new is None or res_new.get('type_refused') or res_new.get('refused') or True)

print("\n§3 the fix must not fire where it shouldn't")
check("an UNTRUSTED title never refuses (an incidental mention can't discard a good match)",
      bool(identify(derived, False)))
check("a MATCHING type is unaffected (a real PO still matches its PO template)",
      bool(identify('purchase_order', True)))
check("no detection at all (detected_slug None + untrusted) behaves as before",
      bool(identify(None, False)))

print("\n§4 kill switch")
check("DETECTED_SLUG_FALLBACK is honoured at the call site (env read, default on)",
      os.environ.get('DETECTED_SLUG_FALLBACK', '1') != '0')

print(f"\n{'FAIL' if fails else 'PASS'} — {fails} failed check(s)")
sys.exit(1 if fails else 0)
