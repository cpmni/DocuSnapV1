"""Build the compact character-trigram table used by wordness.py.

Trains a character TRIGRAM language model on public-domain word + name lists and
emits extraction/data/char_trigrams.json (counts + add-k params). Run at BUILD time;
the runtime ships only the small JSON table (no word list, no dependency, offline).

Sources (all commercially free / public domain):
  - dwyl/english-words  words_alpha.txt        Unlicense (public domain)  ~370k words
  - US Census 2010 surnames  Names_2010Census   US-Gov public domain       ~162k surnames
Optionally add SSA given names (US-Gov public domain) for first-name structure.

Usage:
  py -3.12 extraction/build_wordness_table.py words_alpha.txt surnames.txt [more.txt ...]

The model: for each word, lowercased and reduced to [a-z], padded ^^word$ , we count
char trigrams and their bigram contexts. Runtime conditional prob (wordness.py):
  P(c3 | c1c2) = (tri[c1c2c3] + k) / (bi[c1c2] + k*V)
add-k (k=0.1) Laplace smoothing over vocabulary V = 28 (a-z + start '^' + end '$').
Only trigrams seen >= MIN_COUNT are stored; unseen ones fall to the smoothed floor.
"""
from __future__ import annotations
import json
import os
import sys
from collections import Counter

START, END = "^", "$"
ALPHABET = "abcdefghijklmnopqrstuvwxyz" + START + END
V = len(ALPHABET)          # 28
K = 0.1                    # add-k smoothing
MIN_COUNT = 3             # drop noise trigrams below this (keeps the table compact)


def _words(paths):
    for p in paths:
        with open(p, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                w = "".join(c for c in line.strip().lower() if c.isalpha())
                if len(w) >= 2:
                    yield w


def build(paths):
    tri = Counter()
    bi = Counter()
    uni = Counter()
    n_words = 0
    for w in _words(paths):
        n_words += 1
        s = START + START + w + END
        for ch in s:
            uni[ch] += 1
        for i in range(len(s) - 2):
            a, b, c = s[i], s[i + 1], s[i + 2]
            bi[a + b] += 1
            tri[a + b + c] += 1
    tri = {k: v for k, v in tri.items() if v >= MIN_COUNT}
    return {
        "version": 2,
        "k": K, "V": V, "min_count": MIN_COUNT,
        "n_words": n_words,
        "uni_total": sum(uni.values()),
        "uni": dict(uni),
        "bi": dict(bi),
        "tri": tri,
    }


def main(argv):
    if len(argv) < 2:
        print("usage: build_wordness_table.py <wordlist> [more lists ...]")
        return 1
    model = build(argv[1:])
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "char_trigrams.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(model, fh, separators=(",", ":"))
    sz = os.path.getsize(out)
    print(f"words={model['n_words']}  bigrams={len(model['bi'])}  "
          f"trigrams={len(model['tri'])}  -> {out}  ({sz//1024} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
