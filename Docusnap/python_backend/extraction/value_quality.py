"""
extraction/value_quality.py
---------------------------
Lightweight "is this a real name?" validator for free-text name/company/person/
address fields. OCR can leave a name field holding gibberish ("Fr eanehae Crane")
or an address fragment ("67 Boucher Cre") that passes the loose free-text
credibility check and — worse — is judged a "plausible" supplier identity, which
blocks the learned-hint recovery and lets the garbage win at high confidence.

`name_quality` scores the fraction of TOKENS that look like real name content. A
token is "good" if it is a known business abbreviation (Ltd/Inc/NI…), a common
English word, or a well-formed Title-Case proper noun (≥4 chars). Fragments
("Fr"/"St"), consonant gibberish, mixed-case junk ("OMe"), lowercase non-words
("eanehae") and digit/symbol-only tokens score "bad". This deliberately does NOT
require dictionary membership for proper nouns, so legitimate names not in any
word list ("Boucher", "Polychemtex", "Beaumont", "Tudordale") stay high.

No third-party dependency: the common-word list is a small project-authored set;
the proper-noun + abbreviation shape covers the rest. Reusable across the
extraction pipeline (plausibility, crop credibility, confidence) and mirrored in
JS for the persistence side (database/modules/value_quality.js).
"""

import re

_VOWELS = set("aeiouy")   # y counts as a vowel so "Polychemtex" isn't flagged

# Business/legal/locale abbreviations that are legitimate name tokens despite
# being short / all-caps. Lowercased for lookup.
ABBREV = {
    "ltd", "inc", "plc", "llc", "llp", "co", "corp", "gmbh", "srl", "sa", "sas",
    "ag", "bv", "nv", "pty", "pvt", "spa", "oy", "ab", "as", "kg", "ek",
    "ni", "uk", "us", "usa", "eu", "ie", "roi", "uae",
    "&",
}

# Small project-authored set of common English words that recur in company / name
# / address fields (lower-cased). Proper-noun shape handles the rest, so this only
# needs the frequent lowercase / short words that would otherwise look like
# fragments. NOT customer data — generic, safe to ship.
COMMON_WORDS = {
    "the", "and", "of", "for", "at", "in", "on", "to", "by", "de", "la", "le",
    "city", "office", "offices", "care", "home", "homes", "house", "court",
    "service", "services", "solution", "solutions", "system", "systems",
    "group", "holding", "holdings", "trading", "trade", "supply", "supplies",
    "global", "national", "international", "north", "south", "east", "west",
    "works", "workshop", "industrial", "industries", "engineering", "electrical",
    "electronics", "logistics", "transport", "haulage", "packaging", "print",
    "printing", "media", "marketing", "consulting", "consultancy", "associates",
    "partners", "partnership", "company", "limited", "enterprises", "enterprise",
    "developments", "construction", "builders", "building", "maintenance",
    "property", "properties", "estates", "motors", "motor", "auto", "garage",
    "foods", "food", "catering", "kitchen", "stores", "store", "shop", "retail",
    "wholesale", "distribution", "distributors", "products", "manufacturing",
    "metals", "steel", "timber", "tools", "hardware", "supplies", "energy",
    "power", "water", "gas", "oil", "farm", "farms", "dairy", "valley", "hill",
    "park", "road", "street", "lane", "avenue", "drive", "crescent", "square",
    "place", "way", "close", "gardens", "view", "green", "mount", "bridge",
    "mill", "wood", "fields", "manor", "lodge", "hall", "centre", "center",
    "health", "medical", "dental", "care", "nursing", "clinic", "pharmacy",
    "school", "college", "academy", "council", "borough", "county", "town",
    "saint", "new", "old", "great", "little", "upper", "lower", "first", "royal",
}

_WORD_RE = re.compile(r"[^\s]+")


