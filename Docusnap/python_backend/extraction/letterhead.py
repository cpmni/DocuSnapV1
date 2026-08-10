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

FONT SIZE — NOW PLUMBED (the geometry slice, 2026-07-20 late evening). The word geometry is no
longer discarded: reconstruct_page_text's words_out hand-off threads page-0 rows/heights/med_h
through extract_text_and_images → engine.extract(page0_geometry) → pick_issuer(geometry=...).
When present, the GEOMETRY ARM ranks the gate-surviving candidates by LINE-level height ratio to
med_h (see _pick_by_height); when absent (cached reprocess, born-digital page 0, any mismatch)
the reader is byte-identical to the text-only version below.

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

⚠⚠ STATUS: DARK — `LETTERHEAD_ISSUER` is DEFAULT OFF. The geometry slice HAS now landed (below);
the flag stays off until the slice MEASURES well on the real corpus AND the flip passes the
owner + Oracle gate. The pre-geometry measurement that forced it, 2026-07-20:
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

# ── THE GEOMETRY ARM (2026-07-20 late evening — the slice the STOP RULE above demanded) ─────────
# Measured on the real invoices (the 0-of-14 set): the document TITLE is the largest text
# (ratio 2.87 to med_h) and the issuer is only FOURTH (1.26) — so "largest text in the top band"
# alone is WRONG. The design the data supports: geometry RANKS, the existing text filters GATE.
# With type phrases, caption lines and implausible values gated out, the issuer becomes the
# largest SURVIVING candidate. Two hard-won rules from the same measurement:
#   · heights are computed at LINE level (upper-median over the row's words — "Cit" h=64 +
#     "Office" h=101 on one visual row; word heights are noisy, the row is not);
#   · always RATIO to med_h, never absolute pixels (DPI-invariant — this project has a documented
#     DPI-hint bug in exactly that shape).
# The floors below were set from that measurement (real issuer 1.26; body text ≡ 1.0) and move
# ONLY on aggregate corpus measurement, never per-document.
_GEOM_MIN_RATIO = 1.15   # letterhead-sized: decisively above the page's median word height
_GEOM_MIN_LEAD  = 1.10   # decisively larger than the runner-up candidate (else abstain: two
                         # comparably-sized companies is the same ambiguity as the text arm's)


def _distinctive_core(cand):
    """True when the candidate has at least one DISTINCTIVE, digit-free, non-generic token. The
    geometry arm drops the text arm's corroboration rule, and without this gate a GARBLED type
    heading — 'INVOIC E', huge on the page, missed by the exact type-phrase exclusion — would rank
    first and be suggested as a company. template_matcher._distinctive_tokens is the slice-1
    primitive built for exactly this garble family ('invoic' is a proper prefix of 'invoice').
    _GENERIC_NAME_TOKENS is applied too — MEASURED on the owner's real worksheets (2026-07-20 late
    evening): 'SERVICE WORKSHEET' survived the type-word strip on 'service' alone and was suggested
    as the company 17 times; a stacked wordmark's bare 'SOLUTIONS' row likewise. HONEST COST,
    accepted: a company genuinely NAMED from generic words ("Document Solutions") is unsuggestable
    — the reader abstains, and empty beats a guess."""
    from extraction.template_matcher import _distinctive_tokens, _GENERIC_NAME_TOKENS
    toks = [t for t in re.findall(r"[A-Za-z0-9]{2,}", cand) if not any(ch.isdigit() for ch in t)]
    return bool(_distinctive_tokens(toks) - _GENERIC_NAME_TOKENS)


