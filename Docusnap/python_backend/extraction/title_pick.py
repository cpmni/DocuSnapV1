"""
extraction/title_pick.py — Auto-Title: pick a document's own biggest standalone heading
as its human-memorable title ("Boiler Service Certificate").

Generic Document design §5 (docs/designs/GENERIC_DOCTYPE_2026-07-18.md; reggie's rules,
precision-FIRST). Pure + deterministic: no I/O, no env reads, no randomness. Runs ONLY for
docs whose type detection returned None (the process_docs seam gates it), so typed docs
never get a title row (PIN 5). The cardinal rule, PINNED by tests/test_title_pick.py:
**empty beats junk** — when nothing clears the bar, return None, never a low-scoring pick.

A wrong title costs a weak filename, never a wrong folder — which is why editable-always +
review-bound (method 'auto_title', conf 60, plus the trust 'generic-type' refusal) is the
whole safety story. There is deliberately NO validation_patterns entry and NO renderer
RegExp twin — a title is free text; do not add one one-sided.

Thresholds marked PROVISIONAL are expected tuning points; change them WITH the battery.
"""

import re

from extraction.keyword import _COL_BREAK_RE          # the shared column-break contract — never hardcode spaces
from extraction.wordness import token_logprob, ref_bleed, WEAK_TOKEN_LOGPROB, _HARD_FLOOR
from extraction.text_normalise import normalise_for_tokens

MIN_SCORE = 3.0            # PROVISIONAL acceptance bar
MAX_LINES = 80             # position decay kills later lines anyway; caps multi-page text
MAX_LEN = 60               # = filing sanitiseValue cap
MIN_LEN = 3

# Words that make a line SMELL like a document title (frozen provisional set).
TITLE_NOUNS = frozenset((
    "certificate", "agreement", "contract", "statement", "policy", "notice", "report",
    "warranty", "guarantee", "licence", "license", "permit", "schedule", "summary",
    "confirmation", "declaration", "assessment", "valuation", "manual", "handbook",
    "plan", "terms", "conditions", "letter", "form", "application", "renewal",
    "reminder", "receipt", "record", "results", "review", "specification",
))

# A bare generic single word is never a useful title.
# 'location'/'ticket' added 2026-07-20 (letterhead geometry measurement): table-header caption
# vocabulary on service/job documents — a bold header cell was letterhead-SIZED and got suggested
# as a company. Same class as 'date'/'total'; equally useless as a Generic-Document title.
GENERIC_SINGLES = frozenset((
    "invoice", "statement", "copy", "urgent", "draft", "original", "document", "page",
    "private", "confidential", "important", "attention", "date", "total", "details",
    "location", "ticket",
))

_LEGAL_SUFFIX_RE = re.compile(r"\b(ltd|limited|plc|llp|llc|inc|gmbh|co|company)\.?$", re.I)
_PAGE_MARKER_RE = re.compile(r"^page\s*\d+(\s*(of|/)\s*\d+)?$", re.I)
_DATE_LINE_RE = re.compile(
    r"^(date[d:\s]*)?\d{1,2}[\s/.-]+(\d{1,2}|[a-z]{3,9})[\s/.-]+\d{2,4}$|^\d{4}-\d{2}-\d{2}$", re.I)
_CONTACT_RE = re.compile(r"(www\.|http|@|tel[:\s]|telephone|phone|fax|e-?mail|mobile)", re.I)
_POSTCODE_RE = re.compile(r"\b[A-Z]{1,2}\d[A-Z0-9]?\s*\d[A-Z]{2}\b")          # twin of validation_patterns.postcode_uk
_STREET_RE = re.compile(
    r"\b(street|st\.|road|rd\.|avenue|ave\.|lane|drive|close|court|way|park|house|unit|floor|suite)\b", re.I)
_SECTION_RE = re.compile(r"^(section|part|appendix|schedule)\s+[a-z0-9]+$", re.I)
_SALUTATION_RE = re.compile(r"^(dear|to whom|re[:\s]|ref[:\s])", re.I)
# Trailing reference-code strip (mirrors keyword.py's heading-adjacent code idiom):
# "Certificate No. 10023" / "Certificate #A-77" reduce to their word core.
_TRAIL_CODE_RE = re.compile(r"[\s:]*(?:no\.?|number|ref\.?|#)?[\s:]*[#]?[A-Z0-9][A-Z0-9\-/]*\d[A-Z0-9\-/]*\s*$", re.I)

_SMALL_WORDS = frozenset(("of", "the", "and", "for", "to", "a", "an", "in", "on", "at", "by"))


def _strip_trailing_code(s):
    prev = None
    while prev != s:
        prev = s
        s = _TRAIL_CODE_RE.sub("", s).strip(" \t-–:·|")
    return s.strip()


def _titlecase_from_caps(s):
    """ALL-CAPS display → Title Case, preserving <=3-char all-caps tokens ("EPC Certificate")."""
    out = []
    for i, w in enumerate(s.split()):
        if len(w) <= 3 and w.isupper() and w.isalpha():
            out.append(w)
        elif w.lower() in _SMALL_WORDS and i > 0:
            out.append(w.lower())
        else:
            out.append(w[:1].upper() + w[1:].lower())
    return " ".join(out)


