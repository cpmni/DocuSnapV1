"""
template_matcher.py
-------------------
Template-based document identification and extraction.

Templates are identified by logo hash (primary) or keyword fingerprint
(secondary). Once matched, field values are extracted using the template's
stored anchor rules rather than general keyword patterns.
"""

import re
from PIL import Image

STOP_WORDS = {
    'the', 'and', 'for', 'are', 'was', 'from', 'that', 'this', 'with',
    'have', 'not', 'but', 'you', 'all', 'can', 'her', 'his', 'our',
    'page', 'date', 'name', 'total', 'amount', 'number', 'order', 'invoice',
}

# Calendar words rotate with every single document — the same supplier's
# invoices say "January" one month and "August" the next, so a month or
# weekday name is the opposite of a stable identity signal even though it
# is a perfectly ordinary alphabetic word. Kept separate from STOP_WORDS
# (generic-vocabulary noise) because these are noise specifically *because*
# they vary per document, not because they're meaningless.
CALENDAR_WORDS = {
    'january', 'february', 'march', 'april', 'june', 'july',
    'august', 'september', 'october', 'november', 'december',
    'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'mon', 'tue', 'tues', 'wed', 'thu', 'thur', 'thurs', 'fri', 'sat', 'sun',
}

LOGO_THRESHOLD    = 13   # max hamming distance for logo match
KEYWORD_THRESHOLD = 0.75 # min fraction of keywords that must be present
# Templates whose logos land within this hamming of the closest match are
# treated as the SAME-LOGO cluster — a supplier that issues several layouts
# under one letterhead (e.g. purchase orders AND worksheets). The logo can't
# tell those apart, so within the cluster the keyword fingerprint disambiguates.
_LOGO_AMBIG_MARGIN = 3


def identify_template(page_image, ocr_text: str, templates: list,
                      detected_slug: str | None = None,
                      title_trusted: bool = False) -> dict | None:
    """
    Try to match this document to a known template.
    Returns {'template': {...}, 'confidence': int, 'method': str, 'logo_phash': str}
    or None if no match.

    `detected_slug` / `title_trusted`: the document's OWN doc-type signal, from
    keyword.detect_document_type (the caller computes both ONCE and threads them
    identically here and into engine.extract). A supplier issues several layouts
    under ONE letterhead, so their templates share the logo AND — because the
    keyword fingerprint is the letterhead words — an IDENTICAL fingerprint; the
    fingerprint tie-break then can't tell a "Sales Order" from a "Worksheet" and
    the established sibling wins, stamping the wrong type. `detected_slug` breaks
    that tie by the document's title (`title_trusted` = the title is a real
    standalone HEADING, not a body mention). Both default off → byte-identical.
    """
    if not templates:
        return None

    ocr_lower  = ocr_text.lower()
    logo_phash = None

    # 1. Logo hash — the most reliable SUPPLIER identifier, but NOT a doc-type one
    #    (same-letterhead siblings). Gather ALL close logo candidates; within the
    #    ambiguity margin, prefer the sibling whose DOC-TYPE matches the detected
    #    title, else the keyword-fingerprint tie-break, else the closest logo.
    if page_image is not None:
        logo_phash, cands = _logo_candidates(page_image, templates)
        if cands:
            best_t, best_dist = cands[0]
            cluster_dist = best_dist                       # closest logo in the cluster
            cluster = [t for (t, d) in cands if d <= best_dist + _LOGO_AMBIG_MARGIN]
            dist_of = {id(t): d for (t, d) in cands}
            method  = 'logo'
            matching = [t for t in cluster
                        if detected_slug and (t.get('document_type_slug') or '') == detected_slug]
            if matching:
                # Prefer the type-matching sibling; deterministic: closest logo, then
                # most-confirmed. Keep supplier-identity confidence at the cluster's
                # CLOSEST logo distance (the logo says "this supplier" at that strength;
                # picking a type-correct-but-logo-farther sibling shouldn't sag it).
                best_t    = min(matching, key=lambda t: (dist_of.get(id(t), 99),
                                                         -(t.get('confirmed_count') or 0)))
                best_dist = cluster_dist
                method    = 'logo+slug'
            elif len(cluster) > 1 and not (title_trusted and detected_slug):
                scored = sorted(((t, _keyword_hit_ratio(t, ocr_lower)) for t in cluster),
                                key=lambda x: -x[1])
                if scored[0][1] > 0:                        # keyword evidence breaks the tie
                    best_t    = scored[0][0]
                    best_dist = dist_of.get(id(best_t), best_dist)
                    method    = 'logo+keywords'
            conf = max(0, 100 - best_dist * 6)
            if conf >= 60:
                # REFUSE: a TRUSTED title declares a type NONE of this letterhead's
                # templates carry — do not force a wrong-type template's layout /
                # fixed-values / Stage-0.5 mappings onto it. Return no match so the doc
                # goes to review to teach the new type (supplier identity still resolves
                # via the independent logo_fingerprints path). Gated on title_trusted, so
                # a mere incidental mention can't discard a good single-template match.
                if title_trusted and detected_slug and (best_t.get('document_type_slug') or '') != detected_slug:
                    return None
                return {'template': best_t, 'confidence': conf,
                        'method': method, 'logo_phash': logo_phash}

    # 2. Keyword fingerprint — fallback for docs without logos
    kw_match = _match_by_keywords(ocr_text, templates)
    if kw_match and kw_match['confidence'] >= int(KEYWORD_THRESHOLD * 100):
        # Same title-trust refuse on the logoless path.
        if title_trusted and detected_slug and \
           (kw_match['template'].get('document_type_slug') or '') != detected_slug:
            return None
        if logo_phash:
            kw_match['logo_phash'] = logo_phash
        return kw_match

    return None


