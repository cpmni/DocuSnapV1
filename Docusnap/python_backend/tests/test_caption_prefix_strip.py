#!/usr/bin/env python3
"""
tests/test_caption_prefix_strip.py
----------------------------------
CAPTION-PREFIX STRIP (kill ANCHOR_CAPTION_PREFIX_STRIP, DEFAULT OFF => byte-identical).

A rigid anchor crop can capture its own caption ("Date 22/07/2026", "No. DN-36457"). Today that
correct value is either DISCARDED by the credibility/learned-format gate or — on a cold supplier
with no learned format — commits DIRTY into the filename. `_strip_caption_prefix` recovers the value
by stripping the field's OWN taught label prefix, precision-first.

These tests pin the PURE helper (all of Oracle's condition-5 cases + SEAM A currency exclusion).
The call-site RECOVERY-not-pre-emption routing (Oracle SEAM B) and the kill-switch OFF => byte-
identical property are proven by the corpus A/B (realdoc_regression, OFF vs ON) + the flip-set
enumeration/page-verify, not here (they need the crop OCR path, which a unit test can't cheaply drive).

Usage: py -3.12 python_backend/tests/test_caption_prefix_strip.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import anchor   # noqa: E402

# Minimal validation_patterns: the helper only checks that the val_type HAS a pattern (a real
# format backstop exists downstream); it never uses the pattern content, so stand-ins suffice.
PATS = {"date": ["d"], "alphanumeric": ["a"], "reference_code": ["r"], "number": ["n"], "currency": ["c"]}

_strip = anchor._strip_caption_prefix


def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return cond


def main():
    fails = 0

    # ── Recovery: caption-prefixed structured values are stripped to the value ───────────────────
    fails += not check("date: 'Date 22/07/2026' -> '22/07/2026'",
                       _strip("Date 22/07/2026", "date", "date", PATS) == "22/07/2026")
    fails += not check("date: 'Delivery Date 22/07/2026' -> '22/07/2026'",
                       _strip("Delivery Date 22/07/2026", "delivery date", "date", PATS) == "22/07/2026")
    fails += not check("date: 'Date: 22/07/2026' (colon caption punct) -> '22/07/2026'",
                       _strip("Date: 22/07/2026", "date", "date", PATS) == "22/07/2026")
    fails += not check("ref: 'No. DN-36457' -> 'DN-36457'",
                       _strip("No. DN-36457", "delivery note no", "alphanumeric", PATS) == "DN-36457")
    fails += not check("ref: 'Delivery Note No. DN-38626' -> 'DN-38626'",
                       _strip("Delivery Note No. DN-38626", "delivery note no", "alphanumeric", PATS) == "DN-38626")

    # ── Precision (the trust half): must NOT strip ──────────────────────────────────────────────
    # Glued value with no space after the label word — the mandatory-whitespace lever protects it.
    fails += not check("glued: 'NO-1234' (label 'no', no space) UNTOUCHED",
                       _strip("NO-1234", "no", "alphanumeric", PATS) == "NO-1234")
    # Free-text is excluded by type (a real name can begin with a caption-ish word).
    fails += not check("free-text: 'Customer Services Ltd' UNTOUCHED (val_type text)",
                       _strip("Customer Services Ltd", "customer", "text", PATS) == "Customer Services Ltd")
    fails += not check("free-text: multiline_text UNTOUCHED",
                       _strip("Deliver To Halcyon Group", "deliver to", "multiline_text", PATS)
                       == "Deliver To Halcyon Group")
    # SEAM A (Oracle): currency is excluded — its own label-lock caption defence keys on the caption.
    fails += not check("SEAM A: currency 'Total 500.00' UNTOUCHED (currency excluded)",
                       _strip("Total 500.00", "total", "currency", PATS) == "Total 500.00")
    # Would strip to nothing -> leave whole (a pure-caption read stays for _is_bare_label to reject).
    fails += not check("never-to-empty: 'Date' (label 'date') UNTOUCHED",
                       _strip("Date", "date", "date", PATS) == "Date")
    # No matching label prefix -> unchanged (byte-identical for a caption-free read).
    fails += not check("no-prefix: '22/07/2026' UNTOUCHED",
                       _strip("22/07/2026", "date", "date", PATS) == "22/07/2026")
    # Partial taught label ('date' only, page shows 'Invoice Date') -> safe MISS, not amputation.
    fails += not check("partial-label: 'Invoice Date 22/07/2026' (label 'date') UNTOUCHED (safe miss)",
                       _strip("Invoice Date 22/07/2026", "date", "date", PATS) == "Invoice Date 22/07/2026")
    # No label -> no-op.
    fails += not check("no-label: unchanged",
                       _strip("Date 22/07/2026", "", "date", PATS) == "Date 22/07/2026")
    # No validation pattern for the type -> no strip (no format backstop -> don't risk it).
    fails += not check("no-pattern: 'Date 22/07/2026' UNTOUCHED (no date pattern)",
                       _strip("Date 22/07/2026", "date", "date", {}) == "Date 22/07/2026")
    # Empty / None value -> returned as given.
    fails += not check("empty value -> unchanged", _strip("", "date", "date", PATS) == "")
    fails += not check("None value -> unchanged", _strip(None, "date", "date", PATS) is None)

    # ── The allowlist (SEAM A): currency + free-text are NOT eligible; date/ref/number are ───────
    T = anchor._CAPTION_STRIP_TYPES
    fails += not check("allowlist: 'date' eligible", "date" in T)
    fails += not check("allowlist: 'alphanumeric' eligible", "alphanumeric" in T)
    fails += not check("allowlist: 'number' eligible", "number" in T)
    fails += not check("allowlist: 'currency' NOT eligible (SEAM A)", "currency" not in T)
    fails += not check("allowlist: 'text' NOT eligible", "text" not in T)
    fails += not check("allowlist: 'currency_code' NOT eligible", "currency_code" not in T)

    print()
    print(f"{fails} FAILED" if fails else "All caption-prefix-strip checks passed")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
