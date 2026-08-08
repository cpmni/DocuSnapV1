"""Unit pins for the taught-ownership OWN-LABEL exemption (reggie design + Oracle gate 2026-07-24).

keyword.build_label_owner_index + label_is_own_discriminating decide whether a matched keyword
caption is UNIQUE to a field (safe to exempt the ownership cap) or shared/generic (keep the review
hold). Precision-first: a false exemption removes a review hold and lets a possibly-wrong value
auto-file, so ANY doubt must resolve to False (hold).

Two things are pinned deliberately (Oracle C1) so a future dev cannot silently restore the bug:
  1. The COUNTER-EXAMPLE — a cross-field grab via the shared "Date" label MUST stay held.
  2. The ACCEPTED TRADE — legit cross-vocabulary synonyms ("Bill No"->invoice, "Order Ref"->PO,
     "Our Order No"->SO) carry NO field-role token yet MUST stay exempt. Oracle REJECTED a
     "require a role-matching token" tightening precisely because it would re-hold these and
     re-introduce the issue-2 over-flag complaint. The two real residuals ("Printed On"->po_date,
     "Order Number"->SO) are instead closed at the CONFIG layer (C2), NOT by the precision rule.

Run: py -3.12 python_backend/tests/test_taught_ownership_own_label.py
"""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from extraction import keyword

# A field_patterns bank mirroring the real config/keyword_patterns.json label sharing AFTER the
# Oracle-C2 config edits:
#   - "Date" / "Issue Date" carried by invoice_date, po_date, order_date        (SHARED)
#   - "Order No" carried by purchase_order_number AND sales_order_number         (SHARED)
#   - "PO Number" carried by po_number AND purchase_order_number                 (SHARED)
#   - "Order Number" carried by purchase_order_number AND sales_order_number     (SHARED after C2b)
#   - "Printed On" is NO LONGER a po_date label                                  (removed by C2a)
#   - "Invoice No"/"Bill No" unique to invoice_number; "Invoice Date" to invoice_date;
#     "PO Date" to po_date; "Sales Order Date" to order_date; "Order Ref"/"P/O Number" unique
FIELD_PATTERNS = {
    'invoice_number': {'labels': [{'text': 'Invoice No'}, {'text': 'Invoice Number'},
                                  {'text': 'Bill No'}, {'text': '#'}]},
    'invoice_date':   {'labels': [{'text': 'Invoice Date'}, {'text': 'Date'}, {'text': 'Issue Date'}]},
    'po_number':      {'labels': [{'text': 'PO Number'}, {'text': 'P/O Number'}, {'text': 'PO Ref'}]},
    'po_date':        {'labels': [{'text': 'PO Date'}, {'text': 'Date'}, {'text': 'Issue Date'}]},  # C2a: no "Printed On"
    'order_date':     {'labels': [{'text': 'Sales Order Date'}, {'text': 'Date'}, {'text': 'Issue Date'}]},
    'purchase_order_number': {'labels': [{'text': 'PO Number'}, {'text': 'Order No'},
                                         {'text': 'Order Ref'}, {'text': 'Order Number'}]},  # C2b: +Order Number
    'sales_order_number':    {'labels': [{'text': 'SO Number'}, {'text': 'Order No'},
                                         {'text': 'Our Order No'}, {'text': 'Order Number'}]},
    'total_amount':   {'labels': ['Total', 'Amount Due']},   # plain-string labels also supported
}

owners = keyword.build_label_owner_index(FIELD_PATTERNS)
fails = []


def check(label, key, expect, why):
    got = keyword.label_is_own_discriminating(label, key, owners)
    tag = 'ok  ' if got == expect else 'FAIL'
    if got != expect:
        fails.append((label, key, expect, got, why))
    print(f"  [{tag}] label={label!r:24} key={key:22} -> {got}  (expect {expect}: {why})")


print("=== OWN-LABEL discriminating exemption ===")
# EXEMPT (unique + content-bearing token) — the incident + siblings
check('Invoice No',       'invoice_number', True,  'unique + "invoice" token — THE INCIDENT')
check('Invoice Date',     'invoice_date',   True,  'unique + "invoice" token — THE INCIDENT')
check('PO Date',          'po_date',        True,  'unique + "po" token')
check('Sales Order Date', 'order_date',     True,  'unique + "sales"/"order" tokens')
check('P/O Number',       'po_number',      True,  'unique to po_number ("p"/"o" non-generic)')

