"""
extraction/letterhead.py — read the ISSUER off a letterhead when nothing has been learned yet.

THE HOLE THIS FILLS (measured 2026-07-20). `field_patterns.supplier_name` finds the issuer ONLY
by a caption — "Bill From", "Supplier", "Vendor", "Issued By", "Billed By", "Seller", "Company
Name", "Business Name". Real letterheads carry NONE of those: the company name simply sits at the
top of the page. Every OTHER issuer path (learned template, logo fingerprint, hint text-scan,
branding bank) needs a prior confirm. So on first contact with a new supplier the issuer is
UNREADABLE, and a traced invoice whose line 1 is literally "Vellum & Crane Stationers" returned
supplier_name: null. Measured on a 9-supplier corpus with a fresh DB per supplier: 0 of 270
documents identified their issuer cold.

Worse, the RECIPIENT *is* captioned ("Bill To") and at a HIGHER base confidence (78 vs 40), so the
one captioned company on the page belongs to the other party.

WHAT THIS DOES AND DOES NOT DO. It SUGGESTS — it never asserts. The engine puts the name on a
value-less row as `suggested_supplier`, which the Review UI already renders as a one-click
"Use '<name>'" button. Nothing is filed, nothing is learned, no scope is created until a human
clicks. The argument for suggest-only is not timidity: this reader only ever has to carry
DOCUMENT #1. After one confirm the supplier has a hint, a logo and a template, and every later
document resolves at full confidence — so the reader never needs the authority to assert, and a
wrong assert would plant a poisoned learning scope that then attracts future documents.

NO NEW VOCABULARY. Every test below is an existing, reviewed primitive:
  · chrome_band.issuer_chrome_lines — the top band TRUNCATED at the first recipient marker, so
    "Bill To: <customer>" and everything under it is excluded by construction;
  · title_pick's rejection regexes — and note the two modules are exact COMPLEMENTS: a line
    title_pick rejects as "company-name" or "address-block" is precisely a letterhead-issuer
    candidate. test_letterhead_pick.py pins that relationship so an edit can't split them apart;
  · keyword._is_plausible_supplier_name — the shared garble/chrome gate, already mirrored in
    database/modules/learning.js, so reusing it UNCHANGED adds no drift surface.

DELIBERATELY NOT USED: font size / "largest text on the page". The word geometry that would
express it is computed and then discarded in ocr/tesseract.py (the engine receives a plain
string), so a height signal would need new plumbing. Line ORDER is the usable proxy and it is
sound only because tesseract.py rebuilds page text from word geometry into visual rows.

⚠ THE STOP RULE (Oracle, 2026-07-20). Text position cannot distinguish an issuer letterhead from
a RECIPIENT block that merely sits higher on the page — an uncaptioned window-envelope address
carries no marker to truncate at. Only word HEIGHT can ("the biggest text in the top band"). This
module therefore abstains on that layout instead of guessing. **The moment someone relaxes
_MAX_BAND_INDEX, adds column splitting, or loosens the two-candidate abstain to chase yield, they
are paying for geometry with regex — restore the word boxes from ocr/tesseract.py instead.**

KNOWN YIELD LIMITS, deliberate and not to be "fixed" here: a name sharing a visual row with
anything else (a column break) is rejected wholesale, because splitting on column breaks is
exactly what would admit a right-hand recipient column; a strapline or second trading name in the
band triggers the abstain; and lowercase-initial brands ("easyJet") fail the name shape.

⚠⚠ STATUS: DARK AND UNFINISHED. `LETTERHEAD_ISSUER` is DEFAULT OFF and should stay off until the
geometry slice below lands. MEASURED 2026-07-20:
    · synthetic Demo Docs corpus, 45 docs cold : 31 correct suggestions, 0 wrong  (69%)
    · REAL scanned invoices, 14 docs           : **0 suggestions**                 (0%)
The gap is the whole story, and it is not a tuning miss — it is the design's ceiling. Real
letterheads read "SuperStore" → "INVOICE" → "# 32104": the company name is line 1, and there is
NOTHING BENEATH IT to corroborate against. The synthetic generator always prints a tidy address
block under the name, so the corroboration rule was calibrated against a world that does not
exist. Traced causes, all three:
    · SuperStore   (8 of the 14) — passes shape/plausibility, dies on corroboration (0 address
                                   lines beneath, no legal suffix);
    · Contoso Asia               — 1 address line where the rule demands 2;
    · City Office NI             — OCR noise prefix ("~    City Office NI") fails the name shape.
DO NOT rescue this by loosening corroboration or stripping noise prefixes. That is tuning against
the 14 documents someone happened to look at, and it is what the stop rule below forbids.
"SuperStore" is the LARGEST TEXT on its page by a wide margin — word HEIGHT identifies it
instantly and text position never will. The fix is the geometry slice, not a threshold.

Pure + deterministic: no I/O, no env reads, no DB. Mirrors title_pick.py's contract.
"""