def extract_with_template(ocr_text: str, template: dict) -> dict:
    """
    Extract field values using a template's stored field rules.
    Returns {field_key: {'value', 'confidence', 'method'}}
    """
    results = {}
    lines   = [l.strip() for l in ocr_text.split('\n')]
    fields  = template.get('fields') or []

    for field in fields:
        key        = field.get('field_key')
        fixed_val  = field.get('fixed_value')
        is_var     = field.get('is_variable', 1)
        locked     = field.get('fixed_locked', 0)
        anchor     = field.get('anchor_label')
        direction  = field.get('direction', 'right')

        if not key:
            continue

        # Fixed value — same every time (e.g. supplier_name). An admin-LOCKED fixed
        # value (fixed_locked = 1) is a deliberate, protected override → distinct
        # method 'template_fixed_locked' that engine.extract guards from ordinary
        # OCR/keyword/anchor overrides; an auto-derived non-variable value stays the
        # overridable 'template_fixed'. Same confidence either way.
        if fixed_val and not is_var:
            results[key] = {
                'value':      fixed_val,
                'confidence': 95,
                'method':     'template_fixed_locked' if locked else 'template_fixed',
            }
            continue

        # Anchor-based — find value relative to a known label
        if anchor:
            value = _find_by_anchor(lines, anchor.lower(), direction)
            if value:
                results[key] = {
                    'value':      value,
                    'confidence': 85,
                    'method':     'template_anchor',
                }

    return results


