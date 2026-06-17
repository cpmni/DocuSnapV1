#!/usr/bin/env python3
"""
tests/test_landmarks.py — unit tests for ocr.landmarks.select_landmarks (the pure
landmark-selection algorithm; no OCR). Verifies the filters that make landmarks
reliable for the registration fit:
  - low-confidence / short / numeric tokens are excluded,
  - tokens that repeat on the page are dropped (ambiguous to re-locate),
  - the result is spatially spread (not clustered),
  - max_n is respected.

Usage:  py -3.12 python_backend/tests/test_landmarks.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from ocr import landmarks  # noqa: E402


def check(label, condition):
    print(f"  {'OK ' if condition else 'BAD'} {label}")
    return condition


def W(text, conf, x, y, w=0.06, h=0.02):
    return {"text": text, "conf": conf, "x_norm": x, "y_norm": y, "w_norm": w, "h_norm": h}


def test_filters():
    failures = 0
    print("select_landmarks: confidence / shape / uniqueness filters")
    words = [
        W("Invoice", 96, 0.05, 0.05),     # good
        W("Supplier", 94, 0.80, 0.08),    # good, far away
        W("Account", 90, 0.10, 0.85),     # good, far away
        W("ab", 99, 0.4, 0.4),            # too short
        W("12345", 98, 0.5, 0.5),         # numeric (not alpha-dominant)
        W("blurry", 40, 0.6, 0.6),        # low confidence
        W("Total", 95, 0.2, 0.2),         # good but...
        W("Total", 95, 0.2, 0.9),         # ...repeats -> both dropped
    ]
    picked = landmarks.select_landmarks(words, max_n=5, min_conf=80)
    texts = {p["label_text"] for p in picked}
    if not check("keeps high-conf unique words (Invoice/Supplier/Account)",
                 {"Invoice", "Supplier", "Account"} <= texts):
        failures += 1
    if not check("drops short / numeric / low-conf tokens",
                 not ({"ab", "12345", "blurry"} & texts)):
        failures += 1
    if not check("drops the repeated 'Total' entirely (ambiguous)", "Total" not in texts):
        failures += 1
    print()
    return failures


def test_spread_and_max():
    failures = 0
    print("select_landmarks: spatial spread + max_n")
    # A tight cluster top-left plus three far-flung words; spread should prefer the
    # far ones over additional cluster members.
    words = [
        W("Alpha", 99, 0.02, 0.02), W("Bravo", 98, 0.05, 0.03),
        W("Charlie", 97, 0.03, 0.06), W("Delta", 96, 0.06, 0.05),
        W("Echo", 95, 0.92, 0.05),   # far right
        W("Foxtrot", 95, 0.05, 0.93),  # far bottom
        W("Golf", 95, 0.92, 0.92),   # far corner
    ]
    picked = landmarks.select_landmarks(words, max_n=4, min_conf=80)
    texts = {p["label_text"] for p in picked}
    if not check(f"respects max_n=4 (got {len(picked)})", len(picked) == 4):
        failures += 1
    if not check("includes the spread-out words, not just the cluster",
                 {"Echo", "Foxtrot", "Golf"} <= texts):
        failures += 1

    # Nothing usable -> empty (clean fall-through, registration simply won't fire).
    if not check("all-numeric/low-conf -> [] (no landmarks)",
                 landmarks.select_landmarks([W("123", 99, 0.1, 0.1), W("x", 30, 0.2, 0.2)]) == []):
        failures += 1
    print()
    return failures


def main():
    failures = 0
    failures += test_filters()
    failures += test_spread_and_max()
    if failures:
        print(f"{failures} check(s) failed — landmarks regressed.")
        return 1
    print("All checks passed — landmark selection behaves as expected.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