# HELD (shared across >=2 roles) — the silent-wrong-auto-file class
check('Date',       'invoice_date', False, 'shared by invoice/po/order date => MUST hold')
check('Issue Date', 'invoice_date', False, 'shared by three date roles')
check('Order No',   'purchase_order_number', False, 'shared with sales_order_number')
check('PO Number',  'purchase_order_number', False, 'shared with po_number => held')

# HELD (unique but purely generic — no field-identifying token)
check('#',          'invoice_number', False, 'unique but no alnum/field token')

# HELD (edge: missing / unknown label)
check('',           'invoice_number', False, 'blank label')
check(None,         'invoice_number', False, 'None label')
check('Grand Total', 'invoice_number', False, 'label not carried by this field')

# THE COUNTER-EXAMPLE (Oracle C1a): an invoice_date value that WON via the bare "Date" label
# off an "Order Date:" line — label="Date" is shared, so the detector refuses to exempt the
# cross-field grab. This pin is the whole safety argument.
check('Date', 'invoice_date', False, 'CROSS-FIELD GRAB via shared "Date" => MUST hold')
check('PO Date', 'invoice_date', False, 'right label, WRONG field key')

# case / whitespace normalisation still resolves
check('  invoice   no  ', 'invoice_number', True, 'normalised whitespace+case still matches')

# ── Oracle C1b: the ACCEPTED TRADE — legit synonyms MUST stay exempt ───────────────────────
# These carry NO field-role token (bill != invoice; order-ref != po/purchase; our-order-no !=
# sales), yet they are LEGITIMATE labels for their field. The "require a role-matching token"
# tightening Oracle REJECTED (2026-07-24) would wrongly RE-HOLD every one of these, re-opening
# the issue-2 over-flag complaint for synonym labels. Pin them EXEMPT so that rule can't be added.
print("\n=== C1b: legit cross-vocabulary synonyms MUST stay exempt (no role-token rule) ===")
check('Bill No',      'invoice_number',        True, 'synonym, no "invoice" token — role rule would BREAK it')
check('Order Ref',    'purchase_order_number', True, 'synonym, no "po"/"purchase" token — role rule would BREAK it')
check('Our Order No', 'sales_order_number',    True, 'synonym, no "sales" token — role rule would BREAK it')

# ── Oracle C1c: the two residuals are closed at the CONFIG layer (C2), not the precision rule ──
print("\n=== C1c: residuals closed at the config layer (C2a/C2b), not by the rule ===")
# Residual B: "Order Number" was unique to sales_order_number (would have exempted). C2b ADDED it
# to purchase_order_number, so it is now SHARED -> the EXISTING precision rule holds it for both.
check('Order Number', 'sales_order_number',    False, 'C2b made it shared PO+SO -> HELD')
check('Order Number', 'purchase_order_number', False, 'C2b made it shared PO+SO -> HELD')
# Residual A: "Printed On" REMOVED from po_date at config (C2a) -> carried by no field -> can never
# be a discriminating own-label for po_date. This closes the one date corner with no downstream net.
check('Printed On',   'po_date',               False, 'C2a removed it from po_date -> not its label')

# index sanity — the sharing is what the precision rule depends on
assert owners.get('date') == frozenset({'invoice_date', 'po_date', 'order_date'}), owners.get('date')
assert owners.get('invoice no') == frozenset({'invoice_number'}), owners.get('invoice no')
assert owners.get('order no') == frozenset({'purchase_order_number', 'sales_order_number'}), owners.get('order no')
assert owners.get('order number') == frozenset({'purchase_order_number', 'sales_order_number'}), owners.get('order number')
assert owners.get('po number') == frozenset({'po_number', 'purchase_order_number'}), owners.get('po number')
assert owners.get('printed on') is None, owners.get('printed on')   # C2a removed it entirely
assert owners.get('total') == frozenset({'total_amount'}), owners.get('total')   # plain-string path
print(f"\nindex: 'order number' -> {sorted(owners['order number'])}; 'printed on' -> {owners.get('printed on')}")

# empty / None bank must not explode
assert keyword.build_label_owner_index({}) == {}
assert keyword.build_label_owner_index(None) == {}
assert keyword.label_is_own_discriminating('Invoice No', 'invoice_number', {}) is False


