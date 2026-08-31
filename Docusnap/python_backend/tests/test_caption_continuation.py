#!/usr/bin/env python3
"""Pin keyword.is_caption_continuation — the content predicate for the label-relocation caption
guard (reggie; Oracle SIGN-OFF-WITH-CONDITIONS). Precision-first: fires on a caption CONTINUATION
word, never on a plausible real value. Also pins the accepted false-fires and the "Item Sofa" under-fire.

    py -3.12 python_backend/tests/test_caption_continuation.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from extraction.keyword import is_caption_continuation, build_caption_vocab   # noqa: E402

fails = 0


def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1


print("MUST FIRE (=> refuse / route to review):")
check("ARM1 code field, all-alpha 'information' (the reported bug)", is_caption_continuation("information", "alphanumeric") is True)
check("ARM1 job_reference, 'Description'", is_caption_continuation("Description", "job_reference") is True)
check("ARM1 reference_code, edge junk '(Information)'", is_caption_continuation("(Information)", "reference_code") is True)
check("ARM2 free-text, 'information'", is_caption_continuation("information", "text") is True)
check("ARM2 free-text, 'Description Quantity' (all header nouns)", is_caption_continuation("Description Quantity", "text") is True)
check("ARM2 untyped (None), 'number'", is_caption_continuation("number", None) is True)

print("\nMUST NOT FIRE (=> keep the value):")
check("ARM1 code with a digit 'INV-001'", is_caption_continuation("INV-001", "alphanumeric") is False)
check("ARM1 code with a digit 'PO2025'", is_caption_continuation("PO2025", "alphanumeric") is False)
check("currency_code 'GBP' (all-alpha but not digit-bearing type; 'gbp' not a header noun)", is_caption_continuation("GBP", "currency_code") is False)
check("free-text real name 'Sofa Bed'", is_caption_continuation("Sofa Bed", "text") is False)
check("free-text single name 'Beaumont'", is_caption_continuation("Beaumont", "text") is False)
check("free-text supplier 'Total' (deliberately not in the set)", is_caption_continuation("Total", "text") is False)
check("empty value", is_caption_continuation("", "alphanumeric") is False)
check("punctuation-only value", is_caption_continuation("--", "text") is False)

print("\nACCEPTED trade-offs (pinned so they can't be silently 'fixed'):")
check("ARM2 UNDER-fire: 'Item Information' (mixed real+caption) does NOT fire (leans on geometry/rigid)", is_caption_continuation("Item Information", "text") is False)
check("ARM1 accepted FALSE-fire: a legit all-alpha code on a code field routes to review", is_caption_continuation("PROFORMA", "alphanumeric") is True)
check("ARM2 accepted FALSE-fire: a field whose real value IS 'Details' routes to review", is_caption_continuation("Details", "text") is True)

print("\nARM0 (vocab-threaded) reuse of value_is_caption:")
vocab = build_caption_vocab({"x": {"labels": [{"text": "Bill To"}]}})
check("ARM0: 'Bill To' matches a configured label", is_caption_continuation("Bill To", "text", vocab=vocab) is True)
check("ARM0 inert without vocab: 'Bill To' alone (not a header noun) does NOT fire", is_caption_continuation("Bill To", "text") is False)

print("\n" + ("ALL PASS" if fails == 0 else f"{fails} FAILED"))
sys.exit(1 if fails else 0)
