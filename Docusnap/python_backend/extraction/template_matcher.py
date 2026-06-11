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


def identify_template(page_image, ocr_text: str, templates: list) -> dict | None:
    """
    Try to match this document to a known template.
    Returns {'template': {...}, 'confidence': int, 'method': str, 'logo_phash': str}
    or None if no match.
    """
    if not templates:
        return None

    logo_phash = None

    # 1. Logo hash — most reliable identifier
    if page_image is not None:
        logo_phash, logo_match = _match_by_logo(page_image, templates)
        if logo_match and logo_match['confidence'] >= 60:
            logo_match['logo_phash'] = logo_phash
            return logo_match

    # 2. Keyword fingerprint — fallback for docs without logos
    kw_match = _match_by_keywords(ocr_text, templates)
    if kw_match and kw_match['confidence'] >= int(KEYWORD_THRESHOLD * 100):
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
        anchor     = field.get('anchor_label')
        direction  = field.get('direction', 'right')

        if not key:
            continue

        # Fixed value — same every time (e.g. supplier_name)
        if fixed_val and not is_var:
            results[key] = {
                'value':      fixed_val,
                'confidence': 95,
                'method':     'template_fixed',
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
    """Compute a perceptual hash of the top-left logo region."""
    try:
        import imagehash
        from PIL import ImageOps, ImageFilter
        w, h  = page_image.size
        crop  = page_image.crop((0, 0, w // 2, h // 5)).convert('L')
        crop  = ImageOps.autocontrast(crop, cutoff=5)
        crop  = crop.resize((256, 256), Image.LANCZOS)
        crop  = crop.filter(ImageFilter.GaussianBlur(radius=1))
        return str(imagehash.phash(crop, hash_size=8))
    except Exception:
        return None


# ── Private helpers ───────────────────────────────────────────────────────────

def _match_by_logo(page_image: Image.Image,
                   templates: list) -> tuple[str | None, dict | None]:
    phash = compute_logo_hash(page_image)
    if not phash:
        return None, None

    best = None
    best_dist = LOGO_THRESHOLD + 1

    for t in templates:
        t_hash = t.get('logo_phash') or ''
        if not t_hash:
            continue
        dist = _hamming(phash, t_hash)
        if dist < best_dist:
            best_dist = dist
            best = {
                'template':   t,
                'confidence': max(0, 100 - dist * 6),
                'method':     'logo',
            }

    return phash, best


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