# ══ B' TYPE-SCOPED own-label exemption (gary + Oracle SIGN-OFF-WITH-CONDITIONS 2026-07-26) ══════
# label_is_own_discriminating_in_type judges uniqueness against the RESOLVED TYPE's field-key set, so a
# label shared GLOBALLY but unique WITHIN a type ("Order Date": po_date + order_date globally, but only
# po_date exists on a purchase_order) exempts FOR THAT TYPE. The generic-token gate is RETAINED (bare
# "Date" never exempts) and a UNION field set degrades to the global test. Precision-first: doubt -> False.
print("\n=== B': type-scoped own-label exemption ===")
FP_T = {
    'invoice_date': {'labels': [{'text': 'Invoice Date'}, {'text': 'Date'}]},
    'po_date':      {'labels': [{'text': 'PO Date'}, {'text': 'Order Date'}, {'text': 'Date'}]},
    'order_date':   {'labels': [{'text': 'Sales Order Date'}, {'text': 'Order Date'}, {'text': 'Date'}]},
    'po_number':    {'labels': [{'text': 'PO Number'}]},
    'total_amount': {'labels': ['Total']},
}
owners_t = keyword.build_label_owner_index(FP_T)
PO_KEYS    = frozenset({'supplier_name', 'po_number', 'po_date', 'total_amount'})
SO_KEYS    = frozenset({'supplier_name', 'sales_order_number', 'order_date', 'total_amount'})
INV2_KEYS  = frozenset({'supplier_name', 'invoice_number', 'invoice_date', 'po_date'})   # >1 date field
BOTH_KEYS  = frozenset({'supplier_name', 'po_date', 'order_date', 'total_amount'})        # type carries BOTH
UNION_KEYS = frozenset(FP_T) | {'supplier_name', 'sales_order_number', 'invoice_number'}


def check2(label, key, keys, expect, why):
    got = keyword.label_is_own_discriminating_in_type(label, key, owners_t, keys)
    tag = 'ok  ' if got == expect else 'FAIL'
    if got != expect:
        fails.append((label, key, expect, got, why))
    print(f"  [{tag}] label={label!r:14} key={key:12} -> {got}  (expect {expect}: {why})")


# THE INCIDENT + symmetric sibling — shared globally, unique within the resolved type
check2('Order Date', 'po_date',        PO_KEYS,    True,  'unique within purchase_order (order_date absent) — INCIDENT')
check2('Order Date', 'order_date',     SO_KEYS,    True,  'symmetric: unique within sales_order (po_date absent)')
# generic-token gate retained — bare "Date" never exempts, even when scoped-unique
check2('Date',       'po_date',        PO_KEYS,    False, 'generic token "date" — held even though scoped to {po_date}')
# owner requirement: a type with >1 date field holds a shared/generic date label
check2('Date',       'po_date',        INV2_KEYS,  False, '>1-date type (invoice_date+po_date) — shared+generic -> held')
# a type carrying BOTH po_date AND order_date -> "Order Date" ambiguous within type -> held
check2('Order Date', 'po_date',        BOTH_KEYS,  False, 'type carries po_date AND order_date -> ambiguous -> held')
# UNION field set (no type resolved) degrades to the global test -> held (doubly safe)
check2('Order Date', 'po_date',        UNION_KEYS, False, 'union field set == global test -> held (degrade-to-global)')
# field absent from the resolved type / not a global owner / edges
check2('Order Date', 'po_date',        SO_KEYS,    False, 'po_date not a field on sales_order -> held')
check2('Order Date', 'invoice_number', PO_KEYS,    False, 'invoice_number never carries "Order Date"')
check2('',           'po_date',        PO_KEYS,    False, 'blank label')
check2(None,         'po_date',        PO_KEYS,    False, 'None label')
check2('Order Date', 'po_date',        frozenset(), False, 'empty type_keys')
check2('Nope',       'po_date',        PO_KEYS,    False, 'unknown label')
assert keyword.label_is_own_discriminating_in_type('Order Date', 'po_date', {}, PO_KEYS) is False
assert owners_t.get('order date') == frozenset({'po_date', 'order_date'}), owners_t.get('order date')

if fails:
    print(f"\n{len(fails)} FAIL(s):")
    for f in fails:
        print("   ", f)
    sys.exit(1)
print("\nALL PASS")