def extract_keyword_fingerprint(ocr_text: str, max_words: int = 10) -> list:
    """
    Extract distinctive keywords from the document header for template
    identification. Only looks at the first 20 lines.

    This fingerprint becomes part of a template's permanent identity
    (persisted and reused for every future match), so per-document VARIABLE
    content must not be allowed to leak in alongside the supplier's stable
    branding vocabulary:
      - any token containing a digit is skipped — invoice/reference/account
        numbers, numeric dates, amounts and postcodes are essentially never
        genuine supplier-branding words (those are overwhelmingly pure
        alphabetic), but "INV2024", "REF-A1183" etc. would otherwise be
        captured whole and rotate on every document
      - calendar words are skipped (see CALENDAR_WORDS) — the month/weekday
        named in a header changes from invoice to invoice
      - the existing generic STOP_WORDS list is still applied
    The recipient/customer block IS excluded: harvesting stops at the first
    line containing a recipient marker ("Bill To", "Ship To", "Invoice To",
    "Sold To", "Customer"). Everything after such a marker is per-document
    customer name/address — capturing it ("Alan Shonely Tampa Florida") made a
    template match only the one sample customer and fail every sibling document
    of the same supplier/layout. The marker words themselves are universal
    invoice structure, not customer-specific, so truncating AT the marker keeps
    the stable branding/header words above it while dropping the volatile block
    — layout-independent and reusable.
    """
    RECIPIENT_MARKERS = ('bill to', 'ship to', 'invoice to', 'sold to', 'customer')
    header_lines = []
    for line in ocr_text.split('\n')[:20]:
        low = line.lower()
        if any(m in low for m in RECIPIENT_MARKERS):
            break  # stop before the per-document recipient/customer block
        header_lines.append(line)
    header_text = ' '.join(header_lines)
    words       = re.findall(r'\b[A-Za-z][A-Za-z0-9]{2,}\b', header_text)

    seen        = set()
    fingerprint = []
    for word in words:
        lower = word.lower()
        if lower in STOP_WORDS or lower in CALENDAR_WORDS:
            continue
        if any(ch.isdigit() for ch in word):
            continue
        if word in seen:
            continue
        seen.add(word)
        fingerprint.append(word)
        if len(fingerprint) >= max_words:
            break

    return fingerprint


def compute_logo_hash(page_image: Image.Image) -> str | None:
    """Compute a perceptual hash of the top-left logo region.

    Delegates to the SHARED recipe in logo_hash.py so the interactive teach path
    (logo/fingerprint.py) and this Stage-0 matcher hash a logo identically — a taught
    logo and an extracted logo can never silently drift apart. Byte-identical to the
    former inline recipe (top-left crop, grey/autocontrast/resize-256/blur, phash-8)."""
    try:
        import logo_hash
        return logo_hash.logo_phash(page_image)
    except Exception:
        return None


# ── Private helpers ───────────────────────────────────────────────────────────

def _logo_candidates(page_image: Image.Image,
                     templates: list) -> tuple[str | None, list]:
    """Return (phash, [(template, hamming_distance), ...]) for every template
    whose logo is within LOGO_THRESHOLD of this page, CLOSEST FIRST. Unlike a
    single best-match, this exposes the same-logo cluster so identify_template
    can break a supplier's multi-layout tie by keyword fingerprint."""
    phash = compute_logo_hash(page_image)
    if not phash:
        return None, []
    cands = []
    for t in templates:
        # Multi-reference identity (migration 26): a template carries a SET of logo
        # hashes (logo_phashes) so per-scan drift still matches the closest. Fall
        # back to the legacy single logo_phash for un-migrated payloads. Distance =
        # MIN over the set; everything downstream (threshold/cluster/gate) is unchanged.
        hashes = t.get('logo_phashes') or ([t.get('logo_phash')] if t.get('logo_phash') else [])
        dists = [_hamming(phash, h) for h in hashes if h]
        if not dists:
            continue
        dist = min(dists)
        if dist <= LOGO_THRESHOLD:
            cands.append((t, dist))
    cands.sort(key=lambda x: x[1])
    return phash, cands


