#!/usr/bin/env python3
"""
tests/test_text_normalise.py
----------------------------
Stability/regression guard for the compare-time normaliser against the SHARED
golden corpus (normalise_corpus.json). The JS twin asserts the SAME corpus
(database/modules/test_text_normalise.js), so a mismatch on either side = drift.

    py -3.12 python_backend/tests/test_text_normalise.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction.text_normalise import normalise_for_tokens, tokenise  # noqa: E402

CORPUS = json.loads((Path(__file__).parent / "normalise_corpus.json").read_text(encoding="utf-8"))


def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return bool(cond)


def main():
    f = 0
    print("text_normalise matches the shared golden corpus")
    for case in CORPUS:
        got_n = normalise_for_tokens(case["in"])
        got_t = tokenise(case["in"])
        # ascii() escapes non-ASCII so the Windows cp1252 console never chokes.
        lbl = ascii(case["in"])
        f += not check(f"norm {lbl} -> {ascii(case['norm'])}", got_n == case["norm"])
        f += not check(f"tokens {lbl}", got_t == case["tokens"])
    if f:
        print(f"\n{f} FAILED — normaliser drifted from the golden corpus.")
        return 1
    print(f"\nAll {len(CORPUS)} normaliser cases match the golden corpus.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
