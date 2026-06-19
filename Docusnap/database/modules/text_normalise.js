'use strict';

/**
 * database/modules/text_normalise.js
 * ----------------------------------
 * JS TWIN of python_backend/extraction/text_normalise.py — byte-for-byte identical
 * comparison normaliser. The shared golden corpus
 * python_backend/tests/normalise_corpus.json is asserted by BOTH sides
 * (test_text_normalise.py + test_text_normalise.js) so the engines can't drift.
 *
 * Steps (load-bearing order): NFKC -> dash/quote fold -> toLowerCase() (mirrors
 * Python .lower(); non-Latin out of parity scope) -> whitespace collapse via an
 * EXPLICIT class incl. NBSP (never \s — Py/JS differ) -> edge-punct trim.
 */

// Same codepoints as text_normalise.py (_DASHES/_SQUOTES/_DQUOTES), as \u escapes.
const _DASH_RE = /[‐-―−﹘﹣－]/g;
const _SQ_RE   = /[‘’‛′´`]/g;
const _DQ_RE   = /[“”″]/g;
const _WS_RE   = /[ \t\r\n\f ]+/g;
const _EDGE_RE = /^[^0-9A-Za-z]+|[^0-9A-Za-z]+$/g;

function normaliseForTokens(value) {
  if (!value) return '';
  let s = String(value).normalize('NFKC');
  s = s.replace(_DASH_RE, '-');
  s = s.replace(_SQ_RE, "'");
  s = s.replace(_DQ_RE, '"');
  s = s.toLowerCase();
  s = s.replace(_WS_RE, ' ');
  s = s.replace(_EDGE_RE, '');
  return s.trim();
}

function tokenise(value) {
  const n = normaliseForTokens(value);
  return n ? n.split(' ').filter(Boolean) : [];
}

module.exports = { normaliseForTokens, tokenise };