def _row_height(row_words):
    """A visual row's height: the UPPER-MEDIAN of its words' heights (the same len//2 convention
    med_h itself uses), so one clipped ascender can't halve a row and one smear can't double it."""
    hs = sorted(w[3] for w in row_words if w[3] > 0)
    return hs[len(hs) // 2] if hs else 0


def _row_segments(line_text, row_words):
    """[(segment_text, segment_words)] — the line split at 4+-space COLUMN BREAKS, each segment
    paired with ITS OWN words. The pairing is positional and exact: reconstruct_page_text builds
    the line by joining the row's words left-to-right with single spaces inside a column and the
    4-space marker between columns, so segment i consumes the next len(segment.split()) words.

    WHY SEGMENTS ARE SAFE HERE AND NOWHERE ELSE (measured 2026-07-20 late evening): the real
    SuperStore letterhead prints the name and the title on ONE visual row ('Superstore    INVOICE'
    @2.87 joined), so the whole-line candidate fails the name shape and the motivating case never
    even reached the ranker. The module's own warning — "splitting on column breaks is exactly
    what would admit a right-hand recipient column" — is about the TEXT arm, where position was
    the only signal; in the geometry arm a split segment still has to (a) pass every text gate,
    (b) be letterhead-SIZED by its own words' heights, and (c) decisively beat the runner-up. A
    body-sized right-column recipient fails (b); a large second company trips (c)'s abstain."""
    segs = [s.strip() for s in re.split(r" {4,}", line_text) if s.strip()]
    out, wi = [], 0
    for s in segs:
        n = len(s.split())
        out.append((s, row_words[wi:wi + n]))
        wi += n
    return out


def _pick_by_height(band_lines, geometry, is_candidate):
    """The geometry verdict, or None (→ the text arm runs). Candidates are the band lines' COLUMN
    SEGMENTS (see _row_segments), each gated by `is_candidate` and scored by its own words'
    upper-median height as a RATIO to med_h. None whenever the pairing cannot be trusted
    (missing/mismatched rows), the top survivor is not letterhead-sized (< _GEOM_MIN_RATIO), or
    two survivors are comparably sized (< _GEOM_MIN_LEAD) — every uncertain path falls back,
    never guesses."""
    med_h = geometry.get("med_h") or 0
    rows = geometry.get("rows") or []
    glines = geometry.get("lines") or []
    if med_h <= 0 or not rows or len(rows) != len(glines):
        return None
    by_text = {}
    for gi, gl in enumerate(glines):
        key = gl.strip()
        if key and key not in by_text:      # first occurrence wins — the band IS the top of page 0
            by_text[key] = gi
    scored = []
    for bl in band_lines:
        gi = by_text.get(bl.strip())
        if gi is None:
            continue                        # e.g. a truncated marker-line head — text arm's problem
        for seg, seg_words in _row_segments(glines[gi].strip(), rows[gi]):
            if len(seg_words) != len(seg.split()):
                continue                    # pairing drifted — never score words that aren't the segment's
            if not is_candidate(seg):
                continue
            h = _row_height(seg_words)
            if h > 0:
                scored.append((h / med_h, seg))
    if not scored:
        return None
    scored.sort(key=lambda t: -t[0])
    if scored[0][0] < _GEOM_MIN_RATIO:
        return None
    # FRAGMENT → FULL NAME (measured on the real corpus, 2026-07-20): a logo WORDMARK often prints
    # one word of the name huge ('Cloud' at 3.5×) while the full name recurs at letterhead size
    # ('Cloud VPS' at 1.7× in the address block). The fragment must never beat its own superset —
    # prefer the highest-ranked surviving candidate whose tokens CONTAIN the top pick's.
    top_toks = {t.lower() for t in scored[0][1].split()}
    for ratio, cand in scored[1:]:
        c_toks = {t.lower() for t in cand.split()}
        if top_toks < c_toks:
            return cand
    if len(scored) > 1 and scored[0][0] < scored[1][0] * _GEOM_MIN_LEAD:
        return None
    return scored[0][1]


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


def _contains_type_phrase(seg, excluded):
    """True when `seg` CONTAINS one of the excluded doc-type phrases as a whole-word run.

    The exclusion set was compared by exact equality, which misses every title that qualifies the
    type word — 'GOODS DELIVERY NOTE' against a list holding 'delivery note', 'ORIGINAL TAX INVOICE'
    against 'tax invoice'. A title is normally the largest text on the page, so a missed exclusion
    does not merely add a candidate: it takes the top rank and either wins or (measured on the
    Oakhaven delivery notes) sits 7% above the real company name and trips the "decisively larger"
    guard, so the reader abstains and a brand-new supplier gets no suggestion at all.

    MULTI-WORD PHRASES ONLY, and that is the precision. A single word like 'invoice' appears inside
    perfectly good company names ('Invoice Solutions Ltd'), and excluding on it would refuse real
    companies; a two-word run like 'delivery note' or 'credit note' inside a letterhead name is
    vanishingly rare. NAMED COST, pinned: a company genuinely called 'Credit Note Systems Ltd' is
    unsuggestable. That is the same trade this module already takes for generic-word names, and it
    fails the same way — toward no suggestion, never toward a wrong one."""
    low = ' ' + re.sub(r'[^a-z0-9]+', ' ', str(seg or '').lower()).strip() + ' '
    for phrase in (excluded or ()):
        p = re.sub(r'[^a-z0-9]+', ' ', str(phrase or '').lower()).strip()
        if not p or ' ' not in p:          # single words are legitimate inside company names
            continue
        if f' {p} ' in low:
            return True
    return False


def pick_issuer(ocr_text, detected_title=None, type_phrases=None, geometry=None):
    """The issuer name from a letterhead, or None. `detected_title` is the document's own detected
    title and `type_phrases` the doc-type vocabulary — both EXCLUDED so "INVOICE" can never be
    read as a company. `geometry` (optional) is the page-0 word-geometry hand-off; when present
    the GEOMETRY ARM runs first — height RANKS what the text gates let SURVIVE — and the text arm
    below is the unchanged fallback, so a None geometry is byte-identical to the pre-slice reader.
    Returns None whenever the evidence is ambiguous: empty beats a guess."""
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
    #
    # GEOMETRY ARM — the measured design: the real issuer ("SuperStore", sharing its visual row
    # with the title, nothing beneath it to corroborate) is invisible to the text arm but is the
    # LARGEST SURVIVING text by a clear margin. Candidates here are COLUMN SEGMENTS (see
    # _row_segments) run through the same text gates PLUS the distinctive-core gate (a garbled
    # type heading, or a generic-vocabulary caption like 'SERVICE WORKSHEET', has shape but no
    # distinctive token). Every uncertain verdict falls through to the text arm, so on documents
    # where geometry can't decide, behaviour is exactly the pre-slice reader.
    if geometry and geometry.get("rows"):
        # Delegate to the standalone geometry-only pick (identical guards) so the live arm and the
        # logo-text gate's confirmation witness can never drift (Oracle C1).
        pick = pick_issuer_geometry(ocr_text, geometry, detected_title, type_phrases)
        if pick is not None:
            return pick

    # TEXT ARM — unchanged from the pre-geometry reader: whole band lines, gates + corroboration.
    candidates = []
    for i, line in enumerate(lines):
        cand = line.strip()
        # Same widening as the geometry arm below: the exclusion was exact-equality, so a title
        # with one qualifying word ('GOODS DELIVERY NOTE' vs the listed 'delivery note') slipped
        # through. Both arms must agree, or the text fallback re-admits what the geometry arm
        # just refused.
        if (cand.lower() in excluded or _contains_type_phrase(cand, excluded)
                or _disqualified(cand)):
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


def geometry_from_lines(page_text_lines):
    """Adapt born_digital.page_lines() output → the pick_issuer geometry contract
    ({lines, rows, med_h, words}). Born-digital page 0 has page0_geometry=None (there is no OCR
    pass), but its text-layer lines carry per-word h_norm — so the geometry issuer arm can run on
    generated PDFs too, not just scans. Ratios to med_h are unit-invariant, so the born-digital
    normalized h_norm maps in identically. None when there is nothing to measure. Rows carry
    (x, y, w, h, text, conf); _pick_by_height reads the height at index 3."""
    if not page_text_lines:
        return None
    lines, rows, all_h = [], [], []
    for ln in page_text_lines:
        ws = ln.get("words") or []
        lines.append(ln.get("text", ""))
        rows.append([(w["x_norm"], w["y_norm"], w["w_norm"], w["h_norm"], w["text"], 90) for w in ws])
        all_h += [w["h_norm"] for w in ws if w.get("h_norm", 0) > 0]
    if not all_h:
        return None
    all_h.sort()
    return {"lines": lines, "rows": rows, "med_h": all_h[len(all_h) // 2], "words": []}


def pick_issuer_geometry(ocr_text, geometry, detected_title=None, type_phrases=None):
    """The GEOMETRY-ONLY issuer pick — pick_issuer's height arm with NO text-arm fallback (Oracle
    C1). Returns the largest surviving letterhead COLUMN SEGMENT when _pick_by_height is decisive,
    else None. This is the confirmation WITNESS for the logo-text gate's name-presence accept arm
    (engine.decide_logo_text_gate): it must NEVER fall through to a text-arm guess, because a
    marker-less recipient could otherwise confirm itself as the issuer. The guards mirror
    pick_issuer's geometry branch EXACTLY (which now delegates here), so the two cannot drift."""
    if not geometry or not geometry.get("rows"):
        return None
    lines = chrome_band.issuer_chrome_lines(ocr_text)
    if not lines:
        return None
    excluded = {str(detected_title or "").strip().lower()}
    excluded.update(str(p).strip().lower() for p in (type_phrases or []))
    excluded.discard("")

    def _geom_candidate(seg):
        s = seg.strip()
        if not s or s.lower() in excluded or _contains_type_phrase(s, excluded) or _disqualified(s):
            return False
        if not _LETTERHEAD_NAME_RE.match(s):
            return False
        if not keyword._is_plausible_supplier_name(s):
            return False
        return _distinctive_core(s)

    return _pick_by_height(lines, geometry, _geom_candidate)