def is_name_like_field(field_key, label=None):
    """True for fields that hold a NAME / company / person / address — where OCR
    gibberish should be quality-checked. Keyed on the field key/label so it works
    for custom fields too. Conservative: only obvious name-ish fields."""
    hay = f"{field_key or ''} {label or ''}".lower()
    if any(tok in hay for tok in (
        "name", "supplier", "customer", "company", "client", "vendor",
        "person", "contact", "address", "payee", "bill_to", "ship_to",
    )):
        return True
    # Common ABBREVIATIONS that a substring test would miss ("cust" is not inside
    # "customer") — matched as WHOLE WORDS so they can't false-positive on an
    # unrelated key ("custom_ref", "custody_value" -> token "custom"/"custody", not
    # "cust"). A field keyed/labelled "cust" is the customer name and must get the
    # same edge-strip / name-quality / token-repair treatment as "customer".
    words = set(re.findall(r"[a-z]+", hay))
    return bool(words & {"cust"})


def _has_long_consonant_run(low):
    run = 0
    for c in low:
        if c.isalpha() and c not in _VOWELS:
            run += 1
            if run >= 4:
                return True
        else:
            run = 0
    return False


def _token_good(tok):
    """True/False if the token is good/bad name content; None to skip (punctuation
    only) so it doesn't count toward the ratio."""
    t = tok.strip(".,;:()[]{}'\"`/\\|")
    if not t:
        return None
    if "�" in t:            # OCR replacement char = failed glyphs
        return False
    low = t.lower()
    if low in ABBREV:
        return True
    if sum(c.isalpha() for c in t) == 0:
        return False             # digit/symbol-only token ("67") — not name content
    if low in COMMON_WORDS:
        return True
    if len(t) <= 2:
        return False             # 2-char alpha fragment ("Fr", "St", "WM")
    if not any(c in _VOWELS for c in low):
        return False             # consonant gibberish ("brc")
    # Proper-noun shape: Title-case, rest lowercase, no 4+ consonant run, len>=4.
    # (A <=3 char Title token that wasn't a known word/abbrev above is almost
    # always an OCR truncation — "Cre" from "Crescent" — so it stays "bad".)
    if len(t) >= 4 and t[0].isupper() and t[1:].islower() and not _has_long_consonant_run(low):
        return True
    return False


def name_quality(value):
    """Fraction (0..1) of meaningful tokens in `value` that look like real name
    content. 1.0 when there are no countable tokens (neutral — don't penalise an
    empty/odd value here; emptiness is handled by the caller). Lower = more
    OCR-garbled / fragmented."""
    if not value:
        return 1.0
    good = bad = 0
    for m in _WORD_RE.findall(str(value)):
        r = _token_good(m)
        if r is True:
            good += 1
        elif r is False:
            bad += 1
    total = good + bad
    return 1.0 if total == 0 else good / total


def strip_name_edges(value, allowed_extra=None):
    """Remove OCR EDGE artefacts from a free-text name/company/address value:
      - a LEADING run of non-alphanumeric chars — a real name always STARTS with a
        letter or digit, never "--«", ">", a stray quote (mirrors the crop
        credibility rule v[0].isalnum());
      - a TRAILING run of whitespace + DISALLOWED symbols for the field type
        (guillemets «», em-dash, the U+FFFD replacement char), while KEEPING
        legitimate trailing punctuation (a " -" separator before a wrapped site,
        "Inc.").
    The INTERIOR is never touched, so legitimate internal variation/punctuation is
    preserved (the free-text rule). `allowed_extra` is the field type's
    extra-punctuation string (config field_charsets); None => only the leading
    non-alnum run and edge whitespace are stripped. Returns the value unchanged
    when nothing is strippable, or when the result would be empty / a <3-char
    fragment of a longer value (over-strip guard). Deterministic; reusable for
    every supplier/field — no document/coordinate specifics."""
    if not value:
        return value
    s = str(value)
    n = len(s)
    # Leading: drop everything before the first alphanumeric ("--« " / ">" / quotes).
    i = 0
    while i < n and not s[i].isalnum():
        i += 1

    # Trailing: drop whitespace + disallowed symbols; keep allowed punctuation.
    def _strip_tail(ch):
        if ch.isspace():
            return True
        if ch.isalnum():
            return False
        if allowed_extra is None:
            return False            # no policy → leave trailing punctuation alone
        return ch not in allowed_extra
    j = n
    while j > i and _strip_tail(s[j - 1]):
        j -= 1

    out = s[i:j]
    if not out:
        return value
    if len(out) < 3 and len(out) < len(s.strip()):
        return value                # over-stripped a longer value — leave to the gates
    return out
