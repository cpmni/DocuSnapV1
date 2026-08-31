#!/usr/bin/env python3
"""Slice 2 (reggie 2026-07-29) — po_number / sales_order_number footer-boilerplate guard.

A Copperfield PO read its Reference as the prose "on all correspondence and delivery notes":
the injected bare label "Order Number" (PO_ORDER_NO_LABELS) matched the footer instruction
"quote our order number on all correspondence and delivery notes", and the loose 'alphanumeric'
validation (un-anchored re.search, no digit requirement) accepted the prose as a value.

Two guards (both backend keyword.py, shared validation_patterns UNTOUCHED so the renderer twin
stays aligned; each behind its own kill switch, OFF => byte-identical):
  Part 1  PO_ORDER_INSTRUCTION_SKIP — _order_caption_is_instruction skips a bare "order no/number"
          whose TAIL is prose ("... on all correspondence") or that follows an instruction verb.
  Part 2  PO_REF_DIGIT_GATE — an order-family value must carry a >=2-digit spaceless run (a CODE),
          un-anchored + space-tolerant so a noisy real header still reads (NOT reference_code).

  cd python_backend && py -3.12 tests/test_po_order_footer.py
"""
import sys
import os
import json

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from extraction import keyword

_CFG = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                    'config', 'keyword_patterns.json')
PATTERNS = json.load(open(_CFG, encoding='utf-8'))

# The id50 shape: header (big heading + Order No on one OCR line, comma after "No") + the footer
# instruction. "Order No." (with period) misses the comma header, so the injected label order makes
# "Order Number" try the FOOTER before "Order No" reaches the header — the exact collision.
HEADER_FOOTER = (
    "PURCHASE ORDER          Order No, PO-73796\n"
    "Order Date 14/11/2026\n"
    "Supplier\n"
    "Willowbrook Nurseries\n"
    "Please quote our order number on all correspondence and delivery notes\n"
)


def _run(text, keys, **env):
    saved = {}
    for k, v in env.items():
        saved[k] = os.environ.get(k)
        os.environ[k] = v
    try:
        return keyword.extract_fields(text, keys, PATTERNS)
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return cond


def main():
    f = 0

    # ── 1. THE BUG (fix ON = default): footer prose must NOT become po_number; the header wins ──
    r = _run(HEADER_FOOTER, ['po_number'])
    v = (r.get('po_number') or {}).get('value', '') or ''
    f += not check(f'po_number is the header code, not footer prose (got {v!r})',
                   'correspondence' not in v.lower() and '73796' in v)

    # ── 2. digit-gate trade-off: a NOISY real header still reads (looser than reference_code) ──
    noisy = "PURCHASE ORDER          Order No, P0-22954\nPlease quote our order number on all correspondence\n"
    v2 = (( _run(noisy, ['po_number']).get('po_number')) or {}).get('value', '') or ''
    f += not check(f'noisy header ", P0-22954" not nulled by the digit-gate (got {v2!r})', '22954' in v2)

    # ── 3. SYMMETRIC sales_order_number hole is closed too ──
    so = ("SALES ORDER            Sales Order No SO-4471\n"
          "Please quote our order number on all correspondence and delivery notes\n")
    v3 = ((_run(so, ['sales_order_number']).get('sales_order_number')) or {}).get('value', '') or ''
    f += not check(f'sales_order_number is the header code, not footer prose (got {v3!r})',
                   'correspondence' not in v3.lower() and '4471' in v3)

    # ── 4. KILL SWITCHES OFF => byte-identical PRE-FIX behaviour (the bug returns) ──
    v4 = ((_run(HEADER_FOOTER, ['po_number'],
                PO_ORDER_INSTRUCTION_SKIP='0', PO_REF_DIGIT_GATE='0').get('po_number')) or {}).get('value', '') or ''
    f += not check(f'flags OFF restores the footer-prose read (got {v4!r})', 'correspondence' in v4.lower())

    # ── 5. a genuine own-ref "Our Order No. PO-..." (Oracle-protected) still reads with the fix ON ──
    own = "Our Order No. PO-55123\n"
    v5 = ((_run(own, ['po_number']).get('po_number')) or {}).get('value', '') or ''
    f += not check(f'"Our Order No. PO-55123" own-ref still reads (got {v5!r})', '55123' in v5)

    print(f"\n{'ALL GREEN' if f == 0 else str(f) + ' FAILED'}")
    return 1 if f else 0


if __name__ == '__main__':
    sys.exit(main())