def _supplier_overlap(candidate, supplier_name):
    if not supplier_name:
        return 0.0
    ct = set(normalise_for_tokens(candidate).split())
    st = set(normalise_for_tokens(supplier_name).split())
    if not ct or not st:
        return 0.0
    return len(ct & st) / len(ct)


def _is_addressish(line):
    return bool(_POSTCODE_RE.search(line) or _STREET_RE.search(line) or _CONTACT_RE.search(line))


def _reject(cand, lines, i, supplier_name):
    """The precision-first rejection ladder. Returns a reason string (rejected) or None."""
    low = cand.lower().strip()
    words = cand.split()
    alpha = sum(1 for ch in cand if ch.isalpha())
    digits = sum(1 for ch in cand if ch.isdigit())
    if not (MIN_LEN <= len(cand) <= MAX_LEN):
        return "length"
    if not (1 <= len(words) <= 7):
        return "word-count"
    if alpha < 3 or alpha / max(1, len(cand.replace(" ", ""))) < 0.7:
        return "alpha-ratio"
    if digits / max(1, len(cand.replace(" ", ""))) > 0.3:
        return "digit-ratio"
    if _PAGE_MARKER_RE.match(low) or _DATE_LINE_RE.match(low) or _SECTION_RE.match(low):
        return "marker"
    if _CONTACT_RE.search(cand) or _POSTCODE_RE.search(cand) or _STREET_RE.search(cand):
        return "chrome/address"
    if _SALUTATION_RE.match(low) or cand.rstrip()[-1:] in ".;,":
        return "prose/salutation"
    if cand.rstrip().endswith(":"):
        return "caption"
    if len(words) == 1 and low in GENERIC_SINGLES:
        return "generic-single"
    if _LEGAL_SUFFIX_RE.search(low):
        return "company-name"
    if _supplier_overlap(cand, supplier_name) >= 0.6:
        return "supplier-dupe"
    # Address-block adjacency: the next 2 lines look like an address/contact block →
    # this line is a letterhead/address heading, not the document's title.
    nxt = [l.strip() for l in lines[i + 1:i + 3] if l.strip()]
    if nxt and all(_is_addressish(l) for l in nxt) and len(nxt) >= 2:
        return "address-block"
    # Validation ladder: trigram garble via token_logprob DIRECTLY — bypasses wordness's
    # _CHROME stoplist by construction ("Statement"/"Certificate" are legal titles).
    # Tokens <=3 chars are EXEMPT: acronyms ("EPC", "MOT") score as garble on a
    # char-trigram model but are exactly the tokens real titles carry.
    scored = [(t, token_logprob(t)) for t in re.findall(r"[a-z]{4,}", low)]
    scored = [(t, s) for t, s in scored if s is not None]
    if scored:
        if min(s for _, s in scored) < _HARD_FLOOR:
            return "garble-floor"
        weak = sum(1 for _, s in scored if s < WEAK_TOKEN_LOGPROB)
        if weak / len(scored) >= 0.5:
            return "garble-ratio"
    if ref_bleed(cand):
        return "ref-bleed"
    return None


def pick_title(text, supplier_name=None, max_lines=MAX_LINES):
    """Return {'title','line_index','score'} for the best heading, or None (empty beats junk)."""
    if not text:
        return None
    lines = [l.rstrip() for l in str(text).splitlines()[:max_lines]]
    total = max(1, len(lines))
    best = None
    for i, line in enumerate(lines):
        segs = [s.strip() for s in _COL_BREAK_RE.split(line) if s.strip()]
        standalone = len(segs) == 1
        for seg in segs:
            cand = _strip_trailing_code(seg)
            if not cand:
                continue
            if _reject(cand, lines, i, supplier_name):
                continue
            words = cand.split()
            caps = cand.isupper()
            titlecased = (not caps) and all(w[:1].isupper() or w.lower() in _SMALL_WORDS for w in words)
            has_noun = any(w.strip(".,").lower() in TITLE_NOUNS for w in words)
            score = max(0.0, 2.0 - 3.0 * (i / total))
            score += 1.0 if standalone else 0.25
            score += 0.75 if caps else (0.5 if titlecased else 0.0)
            score += 0.5 if 2 <= len(words) <= 5 else 0.0
            score += 1.0 if has_noun else 0.0
            # Acceptance bar: a TITLE_NOUN, or an ALL-CAPS standalone in the top 10 lines
            # that is NOT line 1 (the letterhead guard for unresolved suppliers).
            if score < MIN_SCORE:
                continue
            if not (has_noun or (caps and standalone and i < 10 and i != 0)):
                continue
            if best is None or score > best["score"]:
                display = _titlecase_from_caps(cand) if caps else cand
                best = {"title": display, "line_index": i, "score": round(score, 2)}
    return best
