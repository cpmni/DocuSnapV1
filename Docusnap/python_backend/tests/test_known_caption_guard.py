"""G3b — KNOWN-CAPTION VALUE GUARD (DIRECTION_SUPREMACY, Oracle-signed 2026-07-11).

keyword._search_for_label caption_guard: for a name-like/party field (CUSTOMER-SIDE — supplier_name
EXCLUDED), a candidate VALUE that IS a known caption dies at generation (blanked at 'right' so it
falls through to 'below', skipped at 'below') — so a printed caption ("SO #", "Order Number") never
fills a name field (the incident: customer_name read the "SO #" caption). Broader than the
role_caption='party' _is_caption_fragment guard (whole run vocab; fires even when role_caption is
None — the shipped customer_name pattern carries none).

Run:  py -3.12 tests/test_known_caption_guard.py   (from python_backend/)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from extraction import keyword as kw
from extraction import value_quality as vq

fails = 0


def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1


VOCAB = kw.build_caption_vocab(
    {'customer_name': {'labels': ['Customer', {'text': 'Bill To'}]},
     'sales_order_number': {'labels': ['Order Number', 'SO #', 'S.O.No.']}},
    [{'key': 'customer_name', 'label': 'Customer'}])

# ── the incident shape: 'Customer' caption, then caption columns, real value below ──
print("-- _search_for_label caption_guard --")
INCIDENT = ['Customer    Order Number    SO #', 'Cavehill Joinery    Order Date    02-03-2026']
check("UNARMED grabs the right-side caption (the bug)",
      kw._search_for_label(INCIDENT, 'Customer', ['right', 'below'], caption_guard=None) == ('Order Number', 'right'))
check("ARMED: right caption dies -> falls through to the real value below",
      kw._search_for_label(INCIDENT, 'Customer', ['right', 'below'], caption_guard=VOCAB) == ('Cavehill Joinery', 'below'))

# DELTA pin: a NON-caption right value is UNCHANGED by the guard
REAL_RIGHT = ['Customer   Cavehill Joinery']
check("DELTA: a real right-side value is untouched by the guard",
      kw._search_for_label(REAL_RIGHT, 'Customer', ['right', 'below'], caption_guard=VOCAB) == ('Cavehill Joinery', 'right'))

# below-direction caption row is skipped
BELOW_CAP = ['Customer', 'SO #', 'Cavehill Joinery']
check("ARMED: a 'below' caption row is skipped -> walks on to the value",
      kw._search_for_label(BELOW_CAP, 'Customer', ['below'], caption_guard=VOCAB) == ('Cavehill Joinery', 'below'))
check("UNARMED: the 'below' caption row is taken (the bug)",
      kw._search_for_label(BELOW_CAP, 'Customer', ['below'], caption_guard=None) == ('SO #', 'below'))

# containment / real-name survival (no over-kill)
SURVIVE = ['Customer   Order Solutions Ltd']
check("DELTA: 'Order Solutions Ltd' (contains a caption word) SURVIVES (no containment kill)",
      kw._search_for_label(SURVIVE, 'Customer', ['right', 'below'], caption_guard=VOCAB) == ('Order Solutions Ltd', 'right'))

# ── caption vocab DELTA specifics ──
print("-- vocab delta --")
check("a real name is NOT a caption", kw.value_is_caption('Cavehill Joinery', VOCAB) is False)
check("'SO #' IS a caption", kw.value_is_caption('SO #', VOCAB) is True)
check("bare 'SO' dies by rule 1 (SO # -> ('so',))", kw.value_is_caption('SO', VOCAB) is True)
check("'#'-only never matches (empty content tuple)", kw.value_is_caption('#', VOCAB) is False)

# ── customer-side ONLY arming (the engine's rule; supplier_name explicit exclusion) ──
print("-- arming rule (customer-side only, slice 1) --")
check("customer_name is name-like", vq.is_name_like_field('customer_name') is True)
check("supplier_name is ALSO name-like (why a naive name-like check would wrongly arm it)",
      vq.is_name_like_field('supplier_name') is True)
armed = lambda k: vq.is_name_like_field(k) and k != 'supplier_name'
check("PIN: customer_name IS armed", armed('customer_name') is True)
check("PIN: supplier_name is NOT armed (EXPLICIT != exclusion, not a set)", armed('supplier_name') is False)

# ── kill switch ──
print("-- kill switch --")
_saved = kw.KNOWN_CAPTION_GUARD_ENABLED
try:
    # the guard is applied by extract_fields under the flag; _search_for_label itself always honours
    # a passed caption_guard, so the flag is proven at the extract_fields arming layer:
    kw.KNOWN_CAPTION_GUARD_ENABLED = False
    res = kw.extract_fields('Customer    SO #\nCavehill Joinery',
                            ['customer_name'],
                            {'field_patterns': {'customer_name': {'labels': ['Customer'],
                                                                  'directions': ['right', 'below'],
                                                                  'base_confidence': 78}}},
                            caption_vocab=VOCAB, caption_guard_keys={'customer_name'})
    check("kill switch OFF -> the old caption fill reproduces ('SO #')",
          (res.get('customer_name') or {}).get('value') == 'SO #')
    kw.KNOWN_CAPTION_GUARD_ENABLED = True
    res = kw.extract_fields('Customer    SO #\nCavehill Joinery',
                            ['customer_name'],
                            {'field_patterns': {'customer_name': {'labels': ['Customer'],
                                                                  'directions': ['right', 'below'],
                                                                  'base_confidence': 78}}},
                            caption_vocab=VOCAB, caption_guard_keys={'customer_name'})
    check("kill switch ON -> caption dies, real value fills ('Cavehill Joinery')",
          (res.get('customer_name') or {}).get('value') == 'Cavehill Joinery')
    # armed set gates it: an UNARMED field (not in caption_guard_keys) is unchanged
    res = kw.extract_fields('Customer    SO #\nCavehill Joinery',
                            ['customer_name'],
                            {'field_patterns': {'customer_name': {'labels': ['Customer'],
                                                                  'directions': ['right', 'below'],
                                                                  'base_confidence': 78}}},
                            caption_vocab=VOCAB, caption_guard_keys=set())
    check("field NOT in armed set -> unchanged (guard is opt-in per field)",
          (res.get('customer_name') or {}).get('value') == 'SO #')
finally:
    kw.KNOWN_CAPTION_GUARD_ENABLED = _saved

print()
if fails:
    print(f"FAILED: {fails}")
    sys.exit(1)
print("All known-caption-guard (G3b) checks passed")
