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
    """True for fields that hold a NAME / company / person / postal address — where OCR
    gibberish should be quality-checked. Keyed on the field key/label so it works
    for custom fields too. Conservative: only obvious name-ish fields."""
    # Normalise separators to spaces so "mac_address"/"bill_to" tokenise as whole words.
    hay = re.sub(r"[^a-z0-9]+", " ", f"{field_key or ''} {label or ''}".lower())
    if any(tok in hay for tok in (
        "name", "supplier", "customer", "company", "client", "vendor",
        "person", "contact", "payee", "bill to", "ship to",
    )):
        return True
    # "address" is name-like ONLY for a POSTAL/person address. A MAC / IP / hardware /
    # network "address" is a technical IDENTIFIER (a code: "D4:F0:C9:25:9B:64",
    # "192.168.1.200") with no real words — classing it name-like makes the name-quality /
    # code-reject gates strip its legitimate value, so a labelled anchor could never fill
    # mac_address / ip_address. Exclude the technical-address qualifiers.
    if "address" in hay and not re.search(
            r"\b(mac|ip|ipv4|ipv6|hardware|physical|network|gateway|subnet|dns|host|port)\b", hay):
        return True
    # Common ABBREVIATIONS that a substring test would miss ("cust" is not inside
    # "customer") — matched as WHOLE WORDS so they can't false-positive on an
    # unrelated key ("custom_ref", "custody_value"). A field keyed/labelled "cust" is the
    # customer name and must get the same edge-strip / name-quality / token-repair treatment.
    return bool(set(hay.split()) & {"cust"})


def network_address_validation(field_key, label=None):
    """Return the validation key 'mac_address' / 'ip_address' for a NETWORK-IDENTIFIER
    field, else None. A MAC/IP is a CODE with a precise, well-defined format (colons,
    dotted octets) — not a learned digit-position shape and not a generic 'text' charset —
    so it gets a first-class validation pattern instead of falling through gates that don't
    know its punctuation (the ':' flagged "unexpected", the new octet length flagged a
    "shape" anomaly). Keyed on WHOLE-WORD tokens (mirrors the technical-address exclusion in
    is_name_like_field) so it can't false-positive on 'description'/'ship'/'recipient'.
    Reusable for any install whose doc type carries mac/ip fields."""
    hay = re.sub(r"[^a-z0-9]+", " ", f"{field_key or ''} {label or ''}".lower())
    toks = set(hay.split())
    if toks & {"mac", "hardware"}:        # "hardware address" == MAC
        return "mac_address"
    if toks & {"ip", "ipv4", "ipv6"}:
        return "ip_address"
    return None


def is_network_address_field(field_key, label=None):
    """True for a MAC/IP network-identifier field (see network_address_validation)."""
    return network_address_validation(field_key, label) is not None


# An OCR glyph -> the HEX digit it was most likely misread FROM. Restricted to substitutions
# that are safe only in a hex (MAC) context; mirrors the ocr_corrector confusion pairs. Used
# ONLY to recover a value that then FULLY matches the field's precise pattern — never to guess.
_HEX_OCR_CONFUSION = {
    'O': '0', 'o': '0', 'Q': '0', 'D': '0',
    'I': '1', 'l': '1', 'i': '1', '|': '1',
    'Z': '2', 'z': '2',
    'T': '7',
    'S': '5', 's': '5',
    'G': '6',
    'B': '8',
    'g': '9', 'q': '9',
}


def normalize_network_address(value, val_key, patterns):
    """Reconcile a MAC/IP value against its PRECISE pattern. Returns (result, kind):

      (value,  'ok')       already exactly valid — no change
      (found,  'clean')    a valid MAC/IP is embedded with surrounding junk (e.g. a trailing
                           OCR control char that pushed it below the authoritative coverage,
                           or a "IP: " prefix) — `found` is the trimmed clean value
      (fixed,  'repaired') MAC only: a single OCR-confusion substitution ("T3"->"73") makes it
                           fully valid — recover-and-FLAG upstream, never a silent rewrite
      (value,  'invalid')  not a valid MAC/IP and unrecoverable — flag upstream

    A malformed IP is only ever flagged (its decimal octets carry no safe glyph map)."""
    if not value:
        return value, 'ok'
    pats = patterns if isinstance(patterns, list) else [patterns]
    for p in pats:
        m = re.search(p, value)
        if m:
            found = m.group(0)
            return (found, 'ok' if found == value else 'clean')
    if val_key == 'mac_address':
        out, changed = [], 0
        for c in value:
            if c in '0123456789abcdefABCDEF' or c in ':-.':
                out.append(c)
            elif c in _HEX_OCR_CONFUSION:
                out.append(_HEX_OCR_CONFUSION[c]); changed += 1
            else:
                out.append(c)          # unknown glyph — leave it (the match will then fail)
        cand = ''.join(out)
        if changed:
            for p in pats:
                m = re.search(p, cand)
                if m:
                    return m.group(0), 'repaired'
    return value, 'invalid'


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
    # Proper-noun shape (len>=4, no 4+ consonant run): Title-case ("Beaumont") OR
    # ALL-CAPS ("BEAUMONT") — many invoices print the company name in capitals, so
    # an all-caps alphabetic token is real name content, not gibberish. (A <=3 char
    # Title token that wasn't a known word/abbrev above is almost always an OCR
    # truncation — "Cre" from "Crescent" — so it stays "bad".)
    if len(t) >= 4 and not _has_long_consonant_run(low):
        title_case = t[0].isupper() and t[1:].islower()
        all_caps   = t.isalpha() and t.isupper()
        if title_case or all_caps:
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
