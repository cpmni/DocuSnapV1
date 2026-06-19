"""
extraction/text_normalise.py
----------------------------
Deterministic COMPARE-TIME normaliser used to match an extracted value against
learned canonical forms (see name_match.py). PURE — it produces a *comparison*
form and NEVER mutates a stored/display value.

Mirrored BYTE-FOR-BYTE in `database/modules/text_normalise.js`; the shared golden
corpus `python_backend/tests/normalise_corpus.json` is asserted by BOTH
`tests/test_text_normalise.py` and `database/modules/test_text_normalise.js`, so the
two engines can never silently drift.

Ordered steps (order is load-bearing):
  1. Unicode NFKC (folds ligatures/full-width/compatibility forms).
  2. Fold the dash family -> ASCII '-', curly single quotes -> "'", curly double -> '"'.
     (NFKC does NOT fold en/em dash or curly quotes, so this step does real work.)
  3. .lower()  -- NOT casefold(): casefold diverges from JS toLowerCase() on some
     non-Latin chars. The shipped corpus is Latin business text; non-Latin scripts
     are explicitly OUT of Phase-1 parity scope (documented in the parity test).
  4. Whitespace collapse via an EXPLICIT class -> single space (Python `\\s` and JS
     `\\s` differ in Unicode handling -- never use `\\s` here; NBSP included explicitly).
  5. Edge-punctuation trim: strip leading/trailing non-alphanumeric (handles
     "*- Beaumont..." and a trailing " -"); INTERIOR punctuation is preserved.
"""

import re
import unicodedata

# Explicit codepoints (non-raw strings) so they are unambiguous + match the JS twin.
_DASHES  = "‐‑‒–—―−﹘﹣－"
_SQUOTES = "‘’‛′´`"
_DQUOTES = "“”″"

_DASH_RE = re.compile("[" + _DASHES + "]")
_SQ_RE   = re.compile("[" + _SQUOTES + "]")
_DQ_RE   = re.compile("[" + _DQUOTES + "]")
_WS_RE   = re.compile("[ \t\r\n\f\v ]+")  # explicit class incl. NBSP (never use \\s)
_EDGE_RE = re.compile(r"^[^0-9A-Za-z]+|[^0-9A-Za-z]+$")


def normalise_for_tokens(value) -> str:
    """Return the deterministic comparison form of `value` (see module docstring)."""
    if not value:
        return ""
    s = unicodedata.normalize("NFKC", str(value))
    s = _DASH_RE.sub("-", s)
    s = _SQ_RE.sub("'", s)
    s = _DQ_RE.sub('"', s)
    s = s.lower()
    s = _WS_RE.sub(" ", s)
    s = _EDGE_RE.sub("", s)
    return s.strip()


def tokenise(value) -> list:
    """Whitespace-split the normalised form into tokens. Phase 1 uses a simple
    space split (no merge/split-aware segmentation); a pure-separator token like
    "-" is returned as its own token -- callers that want name CONTENT filter to
    tokens containing an alphanumeric (see name_match._is_content)."""
    n = normalise_for_tokens(value)
    return [t for t in n.split(" ") if t]