import re

from extraction import chrome_band
from extraction.title_pick import (
    _CONTACT_RE, _DATE_LINE_RE, _LEGAL_SUFFIX_RE, _PAGE_MARKER_RE, _POSTCODE_RE,
    _SALUTATION_RE, _SECTION_RE, _STREET_RE, GENERIC_SINGLES, _is_addressish,
)
from extraction import keyword

# A candidate must sit in the FIRST FEW band lines. This is the load-bearing guard, not a
# cosmetic bound: chrome_band's recipient-marker set deliberately leans to RECALL, so a garbled
# marker ("Bi11 To:") can leak the recipient into the band — and a recipient block has an address
# under it too, so the corroboration test below would happily fire on the wrong party. The issuer's
# name sits at the very top; a leaked recipient sits BELOW the letterhead's own address lines.
# Do not relax this without re-measuring.
_MAX_BAND_INDEX = 2

# One capitalised token, bounded; or a lowercase connector. Alternation is unambiguous by first
# character, so there is no ambiguous-alternation backtracking; anchored both ends; no nested
# repetition. Linear time.
_LH_WORD = r"(?:[A-Z][A-Za-z0-9&'’.\-]{0,29}|&|and|of|the|for)"
_LETTERHEAD_NAME_RE = re.compile(r"^%s(?:[ ]%s){0,6}$" % (_LH_WORD, _LH_WORD))

_MIN_CORROBORATING_LINES = 2   # address-ish lines beneath, when there is no legal suffix
_LOOKAHEAD_LINES = 3


def _disqualified(line):
    """Reasons a band line can never be an issuer name. All reused from title_pick."""
    s = line.strip()
    if not s or s.endswith(":"):
        return True
    if s.lower() in GENERIC_SINGLES:
        return True
    return bool(_PAGE_MARKER_RE.match(s) or _DATE_LINE_RE.match(s) or _SECTION_RE.match(s)
                or _SALUTATION_RE.match(s) or _CONTACT_RE.search(s)
                or _POSTCODE_RE.search(s) or _STREET_RE.search(s))


def pick_issuer(ocr_text, detected_title=None, type_phrases=None):
    """The issuer name from a letterhead, or None. `detected_title` is the document's own detected
    title and `type_phrases` the doc-type vocabulary — both EXCLUDED so "INVOICE" can never be
    read as a company. Returns None whenever the evidence is ambiguous: empty beats a guess."""
    lines = chrome_band.issuer_chrome_lines(ocr_text)
    if not lines:
        return None

    excluded = {str(detected_title or "").strip().lower()}
    excluded.update(str(p).strip().lower() for p in (type_phrases or []))
    excluded.discard("")

    # Scan the WHOLE band for company-shaped lines, not just the first few. Accepting from the top
    # while only LOOKING at the top is what let the uncaptioned recipient-first layout through: a
    # window-envelope address block carries no "Bill To" caption at all, so nothing truncates it —
    # the CUSTOMER sits at index 0 with its own address beneath (corroboration satisfied, single
    # candidate, no abstain) and the issuer's letterhead sits below at index 4+, unseen. Looking at
    # the whole band turns that from a WRONG SUGGESTION into an abstain, which costs only yield.
    candidates = []
    for i, line in enumerate(lines):
        cand = line.strip()
        if cand.lower() in excluded or _disqualified(cand):
            continue
        if not _LETTERHEAD_NAME_RE.match(cand):
            continue
        if not keyword._is_plausible_supplier_name(cand):
            continue
        # CORROBORATION — a company name alone is not enough, or every stray capitalised phrase in
        # a header would qualify. Either it declares itself a company (Ltd/plc/LLP/…), or it sits
        # above a contact block, which is what a letterhead IS.
        if not _LEGAL_SUFFIX_RE.search(cand):
            nxt = [l for l in lines[i + 1:i + 1 + _LOOKAHEAD_LINES] if l.strip()]
            if sum(1 for l in nxt if _is_addressish(l)) < _MIN_CORROBORATING_LINES:
                continue
        candidates.append((i, cand))

    if not candidates:
        return None
    # TWO plausible companies anywhere in the band means we cannot tell which one issued the
    # document — a leaked recipient (captioned or not), a second trading name, an agent. Abstain:
    # an empty issuer routes to review, a wrong one becomes a learning SCOPE that then attracts
    # future documents.
    from extraction.title_pick import _supplier_overlap
    first_i, first = candidates[0]
    if any(_supplier_overlap(first, other) < 0.5 for _, other in candidates[1:]):
        return None
    # The accepted name must still sit at the TOP of the band. A letterhead issuer is the first
    # thing on the page; anything further down that survived every test above is not one.
    if first_i > _MAX_BAND_INDEX:
        return None
    return first