def _keyword_hit_ratio(template: dict, ocr_lower: str) -> float:
    """Fraction of a template's keyword fingerprint present on the page (the same
    word-boundary match _match_by_keywords uses). 0.0 when the template has no
    fingerprint, so a fingerprint-less template never wins a keyword tie-break."""
    keywords = template.get('keyword_fingerprint') or []
    if not keywords:
        return 0.0
    hits = sum(
        1 for kw in keywords
        if re.search(r'(?<![a-z0-9])' + re.escape(kw.lower()) + r'(?![a-z0-9])', ocr_lower)
    )
    return hits / len(keywords)


def _match_by_keywords(ocr_text: str, templates: list) -> dict | None:
    ocr_lower  = ocr_text.lower()
    best       = None
    best_score = 0.0

    for t in templates:
        keywords = t.get('keyword_fingerprint') or []
        if not keywords:
            continue
        # Word-boundary match — mirrors _label_pattern's single-word collision
        # guard (the proven Stage-1 fix). Plain substring containment let a
        # short distinctive keyword like "LTD" or "REF" score a hit by sheer
        # accident inside an unrelated word ("ALTDORF", "PREFAB") in a
        # different supplier's document, inflating that template's score and
        # raising the odds of a false cross-supplier match for suppliers that
        # fall back to keywords because they have no usable logo.
        hits = sum(
            1 for kw in keywords
            if re.search(r'(?<![a-z0-9])' + re.escape(kw.lower()) + r'(?![a-z0-9])', ocr_lower)
        )
        score = hits / len(keywords)
        if score > best_score:
            best_score = score
            best = {
                'template':   t,
                'confidence': int(score * 100),
                'method':     'keywords',
            }

    return best


def _label_pattern(label: str) -> "re.Pattern | None":
    """
    Build a regex for matching a saved template anchor label inside an OCR
    line — mirrors keyword.py's _label_pattern (the proven Stage-1 fix).

    Two needs, one pattern:
      1. Whitespace tolerance — multi-word labels ("Purchase Order No") are
         commonly OCR'd with merged or split inter-word spacing ("PURCHASE
         ORDERNO" vs "PURCHASE ORDER NO") depending on scan/font variance,
         even across pages of the very same template. \\s* between each word
         covers both without resorting to fuzzy/edit-distance matching.
      2. Collision guard — a short single-word alphabetic label ("PO", "Ref")
         must not match inside an unrelated word ("Polychemtex", "Refinishing").
         Multi-word/punctuated labels rarely collide and boundary semantics
         don't apply meaningfully to them, so the guard is scoped to the
         single-word-alphabetic shape only — preserving prior behaviour.

    Returning a single compiled pattern (rather than a bool test plus a
    separate exact-length .find()) means the match span IS the extraction
    span — removing the class of bug where a tolerant match succeeds but
    idx + len(label) lands in the wrong place because the matched text's
    length differs from the label string's length.
    """
    words = label.split()
    if not words:
        return None
    body = r'\s*'.join(re.escape(w) for w in words)
    if len(words) == 1 and words[0].isalpha():
        return re.compile(r'(?<![a-z0-9])' + body + r'(?![a-z0-9])')
    return re.compile(body)


def _find_by_anchor(lines: list, label: str, direction: str) -> str | None:
    pattern = _label_pattern(label)
    if pattern is None:
        return None

    for i, line in enumerate(lines):
        m = pattern.search(line.lower())
        if not m:
            continue
        if direction == 'right':
            rest = line[m.end():].strip().lstrip(':').strip()
            if rest:
                return rest
        elif direction == 'below':
            for j in range(i + 1, min(i + 4, len(lines))):
                if lines[j]:
                    return lines[j]
        elif direction == 'above':
            for j in range(i - 1, max(i - 4, -1), -1):
                if lines[j]:
                    return lines[j]
    return None


def _hamming(h1: str, h2: str) -> int:
    if not h1 or not h2 or len(h1) != len(h2):
        return 64
    dist = 0
    for c1, c2 in zip(h1, h2):
        xor = int(c1, 16) ^ int(c2, 16)
        dist += bin(xor).count('1')
    return dist
